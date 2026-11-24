import { IdentityAuthorizationError, type ExternalIdentityLink, type PCPrincipal } from "@pc/domain";

export interface ProviderAuthorityState {
  provider_registration_id: string;
  resource_authority: string;
  registration_state: "ACTIVE" | "DISABLED";
  generation: string;
  configuration_revision: number;
  identity_provider_ref: string;
  identity_issuer: string;
  connector: { connector_id: string; tenant_id: string; state: string; generation: string; tool_release_ids: readonly string[] };
}

export interface AuthorityAccountBinding {
  external_account_binding_id: string;
  tenant_id: string;
  connector_id: string;
  principal_id: string;
  external_account_id: string;
  credential_generation: number;
  status: string;
}

export interface ExternalAuthorityBindingView {
  binding_id: string;
  principal_id: string;
  tenant_id: string;
  identity_link_id: string;
  identity_link_revision: number;
  provider_registration_id: string;
  resource_authority: string;
  provider_generation: string;
  configuration_revision: number;
  connector_id: string;
  external_account_id: string;
  credential_generation: number;
}

export class ExternalAuthorityBindingResolver {
  constructor(private readonly ports: {
    provider(id: string): ProviderAuthorityState | undefined;
    link(principalId: string, provider: string): Promise<ExternalIdentityLink | undefined>;
    accounts(tenantId: string, connectorId: string, principalId: string): Promise<readonly AuthorityAccountBinding[]>;
  }) {}

  async resolve(input: { principal: PCPrincipal; provider_registration_id: string; resource_authority: string;
    tool_release_ids: readonly string[]; credential_generation?: number; connector_id?: string }): Promise<ExternalAuthorityBindingView> {
    function deny(reason: string): never {
      throw new IdentityAuthorizationError("PC_AUTHORITY_BINDING_DENIED", "Current data-source binding is unavailable", false, { reason_codes: [reason] });
    }
    const state = structuredClone(this.ports.provider(input.provider_registration_id));
    if (!state || state.registration_state !== "ACTIVE" || !state.generation || !state.identity_issuer
      || state.provider_registration_id !== input.provider_registration_id || state.resource_authority !== input.resource_authority
      || !Number.isInteger(state.configuration_revision) || state.configuration_revision < 1
      || state.connector.state !== "ACTIVE" || state.connector.tenant_id !== input.principal.tenant_id
      || state.connector.generation !== state.generation || !state.connector.connector_id
      || (input.connector_id !== undefined && input.connector_id !== state.connector.connector_id)
      || input.tool_release_ids.some(id => !state.connector.tool_release_ids.includes(id))) deny("provider_or_connector_unavailable");
    const link = await this.ports.link(input.principal.principal_id, state.identity_provider_ref);
    if (!link || link.status !== "verified" || link.principal_id !== input.principal.principal_id
      || link.identity_provider_ref !== state.identity_provider_ref || link.issuer !== state.identity_issuer
      || link.tenant_or_org_ref !== input.principal.tenant_id || !link.external_subject
      || !Number.isInteger(link.identity_link_revision) || link.identity_link_revision < 1) deny("identity_link_unavailable");
    const bindings = await this.ports.accounts(input.principal.tenant_id, state.connector.connector_id, input.principal.principal_id);
    if (bindings.length !== 1) deny(bindings.length ? "binding_ambiguous" : "binding_missing");
    const account = bindings[0]!;
    if (account.status !== "ACTIVE" || account.tenant_id !== input.principal.tenant_id || account.principal_id !== input.principal.principal_id
      || account.connector_id !== state.connector.connector_id || account.external_account_id !== link.external_subject
      || !account.external_account_binding_id || !Number.isInteger(account.credential_generation) || account.credential_generation < 1
      || (input.credential_generation !== undefined && input.credential_generation !== account.credential_generation)) deny("binding_mismatch_or_stale");
    const current = this.ports.provider(input.provider_registration_id);
    if (!current || current.registration_state !== "ACTIVE" || current.generation !== state.generation
      || current.configuration_revision !== state.configuration_revision || current.connector.connector_id !== state.connector.connector_id) deny("provider_generation_changed");
    return { binding_id: account.external_account_binding_id, principal_id: input.principal.principal_id,
      tenant_id: input.principal.tenant_id, identity_link_id: link.identity_link_id, identity_link_revision: link.identity_link_revision,
      provider_registration_id: state.provider_registration_id, resource_authority: state.resource_authority, provider_generation: state.generation,
      configuration_revision: state.configuration_revision, connector_id: state.connector.connector_id,
      external_account_id: account.external_account_id, credential_generation: account.credential_generation };
  }
}
