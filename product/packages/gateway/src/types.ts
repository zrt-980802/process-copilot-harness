import type {
  AuthorizationSnapshot,
  EffectiveProfileSnapshot,
  PCPrincipal,
  PrincipalEnvelope,
  SessionAssignment,
  ToolRelease
} from "@pc/domain";
import type { WorkspaceViewSnapshot } from "@pc/resource";

export type ConnectorAuthMode =
  | "delegated"
  | "app_only"
  | "per_user_legacy";
export type ConnectorState = "ACTIVE" | "DISABLED";
export type BindingState = "ACTIVE" | "REVOKED";
export type CredentialLeaseState = "ACTIVE" | "REVOKED" | "EXPIRED";
export type McpSessionState =
  | "ACTIVE"
  | "REAUTH_REQUIRED"
  | "CLOSED"
  | "EXPIRED";
export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CONSUMED"
  | "REVOKED"
  | "EXPIRED"
  | "CANCELLED";
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
export type DispatchState =
  | "PENDING"
  | "DISPATCHED"
  | "COMPLETED"
  | "UNKNOWN"
  | "RECONCILING";
export type OperationOutcome =
  | "KNOWN_SUCCESS"
  | "KNOWN_FAILURE"
  | "NOT_STARTED"
  | "OUTCOME_UNKNOWN";

export interface ConnectorRegistration {
  connector_id: string;
  tenant_id: string;
  mcp_server_id: string;
  endpoint_ref: string;
  provider_key: string;
  auth_mode: ConnectorAuthMode;
  audience: string;
  allowed_scopes: string[];
  tool_release_ids: string[];
  state: ConnectorState;
  registration_revision: number;
  capability_digest: string;
  created_at: string;
  updated_at: string;
}

export interface ExternalAccountBinding {
  external_account_binding_id: string;
  tenant_id: string;
  connector_id: string;
  principal_id: string;
  external_account_id: string;
  credential_subject: string;
  secret_ref: string;
  status: BindingState;
  credential_generation: number;
  created_at: string;
  updated_at: string;
  revoked_at?: string;
}

export interface CredentialLeaseRef {
  contract_name: "pc.credential-lease-ref/1";
  contract_version: 1;
  credential_lease_id: string;
  connector_id: string;
  external_account_id: string;
  credential_subject: string;
  audience: string;
  scope_digest: string;
  generation: number;
  expires_at: string;
  binding_mode: "bearer" | "dpop" | "mtls";
}

export interface CredentialLeaseRecord {
  lease: CredentialLeaseRef;
  tenant_id: string;
  principal_id: string;
  pc_session_id: string;
  authorization_revision: number;
  state: CredentialLeaseState;
  issued_at: string;
  revoked_at?: string;
}

export interface McpSessionBinding {
  contract_name: "pc.mcp-session-binding/1";
  contract_version: 1;
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
  state: McpSessionState;
}

export interface BusinessApprovalSnapshot {
  command_context?: { workspace_id: string; call_id: string };
  resource_scope_refs?: string[];
  arguments?: Record<string, unknown>;
  contract_name: "pc.business-approval-snapshot/1";
  contract_version: 1;
  approval_id: string;
  approval_version: number;
  status: ApprovalStatus;
  subject_principal_id: string;
  actor_principal_id: string;
  operation_kind: OperationKind;
  target_digest: string;
  argument_digest: string;
  risk_class: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  authorization_revision: number;
  requested_at: string;
  decided_at?: string;
  expires_at?: string;
  decision: {
    outcome:
      | "PENDING"
      | "APPROVE"
      | "REJECT"
      | "REVOKE"
      | "EXPIRE"
      | "CONSUME";
    decided_by?: string;
    reason_codes: string[];
  };
  decision_evidence_refs: string[];
  snapshot_digest: string;
  tenant_id: string;
  business_task_id?: string;
  operation_id: string;
  tool_release_id: string;
  connector_id: string;
  requested_by: string;
}

export interface ToolExecutionEnvelope {
  contract_name: "pc.tool-execution-envelope/1";
  contract_version: 1;
  operation_id: string;
  idempotency_key: string;
  tool_release_id: string;
  schema_digest: string;
  arguments: Record<string, unknown>;
  argument_digest: string;
  principal_envelope: PrincipalEnvelope;
  assignment_snapshot_ref: string;
  approval_snapshot_ref?: string;
  workspace_view_snapshot_ref?: string;
  deadline: string;
  recovery_class: RecoveryClass;
}

export interface ToolExecutionResult {
  contract_name: "pc.tool-execution-result/1";
  contract_version: 1;
  operation_id: string;
  status:
    | "SUCCEEDED"
    | "FAILED"
    | "OUTCOME_UNKNOWN"
    | "RECONCILIATION_REQUIRED";
  provider_operation_id?: string;
  result: Record<string, unknown>;
  result_digest: string;
  external_evidence_refs: string[];
  retryable: boolean;
  outcome_state: OperationOutcome;
  reconciliation_required: boolean;
  completed_at: string;
}

