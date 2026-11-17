import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeHostConfig } from "../src/config.js";
import { RuntimeHostService } from "../src/runtime-service.js";
import { FileRuntimeStateStore } from "../src/state-store.js";
import type { RuntimeEventExporter } from "../src/event-exporter.js";
import { command, FakeDshRuntime } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(): Promise<{
  root: string;
  config: RuntimeHostConfig;
  dsh: FakeDshRuntime;
  service: RuntimeHostService;
}> {
  const root = await mkdtemp(join(tmpdir(), "pc-runtime-service-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const config: RuntimeHostConfig = {
    runtimeId: "runtime-test",
    runtimeEpoch: 1,
    stateRoot: join(root, "state"),
    dshHome: join(root, "dsh-home"),
    workspace: join(root, "workspace"),
    profile: "sdk-minimal",
    profilePatch: join(root, "profile.patch.yml"),
    provider: "fake",
    model: "fake",
    initializeTimeoutMs: 5_000,
    childEnvironment: {}
  };
  const dsh = new FakeDshRuntime();
  const service = new RuntimeHostService(
    config,
    dsh,
    new FileRuntimeStateStore(config.stateRoot)
  );
  await service.initialize();
  return { root, config, dsh, service };
}

class RecordingEventExporter implements RuntimeEventExporter {
  readonly batches: Array<Array<{ stream_id: string; stream_sequence: number }>> = [];
  failuresRemaining = 0;

  export(
    events: ReadonlyArray<{ stream_id: string; stream_sequence: number }>
  ): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(new Error("event API unavailable"));
    }
    this.batches.push(events.map((event) => ({
      stream_id: event.stream_id,
      stream_sequence: event.stream_sequence
    })));
    return Promise.resolve();
  }
}

const sessionFields = {
  pc_session_id: "pc-session-1",
  assignment_generation: 1,
  fencing_token: "fence-1"
} as const;

