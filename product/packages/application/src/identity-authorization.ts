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
  PrincipalEnvelope
} from "@pc/domain";
import { IdentityAuthorizationError } from "@pc/domain";

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
}

export interface ExternalAuthorizationPort {
  evaluate(input: {
    readonly principal: PCPrincipal;
    readonly action: string;
    readonly resource_scope_refs: readonly string[];
    readonly observed_at: string;
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
  createPilotSession(session: PilotSession): Promise<void>;
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

export class IdentityAuthorizationService {
  private sessionValidator?: (session: PilotSession, principal: PCPrincipal) => Promise<void>;
  private readonly registeredExternalAuthorizationPorts:
    ExternalAuthorizationPort[];

  constructor(
    private readonly repository: IdentityAuthorizationRepository,
    private readonly envelopeSigningKey: string,
    externalAuthorizationPorts: readonly ExternalAuthorizationPort[] = [],
    private readonly now: () => Date = () => new Date()
  ) {
    if (envelopeSigningKey.length < 32) {
      throw new IdentityAuthorizationError(
        "PC_ENVELOPE_SIGNING_KEY_WEAK",
        "Principal Envelope signing key must be at least 32 characters"
      );
    }
    this.registeredExternalAuthorizationPorts = [
      ...externalAuthorizationPorts
    ];
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
    ttlMs = DEFAULT_SESSION_TTL_MS
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
      expires_at: new Date(now.getTime() + ttlMs).toISOString()
    };
    await this.repository.createPilotSession(session);
    return {
      access_token: token,
      token_type: "Bearer",
      expires_at: session.expires_at,
      authentication_context_id: session.authentication_context_id,
      principal
    };
  }

  async authenticate(accessToken: string): Promise<{
    session: PilotSession;
    principal: PCPrincipal;
  }> {
    const session = await this.repository.findPilotSession(
      tokenDigest(requiredText(accessToken, "access_token")),
      this.now().toISOString()
    );
    if (session === undefined) {
      throw new IdentityAuthorizationError(
        "PC_AUTHENTICATION_REQUIRED",
        "Pilot session is missing, expired or revoked"
      );
    }
    const principal = await this.requireActivePrincipal(session.principal_id);
    await this.sessionValidator?.(session, principal);
    return { session, principal };
  }

  registerSessionValidator(validator: (session: PilotSession, principal: PCPrincipal) => Promise<void>): void {
    this.sessionValidator = validator;
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
    await this.repository.createPilotSession(session);
    return { access_token: accessToken, token_type: "Bearer", expires_at: session.expires_at,
      authentication_context_id: session.authentication_context_id, principal };
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
    this.registeredExternalAuthorizationPorts.push(port);
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
    const { principal } = await this.authenticate(accessToken);
    return this.evaluateAuthorization(principal, input);
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
      if (action === "conversation.run" && scopeRefs.length === 1
        && scopeRefs[0] === `user:${principal.principal_id}` && input.tool_release_ids.length === 0) {
        const deny = grants.find(grant => grant.effect === "deny" && (grant.action === action || grant.action === "*") && scopeMatches(grant, scopeRefs));
        if (deny) reasonCodes.push(`pc_explicit_deny:${action}`);
        else { allowedActions.push(action); evidenceRefs.add("pc-policy:active-principal-personal-conversation:1"); }
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
      let externalAllowed = true;
      for (const port of this.registeredExternalAuthorizationPorts) {
        const decision = await port.evaluate({
          principal,
          action,
          resource_scope_refs: scopeRefs,
          observed_at: observedAt
        });
        decision.reason_codes.forEach((code) => reasonCodes.push(code));
        decision.evidence_refs.forEach((ref) => evidenceRefs.add(ref));
        if (decision.decision !== "ALLOW") externalAllowed = false;
      }
      if (externalAllowed) allowedActions.push(action);
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
