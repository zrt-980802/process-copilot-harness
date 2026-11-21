import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  sessionAuthoritySchemaOverrides,
  sessionAuthorityRootSchemaOverrides,
  sessionAuthorityFixtureOverrides,
  sessionAuthorityFixtureOmissions
} from "./session-authority-contract-definitions.mjs";
import {
  memoryEnumOverrides,
  memoryFixtureOverrides,
  memorySchemaOverrides
} from "./memory-contract-definitions.mjs";
import {
  externalProviderEnumOverrides,
  externalProviderFixtureOverrides,
  externalProviderRootSchemaOverrides,
  externalProviderSchemaOverrides
} from "./external-provider-contract-definitions.mjs";

const productRoot = process.cwd();
const packageRoot = path.join(productRoot, "packages", "contracts");
const architectureRoot = path.resolve(productRoot, "..", "architecture");
const catalogSources = [
  ["stable-contract-catalog-v1.md", await readFile(path.join(architectureRoot, "stable-contract-catalog-v1.md"), "utf8")],
  ["memory-contract-catalog-v1.md", await readFile(path.join(architectureRoot, "memory-contract-catalog-v1.md"), "utf8")],
  ["external-provider-contract-catalog-v1.md", await readFile(path.join(architectureRoot, "external-provider-contract-catalog-v1.md"), "utf8")]
];

const booleanFields = new Set([
  "accepted",
  "committed",
  "retryable",
  "reconciliation_required",
  "requestable",
  "data_migration_required"
]);
const integerFields = new Set([
  "contract_version",
  "runtime_epoch",
  "target_runtime_epoch",
  "assignment_generation",
  "authorization_revision",
  "credential_generation",
  "generation",
  "version",
  "report_seq",
  "active_sessions",
  "active_turns",
  "inflight_tools",
  "pending_flushes",
  "event_schema_version",
  "dsh_session_seq",
  "runtime_event_seq",
  "last_sequence",
  "approval_version",
  "release_version",
  "policy_model_revision",
  "revision",
  "schema_version"
]);
const objectFields = new Set([
  "client_context",
  "payload",
  "capacity",
  "health_summary",
  "limits",
  "runtime_observation",
  "adapter_error",
  "capability_health",
  "capacity_health",
  "assignment_health",
  "model_policy",
  "knowledge_policy",
  "output_contract",
  "completion_contract",
  "model_selection",
  "runtime_requirements",
  "inputs",
  "selected",
  "omitted",
  "runtime_compatibility",
  "input_schema",
  "output_schema",
  "risk_manifest",
  "compatibility",
  "source",
  "owner_scope",
  "arguments",
  "result",
  "provider_facts",
  "current_assignment",
  "persistent_facts",
  "authorization_checkpoint",
  "decision",
  "manual_action",
  "details",
  "scope",
  "payload"
]);
const arrayFields = new Set([
  "allowed_actions",
  "resource_scope_refs",
  "decision_evidence_refs",
  "plugin_releases",
  "agent_presets",
  "bridge_protocol_versions",
  "tool_provider_capabilities",
  "persistence_capabilities",
  "event_export_capabilities",
  "approval_capabilities",
  "resource_capabilities",
  "tool_requirements",
  "plugin_requirements",
  "profile_assignment_ids",
  "tool_release_ids",
  "plugin_release_ids",
  "knowledge_view_refs",
  "conflicts",
  "warnings",
  "hard_failures",
  "required_permissions",
  "artifact_refs",
  "signature_refs",
  "dependencies",
  "declared_capabilities",
  "bindings",
  "resource_refs",
  "materialized_entries",
  "failed_entries",
  "external_evidence_refs",
  "evidence_refs",
  "source_session_ids",
  "affected_operation_ids",
  "reason_codes",
  "contract_versions",
  "profile_schema_versions",
  "plugin_api_versions",
  "required_capabilities",
  "known_incompatibilities",
  "tested_combinations",
  "adr_ids",
  "module_ids",
  "contract_ids",
  "implementation_refs",
  "test_refs",
  "responsibility_keys",
  "workflow_contribution_refs",
  "artifact_contract_refs",
  "tool_profile_requirement_refs",
  "capabilities",
  "module_relations",
  "navigation",
  "metrics",
  "work_items",
  "workflow_views",
  "artifact_views",
  "component_refs",
  "configuration_keys",
  "defaults",
  "lock_levels",
  "scope_rules",
  "approval_evidence_refs",
  "policy_artifact_release_refs",
  "role_refs"
]);
const enumOverrides = {
  C03: {
    decision: ["ALLOW", "DENY"]
  },
  C04: {
    binding_mode: ["bearer", "dpop", "mtls"]
  },
  C09: {
    command_type: [
      "ASSIGN_SESSION",
      "REVOKE_SESSION",
      "START_TURN",
      "CANCEL_TURN",
      "RESUME_SESSION",
      "FLUSH_SESSION",
      "DRAIN_RUNTIME",
      "TERMINATE_RUNTIME",
      "QUERY_HEALTH",
      "QUERY_CAPABILITIES",
      "CATCH_UP_EVENTS"
    ]
  },
  C10: {
    outcome_state: [
      "KNOWN_SUCCESS",
      "KNOWN_FAILURE",
      "NOT_STARTED",
      "OUTCOME_UNKNOWN"
    ]
  },
  C25: {
    durability: ["EPHEMERAL", "OBSERVED", "DURABLE_DSH", "DURABLE_PC"]
  },
  C37: {
    visibility: ["none", "visible"],
    focus: ["none", "secondary", "primary"]
  },
  C38: {
    status: ["DRAFT", "VALIDATED", "APPROVED", "PUBLISHED", "SUPERSEDED"]
  },
  C39: {
    status: ["DRAFT", "VALIDATED", "APPROVED", "PUBLISHED", "SUPERSEDED"]
  },
  C40: {
    artifact_kind: [
      "workbench_projection",
      "role_configuration_schema",
      "role_configuration_defaults",
      "permission_bundle",
      "capability_policy",
      "workflow_contribution",
      "artifact_contract"
    ],
    lifecycle_state: ["DRAFT", "VALIDATED", "APPROVED", "PUBLISHED", "SUPERSEDED"],
    published_environment: ["dev", "test", "prod"]
  },
  C41: {
    decision: ["ALLOW", "DENY"],
    source: ["baseline", "role", "deny", "system_admin"]
  },
  C42: {
    revocation_mode: ["request_time"]
  }
};
Object.assign(enumOverrides, memoryEnumOverrides);
Object.assign(enumOverrides, externalProviderEnumOverrides);

