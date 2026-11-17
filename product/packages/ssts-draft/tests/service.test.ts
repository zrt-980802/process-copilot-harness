import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProfileCapabilityService } from "../../application/src/index.js";
import { EventProjectionService } from "../../event-projection/src/index.js";
import {
  MemoryEventProjectionRepository,
  MemoryProfileCapabilityRepository,
  MemoryResourceRepository,
  MemorySstsDraftRepository
} from "../../persistence/src/index.js";
import {
  LocalImmutableBlobStore,
  LocalWorkspaceMaterializer,
  ResourceWorkspaceService
} from "../../resource/src/index.js";
import {
  DeterministicSstsDraftEngine,
  SstsDraftService
} from "../src/index.js";
import type { SstsDraftError } from "../src/index.js";

describe("SstsDraftService", () => {
  it("completes an immutable, cited and idempotent Draft lifecycle", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pc-ssts-memory-"));
    const now = () => new Date("2026-11-10T18:00:00.000Z");
    const profiles = new ProfileCapabilityService(
      new MemoryProfileCapabilityRepository(),
      now
    );
    const resources = new ResourceWorkspaceService(
      new MemoryResourceRepository(),
      new LocalImmutableBlobStore(path.join(root, "blobs")),
      new LocalWorkspaceMaterializer(path.join(root, "materializations")),
      undefined,
      now
    );
    const events = new EventProjectionService(
      new MemoryEventProjectionRepository(),
      undefined,
      undefined,
      undefined,
      undefined,
      now
    );
    const repository = new MemorySstsDraftRepository();
    const service = new SstsDraftService(
      repository,
      profiles,
      resources,
      events,
      new DeterministicSstsDraftEngine(),
      now
    );
    await Promise.all([
      profiles.initialize(),
      resources.initialize(),
      events.initialize(),
      service.initialize()
    ]);
    try {
      await profiles.seedFixedFoRelease();
      const prd = await resources.uploadResource({
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        kind: "UPLOAD",
        display_name: "prd.md",
        classification: "INTERNAL",
        owner_scope: {
          scope_type: "USER_ROOT",
          scope_id: "principal-ssts"
        },
        media_type: "text/markdown",
        content: Buffer.from("# PRD\nPayment reconciliation requirements."),
        provenance: {
          source_system: "test",
          acquisition_operation: "upload-prd"
        }
      });
      const architecture = await resources.uploadResource({
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        kind: "UPLOAD",
        display_name: "architecture.md",
        classification: "INTERNAL",
        owner_scope: {
          scope_type: "USER_ROOT",
          scope_id: "principal-ssts"
        },
        media_type: "text/markdown",
        content: Buffer.from("# Architecture\nUse explicit durable boundaries."),
        provenance: {
          source_system: "test",
          acquisition_operation: "upload-architecture"
        }
      });
      const workspace = await service.createWorkspace({
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        title: "Payment SSTS"
      });

      await expect(service.generateDraft({
        workspace_id: workspace.workspace_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        idempotency_key: "generation-missing"
      })).rejects.toMatchObject<SstsDraftError>({
        code: "PC_SSTS_INPUTS_INCOMPLETE"
      });

      await service.attachInput({
        workspace_id: workspace.workspace_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        slot: "PRD",
        resource_id: prd.resource.resource_id,
        resource_version_id: prd.version.resource_version_id
      });
      await service.attachInput({
        workspace_id: workspace.workspace_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        slot: "ARCHITECTURE",
        resource_id: architecture.resource.resource_id,
        resource_version_id: architecture.version.resource_version_id
      });
      await service.appendMessage({
        workspace_id: workspace.workspace_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        content: "Keep the verification section explicit."
      });

      const active = (await repository.getWorkspace(workspace.workspace_id))!;
      const operationId = "interrupted-read-generation";
      if ((await events.getTask(active.business_task_id))?.state === "DRAFT") {
        await events.transitionTask({ business_task_id: active.business_task_id, tenant_id: active.tenant_id,
          principal_id: active.owner_principal_id, state: "READY", reason_codes: ["inputs_complete"] });
      }
      await events.transitionTask({ business_task_id: active.business_task_id, tenant_id: active.tenant_id,
        principal_id: active.owner_principal_id, state: "RUNNING", reason_codes: ["generation"] });
      await events.planOperation({ operation_id: operationId, business_task_id: active.business_task_id,
        tenant_id: active.tenant_id, principal_id: active.owner_principal_id,
        operation_kind: "READ", recovery_class: "REPLAY_SAFE", input_digest: "sha256:interrupted", evidence_refs: [] });
      await events.transitionOperation({ operation_id: operationId, tenant_id: active.tenant_id,
        principal_id: active.owner_principal_id, state: "DISPATCHING", evidence_refs: [] });
      await events.transitionOperation({ operation_id: operationId, tenant_id: active.tenant_id,
        principal_id: active.owner_principal_id, state: "DISPATCHED", evidence_refs: [] });
      await repository.createGeneration({ generation_id: "interrupted", workspace_id: active.workspace_id,
        business_operation_id: operationId, idempotency_key: "abandoned", input_digest: "sha256:interrupted",
        state: "IN_PROGRESS", created_at: now().toISOString(), updated_at: now().toISOString() });
      await repository.updateWorkspace({ ...active, state: "GENERATING", version: active.version + 1 }, active.version);
      await service.initialize();
      expect((await repository.findGeneration(active.workspace_id, "abandoned"))?.failure_code).toBe("PC_SSTS_EXECUTOR_RESTARTED");
      expect((await repository.getWorkspace(active.workspace_id))?.state).toBe("GENERATION_FAILED");
      expect((await events.getTask(active.business_task_id))?.state).toBe("FAILED");

      const first = await service.generateDraft({
        workspace_id: workspace.workspace_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        idempotency_key: "generation-1"
      });
      expect(first.workspace.state).toBe("HUMAN_REVIEW");
      expect(first.draft).toMatchObject({
        revision: 1,
        profile_release_id: "profile:fo-ssts-draft:1",
        validation: { status: "PASSED" }
      });
      expect(first.draft.source_refs.map((source) => source.resource_version_id))
        .toEqual([
          architecture.version.resource_version_id,
          prd.version.resource_version_id
        ]);
      expect(first.draft.citations).toHaveLength(2);
      expect(first.draft.artifact_ref.resource_id).not.toBe(
        prd.resource.resource_id
      );

      const replay = await service.generateDraft({
        workspace_id: workspace.workspace_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        idempotency_key: "generation-1"
      });
      expect(replay.draft.draft_id).toBe(first.draft.draft_id);

      const rejected = await service.reviewDraft({
        workspace_id: workspace.workspace_id,
        draft_id: first.draft.draft_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        decision: "REJECTED",
        comment: "Clarify the recovery section."
      });
      expect(rejected.workspace.state).toBe("REJECTED");

      const second = await service.generateDraft({
        workspace_id: workspace.workspace_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        idempotency_key: "generation-2"
      });
      expect(second.draft.revision).toBe(2);
      expect(second.draft.draft_id).not.toBe(first.draft.draft_id);

      const accepted = await service.reviewDraft({
        workspace_id: workspace.workspace_id,
        draft_id: second.draft.draft_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        decision: "ACCEPTED"
      });
      expect(accepted.workspace.state).toBe("ACCEPTED");

      const download = await service.downloadDraft({
        workspace_id: workspace.workspace_id,
        draft_id: second.draft.draft_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts"
      });
      expect(Buffer.from(download.content).toString("utf8")).toContain(
        "# AI DRAFT - SSTS"
      );
      expect(download.content_digest).toBe(second.draft.content_digest);

      const projection = await service.getWorkspace({
        workspace_id: workspace.workspace_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts"
      });
      expect(projection.messages).toHaveLength(1);
      expect(projection.drafts).toHaveLength(2);
      expect(projection.reviews).toHaveLength(2);
      expect(projection.audit.map((entry) => entry.event_type)).toContain(
        "SSTS_DRAFT_DOWNLOADED"
      );
      await expect(service.appendMessage({
        workspace_id: workspace.workspace_id,
        tenant_id: "tenant-ssts",
        principal_id: "principal-ssts",
        content: "This must be rejected after acceptance."
      })).rejects.toMatchObject<SstsDraftError>({
        code: "PC_SSTS_WORKSPACE_IMMUTABLE"
      });
    } finally {
      await Promise.all([
        service.close(),
        events.close(),
        resources.close(),
        profiles.close()
      ]);
      await rm(root, { recursive: true, force: true });
    }
  });
});
