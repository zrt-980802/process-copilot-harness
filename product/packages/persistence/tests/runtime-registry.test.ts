import { describe, expect, it } from "vitest";
import {
  RuntimeRegistryService,
  type RuntimeCommandDispatcher
} from "@pc/application";
import type { RuntimeRegistryError } from "@pc/domain";
import { MemoryRuntimeRegistryRepository } from "../src/index.js";
import type {
  RuntimeCommand,
  RuntimeCommandResult
} from "@pc/runtime-adapter";

class FakeDispatcher implements RuntimeCommandDispatcher {
  readonly commands: RuntimeCommand[] = [];

  execute(_runtime: unknown, command: RuntimeCommand): Promise<RuntimeCommandResult> {
    this.commands.push(structuredClone(command));
    return Promise.resolve({
      contract_name: "pc.runtime-command-result/1",
      contract_version: 1,
      command_id: command.command_id,
      accepted: true,
      committed: true,
      outcome_state: "KNOWN_SUCCESS",
      runtime_observation: {},
      completed_at: new Date().toISOString()
    });
  }
}

function clock(start = "2026-11-10T00:00:00.000Z") {
  let now = new Date(start);
  return {
    now: () => new Date(now),
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    }
  };
}

function registration(runtimeEpoch = 1) {
  return {
    runtime_id: "runtime-1",
    runtime_epoch: runtimeEpoch,
    tenant_id: "tenant-1",
    owner_user_id: "user-1",
    worker_pool_id: "pool-1",
    state: "READY" as const,
    profile_bundle_digest: "profile-1",
    endpoint_url: "http://runtime-host:3100",
    capability_manifest: {
      contract_name: "pc.runtime-capability-manifest/1" as const,
      contract_version: 1 as const,
      runtime_id: "runtime-1",
      runtime_epoch: runtimeEpoch,
      dsh_version: "0.2.1-rc.3",
      bridge_protocol_versions: ["1.0"],
      profile_digest: "profile-1",
      bundle_lock_digest: "bundle-1",
      plugin_releases: ["pc-runtime-bridge"],
      agent_presets: [],
      tool_provider_capabilities: [],
      persistence_capabilities: ["session-jsonl"],
      event_export_capabilities: ["catch-up"],
      approval_capabilities: [],
      resource_capabilities: [],
      limits: {},
      generated_at: "2026-11-10T00:00:00.000Z",
      manifest_digest: `manifest-${runtimeEpoch}`
    }
  };
}

function assignment() {
  return {
    tenant_id: "tenant-1",
    user_id: "user-1",
    pc_session_id: "session-1",
    runtime_id: "runtime-1",
    runtime_epoch: 1,
    lease_duration_ms: 60_000,
    effective_profile_snapshot_id: "profile-snapshot-1",
    workspace_view_snapshot_id: "workspace-view-1",
    authorization_revision: 1
  };
}