const releaseStates = ["DRAFT", "VALIDATED", "APPROVED", "PUBLISHED", "SUPERSEDED"];
const lockLevels = [
  "personal_preference",
  "role_default",
  "project_policy",
  "organization_policy",
  "security_policy"
];
const stringArray = { type: "array", items: { type: "string", minLength: 1 } };
const schemaOverrides = {
  C02: {
    allowed_actions: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    resource_scope_refs: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    signature: {
      type: "string",
      pattern: "^[A-Za-z0-9_-]{43}$"
    }
  },
  C03: {
    allowed_actions: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    resource_scope_digest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$"
    },
    tool_set_digest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$"
    },
    reason_codes: stringArray,
    decision_evidence_refs: stringArray
  },
  C04: {
    scope_digest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$"
    }
  },
  C05: {
    status: {
      type: "string",
      enum: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "CONSUMED",
        "REVOKED",
        "EXPIRED",
        "CANCELLED"
      ]
    },
    operation_kind: {
      type: "string",
      enum: ["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL_SIDE_EFFECT"]
    },
    target_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    argument_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    risk_class: {
      type: "string",
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "reason_codes"],
      properties: {
        outcome: {
          type: "string",
          enum: ["PENDING", "APPROVE", "REJECT", "REVOKE", "EXPIRE", "CONSUME"]
        },
        decided_by: { type: "string", minLength: 1 },
        reason_codes: stringArray
      }
    },
    decision_evidence_refs: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    snapshot_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }
  },
  C15: {
    schema_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    risk_manifest: {
      type: "object",
      additionalProperties: false,
      required: [
        "action_class",
        "external_side_effect",
        "sensitivity",
        "requires_readback"
      ],
      properties: {
        action_class: {
          type: "string",
          enum: ["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL_SIDE_EFFECT"]
        },
        external_side_effect: { type: "boolean" },
        sensitivity: {
          type: "string",
          enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
        },
        requires_readback: { type: "boolean" }
      }
    },
    required_permissions: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    approval_policy: {
      type: "string",
      enum: ["NONE", "ALWAYS"]
    },
    idempotency_class: {
      type: "string",
      enum: ["IDEMPOTENT", "NON_IDEMPOTENT"]
    },
    recovery_class: {
      type: "string",
      enum: [
        "REPLAY_SAFE",
        "IDEMPOTENT_RETRY",
        "RECONCILE_BEFORE_RETRY",
        "NON_RECOVERABLE",
        "EXTERNAL_DURABLE_JOB"
      ]
    },
    status: {
      type: "string",
      enum: ["PUBLISHED", "REVOKED", "SUPERSEDED"]
    },
    artifact_refs: stringArray,
    release_digest: { type: "string", pattern: "^[a-f0-9]{64}$" }
  },
  C16: {
    artifact_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    signature_refs: stringArray,
    dependencies: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    declared_capabilities: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    status: {
      type: "string",
      enum: ["PUBLISHED", "REVOKED", "SUPERSEDED"]
    },
    release_digest: { type: "string", pattern: "^[a-f0-9]{64}$" }
  },
  C17: {
    resource_id: { type: "string", pattern: "^res_[a-zA-Z0-9_-]+$" },
    resource_version_id: { type: "string", pattern: "^rv_[a-zA-Z0-9_-]+$" },
    resource_type: {
      type: "string",
      enum: [
        "UPLOAD",
        "ATTACHMENT",
        "WORKSPACE_FILE",
        "ARTIFACT",
        "EXTERNAL_REFERENCE",
        "EVIDENCE_SNAPSHOT",
        "DERIVED"
      ]
    },
    owner_scope: {
      type: "object",
      additionalProperties: false,
      required: ["scope_type", "scope_id"],
      properties: {
        scope_type: {
          type: "string",
          enum: [
            "USER_ROOT",
            "USER_SHARED",
            "SESSION",
            "PROJECT",
            "TASK",
            "BUSINESS_OBJECT"
          ]
        },
        scope_id: { type: "string", minLength: 1 }
      }
    },
    content_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    classification: {
      type: "string",
      enum: ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]
    }
  },
  C18: {
    bindings: {
      type: "array",
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "binding_id",
          "resource_ref",
          "scope_type",
          "scope_id",
          "allowed_actions"
        ],
        properties: {
          binding_id: { type: "string", minLength: 1 },
          resource_ref: {
            type: "object",
            additionalProperties: false,
            required: ["resource_id", "resource_version_id"],
            properties: {
              resource_id: { type: "string", pattern: "^res_[a-zA-Z0-9_-]+$" },
              resource_version_id: {
                type: "string",
                pattern: "^rv_[a-zA-Z0-9_-]+$"
              }
            }
          },
          scope_type: {
            type: "string",
            enum: [
              "USER_ROOT",
              "USER_SHARED",
              "SESSION",
              "PROJECT",
              "TASK",
              "BUSINESS_OBJECT"
            ]
          },
          scope_id: { type: "string", minLength: 1 },
          allowed_actions: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: {
              type: "string",
              enum: ["READ", "WRITE", "DERIVE", "UPLOAD", "SHARE", "ARCHIVE", "DELETE"]
            }
          }
        }
      }
    },
    allowed_actions: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: {
        type: "string",
        enum: ["READ", "WRITE", "DERIVE", "UPLOAD", "SHARE", "ARCHIVE", "DELETE"]
      }
    },
    snapshot_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }
  },
  C19: {
    resource_refs: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["resource_id", "resource_version_id"],
        properties: {
          resource_id: { type: "string", pattern: "^res_[a-zA-Z0-9_-]+$" },
          resource_version_id: {
            type: "string",
            pattern: "^rv_[a-zA-Z0-9_-]+$"
          }
        }
      }
    },
    purpose: {
      type: "string",
      enum: ["RUNTIME_INPUT", "TOOL_INPUT", "DERIVATION", "DOWNLOAD", "EVIDENCE"]
    },
    allowed_actions: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: ["READ", "WRITE", "DERIVE"] }
    }
  },
  C20: {
    state: { type: "string", enum: ["READY", "PARTIAL", "FAILED", "EXPIRED", "CLEANED"] },
    mount_ref: { type: "string", pattern: "^materialization:[a-zA-Z0-9_-]+$" },
    materialized_entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "resource_id",
          "resource_version_id",
          "relative_path",
          "content_digest",
          "bytes",
          "mode"
        ],
        properties: {
          resource_id: { type: "string", pattern: "^res_[a-zA-Z0-9_-]+$" },
          resource_version_id: {
            type: "string",
            pattern: "^rv_[a-zA-Z0-9_-]+$"
          },
          relative_path: {
            type: "string",
            minLength: 1,
            pattern: "^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+$"
          },
          content_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          bytes: { type: "integer", minimum: 0 },
          mode: { type: "string", enum: ["READ_ONLY", "READ_WRITE"] }
        }
      }
    },
    failed_entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["resource_id", "resource_version_id", "code"],
        properties: {
          resource_id: { type: "string", pattern: "^res_[a-zA-Z0-9_-]+$" },
          resource_version_id: {
            type: "string",
            pattern: "^rv_[a-zA-Z0-9_-]+$"
          },
          code: { type: "string", minLength: 1 }
        }
      }
    },
    cleanup_state: {
      type: "string",
      enum: ["PENDING", "ACTIVE", "CLEANED", "FAILED"]
    },
    result_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }
  },
  C21: {
    schema_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    arguments: {
      type: "object",
      additionalProperties: true
    },
    argument_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    principal_envelope: {
      type: "object",
      additionalProperties: false,
      required: [
        "contract_name",
        "contract_version",
        "envelope_id",
        "issuer",
        "audience",
        "tenant_id",
        "subject_principal_id",
        "actor_principal_id",
        "pc_session_id",
        "runtime_id",
        "runtime_epoch",
        "assignment_generation",
        "authorization_revision",
        "allowed_actions",
        "resource_scope_refs",
        "issued_at",
        "expires_at",
        "nonce",
        "signature"
      ],
      properties: {
        contract_name: { const: "pc.principal-envelope/1" },
        contract_version: { type: "integer", const: 1 },
        envelope_id: { type: "string", minLength: 1 },
        issuer: { type: "string", minLength: 1 },
        audience: { type: "string", minLength: 1 },
        tenant_id: { type: "string", minLength: 1 },
        subject_principal_id: { type: "string", minLength: 1 },
        actor_principal_id: { type: "string", minLength: 1 },
        pc_session_id: { type: "string", minLength: 1 },
        business_task_id: { type: "string", minLength: 1 },
        runtime_id: { type: "string", minLength: 1 },
        runtime_epoch: { type: "integer", minimum: 0 },
        assignment_generation: { type: "integer", minimum: 1 },
        fencing_token: { type: "string", minLength: 1 },
        authorization_revision: { type: "integer", minimum: 0 },
        credential_generation: { type: "integer", minimum: 1 },
        allowed_actions: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string", minLength: 1 }
        },
        resource_scope_refs: {
          type: "array",
          uniqueItems: true,
          items: { type: "string", minLength: 1 }
        },
        issued_at: { type: "string", format: "date-time" },
        expires_at: { type: "string", format: "date-time" },
        nonce: { type: "string", minLength: 1 },
        signature: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" }
      }
    },
    recovery_class: {
      type: "string",
      enum: [
        "REPLAY_SAFE",
        "IDEMPOTENT_RETRY",
        "RECONCILE_BEFORE_RETRY",
        "NON_RECOVERABLE",
        "EXTERNAL_DURABLE_JOB"
      ]
    }
  },
  C22: {
    status: {
      type: "string",
      enum: ["SUCCEEDED", "FAILED", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"]
    },
    result: {
      type: "object",
      additionalProperties: true
    },
    result_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    external_evidence_refs: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    outcome_state: {
      type: "string",
      enum: ["KNOWN_SUCCESS", "KNOWN_FAILURE", "NOT_STARTED", "OUTCOME_UNKNOWN"]
    }
  },
  C23: {
    tool_catalog_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    state: {
      type: "string",
      enum: ["ACTIVE", "REAUTH_REQUIRED", "CLOSED", "EXPIRED"]
    }
  },
  C24: {
    operation_kind: {
      type: "string",
      enum: ["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL_SIDE_EFFECT"]
    },
    request_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    dispatch_state: {
      type: "string",
      enum: ["PENDING", "DISPATCHED", "COMPLETED", "UNKNOWN", "RECONCILING"]
    },
    outcome_state: {
      type: "string",
      enum: ["KNOWN_SUCCESS", "KNOWN_FAILURE", "NOT_STARTED", "OUTCOME_UNKNOWN"]
    },
    recovery_class: {
      type: "string",
      enum: [
        "REPLAY_SAFE",
        "IDEMPOTENT_RETRY",
        "RECONCILE_BEFORE_RETRY",
        "NON_RECOVERABLE",
        "EXTERNAL_DURABLE_JOB"
      ]
    },
    evidence_refs: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    }
  },
  C25: {
    event_schema_version: { type: "integer", const: 1 },
    producer_version: { type: "string", minLength: 1 },
    stream_kind: {
      type: "string",
      enum: ["RUNTIME", "SESSION", "TASK", "OPERATION", "APPROVAL", "RECOVERY"]
    },
    stream_sequence: { type: "integer", minimum: 1 },
    aggregate_revision: { type: "integer", minimum: 1 },
    assignment_generation: { type: "integer", minimum: 1 },
    payload_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }
  },
  C26: {
    stream_kind: {
      type: "string",
      enum: ["RUNTIME", "SESSION", "TASK", "OPERATION", "APPROVAL", "RECOVERY"]
    },
    last_sequence: { type: "integer", minimum: 0 },
    state: {
      type: "string",
      enum: ["COMPLETE", "GAP", "QUARANTINED"]
    },
    expected_next_sequence: { type: "integer", minimum: 1 }
  },
  C27: {
    state: {
      type: "string",
      enum: [
        "DRAFT",
        "READY",
        "RUNNING",
        "WAITING_USER",
        "WAITING_APPROVAL",
        "PAUSED",
        "RECOVERING",
        "COMPLETED",
        "FAILED",
        "CANCELLED"
      ]
    },
    source_session_ids: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    projection_complete: { type: "boolean" },
    state_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    version: { type: "integer", minimum: 1 }
  },
  C28: {
    operation_kind: {
      type: "string",
      enum: ["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL_SIDE_EFFECT"]
    },
    state: {
      type: "string",
      enum: [
        "PLANNED",
        "AWAITING_APPROVAL",
        "APPROVED",
        "DISPATCHING",
        "DISPATCHED",
        "VERIFYING",
        "SUCCEEDED",
        "FAILED",
        "OUTCOME_UNKNOWN",
        "RECONCILING",
        "COMPENSATION_REQUIRED"
      ]
    },
    recovery_class: {
      type: "string",
      enum: [
        "REPLAY_SAFE",
        "IDEMPOTENT_RETRY",
        "RECONCILE_BEFORE_RETRY",
        "NON_RECOVERABLE",
        "EXTERNAL_DURABLE_JOB"
      ]
    },
    input_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    result_digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    evidence_refs: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    projection_complete: { type: "boolean" },
    version: { type: "integer", minimum: 1 }
  },
  C29: {
    trigger: {
      type: "string",
      enum: [
        "RUNTIME_LOST",
        "ASSIGNMENT_EXPIRED",
        "EVENT_GAP",
        "OUTCOME_UNKNOWN",
        "APPROVAL_WAIT",
        "MANUAL"
      ]
    },
    affected_operation_ids: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    state: {
      type: "string",
      enum: [
        "RECOVERY_PENDING",
        "RECOVERING",
        "RECONCILING",
        "WAITING_APPROVAL",
        "MANUAL_REQUIRED",
        "RECOVERED",
        "RECOVERY_FAILED"
      ]
    },
    version: { type: "integer", minimum: 1 }
  },
  C30: {
    resolved_outcome_state: {
      type: "string",
      enum: ["KNOWN_SUCCESS", "KNOWN_FAILURE", "NOT_STARTED", "OUTCOME_UNKNOWN"]
    },
    action: {
      type: "string",
      enum: [
        "RECORD_SUCCESS",
        "RECORD_FAILURE",
        "RETRY_SAME_KEY",
        "CONTINUE_RECONCILIATION",
        "REQUIRE_MANUAL",
        "CREATE_COMPENSATION"
      ]
    },
    evidence_refs: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    }
  },
  C32: {
    resource_refs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["resource_id", "resource_version_id"],
        properties: {
          resource_id: { type: "string", pattern: "^res_[a-zA-Z0-9_-]+$" },
          resource_version_id: {
            type: "string",
            pattern: "^rv_[a-zA-Z0-9_-]+$"
          }
        }
      }
    },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "reason_codes"],
      properties: {
        outcome: { type: "string", enum: ["ALLOW", "DENY", "SUCCESS", "FAILURE"] },
        reason_codes: stringArray
      }
    },
    evidence_refs: stringArray,
    previous_hash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    entry_hash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    retention_class: {
      type: "string",
      enum: ["SECURITY", "BUSINESS", "RESOURCE_LIFECYCLE"]
    }
  },
  C35: {
    status: { type: "string", enum: releaseStates },
    responsibility_keys: stringArray,
    workflow_contribution_refs: stringArray,
    artifact_contract_refs: stringArray,
    tool_profile_requirement_refs: stringArray
  },
  C36: {
    scope_type: { type: "string", enum: ["project", "module", "stage", "global"] },
    status: { type: "string", enum: ["active", "inactive"] }
  },
  C37: {
    capabilities: {
      type: "array",
      items: { type: "string", enum: ["read", "edit", "approve", "publish"] },
      uniqueItems: true
    }
  },
  C38: {
    component_refs: stringArray
  },
  C39: {
    configuration_keys: stringArray,
    lock_levels: {
      type: "array",
      items: { type: "string", enum: lockLevels },
      uniqueItems: true
    },
    component_refs: stringArray
  },
  C40: {
    approval_evidence_refs: stringArray
  },
  C41: {
    reason_codes: stringArray,
    role_refs: stringArray,
    policy_artifact_release_refs: stringArray,
    authorization_version_digest: {
      type: "string",
      pattern: "^[a-f0-9]{64}$"
    }
  },
  C42: {
    source_commit: {
      const: "cefa7432f966e17b41c1638e128de652b934fd20"
    },
    schema_fingerprint: {
      type: "string",
      pattern: "^[a-f0-9]{64}$"
    },
    api_fingerprint: {
      type: "string",
      pattern: "^[a-f0-9]{64}$"
    },
    auth_me_fingerprint: {
      type: "string",
      pattern: "^[a-f0-9]{64}$"
    },
    audit_fingerprint: {
      type: "string",
      pattern: "^[a-f0-9]{64}$"
    },
    baseline_page_keys_version: {
      const: "BASELINE_PAGE_KEYS_V1"
    },
    baseline_page_keys_digest: {
      type: "string",
      pattern: "^[a-f0-9]{64}$"
    },
    data_migration_required: {
      const: false
    }
  }
};
Object.assign(schemaOverrides, memorySchemaOverrides);
Object.assign(schemaOverrides, externalProviderSchemaOverrides);
Object.assign(schemaOverrides, sessionAuthoritySchemaOverrides);

