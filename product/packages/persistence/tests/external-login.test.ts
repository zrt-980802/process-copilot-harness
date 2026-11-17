import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { IdentityAuthorizationService } from "@pc/application";
import { MemoryIdentityAuthorizationRepository, PostgresIdentityAuthorizationRepository } from "../src/index.js";

const issuer = "http://ee-api:5000";
const key = { identity_provider_ref: "eeclaw", issuer, external_subject: "42", tenant_or_org_ref: "tenant-ee" };
const now = new Date("2026-11-12T00:00:00Z");
const expiry = new Date(now.getTime() + 60_000).toISOString();
const signingKey = "external-login-test-signing-key-000000000";

describe("EE external login authority", () => {
  it("retains existing Principal, revisions and explicit grants without copying EE credentials", async () => {
    const repository = new MemoryIdentityAuthorizationRepository();
    const service = new IdentityAuthorizationService(repository, signingKey, [], () => now);
    const old = await service.provisionPilotAccount({ tenant_id: key.tenant_or_org_ref, account_key: "historical.pilot", secret: "OldPilotSecret123" });
    const linked = await service.linkVerifiedIdentity({ ...key, principal_id: old.principal.principal_id,
      verification_level: "admin_reauthentication", expected_identity_revision: old.principal.identity_revision });
    const before = await repository.getPilotAccount(key.tenant_or_org_ref, "historical.pilot");
    const login = await service.signInExternal(key, randomUUID(), expiry);
    expect(login.principal).toEqual(linked.principal);
    expect(await repository.getPilotAccount(key.tenant_or_org_ref, "historical.pilot")).toEqual(before);
    expect((await service.listExternalBindings("eeclaw", issuer, key.tenant_or_org_ref))[0]?.legacy_account_keys).toEqual(["historical.pilot"]);
    await expect(service.resolveExternalSubject(login.principal.principal_id, "eeclaw", { issuer: "wrong", tenant: key.tenant_or_org_ref })).resolves.toBeUndefined();
  });

  it("enrolls once under concurrent requests and isolates issuer/subject/tenant", async () => {
    const repository = new MemoryIdentityAuthorizationRepository();
    const service = new IdentityAuthorizationService(repository, signingKey, [], () => now);
    const logins = await Promise.all(Array.from({ length: 8 }, () => service.signInExternal(key, randomUUID(), expiry)));
    expect(new Set(logins.map(l => l.principal.principal_id)).size).toBe(1);
    const principalId = logins[0]!.principal.principal_id;
    expect(await repository.listAuthorizationGrants(principalId)).toEqual([]);
    expect((await service.listExternalBindings("eeclaw", issuer, key.tenant_or_org_ref))[0]?.legacy_account_keys).toEqual([]);
    for (const alternative of [{ ...key, issuer: "http://other-ee" }, { ...key, external_subject: "43" }, { ...key, tenant_or_org_ref: "other-tenant" }]) {
      expect((await service.signInExternal(alternative, randomUUID(), expiry)).principal.principal_id).not.toBe(principalId);
    }
  });

  it("bounds lifetime to EE expiry, rejects invalid proof and enforces revocation on every authenticate", async () => {
    const repository = new MemoryIdentityAuthorizationRepository();
    const service = new IdentityAuthorizationService(repository, signingKey, [], () => now);
    await expect(service.signInExternal(key, "not-session", expiry)).rejects.toMatchObject({ code: "PC_IDENTITY_LINK_UNVERIFIED" });
    await expect(service.signInExternal(key, randomUUID(), now.toISOString())).rejects.toMatchObject({ code: "PC_AUTHENTICATION_REQUIRED" });
    const login = await service.signInExternal(key, randomUUID(), expiry);
    expect(login.expires_at).toBe(expiry);
    let checks = 0;
    service.registerSessionValidator(async () => { checks++; if (checks > 1) throw new Error("EE revoked"); });
    await service.authenticate(login.access_token);
    await expect(service.authenticate(login.access_token)).rejects.toThrow("EE revoked");
    await service.signOut(login.access_token);
    await expect(service.authenticate(login.access_token)).rejects.toMatchObject({ code: "PC_AUTHENTICATION_REQUIRED" });
    expect(checks).toBe(2);
  });
});

describe.skipIf(!process.env.PC_TEST_POSTGRES_URL)("EE login real PostgreSQL concurrency", () => {
  it("persists one new identity under concurrent first logins across service instances", async () => {
    const repositories = [0, 1].map(() => new PostgresIdentityAuthorizationRepository(process.env.PC_TEST_POSTGRES_URL!));
    const services = repositories.map(r => new IdentityAuthorizationService(r, signingKey, [], () => now));
    try {
      await services[0]!.initialize();
      const input = { ...key, external_subject: randomUUID() };
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => services[i % 2]!.signInExternal(input, randomUUID(), expiry)));
      expect(new Set(results.map(r => r.principal.principal_id)).size).toBe(1);
      const principal = results[0]!.principal;
      expect((await services[1]!.authenticate(results[0]!.access_token)).principal).toEqual(principal);
      expect(await repositories[1]!.listAuthorizationGrants(principal.principal_id)).toEqual([]);
      expect((await services[0]!.listExternalBindings("eeclaw", issuer, key.tenant_or_org_ref)).find(b => b.principal.principal_id === principal.principal_id)?.legacy_account_keys).toEqual([]);
    } finally { await Promise.all(services.map(s => s.close())); }
  });
});
