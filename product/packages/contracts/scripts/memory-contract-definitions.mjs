const string = { type: "string", minLength: 1 };
const dateTime = { type: "string", format: "date-time" };
const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const strings = { type: "array", uniqueItems: true, items: string };
const refs = strings;
const nullableDateTime = { anyOf: [dateTime, { type: "null" }] };
const memoryKind = {
  type: "string",
  enum: ["EXPLICIT_PREFERENCE", "CONFIRMED_FACT", "ONGOING_GOAL", "DECISION_HISTORY", "PROJECT_FACT", "RUNBOOK", "FAILURE_GOTCHA"]
};
const temporalRole = { type: "string", enum: ["CURRENT", "HISTORICAL"] };
const validTime = {
  type: "object",
  additionalProperties: false,
  required: ["valid_from"],
  properties: { valid_from: dateTime, valid_to: nullableDateTime }
};
const authorizedViewItem = {
  type: "object",
  additionalProperties: false,
  required: ["memory_id", "revision_id", "memory_kind", "content", "source_summary", "valid_time", "confidence", "usage_constraints", "retrieval_reason", "source_revalidation_result", "temporal_role"],
  properties: {
    memory_id: string,
    revision_id: string,
    memory_kind: memoryKind,
    content: { type: "object", minProperties: 1, additionalProperties: true },
    source_summary: string,
    valid_time: validTime,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    usage_constraints: strings,
    retrieval_reason: string,
    source_revalidation_result: { type: "string", enum: ["ALLOWED", "DENIED", "STALE"] },
    temporal_role: temporalRole
  }
};
const runtimeContextItem = {
  type: "object",
  additionalProperties: false,
  required: ["memory_id", "revision_id", "memory_kind", "content", "temporal_role", "usage_constraints"],
  properties: {
    memory_id: string,
    revision_id: string,
    memory_kind: memoryKind,
    content: { type: "object", minProperties: 1, additionalProperties: true },
    temporal_role: temporalRole,
    usage_constraints: strings
  }
};

export const memoryEnumOverrides = {
  C43: {
    scope_type: ["PERSONAL", "PROJECT", "SYSTEM"],
    memory_kind: ["EXPLICIT_PREFERENCE", "CONFIRMED_FACT", "ONGOING_GOAL", "DECISION_HISTORY", "PROJECT_FACT", "RUNBOOK", "FAILURE_GOTCHA"],
    sensitivity: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"],
    object_state: ["CANDIDATE", "CONFIRMED", "PUBLISHED", "REVOKED", "EXPIRED", "REJECTED"]
  },
  C44: { revision_state: ["CURRENT", "SUPERSEDED", "WITHDRAWN"] },
  C45: {
    source_kind: ["CONVERSATION_MESSAGE", "RESOURCE_VERSION", "BUSINESS_EVENT", "TOOL_RESULT"],
    sensitivity: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"],
    displayability: ["DISPLAYABLE", "SUMMARY_ONLY", "HIDDEN"]
  },
  C46: {
    capture_mode: ["EXPLICIT_USER_SAVE", "AUTOMATIC_CANDIDATE", "PROJECT_CANDIDATE", "SYSTEM_CANDIDATE"],
    memory_kind: ["EXPLICIT_PREFERENCE", "CONFIRMED_FACT", "ONGOING_GOAL", "DECISION_HISTORY", "PROJECT_FACT", "RUNBOOK", "FAILURE_GOTCHA"],
    expected_result_state: ["CANDIDATE", "CONFIRMED"]
  },
  C47: { decision: ["CONFIRM", "PUBLISH", "REJECT"] },
  C48: { revision_reason: ["CORRECTION", "TEMPORAL_CHANGE", "CONTENT_UPDATE", "SCOPE_CHANGE", "SENSITIVITY_CHANGE"] },
  C50: { purpose: ["PERSONALIZATION", "TASK_CONTINUITY", "DECISION_RECALL", "PROJECT_ASSISTANCE", "RUNBOOK_ASSISTANCE", "EMPLOYEE_REVIEW", "DELEGATE_RESPONSE"] },
  C53: { answer_reference_status: ["PROVIDED", "REFERENCED", "NOT_USED", "REFUSED_DUE_TO_CONFLICT"] },
  C54: {
    change_kind: ["CREATED", "CONFIRMED", "PUBLISHED", "REVISED", "SUPERSEDED", "REVOKED", "EXPIRED"],
    object_state: ["CANDIDATE", "CONFIRMED", "PUBLISHED", "REVOKED", "EXPIRED", "REJECTED"],
    revision_state: ["CURRENT", "SUPERSEDED", "WITHDRAWN"],
    sensitivity: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"]
  },
  C55: { action: ["UPSERT", "HIDE", "DELETE", "REBUILD_SCOPE"] },
  C56: {
    acceptance_status: ["PENDING", "ACCEPTED", "REJECTED", "UNKNOWN"],
    readback_status: ["PENDING", "VERIFIED", "FAILED", "UNKNOWN"],
    retryability: ["RETRYABLE", "NON_RETRYABLE", "RECONCILE"]
  },
  C57: {
    activation_status: ["PENDING", "ACTIVE", "FAILED", "SUPERSEDED"]
  },
  C58: {
    decision_kind: ["CAPTURE", "QUERY", "REVISE", "REVOKE", "CONTEXT_ASSEMBLY"],
    purpose: ["PERSONALIZATION", "TASK_CONTINUITY", "DECISION_RECALL", "PROJECT_ASSISTANCE", "RUNBOOK_ASSISTANCE", "EMPLOYEE_REVIEW", "DELEGATE_RESPONSE"],
    decision: ["ALLOW", "DENY", "REQUIRE_CONFIRMATION", "REQUIRE_REDACTION", "REQUIRE_ESCALATION"]
  },
  C60: {
    trigger_kind: ["SUPERSEDED", "REVOKED", "EXPIRED", "SOURCE_ACCESS_LOST", "SCOPE_CHANGED", "POLICY_REVOKED", "POISONING_DETECTED"],
    target_memory_state: ["INVALIDATED"],
    fencing_action: ["REVOKE_ASSIGNMENT"],
    rotation_policy: ["FRESH_SESSION_NO_REPLAY"],
    invalidation_status: ["PENDING", "FENCED", "RELEASING", "ROTATED", "RECOVERY_REQUIRED"]
  }
};