const compatibilityBaseline = {
  sourceCommit: "cefa7432f966e17b41c1638e128de652b934fd20",
  tables: [
    "platform_accounts:id,username,display_name,email,password_hash,status,created_at,updated_at",
    "platform_roles:id,role_key,name,description,status,is_builtin,created_at,updated_at",
    "platform_permissions:id,permission_key,resource_type,name,default_open,route_pattern,api_patterns_json,created_at,updated_at",
    "platform_account_roles:account_id,role_id,assigned_by,assigned_at",
    "platform_role_permissions:role_id,permission_id,effect,granted_by,granted_at",
    "platform_auth_sessions:id,account_id,token_hash,csrf_hash,ip_address,user_agent,created_at,expires_at,revoked_at,last_seen_at",
    "platform_login_attempts:id,username,ip_address,succeeded,created_at",
    "platform_access_logs:id,request_id,account_id,username,session_id,event_type,permission_key,route_path,api_pattern,method,status_code,ip_address,user_agent,failure_reason,occurred_at,metadata_json"
  ],
  api: [
    "POST /api/v1/auth/register",
    "POST /api/v1/auth/login",
    "POST /api/v1/auth/logout",
    "POST /api/v1/auth/change-password",
    "GET /api/v1/auth/me",
    "GET /api/v1/access/accounts",
    "PATCH /api/v1/access/accounts/{id}",
    "PUT /api/v1/access/accounts/{id}/roles",
    "POST /api/v1/access/accounts/{id}/revoke-sessions",
    "POST /api/v1/access/accounts/{id}/reset-password",
    "GET /api/v1/access/roles",
    "POST /api/v1/access/roles",
    "PATCH /api/v1/access/roles/{id}",
    "PUT /api/v1/access/roles/{id}/permissions",
    "GET /api/v1/access/permissions",
    "POST /api/v1/access/page-views",
    "GET /api/v1/access/logs",
    "GET /api/v1/access/logs/{id}"
  ],
  authMeFields: [
    "account",
    "roles",
    "is_system_admin",
    "permissions",
    "allowed_page_keys",
    "csrf_token"
  ],
  auditFields: [
    "request_id",
    "account_id",
    "username",
    "session_id",
    "event_type",
    "permission_key",
    "route_path",
    "api_pattern",
    "method",
    "status_code",
    "ip_address",
    "user_agent",
    "failure_reason",
    "occurred_at",
    "metadata_json"
  ],
  baselinePageKeys: [
    "page:architecture-configuration",
    "page:vehicle-platform",
    "page:requirements",
    "page:project-management",
    "page:projects",
    "page:dictionaries",
    "page:functions",
    "page:regulations",
    "page:architecture",
    "page:safety",
    "page:ota",
    "page:knowledge",
    "page:wiring-principle",
    "page:guide",
    "page:management-tools",
    "page:unmapped"
  ]
};

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const fixtureOverrides = {
  C02: {
    envelope_id: "envelope-contract-02",
    issuer: "process-copilot",
    audience: "gateway:connector-contract",
    tenant_id: "tenant-contract",
    subject_principal_id: "principal-contract",
    actor_principal_id: "process-copilot",
    pc_session_id: "session-contract",
    business_task_id: "task-contract",
    runtime_id: "runtime-contract",
    runtime_epoch: 1,
    assignment_generation: 1,
    fencing_token: "fence-contract",
    authorization_revision: 1,
    credential_generation: 1,
    allowed_actions: ["tool.execute"],
    resource_scope_refs: ["project:project-contract"],
    issued_at: "2026-11-10T00:00:00.000Z",
    expires_at: "2026-11-10T00:01:00.000Z",
    nonce: "nonce-contract",
    signature: "A".repeat(43)
  },
  C03: {
    authorization_revision: 1,
    policy_model_revision: 1,
    principal_id: "principal-contract",
    project_id: "project-contract",
    profile_release_id: "profile-contract",
    allowed_actions: ["tool.execute"],
    resource_scope_digest: `sha256:${"1".repeat(64)}`,
    tool_set_digest: `sha256:${"2".repeat(64)}`,
    decision: "ALLOW",
    reason_codes: ["authorization_intersection_allowed"],
    issued_at: "2026-11-10T00:00:00.000Z",
    expires_at: "2026-11-10T00:01:00.000Z",
    decision_evidence_refs: ["grant:contract"]
  },
  C04: {
    credential_lease_id: "lease-contract-04",
    connector_id: "connector-contract",
    external_account_id: "external-account-contract",
    credential_subject: "principal-contract",
    audience: "mcp://contract",
    scope_digest: `sha256:${"3".repeat(64)}`,
    generation: 1,
    expires_at: "2026-11-10T00:01:00.000Z",
    binding_mode: "bearer"
  },
  C05: {
    approval_id: "approval-contract-05",
    approval_version: 1,
    status: "APPROVED",
    subject_principal_id: "principal-contract",
    actor_principal_id: "process-copilot",
    operation_kind: "WRITE",
    target_digest: `sha256:${"4".repeat(64)}`,
    argument_digest: `sha256:${"5".repeat(64)}`,
    risk_class: "HIGH",
    authorization_revision: 1,
    requested_at: "2026-11-10T00:00:00.000Z",
    decided_at: "2026-11-10T00:00:30.000Z",
    expires_at: "2026-11-10T00:05:00.000Z",
    decision: {
      outcome: "APPROVE",
      decided_by: "approver-contract",
      reason_codes: ["business_owner_approved"]
    },
    decision_evidence_refs: ["evidence:contract"],
    snapshot_digest: `sha256:${"6".repeat(64)}`
  },
  C15: {
    tool_release_id: "tool-contract-15",
    tool_definition_id: "tool-contract",
    version: 1,
    provider_kind: "mcp-gateway",
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    schema_digest: "7".repeat(64),
    risk_manifest: {
      action_class: "WRITE",
      external_side_effect: true,
      sensitivity: "HIGH",
      requires_readback: true
    },
    required_permissions: ["tool.execute"],
    approval_policy: "ALWAYS",
    idempotency_class: "NON_IDEMPOTENT",
    recovery_class: "RECONCILE_BEFORE_RETRY",
    compatibility: { gateway_contract: 1 },
    status: "PUBLISHED",
    artifact_refs: ["artifact:tool-contract"],
    release_digest: "8".repeat(64)
  },
  C16: {
    plugin_release_id: "plugin-contract-16",
    plugin_definition_id: "plugin-contract",
    version: 1,
    source: { type: "repository", ref: "packages/gateway" },
    artifact_digest: "9".repeat(64),
    signature_refs: ["signature:contract"],
    sbom_ref: "sbom:contract",
    dsh_compatibility: "0.2.1-rc.3",
    dependencies: [],
    declared_capabilities: ["gateway-tool-provider"],
    risk_manifest: { modifies_dsh_core: false },
    status: "PUBLISHED",
    release_digest: "a".repeat(64)
  },
  C17: {
    resource_id: "res_contract_17",
    resource_version_id: "rv_contract_17_1",
    resource_type: "UPLOAD",
    tenant_id: "tenant-contract",
    owner_scope: { scope_type: "SESSION", scope_id: "session-contract" },
    content_digest: `sha256:${"1".repeat(64)}`,
    classification: "INTERNAL",
    provenance_ref: "provenance:upload:contract-17"
  },
  C18: {
    workspace_view_snapshot_id: "wvs_contract_18",
    pc_session_id: "session-contract",
    principal_id: "principal-contract",
    authorization_revision: 1,
    bindings: [{
      binding_id: "binding-contract",
      resource_ref: {
        resource_id: "res_contract_17",
        resource_version_id: "rv_contract_17_1"
      },
      scope_type: "SESSION",
      scope_id: "session-contract",
      allowed_actions: ["READ"]
    }],
    allowed_actions: ["READ"],
    created_at: "2026-11-10T00:00:00.000Z",
    expires_at: "2026-11-10T01:00:00.000Z",
    snapshot_digest: `sha256:${"2".repeat(64)}`
  },
  C19: {
    materialization_id: "mat_contract_19",
    workspace_view_snapshot_id: "wvs_contract_18",
    resource_refs: [{
      resource_id: "res_contract_17",
      resource_version_id: "rv_contract_17_1"
    }],
    purpose: "RUNTIME_INPUT",
    target_runtime_id: "runtime-contract",
    target_runtime_epoch: 1,
    pc_session_id: "session-contract",
    ttl: 3600,
    allowed_actions: ["READ"],
    requested_at: "2026-11-10T00:00:00.000Z"
  },
  C20: {
    materialization_id: "mat_contract_19",
    state: "READY",
    mount_ref: "materialization:mat_contract_19",
    materialized_entries: [{
      resource_id: "res_contract_17",
      resource_version_id: "rv_contract_17_1",
      relative_path: "input/document.txt",
      content_digest: `sha256:${"1".repeat(64)}`,
      bytes: 12,
      mode: "READ_ONLY"
    }],
    failed_entries: [],
    expires_at: "2026-11-10T01:00:00.000Z",
    cleanup_state: "ACTIVE",
    result_digest: `sha256:${"3".repeat(64)}`
  },
  C21: {
    operation_id: "operation-contract-21",
    idempotency_key: "idempotency-contract-21",
    tool_release_id: "tool-contract-15",
    schema_digest: "7".repeat(64),
    arguments: { target: "business-object-contract" },
    argument_digest: `sha256:${"5".repeat(64)}`,
    principal_envelope: {
      contract_name: "pc.principal-envelope/1",
      contract_version: 1,
      envelope_id: "envelope-contract-02",
      issuer: "process-copilot",
      audience: "gateway:connector-contract",
      tenant_id: "tenant-contract",
      subject_principal_id: "principal-contract",
      actor_principal_id: "process-copilot",
      pc_session_id: "session-contract",
      business_task_id: "task-contract",
      runtime_id: "runtime-contract",
      runtime_epoch: 1,
      assignment_generation: 1,
      fencing_token: "fence-contract",
      authorization_revision: 1,
      credential_generation: 1,
      allowed_actions: ["tool.execute"],
      resource_scope_refs: ["project:project-contract"],
      issued_at: "2026-11-10T00:00:00.000Z",
      expires_at: "2026-11-10T00:01:00.000Z",
      nonce: "nonce-contract",
      signature: "A".repeat(43)
    },
    assignment_snapshot_ref: "assignment-contract",
    approval_snapshot_ref: "approval-contract-05",
    workspace_view_snapshot_ref: "workspace-contract",
    deadline: "2026-11-10T00:01:00.000Z",
    recovery_class: "RECONCILE_BEFORE_RETRY"
  },
  C22: {
    operation_id: "operation-contract-21",
    status: "SUCCEEDED",
    provider_operation_id: "provider-operation-contract",
    result: { accepted: true },
    result_digest: `sha256:${"b".repeat(64)}`,
    external_evidence_refs: ["external:evidence:contract"],
    retryable: false,
    outcome_state: "KNOWN_SUCCESS",
    reconciliation_required: false,
    completed_at: "2026-11-10T00:00:45.000Z"
  },
  C23: {
    binding_id: "mcp-binding-contract-23",
    tenant_id: "tenant-contract",
    principal_id: "principal-contract",
    pc_session_id: "session-contract",
    connector_id: "connector-contract",
    mcp_server_id: "mcp-server-contract",
    protocol_session_id: "protocol-session-contract",
    authorization_revision: 1,
    credential_generation: 1,
    tool_catalog_digest: `sha256:${"c".repeat(64)}`,
    created_at: "2026-11-10T00:00:00.000Z",
    expires_at: "2026-11-10T00:05:00.000Z",
    state: "ACTIVE"
  },
  C24: {
    operation_id: "operation-contract-21",
    operation_kind: "WRITE",
    idempotency_key: "idempotency-contract-21",
    fencing_token: "fence-contract",
    request_digest: `sha256:${"d".repeat(64)}`,
    provider_operation_id: "provider-operation-contract",
    dispatch_state: "COMPLETED",
    outcome_state: "KNOWN_SUCCESS",
    recovery_class: "RECONCILE_BEFORE_RETRY",
    last_reconciled_at: "2026-11-10T00:00:45.000Z",
    evidence_refs: ["external:evidence:contract"],
    version: 2
  },
  C25: {
    event_id: "event-contract-25",
    event_type: "pc.task.started",
    event_schema_version: 1,
    producer: "pc-control-plane",
    producer_version: "1.0.0",
    tenant_id: "tenant-contract",
    principal_id: "principal-contract",
    stream_kind: "TASK",
    stream_id: "task-contract",
    stream_sequence: 2,
    aggregate_revision: 2,
    business_task_id: "task-contract",
    correlation_id: "correlation-contract",
    durability: "DURABLE_PC",
    occurred_at: "2026-11-10T00:00:00.000Z",
    observed_at: "2026-11-10T00:00:01.000Z",
    payload: { state: "RUNNING" },
    payload_digest: `sha256:${"4".repeat(64)}`
  },
  C26: {
    producer: "pc-control-plane",
    stream_kind: "TASK",
    stream_id: "task-contract",
    cursor: "pc-control-plane:TASK:task-contract:2",
    last_event_id: "event-contract-25",
    last_sequence: 2,
    state: "COMPLETE",
    expected_next_sequence: 3,
    captured_at: "2026-11-10T00:00:01.000Z"
  },
  C27: {
    business_task_id: "task-contract",
    tenant_id: "tenant-contract",
    owner_principal_id: "principal-contract",
    project_id: "project-contract",
    state: "RUNNING",
    profile_release_id: "profile-contract",
    source_session_ids: ["session-contract"],
    projection_complete: true,
    last_event_id: "event-contract-25",
    state_digest: `sha256:${"5".repeat(64)}`,
    created_at: "2026-11-10T00:00:00.000Z",
    updated_at: "2026-11-10T00:00:01.000Z",
    version: 2
  },
  C28: {
    operation_id: "operation-contract-28",
    business_task_id: "task-contract",
    tenant_id: "tenant-contract",
    owner_principal_id: "principal-contract",
    operation_kind: "WRITE",
    state: "OUTCOME_UNKNOWN",
    recovery_class: "RECONCILE_BEFORE_RETRY",
    approval_id: "approval-contract-05",
    external_operation_record_id: "operation-contract-21",
    input_digest: `sha256:${"6".repeat(64)}`,
    result_digest: `sha256:${"7".repeat(64)}`,
    evidence_refs: ["gateway:operation-contract-21"],
    projection_complete: true,
    last_event_id: "event-operation-contract",
    updated_at: "2026-11-10T00:00:02.000Z",
    version: 4
  },
  C29: {
    recovery_case_id: "recovery-contract-29",
    tenant_id: "tenant-contract",
    owner_principal_id: "principal-contract",
    business_task_id: "task-contract",
    trigger: "OUTCOME_UNKNOWN",
    affected_runtime_id: "runtime-contract",
    affected_session_id: "session-contract",
    affected_operation_ids: ["operation-contract-28"],
    current_assignment: { assignment_id: "assignment-contract" },
    persistent_facts: { last_stable_event_id: "event-contract-25" },
    authorization_checkpoint: { authorization_revision: 1 },
    decision: {
      classification: "RECONCILE_BEFORE_RETRY",
      action: "RECONCILE",
      reason_codes: ["outcome_unknown"]
    },
    state: "RECONCILING",
    created_at: "2026-11-10T00:00:03.000Z",
    updated_at: "2026-11-10T00:00:04.000Z",
    version: 2
  },
  C30: {
    operation_id: "operation-contract-28",
    provider_facts: { provider_operation_id: "provider-contract" },
    resolved_outcome_state: "KNOWN_SUCCESS",
    action: "RECORD_SUCCESS",
    evidence_refs: ["provider:readback-contract"],
    reconciled_at: "2026-11-10T00:00:05.000Z"
  },
  C32: {
    audit_id: "audit-contract-32",
    event_type: "RESOURCE_MATERIALIZED",
    tenant_id: "tenant-contract",
    subject_principal_id: "principal-contract",
    actor_principal_id: "process-copilot",
    resource_refs: [{
      resource_id: "res_contract_17",
      resource_version_id: "rv_contract_17_1"
    }],
    operation_id: "operation-contract-32",
    authorization_revision: 1,
    decision: { outcome: "SUCCESS", reason_codes: ["materialization_ready"] },
    evidence_refs: ["materialization:mat_contract_19"],
    occurred_at: "2026-11-10T00:00:00.000Z",
    previous_hash: `sha256:${"0".repeat(64)}`,
    entry_hash: `sha256:${"4".repeat(64)}`,
    retention_class: "RESOURCE_LIFECYCLE"
  },
  C35: {
    role_package_id: "role-package:fo:1",
    role_key: "fo",
    display_name: "Function Owner",
    authorization_role_ref: "eeclaw-role:fo",
    responsibility_keys: ["fo"],
    module_relation_release_ref: "role-module-release:fo:1",
    workbench_projection_release_ref: "workbench-release:fo:1",
    role_configuration_release_ref: "role-config-release:fo:1",
    workflow_contribution_refs: ["workflow-contribution:ssts-draft:1"],
    artifact_contract_refs: ["artifact-contract:ssts-draft:1"],
    tool_profile_requirement_refs: ["profile-requirement:fo:1"],
    release_version: 1,
    release_digest: digest({ role: "fo", release: 1 }),
    status: "PUBLISHED"
  },
  C36: {
    responsibility_assignment_id: "responsibility:project-1:fo:account-1",
    account_id: "account-1",
    responsibility_key: "fo",
    scope_type: "project",
    scope_id: "project-1",
    status: "active",
    assigned_by: "account-admin",
    revision: 1
  },
  C37: {
    role_key: "fo",
    module_key: "architecture",
    visibility: "visible",
    capabilities: ["read", "edit"],
    focus: "primary",
    requestable: false,
    policy_artifact_release_id: "policy-release:fo-modules:1",
    policy_model_revision: 1
  },
  C38: {
    workbench_projection_release_id: "workbench-release:fo:1",
    role_package_id: "role-package:fo:1",
    release_version: 1,
    module_relations: ["role-module-release:fo:1"],
    navigation: [{ key: "architecture", focus: "primary" }],
    metrics: [],
    work_items: [],
    workflow_views: ["ssts-draft"],
    artifact_views: ["ssts-draft"],
    component_refs: ["ModuleNavigation"],
    payload_checksum: digest({ role: "fo", workbench: 1 }),
    policy_model_revision: 1,
    status: "PUBLISHED"
  },
  C39: {
    role_configuration_release_id: "role-config-release:fo:1",
    role_package_id: "role-package:fo:1",
    release_version: 1,
    schema_version: 1,
    configuration_keys: ["module.navigation"],
    defaults: [{ key: "module.navigation", value: "architecture" }],
    lock_levels: ["role_default"],
    scope_rules: [{ scope_type: "project" }],
    component_refs: ["ModuleNavigation"],
    payload_checksum: digest({ role: "fo", configuration: 1 }),
    policy_model_revision: 1,
    status: "PUBLISHED"
  },
  C40: {
    artifact_release_id: "policy-release:fo-modules:1",
    artifact_definition_id: "policy-definition:fo-modules",
    artifact_kind: "workbench_projection",
    release_version: 1,
    schema_version: 1,
    payload: { entries: [{ key: "module.navigation", value: "architecture" }] },
    payload_checksum: digest({ entries: [{ key: "module.navigation", value: "architecture" }] }),
    code_registry_revision: "registry-1",
    compatibility_declaration_ref: "compatibility:eeclaw-v1",
    approval_evidence_refs: ["approval:business-owner:1", "approval:publisher:1"],
    lifecycle_state: "PUBLISHED",
    published_environment: "test"
  },
  C41: {
    subject_account_id: "account-1",
    actor_service_id: "process-copilot",
    permission_key: "page:architecture",
    scope: { type: "project", id: "project-1" },
    decision: "ALLOW",
    reason_codes: ["exact_role_allow"],
    source: "role",
    role_refs: ["eeclaw-role:fo"],
    authorization_revision: 1,
    authorization_version_digest: digest({ account: "account-1", roles: ["fo"] }),
    policy_model_revision: 1,
    policy_artifact_release_refs: ["policy-release:fo-modules:1"]
  },
  C42: {
    source_commit: compatibilityBaseline.sourceCommit,
    schema_fingerprint: digest(compatibilityBaseline.tables),
    api_fingerprint: digest(compatibilityBaseline.api),
    auth_me_fingerprint: digest(compatibilityBaseline.authMeFields),
    audit_fingerprint: digest(compatibilityBaseline.auditFields),
    baseline_page_keys_version: "BASELINE_PAGE_KEYS_V1",
    baseline_page_keys_digest: digest(compatibilityBaseline.baselinePageKeys),
    revocation_mode: "request_time",
    data_migration_required: false
  }
};
Object.assign(fixtureOverrides, memoryFixtureOverrides);
Object.assign(fixtureOverrides, externalProviderFixtureOverrides);
Object.assign(fixtureOverrides, sessionAuthorityFixtureOverrides);

