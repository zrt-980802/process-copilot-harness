export type RuntimeRegistryState =
  | "PROVISIONING"
  | "STARTING"
  | "READY"
  | "IDLE"
  | "ACTIVE"
  | "DRAINING"
  | "TERMINATED"
  | "FAILED"
  | "LOST";

export type AssignmentAuthorityState =
  | "PENDING"
  | "ACTIVE"
  | "REVOKING"
  | "RELEASED"
  | "EXPIRED"
  | "REJECTED";

export interface RuntimeRecord {
  contract_name: "pc.runtime-record/1";
  contract_version: 1;
  runtime_id: string;
  runtime_epoch: number;
  tenant_id: string;
  owner_user_id: string;
  worker_pool_id: string;
  state: RuntimeRegistryState;
  profile_bundle_digest: string;
  capability_manifest_digest: string;
  endpoint_url: string;
  capacity: Record<string, unknown>;
  health_summary: Record<string, unknown>;
  created_at: string;
  last_heartbeat_at: string;
  version: number;
  last_report_seq: number;
  current: boolean;
  drain_reason?: string;
  terminated_at?: string;
  cleanup_report?: Record<string, unknown>;
}

export interface RuntimeCapabilityManifest {
  contract_name: "pc.runtime-capability-manifest/1";
  contract_version: 1;
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
}

export interface SessionAssignment {
  contract_name: "pc.session-assignment-snapshot/1";
  contract_version: 1;
  assignment_id: string;
  tenant_id: string;
  user_id: string;
  pc_session_id: string;
  runtime_id: string;
  runtime_epoch: number;
  assignment_generation: number;
  fencing_token: string;
  lease_id: string;
  lease_expires_at: string;
  state: AssignmentAuthorityState;
  effective_profile_snapshot_id: string;
  workspace_view_snapshot_id: string;
  authorization_revision: number;
  version: number;
  current: boolean;
  assigned_at: string;
  accepted_at?: string;
  last_renewed_at?: string;
  revoked_at?: string;
  released_at?: string;
  expired_at?: string;
  rejected_at?: string;
  rejection_code?: string;
}

export interface RuntimeHealthReport {
  contract_name: "pc.runtime-health-report/1";
  contract_version: 1;
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
}

export type GuardKind = "STEP" | "TOOL";

export interface AssignmentGuardInput {
  kind: GuardKind;
  runtime_id: string;
  runtime_epoch: number;
  pc_session_id: string;
  assignment_generation: number;
  fencing_token: string;
  authorization_revision?: number;
  tool_call_id?: string;
}

export interface AssignmentGuardDecision {
  allowed: boolean;
  kind: GuardKind;
  code: string;
  reason: string;
  retryable: boolean;
  runtime_id: string;
  runtime_epoch: number;
  pc_session_id: string;
  assignment_generation: number;
  fencing_token: string;
  evaluated_at: string;
}

export class RuntimeRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RuntimeRegistryError";
  }
}

const ADMITTING_RUNTIME_STATES = new Set<RuntimeRegistryState>([
  "READY",
  "IDLE",
  "ACTIVE"
]);

function denied(
  input: AssignmentGuardInput,
  code: string,
  reason: string,
  retryable = false,
  now = new Date()
): AssignmentGuardDecision {
  return {
    allowed: false,
    kind: input.kind,
    code,
    reason,
    retryable,
    runtime_id: input.runtime_id,
    runtime_epoch: input.runtime_epoch,
    pc_session_id: input.pc_session_id,
    assignment_generation: input.assignment_generation,
    fencing_token: input.fencing_token,
    evaluated_at: now.toISOString()
  };
}

export function evaluateAssignmentGuard(
  runtime: RuntimeRecord | undefined,
  assignment: SessionAssignment | undefined,
  input: AssignmentGuardInput,
  now = new Date()
): AssignmentGuardDecision {
  if (runtime === undefined) {
    return denied(input, "PC_RUNTIME_NOT_FOUND", "Runtime is not registered", false, now);
  }
  if (!runtime.current || runtime.runtime_epoch !== input.runtime_epoch) {
    return denied(
      input,
      "PC_RUNTIME_EPOCH_STALE",
      "Runtime epoch is not the current registered epoch",
      false,
      now
    );
  }
  if (runtime.state === "DRAINING") {
    return denied(input, "PC_RUNTIME_DRAINING", "Runtime is draining", true, now);
  }
  if (!ADMITTING_RUNTIME_STATES.has(runtime.state)) {
    return denied(
      input,
      "PC_RUNTIME_NOT_READY",
      `Runtime is not ready for Session work: ${runtime.state}`,
      true,
      now
    );
  }
  if (assignment === undefined || assignment.pc_session_id !== input.pc_session_id) {
    return denied(
      input,
      "PC_RUNTIME_ASSIGNMENT_NOT_FOUND",
      "Session has no current Assignment",
      false,
      now
    );
  }
  if (!assignment.current || assignment.state !== "ACTIVE") {
    return denied(
      input,
      assignment.state === "EXPIRED"
        ? "PC_RUNTIME_ASSIGNMENT_EXPIRED"
        : "PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE",
      `Assignment is not active: ${assignment.state}`,
      false,
      now
    );
  }
  if (
    assignment.runtime_id !== input.runtime_id
    || assignment.runtime_epoch !== input.runtime_epoch
  ) {
    return denied(
      input,
      "PC_RUNTIME_ASSIGNMENT_MISMATCH",
      "Assignment targets a different Runtime instance",
      false,
      now
    );
  }
  if (assignment.assignment_generation !== input.assignment_generation) {
    return denied(
      input,
      "PC_RUNTIME_ASSIGNMENT_GENERATION_STALE",
      "Assignment generation is stale",
      false,
      now
    );
  }
  if (assignment.fencing_token !== input.fencing_token) {
    return denied(input, "PC_RUNTIME_FENCE_STALE", "Fencing token is stale", false, now);
  }
  if (Date.parse(assignment.lease_expires_at) <= now.getTime()) {
    return denied(input, "PC_RUNTIME_LEASE_EXPIRED", "Assignment Lease has expired", false, now);
  }
  if (
    input.authorization_revision !== undefined
    && input.authorization_revision !== assignment.authorization_revision
  ) {
    return denied(
      input,
      "PC_RUNTIME_AUTHORIZATION_STALE",
      "Authorization revision is stale",
      false,
      now
    );
  }
  if (
    input.kind === "TOOL"
    && (typeof input.tool_call_id !== "string" || input.tool_call_id.trim() === "")
  ) {
    return denied(
      input,
      "PC_RUNTIME_TOOL_CALL_ID_REQUIRED",
      "Tool Guard requires a stable tool_call_id",
      false,
      now
    );
  }
  return {
    allowed: true,
    kind: input.kind,
    code: "PC_RUNTIME_GUARD_ALLOWED",
    reason: "Assignment authority is current",
    retryable: false,
    runtime_id: input.runtime_id,
    runtime_epoch: input.runtime_epoch,
    pc_session_id: input.pc_session_id,
    assignment_generation: input.assignment_generation,
    fencing_token: input.fencing_token,
    evaluated_at: now.toISOString()
  };
}

export function assertGuardAllowed(decision: AssignmentGuardDecision): void {
  if (!decision.allowed) {
    throw new RuntimeRegistryError(
      decision.code,
      decision.reason,
      decision.retryable,
      {
        runtime_id: decision.runtime_id,
        runtime_epoch: decision.runtime_epoch,
        pc_session_id: decision.pc_session_id,
        assignment_generation: decision.assignment_generation,
        guard_kind: decision.kind
      }
    );
  }
}