export const memorySchemaOverrides = {
  C43: {
    version: { type: "integer", minimum: 1 },
    policy_revision: { type: "integer", minimum: 1 }
  },
  C44: {
    revision_no: { type: "integer", minimum: 1 },
    structured_content: { type: "object", minProperties: 1, additionalProperties: true },
    source_evidence_ids: { ...strings, minItems: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    valid_to: nullableDateTime,
    content_digest: digest,
    schema_revision: { type: "integer", minimum: 1 }
  },
  C45: {
    evidence_digest: digest,
    access_revalidation_policy: {
      type: "string",
      enum: ["OWNER_ONLY", "CURRENT_SOURCE_ACCESS", "CURRENT_PROJECT_MEMBERSHIP"]
    }
  },
  C46: {
    request_context_ref: string,
    scope_request: {
      type: "object",
      additionalProperties: false,
      required: ["scope_type"],
      properties: {
        scope_type: { type: "string", enum: ["PERSONAL", "PROJECT", "SYSTEM"] },
        scope_id: string
      }
    },
    content: { type: "object", minProperties: 1, additionalProperties: true },
    source_evidence_inputs: { type: "array", minItems: 1, items: { type: "object", minProperties: 1 } },
    valid_time: {
      type: "object",
      additionalProperties: false,
      required: ["valid_from"],
      properties: { valid_from: dateTime, valid_to: nullableDateTime }
    },
    capture_policy_revision: { type: "integer", minimum: 1 }
  },
  C47: {
    expected_object_version: { type: "integer", minimum: 1 },
    authorization_revision: { type: "integer", minimum: 0 },
    policy_revision: { type: "integer", minimum: 1 },
    decision_reason_codes: { ...strings, minItems: 1 },
    content_adjustment: { type: "object", minProperties: 1, additionalProperties: true },
    scope_adjustment: { type: "object", minProperties: 1, additionalProperties: true },
    sensitivity_adjustment: { type: "string", enum: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] }
  },
  C48: {
    expected_object_version: { type: "integer", minimum: 1 },
    new_content: { type: "object", minProperties: 1, additionalProperties: true },
    new_source_evidence_inputs: { type: "array", minItems: 1, items: { type: "object", minProperties: 1 } },
    new_valid_time: {
      type: "object",
      additionalProperties: false,
      required: ["valid_from"],
      properties: { valid_from: dateTime, valid_to: nullableDateTime }
    },
    scope_adjustment: { type: "object", minProperties: 1, additionalProperties: true },
    sensitivity_adjustment: { type: "string", enum: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] },
    authorization_revision: { type: "integer", minimum: 0 },
    policy_revision: { type: "integer", minimum: 1 }
  },
  C49: {
    expected_object_version: { type: "integer", minimum: 1 },
    authorization_revision: { type: "integer", minimum: 0 },
    propagation_targets: { ...strings, minItems: 1 }
  },
  C50: {
    authorization_revision: { type: "integer", minimum: 0 },
    allowed_kinds: strings,
    allowed_sensitivities: strings,
    max_items: { type: "integer", minimum: 1 },
    max_context_tokens: { type: "integer", minimum: 1 }
  },
  C51: {
    authorization_revision: { type: "integer", minimum: 0 },
    policy_revision: { type: "integer", minimum: 1 },
    authority_snapshot_revision: { type: "integer", minimum: 1 },
    items: { type: "array", items: authorizedViewItem },
    denied_reason_summary: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
    view_digest: digest
  },
  C52: {
    items: { type: "array", items: runtimeContextItem },
    context_policy_revision: { type: "integer", minimum: 1 },
    token_budget: { type: "integer", minimum: 1 },
    context_digest: digest
  },
  C53: {
    memory_revision_refs: { ...refs, minItems: 1 },
    source_revalidation_refs: refs,
    context_digest: digest
  },
  C54: {
    object_version: { type: "integer", minimum: 1 },
    scope_digest: digest,
    policy_revision: { type: "integer", minimum: 1 },
    producer_sequence: { type: "integer", minimum: 1 }
  },
  C55: {
    authority_snapshot_revision: { type: "integer", minimum: 1 },
    scope_manifest: { type: "object", minProperties: 1, additionalProperties: true },
    revision_refs: refs,
    source_evidence_refs: refs,
    content_payload: { type: "object", minProperties: 1, additionalProperties: true }
  },
  C56: {
    observed_revision_refs: refs,
    residual_match_count: { type: "integer", minimum: 0 },
    receipt_digest: digest
  },
  C57: {
    authority_snapshot_revision: { type: "integer", minimum: 1 },
    scope_manifest: { type: "object", minProperties: 1, additionalProperties: true },
    expected_counts: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
    expected_digest: digest,
    verification_result: { type: "object", minProperties: 1, additionalProperties: true }
  },
  C58: {
    authorization_revision: { type: "integer", minimum: 0 },
    policy_revision: { type: "integer", minimum: 1 },
    reason_codes: { ...strings, minItems: 1 },
    evidence_refs: refs,
    decision_digest: digest
  },
  C59: {
    assignment_generation: { type: "integer", minimum: 1 },
    context_digest: digest,
    memory_revision_refs: { ...refs, minItems: 1 },
    authorization_revision: { type: "integer", minimum: 0 },
    policy_revision: { type: "integer", minimum: 1 },
    session_memory_state_after_exposure: { type: "string", enum: ["EXPOSED"] }
  },
  C60: {
    current_assignment_generation: { type: "integer", minimum: 1 },
    affected_memory_revision_refs: { ...refs, minItems: 1 },
    authority_change_event_ids: { ...refs, minItems: 1 }
  }
};