function fieldSchema(contractId, field) {
  const schemaOverride = schemaOverrides[contractId]?.[field];
  if (schemaOverride) return schemaOverride;
  const enumValues = enumOverrides[contractId]?.[field];
  if (enumValues) return { type: "string", enum: enumValues };
  if (booleanFields.has(field)) return { type: "boolean" };
  if (integerFields.has(field) || /(?:_seq|_count)$/.test(field)) {
    return { type: "integer", minimum: 0 };
  }
  if (arrayFields.has(field) || /(?:_ids|_refs|_actions|_capabilities)$/.test(field)) {
    return { type: "array", items: {} };
  }
  if (objectFields.has(field)) return { type: "object", additionalProperties: true };
  if (
    field === "deadline" ||
    /(?:_at|_from|_to)$/.test(field)
  ) {
    return { type: "string", format: "date-time" };
  }
  if (field === "ttl") return { type: "integer", minimum: 1 };
  return { type: "string", minLength: 1 };
}

function fixtureValue(contractId, field, schema) {
  if (fixtureOverrides[contractId]?.[field] !== undefined) {
    return fixtureOverrides[contractId][field];
  }
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.type === "boolean") return true;
  if (schema.type === "integer") return Math.max(schema.minimum ?? 0, 1);
  if (schema.type === "array") return [];
  if (schema.type === "object") return {};
  if (schema.format === "date-time") return "2026-11-09T00:00:00.000Z";
  if (field === "contract_name") return contractId;
  return `${field}-value`;
}

