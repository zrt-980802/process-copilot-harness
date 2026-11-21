// Contract-only reference oracle. Never imported by production code or exported by the package.
import { createHash } from "node:crypto";
import type { C67Contract, C68Contract, C69Contract } from "../../src/generated/contracts.js";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function seal<T extends Record<string, unknown>>(value: T, key: string): T {
  const content = { ...value };
  delete content[key];
  return { ...value, [key]: `sha256:${createHash("sha256").update(canonical(content)).digest("hex")}` };
}

export interface SessionContext {
  now: string;
  event: "ISSUE" | "OBSERVE" | "IDLE_RENEW" | "REAUTHENTICATE";
  providerAvailable: boolean;
  identityRevision: number;
  authorizationRevision: number;
  pcMaxLifetimeMsAtIssue: number;
  previous?: C67Contract;
}

export function sessionOutcome(session: C67Contract, context: SessionContext): "ALLOW" | "DENY" {
  if (seal(session, "assurance_digest").assurance_digest !== session.assurance_digest) return "DENY";
  const issued = Date.parse(session.issued_at);
  const absolute = Date.parse(session.absolute_expires_at);
  const limit = Date.parse(session.pc_absolute_limit_at);
  const now = Date.parse(context.now);
  if (![issued, absolute, limit, now].every(Number.isFinite) || absolute <= issued
    || !Number.isFinite(context.pcMaxLifetimeMsAtIssue) || context.pcMaxLifetimeMsAtIssue <= 0
    || absolute > limit || limit > issued + context.pcMaxLifetimeMsAtIssue || now < issued || now >= absolute
    || session.session_state !== "ACTIVE" || session.revoked_at
    || session.identity_revision !== context.identityRevision
    || session.authorization_revision !== context.authorizationRevision) return "DENY";
  if (session.idle_expires_at && (!Number.isFinite(Date.parse(session.idle_expires_at))
    || Date.parse(session.idle_expires_at) > absolute || Date.parse(session.idle_expires_at) <= now)) return "DENY";
  if (session.authentication_method === "PROVIDER") {
    const evidenceExpiry = Date.parse(session.authentication_evidence_expires_at ?? "");
    if (!Number.isFinite(evidenceExpiry) || absolute > evidenceExpiry
      || (!context.providerAvailable && context.event !== "OBSERVE")) return "DENY";
  }
  if (context.previous) {
    const previous = context.previous;
    if (context.event === "REAUTHENTICATE") {
      if (session.pc_session_id === previous.pc_session_id) return "DENY";
    } else {
      // Only idle expiry, state/revocation and digest may change on an existing assurance.
      for (const key of Object.keys(previous)) {
        if (!["idle_expires_at", "session_state", "revoked_at", "assurance_digest"].includes(key)
          && canonical(session[key]) !== canonical(previous[key])) return "DENY";
      }
      if (previous.session_state !== "ACTIVE" || previous.revoked_at
        || Date.parse(previous.absolute_expires_at) <= now
        || (previous.idle_expires_at && Date.parse(previous.idle_expires_at) <= now)) return "DENY";
    }
  }
  return "ALLOW";
}

export interface DecisionContext {
  now: string;
  requestStartedAt: string;
  session: C67Contract;
  pcPolicyRevision: number;
  binding: Pick<C68Contract, "logical_request_id" | "turn_id" | "tool_call_id" | "principal_id" |
    "tenant_id" | "pc_session_id" | "action" | "resource_ref" | "resource_authority">;
  generation: string;
  providerId: string;
  compatibilityVersion: string;
  providerAvailable: boolean;
  providerCallCount: number;
  source: {
    ref: string; decision: "ALLOW" | "DENY" | "UNKNOWN"; observedAt: string;
    expiresAt: string; revoked: boolean; generation: string; mappingReleaseId: string;
    binding: DecisionContext["binding"];
  };
  mappings: C69Contract[];
}

function matches(pattern: string, action: string): boolean {
  return pattern.endsWith(".*") ? action.startsWith(pattern.slice(0, -1)) : pattern === action;
}

export function mappingOutcome(mapping: C69Contract, previous?: C69Contract): "ALLOW" | "DENY" {
  if (seal(mapping, "artifact_digest").artifact_digest !== mapping.artifact_digest) return "DENY";
  if (previous?.status === "ACTIVE" && mapping.mapping_release_id === previous.mapping_release_id
    && canonical(mapping) !== canonical(previous)) return "DENY";
  if (previous && mapping.mapping_release_id !== previous.mapping_release_id
    && (mapping.artifact_digest === previous.artifact_digest
      || mapping.supersedes_release_id !== previous.mapping_release_id)) return "DENY";
  return "ALLOW";
}

