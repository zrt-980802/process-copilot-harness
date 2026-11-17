export type ResourceKind =
  | "UPLOAD"
  | "ATTACHMENT"
  | "WORKSPACE_FILE"
  | "ARTIFACT"
  | "EXTERNAL_REFERENCE"
  | "EVIDENCE_SNAPSHOT"
  | "DERIVED";

export type ResourceClassification =
  | "PUBLIC"
  | "INTERNAL"
  | "CONFIDENTIAL"
  | "RESTRICTED";

export type ResourceLifecycle =
  | "ACTIVE"
  | "ARCHIVED"
  | "DELETION_REQUESTED"
  | "DELETED";

export type ResourceScopeType =
  | "USER_ROOT"
  | "USER_SHARED"
  | "SESSION"
  | "PROJECT"
  | "TASK"
  | "BUSINESS_OBJECT";

export type ResourceAction =
  | "READ"
  | "WRITE"
  | "DERIVE"
  | "UPLOAD"
  | "SHARE"
  | "ARCHIVE"
  | "DELETE";

export interface ResourceScope {
  scope_type: ResourceScopeType;
  scope_id: string;
}

export interface Resource {
  resource_id: string;
  tenant_id: string;
  kind: ResourceKind;
  display_name: string;
  classification: ResourceClassification;
  lifecycle_status: ResourceLifecycle;
  owner_scope: ResourceScope;
  current_version_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ResourceProvenance {
  source_system: string;
  source_resource_id?: string;
  source_version?: string;
  observed_at: string;
  requested_by: string;
  acquisition_operation: string;
  request_id?: string;
  trace_id?: string;
  derived_from?: ResourceVersionRef[];
}

export interface ResourceVersion {
  resource_version_id: string;
  resource_id: string;
  version_seq: number;
  content_digest: string;
  bytes: number;
  media_type: string;
  blob_ref: string;
  provenance: ResourceProvenance;
  created_by: string;
  created_at: string;
}

export interface ResourceVersionRef {
  resource_id: string;
  resource_version_id: string;
}

export interface ResourceRefContract extends ResourceVersionRef {
  contract_name: "pc.resource-ref/1";
  contract_version: 1;
  resource_type: ResourceKind;
  tenant_id: string;
  owner_scope: ResourceScope;
  content_digest: string;
  classification: ResourceClassification;
  provenance_ref: string;
}

export interface ResourceBinding {
  binding_id: string;
  tenant_id: string;
  resource_id: string;
  scope_type: ResourceScopeType;
  scope_id: string;
  allowed_actions: ResourceAction[];
  created_by: string;
  created_at: string;
  revoked_at?: string;
}

export interface WorkspaceViewBinding {
  binding_id: string;
  resource_ref: ResourceVersionRef;
  scope_type: ResourceScopeType;
  scope_id: string;
  allowed_actions: ResourceAction[];
}

export interface WorkspaceViewSnapshot {
  contract_name: "pc.workspace-view-snapshot/1";
  contract_version: 1;
  workspace_view_snapshot_id: string;
  tenant_id: string;
  pc_session_id: string;
  principal_id: string;
  authorization_revision: number;
  bindings: WorkspaceViewBinding[];
  allowed_actions: ResourceAction[];
  created_at: string;
  expires_at?: string;
  snapshot_digest: string;
}

export type MaterializationPurpose =
  | "RUNTIME_INPUT"
  | "TOOL_INPUT"
  | "DERIVATION"
  | "DOWNLOAD"
  | "EVIDENCE";

export interface MaterializedEntry extends ResourceVersionRef {
  relative_path: string;
  content_digest: string;
  bytes: number;
  mode: "READ_ONLY" | "READ_WRITE";
}

export interface MaterializationFailure extends ResourceVersionRef {
  code: string;
}

export type MaterializationState =
  | "READY"
  | "PARTIAL"
  | "FAILED"
  | "EXPIRED"
  | "CLEANED";

export type CleanupState = "PENDING" | "ACTIVE" | "CLEANED" | "FAILED";

export interface MaterializationRecord {
  materialization_id: string;
  tenant_id: string;
  principal_id: string;
  workspace_view_snapshot_id: string;
  pc_session_id: string;
  target_runtime_id: string;
  target_runtime_epoch: number;
  purpose: MaterializationPurpose;
  allowed_actions: ResourceAction[];
  state: MaterializationState;
  mount_ref: string;
  internal_root: string;
  materialized_entries: MaterializedEntry[];
  failed_entries: MaterializationFailure[];
  requested_at: string;
  expires_at: string;
  cleanup_state: CleanupState;
  result_digest: string;
}

export interface MaterializationResultContract {
  contract_name: "pc.materialization-result/1";
  contract_version: 1;
  materialization_id: string;
  state: MaterializationState;
  mount_ref: string;
  materialized_entries: MaterializedEntry[];
  failed_entries: MaterializationFailure[];
  expires_at: string;
  cleanup_state: CleanupState;
  result_digest: string;
}

export interface ResourceAuditEntry {
  contract_name: "pc.audit-entry/1";
  contract_version: 1;
  audit_id: string;
  event_type: string;
  tenant_id: string;
  subject_principal_id?: string;
  actor_principal_id?: string;
  resource_refs: ResourceVersionRef[];
  operation_id?: string;
  authorization_revision?: number;
  decision: {
    outcome: "ALLOW" | "DENY" | "SUCCESS" | "FAILURE";
    reason_codes: string[];
  };
  evidence_refs: string[];
  occurred_at: string;
  previous_hash?: string;
  entry_hash: string;
  retention_class: "SECURITY" | "BUSINESS" | "RESOURCE_LIFECYCLE";
}

export interface ResourceRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createResource(resource: Resource, version: ResourceVersion): Promise<void>;
  getResource(resourceId: string): Promise<Resource | undefined>;
  getVersion(resourceVersionId: string): Promise<ResourceVersion | undefined>;
  listVersions(resourceId: string): Promise<ResourceVersion[]>;
  appendVersion(
    resourceId: string,
    expectedVersionId: string,
    version: ResourceVersion,
    updatedAt: string
  ): Promise<Resource>;
  updateLifecycle(
    resourceId: string,
    expectedLifecycle: ResourceLifecycle,
    lifecycle: ResourceLifecycle,
    updatedAt: string
  ): Promise<Resource>;
  createBinding(binding: ResourceBinding): Promise<void>;
  getBinding(bindingId: string): Promise<ResourceBinding | undefined>;
  listBindings(resourceId: string): Promise<ResourceBinding[]>;
  revokeBinding(bindingId: string, revokedAt: string): Promise<ResourceBinding>;
  saveWorkspaceView(snapshot: WorkspaceViewSnapshot): Promise<void>;
  getWorkspaceView(
    workspaceViewSnapshotId: string
  ): Promise<WorkspaceViewSnapshot | undefined>;
  saveMaterialization(record: MaterializationRecord): Promise<void>;
  getMaterialization(
    materializationId: string
  ): Promise<MaterializationRecord | undefined>;
  findActiveMaterialization(input: {
    workspace_view_snapshot_id: string;
    pc_session_id: string;
    target_runtime_id: string;
    target_runtime_epoch: number;
    now: string;
  }): Promise<MaterializationRecord | undefined>;
  listExpiredMaterializations(now: string): Promise<MaterializationRecord[]>;
  updateMaterialization(record: MaterializationRecord): Promise<void>;
  appendAudit(entry: ResourceAuditEntry): Promise<void>;
  listAudit(resourceId: string): Promise<ResourceAuditEntry[]>;
}

