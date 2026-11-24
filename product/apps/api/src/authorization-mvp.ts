import { randomUUID } from "node:crypto";
import { CompatibilityMappingRegistry, EE_V1_MAPPING_RELEASES, ExternalAuthorityBindingResolver, PcAuthorityDecisionService,
  providerIntersection, type AuthorityDecision, type IdentityAuthorizationService, type ProfileCapabilityService, type RuntimeRegistryService } from "@pc/application";
import { evidenceDigest, IdentityAuthorizationError } from "@pc/domain";
import type { GatewayRepository } from "@pc/gateway";
import type { EeProviderBundle } from "./ee-provider-bundle.js";

export function installAuthorizationMvp(options: { identity: IdentityAuthorizationService; audit: GatewayRepository;
  bundle?: EeProviderBundle; profiles?: ProfileCapabilityService; registry?: RuntimeRegistryService; issuer?: string;
  now?: () => Date }) {
  const { identity, audit, bundle, profiles, registry } = options;
  const router = identity.authorityRouterForDecisions;
  const now = options.now ?? (() => new Date());
  const mappings = new CompatibilityMappingRegistry(EE_V1_MAPPING_RELEASES);
  const bindings = new ExternalAuthorityBindingResolver({
    provider: id => {
      const active = bundle?.active();
      const descriptor = bundle?.descriptor();
      if (id !== "provider:eeclaw" || !active || descriptor?.bundle_state !== "READY" || !options.issuer) return undefined;
      return { provider_registration_id: id, resource_authority: "eeclaw", registration_state: "ACTIVE", generation: active.generation,
        configuration_revision: descriptor.registration_revision, identity_provider_ref: "eeclaw", identity_issuer: options.issuer,
        connector: { ...active.catalog.connector, generation: active.generation } };
    },
    link: (principalId, provider) => identity.currentVerifiedIdentityLink(principalId, provider),
    accounts: (tenant, connector, principal) => audit.listActiveExternalAccountBindings(tenant, connector, principal)
  });
  identity.registerExecutionSessionResolver(async sessionId => {
    const projection = await registry?.getSessionProjection(sessionId);
    const profile = projection ? await profiles?.getEffectiveProfileSnapshot(projection.assignment.effective_profile_snapshot_id) : undefined;
    return typeof profile?.model_selection.pc_login_session_id === "string" ? profile.model_selection.pc_login_session_id : undefined;
  });
  const external = providerIntersection({ router, mappings, bindings, now,
    principal: async input => (await identity.currentAuthoritySession(input)).principal,
    toolKeys: async input => {
      const tools = await Promise.all(input.tool_release_ids.map(id => profiles?.getToolRelease(id)));
      if (tools.some(tool => !tool || tool.status !== "PUBLISHED")) throw new IdentityAuthorizationError("PC_AUTHORITY_TOOL_DENIED", "Tool is unavailable");
      return tools.filter(tool => tool && (tool.required_permissions.includes(input.action) || !/^(?:page:|ee\.|draft\.)/u.test(input.action)))
        .map(tool => tool!.tool_definition_id);
    } });
  const decisions = new PcAuthorityDecisionService({ session: input => identity.currentAuthoritySession(input),
    resourceAuthority: async input => {
      if (input.tool_release_ids.length) {
        const tools = await Promise.all(input.tool_release_ids.map(id => profiles?.getToolRelease(id)));
        if (tools.some(tool => !tool || tool.status !== "PUBLISHED")) return undefined;
        const authorities = new Set(tools.map(tool => tool!.provider_kind === "ee_mcp" ? "eeclaw"
          : ["pc", "builtin"].includes(tool!.provider_kind) ? "pc" : "unknown"));
        return authorities.size === 1 && !authorities.has("unknown") ? [...authorities][0] : undefined;
      }
      if (input.action === "tool.execute") return undefined;
      return router.resolveRoute({ principal: (await identity.currentAuthoritySession(input)).principal, action: input.action,
        resource_scope_refs: input.resource_scope_refs, tool_release_ids: input.tool_release_ids, observed_at: now().toISOString() })?.resource_authority;
    },
    policy: (principal, input) => identity.evaluatePcPolicy(principal, input), router, external, now,
    record: async decision => {
      const entry = { audit_id: `audit:${randomUUID()}`, event_type: "PC_AUTHORITY_DECISION", tenant_id: decision.tenant_id,
        principal_id: decision.principal_id, outcome: decision.decision, reason_codes: decision.reason_codes,
        evidence_refs: [`pc:session:${decision.pc_session_id}`, `pc:decision:${decision.decision_id}`, ...decision.evidence_refs],
        payload_digest: decision.decision_digest, occurred_at: decision.observed_at, authority_decision: { ...decision } };
      await audit.appendAudit({ ...entry, operation_id: `authorization:${decision.pc_session_id}` });
      if (decision.tool_call_id) await audit.appendAudit({ ...entry, audit_id: `audit:${randomUUID()}`, operation_id: decision.tool_call_id });
    } });
  identity.registerAuthorityDecisions(decisions);
  identity.registerDecisionHistory(async sessionId => (await audit.listAudit(`authorization:${sessionId}`))
    .filter(entry => entry.event_type === "PC_AUTHORITY_DECISION" && entry.authority_decision
      && entry.authority_decision.decision_digest === evidenceDigest(entry.authority_decision, "decision_digest"))
    .map(entry => entry.authority_decision as unknown as AuthorityDecision));
  return { decisions, mappings, bindings };
}
