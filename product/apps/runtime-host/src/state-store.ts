import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PcEventEnvelope } from "@pc/dsh-bridge";
import type {
  PersistedRuntimeState,
  RuntimeIdentity
} from "@pc/runtime-adapter";

export interface RuntimeStateStore {
  load(identity: RuntimeIdentity): Promise<PersistedRuntimeState>;
  save(state: PersistedRuntimeState): Promise<void>;
  appendEvents(events: PcEventEnvelope[]): Promise<EventAppendResult>;
  readEvents(pcSessionId: string): Promise<PcEventEnvelope[]>;
}

export interface EventAppendResult {
  accepted: number;
  duplicates: number;
}

export class EventSequenceConflictError extends Error {
  constructor(
    readonly pcSessionId: string,
    readonly dshSessionSequence: number
  ) {
    super(
      `DSH sequence ${dshSessionSequence} conflicts with an existing event for ${pcSessionId}`
    );
    this.name = "EventSequenceConflictError";
  }
}

function initialState(identity: RuntimeIdentity): PersistedRuntimeState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runtimeId: identity.runtimeId,
    runtimeEpoch: identity.runtimeEpoch,
    runtimeState: "STARTING",
    bridgeState: "NOT_STARTED",
    nextRuntimeEventSequence: 0,
    assignments: {},
    completedCommands: {},
    startedAt: now,
    updatedAt: now
  };
}

function sessionFile(pcSessionId: string): string {
  return `${createHash("sha256").update(pcSessionId).digest("hex")}.jsonl`;
}

export class FileRuntimeStateStore implements RuntimeStateStore {
  private readonly stateFile: string;
  private readonly eventsRoot: string;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly root: string) {
    this.stateFile = join(root, "runtime-state.json");
    this.eventsRoot = join(root, "events");
  }

  async load(identity: RuntimeIdentity): Promise<PersistedRuntimeState> {
    await mkdir(this.eventsRoot, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8")) as PersistedRuntimeState;
      if (parsed.schemaVersion !== 1) throw new Error("runtime state schema is unsupported");
      if (parsed.runtimeId !== identity.runtimeId || parsed.runtimeEpoch > identity.runtimeEpoch) {
        throw new Error("runtime state identity does not match configured runtime");
      }
      if (parsed.runtimeEpoch < identity.runtimeEpoch) {
        if (parsed.runtimeState === "TERMINATED") {
          throw new Error("terminated runtime state cannot be resurrected by a new epoch");
        }
        // Keep session continuity, but never carry old authority into a replacement.
        await writeFile(join(this.root, `runtime-state-epoch-${parsed.runtimeEpoch}.json`),
          `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          });
        const replacement: PersistedRuntimeState = {
          ...parsed,
          runtimeEpoch: identity.runtimeEpoch,
          runtimeState: "STARTING",
          bridgeState: "NOT_STARTED",
          completedCommands: {},
          assignments: Object.fromEntries(Object.entries(parsed.assignments).map(([key, assignment]) =>
            [key, { ...assignment, status: assignment.status === "RELEASED" ? "RELEASED" : "EXPIRED" }])),
          updatedAt: new Date().toISOString()
        };
        await this.save(replacement);
        return replacement;
      }
      const assignments = Object.fromEntries(
        Object.entries(parsed.assignments).map(([key, assignment]) => [
          key,
          assignment.status === "RELEASED" || assignment.status === "EXPIRED"
            ? assignment
            : assignment.turnCount > 0
              ? { ...assignment, status: "NEEDS_RESUME" as const }
              : { ...assignment, status: "ASSIGNED" as const }
        ])
      );
      const activeAssignments = Object.values(assignments)
        .filter((assignment) =>
          assignment.status !== "RELEASED" && assignment.status !== "EXPIRED"
        );
      return {
        ...parsed,
        runtimeState: parsed.runtimeState === "TERMINATED"
          ? "TERMINATED"
          : activeAssignments.length === 0 ? "STARTING" : "ASSIGNED",
        bridgeState: parsed.runtimeState === "TERMINATED" ? "CLOSED" : "NOT_STARTED",
        assignments,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return initialState(identity);
      throw error;
    }
  }

  save(state: PersistedRuntimeState): Promise<void> {
    const body = `${JSON.stringify(state, null, 2)}\n`;
    const operation = this.saveQueue.then(async () => {
      await mkdir(this.root, { recursive: true });
      const temporary = join(this.root, `.runtime-state-${randomUUID()}.tmp`);
      await writeFile(temporary, body, "utf8");
      await rename(temporary, this.stateFile);
    });
    this.saveQueue = operation.catch(() => undefined);
    return operation;
  }

  async appendEvents(events: PcEventEnvelope[]): Promise<EventAppendResult> {
    if (events.length === 0) return { accepted: 0, duplicates: 0 };
    await mkdir(this.eventsRoot, { recursive: true });
    const grouped = new Map<string, PcEventEnvelope[]>();
    for (const event of events) {
      const sessionEvents = grouped.get(event.pc_session_id) ?? [];
      sessionEvents.push(event);
      grouped.set(event.pc_session_id, sessionEvents);
    }
    let accepted = 0;
    let duplicates = 0;
    for (const [pcSessionId, sessionEvents] of grouped) {
      const existing = await this.readEvents(pcSessionId);
      const eventIds = new Set(existing.map((event) => event.event_id));
      const sequenceIds = new Map(
        existing.map((event) => [event.dsh_session_seq, event.event_id] as const)
      );
      const sequenceEvents = new Map(existing.map((event) => [event.dsh_session_seq, event]));
      const pending: PcEventEnvelope[] = [];
      for (const event of sessionEvents) {
        if (eventIds.has(event.event_id)) {
          duplicates += 1;
          continue;
        }
        const sequenceEventId = sequenceIds.get(event.dsh_session_seq);
        if (sequenceEventId !== undefined && sequenceEventId !== event.event_id) {
          const prior = sequenceEvents.get(event.dsh_session_seq);
          if (prior?.dsh_session_id === event.dsh_session_id && prior.payload_digest === event.payload_digest) {
            duplicates += 1;
            continue;
          }
          throw new EventSequenceConflictError(pcSessionId, event.dsh_session_seq);
        }
        eventIds.add(event.event_id);
        sequenceIds.set(event.dsh_session_seq, event.event_id);
        sequenceEvents.set(event.dsh_session_seq, event);
        pending.push(event);
      }
      if (pending.length === 0) continue;
      const body = pending.map((event) => JSON.stringify(event)).join("\n");
      await appendFile(join(this.eventsRoot, sessionFile(pcSessionId)), `${body}\n`, "utf8");
      accepted += pending.length;
    }
    return { accepted, duplicates };
  }

  async readEvents(pcSessionId: string): Promise<PcEventEnvelope[]> {
    try {
      const body = await readFile(join(this.eventsRoot, sessionFile(pcSessionId)), "utf8");
      return body
        .split(/\r?\n/u)
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as PcEventEnvelope);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
