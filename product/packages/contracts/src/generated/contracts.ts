/* Generated from architecture stable, memory, and external-provider contract catalogs. Do not edit. */

export interface C01Contract {
  contract_name: string;
  contract_version: number;
  tenant_id: string;
  principal_id: string;
  actor_id: string;
  authentication_context_id: string;
  authorization_revision: number;
  request_id: string;
  trace_id: string;
  client_context: Record<string, unknown>;
  [key: string]: unknown;
}

export interface C02Contract {
  contract_name: string;
  contract_version: number;
  envelope_id: string;
  issuer: string;
  audience: string;
  tenant_id: string;
  subject_principal_id: string;
  actor_principal_id: string;
  pc_session_id: string;
  business_task_id?: string;
  runtime_id: string;
  runtime_epoch: number;
  assignment_generation: number;
  fencing_token?: string;
  authorization_revision: number;
  credential_generation?: number;
  allowed_actions: unknown[];
  resource_scope_refs: unknown[];
  issued_at: string;
  expires_at: string;
  nonce: string;
  signature: string;
  [key: string]: unknown;
}

export interface C03Contract {
  contract_name: string;
  contract_version: number;
  authorization_revision: number;
  policy_model_revision: number;
  principal_id: string;
  project_id?: string;
  profile_release_id?: string;
  allowed_actions: unknown[];
  resource_scope_digest: string;
  tool_set_digest: string;
  decision: "ALLOW" | "DENY";
  reason_codes: unknown[];
  issued_at: string;
  expires_at: string;
  decision_evidence_refs: unknown[];
  [key: string]: unknown;
}

export interface C04Contract {
  contract_name: string;
  contract_version: number;
  credential_lease_id: string;
  connector_id: string;
  external_account_id: string;
  credential_subject: string;
  audience: string;
  scope_digest: string;
  generation: number;
  expires_at: string;
  binding_mode: "bearer" | "dpop" | "mtls";
  [key: string]: unknown;
}

export interface C05Contract {
  contract_name: string;
  contract_version: number;
  approval_id: string;
  approval_version: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CONSUMED" | "REVOKED" | "EXPIRED" | "CANCELLED";
  subject_principal_id: string;
  actor_principal_id: string;
  operation_kind: "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL_SIDE_EFFECT";
  target_digest: string;
  argument_digest: string;
  risk_class: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  authorization_revision: number;
  requested_at: string;
  decided_at?: string;
  expires_at?: string;
  decision: Record<string, unknown>;
  decision_evidence_refs: unknown[];
  snapshot_digest: string;
  [key: string]: unknown;
}

export interface C06Contract {
  contract_name: string;
  contract_version: number;
  runtime_id: string;
  runtime_epoch: number;
  tenant_id: string;
  owner_user_id: string;
  worker_pool_id: string;
  state: string;
  profile_bundle_digest: string;
  capability_manifest_digest: string;
  capacity: Record<string, unknown>;
  health_summary: Record<string, unknown>;
  created_at: string;
  last_heartbeat_at: string;
  version: number;
  [key: string]: unknown;
}

export interface C07Contract {
  contract_name: string;
  contract_version: number;
  runtime_id: string;
  runtime_epoch: number;
  dsh_version: string;
  bridge_protocol_versions: unknown[];
  profile_digest: string;
  bundle_lock_digest: string;
  plugin_releases: unknown[];
  agent_presets: unknown[];
  tool_provider_capabilities: unknown[];
  persistence_capabilities: unknown[];
  event_export_capabilities: unknown[];
  approval_capabilities: unknown[];
  resource_capabilities: unknown[];
  limits: Record<string, unknown>;
  generated_at: string;
  manifest_digest: string;
  [key: string]: unknown;
}

export interface C08Contract {
  contract_name: string;
  contract_version: number;
  assignment_id: string;
  pc_session_id: string;
  runtime_id: string;
  runtime_epoch: number;
  assignment_generation: number;
  fencing_token: string;
  lease_id: string;
  lease_expires_at: string;
  state: string;
  effective_profile_snapshot_id: string;
  workspace_view_snapshot_id: string;
  authorization_revision: number;
  version: number;
  [key: string]: unknown;
}

export interface C09Contract {
  contract_name: string;
  contract_version: number;
  command_id: string;
  command_type: "ASSIGN_SESSION" | "REVOKE_SESSION" | "START_TURN" | "CANCEL_TURN" | "RESUME_SESSION" | "FLUSH_SESSION" | "DRAIN_RUNTIME" | "TERMINATE_RUNTIME" | "QUERY_HEALTH" | "QUERY_CAPABILITIES" | "CATCH_UP_EVENTS";
  deadline: string;
  runtime_id: string;
  runtime_epoch: number;
  pc_session_id?: string;
  assignment_generation?: number;
  fencing_token?: string;
  expected_state_version?: string;
  payload: Record<string, unknown>;
  [key: string]: unknown;
}

