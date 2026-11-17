import { describe, expect, it } from "vitest";
import {
  ProfileCapabilityService,
  RuntimeRegistryService,
  type RuntimeCommandDispatcher
} from "@pc/application";
import type { RuntimeCapabilityManifest } from "@pc/domain";
import type {
  RuntimeCommand,
  RuntimeCommandResult
} from "@pc/runtime-adapter";
import {
  MemoryProfileCapabilityRepository,
  MemoryRuntimeRegistryRepository
} from "../src/index.js";

class FakeDispatcher implements RuntimeCommandDispatcher {
  execute(
    _runtime: unknown,
    command: RuntimeCommand
  ): Promise<RuntimeCommandResult> {
    return Promise.resolve({
      contract_name: "pc.runtime-command-result/1",
      contract_version: 1,
      command_id: command.command_id,
      accepted: true,
      committed: true,
      outcome_state: "KNOWN_SUCCESS",
      runtime_observation: {},
      completed_at: "2026-11-10T07:00:00.000Z"
    });
  }
}

function manifest(
  input: Partial<RuntimeCapabilityManifest> = {}
): RuntimeCapabilityManifest {
  return {
    contract_name: "pc.runtime-capability-manifest/1",
    contract_version: 1,
    runtime_id: "runtime-1",
    runtime_epoch: 1,
    dsh_version: "0.2.1-rc.3",
    bridge_protocol_versions: ["1.0"],
    profile_digest: "",
    bundle_lock_digest: "",
    plugin_releases: [],
    agent_presets: [],
    tool_provider_capabilities: [],
    persistence_capabilities: [],
    event_export_capabilities: [],
    approval_capabilities: [],
    resource_capabilities: [],
    limits: {},
    generated_at: "2026-11-10T07:00:00.000Z",
    manifest_digest: "manifest-1",
    ...input
  };
}

async function fixture() {
  const repository = new MemoryProfileCapabilityRepository();
  const service = new ProfileCapabilityService(
    repository,
    () => new Date("2026-11-10T07:00:00.000Z")
  );
  await service.initialize();
  const seeded = await service.seedFixedFoRelease();
  const assignment = await service.assignProfile(
    "principal-1",
    seeded.profile.profile_release_id
  );
  const compatibleManifest = manifest({
    profile_digest: seeded.profile.release_digest,
    bundle_lock_digest: seeded.profile.dependency_lock_digest,
    plugin_releases: [seeded.plugin.plugin_release_id]
  });
  return { service, seeded, assignment, compatibleManifest };
}

