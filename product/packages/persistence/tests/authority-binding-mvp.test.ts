import { describe, expect, it } from "vitest";
import { ExternalAuthorityBindingResolver, type AuthorityAccountBinding, type ProviderAuthorityState } from "@pc/application";
import type { ExternalIdentityLink, PCPrincipal } from "@pc/domain";

const principal: PCPrincipal = { principal_id: "principal:one", tenant_id: "mvp", principal_type: "human", lifecycle_status: "active",
  primary_identity_ref: "link:one", identity_revision: 1, authorization_revision: 1, created_at: "2026-11-23T08:00:00Z", updated_at: "2026-11-23T08:00:00Z" };
const state: ProviderAuthorityState = { provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw", registration_state: "ACTIVE",
  generation: "epoch.1", configuration_revision: 1, identity_provider_ref: "eeclaw", identity_issuer: "synthetic-issuer",
  connector: { connector_id: "connector:one", tenant_id: "mvp", state: "ACTIVE", generation: "epoch.1", tool_release_ids: ["tool:read"] } };
const link: ExternalIdentityLink = { identity_link_id: "link:one", principal_id: principal.principal_id, identity_provider_ref: "eeclaw",
  issuer: "synthetic-issuer", external_subject: "42", tenant_or_org_ref: "mvp", status: "verified", identity_link_revision: 1,
  link_method: "signed_idp_callback", verification_level: "signed_idp_callback", created_at: principal.created_at, updated_at: principal.updated_at };
const account: AuthorityAccountBinding = { external_account_binding_id: "binding:one", tenant_id: "mvp", connector_id: "connector:one",
  principal_id: principal.principal_id, external_account_id: "42", status: "ACTIVE", credential_generation: 1 };

describe("T2B composed current authority binding", () => {
  it("resolves one active identity, registration, connector and credential generation without granting authority", async () => {
    const resolver = new ExternalAuthorityBindingResolver({ provider: () => state, link: async () => link, accounts: async () => [account] });
    expect(await resolver.resolve({ principal, provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw", tool_release_ids: ["tool:read"] }))
      .toMatchObject({ binding_id: "binding:one", provider_generation: "epoch.1", credential_generation: 1 });
  });

  it.each(["missing", "ambiguous", "revoked", "wrong tenant", "wrong principal", "wrong account", "wrong connector",
    "stale credential", "missing link", "wrong issuer", "wrong provider", "disabled registration", "old connector generation", "unregistered tool"])(
    "denies %s without Provider authorization", async variant => {
      const s = structuredClone(state), l = structuredClone(link), a = structuredClone(account);
      if (variant === "revoked") a.status = "REVOKED";
      if (variant === "wrong tenant") a.tenant_id = "other";
      if (variant === "wrong principal") a.principal_id = "other";
      if (variant === "wrong account") a.external_account_id = "other";
      if (variant === "wrong connector") a.connector_id = "other";
      if (variant === "wrong issuer") l.issuer = "other";
      if (variant === "wrong provider") s.provider_registration_id = "other";
      if (variant === "disabled registration") s.registration_state = "DISABLED";
      if (variant === "old connector generation") s.connector.generation = "epoch.old";
      const resolver = new ExternalAuthorityBindingResolver({ provider: () => s, link: async () => variant === "missing link" ? undefined : l,
        accounts: async () => variant === "missing" ? [] : variant === "ambiguous" ? [a, { ...a, external_account_binding_id: "another" }] : [a] });
      await expect(resolver.resolve({ principal, provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw",
        tool_release_ids: [variant === "unregistered tool" ? "tool:other" : "tool:read"], credential_generation: variant === "stale credential" ? 0 : 1 }))
        .rejects.toMatchObject({ code: "PC_AUTHORITY_BINDING_DENIED" });
    });
});
