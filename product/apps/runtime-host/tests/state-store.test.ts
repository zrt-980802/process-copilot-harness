import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeDshEvent } from "@pc/dsh-bridge";
import {
  EventSequenceConflictError,
  FileRuntimeStateStore
} from "../src/state-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function event(data: Record<string, unknown>, runtimeEventSequence: number) {
  return normalizeDshEvent(
    {
      type: "turn/start",
      seq: 0,
      time: 1_700_000_000_000,
      data
    },
    {
      runtimeId: "runtime-1",
      runtimeEpoch: 1,
      pcSessionId: "pc-session-1",
      dshSessionId: "dsh-session-1",
      assignmentGeneration: 1,
      fencingToken: "fence-1",
      runtimeEventSequence
    }
  );
}

describe("FileRuntimeStateStore event admission", () => {
  it("preserves session cursors but expires authority on a forward epoch and rejects rollback", async () => {
    const root = await mkdtemp(join(tmpdir(), "pc-epoch-store-"));
    roots.push(root);
    const store = new FileRuntimeStateStore(root);
    const identity = { runtimeId: "runtime-1", runtimeEpoch: 1 };
    const state = await store.load(identity);
    state.nextRuntimeEventSequence = 17;
    state.assignments.session = {
      pcSessionId: "session", dshSessionId: "persisted-dsh", assignmentGeneration: 1,
      fencingToken: "old-fence", status: "NEEDS_RESUME", turnCount: 2,
      lastDshSequence: 13, lastRuntimeEventSequence: 16,
      assignedAt: state.startedAt, updatedAt: state.updatedAt
    };
    await store.save(state);
    const recovered = await store.load({ ...identity, runtimeEpoch: 2 });
    expect(recovered.runtimeEpoch).toBe(2);
    expect(recovered.assignments.session).toMatchObject({ status: "EXPIRED", turnCount: 2,
      dshSessionId: "persisted-dsh", lastDshSequence: 13 });
    expect(recovered.nextRuntimeEventSequence).toBe(17);
    expect(JSON.parse(await readFile(join(root, "runtime-state-epoch-1.json"), "utf8"))).toEqual(state);
    await expect(store.load(identity)).rejects.toThrow("identity");
    await expect(store.load({ runtimeId: "other", runtimeEpoch: 3 })).rejects.toThrow("identity");
    recovered.runtimeState = "TERMINATED";
    await store.save(recovered);
    await expect(store.load({ ...identity, runtimeEpoch: 3 })).rejects.toThrow("resurrected");
  });

  it("deduplicates event identities and rejects conflicting DSH sequences", async () => {
    const root = await mkdtemp(join(tmpdir(), "pc-event-store-"));
    roots.push(root);
    const store = new FileRuntimeStateStore(root);
    const original = event({ turn: 0 }, 0);
    const duplicate = event({ turn: 0 }, 1);
    const conflict = event({ turn: 1 }, 2);

    await expect(store.appendEvents([original])).resolves.toEqual({
      accepted: 1,
      duplicates: 0
    });
    await expect(store.appendEvents([duplicate])).resolves.toEqual({
      accepted: 0,
      duplicates: 1
    });
    await expect(store.appendEvents([{ ...duplicate, event_id: "replacement-epoch-event", runtime_epoch: 2 }])).resolves.toEqual({
      accepted: 0, duplicates: 1
    });
    await expect(store.appendEvents([conflict])).rejects.toBeInstanceOf(
      EventSequenceConflictError
    );
    await expect(store.readEvents("pc-session-1")).resolves.toEqual([original]);
  });
});
