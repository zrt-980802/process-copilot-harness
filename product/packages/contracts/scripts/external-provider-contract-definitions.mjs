const timestamp = "2026-11-17T00:00:00.000Z";
const expiry = "2026-11-17T00:05:00.000Z";
const sha256 = `sha256:${"a".repeat(64)}`;

const nonEmptyStrings = {
  type: "array",
  minItems: 1,
  uniqueItems: true,
  items: { type: "string", minLength: 1 }
};

const providerId = {
  type: "string",
  pattern: "^provider:[a-z0-9][a-z0-9._-]*$"
};

const namespace = {
  type: "string",
  pattern: "^[a-z][a-z0-9]*(?:[.:][a-z0-9*_-]+)+$"
};

const authority = {
  type: "string",
  pattern: "^[a-z][a-z0-9._-]*$"
};

const healthStates = [
  "UNCONFIGURED",
  "STARTING",
  "HEALTHY",
  "DEGRADED",
  "UNAVAILABLE",
  "DISABLED"
];

export const externalProviderEnumOverrides = {
  C61: {
    provider_kind: ["EXTERNAL_BUSINESS", "LOCAL", "IDENTITY_ONLY"],
    registration_state: ["ACTIVE", "DISABLED", "SUPERSEDED"]
  },
  C62: {
    provider_state: healthStates,
    compatibility_status: ["COMPATIBLE", "INCOMPATIBLE", "UNKNOWN", "NOT_APPLICABLE"]
  },
  C63: {
    authorization_mode: ["PC_ONLY", "PC_AND_PROVIDER"],
    ambiguity_policy: ["DENY"],
    route_state: ["ACTIVE", "DISABLED", "SUPERSEDED"]
  }
};

export const externalProviderSchemaOverrides = {
  C61: {
    provider_registration_id: providerId,
    provider_key: { type: "string", pattern: "^[a-z][a-z0-9._-]*$" },
    tenant_scope: {
      type: "object",
      additionalProperties: false,
      required: ["scope_kind"],
      properties: {
        scope_kind: { type: "string", enum: ["GLOBAL", "TENANT"] },
        tenant_id: { type: "string", minLength: 1 }
      },
      oneOf: [
        {
          properties: { scope_kind: { const: "GLOBAL" }, tenant_id: {} },
          not: {
            properties: { tenant_id: {} },
            required: ["tenant_id"]
          }
        },
        {
          properties: { scope_kind: { const: "TENANT" }, tenant_id: {} },
          required: ["tenant_id"]
        }
      ]
    },
    port_kinds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: {
        type: "string",
        enum: [
          "IDENTITY",
          "ENTERPRISE_AUTHORIZATION",
          "PROJECT_DIRECTORY",
          "BUSINESS_CAPABILITY",
          "WORKBENCH_PROJECTION"
        ]
      }
    },
    action_namespaces: {
      ...nonEmptyStrings,
      items: namespace
    },
    resource_authorities: {
      ...nonEmptyStrings,
      items: authority
    },
    connector_registration_refs: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    identity_provider_refs: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    registration_revision: { type: "integer", minimum: 1 },
    configuration_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }
  },
  C62: {
    health_observation_id: { type: "string", pattern: "^provider-health:[a-zA-Z0-9._-]+$" },
    provider_registration_id: providerId,
    configuration_revision: { type: "integer", minimum: 1 },
    port_health: {
      type: "object",
      minProperties: 1,
      additionalProperties: false,
      properties: {
        identity: { type: "string", enum: healthStates },
        enterprise_authorization: { type: "string", enum: healthStates },
        project_directory: { type: "string", enum: healthStates },
        business_capability: { type: "string", enum: healthStates },
        workbench_projection: { type: "string", enum: healthStates }
      }
    },
    reason_codes: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    evidence_refs: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    }
  },
  C63: {
    route_id: { type: "string", pattern: "^authority-route:[a-zA-Z0-9._-]+$" },
    route_revision: { type: "integer", minimum: 1 },
    action_namespace: namespace,
    action_pattern: { type: "string", minLength: 1 },
    resource_authority: authority,
    resource_scope_pattern: { type: "string", minLength: 1 },
    provider_registration_id: providerId,
    capability_provider_required: { type: "boolean" },
    route_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }
  },
  C64: {
    snapshot_id: { type: "string", pattern: "^project-directory:[a-zA-Z0-9._-]+$" },
    provider_registration_id: providerId,
    resource_authority: authority,
    projects: {
      type: "array",
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["project_ref", "project_code", "display_name"],
        properties: {
          project_ref: { type: "string", minLength: 1 },
          project_code: { type: "string", minLength: 1 },
          display_name: { type: "string", minLength: 1 },
          organization_ref: { type: "string", minLength: 1 }
        }
      }
    },
    source_revision: { type: "string", minLength: 1 },
    source_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    evidence_refs: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    }
  },
  C65: {
    availability_id: { type: "string", pattern: "^capability-availability:[a-zA-Z0-9._-]+$" },
    provider_registration_id: providerId,
    health_observation_id: { type: "string", pattern: "^provider-health:[a-zA-Z0-9._-]+$" },
    catalog_revision: { type: "string", minLength: 1 },
    capabilities: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "capability_ref",
          "action_namespace",
          "resource_authority",
          "operation_class",
          "approval_requirement",
          "availability_state"
        ],
        properties: {
          capability_ref: { type: "string", minLength: 1 },
          tool_release_id: { type: "string", minLength: 1 },
          action_namespace: namespace,
          resource_authority: authority,
          operation_class: {
            type: "string",
            enum: ["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL_SIDE_EFFECT"]
          },
          approval_requirement: {
            type: "string",
            enum: ["NONE", "REQUIRED", "CONDITIONAL"]
          },
          availability_state: {
            type: "string",
            enum: ["AVAILABLE", "DEGRADED", "UNAVAILABLE", "DISABLED"]
          }
        }
      }
    },
    reason_codes: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    evidence_refs: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    }
  }
};

