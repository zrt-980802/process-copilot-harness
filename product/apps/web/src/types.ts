export type WorkspaceState =
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

export type InputSlot = "PRD" | "ARCHITECTURE" | "COMMUNICATION_MATRIX";

export interface Principal {
  ee_account?: { id: number; username: string; display_name: string };
  principal_id: string;
  tenant_id: string;
  authorization_revision: number;
}

export interface SignInResult {
  access_token: string;
  expires_at: string;
}

export interface Workspace {
  project_code?: string;
  function_code?: string;
  workspace_id: string;
  business_task_id: string;
  tenant_id: string;
  owner_principal_id: string;
  title: string;
  profile_release_id: string;
  profile_release_digest: string;
  state: WorkspaceState;
  current_draft_id?: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ResourceRef {
  resource_id: string;
  resource_version_id: string;
  content_digest: string;
  media_type: string;
  display_name: string;
}

export interface TaskInput {
  input_id: string;
  workspace_id: string;
  slot: InputSlot;
  resource_ref: ResourceRef;
  attached_at: string;
  revision: number;
}

export interface ConversationMessage {
  message_id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  created_at: string;
  sequence: number;
}

export interface Citation {
  citation_id: string;
  slot: InputSlot;
  resource_ref: ResourceRef;
  locator: string;
  evidence_digest: string;
}

export interface ValidationCheck {
  code: string;
  status: "PASS" | "FAIL" | "WARNING";
  message: string;
  evidence_refs: string[];
}

export interface DraftRevision {
  draft_id: string;
  workspace_id: string;
  generation_id: string;
  revision: number;
  profile_release_id: string;
  profile_release_digest: string;
  source_refs: ResourceRef[];
  artifact_ref: ResourceRef;
  citations: Citation[];
  validation: {
    report_id: string;
    status: "PASSED" | "FAILED";
    checks: ValidationCheck[];
    created_at: string;
    report_digest: string;
  };
  content_digest: string;
  media_type: "text/markdown";
  created_at: string;
}

export interface DraftReview {
  review_id: string;
  draft_id: string;
  decision: "ACCEPTED" | "REJECTED";
  comment?: string;
  reviewed_at: string;
}

export interface TaskProjection {
  workspace: Workspace;
  inputs: TaskInput[];
  messages: ConversationMessage[];
  drafts: DraftRevision[];
  reviews: DraftReview[];
}

export interface UploadedResource {
  resource: {
    resource_id: string;
    display_name: string;
  };
  version: {
    resource_version_id: string;
  };
}

export interface CapabilityChain {
  scope: {
    project_code: string;
    project_name: string;
    authorization_revision: number;
    source: string;
  };
  profile?: {
    profile_release_id: string;
    profile_definition_id: string;
    status: string;
    output_kind?: unknown;
    declared_tool_count: number;
    published_at: string;
  };
  effective_snapshot?: {
    effective_profile_snapshot_id: string;
    profile_release_id: string;
    authorization_revision: number;
    tool_release_ids: string[];
    plugin_release_ids: string[];
    runtime_requirements: Record<string, unknown>;
    created_at: string;
  };
  tool_set: Array<{
    tool_release_id: string;
    tool_definition_id: string;
    display_name: string;
    action_class: unknown;
    provider_kind: string;
    status: string;
  }>;
  runtime?: {
    state: string;
    runtime_epoch: number;
    manifest?: {
      dsh_version: string;
      bridge_protocol_versions: unknown[];
      plugin_releases: unknown[];
      agent_presets: unknown[];
      tool_provider_capabilities: unknown[];
      persistence_capabilities: unknown[];
      approval_capabilities: unknown[];
      resource_capabilities: unknown[];
      generated_at: string;
    };
  };
  connector: {
    connector_id: string;
    mcp_server_id: string;
    provider_key: string;
    auth_mode: string;
    state: string;
    capability_digest: string;
  };
  recent_operations: Array<{
    operation_id: string;
    operation_kind: string;
    state: string;
    updated_at: string;
    tool_release_id?: string;
    tool_name?: string;
    outcome_state?: string;
    trace_refs: string[];
  }>;
  workspace?: { workspace_id: string; title: string; updated_at: string };
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}