export interface ImmutableBlobStore {
  put(content: Uint8Array, expectedDigest: string): Promise<string>;
  read(blobRef: string): Promise<Uint8Array>;
}

export interface WorkspaceMaterializer {
  materialize(input: {
    tenant_id: string;
    principal_id: string;
    pc_session_id: string;
    target_runtime_id: string;
    target_runtime_epoch: number;
    materialization_id: string;
    entries: Array<{
      version: ResourceVersion;
      display_name: string;
      content: Uint8Array;
      mode: "READ_ONLY" | "READ_WRITE";
    }>;
  }): Promise<{ internal_root: string; entries: MaterializedEntry[] }>;
  cleanup(internalRoot: string): Promise<void>;
}

export interface ResourceScopeAuthorizationPort {
  authorize(input: {
    tenant_id: string;
    principal_id: string;
    action: ResourceAction;
    scope: ResourceScope;
  }): Promise<boolean>;
}

export interface WorkspaceAdmissionInput {
  workspace_view_snapshot_id: string;
  tenant_id: string;
  principal_id: string;
  pc_session_id: string;
  authorization_revision: number;
  runtime_id: string;
  runtime_epoch: number;
}

export interface WorkspaceAdmissionPort {
  assertWorkspaceAdmission(input: WorkspaceAdmissionInput): Promise<{
    materialization_id: string;
    mount_ref: string;
    expires_at: string;
  }>;
}

export class ResourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ResourceError";
  }
}
