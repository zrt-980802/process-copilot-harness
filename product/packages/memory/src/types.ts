export type MemoryScopeType = "PERSONAL" | "PROJECT" | "SYSTEM";
export type MemoryKind =
  | "EXPLICIT_PREFERENCE"
  | "CONFIRMED_FACT"
  | "ONGOING_GOAL"
  | "DECISION_HISTORY"
  | "PROJECT_FACT"
  | "RUNBOOK"
  | "FAILURE_GOTCHA";
export type MemorySensitivity = "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
export type MemoryObjectState =
  | "CANDIDATE"
  | "CONFIRMED"
  | "PUBLISHED"
  | "REVOKED"
  | "EXPIRED"
  | "REJECTED";
export type MemoryRevisionState = "CURRENT" | "SUPERSEDED" | "WITHDRAWN";
export type MemoryCaptureMode =
  | "EXPLICIT_USER_SAVE"
  | "AUTOMATIC_CANDIDATE"
  | "PROJECT_CANDIDATE"
  | "SYSTEM_CANDIDATE";
export type MemoryPurpose =
  | "PERSONALIZATION"
  | "TASK_CONTINUITY"
  | "DECISION_RECALL"
  | "PROJECT_ASSISTANCE"
  | "RUNBOOK_ASSISTANCE"
  | "EMPLOYEE_REVIEW"
  | "DELEGATE_RESPONSE";

export interface MemoryRequestContext {
  tenant_id: string;
  principal_id: string;
  actor_principal_id: string;
  authorization_revision: number;
  policy_revision: number;
  request_context_ref: string;
}

export type MemoryAuthorityAction =
  | "memory.capture"
  | "memory.read-own"
  | "memory.revise"
  | "memory.revoke";

export interface MemoryAuthorizationPort {
  authorize(input: {
    context: MemoryRequestContext;
    action: MemoryAuthorityAction;
    scope_type: "PERSONAL";
    scope_id: string;
  }): Promise<{
    decision: "ALLOW" | "DENY";
    authorization_revision: number;
    reason_codes: readonly string[];
    evidence_refs: readonly string[];
  }>;
}

