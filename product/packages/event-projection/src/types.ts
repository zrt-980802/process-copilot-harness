export type EventDurability =
  | "EPHEMERAL"
  | "OBSERVED"
  | "DURABLE_DSH"
  | "DURABLE_PC";

export type EventStreamKind =
  | "RUNTIME"
  | "SESSION"
  | "TASK"
  | "OPERATION"
  | "APPROVAL"
  | "RECOVERY";

export type InboxStatus =
  | "PENDING"
  | "APPLIED"
  | "STALE"
  | "QUARANTINED";

export type CursorState = "COMPLETE" | "GAP" | "QUARANTINED";

export type BusinessTaskState =
  | "DRAFT"
  | "READY"
  | "RUNNING"
  | "WAITING_USER"
  | "WAITING_APPROVAL"
  | "PAUSED"
  | "RECOVERING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type BusinessOperationState =
  | "PLANNED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "DISPATCHING"
  | "DISPATCHED"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED"
  | "OUTCOME_UNKNOWN"
  | "RECONCILING"
  | "COMPENSATION_REQUIRED";

export type OperationKind =
  | "READ"
  | "WRITE"
  | "DESTRUCTIVE"
  | "EXTERNAL_SIDE_EFFECT";

export type RecoveryClass =
  | "REPLAY_SAFE"
  | "IDEMPOTENT_RETRY"
  | "RECONCILE_BEFORE_RETRY"
  | "NON_RECOVERABLE"
  | "EXTERNAL_DURABLE_JOB";

export type RecoveryTrigger =
  | "RUNTIME_LOST"
  | "ASSIGNMENT_EXPIRED"
  | "EVENT_GAP"
  | "OUTCOME_UNKNOWN"
  | "APPROVAL_WAIT"
  | "MANUAL";

export type RecoveryState =
  | "RECOVERY_PENDING"
  | "RECOVERING"
  | "RECONCILING"
  | "WAITING_APPROVAL"
  | "MANUAL_REQUIRED"
  | "RECOVERED"
  | "RECOVERY_FAILED";

export type ReconciliationAction =
  | "RECORD_SUCCESS"
  | "RECORD_FAILURE"
  | "RETRY_SAME_KEY"
  | "CONTINUE_RECONCILIATION"
  | "REQUIRE_MANUAL"
  | "CREATE_COMPENSATION";

export interface EventEnvelope {
  contract_name: "pc.event-envelope/1";
  contract_version: 1;
  event_id: string;
  event_type: string;
  event_schema_version: 1;
  producer: string;
  producer_version: string;
  tenant_id: string;
  principal_id: string;
  stream_kind: EventStreamKind;
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
  durability: EventDurability;
  occurred_at: string;
  observed_at: string;
  payload: Record<string, unknown>;
  payload_digest: string;
}

export interface EventInboxRecord {
  inbox_id: string;
  envelope: EventEnvelope;
  status: InboxStatus;
  reason_codes: string[];
  received_at: string;
  applied_at?: string;
}

export interface EventCursor {
  contract_name: "pc.event-cursor/1";
  contract_version: 1;
  producer: string;
  stream_kind: EventStreamKind;
  stream_id: string;
  cursor: string;
  last_event_id: string;
  last_sequence: number;
  state: CursorState;
  expected_next_sequence: number;
  gap_detected_at?: string;
  captured_at: string;
}