function tsType(schema) {
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "array") return "unknown[]";
  if (schema.type === "object") return "Record<string, unknown>";
  return "string";
}

const sectionPattern =
  /### (C\d{2}) `([^`]+)`([\s\S]*?)(?=\n### C\d{2} |\n## \d+\.|\s*$)/g;
const contracts = [];

for (const [source, catalog] of catalogSources) {
  let match;
  while ((match = sectionPattern.exec(catalog)) !== null) {
    const [, id, contractName, section] = match;
    const blocks = [...section.matchAll(/```text\r?\n([\s\S]*?)```/g)];
    const fieldBlocks = Number(id.slice(1)) >= 43 ? blocks.slice(0, 1) : blocks;
    const fields = fieldBlocks
    .flatMap((block) => block[1].split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => /^[a-z][a-z0-9_]*(?:\[\])?\??$/.test(line))
    .map((line) => line.replace(/\[\](?=\??$)/, ""))
    .filter((line) => !["contract_name", "contract_version"].includes(line.replace(/\?$/, "")))
    .filter((line, index, values) => values.indexOf(line) === index);
    if (fields.length === 0) throw new Error(`No fields parsed for ${id}`);
    contracts.push({
      id,
      contractName,
      source,
      fields: fields.map((field) => ({
        name: field.replace(/\?$/, ""),
        optional: field.endsWith("?")
      }))
    });
  }
}