export interface C10Contract {
  contract_name: string;
  contract_version: number;
  command_id: string;
  accepted: boolean;
  committed: boolean;
  outcome_state: "KNOWN_SUCCESS" | "KNOWN_FAILURE" | "NOT_STARTED" | "OUTCOME_UNKNOWN";
  runtime_observation: Record<string, unknown>;
  adapter_error?: Record<string, unknown>;
  event_cursor?: string;
  completed_at: string;
  [key: string]: unknown;
}

export interface C11Contract {
  contract_name: string;
  contract_version: number;
  runtime_id: string;
  runtime_epoch: number;
  report_seq: number;
  liveness: string;
  readiness: string;
  capability_health: Record<string, unknown>;
  capacity_health: Record<string, unknown>;
  assignment_health: Record<string, unknown>;
  active_sessions: number;
  active_turns: number;
  inflight_tools: number;
  pending_flushes: number;
  observed_at: string;
  [key: string]: unknown;
}

export interface C12Contract {
  contract_name: string;
  contract_version: number;
  profile_release_id: string;
  profile_definition_id: string;
  release_version: number;
  status: string;
  instructions_ref: string;
  rules_ref: string;
  tool_requirements: unknown[];
  plugin_requirements: unknown[];
  model_policy: Record<string, unknown>;
  knowledge_policy: Record<string, unknown>;
  output_contract: Record<string, unknown>;
  completion_contract: Record<string, unknown>;
  dependency_lock_digest: string;
  published_at: string;
  release_digest: string;
  [key: string]: unknown;
}

export interface C13Contract {
  contract_name: string;
  contract_version: number;
  effective_profile_snapshot_id: string;
  pc_session_id: string;
  profile_release_id: string;
  profile_assignment_ids: unknown[];
  authorization_revision: number;
  tool_release_ids: unknown[];
  plugin_release_ids: unknown[];
  model_selection: Record<string, unknown>;
  knowledge_view_refs: unknown[];
  dsh_preset_ref: string;
  runtime_requirements: Record<string, unknown>;
  resolution_report_id: string;
  created_at: string;
  snapshot_digest: string;
  [key: string]: unknown;
}

export interface C14Contract {
  contract_name: string;
  contract_version: number;
  resolution_report_id: string;
  requested_profile_release_id: string;
  inputs: Record<string, unknown>;
  selected: Record<string, unknown>;
  omitted: Record<string, unknown>;
  conflicts: unknown[];
  warnings: unknown[];
  hard_failures: unknown[];
  runtime_compatibility: Record<string, unknown>;
  created_at: string;
  [key: string]: unknown;
}

export interface C15Contract {
  contract_name: string;
  contract_version: number;
  tool_release_id: string;
  tool_definition_id: string;
  version: number;
  provider_kind: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  schema_digest: string;
  risk_manifest: Record<string, unknown>;
  required_permissions: unknown[];
  approval_policy: "NONE" | "ALWAYS";
  idempotency_class: "IDEMPOTENT" | "NON_IDEMPOTENT";
  recovery_class: "REPLAY_SAFE" | "IDEMPOTENT_RETRY" | "RECONCILE_BEFORE_RETRY" | "NON_RECOVERABLE" | "EXTERNAL_DURABLE_JOB";
  compatibility: Record<string, unknown>;
  status: "PUBLISHED" | "REVOKED" | "SUPERSEDED";
  artifact_refs: unknown[];
  release_digest: string;
  [key: string]: unknown;
}

export interface C16Contract {
  contract_name: string;
  contract_version: number;
  plugin_release_id: string;
  plugin_definition_id: string;
  version: number;
  source: Record<string, unknown>;
  artifact_digest: string;
  signature_refs: unknown[];
  sbom_ref: string;
  dsh_compatibility: string;
  dependencies: unknown[];
  declared_capabilities: unknown[];
  risk_manifest: Record<string, unknown>;
  status: "PUBLISHED" | "REVOKED" | "SUPERSEDED";
  release_digest: string;
  [key: string]: unknown;
}

export interface C17Contract {
  contract_name: string;
  contract_version: number;
  resource_id: string;
  resource_version_id: string;
  resource_type: "UPLOAD" | "ATTACHMENT" | "WORKSPACE_FILE" | "ARTIFACT" | "EXTERNAL_REFERENCE" | "EVIDENCE_SNAPSHOT" | "DERIVED";
  tenant_id: string;
  owner_scope: Record<string, unknown>;
  content_digest: string;
  classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  provenance_ref: string;
  [key: string]: unknown;
}

export interface C18Contract {
  contract_name: string;
  contract_version: number;
  workspace_view_snapshot_id: string;
  pc_session_id: string;
  principal_id: string;
  authorization_revision: number;
  bindings: unknown[];
  allowed_actions: unknown[];
  created_at: string;
  expires_at?: string;
  snapshot_digest: string;
  [key: string]: unknown;
}

