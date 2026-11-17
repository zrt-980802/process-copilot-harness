import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProfileCapabilityService } from "@pc/application";
import { EventProjectionService } from "@pc/event-projection";
import {
  LocalImmutableBlobStore,
  LocalWorkspaceMaterializer,
  ResourceWorkspaceService
} from "@pc/resource";
import {
  DeterministicSstsDraftEngine,
  SstsDraftService
} from "@pc/ssts-draft";
import {
  PostgresEventProjectionRepository,
  PostgresProfileCapabilityRepository,
  PostgresResourceRepository,
  PostgresSstsDraftRepository
} from "../src/index.js";

const databaseUrl = process.env.PC_TEST_POSTGRES_URL;

describe.skipIf(databaseUrl === undefined)(
  "Postgres SSTS Draft recovery",
  () => {
    it("restores Workspace, Message, Draft, Review and download after restart", async () => {
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const tenantId = `tenant-ssts-${suffix}`;
      const principalId = `principal-ssts-${suffix}`;
      const root = await mkdtemp(path.join(tmpdir(), "pc-ssts-postgres-"));
      const now = () => new Date("2026-11-10T20:00:00.000Z");
      const createServices = () => {
        const profiles = new ProfileCapabilityService(
          new PostgresProfileCapabilityRepository(databaseUrl as string),
          now
        );
        const resources = new ResourceWorkspaceService(
          new PostgresResourceRepository(databaseUrl as string),
          new LocalImmutableBlobStore(path.join(root, "blobs")),
          new LocalWorkspaceMaterializer(path.join(root, "materializations")),
          undefined,
          now
        );
        const events = new EventProjectionService(
          new PostgresEventProjectionRepository(databaseUrl as string),
          undefined,
          undefined,
          undefined,
          undefined,
          now
        );
        const ssts = new SstsDraftService(
          new PostgresSstsDraftRepository(databaseUrl as string),
          profiles,
          resources,
          events,
          new DeterministicSstsDraftEngine(),
          now
        );
        return { profiles, resources, events, ssts };
      };

      let workspaceId = "";
      let draftId = "";
      const first = createServices();
      await Promise.all([
        first.profiles.initialize(),
        first.resources.initialize(),
        first.events.initialize(),
        first.ssts.initialize()
      ]);
      try {
        if (
          await first.profiles.getProfileRelease("profile:fo-ssts-draft:1")
          === undefined
        ) {
          await first.profiles.seedFixedFoRelease();
        }
        const upload = async (name: string, content: string) =>
          first.resources.uploadResource({
            tenant_id: tenantId,
            principal_id: principalId,
            kind: "UPLOAD",
            display_name: name,
            classification: "INTERNAL",
            owner_scope: { scope_type: "USER_ROOT", scope_id: principalId },
            media_type: "text/markdown",
            content: Buffer.from(content),
            provenance: {
              source_system: "postgres-test",
              acquisition_operation: `upload-${name}`
            }
          });
        const [prd, architecture] = await Promise.all([
          upload("prd.md", "# PRD\nPersistent SSTS requirements"),
          upload("architecture.md", "# Architecture\nPostgreSQL authority")
        ]);
        const workspace = await first.ssts.createWorkspace({
          tenant_id: tenantId,
          principal_id: principalId,
          title: "Persistent SSTS"
        });
        workspaceId = workspace.workspace_id;
        await first.ssts.attachInput({
          workspace_id: workspaceId,
          tenant_id: tenantId,
          principal_id: principalId,
          slot: "PRD",
          resource_id: prd.resource.resource_id,
          resource_version_id: prd.version.resource_version_id
        });
        await first.ssts.attachInput({
          workspace_id: workspaceId,
          tenant_id: tenantId,
          principal_id: principalId,
          slot: "ARCHITECTURE",
          resource_id: architecture.resource.resource_id,
          resource_version_id: architecture.version.resource_version_id
        });
        await first.ssts.appendMessage({
          workspace_id: workspaceId,
          tenant_id: tenantId,
          principal_id: principalId,
          content: "Persist this conversation."
        });
        const generated = await first.ssts.generateDraft({
          workspace_id: workspaceId,
          tenant_id: tenantId,
          principal_id: principalId,
          idempotency_key: `generation-${suffix}`
        });
        draftId = generated.draft.draft_id;
        await first.ssts.reviewDraft({
          workspace_id: workspaceId,
          draft_id: draftId,
          tenant_id: tenantId,
          principal_id: principalId,
          decision: "ACCEPTED"
        });
      } finally {
        await Promise.all([
          first.ssts.close(),
          first.events.close(),
          first.resources.close(),
          first.profiles.close()
        ]);
      }

      const second = createServices();
      await Promise.all([
        second.profiles.initialize(),
        second.resources.initialize(),
        second.events.initialize(),
        second.ssts.initialize()
      ]);
      try {
        const recovered = await second.ssts.getWorkspace({
          workspace_id: workspaceId,
          tenant_id: tenantId,
          principal_id: principalId
        });
        expect(recovered.workspace.state).toBe("ACCEPTED");
        expect(recovered.inputs).toHaveLength(2);
        expect(recovered.messages).toHaveLength(1);
        expect(recovered.drafts).toHaveLength(1);
        expect(recovered.reviews).toMatchObject([
          { draft_id: draftId, decision: "ACCEPTED" }
        ]);
        const download = await second.ssts.downloadDraft({
          workspace_id: workspaceId,
          draft_id: draftId,
          tenant_id: tenantId,
          principal_id: principalId
        });
        expect(Buffer.from(download.content).toString("utf8")).toContain(
          "# AI DRAFT - SSTS"
        );
      } finally {
        await Promise.all([
          second.ssts.close(),
          second.events.close(),
          second.resources.close(),
          second.profiles.close()
        ]);
        await rm(root, { recursive: true, force: true });
      }
    });
  }
);
