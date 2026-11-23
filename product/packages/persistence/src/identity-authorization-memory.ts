import { randomUUID } from "node:crypto";
import type {
  IdentityAuthorizationRepository,
  ExternalIdentityKey,
  ExternalIdentityBinding,
  ProvisionPilotAccountInput,
  ReplaceAuthorizationGrantsInput,
  VerifiedIdentityLinkInput
} from "@pc/application";
import type {
  AuthorizationGrant,
  ExternalIdentityLink,
  PCPrincipal,
  PilotAccount,
  PilotSession
} from "@pc/domain";
import { IdentityAuthorizationError } from "@pc/domain";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryIdentityAuthorizationRepository
implements IdentityAuthorizationRepository {
  private readonly principals = new Map<string, PCPrincipal>();
  private readonly links = new Map<string, ExternalIdentityLink>();
  private readonly accounts = new Map<string, PilotAccount>();
  private readonly sessions = new Map<string, PilotSession>();
  private readonly grants = new Map<string, AuthorizationGrant[]>();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  async resolveExternalPrincipal(input: ExternalIdentityKey, now: string): Promise<ExternalIdentityBinding> {
    const index = this.linkIndex(input.issuer, input.external_subject, input.tenant_or_org_ref);
    const existing = this.links.get(index);
    if (existing) {
      if (existing.status !== "verified" || existing.identity_provider_ref !== input.identity_provider_ref) {
        throw new IdentityAuthorizationError("PC_IDENTITY_LINK_UNVERIFIED", "Existing identity link is unavailable");
      }
      return { principal: clone(this.requirePrincipal(existing.principal_id)), identity_link: clone(existing),
        legacy_account_keys: [...this.accounts.values()].filter(a => a.principal_id === existing.principal_id).map(a => a.account_key) };
    }
    const principalId = randomUUID(), linkId = randomUUID();
    const principal: PCPrincipal = { principal_id: principalId, principal_type: "human", tenant_id: input.tenant_or_org_ref,
      lifecycle_status: "active", primary_identity_ref: linkId, identity_revision: 1, authorization_revision: 1, created_at: now, updated_at: now };
    const link: ExternalIdentityLink = { ...input, principal_id: principalId, identity_link_id: linkId,
      status: "verified", link_method: "signed_idp_callback", verification_level: "signed_idp_callback",
      identity_link_revision: 1, created_at: now, updated_at: now };
    this.principals.set(principalId, principal); this.links.set(index, link);
    return { principal: clone(principal), identity_link: clone(link), legacy_account_keys: [] };
  }

  async listExternalBindings(provider: string, issuer: string, tenant: string): Promise<ExternalIdentityBinding[]> {
    return [...this.links.values()].filter(l => l.identity_provider_ref === provider && l.issuer === issuer && l.tenant_or_org_ref === tenant)
      .map(link => ({ principal: clone(this.requirePrincipal(link.principal_id)), identity_link: clone(link),
        legacy_account_keys: [...this.accounts.values()].filter(a => a.principal_id === link.principal_id).map(a => a.account_key) }));
  }

  async revokeSession(contextId: string, now: string): Promise<void> {
    for (const [key, session] of this.sessions) if (session.authentication_context_id === contextId) {
      this.sessions.set(key, { ...session, revoked_at: now });
    }
  }

  provisionPilotAccount(
    input: ProvisionPilotAccountInput & { readonly secret_hash: string },
    now: string
  ): Promise<{
    principal: PCPrincipal;
    identity_link: ExternalIdentityLink;
    pilot_account: PilotAccount;
  }> {
    const accountIndex = this.accountIndex(input.tenant_id, input.account_key);
    if (this.accounts.has(accountIndex)) {
      throw new IdentityAuthorizationError(
        "PC_PILOT_ACCOUNT_EXISTS",
        "Pilot account already exists"
      );
    }
    const principalId = randomUUID();
    const linkId = randomUUID();
    const principal: PCPrincipal = {
      principal_id: principalId,
      principal_type: "human",
      tenant_id: input.tenant_id,
      lifecycle_status: "active",
      primary_identity_ref: linkId,
      identity_revision: 1,
      authorization_revision: 1,
      created_at: now,
      updated_at: now
    };
    const link: ExternalIdentityLink = {
      identity_link_id: linkId,
      principal_id: principalId,
      identity_provider_ref: "pc-pilot",
      issuer: "process-copilot",
      external_subject: input.account_key,
      tenant_or_org_ref: input.tenant_id,
      link_method: "pilot_bootstrap",
      verification_level: "pilot_bootstrap",
      status: "verified",
      identity_link_revision: 1,
      created_at: now,
      updated_at: now
    };
    const account: PilotAccount = {
      pilot_account_id: randomUUID(),
      tenant_id: input.tenant_id,
      account_key: input.account_key,
      principal_id: principalId,
      secret_hash: input.secret_hash,
      status: "active",
      created_at: now,
      updated_at: now
    };
    this.principals.set(principalId, principal);
    this.links.set(this.linkIndex(
      link.issuer,
      link.external_subject,
      link.tenant_or_org_ref
    ), link);
    this.accounts.set(accountIndex, account);
    return Promise.resolve({
      principal: clone(principal),
      identity_link: clone(link),
      pilot_account: clone(account)
    });
  }

  getPilotAccount(
    tenantId: string,
    accountKey: string
  ): Promise<PilotAccount | undefined> {
    const account = this.accounts.get(this.accountIndex(tenantId, accountKey));
    return Promise.resolve(account === undefined ? undefined : clone(account));
  }

  getPrincipal(principalId: string): Promise<PCPrincipal | undefined> {
    const principal = this.principals.get(principalId);
    return Promise.resolve(principal === undefined ? undefined : clone(principal));
  }

  findVerifiedIdentityLink(
    principalId: string,
    identityProviderRef: string
  ): Promise<ExternalIdentityLink | undefined> {
    const links = [...this.links.values()].filter((candidate) =>
      candidate.principal_id === principalId
      && candidate.identity_provider_ref === identityProviderRef
      && candidate.status === "verified"
    );
    return Promise.resolve(links.length === 1 ? clone(links[0]!) : undefined);
  }

  createPilotSession(session: PilotSession): Promise<void> {
    this.sessions.set(session.token_digest, clone(session));
    return Promise.resolve();
  }

  findPilotSession(
    tokenDigest: string,
    now: string
  ): Promise<PilotSession | undefined> {
    const session = this.sessions.get(tokenDigest);
    if (
      session === undefined
      || session.revoked_at !== undefined
      || Date.parse(session.expires_at) <= Date.parse(now)
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(clone(session));
  }

  linkVerifiedIdentity(
    input: VerifiedIdentityLinkInput,
    now: string
  ): Promise<{ principal: PCPrincipal; identity_link: ExternalIdentityLink }> {
    const principal = this.requirePrincipal(input.principal_id);
    if (principal.identity_revision !== input.expected_identity_revision) {
      throw new IdentityAuthorizationError(
        "PC_IDENTITY_REVISION_CONFLICT",
        "Principal identity revision changed",
        true
      );
    }
    const index = this.linkIndex(
      input.issuer,
      input.external_subject,
      input.tenant_or_org_ref
    );
    const existing = this.links.get(index);
    if (existing !== undefined && existing.principal_id !== principal.principal_id) {
      throw new IdentityAuthorizationError(
        "PC_IDENTITY_LINK_CONFLICT",
        "External identity is already linked to another Principal"
      );
    }
    const link: ExternalIdentityLink = {
      identity_link_id: existing?.identity_link_id ?? randomUUID(),
      principal_id: principal.principal_id,
      identity_provider_ref: input.identity_provider_ref,
      issuer: input.issuer,
      external_subject: input.external_subject,
      tenant_or_org_ref: input.tenant_or_org_ref,
      link_method: input.verification_level,
      verification_level: input.verification_level,
      status: "verified",
      identity_link_revision: (existing?.identity_link_revision ?? 0) + 1,
      created_at: existing?.created_at ?? now,
      updated_at: now
    };
    const updated: PCPrincipal = {
      ...principal,
      identity_revision: principal.identity_revision + 1,
      authorization_revision: principal.authorization_revision + 1,
      updated_at: now
    };
    this.links.set(index, link);
    this.principals.set(updated.principal_id, updated);
    return Promise.resolve({
      principal: clone(updated),
      identity_link: clone(link)
    });
  }

  replaceAuthorizationGrants(
    input: ReplaceAuthorizationGrantsInput,
    now: string
  ): Promise<PCPrincipal> {
    const principal = this.requirePrincipal(input.principal_id);
    if (
      principal.authorization_revision
      !== input.expected_authorization_revision
    ) {
      throw new IdentityAuthorizationError(
        "PC_AUTHORIZATION_REVISION_CONFLICT",
        "Principal authorization revision changed",
        true
      );
    }
    const grants = input.grants.map((grant) => ({
      ...grant,
      grant_id: randomUUID(),
      principal_id: principal.principal_id
    }));
    const updated: PCPrincipal = {
      ...principal,
      authorization_revision: principal.authorization_revision + 1,
      updated_at: now
    };
    this.grants.set(principal.principal_id, grants);
    this.principals.set(principal.principal_id, updated);
    return Promise.resolve(clone(updated));
  }

  listAuthorizationGrants(principalId: string): Promise<AuthorizationGrant[]> {
    return Promise.resolve(clone(this.grants.get(principalId) ?? []));
  }

  private requirePrincipal(principalId: string): PCPrincipal {
    const principal = this.principals.get(principalId);
    if (principal === undefined) {
      throw new IdentityAuthorizationError(
        "PC_PRINCIPAL_NOT_FOUND",
        "Principal was not found"
      );
    }
    return principal;
  }

  private accountIndex(tenantId: string, accountKey: string): string {
    return `${tenantId}\u0000${accountKey}`;
  }

  private linkIndex(
    issuer: string,
    externalSubject: string,
    tenantOrOrgRef: string
  ): string {
    return `${issuer}\u0000${externalSubject}\u0000${tenantOrOrgRef}`;
  }
}
