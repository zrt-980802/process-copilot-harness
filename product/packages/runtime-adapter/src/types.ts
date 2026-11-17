export const RUNTIME_COMMAND_TYPES = [
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
] as const;

export type RuntimeCommandType = (typeof RUNTIME_COMMAND_TYPES)[number];

export const P1A_SUPPORTED_COMMANDS = [
  "ASSIGN_SESSION",
  "START_TURN",
  "RESUME_SESSION",
  "TERMINATE_RUNTIME",
  "QUERY_HEALTH",
  "QUERY_CAPABILITIES"
] as const satisfies readonly RuntimeCommandType[];

export const P1B1_SUPPORTED_COMMANDS = [
  ...P1A_SUPPORTED_COMMANDS,
  "CANCEL_TURN",
  "FLUSH_SESSION",
  "CATCH_UP_EVENTS"
] as const satisfies readonly RuntimeCommandType[];

export const P1B2_SUPPORTED_COMMANDS = [
  ...P1B1_SUPPORTED_COMMANDS,
  "REVOKE_SESSION",
  "DRAIN_RUNTIME"
] as const satisfies readonly RuntimeCommandType[];

export interface RuntimeCommand {
  contract_name: "pc.runtime-command/1";
  contract_version: 1;
  command_id: string;
  command_type: RuntimeCommandType;
  deadline: string;
  runtime_id: string;
  runtime_epoch: number;
  pc_session_id?: string;
  assignment_generation?: number;
  fencing_token?: string;
  expected_state_version?: string;
  payload: Record<string, unknown>;
}

export interface AdapterError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface RuntimeCommandResult {
  contract_name: "pc.runtime-command-result/1";
  contract_version: 1;
  command_id: string;
  accepted: boolean;
  committed: boolean;
  outcome_state: "KNOWN_SUCCESS" | "KNOWN_FAILURE" | "NOT_STARTED" | "OUTCOME_UNKNOWN";
  runtime_observation: Record<string, unknown>;
  adapter_error?: AdapterError;
  event_cursor?: string;
  completed_at: string;
}

export type AssignmentStatus =
  | "ASSIGNED"
  | "RUNNING"
  | "IDLE"
  | "NEEDS_RESUME"
  | "REVOKING"
  | "RELEASED"
  | "EXPIRED"
  | "FAILED";

export type FinalizerStatus = "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "SKIPPED";

export interface FinalizerResult {
  name: string;
  scope: string;
  critical: boolean;
  idempotent: boolean;
  status: FinalizerStatus;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  details?: Record<string, unknown>;
  error?: AdapterError;
}

export interface CleanupReport {
  report_id: string;
  runtime_id: string;
  runtime_epoch: number;
  reason: string;
  cleanup_state: "CLEAN" | "PARTIAL_FAILURE";
  resource_leak: boolean;
  final_event_sequence: number;
  session_ids: string[];
  finalizers: FinalizerResult[];
  started_at: string;
  completed_at: string;
}

export interface RuntimeAssignment {
  assignmentId?: string;
  pcSessionId: string;
  dshSessionId: string;
  tenantId?: string;
  userId?: string;
  businessTaskId?: string;
  assignmentGeneration: number;
  fencingToken: string;
  leaseId?: string;
  authorityState?: "PENDING" | "ACTIVE" | "REVOKING" | "RELEASED" | "EXPIRED" | "REJECTED";
  authorityVersion?: number;
  authorizationRevision?: number;
  effectiveProfileSnapshotId?: string;
  workspaceViewSnapshotId?: string;
  workspaceMaterializationId?: string;
  workspaceMountRef?: string;
  workspaceMaterializationExpiresAt?: string;
  status: AssignmentStatus;
  turnCount: number;
  lastDshSequence: number;
  lastRuntimeEventSequence: number;
  assignedAt: string;
  updatedAt: string;
  leaseExpiresAt?: string;
  lastRenewedAt?: string;
  revokedAt?: string;
  releasedAt?: string;
  expiredAt?: string;
  lastFinalResponse?: string;
  cleanupReport?: CleanupReport;
}

export interface PersistedRuntimeState {
  schemaVersion: 1;
  runtimeId: string;
  runtimeEpoch: number;
  runtimeState: "STARTING" | "READY" | "ASSIGNED" | "DRAINING" | "TERMINATED" | "DEGRADED";
  bridgeState: "NOT_STARTED" | "STARTING" | "READY" | "FAILED" | "CLOSED";
  nextRuntimeEventSequence: number;
  assignments: Record<string, RuntimeAssignment>;
  completedCommands: Record<string, RuntimeCommandResult>;
  startedAt: string;
  updatedAt: string;
  lastBridgeSuccessAt?: string;
  lastBridgeError?: AdapterError;
  drainReason?: string;
  terminatedAt?: string;
  cleanupReport?: CleanupReport;
}

export interface RuntimeIdentity {
  runtimeId: string;
  runtimeEpoch: number;
}
