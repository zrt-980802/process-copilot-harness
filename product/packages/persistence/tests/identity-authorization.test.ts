import { describe, expect, it } from "vitest";
import {
  IdentityAuthorizationService,
  type ExternalAuthorizationPort
} from "@pc/application";
import { MemoryIdentityAuthorizationRepository } from "../src/index.js";

const SIGNING_KEY = "dev05-test-signing-key-000000000000000000";

const externalAllow: ExternalAuthorizationPort = {
  evaluate: () => Promise.resolve({
    decision: "ALLOW",
    reason_codes: ["eeclaw_allow"],
    evidence_refs: ["eeclaw:C41:allow"]
  })
};

async function fixture(externalPorts: readonly ExternalAuthorizationPort[] = [externalAllow]) {
  const repository = new MemoryIdentityAuthorizationRepository();
  const service = new IdentityAuthorizationService(
    repository,
    SIGNING_KEY,
    externalPorts,
    () => new Date("2026-11-10T05:00:00.000Z")
  );
  await service.initialize();
  const provisioned = await service.provisionPilotAccount({
    tenant_id: "tenant-1",
    account_key: "pilot.fo",
    secret: "PilotSecret123"
  });
  const signedIn = await service.signInPilot(
    "tenant-1",
    "pilot.fo",
    "PilotSecret123"
  );
  return { repository, service, provisioned, signedIn };
}

