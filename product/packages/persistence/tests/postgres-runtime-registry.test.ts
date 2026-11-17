import { describe, expect, it } from "vitest";
import {
  RuntimeRegistryService,
  type RuntimeCommandDispatcher
} from "@pc/application";
import type {
  RuntimeCommand,
  RuntimeCommandResult
} from "@pc/runtime-adapter";
import { PostgresRuntimeRegistryRepository } from "../src/index.js";

const databaseUrl = process.env.PC_TEST_POSTGRES_URL;

class FakeDispatcher implements RuntimeCommandDispatcher {
  execute(_runtime: unknown, command: RuntimeCommand): Promise<RuntimeCommandResult> {
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

describe.skipIf(databaseUrl === undefined)("Postgres Runtime Registry", () => {
  it("serializes competing Session Assignment creation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const repository = new PostgresRuntimeRegistryRepository(databaseUrl as string);
    const service = new RuntimeRegistryService(repository, new FakeDispatcher());
    await service.initialize();
    try {
      await service.registerRuntime({
        runtime_id: `runtime-${suffix}`,
        runtime_epoch: 1,
        tenant_id: "tenant-1",
        owner_user_id: "user-1",
        worker_pool_id: "pool-1",
        state: "READY",
        profile_bundle_digest: "profile-1",
        endpoint_url: "http://runtime-host:3100",
        capability_manifest: {
          contract_name: "pc.runtime-capability-manifest/1",
          contract_version: 1,
          runtime_id: `runtime-${suffix}`,
          runtime_epoch: 1,
          dsh_version: "0.2.1-rc.3",
          bridge_protocol_versions: ["1.0"],
          profile_digest: "profile-1",
          bundle_lock_digest: "bundle-1",
          plugin_releases: [],
          agent_presets: [],
          tool_provider_capabilities: [],
          persistence_capabilities: [],
          event_export_capabilities: [],
          approval_capabilities: [],
          resource_capabilities: [],
          limits: {},
          generated_at: new Date().toISOString(),
          manifest_digest: `manifest-${suffix}`
        }
      });
      const input = {
        tenant_id: "tenant-1",
        user_id: "user-1",
        pc_session_id: `session-${suffix}`,
        runtime_id: `runtime-${suffix}`,
        runtime_epoch: 1,
        lease_duration_ms: 60_000,
        effective_profile_snapshot_id: "profile-snapshot-1",
        workspace_view_snapshot_id: "workspace-view-1",
        authorization_revision: 1
      };
      const results = await Promise.allSettled([
        service.assignSession(input),
        service.assignSession(input)
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: {
          code: "PC_RUNTIME_ASSIGNMENT_CONFLICT"
        }
      });
    } finally {
      await service.close();
    }
  });
});