export function decisionOutcome(decision: C68Contract, context: DecisionContext): "ALLOW" | "DENY" {
  if (seal(decision, "decision_digest").decision_digest !== decision.decision_digest) return "DENY";
  if (![context.now, context.requestStartedAt, context.session.issued_at,
    context.session.absolute_expires_at, decision.observed_at, decision.expires_at]
    .every((value) => Number.isFinite(Date.parse(value)))) return "DENY";
  if (decision.decision === "DENY" || decision.decision_mode === "DENY_UNKNOWN"
    || decision.pc_decision !== "ALLOW" || decision.pc_scope_decision !== "ALLOW"
    || decision.pc_policy_revision !== context.pcPolicyRevision
    || decision.identity_revision !== context.session.identity_revision
    || context.session.session_state !== "ACTIVE" || context.session.revoked_at
    || Date.parse(context.session.absolute_expires_at) <= Date.parse(context.now)
    || (context.session.idle_expires_at && Date.parse(context.session.idle_expires_at) <= Date.parse(context.now))
    || decision.principal_id !== context.session.principal_id
    || decision.tenant_id !== context.session.tenant_id || decision.pc_session_id !== context.session.pc_session_id
    || canonical(Object.fromEntries(Object.keys(context.binding).map((key) => [key, decision[key]]))) !== canonical(context.binding)
    || Date.parse(decision.observed_at) < Date.parse(context.requestStartedAt)
    || Date.parse(decision.observed_at) > Date.parse(context.now)
    || Date.parse(decision.expires_at) <= Date.parse(context.now)) return "DENY";
  if (decision.decision_mode === "PC_ONLY") {
    const pcActions = ["conversation.run", "personal_task.read", "personal_task.write",
      "memory.personal.read", "memory.personal.write", "profile.use", "plugin.use"];
    return decision.resource_authority === "pc" && context.providerCallCount === 0
      && pcActions.includes(decision.action)
      && Object.keys(decision).every((key) => !key.startsWith("provider_"))
      && decision.evidence_refs.length > 0
      && decision.evidence_refs.every((ref) => typeof ref === "string" && ref.startsWith("pc:")) ? "ALLOW" : "DENY";
  }
  const candidates = context.mappings.filter((mapping) => mapping.status === "ACTIVE"
    && matches(mapping.pc_action_pattern, decision.action));
  if (candidates.length !== 1) return "DENY";
  const mapping = candidates[0]!;
  const source = context.source;
  if (![source.observedAt, source.expiresAt, mapping.effective_from]
    .every((value) => Number.isFinite(Date.parse(value)))) return "DENY";
  if (decision.decision_mode !== "PC_AND_PROVIDER" || decision.resource_authority === "pc"
    || decision.resource_authority !== mapping.resource_authority
    || mapping.provider_registration_id !== context.providerId
    || mapping.compatibility_version !== context.compatibilityVersion
    || Date.parse(mapping.effective_from) > Date.parse(context.now)
    || mappingOutcome(mapping) !== "ALLOW"
    || decision.provider_mapping_release_id !== mapping.mapping_release_id
    || decision.provider_registration_id !== context.providerId
    || !context.providerAvailable || context.providerCallCount !== 1
    || decision.provider_bundle_generation !== context.generation || source.generation !== context.generation
    || decision.provider_decision !== "ALLOW" || source.decision !== "ALLOW" || source.revoked
    || source.mappingReleaseId !== mapping.mapping_release_id
    || source.ref !== decision.provider_decision_ref
    || decision.provider_decision_observed_at !== source.observedAt
    || Date.parse(source.observedAt) < Date.parse(context.requestStartedAt)
    || Date.parse(source.observedAt) > Date.parse(context.now)
    || Date.parse(source.expiresAt) <= Date.parse(context.now)
    || canonical(source.binding) !== canonical(context.binding)
    || !decision.evidence_refs.includes(source.ref)
    || !decision.evidence_refs.includes(`provider-call:${decision.logical_request_id}`)) return "DENY";
  return "ALLOW";
}

export function legacyOutcome(input: {
  page: string; effects: Record<string, string>; baseline: string[];
  member: boolean; objectAllow: boolean; toolAllow: boolean;
}): { decision: "ALLOW" | "DENY"; source: string } {
  const exact = input.effects[input.page];
  const wildcard = input.effects["page:*"];
  if (exact === "deny" || wildcard === "deny" || !input.member || !input.objectAllow || !input.toolAllow) {
    return { decision: "DENY", source: "deny" };
  }
  if (exact === "allow") return { decision: "ALLOW", source: "role" };
  return wildcard === "allow" && input.baseline.includes(input.page)
    ? { decision: "ALLOW", source: "baseline" } : { decision: "DENY", source: "deny" };
}