describe("DEV-05 PCPrincipal and authorization", () => {
  it("permits an active user's personal conversation without enterprise grants", async () => {
    let externalCalls = 0;
    const externalDeny: ExternalAuthorizationPort = { evaluate: async () => {
      externalCalls += 1;
      return { decision: "DENY", reason_codes: ["no_enterprise_access"], evidence_refs: [] };
    } };
    const { service, provisioned } = await fixture([externalDeny]);
    const request = { principal_id: provisioned.principal.principal_id, actions: ["conversation.run"],
      resource_scope_refs: [`user:${provisioned.principal.principal_id}`], tool_release_ids: [], policy_model_revision: 1 };
    expect((await service.evaluatePrincipalAuthorization(request)).decision).toBe("ALLOW");
    expect(externalCalls).toBe(0);
    for (const changed of [
      { resource_scope_refs: ["user:someone-else"] }, { resource_scope_refs: ["project:EP37"] },
      { resource_scope_refs: [...request.resource_scope_refs, "project:EP37"] },
      { tool_release_ids: ["enterprise-tool"] }, { actions: ["conversation.run", "page:projects"] }
    ]) expect((await service.evaluatePrincipalAuthorization({ ...request, ...changed })).decision).toBe("DENY");
    await service.replaceAuthorizationGrants({ principal_id: provisioned.principal.principal_id,
      expected_authorization_revision: provisioned.principal.authorization_revision,
      grants: [{ action: "conversation.run", scope_type: "global", scope_id: "*", effect: "deny", evidence_ref: "policy:block-personal" }] });
    expect((await service.evaluatePrincipalAuthorization(request)).decision).toBe("DENY");
  });
  it("creates an independent Principal and a short-lived pilot session", async () => {
    const { provisioned, signedIn, service } = await fixture();

    expect(provisioned.principal.principal_id).not.toBe("pilot.fo");
    expect(provisioned.identity_link.external_subject).toBe("pilot.fo");
    expect(signedIn.access_token).not.toContain("pilot.fo");
    await expect(service.authenticate(signedIn.access_token)).resolves.toMatchObject({
      principal: {
        principal_id: provisioned.principal.principal_id,
        tenant_id: "tenant-1",
        lifecycle_status: "active"
      }
    });
  });

  it("rejects caller assertions and identity-link conflicts", async () => {
    const { service, provisioned } = await fixture();

    expect(() => service.linkVerifiedIdentity({
      principal_id: provisioned.principal.principal_id,
      identity_provider_ref: "feishu",
      issuer: "feishu-app",
      external_subject: "caller-open-id",
      tenant_or_org_ref: "tenant-1",
      verification_level: "caller_assertion" as never,
      expected_identity_revision: provisioned.principal.identity_revision
    })).toThrow("Caller-supplied identity assertions");
  });

  it("fails closed for project scope until an explicit grant exists", async () => {
    let externalCalls = 0;
    const { service, provisioned, signedIn } = await fixture([{
      evaluate: async () => {
        externalCalls += 1;
        return { decision: "ALLOW", reason_codes: [], evidence_refs: [] };
      }
    }]);

    const denied = await service.issueAuthorizationSnapshot(
      signedIn.access_token,
      {
        actions: ["draft.generate"],
        resource_scope_refs: ["project:project-1"],
        tool_release_ids: [],
        policy_model_revision: 1
      }
    );
    expect(denied.decision).toBe("DENY");
    expect(denied.reason_codes).toContain(
      "pc_no_matching_allow:draft.generate"
    );
    expect(externalCalls).toBe(0);

    const revised = await service.replaceAuthorizationGrants({
      principal_id: provisioned.principal.principal_id,
      expected_authorization_revision:
        provisioned.principal.authorization_revision,
      grants: [{
        action: "draft.generate",
        scope_type: "project",
        scope_id: "project-1",
        effect: "allow",
        evidence_ref: "pilot-grant:project-1"
      }]
    });
    const allowed = await service.issueAuthorizationSnapshot(
      signedIn.access_token,
      {
        actions: ["draft.generate"],
        resource_scope_refs: ["project:project-1"],
        tool_release_ids: ["tool:ssts-draft:1"],
        policy_model_revision: 1
      }
    );
    expect(allowed.decision).toBe("ALLOW");
    expect(allowed.authorization_revision).toBe(
      revised.authorization_revision
    );
    expect(Object.isFrozen(allowed)).toBe(true);
    expect(externalCalls).toBe(1);
  });

  it("intersects external authorization and refuses stale snapshots", async () => {
    const externalDeny: ExternalAuthorizationPort = {
      evaluate: () => Promise.resolve({
        decision: "DENY",
        reason_codes: ["eeclaw_project_scope_unknown"],
        evidence_refs: ["eeclaw:C41:deny"]
      })
    };
    const { service, provisioned, signedIn } = await fixture([externalDeny]);
    await service.replaceAuthorizationGrants({
      principal_id: provisioned.principal.principal_id,
      expected_authorization_revision:
        provisioned.principal.authorization_revision,
      grants: [{
        action: "draft.generate",
        scope_type: "project",
        scope_id: "project-1",
        effect: "allow",
        evidence_ref: "pilot-grant:project-1"
      }]
    });
    const denied = await service.issueAuthorizationSnapshot(
      signedIn.access_token,
      {
        actions: ["draft.generate"],
        resource_scope_refs: ["project:project-1"],
        tool_release_ids: [],
        policy_model_revision: 1
      }
    );
    expect(denied.decision).toBe("DENY");
    expect(denied.reason_codes).toContain("eeclaw_project_scope_unknown");
  });

  it("signs Principal Envelopes and binds them to the current revision", async () => {
    const { service, provisioned, signedIn } = await fixture();
    await service.replaceAuthorizationGrants({
      principal_id: provisioned.principal.principal_id,
      expected_authorization_revision:
        provisioned.principal.authorization_revision,
      grants: [{
        action: "draft.generate",
        scope_type: "project",
        scope_id: "project-1",
        effect: "allow",
        evidence_ref: "pilot-grant:project-1"
      }]
    });
    const snapshot = await service.issueAuthorizationSnapshot(
      signedIn.access_token,
      {
        actions: ["draft.generate"],
        resource_scope_refs: ["project:project-1"],
        tool_release_ids: [],
        policy_model_revision: 1
      }
    );
    const envelope = await service.issuePrincipalEnvelope(
      signedIn.access_token,
      {
        snapshot,
        audience: "runtime:runtime-1",
        pc_session_id: "session-1",
        runtime_id: "runtime-1",
        runtime_epoch: 1,
        assignment_generation: 1,
        fencing_token: "fence-1",
        credential_generation: 3,
        resource_scope_refs: ["project:project-1"]
      }
    );
    expect(envelope.signature.length).toBeGreaterThan(20);
    expect(envelope.authorization_revision).toBe(
      snapshot.authorization_revision
    );
    expect(envelope.fencing_token).toBe("fence-1");
    expect(envelope.credential_generation).toBe(3);
    expect(Object.isFrozen(envelope)).toBe(true);
    await expect(service.verifyPrincipalEnvelope(
      envelope,
      "runtime:runtime-1"
    )).resolves.toMatchObject({
      principal_id: provisioned.principal.principal_id
    });
    await expect(service.verifyPrincipalEnvelope({
      ...envelope,
      runtime_epoch: 2
    }, "runtime:runtime-1")).rejects.toMatchObject({
      code: "PC_PRINCIPAL_ENVELOPE_SIGNATURE_INVALID"
    });
    await expect(service.evaluatePrincipalAuthorization({
      principal_id: provisioned.principal.principal_id,
      actions: ["draft.generate"],
      resource_scope_refs: ["project:project-1"],
      tool_release_ids: [],
      policy_model_revision: 1
    })).resolves.toMatchObject({
      decision: "ALLOW",
      authorization_revision: snapshot.authorization_revision
    });

    await service.replaceAuthorizationGrants({
      principal_id: provisioned.principal.principal_id,
      expected_authorization_revision: snapshot.authorization_revision,
      grants: [{
        action: "draft.generate",
        scope_type: "project",
        scope_id: "project-1",
        effect: "deny",
        evidence_ref: "pilot-revoke:project-1"
      }]
    });
    await expect(service.issuePrincipalEnvelope(
      signedIn.access_token,
      {
        snapshot,
        audience: "runtime:runtime-1",
        pc_session_id: "session-1",
        runtime_id: "runtime-1",
        runtime_epoch: 1,
        assignment_generation: 1,
        resource_scope_refs: ["project:project-1"]
      }
    )).rejects.toMatchObject({ code: "PC_AUTHORIZATION_SNAPSHOT_STALE" });
  });
});
