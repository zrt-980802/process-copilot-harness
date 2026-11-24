import { IdentityAuthorizationService } from "@pc/application";
import { MemoryGatewayRepository, MemoryIdentityAuthorizationRepository } from "@pc/persistence";
import { installAuthorizationMvp } from "../../src/authorization-mvp.js";

export async function providerRetryAdmin() {
  const identity = new IdentityAuthorizationService(new MemoryIdentityAuthorizationRepository(), "provider-retry-fixture-signing-key-0000000");
  const audit = new MemoryGatewayRepository();
  await audit.initialize();
  installAuthorizationMvp({ identity, audit });
  const account = await identity.provisionPilotAccount({ tenant_id: "retry-test", account_key: "admin", secret: "SyntheticRetryAdmin123" });
  await identity.replaceAuthorizationGrants({ principal_id: account.principal.principal_id, expected_authorization_revision: 1,
    grants: [{ action: "provider.manage", scope_type: "global", scope_id: "*", effect: "allow", evidence_ref: "pc:test-management" }] });
  const login = await identity.signInPilot("retry-test", "admin", "SyntheticRetryAdmin123");
  return { identity, headers: { authorization: `Bearer ${login.access_token}` } };
}
