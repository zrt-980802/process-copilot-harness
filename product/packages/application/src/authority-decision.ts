import { randomUUID } from "node:crypto";
import { evidenceDigest, IdentityAuthorizationError, type PCPrincipal, type SessionAssurance } from "@pc/domain";
import type { AuthorityRouter } from "./authority-router.js";
import type { ExternalAuthorizationDecision } from "./identity-authorization.js";
import { authorizationRequestContext } from "./authorization-context.js";

export interface AuthorityDecision {
  contract_name: "pc.authority-decision/1";
  contract_version: 1;
  decision_id: string;
  principal_id: string;
  pc_session_id: string;
  tenant_id: string;
  logical_request_id: string;
  turn_id?: string;
  tool_call_id?: string;
  action: string;
  resource_ref: string;
  resource_authority: string;
  decision_mode: "PC_ONLY" | "PC_AND_PROVIDER" | "DENY_UNKNOWN";
  pc_policy_revision: number;
  identity_revision: number;
  pc_decision: "ALLOW" | "DENY" | "UNKNOWN";
  pc_scope_decision: "ALLOW" | "DENY" | "UNKNOWN";
  provider_registration_id?: string;
  provider_bundle_generation?: string;
  provider_mapping_release_id?: string;
  provider_decision_ref?: string;
  provider_decision?: "ALLOW" | "DENY" | "UNKNOWN";
  provider_decision_observed_at?: string;
  decision: "ALLOW" | "DENY";
  reason_codes: string[];
  evidence_refs: string[];
  observed_at: string;
  expires_at: string;
  decision_digest: string;
}

export interface AuthorityDecisionInput {
  principal_id: string;
  pc_session_id?: string;
  execution_session_id?: string;
  action: string;
  resource_scope_refs: readonly string[];
  tool_release_ids: readonly string[];
  resource_authority?: string;
  tool_call_id?: string;
  turn_id?: string;
  credential_generation?: number;
  connector_id?: string;
}

export interface PcDecisionPorts {
  session(input: AuthorityDecisionInput): Promise<{ principal: PCPrincipal; assurance: SessionAssurance }>;
  policy(principal: PCPrincipal, input: AuthorityDecisionInput): Promise<ExternalAuthorizationDecision>;
  router: AuthorityRouter;
  resourceAuthority?(input: AuthorityDecisionInput): Promise<string | undefined>;
  record(decision: AuthorityDecision): Promise<void>;
  external?(input: AuthorityDecisionInput, decision: AuthorityDecision): Promise<void>;
  now?: () => Date;
}

/** Request receipts are evidence, never reusable authorization capabilities. */
export class PcAuthorityDecisionService {
  constructor(private readonly ports: PcDecisionPorts) {}

  async decide(input: AuthorityDecisionInput): Promise<AuthorityDecision> {
    const { principal, assurance } = await this.ports.session(input);
    const now = (this.ports.now ?? (() => new Date()))();
    const trustedAuthority = this.ports.resourceAuthority ? await this.ports.resourceAuthority(input) : input.resource_authority;
    const invalidAuthority = this.ports.resourceAuthority && (!trustedAuthority || (input.resource_authority !== undefined && input.resource_authority !== trustedAuthority));
    const routeInput = { principal, action: input.action, resource_scope_refs: input.resource_scope_refs,
      tool_release_ids: input.tool_release_ids, observed_at: now.toISOString(),
      ...(trustedAuthority ? { trusted_resource_authority: trustedAuthority } : {}) };
    const route = invalidAuthority ? undefined : this.ports.router.resolveRoute(routeInput);
    const context = authorizationRequestContext();
    const receipt: AuthorityDecision = { contract_name: "pc.authority-decision/1", contract_version: 1,
      decision_id: `decision:${randomUUID()}`, principal_id: principal.principal_id, pc_session_id: assurance.pc_session_id,
      tenant_id: principal.tenant_id, logical_request_id: context?.logical_request_id ?? `request:${randomUUID()}`,
      ...(input.turn_id ? { turn_id: input.turn_id } : {}), ...(input.tool_call_id ? { tool_call_id: input.tool_call_id } : {}),
      action: input.action, resource_ref: input.resource_scope_refs.length === 1 ? input.resource_scope_refs[0]!
        : `pc:scope-set:${evidenceDigest({ scopes: input.resource_scope_refs }, "digest").slice(7)}`,
      resource_authority: route?.resource_authority ?? "unknown", decision_mode: route?.authorization_mode ?? "DENY_UNKNOWN",
      pc_policy_revision: principal.authorization_revision, identity_revision: principal.identity_revision,
      pc_decision: "UNKNOWN", pc_scope_decision: "UNKNOWN", decision: "DENY", reason_codes: ["authority_route_unknown"],
      evidence_refs: [`pc:session:${assurance.session_assurance_id}`, `pc:policy:${principal.authorization_revision}`],
      observed_at: now.toISOString(), expires_at: new Date(Math.min(Date.parse(assurance.absolute_expires_at), now.getTime() + 60_000)).toISOString(),
      decision_digest: "" };
    if (route) {
      const policy = await this.ports.policy(principal, input);
      receipt.pc_decision = policy.decision;
      receipt.pc_scope_decision = policy.decision;
      receipt.reason_codes = policy.decision === "ALLOW" ? ["pc_policy_allowed"] : ["pc_policy_denied"];
      if (policy.decision === "ALLOW") {
        if (route.authorization_mode === "PC_ONLY") receipt.decision = "ALLOW";
        else if (this.ports.external) await this.ports.external(input, receipt);
        else receipt.reason_codes = ["source_authority_unavailable"];
      }
    }
    // External checks may await network IO; validate local Session/revisions again.
    try {
      const current = await this.ports.session(input);
      if (current.assurance.assurance_digest !== assurance.assurance_digest
        || current.principal.authorization_revision !== receipt.pc_policy_revision
        || current.principal.identity_revision !== receipt.identity_revision) throw new Error("Authority changed");
    } catch {
      receipt.decision = "DENY"; receipt.reason_codes = ["session_authority_changed"];
    }
    if (receipt.decision === "ALLOW" && Date.parse(receipt.expires_at) <= (this.ports.now ?? (() => new Date()))().getTime()) {
      receipt.decision = "DENY"; receipt.reason_codes = ["decision_expired"];
    }
    receipt.decision_digest = evidenceDigest(receipt, "decision_digest");
    try { await this.ports.record(structuredClone(receipt)); }
    catch { throw new IdentityAuthorizationError("PC_AUTHORITY_AUDIT_UNAVAILABLE", "Authorization evidence could not be recorded", true); }
    if (context) context.last_decision = { decision_id: receipt.decision_id, decision_mode: receipt.decision_mode,
      decision: receipt.decision, reason_codes: receipt.reason_codes, principal_id: receipt.principal_id,
      pc_session_id: receipt.pc_session_id, resource_ref: receipt.resource_ref };
    return structuredClone(receipt);
  }
}
