import { createHash } from "node:crypto";
import { IdentityAuthorizationError, type ExternalIdentityLink, type PCPrincipal, type PilotAccount, type PilotSession } from "./identity-authorization.js";

export interface SessionAssurance {
  readonly contract_name: "pc.session-assurance/1";
  readonly contract_version: 1;
  readonly session_assurance_id: string;
  readonly pc_session_id: string;
  readonly principal_id: string;
  readonly tenant_id: string;
  readonly authentication_method: "LOCAL" | "STANDALONE" | "PROVIDER";
  readonly identity_provider_ref: string;
  readonly identity_link_id?: string;
  readonly authentication_evidence_expires_at?: string;
  readonly identity_revision: number;
  readonly authorization_revision: number;
  readonly assurance_level: "LOCAL_VERIFIED" | "PROVIDER_VERIFIED";
  readonly issued_at: string;
  readonly idle_expires_at?: string;
  readonly pc_absolute_limit_at: string;
  readonly absolute_expires_at: string;
  readonly revoked_at?: string;
  readonly session_state: "ACTIVE" | "EXPIRED" | "REVOKED";
  readonly evidence_refs: readonly string[];
  readonly assurance_digest: string;
}

export interface SessionAssuranceRecord {
  readonly assurance: SessionAssurance;
  readonly authentication_context_id: string;
  readonly identity_link_revision?: number;
  readonly pilot_account_id?: string;
  readonly record_version: number;
}

export const PC_SESSION_ABSOLUTE_LIMIT_MS = 8 * 60 * 60 * 1000;

export function canonicalEvidence(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalEvidence).join(",")}]`;
  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalEvidence(record[key])}`).join(",")}}`;
  }
  throw new IdentityAuthorizationError("PC_AUTHORIZATION_EVIDENCE_DENIED", "Invalid authorization evidence");
}

export function evidenceDigest(value: object, field: string): string {
  const unsigned = { ...value } as Record<string, unknown>;
  delete unsigned[field];
  return `sha256:${createHash("sha256").update(canonicalEvidence(unsigned)).digest("hex")}`;
}

export function sealSessionAssurance(value: Omit<SessionAssurance, "assurance_digest">): SessionAssurance {
  return { ...value, assurance_digest: evidenceDigest(value, "assurance_digest") };
}

const fields = new Set(["contract_name", "contract_version", "session_assurance_id", "pc_session_id", "principal_id", "tenant_id",
  "authentication_method", "identity_provider_ref", "identity_link_id", "authentication_evidence_expires_at", "identity_revision",
  "authorization_revision", "assurance_level", "issued_at", "idle_expires_at", "pc_absolute_limit_at", "absolute_expires_at",
  "revoked_at", "session_state", "evidence_refs", "assurance_digest"]);

export function validateSessionAssurance(record: SessionAssuranceRecord, session: PilotSession, principal: PCPrincipal,
  now: string, link?: ExternalIdentityLink, account?: PilotAccount): SessionAssurance {
  const a = record.assurance;
  function deny(): never { throw new IdentityAuthorizationError("PC_SESSION_ASSURANCE_DENIED", "Session is no longer valid; sign in again"); }
  const instant = Date.parse(now), issued = Date.parse(a.issued_at), absolute = Date.parse(a.absolute_expires_at), cap = Date.parse(a.pc_absolute_limit_at);
  if ([a.session_assurance_id, a.pc_session_id, a.principal_id, a.tenant_id, a.identity_provider_ref].some(value => typeof value !== "string" || !value.trim())
    || Object.keys(a).some(key => !fields.has(key)) || a.contract_name !== "pc.session-assurance/1" || a.contract_version !== 1
    || !a.session_assurance_id || !a.pc_session_id || a.pc_session_id === session.authentication_context_id
    || record.authentication_context_id !== session.authentication_context_id || a.principal_id !== session.principal_id
    || a.principal_id !== principal.principal_id || a.tenant_id !== principal.tenant_id || principal.lifecycle_status !== "active"
    || a.identity_revision !== principal.identity_revision || a.authorization_revision !== principal.authorization_revision
    || !Number.isInteger(a.identity_revision) || a.identity_revision < 1 || !Number.isInteger(a.authorization_revision) || a.authorization_revision < 1
    || !Number.isInteger(record.record_version) || record.record_version < 1 || a.session_state !== "ACTIVE" || a.revoked_at || session.revoked_at
    || ![instant, issued, absolute, cap].every(Number.isFinite) || issued > instant || absolute <= instant || absolute <= issued || absolute > cap
    || cap !== issued + PC_SESSION_ABSOLUTE_LIMIT_MS
    || a.issued_at !== session.issued_at || a.absolute_expires_at !== session.expires_at
    || (a.idle_expires_at !== undefined && (!Number.isFinite(Date.parse(a.idle_expires_at)) || Date.parse(a.idle_expires_at) <= instant
      || Date.parse(a.idle_expires_at) <= issued || Date.parse(a.idle_expires_at) > absolute))
    || !Array.isArray(a.evidence_refs) || a.evidence_refs.length === 0 || new Set(a.evidence_refs).size !== a.evidence_refs.length
    || a.evidence_refs.some(ref => typeof ref !== "string" || !/^pc:[a-zA-Z0-9._:-]+$/u.test(ref))
    || a.assurance_digest !== evidenceDigest(a, "assurance_digest")) deny();
  if (a.authentication_method === "PROVIDER") {
    if (!link || link.status !== "verified" || link.principal_id !== principal.principal_id || link.identity_link_id !== a.identity_link_id
      || link.identity_provider_ref !== a.identity_provider_ref || ["local", "standalone"].includes(a.identity_provider_ref)
      || !link.issuer || !link.external_subject || link.tenant_or_org_ref !== a.tenant_id
      || link.identity_link_revision !== record.identity_link_revision || !Number.isInteger(record.identity_link_revision)
      || record.identity_link_revision! < 1 || record.pilot_account_id !== undefined || a.assurance_level !== "PROVIDER_VERIFIED"
      || !a.authentication_evidence_expires_at || !Number.isFinite(Date.parse(a.authentication_evidence_expires_at))
      || absolute > Date.parse(a.authentication_evidence_expires_at)) deny();
  } else if (["LOCAL", "STANDALONE"].includes(a.authentication_method)) {
    if (a.identity_provider_ref !== (a.authentication_method === "LOCAL" ? "local" : "standalone") || a.assurance_level !== "LOCAL_VERIFIED"
      || a.identity_link_id !== undefined || a.authentication_evidence_expires_at !== undefined || record.identity_link_revision !== undefined
      || !account || account.status !== "active" || account.pilot_account_id !== record.pilot_account_id
      || account.principal_id !== a.principal_id || account.tenant_id !== a.tenant_id) deny();
  } else deny();
  return structuredClone(a);
}
