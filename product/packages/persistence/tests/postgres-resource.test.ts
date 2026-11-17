import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalImmutableBlobStore,
  LocalWorkspaceMaterializer,
  ResourceWorkspaceService
} from "@pc/resource";
import { PostgresResourceRepository } from "../src/index.js";

const databaseUrl = process.env.PC_TEST_POSTGRES_URL;

describe.skipIf(databaseUrl === undefined)(
  "Postgres Resource and Workspace authority",
  () => {
    it("persists immutable versions, views and Runtime admission across restart", async () => {
      const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const root = await mkdtemp(path.join(os.tmpdir(), "pc-resource-pg-"));
      let now = new Date("2026-11-10T10:00:00.000Z");
      const createService = () => new ResourceWorkspaceService(
        new PostgresResourceRepository(databaseUrl as string),
        new LocalImmutableBlobStore(path.join(root, "blobs")),
        new LocalWorkspaceMaterializer(path.join(root, "materializations")),
        undefined,
        () => new Date(now)
      );
      const first = createService();
      await first.initialize();
      try {
        const principalId = `principal_${suffix}`;
        const sessionId = `session_${suffix}`;
        const runtimeId = `runtime_${suffix}`;
        const uploaded = await first.uploadResource({
          tenant_id: `tenant_${suffix}`,
          principal_id: principalId,
          pc_session_id: sessionId,
          kind: "UPLOAD",
          display_name: "persistent.txt",
          classification: "INTERNAL",
          owner_scope: { scope_type: "SESSION", scope_id: sessionId },
          media_type: "text/plain",
          content: Buffer.from("persistent content"),
          provenance: {
            source_system: "postgres-test",
            acquisition_operation: "upload"
          }
        });
        const binding = await first.createBinding({
          tenant_id: `tenant_${suffix}`,
          principal_id: principalId,
          pc_session_id: sessionId,
          resource_id: uploaded.resource.resource_id,
          scope: { scope_type: "SESSION", scope_id: sessionId },
          allowed_actions: ["READ"]
        });
        const view = await first.createWorkspaceView({
          tenant_id: `tenant_${suffix}`,
          principal_id: principalId,
          pc_session_id: sessionId,
          authorization_revision: 7,
          binding_ids: [binding.binding_id],
          allowed_actions: ["READ"]
        });
        await first.materialize({
          tenant_id: `tenant_${suffix}`,
          principal_id: principalId,
          workspace_view_snapshot_id: view.workspace_view_snapshot_id,
          resource_refs: [{
            resource_id: uploaded.resource.resource_id,
            resource_version_id: uploaded.version.resource_version_id
          }],
          purpose: "RUNTIME_INPUT",
          target_runtime_id: runtimeId,
          target_runtime_epoch: 1,
          pc_session_id: sessionId,
          ttl_seconds: 60,
          allowed_actions: ["READ"]
        });
        await first.close();

        const restarted = createService();
        await restarted.initialize();
        try {
          await expect(restarted.assertWorkspaceAdmission({
            workspace_view_snapshot_id: view.workspace_view_snapshot_id,
            tenant_id: `tenant_${suffix}`,
            principal_id: principalId,
            pc_session_id: sessionId,
            authorization_revision: 7,
            runtime_id: runtimeId,
            runtime_epoch: 1
          })).resolves.toMatchObject({
            mount_ref: expect.stringMatching(/^materialization:/u)
          });
          const projection = await restarted.getResourceProjection(
            uploaded.resource.resource_id
          );
          expect(projection).toMatchObject({
            resource: {
              current_version_id: uploaded.version.resource_version_id
            },
            versions: [{ content_digest: uploaded.version.content_digest }],
            bindings: [{ binding_id: binding.binding_id }]
          });
          now = new Date(now.getTime() + 61_000);
          await expect(restarted.cleanupExpired()).resolves.toMatchObject([
            { state: "CLEANED", cleanup_state: "CLEANED" }
          ]);
        } finally {
          await restarted.close();
        }
      } finally {
        await first.close().catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    });
  }
);
