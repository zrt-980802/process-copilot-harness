import { describe, expect, it } from "vitest";
import {
  IdentityAuthorizationService,
  ProfileCapabilityService
} from "@pc/application";
import {
  PostgresIdentityAuthorizationRepository,
  PostgresProfileCapabilityRepository
} from "../src/index.js";

const databaseUrl = process.env.PC_TEST_POSTGRES_URL;
const now = () => new Date("2026-11-10T10:00:00.000Z");

describe.skipIf(databaseUrl === undefined)(
  "Postgres Identity and Profile authority",
  () => {
    it("persists Pilot sessions, grants, releases and snapshots across service restart", async () => {
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const accountKey = `pilot-${suffix}`;
      const identity = new IdentityAuthorizationService(
        new PostgresIdentityAuthorizationRepository(databaseUrl as string),
        "postgres-test-signing-key-000000000000000",
        [],
        now
      );
      const profiles = new ProfileCapabilityService(
        new PostgresProfileCapabilityRepository(databaseUrl as string),
        now
      );
      await Promise.all([identity.initialize(), profiles.initialize()]);
      const provisioned = await identity.provisionPilotAccount({
        tenant_id: "tenant-postgres",
        account_key: accountKey,
        secret: "PilotSecret123"
      });
      const revised = await identity.replaceAuthorizationGrants({
        principal_id: provisioned.principal.principal_id,
        expected_authorization_revision:
          provisioned.principal.authorization_revision,
        grants: [{
          action: "draft.generate",
          scope_type: "project",
          scope_id: `project-${suffix}`,
          effect: "allow",
          evidence_ref: `pilot-grant:${suffix}`
        }]
      });
      const signedIn = await identity.signInPilot(
        "tenant-postgres",
        accountKey,
        "PilotSecret123"
      );
      const seeded = await profiles.seedFixedFoRelease();
      await profiles.assignProfile(
        provisioned.principal.principal_id,
        seeded.profile.profile_release_id
      );
      const resolved = await profiles.resolveEffectiveProfile({
        principal_id: provisioned.principal.principal_id,
        pc_session_id: `session-${suffix}`,
        requested_profile_release_id: seeded.profile.profile_release_id,
        authorization_revision: revised.authorization_revision,
        model_selection: { provider: "configured" },
        knowledge_view_refs: [],
        dsh_preset_ref: "process-copilot-runtime",
        runtime_manifest: {
          contract_name: "pc.runtime-capability-manifest/1",
          contract_version: 1,
          runtime_id: `runtime-${suffix}`,
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
          generated_at: now().toISOString(),
          manifest_digest: `manifest-${suffix}`
        }
      });
      expect(resolved.snapshot).toBeDefined();
      const snapshotId =
        resolved.snapshot?.effective_profile_snapshot_id ?? "";
      await Promise.all([identity.close(), profiles.close()]);

      const restartedIdentity = new IdentityAuthorizationService(
        new PostgresIdentityAuthorizationRepository(databaseUrl as string),
        "postgres-test-signing-key-000000000000000",
        [],
        now
      );
      const restartedProfiles = new ProfileCapabilityService(
        new PostgresProfileCapabilityRepository(databaseUrl as string),
        now
      );
      await Promise.all([
        restartedIdentity.initialize(),
        restartedProfiles.initialize()
      ]);
      try {
        const reseeded = await restartedProfiles.seedFixedFoRelease();
        expect(reseeded.profile).toEqual(seeded.profile);
        await expect(
          restartedIdentity.authenticate(signedIn.access_token)
        ).resolves.toMatchObject({
          principal: {
            principal_id: provisioned.principal.principal_id,
            authorization_revision: revised.authorization_revision
          }
        });
        const snapshot = await restartedProfiles.getEffectiveProfileSnapshot(
          snapshotId
        );
        expect(snapshot).toMatchObject({
          pc_session_id: `session-${suffix}`,
          profile_release_id: seeded.profile.profile_release_id,
          authorization_revision: revised.authorization_revision
        });
      } finally {
        await Promise.all([
          restartedIdentity.close(),
          restartedProfiles.close()
        ]);
      }
    });
  }
);