export interface ExternalOperationRecord {
  arguments?: Record<string, unknown>;
  resource_scope_refs?: string[];
  contract_name: "pc.external-operation-record/1";
  contract_version: 1;
  operation_id: string;
  operation_kind: OperationKind;
  idempotency_key: string;
  fencing_token: string;
  request_digest: string;
  provider_operation_id?: string;
  dispatch_state: DispatchState;
  outcome_state: OperationOutcome;
  recovery_class: RecoveryClass;
  last_reconciled_at?: string;
  evidence_refs: string[];
  version: number;
  tenant_id: string;
  principal_id: string;
  business_task_id?: string;
  pc_session_id: string;
  connector_id: string;
  tool_release_id: string;
  schema_digest: string;
  argument_digest: string;
  assignment_id: string;
  approval_id?: string;
  credential_lease_id?: string;
  mcp_binding_id?: string;
  created_at: string;
  updated_at: string;
  result?: ToolExecutionResult;
}

export interface GatewayAuditEntry {
  audit_id: string;
  event_type: string;
  tenant_id: string;
  principal_id: string;
  operation_id?: string;
  connector_id?: string;
  tool_release_id?: string;
  outcome: "ALLOW" | "DENY" | "SUCCESS" | "FAILURE" | "UNKNOWN";
  reason_codes: string[];
  evidence_refs: string[];
  payload_digest: string;
  occurred_at: string;
}

export interface GatewayRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  putConnector(connector: ConnectorRegistration): Promise<ConnectorRegistration>;
  getConnector(connectorId: string): Promise<ConnectorRegistration | undefined>;
  findConnectorForTool(
    tenantId: string,
    toolReleaseId: string
  ): Promise<ConnectorRegistration | undefined>;
  updateConnectorState(input: {
    connector_id: string;
    tenant_id: string;
    expected_revision: number;
    state: ConnectorState;
    updated_at: string;
  }): Promise<ConnectorRegistration>;
  putExternalAccountBinding(
    binding: ExternalAccountBinding
  ): Promise<ExternalAccountBinding>;
  getExternalAccountBinding(
    bindingId: string
  ): Promise<ExternalAccountBinding | undefined>;
  findExternalAccountBinding(
    tenantId: string,
    connectorId: string,
    principalId: string,
    includeInactive?: boolean
  ): Promise<ExternalAccountBinding | undefined>;
  rotateExternalAccountBinding(input: {
    binding_id: string;
    tenant_id: string;
    principal_id: string;
    expected_generation: number;
    secret_ref: string;
    updated_at: string;
  }): Promise<ExternalAccountBinding>;
  revokeExternalAccountBinding(input: {
    binding_id: string;
    tenant_id: string;
    principal_id: string;
    expected_generation: number;
    revoked_at: string;
  }): Promise<ExternalAccountBinding>;
  saveCredentialLease(record: CredentialLeaseRecord): Promise<void>;
  getCredentialLease(
    leaseId: string
  ): Promise<CredentialLeaseRecord | undefined>;
  revokeStaleSecurityState(input: {
    connector_id: string;
    principal_id: string;
    minimum_generation: number;
    revoked_at: string;
  }): Promise<void>;
  findMcpSessionBinding(input: {
    tenant_id: string;
    principal_id: string;
    pc_session_id: string;
    connector_id: string;
    authorization_revision: number;
    credential_generation: number;
    tool_catalog_digest: string;
    now: string;
  }): Promise<McpSessionBinding | undefined>;
  saveMcpSessionBinding(binding: McpSessionBinding): Promise<void>;
  getMcpSessionBinding(
    bindingId: string
  ): Promise<McpSessionBinding | undefined>;
  saveApproval(approval: BusinessApprovalSnapshot): Promise<void>;
  getApproval(approvalId: string): Promise<BusinessApprovalSnapshot | undefined>;
  listApprovals(tenantId: string): Promise<BusinessApprovalSnapshot[]>;
  decideApproval(input: {
    approval_id: string;
    expected_version: number;
    expected_status: ApprovalStatus;
    status: ApprovalStatus;
    decision: BusinessApprovalSnapshot["decision"];
    decision_evidence_refs: string[];
    decided_at: string;
  }): Promise<BusinessApprovalSnapshot>;
  findOperationByIdempotency(
    tenantId: string,
    connectorId: string,
    idempotencyKey: string
  ): Promise<ExternalOperationRecord | undefined>;
  beginOperation(input: {
    operation: ExternalOperationRecord;
    approval_id?: string;
    approval_version?: number;
    now: string;
  }): Promise<{ operation: ExternalOperationRecord; created: boolean }>;
  getOperation(operationId: string): Promise<ExternalOperationRecord | undefined>;
  updateOperation(
    operation: ExternalOperationRecord,
    expectedVersion: number
  ): Promise<ExternalOperationRecord>;
  appendAudit(entry: GatewayAuditEntry): Promise<void>;
  listAudit(operationId: string): Promise<GatewayAuditEntry[]>;
}