describe("DEV-05 fixed Profile and capability resolution", () => {
  it("re-seeds the fixed FO release without changing immutable content", async () => {
    const repository = new MemoryProfileCapabilityRepository();
    const firstService = new ProfileCapabilityService(
      repository,
      () => new Date("2026-11-10T07:00:00.000Z")
    );
    const restartedService = new ProfileCapabilityService(
      repository,
      () => new Date("2026-11-11T07:00:00.000Z")
    );
    await firstService.initialize();
    const first = await firstService.seedFixedFoRelease();
    const restarted = await restartedService.seedFixedFoRelease();

    expect(restarted).toEqual(first);
    expect(restarted.profile.published_at).toBe(
      "2026-11-10T00:00:00.000Z"
    );
  });

  it("produces an immutable and reproducible Effective Profile Snapshot", async () => {
    const { service, seeded, assignment, compatibleManifest } = await fixture();
    const input = {
      principal_id: "principal-1",
      pc_session_id: "session-1",
      requested_profile_release_id: seeded.profile.profile_release_id,
      authorization_revision: 2,
      model_selection: { provider: "configured", model: "runtime-default" },
      knowledge_view_refs: ["knowledge:session-1"],
      dsh_preset_ref: "process-copilot-runtime",
      runtime_manifest: compatibleManifest
    };
    const first = await service.resolveEffectiveProfile(input);
    const second = await service.resolveEffectiveProfile(input);

    expect(first.report.hard_failures).toEqual([]);
    expect(first.snapshot).toMatchObject({
      profile_release_id: seeded.profile.profile_release_id,
      profile_assignment_ids: [assignment.profile_assignment_id],
      authorization_revision: 2,
      tool_release_ids: [seeded.tool.tool_release_id],
      plugin_release_ids: [seeded.plugin.plugin_release_id]
    });
    expect(first.snapshot?.snapshot_digest).toBe(
      second.snapshot?.snapshot_digest
    );
    expect(Object.isFrozen(first.snapshot)).toBe(true);
    await expect(service.assertRuntimeAdmission({
      effective_profile_snapshot_id:
        first.snapshot?.effective_profile_snapshot_id ?? "",
      runtime_manifest: compatibleManifest
    })).resolves.toBeUndefined();
  });

  it("fails closed for incompatible Runtime capability", async () => {
    const { service, seeded, compatibleManifest } = await fixture();
    const resolved = await service.resolveEffectiveProfile({
      principal_id: "principal-1",
      pc_session_id: "session-2",
      requested_profile_release_id: seeded.profile.profile_release_id,
      authorization_revision: 2,
      model_selection: {},
      knowledge_view_refs: [],
      dsh_preset_ref: "process-copilot-runtime",
      runtime_manifest: {
        ...compatibleManifest,
        dsh_version: "0.2.0"
      }
    });
    expect(resolved.snapshot).toBeUndefined();
    expect(resolved.report.hard_failures).toContain(
      "runtime_capability_incompatible"
    );
  });

  it("prevents revoked releases from creating new snapshots", async () => {
    const { service, seeded, compatibleManifest } = await fixture();
    await service.transitionProfileRelease(
      seeded.profile.profile_release_id,
      "PUBLISHED",
      "REVOKED"
    );
    const resolved = await service.resolveEffectiveProfile({
      principal_id: "principal-1",
      pc_session_id: "session-3",
      requested_profile_release_id: seeded.profile.profile_release_id,
      authorization_revision: 2,
      model_selection: {},
      knowledge_view_refs: [],
      dsh_preset_ref: "process-copilot-runtime",
      runtime_manifest: compatibleManifest
    });
    expect(resolved.snapshot).toBeUndefined();
    expect(resolved.report.hard_failures).toContain("profile_release_revoked");
  });

  it("blocks DEV-04 Assignment before dispatch when the Runtime profile drifts", async () => {
    const { service, seeded, compatibleManifest } = await fixture();
    const resolved = await service.resolveEffectiveProfile({
      principal_id: "principal-1",
      pc_session_id: "session-admission",
      requested_profile_release_id: seeded.profile.profile_release_id,
      authorization_revision: 2,
      model_selection: {},
      knowledge_view_refs: [],
      dsh_preset_ref: "process-copilot-runtime",
      runtime_manifest: compatibleManifest
    });
    const repository = new MemoryRuntimeRegistryRepository();
    const registry = new RuntimeRegistryService(
      repository,
      new FakeDispatcher(),
      () => new Date("2026-11-10T07:00:00.000Z"),
      service
    );
    await registry.initialize();
    await registry.registerRuntime({
      runtime_id: "runtime-drifted",
      runtime_epoch: 1,
      tenant_id: "tenant-1",
      owner_user_id: "principal-1",
      worker_pool_id: "pool-1",
      state: "READY",
      profile_bundle_digest: "drifted-profile",
      endpoint_url: "http://runtime.invalid",
      capability_manifest: {
        ...compatibleManifest,
        runtime_id: "runtime-drifted",
        profile_digest: "drifted-profile",
        manifest_digest: "manifest-drifted"
      }
    });

    await expect(registry.assignSession({
      tenant_id: "tenant-1",
      user_id: "principal-1",
      pc_session_id: "session-admission",
      runtime_id: "runtime-drifted",
      runtime_epoch: 1,
      lease_duration_ms: 60_000,
      effective_profile_snapshot_id:
        resolved.snapshot?.effective_profile_snapshot_id ?? "",
      workspace_view_snapshot_id: "workspace-1",
      authorization_revision: 2
    })).rejects.toMatchObject({ code: "PC_PROFILE_RUNTIME_INCOMPATIBLE" });
    await expect(
      repository.getCurrentAssignment("session-admission")
    ).resolves.toBeUndefined();
  });
});
