import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalImmutableBlobStore,
  LocalWorkspaceMaterializer,
  ResourceWorkspaceService
} from "@pc/resource";
import { MemoryResourceRepository } from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pc-resource-"));
  temporaryRoots.push(root);
  const repository = new MemoryResourceRepository();
  const service = new ResourceWorkspaceService(
    repository,
    new LocalImmutableBlobStore(path.join(root, "blobs")),
    new LocalWorkspaceMaterializer(path.join(root, "materializations")),
    undefined,
    () => new Date("2026-11-10T08:00:00.000Z")
  );
  await service.initialize();
  return { root, repository, service };
}

describe("ResourceWorkspaceService", () => {
  it("materializes only exact ResourceVersions whitelisted by one Session view", async () => {
    const { service, repository } = await fixture();
    const uploaded = await service.uploadResource({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      pc_session_id: "session_1",
      kind: "UPLOAD",
      display_name: "requirements.txt",
      classification: "INTERNAL",
      owner_scope: { scope_type: "SESSION", scope_id: "session_1" },
      media_type: "text/plain",
      content: Buffer.from("requirement A"),
      provenance: {
        source_system: "browser-upload",
        acquisition_operation: "upload"
      }
    });
    const binding = await service.createBinding({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      pc_session_id: "session_1",
      resource_id: uploaded.resource.resource_id,
      scope: { scope_type: "SESSION", scope_id: "session_1" },
      allowed_actions: ["READ"]
    });
    const view = await service.createWorkspaceView({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      pc_session_id: "session_1",
      authorization_revision: 3,
      binding_ids: [binding.binding_id],
      allowed_actions: ["READ"],
      ttl_seconds: 3600
    });
    const result = await service.materialize({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      workspace_view_snapshot_id: view.workspace_view_snapshot_id,
      resource_refs: [{
        resource_id: uploaded.resource.resource_id,
        resource_version_id: uploaded.version.resource_version_id
      }],
      purpose: "RUNTIME_INPUT",
      target_runtime_id: "runtime_1",
      target_runtime_epoch: 1,
      pc_session_id: "session_1",
      ttl_seconds: 600,
      allowed_actions: ["READ"]
    });

    expect(result).toMatchObject({
      state: "READY",
      mount_ref: expect.stringMatching(/^materialization:/u),
      materialized_entries: [{
        resource_id: uploaded.resource.resource_id,
        resource_version_id: uploaded.version.resource_version_id,
        mode: "READ_ONLY"
      }]
    });
    expect(JSON.stringify(result)).not.toContain("pc-resource-");
    const internal = await repository.getMaterialization(result.materialization_id);
    const relativePath = result.materialized_entries[0]?.relative_path ?? "";
    expect(
      await readFile(path.join(internal?.internal_root ?? "", relativePath), "utf8")
    ).toBe("requirement A");
    await expect(service.assertWorkspaceAdmission({
      workspace_view_snapshot_id: view.workspace_view_snapshot_id,
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      pc_session_id: "session_1",
      authorization_revision: 3,
      runtime_id: "runtime_1",
      runtime_epoch: 1
    })).resolves.toMatchObject({
      materialization_id: result.materialization_id,
      mount_ref: result.mount_ref
    });
    await expect(service.assertWorkspaceAdmission({
      workspace_view_snapshot_id: view.workspace_view_snapshot_id,
      tenant_id: "tenant_1",
      principal_id: "principal_2",
      pc_session_id: "session_1",
      authorization_revision: 3,
      runtime_id: "runtime_1",
      runtime_epoch: 1
    })).rejects.toMatchObject({
      code: "PC_RESOURCE_WORKSPACE_VIEW_SCOPE_MISMATCH"
    });
  });

  it("keeps WORKSPACE_FILE versions immutable and rejects stale CAS", async () => {
    const { service } = await fixture();
    const uploaded = await service.uploadResource({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      kind: "WORKSPACE_FILE",
      display_name: "draft.md",
      classification: "CONFIDENTIAL",
      owner_scope: { scope_type: "USER_ROOT", scope_id: "principal_1" },
      media_type: "text/markdown",
      content: Buffer.from("v1"),
      provenance: {
        source_system: "workspace",
        acquisition_operation: "create"
      }
    });
    const second = await service.createVersion({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      resource_id: uploaded.resource.resource_id,
      expected_version_id: uploaded.version.resource_version_id,
      media_type: "text/markdown",
      content: Buffer.from("v2"),
      provenance: {
        source_system: "workspace",
        acquisition_operation: "edit"
      }
    });
    expect(second.version.version_seq).toBe(2);
    await expect(service.createVersion({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      resource_id: uploaded.resource.resource_id,
      expected_version_id: uploaded.version.resource_version_id,
      media_type: "text/markdown",
      content: Buffer.from("stale"),
      provenance: {
        source_system: "workspace",
        acquisition_operation: "edit"
      }
    })).rejects.toMatchObject({
      code: "PC_RESOURCE_VERSION_CONFLICT"
    });
    const projection = await service.getResourceProjection(
      uploaded.resource.resource_id
    );
    expect(projection.versions.map((version) => version.content_digest)).toHaveLength(2);
    expect(projection.audit.every((entry) =>
      !JSON.stringify(entry).includes("stale")
    )).toBe(true);
  });

  it("preserves derived provenance, fails project scope closed, and cleans expired roots", async () => {
    let now = new Date("2026-11-10T08:00:00.000Z");
    const root = await mkdtemp(path.join(os.tmpdir(), "pc-resource-"));
    temporaryRoots.push(root);
    const repository = new MemoryResourceRepository();
    const service = new ResourceWorkspaceService(
      repository,
      new LocalImmutableBlobStore(path.join(root, "blobs")),
      new LocalWorkspaceMaterializer(path.join(root, "materializations")),
      undefined,
      () => new Date(now)
    );
    await service.initialize();
    const source = await service.uploadResource({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      kind: "UPLOAD",
      display_name: "source.txt",
      classification: "INTERNAL",
      owner_scope: { scope_type: "USER_ROOT", scope_id: "principal_1" },
      media_type: "text/plain",
      content: Buffer.from("source"),
      provenance: {
        source_system: "browser-upload",
        acquisition_operation: "upload"
      }
    });
    const derived = await service.createDerivedResource({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      display_name: "derived.txt",
      classification: "INTERNAL",
      owner_scope: { scope_type: "USER_ROOT", scope_id: "principal_1" },
      media_type: "text/plain",
      content: Buffer.from("derived"),
      derived_from: [{
        resource_id: source.resource.resource_id,
        resource_version_id: source.version.resource_version_id
      }],
      acquisition_operation: "extract"
    });
    expect(derived.version.provenance.derived_from).toEqual([{
      resource_id: source.resource.resource_id,
      resource_version_id: source.version.resource_version_id
    }]);
    await expect(service.createBinding({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      resource_id: source.resource.resource_id,
      scope: { scope_type: "PROJECT", scope_id: "project_1" },
      allowed_actions: ["READ"]
    })).rejects.toMatchObject({ code: "PC_RESOURCE_SCOPE_DENIED" });

    const binding = await service.createBinding({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      resource_id: source.resource.resource_id,
      scope: { scope_type: "USER_ROOT", scope_id: "principal_1" },
      allowed_actions: ["READ"]
    });
    const view = await service.createWorkspaceView({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      pc_session_id: "session_1",
      authorization_revision: 1,
      binding_ids: [binding.binding_id],
      allowed_actions: ["READ"]
    });
    const result = await service.materialize({
      tenant_id: "tenant_1",
      principal_id: "principal_1",
      workspace_view_snapshot_id: view.workspace_view_snapshot_id,
      resource_refs: [{
        resource_id: source.resource.resource_id,
        resource_version_id: source.version.resource_version_id
      }],
      purpose: "RUNTIME_INPUT",
      target_runtime_id: "runtime_1",
      target_runtime_epoch: 1,
      pc_session_id: "session_1",
      ttl_seconds: 1,
      allowed_actions: ["READ"]
    });
    const record = await repository.getMaterialization(result.materialization_id);
    expect((await stat(record?.internal_root ?? "")).isDirectory()).toBe(true);
    now = new Date(now.getTime() + 2_000);
    const cleaned = await service.cleanupExpired();
    expect(cleaned).toMatchObject([{ cleanup_state: "CLEANED", state: "CLEANED" }]);
    await expect(stat(record?.internal_root ?? "")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects untyped path components before creating a materialization root", async () => {
    const { service } = await fixture();
    const uploaded = await service.uploadResource({
      tenant_id: "tenant_1",
      principal_id: "../principal",
      kind: "UPLOAD",
      display_name: "input.txt",
      classification: "INTERNAL",
      owner_scope: { scope_type: "USER_ROOT", scope_id: "../principal" },
      media_type: "text/plain",
      content: Buffer.from("private"),
      provenance: {
        source_system: "browser-upload",
        acquisition_operation: "upload"
      }
    });
    const binding = await service.createBinding({
      tenant_id: "tenant_1",
      principal_id: "../principal",
      resource_id: uploaded.resource.resource_id,
      scope: { scope_type: "USER_ROOT", scope_id: "../principal" },
      allowed_actions: ["READ"]
    });
    const view = await service.createWorkspaceView({
      tenant_id: "tenant_1",
      principal_id: "../principal",
      pc_session_id: "session_1",
      authorization_revision: 1,
      binding_ids: [binding.binding_id],
      allowed_actions: ["READ"]
    });
    await expect(service.materialize({
      tenant_id: "tenant_1",
      principal_id: "../principal",
      workspace_view_snapshot_id: view.workspace_view_snapshot_id,
      resource_refs: [{
        resource_id: uploaded.resource.resource_id,
        resource_version_id: uploaded.version.resource_version_id
      }],
      purpose: "RUNTIME_INPUT",
      target_runtime_id: "runtime_1",
      target_runtime_epoch: 1,
      pc_session_id: "session_1",
      ttl_seconds: 60,
      allowed_actions: ["READ"]
    })).rejects.toMatchObject({
      code: "PC_RESOURCE_PATH_COMPONENT_INVALID"
    });
  });
});
