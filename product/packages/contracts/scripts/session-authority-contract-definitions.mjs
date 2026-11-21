const text = { type: "string", minLength: 1 };
const time = { type: "string", format: "date-time" };
const revision = { type: "integer", minimum: 1 };
const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const outcome = { type: "string", enum: ["ALLOW", "DENY", "UNKNOWN"] };
const strings = { type: "array", uniqueItems: true, items: text };
const protocolKey = { type: "string", pattern: "^[a-z][a-z0-9_.:-]*(?:\\*)?$" };
const providerId = { type: "string", pattern: "^provider:[a-z0-9][a-z0-9._-]*$" };
const evidence = { ...strings, minItems: 1, items: { type: "string", pattern: "^(pc|provider-call|provider-decision):[a-zA-Z0-9._:-]+$" } };
const providerFields = ["provider_registration_id", "provider_bundle_generation",
  "provider_mapping_release_id", "provider_decision_ref", "provider_decision",
  "provider_decision_observed_at"];
const forbidden = (fields) => Object.fromEntries(fields.map((field) => [field, false]));
const protocolKeys = (field) => ({
  type: "object", additionalProperties: false, required: [field],
  properties: { [field]: { ...strings, minItems: 1, items: protocolKey } }
});

export const sessionAuthoritySchemaOverrides = {
  C67: {
    authentication_method: { type: "string", enum: ["LOCAL", "STANDALONE", "PROVIDER"] },
    identity_revision: revision,
    authorization_revision: revision,
    assurance_level: { type: "string", enum: ["LOCAL_VERIFIED", "PROVIDER_VERIFIED"] },
    session_state: { type: "string", enum: ["ACTIVE", "EXPIRED", "REVOKED"] },
    evidence_refs: { ...strings, minItems: 1, items: { type: "string", pattern: "^pc:[a-zA-Z0-9._:-]+$" } },
    assurance_digest: digest
  },
  C68: {
    action: { type: "string", pattern: "^[a-z][a-z0-9_]*(?:[.:][a-z0-9_-]+)+$" },
    resource_authority: { type: "string", pattern: "^[a-z][a-z0-9._-]*$" },
    decision_mode: { type: "string", enum: ["PC_ONLY", "PC_AND_PROVIDER", "DENY_UNKNOWN"] },
    pc_policy_revision: revision, identity_revision: revision,
    pc_decision: outcome, pc_scope_decision: outcome, provider_decision: outcome,
    provider_registration_id: providerId, provider_decision_observed_at: time,
    decision: { type: "string", enum: ["ALLOW", "DENY"] },
    reason_codes: { ...strings, minItems: 1 }, evidence_refs: evidence,
    decision_digest: digest
  },
  C69: {
    provider_registration_id: providerId,
    pc_action_pattern: { type: "string", pattern: "^[a-z][a-z0-9_]*(?:[.:][a-z0-9_-]+)*(?:[.:](?:[a-z0-9_-]+|\\*))$" },
    provider_permission_mapping: {
      type: "object", additionalProperties: false,
      required: ["permission_keys", "baseline_page_keys_version"],
      properties: {
        permission_keys: { ...strings, minItems: 1, items: protocolKey },
        baseline_page_keys_version: { type: "string", enum: ["BASELINE_PAGE_KEYS_V1", "NOT_APPLICABLE"] }
      }
    },
    provider_action_mapping: protocolKeys("action_keys"),
    provider_tool_mapping: protocolKeys("tool_keys"),
    decision_mode: { type: "string", const: "PC_AND_PROVIDER" },
    artifact_digest: digest,
    status: { type: "string", enum: ["DRAFT", "ACTIVE", "SUPERSEDED", "REVOKED"] }
  }
};