export interface MemoryObject {
  memory_id: string;
  tenant_id: string;
  owner_principal_id: string;
  subject_principal_id?: string;
  scope_type: MemoryScopeType;
  scope_id: string;
  memory_kind: MemoryKind;
  sensitivity: MemorySensitivity;
  object_state: MemoryObjectState;
  current_revision_id?: string;
  policy_revision: number;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface MemoryRevision {
  revision_id: string;
  memory_id: string;
  revision_no: number;
  revision_state: MemoryRevisionState;
  structured_content: Readonly<Record<string, unknown>>;
  retrieval_summary: string;
  source_evidence_ids: readonly string[];
  confidence: number;
  valid_from: string;
  valid_to?: string;
  recorded_at: string;
  created_by_principal_id: string;
  creation_reason: string;
  supersedes_revision_id?: string;
  content_digest: string;
  schema_revision: number;
}

export type MemorySourceKind =
  | "CONVERSATION_MESSAGE"
  | "RESOURCE_VERSION"
  | "BUSINESS_EVENT"
  | "TOOL_RESULT";

export interface MemorySourceEvidenceInput {
  source_kind: MemorySourceKind;
  source_authority: string;
  source_object_id: string;
  source_version_id?: string;
  source_fragment_ref?: string;
  source_subject_principal_id?: string;
  sensitivity: MemorySensitivity;
  displayability: "DISPLAYABLE" | "SUMMARY_ONLY" | "HIDDEN";
  evidence_digest: string;
  access_revalidation_policy:
    | "OWNER_ONLY"
    | "CURRENT_SOURCE_ACCESS"
    | "CURRENT_PROJECT_MEMBERSHIP";
  observed_at: string;
}

export interface MemorySourceEvidence extends MemorySourceEvidenceInput {
  source_evidence_id: string;
  tenant_id: string;
  captured_by_principal_id: string;
  captured_at: string;
}

export interface MemoryPolicyDecision {
  decision_id: string;
  decision_kind: "CAPTURE" | "QUERY" | "REVISE" | "REVOKE" | "CONTEXT_ASSEMBLY";
  tenant_id: string;
  principal_id: string;
  memory_id?: string;
  revision_id?: string;
  purpose?: MemoryPurpose;
  authorization_revision: number;
  policy_revision: number;
  decision: "ALLOW" | "DENY" | "REQUIRE_CONFIRMATION" | "REQUIRE_REDACTION" | "REQUIRE_ESCALATION";
  reason_codes: readonly string[];
  evidence_refs: readonly string[];
  decided_at: string;
  expires_at?: string;
  decision_digest: string;
}

export interface MemoryAuthorityEvent {
  event_id: string;
  tenant_id: string;
  memory_id: string;
  revision_id?: string;
  object_version: number;
  change_kind: "CREATED" | "CONFIRMED" | "PUBLISHED" | "REVISED" | "SUPERSEDED" | "REVOKED" | "EXPIRED";
  object_state: MemoryObjectState;
  revision_state?: MemoryRevisionState;
  scope_digest: string;
  sensitivity: MemorySensitivity;
  policy_revision: number;
  occurred_at: string;
  producer_sequence: number;
  causation_command_id: string;
}

export interface MemoryAggregate {
  object: MemoryObject;
  current_revision: MemoryRevision;
  source_evidence: readonly MemorySourceEvidence[];
}

export interface MemoryCommandRecord {
  command_id: string;
  tenant_id: string;
  principal_id: string;
  idempotency_key: string;
  command_kind: "CAPTURE" | "REVISE" | "REVOKE";
  payload_digest: string;
  result: Readonly<Record<string, unknown>>;
  created_at: string;
  completed_at: string;
}

export type MemoryCommandReplayLookup = Pick<
  MemoryCommandRecord,
  | "tenant_id"
  | "principal_id"
  | "idempotency_key"
  | "command_kind"
  | "payload_digest"
>;

export interface MemoryMutationResult {
  aggregate: MemoryAggregate;
  replayed: boolean;
}

export interface RevokeMemoryResult {
  object: MemoryObject;
  revoked_revision_id: string;
  replayed: boolean;
}

export interface CaptureMutation {
  command: MemoryCommandRecord;
  object: MemoryObject;
  revision: MemoryRevision;
  source_evidence: readonly MemorySourceEvidence[];
  policy_decision: MemoryPolicyDecision;
  authority_event: MemoryAuthorityEvent;
}

export interface ReviseMutation {
  command: MemoryCommandRecord;
  expected_object_version: number;
  expected_current_revision_id: string;
  object: MemoryObject;
  previous_revision: MemoryRevision;
  revision: MemoryRevision;
  source_evidence: readonly MemorySourceEvidence[];
  policy_decision: MemoryPolicyDecision;
  authority_event: MemoryAuthorityEvent;
}

export interface RevokeMutation {
  command: MemoryCommandRecord;
  expected_object_version: number;
  expected_current_revision_id: string;
  object: MemoryObject;
  withdrawn_revision: MemoryRevision;
  policy_decision: MemoryPolicyDecision;
  authority_event: MemoryAuthorityEvent;
}

export interface MemoryAuthorityRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  replayCommand(
    input: MemoryCommandReplayLookup
  ): Promise<MemoryMutationResult | undefined>;
  capture(input: CaptureMutation): Promise<MemoryMutationResult>;
  revise(input: ReviseMutation): Promise<MemoryMutationResult>;
  revoke(input: RevokeMutation): Promise<MemoryMutationResult>;
  getOwnedAggregate(input: {
    memory_id: string;
    tenant_id: string;
    owner_principal_id: string;
  }): Promise<MemoryAggregate | undefined>;
  listAuthorityEvents(input: {
    tenant_id: string;
    memory_id?: string;
    after_sequence?: number;
  }): Promise<MemoryAuthorityEvent[]>;
}

export interface CaptureMemoryInput {
  context: MemoryRequestContext;
  command_id: string;
  idempotency_key: string;
  capture_mode: MemoryCaptureMode;
  owner_principal_id: string;
  scope_request: { scope_type: MemoryScopeType; scope_id?: string };
  memory_kind: MemoryKind;
  content: Readonly<Record<string, unknown>>;
  retrieval_summary: string;
  source_evidence_inputs: readonly MemorySourceEvidenceInput[];
  valid_from: string;
  valid_to?: string;
  sensitivity: MemorySensitivity;
  expected_result_state: "CANDIDATE" | "CONFIRMED";
  issued_at: string;
  deadline: string;
}

export interface ReviseMemoryInput {
  context: MemoryRequestContext;
  command_id: string;
  idempotency_key: string;
  memory_id: string;
  expected_object_version: number;
  expected_current_revision_id: string;
  revision_reason: "CORRECTION" | "TEMPORAL_CHANGE" | "CONTENT_UPDATE" | "SCOPE_CHANGE" | "SENSITIVITY_CHANGE";
  new_content: Readonly<Record<string, unknown>>;
  retrieval_summary: string;
  new_source_evidence_inputs: readonly MemorySourceEvidenceInput[];
  valid_from: string;
  valid_to?: string;
  sensitivity?: MemorySensitivity;
  issued_at: string;
  deadline: string;
}

export interface RevokeMemoryInput {
  context: MemoryRequestContext;
  command_id: string;
  idempotency_key: string;
  memory_id: string;
  expected_object_version: number;
  expected_current_revision_id: string;
  revoke_reason: string;
  issued_at: string;
  deadline: string;
}

export class MemoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "MemoryError";
  }
}