export interface BusinessTask {
  contract_name: "pc.business-task/1";
  contract_version: 1;
  business_task_id: string;
  tenant_id: string;
  owner_principal_id: string;
  project_id?: string;
  state: BusinessTaskState;
  current_subtask_id?: string;
  profile_release_id: string;
  source_session_ids: string[];
  projection_complete: boolean;
  last_event_id: string;
  state_digest: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface BusinessOperation {
  contract_name: "pc.business-operation/1";
  contract_version: 1;
  operation_id: string;
  business_task_id: string;
  tenant_id: string;
  owner_principal_id: string;
  operation_kind: OperationKind;
  state: BusinessOperationState;
  recovery_class: RecoveryClass;
  approval_id?: string;
  external_operation_record_id?: string;
  input_digest: string;
  result_digest?: string;
  evidence_refs: string[];
  projection_complete: boolean;
  last_event_id: string;
  updated_at: string;
  version: number;
}

export interface ProjectionCheckpoint {
  checkpoint_id: string;
  projector_name: string;
  projector_version: number;
  projection_schema_version: number;
  tenant_id: string;
  business_task_id: string;
  source_event_count: number;
  last_event_id: string;
  aggregate_revision: number;
  state_digest: string;
  created_at: string;
}

export interface RecoveryDecision {
  classification: RecoveryClass;
  action:
    | "REPLAY"
    | "RETRY_SAME_KEY"
    | "RECONCILE"
    | "RESUME_EXTERNAL_JOB"
    | "REQUIRE_MANUAL"
    | "WAIT_FOR_APPROVAL"
    | "MIGRATE_RUNTIME";
  reason_codes: string[];
}

export interface RecoveryCase {
  contract_name: "pc.recovery-case/1";
  contract_version: 1;
  recovery_case_id: string;
  tenant_id: string;
  owner_principal_id: string;
  business_task_id?: string;
  trigger: RecoveryTrigger;
  affected_runtime_id?: string;
  affected_session_id?: string;
  affected_operation_ids: string[];
  current_assignment: Record<string, unknown>;
  persistent_facts: Record<string, unknown>;
  authorization_checkpoint: Record<string, unknown>;
  decision: RecoveryDecision;
  state: RecoveryState;
  manual_action?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ReconciliationResult {
  contract_name: "pc.reconciliation-result/1";
  contract_version: 1;
  operation_id: string;
  provider_facts: Record<string, unknown>;
  resolved_outcome_state:
    | "KNOWN_SUCCESS"
    | "KNOWN_FAILURE"
    | "NOT_STARTED"
    | "OUTCOME_UNKNOWN";
  action: ReconciliationAction;
  compensation_ref?: string;
  evidence_refs: string[];
  reconciled_at: string;
}

export interface EventReceiveResult {
  record: EventInboxRecord;
  duplicate: boolean;
  sequence_conflict: boolean;
}

export interface EventProjectionRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  receiveEvent(
    envelope: EventEnvelope,
    receivedAt: string
  ): Promise<EventReceiveResult>;
  getInboxRecord(
    producer: string,
    eventId: string
  ): Promise<EventInboxRecord | undefined>;
  listStreamEvents(input: {
    producer: string;
    stream_kind: EventStreamKind;
    stream_id: string;
    statuses?: InboxStatus[];
  }): Promise<EventInboxRecord[]>;
  listTaskEvents(
    businessTaskId: string,
    statuses?: InboxStatus[]
  ): Promise<EventInboxRecord[]>;
  getCursor(input: {
    producer: string;
    stream_kind: EventStreamKind;
    stream_id: string;
  }): Promise<EventCursor | undefined>;
  saveCursor(cursor: EventCursor): Promise<void>;
  markEvent(input: {
    producer: string;
    event_id: string;
    expected_status: InboxStatus;
    status: InboxStatus;
    reason_codes: string[];
    applied_at?: string;
  }): Promise<EventInboxRecord>;
  commitAppliedEvent(input: {
    producer: string;
    event_id: string;
    cursor: EventCursor;
    task?: BusinessTask;
    expected_task_version?: number;
    operation?: BusinessOperation;
    expected_operation_version?: number;
    recovery_case?: RecoveryCase;
    applied_at: string;
  }): Promise<void>;
  setTaskProjectionCompleteness(
    task: BusinessTask,
    expectedVersion: number
  ): Promise<void>;
  getTask(businessTaskId: string): Promise<BusinessTask | undefined>;
  listTasks(tenantId: string, ownerPrincipalId: string): Promise<BusinessTask[]>;
  getOperation(operationId: string): Promise<BusinessOperation | undefined>;
  listTaskOperations(businessTaskId: string): Promise<BusinessOperation[]>;
  replaceTaskProjection(input: {
    task: BusinessTask;
    operations: BusinessOperation[];
    checkpoint: ProjectionCheckpoint;
  }): Promise<void>;
  getCheckpoint(
    businessTaskId: string
  ): Promise<ProjectionCheckpoint | undefined>;
  saveRecoveryCase(recoveryCase: RecoveryCase): Promise<void>;
  getRecoveryCase(recoveryCaseId: string): Promise<RecoveryCase | undefined>;
  updateRecoveryCase(
    recoveryCase: RecoveryCase,
    expectedVersion: number
  ): Promise<RecoveryCase>;
  listRecoveryCases(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<RecoveryCase[]>;
  saveReconciliationResult(result: ReconciliationResult): Promise<void>;
  getReconciliationResult(
    operationId: string
  ): Promise<ReconciliationResult | undefined>;
}

export interface EventAuthorityPort {
  evaluate(envelope: EventEnvelope): Promise<{
    allowed: boolean;
    code: string;
    reason: string;
  }>;
}

export interface RecoveryAuthorizationPort {
  evaluate(input: {
    principal_id: string;
    actions: readonly string[];
    resource_scope_refs: readonly string[];
    tool_release_ids: readonly string[];
    policy_model_revision: number;
    profile_release_id?: string;
  }): Promise<{
    decision: "ALLOW" | "DENY";
    authorization_revision: number;
    reason_codes: readonly string[];
  }>;
}

export interface RecoveryGatewayPort {
  getOperation(operationId: string): Promise<
    | {
        operation_id: string;
        outcome_state:
          | "KNOWN_SUCCESS"
          | "KNOWN_FAILURE"
          | "NOT_STARTED"
          | "OUTCOME_UNKNOWN";
        recovery_class: RecoveryClass;
        provider_operation_id?: string;
      }
    | undefined
  >;
  reconcile(operationId: string): Promise<{
    outcome_state:
      | "KNOWN_SUCCESS"
      | "KNOWN_FAILURE"
      | "NOT_STARTED"
      | "OUTCOME_UNKNOWN";
    provider_operation_id?: string;
    external_evidence_refs: string[];
  }>;
}

export interface RecoveryRuntimePort {
  migrate(input: {
    recovery_case_id: string;
    old_runtime_id?: string;
    pc_session_id: string;
    target_runtime_id: string;
    target_runtime_epoch: number;
    tenant_id: string;
    principal_id: string;
    effective_profile_snapshot_id: string;
    workspace_view_snapshot_id: string;
    authorization_revision: number;
    lease_duration_ms: number;
  }): Promise<{
    assignment_id: string;
    runtime_id: string;
    runtime_epoch: number;
    assignment_generation: number;
    fencing_token: string;
  }>;
}

export class EventProjectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "EventProjectionError";
  }
}