describe("RuntimeRegistryService", () => {
  it("uses two-phase Assignment activation and rejects concurrent ownership", async () => {
    const time = clock();
    const dispatcher = new FakeDispatcher();
    const service = new RuntimeRegistryService(
      new MemoryRuntimeRegistryRepository(),
      dispatcher,
      time.now
    );
    await service.initialize();
    await service.registerRuntime(registration());

    const assigned = await service.assignSession(assignment());
    expect(assigned.assignment).toMatchObject({
      state: "ACTIVE",
      assignment_generation: 1,
      fencing_token: "1",
      version: 2
    });
    expect(dispatcher.commands.map((command) => command.command_id)).toEqual([
      expect.stringMatching(/^assign:/u),
      expect.stringMatching(/^activate:/u)
    ]);
    expect(dispatcher.commands[0]?.payload).toMatchObject({
      assignment_state: "PENDING",
      authority_version: 1
    });
    expect(dispatcher.commands[1]?.payload).toMatchObject({
      assignment_state: "ACTIVE",
      authority_version: 2
    });

    await expect(service.assignSession(assignment())).rejects.toMatchObject<
      Partial<RuntimeRegistryError>
    >({
      code: "PC_RUNTIME_ASSIGNMENT_CONFLICT"
    });
  });

  it("renews one Lease by CAS, expires it, and fails guards closed", async () => {
    const time = clock();
    const service = new RuntimeRegistryService(
      new MemoryRuntimeRegistryRepository(),
      new FakeDispatcher(),
      time.now
    );
    await service.initialize();
    await service.registerRuntime(registration());
    const assigned = await service.assignSession(assignment());
    time.advance(1_000);

    const renewed = await service.renewAssignment({
      pc_session_id: assigned.assignment.pc_session_id,
      runtime_id: assigned.assignment.runtime_id,
      runtime_epoch: assigned.assignment.runtime_epoch,
      assignment_generation: assigned.assignment.assignment_generation,
      fencing_token: assigned.assignment.fencing_token,
      expected_version: assigned.assignment.version,
      lease_duration_ms: 120_000
    });
    expect(renewed.assignment.version).toBe(3);
    expect(renewed.assignment.last_renewed_at).toBe(time.now().toISOString());

    await expect(service.renewAssignment({
      pc_session_id: assigned.assignment.pc_session_id,
      runtime_id: assigned.assignment.runtime_id,
      runtime_epoch: assigned.assignment.runtime_epoch,
      assignment_generation: assigned.assignment.assignment_generation,
      fencing_token: assigned.assignment.fencing_token,
      expected_version: assigned.assignment.version,
      lease_duration_ms: 120_000
    })).rejects.toMatchObject<Partial<RuntimeRegistryError>>({
      code: "PC_RUNTIME_CAS_CONFLICT"
    });

    time.advance(121_000);
    const expired = await service.expireLeases();
    expect(expired).toHaveLength(1);
    expect(expired[0]?.state).toBe("EXPIRED");
    await expect(service.evaluateGuard({
      kind: "STEP",
      runtime_id: "runtime-1",
      runtime_epoch: 1,
      pc_session_id: "session-1",
      assignment_generation: 1,
      fencing_token: "1"
    })).resolves.toMatchObject({
      allowed: false,
      code: "PC_RUNTIME_ASSIGNMENT_EXPIRED"
    });
  });

  it("fences an old Runtime epoch and stale Assignment after replacement", async () => {
    const time = clock();
    const repository = new MemoryRuntimeRegistryRepository();
    const service = new RuntimeRegistryService(repository, new FakeDispatcher(), time.now);
    await service.initialize();
    const first = await service.registerRuntime(registration(1));
    const assigned = await service.assignSession(assignment());
    await service.registerRuntime({
      ...registration(2),
      expected_current_version: first.runtime.version
    });

    await expect(async () => service.recordHeartbeat({
        contract_name: "pc.runtime-health-report/1",
        contract_version: 1,
        runtime_id: "runtime-1",
        runtime_epoch: 1,
        report_seq: 1,
        liveness: "UP",
        readiness: "READY",
        capability_health: {},
        capacity_health: {},
        assignment_health: {},
        active_sessions: 1,
        active_turns: 0,
        inflight_tools: 0,
        pending_flushes: 0,
        observed_at: time.now().toISOString()
      }, first.runtime.version)).rejects.toMatchObject<Partial<RuntimeRegistryError>>({
      code: "PC_RUNTIME_EPOCH_STALE"
    });

    await expect(service.evaluateGuard({
      kind: "STEP",
      runtime_id: assigned.assignment.runtime_id,
      runtime_epoch: assigned.assignment.runtime_epoch,
      pc_session_id: assigned.assignment.pc_session_id,
      assignment_generation: assigned.assignment.assignment_generation,
      fencing_token: assigned.assignment.fencing_token
    })).resolves.toMatchObject({
      allowed: false,
      code: "PC_RUNTIME_EPOCH_STALE"
    });
  });

  it("releases authority only after Runtime revoke succeeds", async () => {
    const time = clock();
    const service = new RuntimeRegistryService(
      new MemoryRuntimeRegistryRepository(),
      new FakeDispatcher(),
      time.now
    );
    await service.initialize();
    await service.registerRuntime(registration());
    const assigned = await service.assignSession(assignment());
    const revoked = await service.revokeAssignment({
      pc_session_id: assigned.assignment.pc_session_id,
      expected_version: assigned.assignment.version,
      reason: "MIGRATION"
    });

    expect(revoked.assignment).toMatchObject({
      state: "RELEASED",
      version: 4
    });
    expect(await service.getSessionProjection("session-1")).toMatchObject({
      guard: {
        allowed: false,
        code: "PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE"
      }
    });
  });
});