export interface C19Contract {
  contract_name: string;
  contract_version: number;
  materialization_id: string;
  workspace_view_snapshot_id: string;
  resource_refs: unknown[];
  purpose: "RUNTIME_INPUT" | "TOOL_INPUT" | "DERIVATION" | "DOWNLOAD" | "EVIDENCE";
  target_runtime_id: string;
  target_runtime_epoch: number;
  pc_session_id: string;
  ttl: number;
  allowed_actions: unknown[];
  requested_at: string;
  [key: string]: unknown;
}

export interface C20Contract {
  contract_name: string;
  contract_version: number;
  materialization_id: string;
  state: "READY" | "PARTIAL" | "FAILED" | "EXPIRED" | "CLEANED";
  mount_ref: string;
  materialized_entries: unknown[];
  failed_entries: unknown[];
  expires_at: string;
  cleanup_state: "PENDING" | "ACTIVE" | "CLEANED" | "FAILED";
  result_digest: string;
  [key: string]: unknown;
}

export interface C21Contract {
  contract_name: string;
  contract_version: number;
  operation_id: string;
  idempotency_key: string;
  tool_release_id: string;
  schema_digest: string;
  arguments: Record<string, unknown>;
  argument_digest: string;
  principal_envelope: Record<string, unknown>;
  assignment_snapshot_ref: string;
  approval_snapshot_ref?: string;
  workspace_view_snapshot_ref?: string;
  deadline: string;
  recovery_class: "REPLAY_SAFE" | "IDEMPOTENT_RETRY" | "RECONCILE_BEFORE_RETRY" | "NON_RECOVERABLE" | "EXTERNAL_DURABLE_JOB";
  [key: string]: unknown;
}

export interface C22Contract {
  contract_name: string;
  contract_version: number;
  operation_id: string;
  status: "SUCCEEDED" | "FAILED" | "OUTCOME_UNKNOWN" | "RECONCILIATION_REQUIRED";
  provider_operation_id?: string;
  result: Record<string, unknown>;
  result_digest: string;
  external_evidence_refs: unknown[];
  retryable: boolean;
  outcome_state: "KNOWN_SUCCESS" | "KNOWN_FAILURE" | "NOT_STARTED" | "OUTCOME_UNKNOWN";
  reconciliation_required: boolean;
  completed_at: string;
  [key: string]: unknown;
}

export interface C23Contract {
  contract_name: string;
  contract_version: number;
  binding_id: string;
  tenant_id: string;
  principal_id: string;
  pc_session_id: string;
  connector_id: string;
  mcp_server_id: string;
  protocol_session_id?: string;
  authorization_revision: number;
  credential_generation: number;
  tool_catalog_digest: string;
  created_at: string;
  expires_at: string;
  state: "ACTIVE" | "REAUTH_REQUIRED" | "CLOSED" | "EXPIRED";
  [key: string]: unknown;
}

export interface C24Contract {
  contract_name: string;
  contract_version: number;
  operation_id: string;
  operation_kind: "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL_SIDE_EFFECT";
  idempotency_key: string;
  fencing_token: string;
  request_digest: string;
  provider_operation_id?: string;
  dispatch_state: "PENDING" | "DISPATCHED" | "COMPLETED" | "UNKNOWN" | "RECONCILING";
  outcome_state: "KNOWN_SUCCESS" | "KNOWN_FAILURE" | "NOT_STARTED" | "OUTCOME_UNKNOWN";
  recovery_class: "REPLAY_SAFE" | "IDEMPOTENT_RETRY" | "RECONCILE_BEFORE_RETRY" | "NON_RECOVERABLE" | "EXTERNAL_DURABLE_JOB";
  last_reconciled_at?: string;
  evidence_refs: unknown[];
  version: number;
  [key: string]: unknown;
}

export interface C25Contract {
  contract_name: string;
  contract_version: number;
  event_id: string;
  event_type: string;
  event_schema_version: number;
  producer: string;
  producer_version: string;
  tenant_id: string;
  principal_id: string;
  stream_kind: "RUNTIME" | "SESSION" | "TASK" | "OPERATION" | "APPROVAL" | "RECOVERY";
  stream_id: string;
  stream_sequence: number;
  aggregate_revision?: number;
  business_task_id?: string;
  operation_id?: string;
  approval_id?: string;
  causation_id?: string;
  correlation_id?: string;
  runtime_id?: string;
  runtime_epoch?: number;
  pc_session_id?: string;
  dsh_session_id?: string;
  dsh_session_seq?: number;
  runtime_event_seq?: number;
  assignment_generation?: number;
  fencing_token?: string;
  durability: "EPHEMERAL" | "OBSERVED" | "DURABLE_DSH" | "DURABLE_PC";
  occurred_at: string;
  observed_at: string;
  payload: Record<string, unknown>;
  payload_digest: string;
  [key: string]: unknown;
}

export interface C26Contract {
  contract_name: string;
  contract_version: number;
  producer: string;
  stream_kind: "RUNTIME" | "SESSION" | "TASK" | "OPERATION" | "APPROVAL" | "RECOVERY";
  stream_id: string;
  cursor: string;
  last_event_id: string;
  last_sequence: number;
  state: "COMPLETE" | "GAP" | "QUARANTINED";
  expected_next_sequence: number;
  gap_detected_at?: string;
  captured_at: string;
  [key: string]: unknown;
}

