import type {
  DshAssignmentGuardSnapshot,
  DshCancelResult,
  DshEventsResult,
  DshFlushResult,
  DshGuardDecision,
  DshReleaseResult,
  DshRunResult,
  DshRuntimeHealth,
  DshRuntimePort,
  DshSessionEvent
} from "@pc/dsh-bridge";
import type { RuntimeCommand } from "@pc/runtime-adapter";

export class FakeDshRuntime implements DshRuntimePort {
  recycleCount = 0;
  async recycle(): Promise<void> { this.recycleCount += 1; }
  readonly prompts: Array<{ sessionId: string; prompt: string }> = [];
  readonly resumed: string[] = [];
  readonly cancelled: string[] = [];
  readonly flushed: string[] = [];
  readonly released: string[] = [];
  readonly guardSnapshots = new Map<string, DshAssignmentGuardSnapshot>();
  finishReason: "completed" | "error" | "aborted" = "completed";
  flushError: Error | undefined;
  releaseError: Error | undefined;
  closeError: Error | undefined;
  private state: DshRuntimeHealth["state"] = "NOT_STARTED";
  private readonly nextSequences = new Map<string, number>();
  private readonly histories = new Map<string, DshSessionEvent[]>();
  private readonly activeSessions = new Set<string>();
  private runBlocker: Promise<void> | undefined;

  blockNextRun(): () => void {
    let release = (): void => undefined;
    this.runBlocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  injectEvent(sessionId: string, event: DshSessionEvent): void {
    const history = this.histories.get(sessionId) ?? [];
    history.push(event);
    this.histories.set(sessionId, history);
    this.nextSequences.set(
      sessionId,
      Math.max(this.nextSequences.get(sessionId) ?? 0, event.seq + 1)
    );
  }

  async start(): Promise<void> {
    this.state = "READY";
  }

  async run(sessionId: string, prompt: string): Promise<DshRunResult> {
    this.state = "READY";
    this.prompts.push({ sessionId, prompt });
    this.activeSessions.add(sessionId);
    const blocker = this.runBlocker;
    this.runBlocker = undefined;
    if (blocker !== undefined) await blocker;
    const turn = this.prompts.filter((entry) => entry.sessionId === sessionId).length;
    let sequence = this.nextSequences.get(sessionId) ?? 0;
    const events = [
      {
        type: "agent/inbox/spliced",
        seq: sequence++,
        time: Date.now(),
        data: {
          target: "next-turn",
          start: turn - 1,
          inserted: [{ id: `user-${turn}`, role: "user" }]
        }
      },
      {
        type: "turn/start",
        seq: sequence++,
        time: Date.now(),
        data: { turn: turn - 1 }
      },
      {
        type: "assistant/message",
        seq: sequence++,
        time: Date.now(),
        data: {
          turn: turn - 1,
          step: 0,
          message: {
            id: `assistant-${turn}`,
            role: "assistant",
            content: [{ type: "text", text: `answer-${turn}` }],
            source: { provider: "fake", model: "fake" }
          }
        }
      },
      {
        type: "turn/end",
        seq: sequence++,
        time: Date.now(),
        data: {
          turn: turn - 1,
          reason: this.finishReason === "error"
            ? {
                kind: "error",
                error: { code: "TRANSPORT", message: "fake transport failure" }
              }
            : this.finishReason === "aborted"
              ? { kind: "aborted", reason: { kind: "user" } }
              : { kind: "completed" }
        }
      }
    ];
    this.nextSequences.set(sessionId, sequence);
    this.histories.set(sessionId, [...(this.histories.get(sessionId) ?? []), ...events]);
    this.activeSessions.delete(sessionId);
    return {
      sessionId,
      finalResponse: this.finishReason === "completed" ? `answer-${turn}` : "",
      events,
      notificationCount: events.length + 2,
      finishReason: this.finishReason,
      ...(this.finishReason === "error"
        ? {
            turnError: {
              code: "TRANSPORT",
              message: "fake transport failure"
            }
          }
        : {})
    };
  }

  async resume(sessionId: string): Promise<void> {
    this.resumed.push(sessionId);
  }

  async flush(sessionId: string): Promise<DshFlushResult> {
    if (this.flushError !== undefined) throw this.flushError;
    this.flushed.push(sessionId);
    return {
      durable: true,
      throughSequence: this.histories.get(sessionId)?.at(-1)?.seq ?? -1
    };
  }

  async release(sessionId: string): Promise<DshReleaseResult> {
    if (this.releaseError !== undefined) throw this.releaseError;
    this.released.push(sessionId);
    this.activeSessions.delete(sessionId);
    return {
      released: true,
      durable: true
    };
  }

  async upsertAssignmentGuard(snapshot: DshAssignmentGuardSnapshot): Promise<void> {
    this.guardSnapshots.set(snapshot.dshSessionId, structuredClone(snapshot));
  }

  assignmentGuard(
    sessionId: string,
    kind: "step" | "tool"
  ): Promise<DshGuardDecision> {
    void kind;
    const snapshot = this.guardSnapshots.get(sessionId);
    if (snapshot === undefined) {
      return Promise.resolve({
        allowed: false,
        code: "PC_RUNTIME_ASSIGNMENT_NOT_FOUND",
        reason: "Assignment guard snapshot is missing",
        state: "MISSING",
        leaseExpiresAt: "",
        authorityVersion: -1
      });
    }
    const active = snapshot.state === "ACTIVE"
      && Date.parse(snapshot.leaseExpiresAt) > Date.now();
    return Promise.resolve({
      allowed: active,
      code: active
        ? "PC_RUNTIME_GUARD_ALLOWED"
        : snapshot.state === "ACTIVE"
          ? "PC_RUNTIME_LEASE_EXPIRED"
          : "PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE",
      reason: active ? "allowed" : "denied",
      state: snapshot.state,
      leaseExpiresAt: snapshot.leaseExpiresAt,
      authorityVersion: snapshot.authorityVersion
    });
  }

  async cancel(sessionId: string): Promise<DshCancelResult> {
    this.cancelled.push(sessionId);
    return {
      requested: true,
      wasRunning: this.activeSessions.has(sessionId)
    };
  }

  async events(
    sessionId: string,
    afterSequence: number,
    limit: number
  ): Promise<DshEventsResult> {
    const available = (this.histories.get(sessionId) ?? [])
      .filter((event) => event.seq > afterSequence);
    const events = available.slice(0, limit);
    return {
      events,
      throughSequence: events.at(-1)?.seq ?? afterSequence,
      hasMore: available.length > events.length
    };
  }

  async close(): Promise<void> {
    this.state = "CLOSED";
    if (this.closeError !== undefined) throw this.closeError;
  }

  health(): DshRuntimeHealth {
    return {
      state: this.state,
      profile: "sdk-minimal",
      version: "0.2.1-rc.3",
      controlBridge: {
        state: this.state === "CLOSED" ? "CLOSED" : "READY",
        protocolVersion: "1.0",
        bridgeBuild: "fake"
      }
    };
  }
}

export function command(
  commandId: string,
  commandType: RuntimeCommand["command_type"],
  overrides: Partial<RuntimeCommand> = {}
): RuntimeCommand {
  return {
    contract_name: "pc.runtime-command/1",
    contract_version: 1,
    command_id: commandId,
    command_type: commandType,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    runtime_id: "runtime-test",
    runtime_epoch: 1,
    payload: {},
    ...overrides
  };
}
