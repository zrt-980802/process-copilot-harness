export interface DshSessionEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
  ignorable?: boolean;
}

export interface DshRunResult {
  sessionId: string;
  finalResponse: string;
  events: DshSessionEvent[];
  notificationCount: number;
  finishReason?: string;
  turnError?: {
    code: string;
    message: string;
  };
}

export interface DshBridgeHandshake {
  protocolVersion: "1.0";
  bridgeBuild: string;
  runtimeId: string;
  runtimeEpoch: number;
  dshVersion: string;
  profileId: string;
  profileDigest: string;
  processId: number;
  capabilities: {
    sessionFlush: boolean;
    sessionCancel: boolean;
    sessionEvents: boolean;
    sessionRelease: boolean;
    stepGuard: boolean;
    toolGuard: boolean;
  };
}

export interface DshFlushResult {
  durable: boolean;
  throughSequence: number;
}

export interface DshCancelResult {
  requested: boolean;
  wasRunning: boolean;
}

export interface DshEventsResult {
  events: DshSessionEvent[];
  throughSequence: number;
  hasMore: boolean;
}

export interface DshReleaseResult {
  released: boolean;
  durable: boolean;
}

export interface DshAssignmentGuardSnapshot {
  pcSessionId: string;
  dshSessionId: string;
  runtimeId: string;
  runtimeEpoch: number;
  assignmentGeneration: number;
  fencingToken: string;
  leaseExpiresAt: string;
  state: "PENDING" | "ACTIVE" | "REVOKING" | "RELEASED" | "EXPIRED" | "REJECTED";
  authorizationRevision: number;
  authorityVersion: number;
}

export interface DshGuardDecision {
  allowed: boolean;
  code: string;
  reason: string;
  state: string;
  leaseExpiresAt: string;
  authorityVersion: number;
}

export interface DshBridgeControlHealth {
  state: "DISABLED" | "STARTING" | "READY" | "FAILED" | "CLOSED";
  protocolVersion?: string;
  bridgeBuild?: string;
  lastSuccessAt?: string;
  lastError?: string;
}

export interface DshRuntimeHealth {
  state: "NOT_STARTED" | "STARTING" | "READY" | "FAILED" | "CLOSED";
  profile: string;
  version: string;
  lastSuccessAt?: string;
  lastError?: string;
  controlBridge: DshBridgeControlHealth;
}

export interface DshRuntimePort {
  start(): Promise<void>;
  configureTools?(sessionId: string, context: Record<string, unknown>): Promise<void>;
  run(sessionId: string, prompt: string): Promise<DshRunResult>;
  resume(sessionId: string): Promise<void>;
  flush(sessionId: string): Promise<DshFlushResult>;
  cancel(sessionId: string): Promise<DshCancelResult>;
  events(sessionId: string, afterSequence: number, limit: number): Promise<DshEventsResult>;
  release(sessionId: string): Promise<DshReleaseResult>;
  recycle?(): Promise<void>;
  upsertAssignmentGuard(snapshot: DshAssignmentGuardSnapshot): Promise<void>;
  assignmentGuard(
    sessionId: string,
    kind: "step" | "tool"
  ): Promise<DshGuardDecision>;
  close(): Promise<void>;
  health(): DshRuntimeHealth;
}

export interface DshRuntimeOptions {
  profile: string;
  dshHome: string;
  workspace: string;
  provider: string;
  model: string;
  profilePatch?: string;
  dshBin?: string;
  environment?: NodeJS.ProcessEnv;
  initializeTimeoutMs?: number;
  requestTimeoutMs?: number;
  bridgeCommand?: string;
  bridgeArgs?: string[];
  bridgeScript?: string;
  runtimeId?: string;
  runtimeEpoch?: number;
  controlDirectory?: string;
  requireControlBridge?: boolean;
  profileDigest?: string;
}

export type PcEventDurability = "EPHEMERAL" | "OBSERVED" | "DURABLE_DSH" | "DURABLE_PC";

export interface EventNormalizationContext {
  runtimeId: string;
  runtimeEpoch: number;
  pcSessionId: string;
  dshSessionId: string;
  tenantId?: string;
  principalId?: string;
  businessTaskId?: string;
  operationId?: string;
  assignmentGeneration: number;
  fencingToken: string;
  runtimeEventSequence: number;
  durability?: PcEventDurability;
}

export interface PcEventEnvelope {
  contract_name: "pc.event-envelope/1";
  contract_version: 1;
  event_id: string;
  event_type: string;
  event_schema_version: 1;
  producer: "pc-runtime-bridge";
  producer_version: string;
  tenant_id: string;
  principal_id: string;
  stream_kind: "SESSION";
  stream_id: string;
  stream_sequence: number;
  business_task_id?: string;
  operation_id?: string;
  runtime_id: string;
  runtime_epoch: number;
  pc_session_id: string;
  dsh_session_id: string;
  dsh_session_seq: number;
  runtime_event_seq: number;
  assignment_generation: number;
  fencing_token: string;
  durability: PcEventDurability;
  occurred_at: string;
  observed_at: string;
  payload: Record<string, unknown>;
  payload_digest: string;
}