export interface C27Contract {
  contract_name: string;
  contract_version: number;
  business_task_id: string;
  tenant_id: string;
  owner_principal_id: string;
  project_id?: string;
  state: "DRAFT" | "READY" | "RUNNING" | "WAITING_USER" | "WAITING_APPROVAL" | "PAUSED" | "RECOVERING" | "COMPLETED" | "FAILED" | "CANCELLED";
  current_subtask_id?: string;
  profile_release_id: string;
  source_session_ids: unknown[];
  projection_complete: boolean;
  last_event_id: string;
  state_digest: string;
  created_at: string;
  updated_at: string;
  version: number;
  [key: string]: unknown;
}

export interface C28Contract {
  contract_name: string;
  contract_version: number;
  operation_id: string;
  business_task_id: string;
  tenant_id: string;
  owner_principal_id: string;
  operation_kind: "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL_SIDE_EFFECT";
  state: "PLANNED" | "AWAITING_APPROVAL" | "APPROVED" | "DISPATCHING" | "DISPATCHED" | "VERIFYING" | "SUCCEEDED" | "FAILED" | "OUTCOME_UNKNOWN" | "RECONCILING" | "COMPENSATION_REQUIRED";
  recovery_class: "REPLAY_SAFE" | "IDEMPOTENT_RETRY" | "RECONCILE_BEFORE_RETRY" | "NON_RECOVERABLE" | "EXTERNAL_DURABLE_JOB";
  approval_id?: string;
  external_operation_record_id?: string;
  input_digest: string;
  result_digest?: string;
  evidence_refs: unknown[];
  projection_complete: boolean;
  last_event_id: string;
  updated_at: string;
  version: number;
  [key: string]: unknown;
}

export interface C29Contract {
  contract_name: string;
  contract_version: number;
  recovery_case_id: string;
  tenant_id: string;
  owner_principal_id: string;
  business_task_id?: string;
  trigger: "RUNTIME_LOST" | "ASSIGNMENT_EXPIRED" | "EVENT_GAP" | "OUTCOME_UNKNOWN" | "APPROVAL_WAIT" | "MANUAL";
  affected_runtime_id?: string;
  affected_session_id?: string;
  affected_operation_ids: unknown[];
  current_assignment: Record<string, unknown>;
  persistent_facts: Record<string, unknown>;
  authorization_checkpoint: Record<string, unknown>;
  decision: Record<string, unknown>;
  state: "RECOVERY_PENDING" | "RECOVERING" | "RECONCILING" | "WAITING_APPROVAL" | "MANUAL_REQUIRED" | "RECOVERED" | "RECOVERY_FAILED";
  manual_action?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  version: number;
  [key: string]: unknown;
}

export interface C30Contract {
  contract_name: string;
  contract_version: number;
  operation_id: string;
  provider_facts: Record<string, unknown>;
  resolved_outcome_state: "KNOWN_SUCCESS" | "KNOWN_FAILURE" | "NOT_STARTED" | "OUTCOME_UNKNOWN";
  action: "RECORD_SUCCESS" | "RECORD_FAILURE" | "RETRY_SAME_KEY" | "CONTINUE_RECONCILIATION" | "REQUIRE_MANUAL" | "CREATE_COMPENSATION";
  compensation_ref?: string;
  evidence_refs: unknown[];
  reconciled_at: string;
  [key: string]: unknown;
}

export interface C31Contract {
  contract_name: string;
  contract_version: number;
  code: string;
  message: string;
  retryable: boolean;
  outcome_state: string;
  recovery_action: string;
  runtime_id?: string;
  runtime_epoch?: number;
  pc_session_id?: string;
  assignment_generation?: number;
  command_id?: string;
  details: Record<string, unknown>;
  diagnostic_cause?: string;
  [key: string]: unknown;
}

export interface C32Contract {
  contract_name: string;
  contract_version: number;
  audit_id: string;
  event_type: string;
  tenant_id: string;
  subject_principal_id?: string;
  actor_principal_id?: string;
  resource_refs: unknown[];
  operation_id?: string;
  authorization_revision?: number;
  decision: Record<string, unknown>;
  evidence_refs: unknown[];
  occurred_at: string;
  previous_hash?: string;
  entry_hash: string;
  retention_class: "SECURITY" | "BUSINESS" | "RESOURCE_LIFECYCLE";
  [key: string]: unknown;
}

export interface C33Contract {
  contract_name: string;
  contract_version: number;
  component: string;
  component_version: string;
  contract_versions: unknown[];
  dsh_version_range?: string;
  bridge_protocol_versions?: unknown[];
  profile_schema_versions?: unknown[];
  plugin_api_versions?: unknown[];
  required_capabilities: unknown[];
  known_incompatibilities: unknown[];
  tested_combinations: unknown[];
  generated_at: string;
  declaration_digest: string;
  [key: string]: unknown;
}

