import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  OfficialDshSdkRuntime,
  normalizeDshEvent
} from "../src/index.js";

const fakeBridge = fileURLToPath(new URL("./fixtures/fake-sdk-bridge.mjs", import.meta.url));
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pc-p1a-sdk-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

function runtime(root: string): OfficialDshSdkRuntime {
  return new OfficialDshSdkRuntime({
    profile: "sdk-minimal",
    dshHome: join(root, "dsh-home"),
    workspace: root,
    provider: "fake",
    model: "fake",
    dshBin: "fake-dsh",
    bridgeCommand: process.execPath,
    bridgeArgs: [fakeBridge],
    environment: { ...process.env },
    initializeTimeoutMs: 5_000,
    requestTimeoutMs: 5_000
  });
}

describe("P1-A official SDK spike", () => {
  it("runs two prompts, replaces the child, resumes, and runs a third prompt", async () => {
    const root = await tempRoot();
    const firstRuntime = runtime(root);
    await firstRuntime.start();

    const first = await firstRuntime.run("session-p1a", "first");
    const second = await firstRuntime.run("session-p1a", "second");
    expect(first.finalResponse).toContain("turn=1;history=;prompt=first");
    expect(second.finalResponse).toContain("turn=2;history=first;prompt=second");
    expect(second.events.at(-1)?.type).toBe("turn/end");
    await firstRuntime.close();

    const replacement = runtime(root);
    cleanups.push(() => replacement.close());
    await replacement.start();
    await replacement.resume("session-p1a");
    const third = await replacement.run("session-p1a", "third");

    expect(third.finalResponse).toContain("turn=3;history=first|second;prompt=third");
    expect(replacement.health()).toMatchObject({ state: "READY", version: "0.2.1-rc.3" });
  });

  it("normalizes deterministic C25 event identities", () => {
    const event = {
      type: "turn/start",
      seq: 7,
      time: 1_700_000_000_000,
      data: { turn: 2 }
    };
    const context = {
      runtimeId: "runtime-1",
      runtimeEpoch: 1,
      pcSessionId: "pc-session-1",
      dshSessionId: "dsh-session-1",
      assignmentGeneration: 3,
      fencingToken: "fence-3",
      runtimeEventSequence: 10
    };
    const first = normalizeDshEvent(event, context);
    const duplicate = normalizeDshEvent(event, { ...context, runtimeEventSequence: 11 });

    expect(first.event_id).toBe(duplicate.event_id);
    expect(first.runtime_event_seq).toBe(10);
    expect(duplicate.runtime_event_seq).toBe(11);
    expect(first.stream_sequence).toBe(8);
    expect(duplicate.stream_sequence).toBe(8);
    expect(first.observed_at).toBe(first.occurred_at);
    expect(first.payload).toEqual({ turn: 2 });
  });
});
