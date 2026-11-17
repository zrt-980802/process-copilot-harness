import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  IdentityAuthorizationService,
  RuntimeRegistryService,
  type RuntimeCommandDispatcher
} from "@pc/application";
import {
  MemoryIdentityAuthorizationRepository,
  MemoryResourceRepository,
  MemoryRuntimeRegistryRepository
} from "@pc/persistence";
import {
  LocalImmutableBlobStore,
  LocalWorkspaceMaterializer,
  ResourceWorkspaceService
} from "@pc/resource";
import type {
  RuntimeCommand,
  RuntimeCommandResult
} from "@pc/runtime-adapter";
import { buildApiServer } from "../src/server.js";

const servers: FastifyInstance[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
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
      completed_at: "2026-11-10T09:00:00.000Z"
    });
  }
}

describe("Resource and Workspace API", () => {
  it("binds authenticated uploads to one Session and gates Runtime Assignment", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pc-resource-api-"));
    roots.push(root);
    const identity = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      "resource-api-signing-key-0000000000000000",
      [],
      () => new Date("2026-11-10T09:00:00.000Z")
    );
    const resource = new ResourceWorkspaceService(
      new MemoryResourceRepository(),
      new LocalImmutableBlobStore(path.join(root, "blobs")),
      new LocalWorkspaceMaterializer(path.join(root, "materializations")),
      undefined,
      () => new Date("2026-11-10T09:00:00.000Z")
    );
    const registry = new RuntimeRegistryService(
      new MemoryRuntimeRegistryRepository(),
      new FakeDispatcher(),
      () => new Date("2026-11-10T09:00:00.000Z"),
      undefined,
      resource
    );
    await Promise.all([
      identity.initialize(),
      resource.initialize(),
      registry.initialize()
    ]);
    const first = await identity.provisionPilotAccount({
      tenant_id: "tenant_api",
      account_key: "resource.first",
      secret: "ResourceSecret123"
    });
    await identity.provisionPilotAccount({
      tenant_id: "tenant_api",
      account_key: "resource.second",
      secret: "ResourceSecret456"
    });
    const firstSignIn = await identity.signInPilot(
      "tenant_api",
      "resource.first",
      "ResourceSecret123"
    );
    const secondSignIn = await identity.signInPilot(
      "tenant_api",
      "resource.second",
      "ResourceSecret456"
    );
    const server = buildApiServer({
      identityAuthorization: identity,
      resourceWorkspace: resource,
      runtimeRegistry: registry
    });
    servers.push(server);

    const upload = await server.inject({
      method: "POST",
      url: "/v1/resources/uploads",
      headers: { authorization: `Bearer ${firstSignIn.access_token}` },
      payload: {
        pc_session_id: "session_api_1",
        kind: "UPLOAD",
        display_name: "input.txt",
        classification: "INTERNAL",
        owner_scope: {
          scope_type: "SESSION",
          scope_id: "session_api_1"
        },
        media_type: "text/plain",
        content_base64: Buffer.from("session private").toString("base64"),
        provenance: {
          source_system: "browser-upload",
          acquisition_operation: "upload"
        }
      }
    });
    expect(upload.statusCode).toBe(201);
    const resourceId = upload.json().resource.resource_id as string;
    const versionId = upload.json().version.resource_version_id as string;

    const deniedProjection = await server.inject({
      method: "GET",
      url: `/v1/resources/${resourceId}`,
      headers: { authorization: `Bearer ${secondSignIn.access_token}` }
    });
    expect(deniedProjection.statusCode).toBe(404);
    expect(deniedProjection.json().error.code).toBe("PC_RESOURCE_NOT_FOUND");
    const absentProjection = await server.inject({ method: "GET", url: "/v1/resources/absent-resource",
      headers: { authorization: `Bearer ${secondSignIn.access_token}` } });
    expect(absentProjection.statusCode).toBe(deniedProjection.statusCode);
    expect(absentProjection.json()).toEqual(deniedProjection.json());

    const binding = await server.inject({
      method: "POST",
      url: "/v1/resource-bindings",
      headers: { authorization: `Bearer ${firstSignIn.access_token}` },
      payload: {
        pc_session_id: "session_api_1",
        resource_id: resourceId,
        scope: {
          scope_type: "SESSION",
          scope_id: "session_api_1"
        },
        allowed_actions: ["READ"]
      }
    });
    expect(binding.statusCode).toBe(201);

    const view = await server.inject({
      method: "POST",
      url: "/v1/workspace-view-snapshots",
      headers: { authorization: `Bearer ${firstSignIn.access_token}` },
      payload: {
        pc_session_id: "session_api_1",
        authorization_revision: first.principal.authorization_revision,
        binding_ids: [binding.json().binding_id],
        allowed_actions: ["READ"],
        ttl_seconds: 3600
      }
    });
    expect(view.statusCode).toBe(201);
    const snapshotId = view.json().workspace_view_snapshot_id as string;

    await registry.registerRuntime({
      runtime_id: "runtime_api_1",
      runtime_epoch: 1,
      tenant_id: "tenant_api",
      owner_user_id: first.principal.principal_id,
      worker_pool_id: "pool_1",
      state: "READY",
      profile_bundle_digest: "profile_1",
      endpoint_url: "http://runtime-host:3100",
      capability_manifest: {
        contract_name: "pc.runtime-capability-manifest/1",
        contract_version: 1,
        runtime_id: "runtime_api_1",
        runtime_epoch: 1,
        dsh_version: "0.2.1-rc.3",
        bridge_protocol_versions: ["1.0"],
        profile_digest: "profile_1",
        bundle_lock_digest: "bundle_1",
        plugin_releases: [],
        agent_presets: [],
        tool_provider_capabilities: [],
        persistence_capabilities: [],
        event_export_capabilities: [],
        approval_capabilities: [],
        resource_capabilities: ["workspace-view-v1"],
        limits: {},
        generated_at: "2026-11-10T09:00:00.000Z",
        manifest_digest: "manifest_1"
      }
    });

    const beforeMaterialization = await server.inject({
      method: "POST",
      url: "/v1/session-assignments",
      payload: {
        tenant_id: "tenant_api",
        user_id: first.principal.principal_id,
        pc_session_id: "session_api_1",
        runtime_id: "runtime_api_1",
        runtime_epoch: 1,
        lease_duration_ms: 60_000,
        effective_profile_snapshot_id: "profile_snapshot_1",
        workspace_view_snapshot_id: snapshotId,
        authorization_revision: first.principal.authorization_revision
      }
    });
    expect(beforeMaterialization.statusCode).toBe(403);
    expect(beforeMaterialization.json().error.code).toBe(
      "PC_RESOURCE_MATERIALIZATION_REQUIRED"
    );

    const materialization = await server.inject({
      method: "POST",
      url: "/v1/materializations",
      headers: { authorization: `Bearer ${firstSignIn.access_token}` },
      payload: {
        workspace_view_snapshot_id: snapshotId,
        resource_refs: [{
          resource_id: resourceId,
          resource_version_id: versionId
        }],
        purpose: "RUNTIME_INPUT",
        target_runtime_id: "runtime_api_1",
        target_runtime_epoch: 1,
        pc_session_id: "session_api_1",
        ttl_seconds: 600,
        allowed_actions: ["READ"]
      }
    });
    expect(materialization.statusCode).toBe(201);
    expect(JSON.stringify(materialization.json())).not.toContain(root);

    const assigned = await server.inject({
      method: "POST",
      url: "/v1/session-assignments",
      payload: {
        tenant_id: "tenant_api",
        user_id: first.principal.principal_id,
        pc_session_id: "session_api_1",
        runtime_id: "runtime_api_1",
        runtime_epoch: 1,
        lease_duration_ms: 60_000,
        effective_profile_snapshot_id: "profile_snapshot_1",
        workspace_view_snapshot_id: snapshotId,
        authorization_revision: first.principal.authorization_revision
      }
    });
    expect(assigned.statusCode).toBe(201);
    expect(assigned.json().assignment).toMatchObject({
      state: "ACTIVE",
      workspace_view_snapshot_id: snapshotId
    });
  });
});