export interface C34Contract {
  contract_name: string;
  contract_version: number;
  requirement_id: string;
  adr_ids: unknown[];
  module_ids: unknown[];
  contract_ids: unknown[];
  implementation_refs: unknown[];
  test_refs: unknown[];
  evidence_refs: unknown[];
  status: string;
  owner: string;
  [key: string]: unknown;
}

export interface C35Contract {
  contract_name: string;
  contract_version: number;
  role_package_id: string;
  role_key: string;
  display_name: string;
  authorization_role_ref: string;
  responsibility_keys: unknown[];
  module_relation_release_ref: string;
  workbench_projection_release_ref: string;
  role_configuration_release_ref: string;
  workflow_contribution_refs: unknown[];
  artifact_contract_refs: unknown[];
  tool_profile_requirement_refs: unknown[];
  release_version: number;
  release_digest: string;
  status: "DRAFT" | "VALIDATED" | "APPROVED" | "PUBLISHED" | "SUPERSEDED";
  [key: string]: unknown;
}

export interface C36Contract {
  contract_name: string;
  contract_version: number;
  responsibility_assignment_id: string;
  account_id: string;
  responsibility_key: string;
  scope_type: "project" | "module" | "stage" | "global";
  scope_id: string;
  valid_from: string;
  valid_to?: string;
  status: "active" | "inactive";
  assigned_by: string;
  assigned_at: string;
  revision: number;
  [key: string]: unknown;
}

export interface C37Contract {
  contract_name: string;
  contract_version: number;
  role_key: string;
  module_key: string;
  visibility: "none" | "visible";
  capabilities: unknown[];
  focus: "none" | "secondary" | "primary";
  requestable: boolean;
  policy_artifact_release_id: string;
  policy_model_revision: number;
  [key: string]: unknown;
}

export interface C38Contract {
  contract_name: string;
  contract_version: number;
  workbench_projection_release_id: string;
  role_package_id: string;
  release_version: number;
  module_relations: unknown[];
  navigation: unknown[];
  metrics: unknown[];
  work_items: unknown[];
  workflow_views: unknown[];
  artifact_views: unknown[];
  component_refs: unknown[];
  payload_checksum: string;
  policy_model_revision: number;
  status: "DRAFT" | "VALIDATED" | "APPROVED" | "PUBLISHED" | "SUPERSEDED";
  [key: string]: unknown;
}

export interface C39Contract {
  contract_name: string;
  contract_version: number;
  role_configuration_release_id: string;
  role_package_id: string;
  release_version: number;
  schema_version: number;
  configuration_keys: unknown[];
  defaults: unknown[];
  lock_levels: unknown[];
  scope_rules: unknown[];
  component_refs: unknown[];
  payload_checksum: string;
  policy_model_revision: number;
  status: "DRAFT" | "VALIDATED" | "APPROVED" | "PUBLISHED" | "SUPERSEDED";
  [key: string]: unknown;
}

export interface C40Contract {
  contract_name: string;
  contract_version: number;
  artifact_release_id: string;
  artifact_definition_id: string;
  artifact_kind: "workbench_projection" | "role_configuration_schema" | "role_configuration_defaults" | "permission_bundle" | "capability_policy" | "workflow_contribution" | "artifact_contract";
  release_version: number;
  schema_version: number;
  payload: Record<string, unknown>;
  payload_checksum: string;
  code_registry_revision: string;
  compatibility_declaration_ref: string;
  approval_evidence_refs: unknown[];
  lifecycle_state: "DRAFT" | "VALIDATED" | "APPROVED" | "PUBLISHED" | "SUPERSEDED";
  published_environment?: "dev" | "test" | "prod";
  supersedes_release_id?: string;
  created_at: string;
  published_at?: string;
  [key: string]: unknown;
}

export interface C41Contract {
  contract_name: string;
  contract_version: number;
  subject_account_id: string;
  actor_service_id?: string;
  permission_key: string;
  scope: Record<string, unknown>;
  decision: "ALLOW" | "DENY";
  reason_codes: unknown[];
  source: "baseline" | "role" | "deny" | "system_admin";
  role_refs: unknown[];
  authorization_revision?: number;
  authorization_version_digest: string;
  policy_model_revision: number;
  policy_artifact_release_refs: unknown[];
  decided_at: string;
  observed_at: string;
  expires_at?: string;
  [key: string]: unknown;
}

export interface C42Contract {
  contract_name: string;
  contract_version: number;
  source_commit: string;
  schema_fingerprint: string;
  api_fingerprint: string;
  auth_me_fingerprint: string;
  audit_fingerprint: string;
  baseline_page_keys_version: string;
  baseline_page_keys_digest: string;
  revocation_mode: "request_time";
  data_migration_required: string;
  declared_at: string;
  [key: string]: unknown;
}

