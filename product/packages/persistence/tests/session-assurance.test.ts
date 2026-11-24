import { describe, expect, it, vi } from "vitest";
import { IdentityAuthorizationService } from "@pc/application";
import { MemoryIdentityAuthorizationRepository } from "../src/index.js";
import { sealSessionAssurance } from "@pc/domain";
import { createHash, randomUUID } from "node:crypto";

async function fixture() {
  let instant = Date.parse("2026-11-23T08:00:00.000Z");
  const now = () => new Date(instant);
  const repository = new MemoryIdentityAuthorizationRepository();
  const identity = new IdentityAuthorizationService(repository, "mvp-session-synthetic-signing-key-000000", [], now);
  const account = await identity.provisionPilotAccount({ tenant_id: "mvp", account_key: "engineer", secret: "SyntheticMvpSecret123" });
  const login = await identity.signInPilot("mvp", "engineer", "SyntheticMvpSecret123");
  return { identity, repository, account, login, now, advance: (ms: number) => { instant += ms; } };
}

describe("T1B persistent Session Assurance boundary", () => {
  it("issues an independent C67 with fixed expiry and PC-only evidence", async () => {
    const f = await fixture();
    const authenticated = await f.identity.authenticate(f.login.access_token);
    expect(authenticated).toHaveProperty("assurance.contract_name", "pc.session-assurance/1");
    expect(authenticated).toHaveProperty("assurance.absolute_expires_at", f.login.expires_at);
    expect(authenticated).toHaveProperty("assurance.identity_revision", f.account.principal.identity_revision);
  });

  it("rejects a Session after a PC authorization revision change", async () => {
    const f = await fixture();
    await f.identity.replaceAuthorizationGrants({ principal_id: f.login.principal.principal_id, expected_authorization_revision: 1,
      grants: [{ action: "conversation.run", scope_type: "global", scope_id: "*", effect: "allow", evidence_ref: "pc:test" }] });
    await expect(f.identity.authenticate(f.login.access_token)).rejects.toMatchObject({ code: "PC_SESSION_ASSURANCE_DENIED" });
  });

  it("rejects a Session after an identity/link revision change", async () => {
    const f = await fixture();
    await f.identity.linkVerifiedIdentity({ principal_id: f.login.principal.principal_id, identity_provider_ref: "test-idp",
      issuer: "test-issuer", external_subject: "42", tenant_or_org_ref: "mvp", verification_level: "admin_reauthentication", expected_identity_revision: 1 });
    await expect(f.identity.authenticate(f.login.access_token)).rejects.toMatchObject({ code: "PC_SESSION_ASSURANCE_DENIED" });
  });

  it("does not slide expiry or call Provider validation on ordinary PC access", async () => {
    const f = await fixture();
    const source = vi.fn(async () => { throw new Error("Provider must not be called"); });
    f.identity.registerProviderSessionValidator(source);
    f.advance(60_000);
    expect((await f.identity.authenticate(f.login.access_token)).session.expires_at).toBe(f.login.expires_at);
    expect(source).not.toHaveBeenCalled();
    f.advance(8 * 60 * 60 * 1000);
    await expect(f.identity.authenticate(f.login.access_token)).rejects.toMatchObject({ code: "PC_AUTHENTICATION_REQUIRED" });
  });

  it("denies legacy Sessions without assurance instead of backfilling current revisions", async () => {
    const f = await fixture();
    const token = "synthetic-legacy-session";
    await f.repository.createPilotSession({ authentication_context_id: randomUUID(), principal_id: f.login.principal.principal_id,
      token_digest: createHash("sha256").update(token).digest("hex"), issued_at: f.now().toISOString(), expires_at: f.login.expires_at });
    await expect(f.identity.authenticate(token)).rejects.toMatchObject({ code: "PC_SESSION_ASSURANCE_REQUIRED" });
  });

  it.each(["digest", "owner", "tenant", "state", "idle expiry", "extra field", "account disabled"])("rejects %s locally", async variant => {
    const f = await fixture();
    const record = (await f.repository.getSessionAssurance(f.login.authentication_context_id))!;
    if (variant === "account disabled") {
      vi.spyOn(f.repository, "getPilotAccountById").mockResolvedValue({ ...f.account.pilot_account, status: "disabled" });
    } else {
      const modified = { ...record.assurance,
        ...(variant === "digest" ? { evidence_refs: ["pc:tampered"] } : {}),
        ...(variant === "owner" ? { principal_id: "other" } : {}), ...(variant === "tenant" ? { tenant_id: "other" } : {}),
        ...(variant === "state" ? { session_state: "REVOKED" as const, revoked_at: f.now().toISOString() } : {}),
        ...(variant === "idle expiry" ? { idle_expires_at: f.now().toISOString() } : {}),
        ...(variant === "extra field" ? { source_cookie: "synthetic" } : {}) };
      vi.spyOn(f.repository, "getSessionAssurance").mockResolvedValue({ ...record,
        assurance: variant === "digest" ? modified : sealSessionAssurance(modified) });
    }
    await expect(f.identity.authenticate(f.login.access_token)).rejects.toMatchObject({ code: "PC_SESSION_ASSURANCE_DENIED" });
  });

  it("caps Provider assurance at verified evidence and keeps it usable locally during an outage", async () => {
    const f = await fixture();
    const expiry = new Date(f.now().getTime() + 15 * 60_000).toISOString();
    const login = await f.identity.signInExternal({ identity_provider_ref: "eeclaw", issuer: "synthetic-issuer",
      external_subject: "42", tenant_or_org_ref: "mvp" }, randomUUID(), expiry);
    const source = vi.fn(async () => { throw new Error("synthetic unavailable"); });
    f.identity.registerProviderSessionValidator(source);
    const first = await f.identity.authenticate(login.access_token);
    expect(first.assurance.absolute_expires_at).toBe(expiry);
    expect(first.assurance.pc_session_id).not.toContain(login.authentication_context_id);
    f.advance(60_000);
    expect((await f.identity.authenticate(login.access_token)).assurance).toEqual(first.assurance);
    expect(source).not.toHaveBeenCalled();
    await expect(f.identity.authenticateForProvider(login.access_token)).rejects.toThrow("synthetic unavailable");
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("revokes base Session and C67 together and preserves its immutable expiry", async () => {
    const f = await fixture();
    await f.identity.signOut(f.login.access_token);
    const record = (await f.repository.getSessionAssurance(f.login.authentication_context_id))!;
    expect(record.assurance).toMatchObject({ session_state: "REVOKED", absolute_expires_at: f.login.expires_at });
    expect(record.record_version).toBe(2);
    await expect(f.identity.authenticate(f.login.access_token)).rejects.toMatchObject({ code: "PC_AUTHENTICATION_REQUIRED" });
  });
});