describe("RuntimeHostService P1-A", () => {
  it("rejects foreign owner and tenant assignments before executing a session", async () => {
    const { config, service, dsh } = await fixture();
    config.ownerUserId = "owner"; config.tenantId = "tenant";
    for (const payload of [{ user_id: "foreign", tenant_id: "tenant" }, { user_id: "owner", tenant_id: "foreign" }, {}]) {
      const result = await service.execute(command(`foreign-${JSON.stringify(payload)}`, "ASSIGN_SESSION", { ...sessionFields, payload }));
      expect(result.accepted).toBe(false);
      expect(result.adapter_error?.code).toBe("PC_RUNTIME_OWNER_SCOPE_DENIED");
    }
    expect(dsh.prompts).toEqual([]);
    expect(dsh.resumed).toEqual([]);
  });
  it("does not resurrect a released assignment when an SDK resume returns late", async () => {
    const { dsh, service } = await fixture();
    await service.execute(command("late-assign", "ASSIGN_SESSION", sessionFields));
    await service.execute(command("late-turn", "START_TURN", { ...sessionFields, payload: { prompt: "first" } }));
    await service.execute(command("late-release", "REVOKE_SESSION", sessionFields));
    const replacement = { ...sessionFields, assignment_generation: 2, fencing_token: "fence-2" };
    await service.execute(command("late-reassign", "ASSIGN_SESSION", replacement));
    let unblock!: () => void;
    let started!: () => void;
    const entering = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    vi.spyOn(dsh, "resume").mockImplementation(async () => { started(); await blocked; });
    const resume = service.execute(command("late-resume", "RESUME_SESSION", replacement));
    await entering;
    await service.execute(command("late-revoke-again", "REVOKE_SESSION", replacement));
    unblock();
    expect((await resume).adapter_error?.code).toBe("PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE");
    expect(service.health()).toMatchObject({ assigned_sessions: 0, released_sessions: 1 });
    const next = { ...sessionFields, assignment_generation: 3, fencing_token: "fence-3" };
    expect((await service.execute(command("late-next", "ASSIGN_SESSION", next))).outcome_state).toBe("KNOWN_SUCCESS");
    await service.close();
  });

  it("waits for other running sessions before recycling the shared SDK", async () => {
    const { dsh, service } = await fixture();
    await service.execute(command("wait-assign", "ASSIGN_SESSION", sessionFields));
    await service.execute(command("wait-turn", "START_TURN", { ...sessionFields, payload: { prompt: "first" } }));
    await service.execute(command("wait-revoke", "REVOKE_SESSION", sessionFields));
    const replacement = { ...sessionFields, assignment_generation: 2, fencing_token: "fence-2" };
    await service.execute(command("wait-reassign", "ASSIGN_SESSION", replacement));
    const other = { ...sessionFields, pc_session_id: "other-session" };
    await service.execute(command("other-assign", "ASSIGN_SESSION", other));
    const unblock = dsh.blockNextRun();
    const turn = service.execute(command("other-turn", "START_TURN", { ...other, payload: { prompt: "active" } }));
    await vi.waitFor(() => expect(dsh.prompts).toHaveLength(2));
    const deferred = service.execute(command("wait-resume", "RESUME_SESSION", replacement));
    expect(dsh.recycleCount).toBe(0);
    unblock(); await turn;
    expect((await deferred).outcome_state).toBe("KNOWN_SUCCESS");
    expect(dsh.recycleCount).toBe(1);
    await service.close();
  });

  it("recycles an idle SDK after release and restores the exact persisted session", async () => {
    const { dsh, service } = await fixture();
    await service.execute(command("recycle-assign", "ASSIGN_SESSION", sessionFields));
    await service.execute(command("recycle-turn", "START_TURN", { ...sessionFields, payload: { prompt: "first" } }));
    await service.execute(command("recycle-revoke", "REVOKE_SESSION", sessionFields));
    const replacement = { ...sessionFields, assignment_generation: 2, fencing_token: "fence-2" };
    await service.execute(command("recycle-reassign", "ASSIGN_SESSION", replacement));
    expect((await service.execute(command("recycle-resume", "RESUME_SESSION", replacement))).outcome_state).toBe("KNOWN_SUCCESS");
    expect(dsh.recycleCount).toBe(1);
    expect(dsh.resumed).toEqual([dsh.prompts[0]!.sessionId]);
    expect((await service.conversation(sessionFields.pc_session_id)).messages[0]?.content).toBe("answer-1");
    await service.close();
  });

  it("reads paginated conversation without rewriting event authority or running a model turn", async () => {
    const { dsh, service } = await fixture();
    await service.execute(command("chat-assign", "ASSIGN_SESSION", sessionFields));
    await service.execute(command("chat-turn", "START_TURN", {
      ...sessionFields, payload: { prompt: "first" }
    }));
    const sessionId = dsh.prompts[0]!.sessionId;
    for (let index = 0; index < 1001; index++) dsh.injectEvent(sessionId, {
      type: "user/message", seq: index + 100, time: 1700000000000 + index,
      data: { id: `history-${index}`, content: [{ type: "text", text: `question-${index}` }] }
    });
    const authority = await service.events(sessionFields.pc_session_id);
    const result = await service.conversation(sessionFields.pc_session_id);
    expect(result.messages).toHaveLength(1002);
    expect(result.messages.at(-1)?.content).toBe("question-1000");
    expect(await service.events(sessionFields.pc_session_id)).toEqual(authority);
    expect(dsh.prompts).toHaveLength(1);
    await service.close();
  });

  it("uses per-Session sequence and replays a durable prefix after export failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "pc-runtime-export-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const config: RuntimeHostConfig = {
      runtimeId: "runtime-test",
      runtimeEpoch: 1,
      stateRoot: join(root, "state"),
      dshHome: join(root, "dsh-home"),
      workspace: join(root, "workspace"),
      profile: "sdk-minimal",
      profilePatch: join(root, "profile.patch.yml"),
      provider: "fake",
      model: "fake",
      initializeTimeoutMs: 5_000,
      childEnvironment: {}
    };
    const exporter = new RecordingEventExporter();
    exporter.failuresRemaining = 1;
    const service = new RuntimeHostService(
      config,
      new FakeDshRuntime(),
      new FileRuntimeStateStore(config.stateRoot),
      exporter
    );
    await service.initialize();
    await service.execute(command("assign-export-1", "ASSIGN_SESSION", {
      pc_session_id: "session-export-1",
      assignment_generation: 1,
      fencing_token: "fence-export-1",
      payload: { business_task_id: "task-export" }
    }));
    await service.execute(command("assign-export-2", "ASSIGN_SESSION", {
      pc_session_id: "session-export-2",
      assignment_generation: 1,
      fencing_token: "fence-export-2",
      payload: { business_task_id: "task-export" }
    }));
    await expect(service.execute(command("turn-export-1", "START_TURN", {
      pc_session_id: "session-export-1",
      assignment_generation: 1,
      fencing_token: "fence-export-1",
      payload: { prompt: "first" }
    }))).resolves.toMatchObject({ outcome_state: "KNOWN_SUCCESS" });
    expect(service.health()).toMatchObject({
      event_export: {
        configured: true,
        state: "DEGRADED",
        last_error: { code: "PC_EVENT_EXPORT_FAILED" }
      }
    });
    await service.execute(command("turn-export-2", "START_TURN", {
      pc_session_id: "session-export-2",
      assignment_generation: 1,
      fencing_token: "fence-export-2",
      payload: { prompt: "second" }
    }));
    await service.execute(command("turn-export-1-again", "START_TURN", {
      pc_session_id: "session-export-1",
      assignment_generation: 1,
      fencing_token: "fence-export-1",
      payload: { prompt: "third" }
    }));

    expect(exporter.batches).toHaveLength(2);
    expect(exporter.batches[0]).toEqual([
      { stream_id: "session-export-2", stream_sequence: 1 },
      { stream_id: "session-export-2", stream_sequence: 2 },
      { stream_id: "session-export-2", stream_sequence: 3 },
      { stream_id: "session-export-2", stream_sequence: 4 }
    ]);
    expect(exporter.batches[1]).toEqual([
      { stream_id: "session-export-1", stream_sequence: 1 },
      { stream_id: "session-export-1", stream_sequence: 2 },
      { stream_id: "session-export-1", stream_sequence: 3 },
      { stream_id: "session-export-1", stream_sequence: 4 },
      { stream_id: "session-export-1", stream_sequence: 5 },
      { stream_id: "session-export-1", stream_sequence: 6 },
      { stream_id: "session-export-1", stream_sequence: 7 },
      { stream_id: "session-export-1", stream_sequence: 8 }
    ]);
    expect(service.health()).toMatchObject({
      event_export: { configured: true, state: "READY" }
    });
    await service.close();
  });

  it("assigns one session, preserves two turns, and deduplicates commands", async () => {
    const { dsh, service } = await fixture();
    const assigned = await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));
    expect(assigned.outcome_state).toBe("KNOWN_SUCCESS");

    const firstCommand = command("turn-1", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "first" }
    });
    const first = await service.execute(firstCommand);
    const duplicate = await service.execute(firstCommand);
    const second = await service.execute(command("turn-2", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "second" }
    }));

    expect(first.runtime_observation.final_response).toBe("answer-1");
    expect(duplicate).toEqual(first);
    expect(second.runtime_observation.final_response).toBe("answer-2");
    expect(dsh.prompts).toHaveLength(2);
    expect((await service.events("pc-session-1"))).toHaveLength(8);
  });

  it("accepts only a live Materialization directory bound to the Assignment", async () => {
    const { config, dsh, service } = await fixture();
    config.materializationRoot = join(config.stateRoot, "materializations");
    const materializationId = "mat_test";
    const materializationRoot = join(
      config.materializationRoot,
      "tenant-1",
      "user-1",
      "pc-session-1",
      "runtime-test-1",
      materializationId
    );
    await mkdir(materializationRoot, { recursive: true });
    await service.execute(command("assign-materialized", "ASSIGN_SESSION", {
      ...sessionFields,
      payload: {
        tenant_id: "tenant-1",
        user_id: "user-1",
        workspace_materialization_id: materializationId,
        workspace_mount_ref: `materialization:${materializationId}`,
        workspace_materialization_expires_at:
          new Date(Date.now() + 60_000).toISOString()
      }
    }));
    await expect(service.execute(command("turn-materialized", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "use only materialized inputs" }
    }))).resolves.toMatchObject({ outcome_state: "KNOWN_SUCCESS" });
    expect(dsh.prompts).toHaveLength(1);

    await expect(service.execute(command(
      "assign-expired-materialization",
      "ASSIGN_SESSION",
      {
      ...sessionFields,
      payload: {
        tenant_id: "tenant-1",
        user_id: "user-1",
        workspace_materialization_expires_at:
          new Date(Date.now() - 1_000).toISOString()
      }
      }
    ))).resolves.toMatchObject({
      accepted: false,
      adapter_error: {
        code: "PC_RUNTIME_WORKSPACE_MATERIALIZATION_EXPIRED"
      }
    });
  });

  it("rejects stale epochs and stale fences before dispatch", async () => {
    const { dsh, service } = await fixture();
    await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));

    const staleEpoch = await service.execute(command("turn-stale-epoch", "START_TURN", {
      ...sessionFields,
      runtime_epoch: 0,
      payload: { prompt: "blocked" }
    }));
    const staleFence = await service.execute(command("turn-stale-fence", "START_TURN", {
      ...sessionFields,
      fencing_token: "old-fence",
      payload: { prompt: "blocked" }
    }));
    expect(staleEpoch.adapter_error?.code).toBe("PC_RUNTIME_EPOCH_STALE");
    expect(staleFence.adapter_error?.code).toBe("PC_RUNTIME_FENCE_STALE");
    expect(dsh.prompts).toHaveLength(0);
  });

  it("refreshes the same Assignment lease and expires stale execution authority", async () => {
    const { service } = await fixture();
    const firstLease = new Date(Date.now() + 1_000).toISOString();
    const refreshedLease = new Date(Date.now() + 60_000).toISOString();
    const assigned = await service.execute(command("assign-1", "ASSIGN_SESSION", {
      ...sessionFields,
      payload: { lease_expires_at: firstLease }
    }));
    const refreshed = await service.execute(command("assign-refresh", "ASSIGN_SESSION", {
      ...sessionFields,
      payload: { lease_expires_at: refreshedLease }
    }));

    expect(assigned.runtime_observation.assignment).toMatchObject({
      leaseExpiresAt: firstLease
    });
    expect(refreshed.runtime_observation).toMatchObject({
      lease_refreshed: true,
      assignment: {
        leaseExpiresAt: refreshedLease
      }
    });

    const expiredLease = new Date(Date.now() + 25).toISOString();
    await service.execute(command("assign-2", "ASSIGN_SESSION", {
      pc_session_id: "pc-session-2",
      assignment_generation: 1,
      fencing_token: "fence-2",
      payload: { lease_expires_at: expiredLease }
    }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const expired = await service.execute(command("turn-expired", "START_TURN", {
      pc_session_id: "pc-session-2",
      assignment_generation: 1,
      fencing_token: "fence-2",
      payload: { prompt: "blocked" }
    }));
    expect(expired.adapter_error?.code).toBe("PC_RUNTIME_LEASE_EXPIRED");
  });

  it("fails closed until Backend authority activates and synchronizes the Guard", async () => {
    const { dsh, service } = await fixture();
    const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const authority = {
      assignment_id: "assignment-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      lease_id: "lease-1",
      lease_expires_at: leaseExpiresAt,
      effective_profile_snapshot_id: "profile-snapshot-1",
      workspace_view_snapshot_id: "workspace-view-1",
      authorization_revision: 1
    };
    const pending = await service.execute(command("assign-pending", "ASSIGN_SESSION", {
      ...sessionFields,
      payload: {
        ...authority,
        assignment_state: "PENDING",
        authority_version: 1
      }
    }));
    const blocked = await service.execute(command("turn-pending", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "blocked" }
    }));
    const active = await service.execute(command("assign-active", "ASSIGN_SESSION", {
      ...sessionFields,
      payload: {
        ...authority,
        assignment_state: "ACTIVE",
        authority_version: 2
      }
    }));

    expect(pending.outcome_state).toBe("KNOWN_SUCCESS");
    expect(blocked.adapter_error?.code).toBe("PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE");
    expect(active.runtime_observation).toMatchObject({
      guard_synced: true,
      assignment: {
        authorityState: "ACTIVE",
        authorityVersion: 2
      }
    });
    expect(dsh.guardSnapshots.values().next().value).toMatchObject({
      state: "ACTIVE",
      authorityVersion: 2,
      leaseExpiresAt
    });
    await expect(service.assignmentGuard("pc-session-1", "tool")).resolves.toMatchObject({
      allowed: true,
      code: "PC_RUNTIME_GUARD_ALLOWED"
    });
  });

  it("reports a completed DSH error turn as a known failure", async () => {
    const { dsh, service } = await fixture();
    dsh.finishReason = "error";
    await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));

    const failed = await service.execute(command("turn-failed", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "fail" }
    }));

    expect(failed.accepted).toBe(true);
    expect(failed.committed).toBe(true);
    expect(failed.outcome_state).toBe("KNOWN_FAILURE");
    expect(failed.adapter_error).toMatchObject({
      code: "PC_DSH_TRANSPORT",
      retryable: true
    });
    expect((await service.events("pc-session-1"))).toHaveLength(4);
  });

  it("reports an aborted DSH turn as a stable cancellation failure", async () => {
    const { dsh, service } = await fixture();
    dsh.finishReason = "aborted";
    await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));

    const aborted = await service.execute(command("turn-aborted", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "cancel me" }
    }));

    expect(aborted).toMatchObject({
      accepted: true,
      committed: true,
      outcome_state: "KNOWN_FAILURE",
      adapter_error: {
        code: "PC_DSH_CANCELLED",
        retryable: true
      },
      runtime_observation: {
        final_response: ""
      }
    });
  });

  it("cancels the exact live Session without waiting for the blocked turn", async () => {
    const { dsh, service } = await fixture();
    const assigned = await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));
    const dshSessionId = (
      assigned.runtime_observation.assignment as { dshSessionId: string }
    ).dshSessionId;
    const release = dsh.blockNextRun();
    const turn = service.execute(command("turn-blocked", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "blocked" }
    }));
    await vi.waitFor(() => {
      expect(dsh.prompts).toEqual([
        { sessionId: dshSessionId, prompt: "blocked" }
      ]);
    });

    const cancelled = await service.execute(command("cancel-live", "CANCEL_TURN", sessionFields));

    expect(cancelled.outcome_state).toBe("KNOWN_SUCCESS");
    expect(cancelled.runtime_observation).toMatchObject({
      cancel_requested: true,
      was_running: true
    });
    expect(dsh.cancelled).toEqual([dshSessionId]);
    release();
    await expect(turn).resolves.toMatchObject({ outcome_state: "KNOWN_SUCCESS" });
  });

  it("flushes a durable prefix and catches up DSH history idempotently", async () => {
    const { dsh, service } = await fixture();
    const assigned = await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));
    const dshSessionId = (
      assigned.runtime_observation.assignment as { dshSessionId: string }
    ).dshSessionId;
    await service.execute(command("turn-1", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "first" }
    }));

    const flushed = await service.execute(command("flush-1", "FLUSH_SESSION", sessionFields));
    const duplicateCatchUp = await service.execute(command("catch-up-1", "CATCH_UP_EVENTS", {
      ...sessionFields,
      payload: { after_dsh_session_seq: -1, limit: 100 }
    }));

    expect(flushed.runtime_observation).toMatchObject({
      durability: "DURABLE_DSH",
      durable_through_dsh_sequence: 3
    });
    expect(duplicateCatchUp.runtime_observation).toMatchObject({
      event_count: 4,
      accepted_count: 0,
      duplicate_count: 4,
      durability: "DURABLE_DSH"
    });
    expect(
      (duplicateCatchUp.runtime_observation.events as Array<{ durability: string }>)
        .every((event) => event.durability === "DURABLE_DSH")
    ).toBe(true);
    expect(await service.events("pc-session-1")).toHaveLength(4);

    dsh.injectEvent(dshSessionId, {
      type: "checkpoint/advanced",
      seq: 4,
      time: Date.now(),
      data: { checkpoint: 4 }
    });
    const repaired = await service.execute(command("catch-up-2", "CATCH_UP_EVENTS", {
      ...sessionFields,
      payload: { after_dsh_session_seq: 3, limit: 100 }
    }));

    expect(repaired.runtime_observation).toMatchObject({
      event_count: 1,
      accepted_count: 1,
      duplicate_count: 0,
      through_dsh_session_seq: 4
    });
    expect(await service.events("pc-session-1")).toHaveLength(5);
  });

  it("requires explicit resume after host replacement and then accepts the third turn", async () => {
    const { config, dsh, service } = await fixture();
    await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));
    await service.execute(command("turn-1", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "first" }
    }));
    await service.execute(command("turn-2", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "second" }
    }));
    await service.close();

    const replacementDsh = new FakeDshRuntime();
    const replacement = new RuntimeHostService(
      config,
      replacementDsh,
      new FileRuntimeStateStore(config.stateRoot)
    );
    await replacement.initialize();

    const beforeResume = await replacement.execute(command("turn-3-before-resume", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "third" }
    }));
    expect(beforeResume.adapter_error?.code).toBe("PC_RUNTIME_SESSION_RESUME_REQUIRED");

    const resumed = await replacement.execute(command("resume-1", "RESUME_SESSION", sessionFields));
    const third = await replacement.execute(command("turn-3", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "third" }
    }));

    expect(resumed.outcome_state).toBe("KNOWN_SUCCESS");
    expect(replacementDsh.resumed).toHaveLength(1);
    expect(third.runtime_observation.turn_count).toBe(3);
    expect(dsh.prompts).toHaveLength(2);
    await replacement.close();
  });

  it("revokes, durably releases, and idempotently tombstones one Session", async () => {
    const { dsh, service } = await fixture();
    await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));
    await service.execute(command("turn-1", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "first" }
    }));

    const revoked = await service.execute(command("revoke-1", "REVOKE_SESSION", {
      ...sessionFields,
      payload: { reason: "MIGRATION", finalizer_timeout_ms: 1_000 }
    }));
    const repeated = await service.execute(command("revoke-2", "REVOKE_SESSION", {
      ...sessionFields,
      payload: { reason: "MIGRATION", finalizer_timeout_ms: 1_000 }
    }));
    const rejectedTurn = await service.execute(command("turn-after-release", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "blocked" }
    }));

    expect(revoked).toMatchObject({
      outcome_state: "KNOWN_SUCCESS",
      runtime_observation: {
        released: true,
        cleanup_report: {
          cleanup_state: "CLEAN",
          resource_leak: false
        }
      }
    });
    expect(dsh.flushed).toHaveLength(1);
    expect(dsh.released).toHaveLength(1);
    expect(repeated.runtime_observation).toMatchObject({
      released: true,
      idempotent: true
    });
    expect(rejectedTurn.adapter_error?.code).toBe("PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE");
    expect(service.health()).toMatchObject({
      runtime_state: "READY",
      assigned_sessions: 0,
      released_sessions: 1
    });
  });

  it("closes admission, cancels active work, and drains every Session to termination", async () => {
    const { dsh, service } = await fixture();
    await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));
    const releaseTurn = dsh.blockNextRun();
    const turn = service.execute(command("turn-blocked", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "blocked" }
    }));
    await vi.waitFor(() => {
      expect(dsh.prompts).toHaveLength(1);
    });

    const drain = service.execute(command("drain-1", "DRAIN_RUNTIME", {
      payload: {
        reason: "VERSION_UPGRADE",
        finalizer_timeout_ms: 2_000
      }
    }));
    await vi.waitFor(() => {
      expect(dsh.cancelled).toHaveLength(1);
    });
    const admission = service.execute(command("assign-during-drain", "ASSIGN_SESSION", {
      pc_session_id: "pc-session-2",
      assignment_generation: 1,
      fencing_token: "fence-2"
    }));
    releaseTurn();
    await turn;
    const admissionRejected = await admission;
    const drained = await drain;

    expect(admissionRejected.adapter_error?.code).toBe("PC_RUNTIME_DRAINING");
    expect(drained).toMatchObject({
      outcome_state: "KNOWN_SUCCESS",
      runtime_observation: {
        terminated: true,
        cleanup_report: {
          cleanup_state: "CLEAN",
          resource_leak: false,
          session_ids: ["pc-session-1"]
        }
      }
    });
    expect(dsh.flushed).toHaveLength(1);
    expect(dsh.released).toHaveLength(1);
    expect(service.health()).toMatchObject({
      status: "terminated",
      runtime_state: "TERMINATED",
      bridge_state: "CLOSED",
      assigned_sessions: 0,
      released_sessions: 1
    });
  });

  it("runs later finalizers and records a partial Cleanup Report after failures", async () => {
    const { dsh, service } = await fixture();
    await service.execute(command("assign-1", "ASSIGN_SESSION", sessionFields));
    await service.execute(command("turn-1", "START_TURN", {
      ...sessionFields,
      payload: { prompt: "first" }
    }));
    dsh.flushError = new Error("flush unavailable");
    dsh.releaseError = new Error("release unavailable");
    dsh.closeError = new Error("close unavailable");

    const drained = await service.execute(command("drain-failed", "DRAIN_RUNTIME", {
      payload: { reason: "FAILURE_TEST", finalizer_timeout_ms: 1_000 }
    }));
    const report = drained.runtime_observation.cleanup_report as {
      cleanup_state: string;
      resource_leak: boolean;
      finalizers: Array<{ name: string; status: string }>;
    };

    expect(drained).toMatchObject({
      accepted: true,
      committed: true,
      outcome_state: "KNOWN_FAILURE",
      adapter_error: {
        code: "PC_RUNTIME_DRAIN_INCOMPLETE"
      }
    });
    expect(report.cleanup_state).toBe("PARTIAL_FAILURE");
    expect(report.resource_leak).toBe(true);
    expect(report.finalizers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "session.flush", status: "FAILED" }),
      expect.objectContaining({ name: "session.release", status: "FAILED" }),
      expect.objectContaining({ name: "assignment.release", status: "SUCCEEDED" }),
      expect.objectContaining({ name: "runtime.executors.close", status: "FAILED" }),
      expect.objectContaining({ name: "runtime.metrics-audit.flush", status: "SUCCEEDED" })
    ]));
    expect(service.health()).toMatchObject({
      runtime_state: "TERMINATED",
      assigned_sessions: 0,
      released_sessions: 1,
      cleanup_report: {
        cleanup_state: "PARTIAL_FAILURE"
      }
    });
  });

  it("preserves a terminated Runtime tombstone across host restart", async () => {
    const { config, service } = await fixture();
    const drained = await service.execute(command("drain-empty", "DRAIN_RUNTIME", {
      payload: { reason: "TOMBSTONE_TEST", finalizer_timeout_ms: 1_000 }
    }));
    expect(drained.outcome_state).toBe("KNOWN_SUCCESS");

    const replacementDsh = new FakeDshRuntime();
    const replacement = new RuntimeHostService(
      config,
      replacementDsh,
      new FileRuntimeStateStore(config.stateRoot)
    );
    await replacement.initialize();
    const rejected = await replacement.execute(command("assign-after-terminate", "ASSIGN_SESSION", {
      ...sessionFields
    }));

    expect(replacement.health()).toMatchObject({
      status: "terminated",
      runtime_state: "TERMINATED",
      bridge_state: "CLOSED",
      cleanup_report: {
        reason: "TOMBSTONE_TEST"
      },
      dsh: {
        state: "NOT_STARTED"
      }
    });
    expect(rejected.adapter_error?.code).toBe("PC_RUNTIME_TERMINATED");
    await replacement.close();
  });
});
