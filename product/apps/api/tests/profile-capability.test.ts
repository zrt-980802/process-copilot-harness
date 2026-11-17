import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  IdentityAuthorizationService,
  ProfileCapabilityService
} from "@pc/application";
import {
  MemoryIdentityAuthorizationRepository,
  MemoryProfileCapabilityRepository
} from "@pc/persistence";
import { buildApiServer } from "../src/server.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Profile and Capability API", () => {
  it("binds the fixed FO release and resolves an immutable snapshot", async () => {
    const now = () => new Date("2026-11-10T08:00:00.000Z");
    const identity = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      "profile-api-signing-key-00000000000000000",
      [],
      now
    );
    const profiles = new ProfileCapabilityService(
      new MemoryProfileCapabilityRepository(),
      now
    );
    await identity.initialize();
    await profiles.initialize();
    const provisioned = await identity.provisionPilotAccount({
      tenant_id: "tenant-profile",
      account_key: "pilot.profile",
      secret: "PilotSecret123"
    });
    await identity.replaceAuthorizationGrants({
      principal_id: provisioned.principal.principal_id,
      expected_authorization_revision:
        provisioned.principal.authorization_revision,
      grants: [{
        action: "draft.generate",
        scope_type: "project",
        scope_id: "project-profile",
        effect: "allow",
        evidence_ref: "pilot-grant:project-profile"
      }]
    });
    const seeded = await profiles.seedFixedFoRelease();
    const server = buildApiServer({
      identityAuthorization: identity,
      profileCapability: profiles
    });
    servers.push(server);

    const signIn = await server.inject({
      method: "POST",
      url: "/v1/pilot/sign-in",
      payload: {
        tenant_id: "tenant-profile",
        account_key: "pilot.profile",
        secret: "PilotSecret123"
      }
    });
    const token = signIn.json().access_token as string;
    const assignment = await server.inject({
      method: "POST",
      url: "/v1/profile-assignments",
      headers: { authorization: `Bearer ${token}` },
      payload: { profile_release_id: seeded.profile.profile_release_id }
    });
    expect(assignment.statusCode).toBe(201);

    const resolution = await server.inject({
      method: "POST",
      url: "/v1/profile-resolutions",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        pc_session_id: "session-profile",
        requested_profile_release_id: seeded.profile.profile_release_id,
        authorization_revision:
          provisioned.principal.authorization_revision + 1,
        model_selection: { provider: "configured" },
        knowledge_view_refs: [],
        dsh_preset_ref: "process-copilot-runtime",
        runtime_manifest: {
          contract_name: "pc.runtime-capability-manifest/1",
          contract_version: 1,
          runtime_id: "runtime-profile",
          runtime_epoch: 1,
          dsh_version: "0.2.1-rc.3",
          bridge_protocol_versions: ["1.0"],
          profile_digest: seeded.profile.release_digest,
          bundle_lock_digest: seeded.profile.dependency_lock_digest,
          plugin_releases: [seeded.plugin.plugin_release_id],
          agent_presets: [],
          tool_provider_capabilities: [],
          persistence_capabilities: [],
          event_export_capabilities: [],
          approval_capabilities: [],
          resource_capabilities: [],
          limits: {},
          generated_at: "2026-11-10T08:00:00.000Z",
          manifest_digest: "manifest-profile"
        }
      }
    });
    expect(resolution.statusCode).toBe(200);
    const snapshot = resolution.json().snapshot;
    expect(snapshot).toMatchObject({
      profile_release_id: seeded.profile.profile_release_id,
      authorization_revision:
        provisioned.principal.authorization_revision + 1
    });

    const fetched = await server.inject({
      method: "GET",
      url: `/v1/effective-profile-snapshots/${snapshot.effective_profile_snapshot_id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().snapshot_digest).toBe(snapshot.snapshot_digest);
  });
});