if (contracts.length !== 69 || new Set(contracts.map(({ id }) => id)).size !== 69) {
  throw new Error(`Expected 69 unique contracts, parsed ${contracts.length}`);
}

const outputDirectories = [
  path.join(packageRoot, "schemas"),
  path.join(packageRoot, "fixtures", "valid"),
  path.join(packageRoot, "fixtures", "invalid"),
  path.join(packageRoot, "src", "generated")
];
for (const directory of outputDirectories) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

const manifest = [];
const interfaces = [
  "/* Generated from architecture stable, memory, and external-provider contract catalogs. Do not edit. */",
  ""
];

for (const contract of contracts) {
  const properties = {
    contract_name: { const: contract.contractName },
    contract_version: { type: "integer", const: 1 }
  };
  for (const field of contract.fields) {
    properties[field.name] = fieldSchema(contract.id, field.name);
  }
  const required = [...new Set([
    "contract_name",
    "contract_version",
    ...contract.fields.filter((field) => !field.optional).map((field) => field.name)
  ])];
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://contracts.process-copilot.local/v1/${contract.id}.schema.json`,
    title: `${contract.id} ${contract.contractName}`,
    type: "object",
    additionalProperties: Number(contract.id.slice(1)) < 43 && ![
      "C02",
      "C03",
      "C04",
      "C05",
      "C15",
      "C16",
      "C17",
      "C18",
      "C19",
      "C20",
      "C21",
      "C22",
      "C23",
      "C24",
      "C32"
    ].includes(contract.id),
    required,
    properties,
    $comment: `${contract.id}; source=architecture/${contract.source}`,
    ...(externalProviderRootSchemaOverrides[contract.id] ?? {}),
    ...(sessionAuthorityRootSchemaOverrides[contract.id] ?? {})
  };
  const valid = Object.fromEntries(
    Object.entries(properties).map(([field, propertySchema]) => [
      field,
      fixtureValue(contract.id, field, propertySchema)
    ])
  );
  for (const field of sessionAuthorityFixtureOmissions[contract.id] ?? []) delete valid[field];
  if (Number(contract.id.slice(1)) >= 67) {
    const digestField = { C67: "assurance_digest", C68: "decision_digest", C69: "artifact_digest" }[contract.id];
    const canonical = (value) => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
    const content = { ...valid };
    delete content[digestField];
    valid[digestField] = `sha256:${digest(canonical(content))}`;
  }
  const missingField = required.find(
    (field) => field !== "contract_name" && field !== "contract_version"
  );
  const invalid = { ...valid };
  delete invalid[missingField];

  const schemaFile = `${contract.id}.${contract.contractName.replaceAll("/", "-")}.schema.json`;
  const validFile = `${contract.id}.valid.json`;
  const invalidFile = `${contract.id}.missing-${missingField}.invalid.json`;
  await writeFile(
    path.join(packageRoot, "schemas", schemaFile),
    `${JSON.stringify(schema, null, 2)}\n`
  );
  await writeFile(
    path.join(packageRoot, "fixtures", "valid", validFile),
    `${JSON.stringify(valid, null, 2)}\n`
  );
  await writeFile(
    path.join(packageRoot, "fixtures", "invalid", invalidFile),
    `${JSON.stringify(invalid, null, 2)}\n`
  );

  const interfaceName = `${contract.id}Contract`;
  interfaces.push(`export interface ${interfaceName} {`);
  for (const [field, propertySchema] of Object.entries(properties)) {
    const sourceField = contract.fields.find((candidate) => candidate.name === field);
    const optional = sourceField?.optional ? "?" : "";
    interfaces.push(`  ${field}${optional}: ${tsType(propertySchema)};`);
  }
  interfaces.push("  [key: string]: unknown;", "}", "");
  manifest.push({
    id: contract.id,
    contract_name: contract.contractName,
    contract_version: 1,
    schema: `schemas/${schemaFile}`,
    valid_fixture: `fixtures/valid/${validFile}`,
    invalid_fixture: `fixtures/invalid/${invalidFile}`
  });
}

await writeFile(
  path.join(packageRoot, "contract-manifest.json"),
  `${JSON.stringify({ generated_at: "2026-11-17", contracts: manifest }, null, 2)}\n`
);
await writeFile(
  path.join(packageRoot, "src", "generated", "contracts.ts"),
  `${interfaces.join("\n").trimEnd()}\n`
);

console.log(`Generated ${contracts.length} schemas, valid fixtures, invalid fixtures, and TypeScript interfaces.`);
