import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import type {
  AuthorizationGrant,
  AuthorizationSnapshot,
  ExternalIdentityLink,
  IdentityVerificationLevel,
  PCPrincipal,
  PilotAccount,
  PilotSession,
  SessionAssurance,
  SessionAssuranceRecord,
  PrincipalEnvelope
} from "@pc/domain";
import { IdentityAuthorizationError, sealSessionAssurance, validateSessionAssurance } from "@pc/domain";
import { AuthorityRouter } from "./authority-router.js";
import { authorizationRequestContext } from "./authorization-context.js";
import type { AuthorityDecision, AuthorityDecisionInput, PcAuthorityDecisionService } from "./authority-decision.js";
import type { ProviderCompatibilityMapping } from "./compatibility-mapping.js";
import type {
  ProviderAttempt,
  ProviderFailureKind,
  ProviderHealthObservation,
  ProviderPortKind
} from "./provider-health.js";

export interface ProvisionPilotAccountInput {
  readonly tenant_id: string;
  readonly account_key: string;
  readonly secret: string;
}

export interface VerifiedIdentityLinkInput {
  readonly principal_id: string;
  readonly identity_provider_ref: string;
  readonly issuer: string;
  readonly external_subject: string;
  readonly tenant_or_org_ref: string;
  readonly verification_level: IdentityVerificationLevel;
  readonly expected_identity_revision: number;
}

export interface ExternalIdentityKey {
  readonly identity_provider_ref: string;
  readonly issuer: string;
  readonly external_subject: string;
  readonly tenant_or_org_ref: string;
}

export interface ExternalIdentityBinding {
  readonly principal: PCPrincipal;
  readonly identity_link: ExternalIdentityLink;
  readonly legacy_account_keys: string[];
}

export interface ReplaceAuthorizationGrantsInput {
  readonly principal_id: string;
  readonly expected_authorization_revision: number;
  readonly grants: readonly Omit<AuthorizationGrant, "grant_id" | "principal_id">[];
}

export interface IssueAuthorizationSnapshotInput {
  readonly pc_session_id?: string;
  readonly execution_session_id?: string;
  readonly tool_call_id?: string;
  readonly turn_id?: string;
  readonly credential_generation?: number;
  readonly connector_id?: string;
  readonly resource_authority?: string;
  readonly actions: readonly string[];
  readonly resource_scope_refs: readonly string[];
  readonly tool_release_ids: readonly string[];
  readonly policy_model_revision: number;
  readonly profile_release_id?: string;
  readonly ttl_ms?: number;
}

export interface IssuePrincipalEnvelopeInput {
  readonly snapshot: AuthorizationSnapshot;
  readonly audience: string;
  readonly pc_session_id: string;
  readonly business_task_id?: string;
  readonly runtime_id: string;
  readonly runtime_epoch: number;
  readonly assignment_generation: number;
  readonly fencing_token?: string;
  readonly credential_generation?: number;
  readonly resource_scope_refs: readonly string[];
  readonly ttl_ms?: number;
}

export interface ExternalAuthorizationDecision {
  readonly decision: "ALLOW" | "DENY";
  readonly reason_codes: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly source?: { readonly decision_ref: string; readonly observed_at: string; readonly expires_at?: string };
}

export interface ExternalAuthorizationPort {
  evaluate(input: {
    readonly principal: PCPrincipal;
    readonly action: string;
    readonly resource_scope_refs: readonly string[];
    readonly observed_at: string;
    readonly compatibility_mapping?: ProviderCompatibilityMapping;
  }): Promise<ExternalAuthorizationDecision>;
}

export interface IdentityAuthorizationRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  resolveExternalPrincipal(input: ExternalIdentityKey, now: string): Promise<ExternalIdentityBinding>;
  listExternalBindings(provider: string, issuer: string, tenant: string): Promise<ExternalIdentityBinding[]>;
  revokeSession(authenticationContextId: string, now: string): Promise<void>;
  provisionPilotAccount(
    input: ProvisionPilotAccountInput & { readonly secret_hash: string },
    now: string
  ): Promise<{
    principal: PCPrincipal;
    identity_link: ExternalIdentityLink;
    pilot_account: PilotAccount;
  }>;
  getPilotAccount(
    tenantId: string,
    accountKey: string
  ): Promise<PilotAccount | undefined>;
  getPrincipal(principalId: string): Promise<PCPrincipal | undefined>;
  findVerifiedIdentityLink(
    principalId: string,
    identityProviderRef: string
  ): Promise<ExternalIdentityLink | undefined>;
  createPilotSession(session: PilotSession, assurance?: SessionAssuranceRecord): Promise<void>;
  getSessionAssurance(authenticationContextId: string): Promise<SessionAssuranceRecord | undefined>;
  getSessionAssuranceByPcSessionId(pcSessionId: string): Promise<SessionAssuranceRecord | undefined>;
  getPilotSessionByContext(contextId: string): Promise<PilotSession | undefined>;
  getPilotAccountById(accountId: string): Promise<PilotAccount | undefined>;
  findPilotSession(
    tokenDigest: string,
    now: string
  ): Promise<PilotSession | undefined>;
  linkVerifiedIdentity(
    input: VerifiedIdentityLinkInput,
    now: string
  ): Promise<{ principal: PCPrincipal; identity_link: ExternalIdentityLink }>;
  replaceAuthorizationGrants(
    input: ReplaceAuthorizationGrantsInput,
    now: string
  ): Promise<PCPrincipal>;
  listAuthorizationGrants(principalId: string): Promise<AuthorizationGrant[]>;
}