export interface C43Contract {
  contract_name: string;
  contract_version: number;
  memory_id: string;
  tenant_id: string;
  owner_principal_id: string;
  subject_principal_id?: string;
  scope_type: "PERSONAL" | "PROJECT" | "SYSTEM";
  scope_id: string;
  memory_kind: "EXPLICIT_PREFERENCE" | "CONFIRMED_FACT" | "ONGOING_GOAL" | "DECISION_HISTORY" | "PROJECT_FACT" | "RUNBOOK" | "FAILURE_GOTCHA";
  sensitivity: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  object_state: "CANDIDATE" | "CONFIRMED" | "PUBLISHED" | "REVOKED" | "EXPIRED" | "REJECTED";
  current_revision_id?: string;
  policy_revision: number;
  created_at: string;
  updated_at: string;
  version: number;
  [key: string]: unknown;
}

export interface C44Contract {
  contract_name: string;
  contract_version: number;
  revision_id: string;
  memory_id: string;
  revision_no: number;
  revision_state: "CURRENT" | "SUPERSEDED" | "WITHDRAWN";
  structured_content: Record<string, unknown>;
  retrieval_summary: string;
  source_evidence_ids: unknown[];
  confidence: number;
  valid_from: string;
  valid_to?: string;
  recorded_at: string;
  created_by_principal_id: string;
  creation_reason: string;
  supersedes_revision_id?: string;
  content_digest: string;
  schema_revision: number;
  [key: string]: unknown;
}

export interface C45Contract {
  contract_name: string;
  contract_version: number;
  source_evidence_id: string;
  tenant_id: string;
  source_kind: "CONVERSATION_MESSAGE" | "RESOURCE_VERSION" | "BUSINESS_EVENT" | "TOOL_RESULT";
  source_authority: string;
  source_object_id: string;
  source_version_id?: string;
  source_fragment_ref?: string;
  source_subject_principal_id?: string;
  captured_by_principal_id: string;
  captured_at: string;
  observed_at: string;
  sensitivity: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  displayability: "DISPLAYABLE" | "SUMMARY_ONLY" | "HIDDEN";
  evidence_digest: string;
  access_revalidation_policy: "OWNER_ONLY" | "CURRENT_SOURCE_ACCESS" | "CURRENT_PROJECT_MEMBERSHIP";
  [key: string]: unknown;
}

export interface C46Contract {
  contract_name: string;
  contract_version: number;
  command_id: string;
  idempotency_key: string;
  request_context_ref: string;
  capture_mode: "EXPLICIT_USER_SAVE" | "AUTOMATIC_CANDIDATE" | "PROJECT_CANDIDATE" | "SYSTEM_CANDIDATE";
  owner_principal_id: string;
  scope_request: Record<string, unknown>;
  memory_kind: "EXPLICIT_PREFERENCE" | "CONFIRMED_FACT" | "ONGOING_GOAL" | "DECISION_HISTORY" | "PROJECT_FACT" | "RUNBOOK" | "FAILURE_GOTCHA";
  content: Record<string, unknown>;
  source_evidence_inputs: unknown[];
  valid_time: Record<string, unknown>;
  sensitivity_hint?: string;
  capture_policy_revision: number;
  expected_result_state: "CANDIDATE" | "CONFIRMED";
  issued_at: string;
  deadline: string;
  [key: string]: unknown;
}

export interface C47Contract {
  contract_name: string;
  contract_version: number;
  command_id: string;
  idempotency_key: string;
  candidate_memory_id: string;
  expected_object_version: number;
  decision: "CONFIRM" | "PUBLISH" | "REJECT";
  decided_by_principal_id: string;
  authorization_revision: number;
  policy_revision: number;
  decision_reason_codes: unknown[];
  content_adjustment?: Record<string, unknown>;
  scope_adjustment?: Record<string, unknown>;
  sensitivity_adjustment?: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  issued_at: string;
  deadline: string;
  [key: string]: unknown;
}

export interface C48Contract {
  contract_name: string;
  contract_version: number;
  command_id: string;
  idempotency_key: string;
  memory_id: string;
  expected_object_version: number;
  expected_current_revision_id: string;
  revision_reason: "CORRECTION" | "TEMPORAL_CHANGE" | "CONTENT_UPDATE" | "SCOPE_CHANGE" | "SENSITIVITY_CHANGE";
  new_content: Record<string, unknown>;
  new_source_evidence_inputs: unknown[];
  new_valid_time: Record<string, unknown>;
  scope_adjustment?: Record<string, unknown>;
  sensitivity_adjustment?: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  principal_id: string;
  authorization_revision: number;
  policy_revision: number;
  issued_at: string;
  deadline: string;
  [key: string]: unknown;
}

export interface C49Contract {
  contract_name: string;
  contract_version: number;
  command_id: string;
  idempotency_key: string;
  memory_id: string;
  expected_object_version: number;
  expected_current_revision_id?: string;
  principal_id: string;
  authorization_revision: number;
  revoke_reason: string;
  propagation_targets: unknown[];
  retention_policy_ref: string;
  issued_at: string;
  deadline: string;
  [key: string]: unknown;
}