export const externalProviderRootSchemaOverrides = {
  C63: {
    allOf: [
      {
        if: { properties: { authorization_mode: { const: "PC_ONLY" } } },
        then: {
          properties: {
            provider_registration_id: {},
            resource_authority: { const: "pc" },
            capability_provider_required: { const: false }
          },
          not: {
            properties: { provider_registration_id: {} },
            required: ["provider_registration_id"]
          }
        },
        else: {
          properties: { provider_registration_id: {} },
          required: ["provider_registration_id"]
        }
      }
    ]
  }
};

export const externalProviderFixtureOverrides = {
  C61: {
    provider_registration_id: "provider:eeclaw",
    provider_key: "eeclaw",
    display_name: "EE-Claw Provider",
    provider_kind: "EXTERNAL_BUSINESS",
    tenant_scope: { scope_kind: "TENANT", tenant_id: "tenant-contract" },
    port_kinds: ["IDENTITY", "ENTERPRISE_AUTHORIZATION", "PROJECT_DIRECTORY", "BUSINESS_CAPABILITY", "WORKBENCH_PROJECTION"],
    action_namespaces: ["ee.*", "page:*"],
    resource_authorities: ["eeclaw"],
    connector_registration_refs: ["connector:ee-mcp"],
    identity_provider_refs: ["identity-provider:eeclaw"],
    registration_revision: 1,
    configuration_digest: sha256,
    registration_state: "ACTIVE",
    registered_at: timestamp,
    updated_at: timestamp
  },
  C62: {
    health_observation_id: "provider-health:eeclaw-1",
    provider_registration_id: "provider:eeclaw",
    configuration_revision: 1,
    provider_state: "HEALTHY",
    compatibility_status: "COMPATIBLE",
    port_health: {
      identity: "HEALTHY",
      enterprise_authorization: "HEALTHY",
      project_directory: "HEALTHY",
      business_capability: "HEALTHY",
      workbench_projection: "HEALTHY"
    },
    reason_codes: ["provider_checks_passed"],
    evidence_refs: ["compatibility:eeclaw:v1"],
    checked_at: timestamp,
    expires_at: expiry
  },
  C63: {
    route_id: "authority-route:ee-read",
    route_revision: 1,
    action_namespace: "ee.*",
    action_pattern: "ee.*",
    resource_authority: "eeclaw",
    resource_scope_pattern: "project:*",
    authorization_mode: "PC_AND_PROVIDER",
    provider_registration_id: "provider:eeclaw",
    capability_provider_required: true,
    ambiguity_policy: "DENY",
    route_state: "ACTIVE",
    route_digest: sha256,
    effective_from: timestamp,
    effective_to: expiry
  },
  C64: {
    snapshot_id: "project-directory:eeclaw-1",
    provider_registration_id: "provider:eeclaw",
    tenant_id: "tenant-contract",
    principal_id: "principal-contract",
    identity_link_ref: "identity-link:eeclaw-contract",
    resource_authority: "eeclaw",
    projects: [{
      project_ref: "eeclaw:project:EP37",
      project_code: "EP37",
      display_name: "EP37 Demo Project",
      organization_ref: "eeclaw:organization:demo"
    }],
    source_revision: "ee-authorization-digest-1",
    source_digest: sha256,
    evidence_refs: ["eeclaw:accessible-projects:1"],
    observed_at: timestamp,
    expires_at: expiry
  },
  C65: {
    availability_id: "capability-availability:eeclaw-1",
    provider_registration_id: "provider:eeclaw",
    tenant_id: "tenant-contract",
    principal_id: "principal-contract",
    health_observation_id: "provider-health:eeclaw-1",
    catalog_revision: "ee-mcp-catalog-1",
    capabilities: [{
      capability_ref: "capability:ee.get_project_context",
      tool_release_id: "tool:ee_mcp:contract",
      action_namespace: "ee.*",
      resource_authority: "eeclaw",
      operation_class: "READ",
      approval_requirement: "NONE",
      availability_state: "AVAILABLE"
    }],
    reason_codes: ["provider_and_catalog_available"],
    evidence_refs: ["eea://catalog/read-tools#contract"],
    observed_at: timestamp,
    expires_at: expiry
  }
};