export interface GatewayIdentityPort {
  resolveExternalSubject?(principalId: string, provider: string): Promise<string | undefined>;
  verifyPrincipalEnvelope(
    envelope: PrincipalEnvelope,
    expectedAudience?: string
  ): Promise<PCPrincipal>;
  evaluatePrincipalAuthorization(input: {
    principal_id: string;
    actions: readonly string[];
    resource_scope_refs: readonly string[];
    tool_release_ids: readonly string[];
    policy_model_revision: number;
    profile_release_id?: string;
  }): Promise<AuthorizationSnapshot>;
}

export interface GatewayProfilePort {
  getToolRelease(toolReleaseId: string): Promise<ToolRelease | undefined>;
  getEffectiveProfileSnapshot(
    snapshotId: string
  ): Promise<EffectiveProfileSnapshot | undefined>;
}

export interface GatewayRuntimeProjection {
  assignment: SessionAssignment;
  guard: {
    allowed: boolean;
    code: string;
    reason: string;
    retryable: boolean;
  };
}

export interface GatewayRuntimePort {
  getSessionProjection(pcSessionId: string): Promise<GatewayRuntimeProjection>;
  evaluateToolGuard(input: {
    runtime_id: string;
    runtime_epoch: number;
    pc_session_id: string;
    assignment_generation: number;
    fencing_token: string;
    authorization_revision: number;
    tool_call_id: string;
  }): Promise<GatewayRuntimeProjection["guard"]>;
}

export interface GatewayWorkspacePort {
  getWorkspaceView(
    snapshotId: string
  ): Promise<WorkspaceViewSnapshot | undefined>;
}

export interface CredentialIssuerPort {
  issue(input: {
    connector: ConnectorRegistration;
    account: ExternalAccountBinding;
    scopes: string[];
    expires_at: string;
  }): Promise<{
    access_token: string;
    credential_subject: string;
    binding_mode: "bearer" | "dpop" | "mtls";
  }>;
}

export interface GatewayProviderPort {
  dispatch(input: {
    approval_id?: string;
    connector: ConnectorRegistration;
    tool: ToolRelease;
    operation_id: string;
    idempotency_key: string;
    arguments: Record<string, unknown>;
    access_token: string;
    deadline: string;
    mcp_binding: McpSessionBinding;
    external_account_id: string;
    principal_id: string;
    pc_session_id: string;
    resource_scope_refs: readonly string[];
    authorization_revision: number;
    signal?: AbortSignal;
  }): Promise<{
    provider_operation_id: string;
    result: Record<string, unknown>;
    external_evidence_refs: string[];
  }>;
  reconcile(input: {
    connector: ConnectorRegistration;
    operation: ExternalOperationRecord;
    access_token?: string;
    external_account_id?: string;
  }): Promise<
    | {
        outcome: "KNOWN_SUCCESS";
        provider_operation_id: string;
        result: Record<string, unknown>;
        evidence_refs: string[];
      }
    | {
        outcome: "KNOWN_FAILURE";
        provider_operation_id?: string;
        result: Record<string, unknown>;
        evidence_refs: string[];
      }
    | {
        outcome: "OUTCOME_UNKNOWN";
        provider_operation_id?: string;
        evidence_refs: string[];
      }
  >;
}

export interface GatewayEventPublisherPort {
  approvalState(input: {
    tenant_id: string;
    principal_id: string;
    business_task_id: string;
    operation_id: string;
    approval_id: string;
    state: "AWAITING_APPROVAL" | "APPROVED" | "FAILED";
    evidence_refs: string[];
  }): Promise<void>;
  operationState(input: {
    tenant_id: string;
    principal_id: string;
    business_task_id: string;
    operation_id: string;
    state:
      | "DISPATCHING"
      | "DISPATCHED"
      | "VERIFYING"
      | "FAILED"
      | "OUTCOME_UNKNOWN"
      | "RECONCILING"
      | "SUCCEEDED";
    external_operation_record_id: string;
    result_digest?: string;
    evidence_refs: string[];
  }): Promise<void>;
}

export class GatewayProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome_unknown: boolean,
    readonly retryable = false,
    readonly provider_operation_id?: string
  ) {
    super(message);
    this.name = "GatewayProviderError";
  }
}

export class ControlledGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ControlledGatewayError";
  }
}