const ts = "2026-11-17T00:00:00.000Z";
const d = (character) => `sha256:${character.repeat(64)}`;

export const memoryFixtureOverrides = {
  C43: { memory_id: "mem_contract_43", tenant_id: "tenant-contract", owner_principal_id: "principal-contract", subject_principal_id: "principal-contract", scope_type: "PERSONAL", scope_id: "principal-contract", memory_kind: "EXPLICIT_PREFERENCE", sensitivity: "INTERNAL", object_state: "CONFIRMED", current_revision_id: "mrev_contract_44", policy_revision: 1, created_at: ts, updated_at: ts, version: 1 },
  C44: { revision_id: "mrev_contract_44", memory_id: "mem_contract_43", revision_no: 1, revision_state: "CURRENT", structured_content: { preference: "lead with the conclusion" }, retrieval_summary: "response structure preference", source_evidence_ids: ["mev_contract_45"], confidence: 1, valid_from: ts, valid_to: null, recorded_at: ts, created_by_principal_id: "principal-contract", creation_reason: "EXPLICIT_USER_SAVE", content_digest: d("4"), schema_revision: 1 },
  C45: { source_evidence_id: "mev_contract_45", tenant_id: "tenant-contract", source_kind: "CONVERSATION_MESSAGE", source_authority: "process-copilot", source_object_id: "message-contract", source_version_id: "message-version-contract", source_fragment_ref: "message:body", source_subject_principal_id: "principal-contract", captured_by_principal_id: "principal-contract", captured_at: ts, observed_at: ts, sensitivity: "INTERNAL", displayability: "DISPLAYABLE", evidence_digest: d("5"), access_revalidation_policy: "OWNER_ONLY" },
  C46: { command_id: "mcmd_contract_46", idempotency_key: "idem-contract-46", request_context_ref: "request-context-contract", capture_mode: "EXPLICIT_USER_SAVE", owner_principal_id: "principal-contract", scope_request: { scope_type: "PERSONAL" }, memory_kind: "EXPLICIT_PREFERENCE", content: { preference: "lead with the conclusion" }, source_evidence_inputs: [{ source_kind: "CONVERSATION_MESSAGE", source_object_id: "message-contract" }], valid_time: { valid_from: ts, valid_to: null }, sensitivity_hint: "INTERNAL", capture_policy_revision: 1, expected_result_state: "CONFIRMED", issued_at: ts, deadline: "2026-11-17T00:01:00.000Z" },
  C47: { command_id: "mcmd_contract_47", idempotency_key: "idem-contract-47", candidate_memory_id: "mem_candidate_contract", expected_object_version: 1, decision: "CONFIRM", decided_by_principal_id: "principal-contract", authorization_revision: 1, policy_revision: 1, decision_reason_codes: ["owner_confirmed"], content_adjustment: { preference: "concise" }, scope_adjustment: { scope_type: "PERSONAL" }, sensitivity_adjustment: "INTERNAL", issued_at: ts, deadline: "2026-11-17T00:01:00.000Z" },
  C48: { command_id: "mcmd_contract_48", idempotency_key: "idem-contract-48", memory_id: "mem_contract_43", expected_object_version: 1, expected_current_revision_id: "mrev_contract_44", revision_reason: "CORRECTION", new_content: { preference: "conclusion then evidence" }, new_source_evidence_inputs: [{ source_kind: "CONVERSATION_MESSAGE", source_object_id: "message-contract-2" }], new_valid_time: { valid_from: ts, valid_to: null }, scope_adjustment: { scope_type: "PERSONAL" }, sensitivity_adjustment: "INTERNAL", principal_id: "principal-contract", authorization_revision: 1, policy_revision: 1, issued_at: ts, deadline: "2026-11-17T00:01:00.000Z" },
  C49: { command_id: "mcmd_contract_49", idempotency_key: "idem-contract-49", memory_id: "mem_contract_43", expected_object_version: 2, expected_current_revision_id: "mrev_contract_48", principal_id: "principal-contract", authorization_revision: 1, revoke_reason: "OWNER_REQUEST", propagation_targets: ["POSTGRES_PROJECTION", "RUNTIME_CONTEXT"], retention_policy_ref: "retention-policy-contract", issued_at: ts, deadline: "2026-11-17T00:01:00.000Z" },
  C50: { query_id: "mquery_contract_50", tenant_id: "tenant-contract", principal_id: "principal-contract", actor_principal_id: "principal-contract", authorization_revision: 1, purpose: "PERSONALIZATION", conversation_id: "conversation-contract", task_id: "task-contract", project_id: "project-contract", profile_release_id: "profile-contract", query_text: "preferred response format", allowed_kinds: ["EXPLICIT_PREFERENCE"], allowed_sensitivities: ["INTERNAL"], valid_at: ts, max_items: 5, max_context_tokens: 800, projection_release_constraint: "memory-projection-contract", issued_at: ts, deadline: "2026-11-17T00:00:05.000Z" },
  C51: { authorized_view_id: "mview_contract_51", tenant_id: "tenant-contract", principal_id: "principal-contract", purpose: "PERSONALIZATION", authorization_revision: 1, policy_revision: 1, projection_release: "memory-projection-contract", authority_snapshot_revision: 1, items: [{ memory_id: "mem_contract_43", revision_id: "mrev_contract_44", memory_kind: "EXPLICIT_PREFERENCE", content: { preference: "lead with the conclusion" }, source_summary: "user-confirmed conversation message", valid_time: { valid_from: ts, valid_to: null }, confidence: 1, usage_constraints: ["FACTUAL_CONTEXT_ONLY"], retrieval_reason: "relevant preference", source_revalidation_result: "ALLOWED", temporal_role: "CURRENT" }], denied_reason_summary: {}, issued_at: ts, expires_at: "2026-11-17T00:05:00.000Z", view_digest: d("1") },
  C52: { context_id: "mctx_contract_52", authorized_view_id: "mview_contract_51", pc_session_id: "session-contract", turn_id: "turn-contract", principal_id: "principal-contract", purpose: "PERSONALIZATION", items: [{ memory_id: "mem_contract_43", revision_id: "mrev_contract_44", memory_kind: "EXPLICIT_PREFERENCE", content: { preference: "lead with the conclusion" }, temporal_role: "CURRENT", usage_constraints: ["UNTRUSTED_FACTUAL_CONTEXT", "NO_TOOL_AUTHORITY"] }], context_policy_revision: 1, token_budget: 800, context_digest: d("2"), issued_at: ts, expires_at: "2026-11-17T00:05:00.000Z" },
  C53: { usage_id: "musage_contract_53", tenant_id: "tenant-contract", principal_id: "principal-contract", conversation_id: "conversation-contract", turn_id: "turn-contract", purpose: "PERSONALIZATION", authorized_view_id: "mview_contract_51", memory_revision_refs: ["mem_contract_43:mrev_contract_44"], source_revalidation_refs: ["mev_contract_45:allowed"], context_digest: d("2"), provided_to_runtime_at: ts, answer_reference_status: "REFERENCED", recorded_at: ts, trace_id: "trace-contract" },
  C54: { event_id: "mevent_contract_54", tenant_id: "tenant-contract", memory_id: "mem_contract_43", revision_id: "mrev_contract_44", object_version: 1, change_kind: "CONFIRMED", object_state: "CONFIRMED", revision_state: "CURRENT", scope_digest: d("3"), sensitivity: "INTERNAL", policy_revision: 1, occurred_at: ts, producer_sequence: 1, causation_command_id: "mcmd_contract_46" },
  C55: { projection_operation_id: "mprojop_contract_55", idempotency_key: "idem-contract-55", projection_release: "memory-projection-contract", provider_namespace: "postgres-lexical", authority_change_event_id: "mevent_contract_54", authority_snapshot_revision: 1, scope_manifest: { tenant_id: "tenant-contract", owner_principal_id: "principal-contract" }, action: "UPSERT", revision_refs: ["mrev_contract_44"], source_evidence_refs: ["mev_contract_45"], content_payload: { retrieval_summary: "response structure preference" }, issued_at: ts, deadline: "2026-11-17T00:01:00.000Z" },
  C56: { projection_operation_id: "mprojop_contract_55", provider_operation_ref: "postgres-tx-contract", provider_release: "postgres-lexical-v1", acceptance_status: "ACCEPTED", accepted_at: ts, readback_status: "VERIFIED", readback_at: ts, observed_revision_refs: ["mrev_contract_44"], residual_match_count: 0, retryability: "NON_RETRYABLE", receipt_digest: d("6") },
  C57: { rebuild_id: "mrebuild_contract_57", projection_release: "memory-projection-contract", authority_snapshot_revision: 1, tenant_id: "tenant-contract", scope_manifest: { owner_principal_id: "principal-contract" }, memory_revision_manifest_ref: "manifest:memory:contract", source_evidence_manifest_ref: "manifest:evidence:contract", cursor: "cursor-contract", expected_counts: { memories: 1, revisions: 1 }, expected_digest: d("7"), started_at: ts, completed_at: ts, activation_status: "ACTIVE", verification_result: { status: "VERIFIED" } },
  C58: { decision_id: "mdecision_contract_58", decision_kind: "CAPTURE", tenant_id: "tenant-contract", principal_id: "principal-contract", memory_id: "mem_contract_43", revision_id: "mrev_contract_44", purpose: "PERSONALIZATION", authorization_revision: 1, policy_revision: 1, decision: "ALLOW", reason_codes: ["explicit_owner_save"], evidence_refs: ["mev_contract_45"], decided_at: ts, expires_at: "2026-11-17T00:05:00.000Z", decision_digest: d("8") },
  C59: { exposure_id: "mexposure_contract_59", tenant_id: "tenant-contract", principal_id: "principal-contract", pc_session_id: "session-contract", dsh_session_id: "dsh-session-contract", assignment_generation: 1, turn_id: "turn-contract", authorized_view_id: "mview_contract_51", context_id: "mctx_contract_52", context_digest: d("2"), memory_revision_refs: ["mrev_contract_44"], authorization_revision: 1, policy_revision: 1, exposed_at: ts, session_memory_state_after_exposure: "EXPOSED" },
  C60: { invalidation_id: "minvalidation_contract_60", idempotency_key: "idem-contract-60", tenant_id: "tenant-contract", pc_session_id: "session-contract", dsh_session_id: "dsh-session-contract", current_assignment_generation: 1, affected_memory_revision_refs: ["mrev_contract_44"], trigger_kind: "REVOKED", authority_change_event_ids: ["mevent-contract-revoked"], target_memory_state: "INVALIDATED", fencing_action: "REVOKE_ASSIGNMENT", rotation_policy: "FRESH_SESSION_NO_REPLAY", invalidation_status: "PENDING", issued_at: ts, deadline: "2026-11-17T00:01:00.000Z", completed_at: ts, recovery_case_id: "recovery-contract" }
};
