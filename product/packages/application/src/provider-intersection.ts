import { evidenceDigest, type PCPrincipal } from "@pc/domain";
import type { AuthorityDecision, AuthorityDecisionInput } from "./authority-decision.js";
import type { AuthorityRouter } from "./authority-router.js";
import type { ExternalAuthorityBindingResolver } from "./authority-binding.js";
import type { CompatibilityMappingRegistry } from "./compatibility-mapping.js";

export function providerIntersection(ports: { router: AuthorityRouter; mappings: CompatibilityMappingRegistry;
  bindings: ExternalAuthorityBindingResolver; principal(input: AuthorityDecisionInput): Promise<PCPrincipal>;
  toolKeys(input: AuthorityDecisionInput): Promise<readonly string[]>; now?: () => Date }) {
  return async (input: AuthorityDecisionInput, receipt: AuthorityDecision): Promise<void> => {
    const now = ports.now ?? (() => new Date());
    const principal = await ports.principal(input);
    const routeInput = { principal, action: input.action, resource_scope_refs: input.resource_scope_refs,
      tool_release_ids: input.tool_release_ids, observed_at: receipt.observed_at, trusted_resource_authority: receipt.resource_authority };
    const route = ports.router.resolveRoute(routeInput);
    if (!route?.provider_registration_id || route.authorization_mode !== "PC_AND_PROVIDER") {
      receipt.decision_mode = "DENY_UNKNOWN"; receipt.reason_codes = ["authority_route_unknown"]; return;
    }
    const bindingInput = { principal, provider_registration_id: route.provider_registration_id, resource_authority: receipt.resource_authority,
      ...(input.connector_id === undefined ? {} : { connector_id: input.connector_id }),
      tool_release_ids: input.tool_release_ids, ...(input.credential_generation === undefined ? {} : { credential_generation: input.credential_generation }) };
    try {
      const binding = await ports.bindings.resolve(bindingInput);
      let mapping;
      try {
        mapping = ports.mappings.resolve({ action: input.action, provider_registration_id: route.provider_registration_id,
          resource_authority: receipt.resource_authority, compatibility_version: "ee-v1", tool_keys: await ports.toolKeys(input), observed_at: receipt.observed_at });
      } catch {
        receipt.decision_mode = "DENY_UNKNOWN"; receipt.reason_codes = ["compatibility_mapping_unavailable"]; return;
      }
      receipt.provider_registration_id = route.provider_registration_id;
      receipt.provider_bundle_generation = binding.provider_generation;
      receipt.provider_mapping_release_id = mapping.mapping_release_id;
      receipt.evidence_refs.push(`pc:binding:${evidenceDigest(binding, "digest").slice(7)}`, `pc:mapping:${mapping.artifact_digest.slice(7)}`);
      const source = await ports.router.evaluate({ ...routeInput, compatibility_mapping: mapping });
      const observation = source.source;
      if (!observation || !/^[a-zA-Z0-9._:-]{1,256}$/u.test(observation.decision_ref)
        || !Number.isFinite(Date.parse(observation.observed_at)) || Date.parse(observation.observed_at) < Date.parse(receipt.observed_at)
        || Date.parse(observation.observed_at) > now().getTime()
        || (observation.expires_at !== undefined && (!Number.isFinite(Date.parse(observation.expires_at)) || Date.parse(observation.expires_at) <= now().getTime()))) {
        receipt.reason_codes = ["source_authority_unavailable"]; return;
      }
      receipt.provider_decision = source.decision;
      receipt.provider_decision_ref = observation.decision_ref;
      receipt.provider_decision_observed_at = observation.observed_at;
      receipt.evidence_refs.push(observation.decision_ref, `provider-call:${receipt.logical_request_id}:${receipt.decision_id}`);
      if (observation.expires_at) receipt.expires_at = new Date(Math.min(Date.parse(receipt.expires_at), Date.parse(observation.expires_at))).toISOString();
      const after = await ports.bindings.resolve(bindingInput);
      if (evidenceDigest(after, "digest") !== evidenceDigest(binding, "digest")) {
        receipt.reason_codes = ["binding_generation_changed"]; return;
      }
      receipt.decision = source.decision;
      receipt.reason_codes = [source.decision === "ALLOW" ? "authority_intersection_allowed" : "source_policy_denied"];
    } catch {
      receipt.decision = "DENY"; receipt.reason_codes = ["current_binding_unavailable"];
    }
  };
}
