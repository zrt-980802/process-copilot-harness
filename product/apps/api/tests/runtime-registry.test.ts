import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  RuntimeRegistryService,
  type RuntimeCommandDispatcher
} from "@pc/application";
import { MemoryRuntimeRegistryRepository } from "@pc/persistence";
import type {
  RuntimeCommand,
  RuntimeCommandResult
} from "@pc/runtime-adapter";
import { buildApiServer } from "../src/server.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

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

function registration() {
  return {
    runtime_id: "runtime-api-1",
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
      runtime_id: "runtime-api-1",
      runtime_epoch: 1,
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
      manifest_digest: "manifest-1"
    }
  };
}

describe("Runtime Registry API", () => {
  it("publishes authoritative Runtime and Session execution projections", async () => {
    const registry = new RuntimeRegistryService(
      new MemoryRuntimeRegistryRepository(),
      new FakeDispatcher()
    );
    await registry.initialize();
    const server = buildApiServer({
      runtimeRegistry: registry,
      databaseConfigured: false
    });
    servers.push(server);

    const registered = await server.inject({
      method: "POST",
      url: "/v1/runtimes/register",
      payload: registration()
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json()).toMatchObject({
      runtime: {
        runtime_id: "runtime-api-1",
        state: "READY",
        version: 1
      }
    });

    const assigned = await server.inject({
      method: "POST",
      url: "/v1/session-assignments",
      payload: {
        tenant_id: "tenant-1",
        user_id: "user-1",
        pc_session_id: "session-api-1",
        runtime_id: "runtime-api-1",
        runtime_epoch: 1,
        lease_duration_ms: 60_000,
        effective_profile_snapshot_id: "profile-snapshot-1",
        workspace_view_snapshot_id: "workspace-view-1",
        authorization_revision: 1
      }
    });
    expect(assigned.statusCode).toBe(201);
    const assignment = assigned.json().assignment as {
      assignment_generation: number;
      fencing_token: string;
    };

    const projection = await server.inject({
      method: "GET",
      url: "/v1/sessions/session-api-1/execution"
    });
    expect(projection.statusCode).toBe(200);
    expect(projection.json()).toMatchObject({
      assignment: {
        state: "ACTIVE",
        assignment_generation: assignment.assignment_generation,
        fencing_token: assignment.fencing_token
      },
      guard: {
        allowed: true,
        code: "PC_RUNTIME_GUARD_ALLOWED"
      }
    });

    const stale = await server.inject({
      method: "POST",
      url: "/v1/runtime-guards/evaluate",
      payload: {
        kind: "TOOL",
        runtime_id: "runtime-api-1",
        runtime_epoch: 1,
        pc_session_id: "session-api-1",
        assignment_generation: assignment.assignment_generation,
        fencing_token: "stale",
        tool_call_id: "tool-call-1"
      }
    });
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({
      allowed: false,
      code: "PC_RUNTIME_FENCE_STALE"
    });
  });
});
