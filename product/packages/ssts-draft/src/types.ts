export type SstsWorkspaceState =
  | "CREATED"
  | "INPUT_INCOMPLETE"
  | "READY"
  | "CONVERSING"
  | "GENERATING"
  | "HUMAN_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "GENERATION_FAILED"
  | "ARCHIVED";

export type SstsInputSlot =
  | "PRD"
  | "ARCHITECTURE"
  | "COMMUNICATION_MATRIX";

export interface SstsResourceVersionRef {
  resource_id: string;
  resource_version_id: string;
  content_digest: string;
  media_type: string;
  display_name: string;
}

export interface SstsTaskWorkspace {
  workspace_id: string;
  business_task_id: string;
  tenant_id: string;
  owner_principal_id: string;
  title: string;
  profile_release_id: string;
  profile_release_digest: string;
  project_code?: string;
  function_code?: string;
  state: SstsWorkspaceState;
  current_draft_id?: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface SstsTaskInput {
  input_id: string;
  workspace_id: string;
  slot: SstsInputSlot;
  resource_ref: SstsResourceVersionRef;
  attached_by: string;
  attached_at: string;
  revision: number;
}

export interface SstsConversationMessage {
  message_id: string;
  workspace_id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  created_by: string;
  created_at: string;
  sequence: number;
}

export type SstsGenerationState = "IN_PROGRESS" | "SUCCEEDED" | "FAILED";

export interface SstsDraftGeneration {
  generation_id: string;
  workspace_id: string;
  business_operation_id: string;
  idempotency_key: string;
  input_digest: string;
  state: SstsGenerationState;
  draft_id?: string;
  failure_code?: string;
  created_at: string;
  updated_at: string;
}

export interface SstsCitation {
  citation_id: string;
  slot: SstsInputSlot;
  resource_ref: SstsResourceVersionRef;
  locator: string;
  evidence_digest: string;
}

export interface SstsValidationCheck {
  code: string;
  status: "PASS" | "FAIL" | "WARNING";
  message: string;
  evidence_refs: string[];
}

export interface SstsValidationReport {
  report_id: string;
  status: "PASSED" | "FAILED";
  checks: SstsValidationCheck[];
  created_at: string;
  report_digest: string;
}

export interface SstsDraftRevision {
  draft_id: string;
  workspace_id: string;
  generation_id: string;
  revision: number;
  profile_release_id: string;
  profile_release_digest: string;
  source_refs: SstsResourceVersionRef[];
  artifact_ref: SstsResourceVersionRef;
  citations: SstsCitation[];
  validation: SstsValidationReport;
  content_digest: string;
  media_type: "text/markdown";
  created_by: string;
  created_at: string;
}

export interface SstsDraftReview {
  review_id: string;
  workspace_id: string;
  draft_id: string;
  decision: "ACCEPTED" | "REJECTED";
  comment?: string;
  reviewed_by: string;
  reviewed_at: string;
}

export interface SstsDraftAuditEntry {
  audit_id: string;
  workspace_id: string;
  tenant_id: string;
  actor_principal_id: string;
  event_type: string;
  resource_refs: Array<{
    resource_id: string;
    resource_version_id: string;
  }>;
  evidence_refs: string[];
  occurred_at: string;
  entry_digest: string;
}

export interface SstsDraftRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createWorkspace(workspace: SstsTaskWorkspace): Promise<void>;
  getWorkspace(workspaceId: string): Promise<SstsTaskWorkspace | undefined>;
  listWorkspaces(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<SstsTaskWorkspace[]>;
  updateWorkspace(
    workspace: SstsTaskWorkspace,
    expectedVersion: number
  ): Promise<SstsTaskWorkspace>;
  putInput(input: SstsTaskInput): Promise<SstsTaskInput>;
  listInputs(workspaceId: string): Promise<SstsTaskInput[]>;
  appendMessage(message: SstsConversationMessage): Promise<void>;
  listMessages(workspaceId: string): Promise<SstsConversationMessage[]>;
  createGeneration(generation: SstsDraftGeneration): Promise<void>;
  listInProgressGenerations(): Promise<SstsDraftGeneration[]>;
  updateGeneration(
    generation: SstsDraftGeneration,
    expectedState: SstsGenerationState
  ): Promise<void>;
  findGeneration(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<SstsDraftGeneration | undefined>;
  saveDraft(draft: SstsDraftRevision): Promise<void>;
  getDraft(draftId: string): Promise<SstsDraftRevision | undefined>;
  listDrafts(workspaceId: string): Promise<SstsDraftRevision[]>;
  saveReview(review: SstsDraftReview): Promise<void>;
  getReview(draftId: string): Promise<SstsDraftReview | undefined>;
  appendAudit(entry: SstsDraftAuditEntry): Promise<void>;
  listAudit(workspaceId: string): Promise<SstsDraftAuditEntry[]>;
}

export interface SstsProfileRelease {
  profile_release_id: string;
  status: "PUBLISHED" | "REVOKED" | "SUPERSEDED";
  release_digest: string;
  output_contract: Readonly<Record<string, unknown>>;
}

export interface SstsProfilePort {
  getProfileRelease(
    profileReleaseId: string
  ): Promise<SstsProfileRelease | undefined>;
}

export interface SstsResourcePort {
  readResourceVersion(input: {
    tenant_id: string;
    principal_id: string;
    resource_id: string;
    resource_version_id: string;
  }): Promise<{
    resource_ref: SstsResourceVersionRef;
    content: Uint8Array;
  }>;
  createArtifactResource(input: {
    tenant_id: string;
    principal_id: string;
    display_name: string;
    classification: "INTERNAL" | "CONFIDENTIAL";
    media_type: "text/markdown";
    content: Uint8Array;
    derived_from: Array<{
      resource_id: string;
      resource_version_id: string;
    }>;
    acquisition_operation: string;
    request_id: string;
  }): Promise<{ resource_ref: SstsResourceVersionRef }>;
}

export interface SstsBusinessTask {
  business_task_id: string;
  tenant_id: string;
  owner_principal_id: string;
  state:
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
}

export interface SstsBusinessOperation {
  operation_id: string;
  state:
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
}

export interface SstsBusinessStatePort {
  createTask(input: {
    tenant_id: string;
    owner_principal_id: string;
    profile_release_id: string;
    source_session_ids?: string[];
  }): Promise<SstsBusinessTask>;
  getTask(businessTaskId: string): Promise<SstsBusinessTask | undefined>;
  transitionTask(input: {
    business_task_id: string;
    tenant_id: string;
    principal_id: string;
    state: Exclude<SstsBusinessTask["state"], "DRAFT">;
    reason_codes?: string[];
  }): Promise<SstsBusinessTask>;
  planOperation(input: {
    operation_id: string;
    business_task_id: string;
    tenant_id: string;
    principal_id: string;
    operation_kind: "READ";
    recovery_class: "REPLAY_SAFE";
    input_digest: string;
    evidence_refs: string[];
  }): Promise<SstsBusinessOperation>;
  transitionOperation(input: {
    operation_id: string;
    tenant_id: string;
    principal_id: string;
    state: Exclude<SstsBusinessOperation["state"], "PLANNED">;
    result_digest?: string;
    evidence_refs?: string[];
  }): Promise<SstsBusinessOperation>;
}

export interface SstsDraftEngineInput {
  workspace: SstsTaskWorkspace;
  profile: SstsProfileRelease;
  inputs: Array<{
    slot: SstsInputSlot;
    resource_ref: SstsResourceVersionRef;
    content: string;
  }>;
  messages: SstsConversationMessage[];
}

export interface SstsDraftEngineOutput {
  content: string;
  evidence_refs?: SstsResourceVersionRef[];
  citations: Array<Omit<SstsCitation, "citation_id">>;
}

export interface SstsDraftEnginePort {
  generate(input: SstsDraftEngineInput, context?: SstsExecutionContext): Promise<SstsDraftEngineOutput>;
}

export interface SstsExecutionContext {
  access_token: string;
  signal?: AbortSignal;
}

export class SstsDraftError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SstsDraftError";
  }
}
