import { describe, expect, it, vi } from "vitest";
import { IdentityAuthorizationService } from "@pc/application";
import { MemoryGatewayRepository, MemoryIdentityAuthorizationRepository } from "@pc/persistence";
import { installAuthorizationMvp } from "../src/authorization-mvp.js";
import { buildApiServer } from "../src/server.js";

describe("provider retry authorization", () => {
  it("requires a current PC session and an explicit global management grant", async () => {
    const identity = new IdentityAuthorizationService(new MemoryIdentityAuthorizationRepository(), "provider-retry-test-signing-key-00000000");
    const audit = new MemoryGatewayRepository();
    await audit.initialize();
    installAuthorizationMvp({ identity, audit });
    const ordinary = await identity.provisionPilotAccount({ tenant_id: "retry-test", account_key: "ordinary", secret: "SyntheticOrdinary123" });
    const admin = await identity.provisionPilotAccount({ tenant_id: "retry-test", account_key: "admin", secret: "SyntheticAdmin123" });
    await identity.replaceAuthorizationGrants({ principal_id: admin.principal.principal_id, expected_authorization_revision: 1,
      grants: [{ action: "provider.manage", scope_type: "global", scope_id: "*", effect: "allow", evidence_ref: "pc:test-management" }] });
    const userLogin = await identity.signInPilot("retry-test", "ordinary", "SyntheticOrdinary123");
    const adminLogin = await identity.signInPilot("retry-test", "admin", "SyntheticAdmin123");
    const reload = vi.fn(async () => undefined);
    const server = buildApiServer({ identityAuthorization: identity, retryEeProvider: reload });
    try {
      const request = (token?: string) => server.inject({ method: "POST", url: "/v1/providers/eeclaw/retry",
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        payload: { principal_id: admin.principal.principal_id, resource_authority: "pc", scope: "global:*" } });
      expect((await request()).statusCode).toBe(401);
      expect(reload).not.toHaveBeenCalled();
      expect((await request(userLogin.access_token)).statusCode).toBe(403);
      expect(reload).not.toHaveBeenCalled();
      const allowed = await request(adminLogin.access_token);
      expect(allowed.statusCode, allowed.body).toBe(200);
      expect(reload).toHaveBeenCalledTimes(1);
      const decisions = (await audit.listAudit(`authorization:${adminLogin.session_assurance!.pc_session_id}`)).map(row => row.authority_decision);
      expect(decisions).toContainEqual(expect.objectContaining({ action: "provider.manage", resource_ref: "global:*",
        resource_authority: "pc", decision_mode: "PC_ONLY", decision: "ALLOW" }));
      await identity.replaceAuthorizationGrants({ principal_id: admin.principal.principal_id, expected_authorization_revision: 2,
        grants: [{ action: "*", scope_type: "global", scope_id: "*", effect: "allow", evidence_ref: "pc:test-wildcard" }] });
      expect((await request(adminLogin.access_token)).statusCode).toBe(401);
      const wildcardLogin = await identity.signInPilot("retry-test", "admin", "SyntheticAdmin123");
      expect((await request(wildcardLogin.access_token)).statusCode).toBe(403);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(ordinary.principal.principal_id).not.toBe(admin.principal.principal_id);
    } finally { await server.close(); }
  });
});