export interface PilotSignInResult {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_at: string;
  readonly authentication_context_id: string;
  readonly principal: PCPrincipal;
  readonly session_assurance?: SessionAssurance;
}

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_DECISION_TTL_MS = 60 * 1000;
const DEFAULT_ENVELOPE_TTL_MS = 30 * 1000;

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new IdentityAuthorizationError(
      "PC_IDENTITY_INVALID_ARGUMENT",
      `${field} is required`,
      false,
      { field }
    );
  }
  return normalized;
}

function positiveDuration(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new IdentityAuthorizationError(
      "PC_IDENTITY_INVALID_ARGUMENT",
      `${field} must be a positive integer`,
      false,
      { field }
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new IdentityAuthorizationError(
        "PC_AUTHORIZATION_NON_CANONICAL_VALUE",
        "Authorization data contains a non-finite number"
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new IdentityAuthorizationError(
    "PC_AUTHORIZATION_NON_CANONICAL_VALUE",
    "Authorization data must be JSON-compatible"
  );
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(secret, salt, 32);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

function verifySecret(secret: string, encoded: string): boolean {
  const [saltHex, digestHex] = encoded.split(":");
  if (saltHex === undefined || digestHex === undefined) return false;
  const expected = Buffer.from(digestHex, "hex");
  const actual = scryptSync(secret, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    freeze(child);
  }
  return value;
}

function scopeMatches(
  grant: AuthorizationGrant,
  resourceScopeRefs: readonly string[]
): boolean {
  if (grant.scope_type === "global") return grant.scope_id === "*";
  return resourceScopeRefs.includes(`${grant.scope_type}:${grant.scope_id}`);
}

function isPersonalConversation(
  principal: PCPrincipal,
  action: string,
  scopeRefs: readonly string[],
  toolReleaseIds: readonly string[]
): boolean {
  return action === "conversation.run"
    && scopeRefs.length === 1
    && scopeRefs[0] === `user:${principal.principal_id}`
    && toolReleaseIds.length === 0;
}

export class IdentityAuthorizationService {
  private decisions?: PcAuthorityDecisionService;
  private executionSessionResolver?: (sessionId: string) => Promise<string | undefined>;
  private decisionHistory?: (sessionId: string) => Promise<AuthorityDecision[]>;
  private providerSessionValidator?: (session: PilotSession, principal: PCPrincipal) => Promise<void>;
  private readonly authorityRouter: AuthorityRouter;

  constructor(
    private readonly repository: IdentityAuthorizationRepository,
    private readonly envelopeSigningKey: string,
    externalAuthorizationPorts: readonly ExternalAuthorizationPort[] = [],
    private readonly now: () => Date = () => new Date(),
    authorityRouter?: AuthorityRouter
  ) {
    if (envelopeSigningKey.length < 32) {
      throw new IdentityAuthorizationError(
        "PC_ENVELOPE_SIGNING_KEY_WEAK",
        "Principal Envelope signing key must be at least 32 characters"
      );
    }
    this.authorityRouter = authorityRouter ?? new AuthorityRouter();
    externalAuthorizationPorts.forEach((port) =>
      this.authorityRouter.registerProvider(port));
  }

  initialize(): Promise<void> {
    return this.repository.initialize();
  }

  close(): Promise<void> {
    return this.repository.close();
  }

  provisionPilotAccount(
    input: ProvisionPilotAccountInput
  ): Promise<{
    principal: PCPrincipal;
    identity_link: ExternalIdentityLink;
    pilot_account: PilotAccount;
  }> {
    const tenantId = requiredText(input.tenant_id, "tenant_id");
    const accountKey = requiredText(input.account_key, "account_key");
    if (input.secret.length < 12) {
      throw new IdentityAuthorizationError(
        "PC_PILOT_SECRET_WEAK",
        "Pilot account secret must be at least 12 characters"
      );
    }
    return this.repository.provisionPilotAccount(
      {
        tenant_id: tenantId,
        account_key: accountKey,
        secret: "",
        secret_hash: hashSecret(input.secret)
      },
      this.now().toISOString()
    );
  }

  async signInPilot(
    tenantId: string,
    accountKey: string,
    secret: string,
    ttlMs = DEFAULT_SESSION_TTL_MS,
    method: "LOCAL" | "STANDALONE" = "LOCAL"
  ): Promise<PilotSignInResult> {
    positiveDuration(ttlMs, "ttl_ms");
    const account = await this.repository.getPilotAccount(
      requiredText(tenantId, "tenant_id"),
      requiredText(accountKey, "account_key")
    );
    if (
      account === undefined
      || account.status !== "active"
      || !verifySecret(secret, account.secret_hash)
    ) {
      throw new IdentityAuthorizationError(
        "PC_PILOT_AUTHENTICATION_FAILED",
        "Pilot account authentication failed"
      );
    }
    const principal = await this.requireActivePrincipal(account.principal_id);
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const session: PilotSession = {
      authentication_context_id: randomUUID(),
      principal_id: principal.principal_id,
      token_digest: tokenDigest(token),
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + Math.min(ttlMs, DEFAULT_SESSION_TTL_MS)).toISOString()
    };
    const assurance = sealSessionAssurance({ contract_name: "pc.session-assurance/1", contract_version: 1,
      session_assurance_id: `assurance:${randomUUID()}`, pc_session_id: `pc-session:${randomUUID()}`,
      principal_id: principal.principal_id, tenant_id: principal.tenant_id, authentication_method: method,
      identity_provider_ref: method === "LOCAL" ? "local" : "standalone", identity_revision: principal.identity_revision,
      authorization_revision: principal.authorization_revision, assurance_level: "LOCAL_VERIFIED", issued_at: session.issued_at,
      pc_absolute_limit_at: new Date(now.getTime() + DEFAULT_SESSION_TTL_MS).toISOString(), absolute_expires_at: session.expires_at,
      session_state: "ACTIVE", evidence_refs: ["pc:authentication:native"] });
    await this.repository.createPilotSession(session, { assurance, authentication_context_id: session.authentication_context_id,
      pilot_account_id: account.pilot_account_id, record_version: 1 });
    return {
      access_token: token,
      token_type: "Bearer",
      expires_at: session.expires_at,
      authentication_context_id: session.authentication_context_id,
      principal,
      session_assurance: assurance
    };
  }

  async authenticate(accessToken: string): Promise<{
    session: PilotSession;
    principal: PCPrincipal;
    assurance: SessionAssurance;
  }> {
    const session = await this.repository.findPilotSession(
      tokenDigest(requiredText(accessToken, "access_token")),
      this.now().toISOString()
    );
    if (session === undefined || session.revoked_at !== undefined
      || !Number.isFinite(Date.parse(session.expires_at))
      || Date.parse(session.expires_at) <= this.now().getTime()) {
      throw new IdentityAuthorizationError(
        "PC_AUTHENTICATION_REQUIRED",
        "Pilot session is missing, expired or revoked"
      );
    }
    const principal = await this.requireActivePrincipal(session.principal_id);
    if (session.authentication_context_id.startsWith("ee:")) {
      const link = await this.repository.findVerifiedIdentityLink(principal.principal_id, "eeclaw");
      if (!/^ee:[0-9a-f-]{36}:[0-9a-f-]{36}$/u.test(session.authentication_context_id)
        || !link || link.status !== "verified" || link.principal_id !== principal.principal_id
        || link.identity_provider_ref !== "eeclaw" || link.tenant_or_org_ref !== principal.tenant_id
        || !link.issuer || !link.external_subject) {
        throw new IdentityAuthorizationError("PC_IDENTITY_LINK_UNVERIFIED", "PC Session requires an unambiguous verified local identity link");
      }
    }
    const record = await this.repository.getSessionAssurance(session.authentication_context_id);
    if (!record) throw new IdentityAuthorizationError("PC_SESSION_ASSURANCE_REQUIRED", "Sign in again to establish a current Session");
    const assurance = validateSessionAssurance(record, session, principal, this.now().toISOString(),
      record.assurance.authentication_method === "PROVIDER"
        ? await this.repository.findVerifiedIdentityLink(principal.principal_id, record.assurance.identity_provider_ref) : undefined,
      record.pilot_account_id ? await this.repository.getPilotAccountById(record.pilot_account_id) : undefined);
    const context = authorizationRequestContext();
    if (context) {
      if (context.principal_id && context.principal_id !== principal.principal_id) {
        throw new IdentityAuthorizationError("PC_SESSION_ASSURANCE_DENIED", "Request identity changed");
      }
      context.principal_id = principal.principal_id; context.pc_session_id = assurance.pc_session_id;
    }
    return { session, principal, assurance };
  }

  registerAuthorityDecisions(service: PcAuthorityDecisionService): void { this.decisions = service; }
  get authorityDecisionsEnabled(): boolean { return this.decisions !== undefined; }

  registerDecisionHistory(history: (sessionId: string) => Promise<AuthorityDecision[]>): void {
    this.decisionHistory = history;
  }

  async currentSessionView(accessToken: string) {
    const { assurance, principal } = await this.authenticate(accessToken);
    const record = await this.repository.getSessionAssuranceByPcSessionId(assurance.pc_session_id);
    const account = record?.pilot_account_id ? await this.repository.getPilotAccountById(record.pilot_account_id) : undefined;
    return { principal_id: principal.principal_id, account_name: account?.account_key ?? "PC account",
      session: { state: assurance.session_state, pc_session_id: assurance.pc_session_id, expires_at: assurance.absolute_expires_at,
        identity_revision: assurance.identity_revision, authorization_revision: assurance.authorization_revision },
      assurance_ref: assurance.session_assurance_id };
  }

  async recentAuthorityDecisions(accessToken: string) {
    const { assurance, principal } = await this.authenticate(accessToken);
    const history = await this.decisionHistory?.(assurance.pc_session_id) ?? [];
    return history.filter(decision => decision.pc_session_id === assurance.pc_session_id && decision.principal_id === principal.principal_id
      && decision.tenant_id === principal.tenant_id).slice(-20);
  }

  currentVerifiedIdentityLink(principalId: string, provider: string) {
    return this.repository.findVerifiedIdentityLink(principalId, provider);
  }

  get authorityRouterForDecisions(): AuthorityRouter { return this.authorityRouter; }

  async decideAuthority(accessToken: string, input: Omit<AuthorityDecisionInput, "principal_id" | "pc_session_id" | "execution_session_id">) {
    const { principal, assurance } = await this.authenticate(accessToken);
    if (!this.decisions) throw new IdentityAuthorizationError("PC_AUTHORITY_DECISION_UNAVAILABLE", "Authority decisions are unavailable");
    return this.decisions.decide({ ...input, principal_id: principal.principal_id, pc_session_id: assurance.pc_session_id });
  }

  registerExecutionSessionResolver(resolve: (sessionId: string) => Promise<string | undefined>): void {
    this.executionSessionResolver = resolve;
  }

  async currentAuthoritySession(input: AuthorityDecisionInput) {
    const context = authorizationRequestContext();
    const contextualSession = context?.pc_session_id ?? input.pc_session_id;
    const executionSession = !contextualSession && input.execution_session_id ? await this.executionSessionResolver?.(input.execution_session_id) : undefined;
    const pcSession = contextualSession ?? executionSession;
    if (!pcSession || (input.execution_session_id && !contextualSession && !executionSession)
      || (context?.principal_id && context.principal_id !== input.principal_id)
      || (context?.pc_session_id && input.pc_session_id && context.pc_session_id !== input.pc_session_id)) {
      throw new IdentityAuthorizationError("PC_SESSION_ASSURANCE_DENIED", "A current PC Session is required");
    }
    const record = await this.repository.getSessionAssuranceByPcSessionId(pcSession);
    const session = record ? await this.repository.getPilotSessionByContext(record.authentication_context_id) : undefined;
    if (!record || !session || record.assurance.principal_id !== input.principal_id) {
      throw new IdentityAuthorizationError("PC_SESSION_ASSURANCE_DENIED", "Session owner is unavailable");
    }
    const principal = await this.requireActivePrincipal(input.principal_id);
    const assurance = validateSessionAssurance(record, session, principal, this.now().toISOString(),
      record.assurance.authentication_method === "PROVIDER"
        ? await this.repository.findVerifiedIdentityLink(principal.principal_id, record.assurance.identity_provider_ref) : undefined,
      record.pilot_account_id ? await this.repository.getPilotAccountById(record.pilot_account_id) : undefined);
    return { principal, assurance };
  }

  async evaluatePcPolicy(principal: PCPrincipal, input: AuthorityDecisionInput): Promise<ExternalAuthorizationDecision> {
    const current = await this.requireActivePrincipal(principal.principal_id);
    const grants = await this.repository.listAuthorizationGrants(current.principal_id);
    const scopes = [...new Set(input.resource_scope_refs)];
    const matching = grants.filter(grant => (grant.action === input.action || grant.action === "*") && scopeMatches(grant, scopes));
    if (!scopes.length || matching.some(grant => grant.effect === "deny")) {
      return { decision: "DENY", reason_codes: ["pc_scope_or_explicit_deny"], evidence_refs: [] };
    }
    const personal = scopes.length === 1 && scopes[0] === `user:${current.principal_id}` && !input.tool_release_ids.length
      && ["conversation.run", "identity.read", "capability.read", "personal_task.read", "personal_task.write"].includes(input.action);
    const allowed = personal || scopes.every(scope => matching.some(grant => grant.effect === "allow" && scopeMatches(grant, [scope])));
    return { decision: allowed ? "ALLOW" : "DENY", reason_codes: [allowed ? "pc_policy_allow" : "pc_no_scope_allow"],
      evidence_refs: allowed ? [`pc:policy:${current.authorization_revision}`] : [] };
  }

  async authenticateForProvider(accessToken: string) {
    const authenticated = await this.authenticate(accessToken);
    if (authenticated.session.authentication_context_id.startsWith("ee:")) {
      if (!this.providerSessionValidator) {
        throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "Current source Session validation is unavailable");
      }
      await this.providerSessionValidator(authenticated.session, authenticated.principal);
    }
    return authenticated;
  }

  registerProviderSessionValidator(validator: (session: PilotSession, principal: PCPrincipal) => Promise<void>): void {
    this.providerSessionValidator = validator;
  }

  async signInExternal(input: ExternalIdentityKey, sessionId: string, sessionExpiresAt: string): Promise<PilotSignInResult> {
    if (input.identity_provider_ref !== "eeclaw" || !/^[0-9a-f-]{36}$/u.test(sessionId)
      || !input.issuer || !input.external_subject || !input.tenant_or_org_ref) {
      throw new IdentityAuthorizationError("PC_IDENTITY_LINK_UNVERIFIED", "Trusted EE session identity is required");
    }
    const now = this.now();
    const expires = Math.min(Date.parse(sessionExpiresAt), now.getTime() + DEFAULT_SESSION_TTL_MS);
    if (!Number.isFinite(expires) || expires <= now.getTime()) {
      throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "EE session has expired");
    }
    const binding = await this.repository.resolveExternalPrincipal(input, now.toISOString());
    const principal = await this.requireActivePrincipal(binding.principal.principal_id);
    const accessToken = randomBytes(32).toString("base64url");
    // This is a non-secret source-session reference, never an EE cookie/token.
    const session: PilotSession = { authentication_context_id: `ee:${sessionId}:${randomUUID()}`,
      principal_id: principal.principal_id, token_digest: tokenDigest(accessToken), issued_at: now.toISOString(),
      expires_at: new Date(expires).toISOString() };
    const assurance = sealSessionAssurance({ contract_name: "pc.session-assurance/1", contract_version: 1,
      session_assurance_id: `assurance:${randomUUID()}`, pc_session_id: `pc-session:${randomUUID()}`,
      principal_id: principal.principal_id, tenant_id: principal.tenant_id, authentication_method: "PROVIDER",
      identity_provider_ref: input.identity_provider_ref, identity_link_id: binding.identity_link.identity_link_id,
      identity_revision: principal.identity_revision, authorization_revision: principal.authorization_revision,
      assurance_level: "PROVIDER_VERIFIED", authentication_evidence_expires_at: new Date(sessionExpiresAt).toISOString(),
      issued_at: session.issued_at, pc_absolute_limit_at: new Date(now.getTime() + DEFAULT_SESSION_TTL_MS).toISOString(),
      absolute_expires_at: session.expires_at, session_state: "ACTIVE", evidence_refs: ["pc:authentication:provider-verified"] });
    await this.repository.createPilotSession(session, { assurance, authentication_context_id: session.authentication_context_id,
      identity_link_revision: binding.identity_link.identity_link_revision, record_version: 1 });
    return { access_token: accessToken, token_type: "Bearer", expires_at: session.expires_at,
      authentication_context_id: session.authentication_context_id, principal, session_assurance: assurance };
  }

  listExternalBindings(provider: string, issuer: string, tenant: string) {
    return this.repository.listExternalBindings(provider, issuer, tenant);
  }

  async signOut(accessToken: string): Promise<void> {
    const session = await this.repository.findPilotSession(tokenDigest(accessToken), this.now().toISOString());
    if (session) await this.repository.revokeSession(session.authentication_context_id, this.now().toISOString());
  }

  linkVerifiedIdentity(
    input: VerifiedIdentityLinkInput
  ): Promise<{ principal: PCPrincipal; identity_link: ExternalIdentityLink }> {
    if (
      ![
        "pilot_bootstrap",
        "signed_idp_callback",
        "admin_reauthentication"
      ].includes(input.verification_level)
    ) {
      throw new IdentityAuthorizationError(
        "PC_IDENTITY_LINK_UNVERIFIED",
        "Caller-supplied identity assertions cannot create an identity link"
      );
    }
    return this.repository.linkVerifiedIdentity(
      {
        ...input,
        identity_provider_ref: requiredText(
          input.identity_provider_ref,
          "identity_provider_ref"
        ),
        issuer: requiredText(input.issuer, "issuer"),
        external_subject: requiredText(
          input.external_subject,
          "external_subject"
        ),
        tenant_or_org_ref: requiredText(
          input.tenant_or_org_ref,
          "tenant_or_org_ref"
        )
      },
      this.now().toISOString()
    );
  }

  registerExternalAuthorizationPort(port: ExternalAuthorizationPort): void {
    this.authorityRouter.registerProvider(port);
  }

  get providerHealthRegistry() { return this.authorityRouter.health; }

  registerProviderHealthPorts(
    providerRegistrationId: string,
    ports: readonly ProviderPortKind[]
  ): void {
    this.authorityRouter.health.register(providerRegistrationId, ports);
  }

  markProviderCompatible(
    providerRegistrationId: string,
    evidenceRef?: string
  ): void {
    this.authorityRouter.health.markCompatible(providerRegistrationId, evidenceRef);
  }

  markProviderFailure(
    providerRegistrationId: string,
    kind: ProviderFailureKind,
    reasonCode: string,
    evidenceRef?: string
  ): void {
    this.authorityRouter.health.markFailure(
      providerRegistrationId,
      kind,
      reasonCode,
      evidenceRef
    );
  }

  providerHealth(providerRegistrationId: string): ProviderHealthObservation {
    return this.authorityRouter.health.observation(providerRegistrationId);
  }

  isProviderUsable(
    providerRegistrationId: string,
    port?: ProviderPortKind
  ): boolean {
    return this.authorityRouter.health.isUsable(providerRegistrationId, port);
  }

  beginProviderAttempt(
    providerRegistrationId: string,
    port: ProviderPortKind
  ): ProviderAttempt {
    return this.authorityRouter.health.beginAttempt(providerRegistrationId, port);
  }

  async getPilotPrincipal(
    tenantId: string,
    accountKey: string
  ): Promise<PCPrincipal | undefined> {
    const account = await this.repository.getPilotAccount(
      requiredText(tenantId, "tenant_id"),
      requiredText(accountKey, "account_key")
    );
    if (account === undefined) return undefined;
    return this.repository.getPrincipal(account.principal_id);
  }

  async resolveExternalSubject(
    principalId: string,
    identityProviderRef: string,
    trusted?: { issuer: string; tenant: string }
  ): Promise<string | undefined> {
    const link = await this.repository.findVerifiedIdentityLink(
      principalId,
      identityProviderRef
    );
    if (trusted && (link?.issuer !== trusted.issuer || link.tenant_or_org_ref !== trusted.tenant)) return undefined;
    return link?.external_subject;
  }

  replaceAuthorizationGrants(
    input: ReplaceAuthorizationGrantsInput
  ): Promise<PCPrincipal> {
    if (input.grants.length === 0) {
      throw new IdentityAuthorizationError(
        "PC_AUTHORIZATION_GRANTS_REQUIRED",
        "At least one explicit authorization grant is required"
      );
    }
    for (const grant of input.grants) {
      requiredText(grant.action, "grant.action");
      requiredText(grant.scope_id, "grant.scope_id");
      requiredText(grant.evidence_ref, "grant.evidence_ref");
    }
    return this.repository.replaceAuthorizationGrants(
      input,
      this.now().toISOString()
    );
  }

  async issueAuthorizationSnapshot(
    accessToken: string,
    input: IssueAuthorizationSnapshotInput
  ): Promise<AuthorizationSnapshot> {
    const { principal, assurance } = await this.authenticate(accessToken);
    if (this.classifyAuthorization(principal, input) === "PC_AND_PROVIDER") {
      await this.authenticateForProvider(accessToken);
    }
    return this.evaluateAuthorization(principal, { ...input, pc_session_id: assurance.pc_session_id });
  }

  classifyAuthorization(principal: PCPrincipal, input: IssueAuthorizationSnapshotInput) {
    const modes = input.actions.map(action => this.authorityRouter.authorizationMode({ principal,
      action: requiredText(action, "action"), resource_scope_refs: input.resource_scope_refs,
      tool_release_ids: input.tool_release_ids, observed_at: this.now().toISOString() }));
    if (!modes.length || modes.includes("DENY_UNKNOWN")) return "DENY_UNKNOWN";
    return modes.includes("PC_AND_PROVIDER") ? "PC_AND_PROVIDER" : "PC_ONLY";
  }

  async evaluatePrincipalAuthorization(
    input: IssueAuthorizationSnapshotInput & {
      readonly principal_id: string;
    }
  ): Promise<AuthorizationSnapshot> {
    const principal = await this.requireActivePrincipal(input.principal_id);
    return this.evaluateAuthorization(principal, input);
  }

  async verifyPrincipalEnvelope(
    envelope: PrincipalEnvelope,
    expectedAudience?: string
  ): Promise<PCPrincipal> {
    if (
      envelope.contract_name !== "pc.principal-envelope/1"
      || envelope.contract_version !== 1
      || envelope.issuer !== "process-copilot"
    ) {
      throw new IdentityAuthorizationError(
        "PC_PRINCIPAL_ENVELOPE_INVALID",
        "Principal Envelope contract or issuer is invalid"
      );
    }
    if (
      expectedAudience !== undefined
      && envelope.audience !== expectedAudience
    ) {
      throw new IdentityAuthorizationError(
        "PC_PRINCIPAL_ENVELOPE_AUDIENCE_MISMATCH",
        "Principal Envelope audience does not match the target service"
      );
    }
    const unsigned = { ...envelope } as Record<string, unknown>;
    delete unsigned.signature;
    const expectedSignature = createHmac("sha256", this.envelopeSigningKey)
      .update(canonicalJson(unsigned))
      .digest();
    let actualSignature: Buffer;
    try {
      actualSignature = Buffer.from(envelope.signature, "base64url");
    } catch {
      actualSignature = Buffer.alloc(0);
    }
    if (
      actualSignature.length !== expectedSignature.length
      || !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw new IdentityAuthorizationError(
        "PC_PRINCIPAL_ENVELOPE_SIGNATURE_INVALID",
        "Principal Envelope signature is invalid"
      );
    }
    const now = this.now().getTime();
    const issuedAt = Date.parse(envelope.issued_at);
    const expiresAt = Date.parse(envelope.expires_at);
    if (
      !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || issuedAt > now + 5_000
      || expiresAt <= now
      || expiresAt <= issuedAt
    ) {
      throw new IdentityAuthorizationError(
        "PC_PRINCIPAL_ENVELOPE_EXPIRED",
        "Principal Envelope timing window is invalid or expired"
      );
    }
    const principal = await this.requireActivePrincipal(
      envelope.subject_principal_id
    );
    if (
      principal.tenant_id !== envelope.tenant_id
      || principal.authorization_revision !== envelope.authorization_revision
    ) {
      throw new IdentityAuthorizationError(
        "PC_PRINCIPAL_ENVELOPE_STALE",
        "Principal Envelope does not match current Principal authority"
      );
    }
    return principal;
  }

  private async evaluateAuthorization(
    principal: PCPrincipal,
    input: IssueAuthorizationSnapshotInput
  ): Promise<AuthorizationSnapshot> {
    if (this.decisions) {
      const decisions = [];
      for (const action of [...new Set(input.actions.map(item => requiredText(item, "action")))].sort()) {
        decisions.push(await this.decisions.decide({ ...input, principal_id: principal.principal_id, action }));
      }
      const allowed = decisions.length > 0 && decisions.every(decision => decision.decision === "ALLOW");
      const now = this.now();
      return freeze({ contract_name: "pc.authorization-snapshot/1", contract_version: 1,
        principal_id: principal.principal_id, authorization_revision: principal.authorization_revision, policy_model_revision: input.policy_model_revision,
        ...(input.profile_release_id ? { profile_release_id: input.profile_release_id } : {}),
        allowed_actions: decisions.filter(decision => decision.decision === "ALLOW").map(decision => decision.action),
        resource_scope_digest: digest([...new Set(input.resource_scope_refs)].sort()), tool_set_digest: digest([...input.tool_release_ids].sort()),
        decision: allowed ? "ALLOW" : "DENY", reason_codes: decisions.flatMap(decision => decision.reason_codes), issued_at: now.toISOString(),
        expires_at: new Date(Math.min(now.getTime() + (input.ttl_ms ?? DEFAULT_DECISION_TTL_MS),
          ...decisions.map(decision => Date.parse(decision.expires_at)))).toISOString(),
        decision_evidence_refs: decisions.map(decision => `pc:decision:${decision.decision_id}`) } satisfies AuthorizationSnapshot);
    }
    const actions = [...new Set(input.actions.map((action) =>
      requiredText(action, "action")
    ))].sort();
    if (actions.length === 0) {
      throw new IdentityAuthorizationError(
        "PC_AUTHORIZATION_ACTIONS_REQUIRED",
        "Authorization Snapshot requires at least one action"
      );
    }
    const scopeRefs = [...new Set(input.resource_scope_refs)].sort();
    const grants = await this.repository.listAuthorizationGrants(
      principal.principal_id
    );
    const reasonCodes: string[] = [];
    const evidenceRefs = new Set<string>();
    const allowedActions: string[] = [];
    const observedAt = this.now().toISOString();

    for (const action of actions) {
      if (isPersonalConversation(
        principal,
        action,
        scopeRefs,
        input.tool_release_ids
      )) {
        const deny = grants.find(grant => grant.effect === "deny" && (grant.action === action || grant.action === "*") && scopeMatches(grant, scopeRefs));
        if (deny) reasonCodes.push(`pc_explicit_deny:${action}`);
        else {
          const routed = await this.authorityRouter.evaluate({
            principal,
            action,
            resource_scope_refs: scopeRefs,
            tool_release_ids: input.tool_release_ids,
            observed_at: observedAt
          });
          routed.reason_codes.forEach((code) => reasonCodes.push(code));
          routed.evidence_refs.forEach((ref) => evidenceRefs.add(ref));
          if (routed.decision === "ALLOW") {
            allowedActions.push(action);
            evidenceRefs.add("pc-policy:active-principal-personal-conversation:1");
          }
        }
        continue;
      }
      const matching = grants.filter((grant) =>
        (grant.action === action || grant.action === "*")
        && scopeMatches(grant, scopeRefs)
      );
      const deny = matching.find((grant) => grant.effect === "deny");
      const allow = matching.find((grant) => grant.effect === "allow");
      if (deny !== undefined) {
        reasonCodes.push(`pc_explicit_deny:${action}`);
        evidenceRefs.add(deny.evidence_ref);
        continue;
      }
      if (allow === undefined) {
        reasonCodes.push(`pc_no_matching_allow:${action}`);
        continue;
      }
      evidenceRefs.add(allow.evidence_ref);
      const routed = await this.authorityRouter.evaluate({
        principal,
        action,
        resource_scope_refs: scopeRefs,
        tool_release_ids: input.tool_release_ids,
        observed_at: observedAt
      });
      routed.reason_codes.forEach((code) => reasonCodes.push(code));
      routed.evidence_refs.forEach((ref) => evidenceRefs.add(ref));
      if (routed.decision === "ALLOW") allowedActions.push(action);
    }

    const ttlMs = positiveDuration(
      input.ttl_ms ?? DEFAULT_DECISION_TTL_MS,
      "ttl_ms"
    );
    const issuedAt = this.now();
    const allowed = allowedActions.length === actions.length;
    const projectRef = scopeRefs.find((ref) => ref.startsWith("project:"));
    const projectId = projectRef?.slice("project:".length);
    return freeze({
      contract_name: "pc.authorization-snapshot/1",
      contract_version: 1,
      authorization_revision: principal.authorization_revision,
      policy_model_revision: input.policy_model_revision,
      principal_id: principal.principal_id,
      ...(projectId === undefined ? {} : { project_id: projectId }),
      ...(input.profile_release_id === undefined
        ? {}
        : { profile_release_id: input.profile_release_id }),
      allowed_actions: allowedActions,
      resource_scope_digest: digest(scopeRefs),
      tool_set_digest: digest([...input.tool_release_ids].sort()),
      decision: allowed ? "ALLOW" : "DENY",
      reason_codes: allowed
        ? ["authorization_intersection_allowed", ...reasonCodes]
        : ["authorization_intersection_denied", ...reasonCodes],
      issued_at: issuedAt.toISOString(),
      expires_at: new Date(issuedAt.getTime() + ttlMs).toISOString(),
      decision_evidence_refs: [...evidenceRefs].sort()
    } satisfies AuthorizationSnapshot);
  }

  async issuePrincipalEnvelope(
    accessToken: string,
    input: IssuePrincipalEnvelopeInput
  ): Promise<PrincipalEnvelope> {
    const { session, principal } = await this.authenticate(accessToken);
    if (input.snapshot.decision !== "ALLOW") {
      throw new IdentityAuthorizationError(
        "PC_AUTHORIZATION_DENIED",
        "Cannot issue a Principal Envelope from a denied snapshot"
      );
    }
    if (
      input.snapshot.principal_id !== principal.principal_id
      || input.snapshot.authorization_revision
        !== principal.authorization_revision
    ) {
      throw new IdentityAuthorizationError(
        "PC_AUTHORIZATION_SNAPSHOT_STALE",
        "Authorization Snapshot does not match the current Principal revision"
      );
    }
    const now = this.now();
    if (Date.parse(input.snapshot.expires_at) <= now.getTime()) {
      throw new IdentityAuthorizationError(
        "PC_AUTHORIZATION_SNAPSHOT_EXPIRED",
        "Authorization Snapshot has expired"
      );
    }
    const ttlMs = positiveDuration(
      input.ttl_ms ?? DEFAULT_ENVELOPE_TTL_MS,
      "ttl_ms"
    );
    const unsigned = {
      contract_name: "pc.principal-envelope/1" as const,
      contract_version: 1 as const,
      envelope_id: randomUUID(),
      issuer: "process-copilot",
      audience: requiredText(input.audience, "audience"),
      tenant_id: principal.tenant_id,
      subject_principal_id: principal.principal_id,
      actor_principal_id: principal.principal_id,
      pc_session_id: requiredText(input.pc_session_id, "pc_session_id"),
      ...(input.business_task_id === undefined
        ? {}
        : {
            business_task_id: requiredText(
              input.business_task_id,
              "business_task_id"
            )
          }),
      runtime_id: requiredText(input.runtime_id, "runtime_id"),
      runtime_epoch: input.runtime_epoch,
      assignment_generation: input.assignment_generation,
      ...(input.fencing_token === undefined
        ? {}
        : {
            fencing_token: requiredText(
              input.fencing_token,
              "fencing_token"
            )
          }),
      authorization_revision: principal.authorization_revision,
      ...(input.credential_generation === undefined
        ? {}
        : { credential_generation: input.credential_generation }),
      allowed_actions: [...input.snapshot.allowed_actions],
      resource_scope_refs: [...input.resource_scope_refs].sort(),
      issued_at: now.toISOString(),
      expires_at: new Date(
        Math.min(
          now.getTime() + ttlMs,
          Date.parse(input.snapshot.expires_at),
          Date.parse(session.expires_at)
        )
      ).toISOString(),
      nonce: randomUUID()
    };
    const signature = createHmac("sha256", this.envelopeSigningKey)
      .update(canonicalJson(unsigned))
      .digest("base64url");
    return freeze({
      ...unsigned,
      signature
    } satisfies PrincipalEnvelope);
  }

  private async requireActivePrincipal(principalId: string): Promise<PCPrincipal> {
    const principal = await this.repository.getPrincipal(principalId);
    if (principal === undefined || principal.lifecycle_status !== "active") {
      throw new IdentityAuthorizationError(
        "PC_PRINCIPAL_INACTIVE",
        "Principal is unavailable or inactive"
      );
    }
    return principal;
  }
}