export interface C50Contract {
  contract_name: string;
  contract_version: number;
  query_id: string;
  tenant_id: string;
  principal_id: string;
  actor_principal_id: string;
  authorization_revision: number;
  purpose: "PERSONALIZATION" | "TASK_CONTINUITY" | "DECISION_RECALL" | "PROJECT_ASSISTANCE" | "RUNBOOK_ASSISTANCE" | "EMPLOYEE_REVIEW" | "DELEGATE_RESPONSE";
  conversation_id?: string;
  task_id?: string;
  project_id?: string;
  profile_release_id?: string;
  query_text: string;
  allowed_kinds: unknown[];
  allowed_sensitivities: unknown[];
  valid_at: string;
  max_items: number;
  max_context_tokens: number;
  projection_release_constraint?: string;
  issued_at: string;
  deadline: string;
  [key: string]: unknown;
}

export interface C51Contract {
  contract_name: string;
  contract_version: number;
  authorized_view_id: string;
  tenant_id: string;
  principal_id: string;
  purpose: string;
  authorization_revision: number;
  policy_revision: number;
  projection_release: string;
  authority_snapshot_revision: number;
  items: unknown[];
  denied_reason_summary: Record<string, unknown>;
  issued_at: string;
  expires_at: string;
  view_digest: string;
  [key: string]: unknown;
}

export interface C52Contract {
  contract_name: string;
  contract_version: number;
  context_id: string;
  authorized_view_id: string;
  pc_session_id: string;
  turn_id: string;
  principal_id: string;
  purpose: string;
  items: unknown[];
  context_policy_revision: number;
  token_budget: number;
  context_digest: string;
  issued_at: string;
  expires_at: string;
  [key: string]: unknown;
}

export interface C53Contract {
  contract_name: string;
  contract_version: number;
  usage_id: string;
  tenant_id: string;
  principal_id: string;
  conversation_id: string;
  turn_id: string;
  purpose: string;
  authorized_view_id: string;
  memory_revision_refs: unknown[];
  source_revalidation_refs: unknown[];
  context_digest: string;
  provided_to_runtime_at: string;
  answer_reference_status: "PROVIDED" | "REFERENCED" | "NOT_USED" | "REFUSED_DUE_TO_CONFLICT";
  recorded_at: string;
  trace_id: string;
  [key: string]: unknown;
}

export interface C54Contract {
  contract_name: string;
  contract_version: number;
  event_id: string;
  tenant_id: string;
  memory_id: string;
  revision_id?: string;
  object_version: number;
  change_kind: "CREATED" | "CONFIRMED" | "PUBLISHED" | "REVISED" | "SUPERSEDED" | "REVOKED" | "EXPIRED";
  object_state: "CANDIDATE" | "CONFIRMED" | "PUBLISHED" | "REVOKED" | "EXPIRED" | "REJECTED";
  revision_state?: "CURRENT" | "SUPERSEDED" | "WITHDRAWN";
  scope_digest: string;
  sensitivity: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  policy_revision: number;
  occurred_at: string;
  producer_sequence: number;
  causation_command_id: string;
  [key: string]: unknown;
}

export interface C55Contract {
  contract_name: string;
  contract_version: number;
  projection_operation_id: string;
  idempotency_key: string;
  projection_release: string;
  provider_namespace: string;
  authority_change_event_id: string;
  authority_snapshot_revision: number;
  scope_manifest: Record<string, unknown>;
  action: "UPSERT" | "HIDE" | "DELETE" | "REBUILD_SCOPE";
  revision_refs: unknown[];
  source_evidence_refs: unknown[];
  content_payload?: Record<string, unknown>;
  issued_at: string;
  deadline: string;
  [key: string]: unknown;
}

export interface C56Contract {
  contract_name: string;
  contract_version: number;
  projection_operation_id: string;
  provider_operation_ref: string;
  provider_release: string;
  acceptance_status: "PENDING" | "ACCEPTED" | "REJECTED" | "UNKNOWN";
  accepted_at?: string;
  readback_status: "PENDING" | "VERIFIED" | "FAILED" | "UNKNOWN";
  readback_at?: string;
  observed_revision_refs: unknown[];
  residual_match_count?: number;
  error_code?: string;
  retryability: "RETRYABLE" | "NON_RETRYABLE" | "RECONCILE";
  receipt_digest: string;
  [key: string]: unknown;
}

