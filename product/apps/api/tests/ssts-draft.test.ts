import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  IdentityAuthorizationService,
  ProfileCapabilityService
} from "@pc/application";
import { EventProjectionService } from "@pc/event-projection";
import {
  MemoryEventProjectionRepository,
  MemoryIdentityAuthorizationRepository,
  MemoryProfileCapabilityRepository,
  MemoryResourceRepository,
  MemorySstsDraftRepository
} from "@pc/persistence";
import {
  LocalImmutableBlobStore,
  LocalWorkspaceMaterializer,
  ResourceWorkspaceService
} from "@pc/resource";
import {
  DeterministicSstsDraftEngine,
  SstsDraftService
} from "@pc/ssts-draft";
import { buildApiServer } from "../src/server.js";

describe("DEV-09 SSTS Draft API", () => {
  it("enforces two-user isolation, idempotency and authorized download", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pc-ssts-api-"));
    const now = () => new Date("2026-11-10T19:00:00.000Z");
    const identity = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      "dev09-api-signing-key-00000000000000000000",
      [],
      now
    );
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
    const ssts = new SstsDraftService(
      new MemorySstsDraftRepository(),
      profiles,
      resources,
      events,
      new DeterministicSstsDraftEngine(),
      now
    );
    await Promise.all([
      identity.initialize(),
      profiles.initialize(),
      resources.initialize(),
      events.initialize(),
      ssts.initialize()
    ]);
    await profiles.seedFixedFoRelease();
    await identity.provisionPilotAccount({
      tenant_id: "tenant-api-ssts",
      account_key: "first",
      secret: "FirstSecret123"
    });
    await identity.provisionPilotAccount({
      tenant_id: "tenant-api-ssts",
      account_key: "second",
      secret: "SecondSecret123"
    });
    const first = await identity.signInPilot(
      "tenant-api-ssts",
      "first",
      "FirstSecret123"
    );
    const second = await identity.signInPilot(
      "tenant-api-ssts",
      "second",
      "SecondSecret123"
    );
    const firstPrincipal = (
      await identity.authenticate(first.access_token)
    ).principal.principal_id;
    const upload = async (name: string, content: string) =>
      resources.uploadResource({
        tenant_id: "tenant-api-ssts",
        principal_id: firstPrincipal,
        kind: "UPLOAD",
        display_name: name,
        classification: "INTERNAL",
        owner_scope: { scope_type: "USER_ROOT", scope_id: firstPrincipal },
        media_type: "text/markdown",
        content: Buffer.from(content),
        provenance: {
          source_system: "api-test",
          acquisition_operation: `upload-${name}`
        }
      });
    const [prd, architecture] = await Promise.all([
      upload("prd.md", "# PRD\nAPI requirements"),
      upload("architecture.md", "# Architecture\nDurable boundaries")
    ]);
    const server = buildApiServer({
      identityAuthorization: identity,
      sstsDraft: ssts
    });
    await server.ready();
    try {
      const firstHeaders = {
        authorization: `Bearer ${first.access_token}`,
        "content-type": "application/json"
      };
      const secondHeaders = {
        authorization: `Bearer ${second.access_token}`,
        "content-type": "application/json"
      };
      const createdResponse = await server.inject({
        method: "POST",
        url: "/v1/ssts-tasks",
        headers: firstHeaders,
        payload: { title: "API SSTS" }
      });
      expect(createdResponse.statusCode).toBe(201);
      const workspace = createdResponse.json<{ workspace_id: string }>();

      const crossRead = await server.inject({
        method: "GET",
        url: `/v1/ssts-tasks/${workspace.workspace_id}`,
        headers: secondHeaders
      });
      expect(crossRead.statusCode).toBe(403);

      const incomplete = await server.inject({
        method: "POST",
        url: `/v1/ssts-tasks/${workspace.workspace_id}/drafts/generate`,
        headers: firstHeaders,
        payload: { idempotency_key: "api-generation-missing" }
      });
      expect(incomplete.statusCode).toBe(409);
      expect(incomplete.json()).toMatchObject({
        error: { code: "PC_SSTS_INPUTS_INCOMPLETE" }
      });

      for (const input of [
        {
          slot: "PRD",
          resource_id: prd.resource.resource_id,
          resource_version_id: prd.version.resource_version_id
        },
        {
          slot: "ARCHITECTURE",
          resource_id: architecture.resource.resource_id,
          resource_version_id: architecture.version.resource_version_id
        }
      ]) {
        const attached = await server.inject({
          method: "POST",
          url: `/v1/ssts-tasks/${workspace.workspace_id}/inputs`,
          headers: firstHeaders,
          payload: input
        });
        expect(attached.statusCode).toBe(201);
      }
      const generated = await server.inject({
        method: "POST",
        url: `/v1/ssts-tasks/${workspace.workspace_id}/drafts/generate`,
        headers: firstHeaders,
        payload: { idempotency_key: "api-generation-1" }
      });
      expect(generated.statusCode).toBe(201);
      const result = generated.json<{
        draft: { draft_id: string };
      }>();

      const replay = await server.inject({
        method: "POST",
        url: `/v1/ssts-tasks/${workspace.workspace_id}/drafts/generate`,
        headers: firstHeaders,
        payload: { idempotency_key: "api-generation-1" }
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.json()).toMatchObject({
        draft: { draft_id: result.draft.draft_id }
      });

      const deniedDownload = await server.inject({
        method: "GET",
        url: `/v1/ssts-tasks/${workspace.workspace_id}/drafts/${result.draft.draft_id}/download`,
        headers: secondHeaders
      });
      expect(deniedDownload.statusCode).toBe(403);

      const download = await server.inject({
        method: "GET",
        url: `/v1/ssts-tasks/${workspace.workspace_id}/drafts/${result.draft.draft_id}/download`,
        headers: firstHeaders
      });
      expect(download.statusCode).toBe(200);
      expect(download.body).toContain("# AI DRAFT - SSTS");
      expect(download.headers["content-type"]).toContain("text/markdown");

      const accepted = await server.inject({
        method: "POST",
        url: `/v1/ssts-tasks/${workspace.workspace_id}/drafts/${result.draft.draft_id}/review`,
        headers: firstHeaders,
        payload: { decision: "ACCEPTED" }
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({
        workspace: { state: "ACCEPTED" },
        review: { decision: "ACCEPTED" }
      });
    } finally {
      await server.close();
      await Promise.all([
        ssts.close(),
        events.close(),
        resources.close(),
        profiles.close(),
        identity.close()
      ]);
      await rm(root, { recursive: true, force: true });
    }
  });
});