export const sessionAuthorityRootSchemaOverrides = {
  C67: {
    allOf: [{
      if: { properties: { authentication_method: { const: "PROVIDER" } } },
      then: {
        required: ["identity_link_id", "authentication_evidence_expires_at"],
        properties: { identity_link_id: text, authentication_evidence_expires_at: time,
          assurance_level: { const: "PROVIDER_VERIFIED" }, identity_provider_ref: { not: { enum: ["local", "standalone"] } } }
      },
      else: {
        properties: { ...forbidden(["identity_link_id", "authentication_evidence_expires_at"]), assurance_level: { const: "LOCAL_VERIFIED" } },
        oneOf: [
          { properties: { authentication_method: { const: "LOCAL" }, identity_provider_ref: { const: "local" } } },
          { properties: { authentication_method: { const: "STANDALONE" }, identity_provider_ref: { const: "standalone" } } }
        ]
      }
    }, {
      if: { properties: { session_state: { const: "REVOKED" } } },
      then: { required: ["revoked_at"], properties: { revoked_at: time } },
      else: { properties: { revoked_at: false } }
    }]
  },
  C68: {
    allOf: [{
      if: { properties: { decision_mode: { const: "PC_ONLY" } } },
      then: { properties: {
        ...forbidden(providerFields), resource_authority: { const: "pc" },
        evidence_refs: { ...strings, minItems: 1, items: { type: "string", pattern: "^pc:[a-zA-Z0-9._:-]+$" } }
      } }
    }, {
      if: { properties: { decision_mode: { const: "DENY_UNKNOWN" } } },
      then: { properties: { decision: { const: "DENY" }, ...forbidden(providerFields) } }
    }, {
      if: { properties: { decision_mode: { const: "PC_AND_PROVIDER" } } },
      then: { properties: { resource_authority: { not: { const: "pc" } } } }
    }, {
      if: { properties: { decision: { const: "ALLOW" } } },
      then: {
        properties: { pc_decision: { const: "ALLOW" }, pc_scope_decision: { const: "ALLOW" } },
        allOf: [{
          if: { properties: { decision_mode: { const: "PC_AND_PROVIDER" } } },
          then: { required: providerFields, properties: { provider_decision: { const: "ALLOW" } } }
        }]
      }
    }]
  },
  C69: {
    allOf: [{
      if: { properties: { provider_type: { const: "eeclaw" } } },
      then: { properties: {
        resource_authority: { const: "eeclaw" }, compatibility_version: { const: "ee-v1" },
        provider_permission_mapping: { type: "object", properties: { baseline_page_keys_version: { const: "BASELINE_PAGE_KEYS_V1" } } }
      } }
    }]
  }
};

const issued = "2026-11-21T00:00:00.000Z";
const absolute = "2026-11-21T01:00:00.000Z";
const sha = `sha256:${"a".repeat(64)}`;
export const sessionAuthorityFixtureOverrides = {
  C67: {
    session_assurance_id: "assurance:contract", pc_session_id: "pc-session:contract",
    principal_id: "principal:contract", tenant_id: "tenant:contract",
    authentication_method: "PROVIDER", identity_provider_ref: "identity-provider:eeclaw",
    identity_link_id: "identity-link:contract", authentication_evidence_expires_at: absolute,
    identity_revision: 1, authorization_revision: 1, assurance_level: "PROVIDER_VERIFIED",
    issued_at: issued, idle_expires_at: "2026-11-21T00:30:00.000Z",
    pc_absolute_limit_at: "2026-11-21T02:00:00.000Z", absolute_expires_at: absolute,
    session_state: "ACTIVE", evidence_refs: ["pc:authentication-proof:contract"], assurance_digest: sha
  },
  C68: {
    decision_id: "decision:contract", principal_id: "principal:contract", pc_session_id: "pc-session:contract",
    tenant_id: "tenant:contract", logical_request_id: "request:1", turn_id: "turn:1", tool_call_id: "call:1",
    action: "ssts.read", resource_ref: "eeclaw:project:synthetic", resource_authority: "eeclaw",
    decision_mode: "PC_AND_PROVIDER", pc_policy_revision: 1, identity_revision: 1,
    pc_decision: "ALLOW", pc_scope_decision: "ALLOW", provider_registration_id: "provider:eeclaw",
    provider_bundle_generation: "epoch.1", provider_mapping_release_id: "mapping:ee-v1:1",
    provider_decision_ref: "provider-decision:contract", provider_decision: "ALLOW",
    provider_decision_observed_at: issued, decision: "ALLOW", reason_codes: ["intersection_allowed"],
    evidence_refs: ["pc:policy:1", "provider-call:request:1", "provider-decision:contract"],
    observed_at: issued, expires_at: "2026-11-21T00:01:00.000Z", decision_digest: sha
  },
  C69: {
    mapping_release_id: "mapping:ee-v1:1", provider_registration_id: "provider:eeclaw",
    provider_type: "eeclaw", compatibility_version: "ee-v1", pc_action_pattern: "ssts.read",
    resource_authority: "eeclaw",
    provider_permission_mapping: { permission_keys: ["page:architecture"], baseline_page_keys_version: "BASELINE_PAGE_KEYS_V1" },
    provider_action_mapping: { action_keys: ["ssts.read"] },
    provider_tool_mapping: { tool_keys: ["ee.get_ssts_document"] },
    decision_mode: "PC_AND_PROVIDER", artifact_digest: sha, status: "ACTIVE", effective_from: issued
  }
};

export const sessionAuthorityFixtureOmissions = { C67: ["revoked_at"], C69: ["supersedes_release_id"] };