export interface C57Contract {
  contract_name: string;
  contract_version: number;
  rebuild_id: string;
  projection_release: string;
  authority_snapshot_revision: number;
  tenant_id: string;
  scope_manifest: Record<string, unknown>;
  memory_revision_manifest_ref: string;
  source_evidence_manifest_ref: string;
  cursor?: string;
  expected_counts: Record<string, unknown>;
  expected_digest: string;
  started_at: string;
  completed_at?: string;
  activation_status: "PENDING" | "ACTIVE" | "FAILED" | "SUPERSEDED";
  verification_result?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface C58Contract {
  contract_name: string;
  contract_version: number;
  decision_id: string;
  decision_kind: "CAPTURE" | "QUERY" | "REVISE" | "REVOKE" | "CONTEXT_ASSEMBLY";
  tenant_id: string;
  principal_id: string;
  memory_id?: string;
  revision_id?: string;
  purpose?: "PERSONALIZATION" | "TASK_CONTINUITY" | "DECISION_RECALL" | "PROJECT_ASSISTANCE" | "RUNBOOK_ASSISTANCE" | "EMPLOYEE_REVIEW" | "DELEGATE_RESPONSE";
  authorization_revision: number;
  policy_revision: number;
  decision: "ALLOW" | "DENY" | "REQUIRE_CONFIRMATION" | "REQUIRE_REDACTION" | "REQUIRE_ESCALATION";
  reason_codes: unknown[];
  evidence_refs: unknown[];
  decided_at: string;
  expires_at?: string;
  decision_digest: string;
  [key: string]: unknown;
}

export interface C59Contract {
  contract_name: string;
  contract_version: number;
  exposure_id: string;
  tenant_id: string;
  principal_id: string;
  pc_session_id: string;
  dsh_session_id: string;
  assignment_generation: number;
  turn_id: string;
  authorized_view_id: string;
  context_id: string;
  context_digest: string;
  memory_revision_refs: unknown[];
  authorization_revision: number;
  policy_revision: number;
  exposed_at: string;
  session_memory_state_after_exposure: "EXPOSED";
  [key: string]: unknown;
}

export interface C60Contract {
  contract_name: string;
  contract_version: number;
  invalidation_id: string;
  idempotency_key: string;
  tenant_id: string;
  pc_session_id: string;
  dsh_session_id: string;
  current_assignment_generation: number;
  affected_memory_revision_refs: unknown[];
  trigger_kind: "SUPERSEDED" | "REVOKED" | "EXPIRED" | "SOURCE_ACCESS_LOST" | "SCOPE_CHANGED" | "POLICY_REVOKED" | "POISONING_DETECTED";
  authority_change_event_ids: unknown[];
  target_memory_state: "INVALIDATED";
  fencing_action: "REVOKE_ASSIGNMENT";
  rotation_policy: "FRESH_SESSION_NO_REPLAY";
  invalidation_status: "PENDING" | "FENCED" | "RELEASING" | "ROTATED" | "RECOVERY_REQUIRED";
  issued_at: string;
  deadline: string;
  completed_at?: string;
  recovery_case_id?: string;
  [key: string]: unknown;
}

export interface C61Contract {
  contract_name: string;
  contract_version: number;
  provider_registration_id: string;
  provider_key: string;
  display_name: string;
  provider_kind: "EXTERNAL_BUSINESS" | "LOCAL" | "IDENTITY_ONLY";
  tenant_scope: Record<string, unknown>;
  port_kinds: unknown[];
  action_namespaces: unknown[];
  resource_authorities: unknown[];
  connector_registration_refs: unknown[];
  identity_provider_refs: unknown[];
  registration_revision: number;
  configuration_digest: string;
  registration_state: "ACTIVE" | "DISABLED" | "SUPERSEDED";
  registered_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface C62Contract {
  contract_name: string;
  contract_version: number;
  health_observation_id: string;
  provider_registration_id: string;
  configuration_revision: number;
  provider_state: "UNCONFIGURED" | "STARTING" | "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED";
  compatibility_status: "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN" | "NOT_APPLICABLE";
  port_health: Record<string, unknown>;
  reason_codes: unknown[];
  evidence_refs: unknown[];
  checked_at: string;
  expires_at: string;
  [key: string]: unknown;
}

export interface C63Contract {
  contract_name: string;
  contract_version: number;
  route_id: string;
  route_revision: number;
  action_namespace: string;
  action_pattern: string;
  resource_authority: string;
  resource_scope_pattern: string;
  authorization_mode: "PC_ONLY" | "PC_AND_PROVIDER";
  provider_registration_id?: string;
  capability_provider_required: boolean;
  ambiguity_policy: "DENY";
  route_state: "ACTIVE" | "DISABLED" | "SUPERSEDED";
  route_digest: string;
  effective_from: string;
  effective_to?: string;
  [key: string]: unknown;
}

export interface C64Contract {
  contract_name: string;
  contract_version: number;
  snapshot_id: string;
  provider_registration_id: string;
  tenant_id: string;
  principal_id: string;
  identity_link_ref: string;
  resource_authority: string;
  projects: unknown[];
  source_revision: string;
  source_digest: string;
  evidence_refs: unknown[];
  observed_at: string;
  expires_at: string;
  [key: string]: unknown;
}

export interface C65Contract {
  contract_name: string;
  contract_version: number;
  availability_id: string;
  provider_registration_id: string;
  tenant_id: string;
  principal_id?: string;
  health_observation_id: string;
  catalog_revision: string;
  capabilities: unknown[];
  reason_codes: unknown[];
  evidence_refs: unknown[];
  observed_at: string;
  expires_at: string;
  [key: string]: unknown;
}
