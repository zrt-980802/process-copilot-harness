import { createHash, randomUUID } from "node:crypto";
import type {
  BusinessOperation,
  BusinessOperationState,
  BusinessTask,
  BusinessTaskState,
  EventAuthorityPort,
  EventCursor,
  EventEnvelope,
  EventInboxRecord,
  EventProjectionRepository,
  EventStreamKind,
  OperationKind,
  ProjectionCheckpoint,
  ReconciliationResult,
  RecoveryAuthorizationPort,
  RecoveryCase,
  RecoveryClass,
  RecoveryGatewayPort,
  RecoveryRuntimePort,
  RecoveryTrigger
} from "./types.js";
import { EventProjectionError } from "./types.js";

const PROJECTOR_NAME = "pc-business-state";
const PROJECTOR_VERSION = 1;
const PROJECTION_SCHEMA_VERSION = 1;

const TASK_TRANSITIONS: Record<BusinessTaskState, BusinessTaskState[]> = {
  DRAFT: ["READY", "CANCELLED"],
  READY: ["RUNNING", "PAUSED", "CANCELLED"],
  RUNNING: [
    "WAITING_USER",
    "WAITING_APPROVAL",
    "PAUSED",
    "RECOVERING",
    "COMPLETED",
    "FAILED",
    "CANCELLED"
  ],
  WAITING_USER: ["RUNNING", "PAUSED", "RECOVERING", "CANCELLED"],
  WAITING_APPROVAL: ["RUNNING", "PAUSED", "RECOVERING", "CANCELLED"],
  PAUSED: ["RUNNING", "RECOVERING", "CANCELLED"],
  RECOVERING: ["RUNNING", "WAITING_APPROVAL", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["RECOVERING"],
  CANCELLED: []
};

const OPERATION_TRANSITIONS: Record<
  BusinessOperationState,
  BusinessOperationState[]
> = {
  PLANNED: ["AWAITING_APPROVAL", "APPROVED", "DISPATCHING", "FAILED"],
  AWAITING_APPROVAL: ["APPROVED", "FAILED"],
  APPROVED: ["DISPATCHING", "FAILED"],
  DISPATCHING: ["DISPATCHED", "FAILED", "OUTCOME_UNKNOWN"],
  DISPATCHED: ["VERIFYING", "FAILED", "OUTCOME_UNKNOWN"],
  VERIFYING: ["SUCCEEDED", "FAILED", "OUTCOME_UNKNOWN"],
  SUCCEEDED: ["COMPENSATION_REQUIRED"],
  FAILED: [],
  OUTCOME_UNKNOWN: ["RECONCILING", "COMPENSATION_REQUIRED"],
  RECONCILING: [
    "SUCCEEDED",
    "FAILED",
    "OUTCOME_UNKNOWN",
    "COMPENSATION_REQUIRED"
  ],
  COMPENSATION_REQUIRED: []
};

const TASK_EVENT_STATES: Record<string, BusinessTaskState> = {
  "pc.task.ready": "READY",
  "pc.task.started": "RUNNING",
  "pc.task.waiting_user": "WAITING_USER",
  "pc.task.waiting_approval": "WAITING_APPROVAL",
  "pc.task.paused": "PAUSED",
  "pc.task.recovering": "RECOVERING",
  "pc.task.completed": "COMPLETED",
  "pc.task.failed": "FAILED",
  "pc.task.cancelled": "CANCELLED"
};

const OPERATION_EVENT_STATES: Record<string, BusinessOperationState> = {
  "pc.operation.awaiting_approval": "AWAITING_APPROVAL",
  "pc.operation.approved": "APPROVED",
  "pc.operation.dispatching": "DISPATCHING",
  "pc.operation.dispatched": "DISPATCHED",
  "pc.operation.provider_succeeded": "VERIFYING",
  "pc.operation.verifying": "VERIFYING",
  "pc.operation.verified": "SUCCEEDED",
  "pc.operation.failed": "FAILED",
  "pc.operation.outcome_unknown": "OUTCOME_UNKNOWN",
  "pc.operation.reconciling": "RECONCILING",
  "pc.operation.reconciled_success": "SUCCEEDED",
  "pc.operation.reconciled_failure": "FAILED",
  "pc.operation.compensation_required": "COMPENSATION_REQUIRED"
};

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new EventProjectionError(
        "PC_EVENT_NON_JSON_VALUE",
        "Event data contains a non-finite number"
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  throw new EventProjectionError(
    "PC_EVENT_NON_JSON_VALUE",
    "Event data must be JSON-compatible"
  );
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new EventProjectionError(
      "PC_EVENT_INVALID_ARGUMENT",
      `${field} is required`,
      false,
      { field }
    );
  }
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new EventProjectionError(
      "PC_EVENT_INVALID_ARGUMENT",
      `${field} must be a positive integer`,
      false,
      { field }
    );
  }
  return value;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => required(value, "list item")))].sort();
}

function stringValue(
  payload: Record<string, unknown>,
  field: string,
  fallback?: string
): string {
  const value = payload[field];
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (fallback !== undefined) return fallback;
  throw new EventProjectionError(
    "PC_EVENT_PAYLOAD_INVALID",
    `${field} is required in event payload`,
    false,
    { field }
  );
}

function optionalString(
  payload: Record<string, unknown>,
  field: string
): string | undefined {
  const value = payload[field];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function stringList(
  payload: Record<string, unknown>,
  field: string
): string[] {
  const value = payload[field];
  return Array.isArray(value)
    ? unique(value.filter((entry): entry is string => typeof entry === "string"))
    : [];
}

function cursorFor(
  event: EventEnvelope,
  state: EventCursor["state"],
  capturedAt: string,
  gapDetectedAt?: string
): EventCursor {
  return {
    contract_name: "pc.event-cursor/1",
    contract_version: 1,
    producer: event.producer,
    stream_kind: event.stream_kind,
    stream_id: event.stream_id,
    cursor: [
      event.producer,
      event.stream_kind,
      event.stream_id,
      event.stream_sequence
    ].join(":"),
    last_event_id: event.event_id,
    last_sequence: event.stream_sequence,
    state,
    expected_next_sequence: event.stream_sequence + 1,
    ...(gapDetectedAt === undefined ? {} : { gap_detected_at: gapDetectedAt }),
    captured_at: capturedAt
  };
}

function emptyCursor(input: {
  producer: string;
  stream_kind: EventStreamKind;
  stream_id: string;
  captured_at: string;
}): EventCursor {
  return {
    contract_name: "pc.event-cursor/1",
    contract_version: 1,
    producer: input.producer,
    stream_kind: input.stream_kind,
    stream_id: input.stream_id,
    cursor: `${input.producer}:${input.stream_kind}:${input.stream_id}:0`,
    last_event_id: "none",
    last_sequence: 0,
    state: "COMPLETE",
    expected_next_sequence: 1,
    captured_at: input.captured_at
  };
}

function taskSemantic(task: Omit<BusinessTask, "state_digest">): unknown {
  return {
    business_task_id: task.business_task_id,
    tenant_id: task.tenant_id,
    owner_principal_id: task.owner_principal_id,
    project_id: task.project_id ?? null,
    state: task.state,
    current_subtask_id: task.current_subtask_id ?? null,
    profile_release_id: task.profile_release_id,
    source_session_ids: [...task.source_session_ids].sort(),
    projection_complete: task.projection_complete,
    last_event_id: task.last_event_id,
    created_at: task.created_at,
    updated_at: task.updated_at,
    version: task.version
  };
}

function withTaskDigest(
  task: Omit<BusinessTask, "state_digest">
): BusinessTask {
  return {
    ...task,
    state_digest: digest(taskSemantic(task))
  };
}

function assertAggregateRevision(
  event: EventEnvelope,
  expected: number
): void {
  if (event.aggregate_revision !== expected) {
    throw new EventProjectionError(
      "PC_EVENT_AGGREGATE_REVISION_GAP",
      "Event Aggregate Revision does not match the next projection revision",
      false,
      {
        event_id: event.event_id,
        expected_revision: expected,
        actual_revision: event.aggregate_revision
      }
    );
  }
}

function projectTask(
  event: EventEnvelope,
  current: BusinessTask | undefined
): BusinessTask | undefined {
  if (event.event_type === "pc.task.created") {
    if (current !== undefined) {
      throw new EventProjectionError(
        "PC_TASK_ALREADY_EXISTS",
        "BusinessTask creation event targets an existing task"
      );
    }
    assertAggregateRevision(event, 1);
    const payload = event.payload;
    return withTaskDigest({
      contract_name: "pc.business-task/1",
      contract_version: 1,
      business_task_id: required(
        event.business_task_id ?? event.stream_id,
        "business_task_id"
      ),
      tenant_id: event.tenant_id,
      owner_principal_id: event.principal_id,
      ...(optionalString(payload, "project_id") === undefined
        ? {}
        : { project_id: optionalString(payload, "project_id") as string }),
      state: "DRAFT",
      ...(optionalString(payload, "current_subtask_id") === undefined
        ? {}
        : {
            current_subtask_id: optionalString(
              payload,
              "current_subtask_id"
            ) as string
          }),
      profile_release_id: stringValue(payload, "profile_release_id"),
      source_session_ids: unique([
        ...stringList(payload, "source_session_ids"),
        ...(event.pc_session_id === undefined ? [] : [event.pc_session_id])
      ]),
      projection_complete: true,
      last_event_id: event.event_id,
      created_at: event.occurred_at,
      updated_at: event.occurred_at,
      version: 1
    });
  }
  const targetState = TASK_EVENT_STATES[event.event_type];
  if (targetState === undefined) return current;
  if (current === undefined) {
    throw new EventProjectionError(
      "PC_TASK_NOT_FOUND",
      "Task transition event has no BusinessTask projection"
    );
  }
  assertAggregateRevision(event, current.version + 1);
  if (!TASK_TRANSITIONS[current.state].includes(targetState)) {
    throw new EventProjectionError(
      "PC_TASK_TRANSITION_INVALID",
      `BusinessTask cannot transition from ${current.state} to ${targetState}`
    );
  }
  return withTaskDigest({
    ...current,
    state: targetState,
    source_session_ids: unique([
      ...current.source_session_ids,
      ...(event.pc_session_id === undefined ? [] : [event.pc_session_id])
    ]),
    projection_complete: true,
    last_event_id: event.event_id,
    updated_at: event.occurred_at,
    version: current.version + 1
  });
}

function projectOperation(
  event: EventEnvelope,
  current: BusinessOperation | undefined
): BusinessOperation | undefined {
  if (event.event_type === "pc.operation.planned") {
    if (current !== undefined) {
      throw new EventProjectionError(
        "PC_OPERATION_ALREADY_EXISTS",
        "Operation creation event targets an existing operation"
      );
    }
    assertAggregateRevision(event, 1);
    const payload = event.payload;
    const operationKind = stringValue(payload, "operation_kind") as OperationKind;
    const recoveryClass = stringValue(
      payload,
      "recovery_class"
    ) as RecoveryClass;
    return {
      contract_name: "pc.business-operation/1",
      contract_version: 1,
      operation_id: required(
        event.operation_id ?? event.stream_id,
        "operation_id"
      ),
      business_task_id: required(
        event.business_task_id ?? stringValue(payload, "business_task_id"),
        "business_task_id"
      ),
      tenant_id: event.tenant_id,
      owner_principal_id: event.principal_id,
      operation_kind: operationKind,
      state: "PLANNED",
      recovery_class: recoveryClass,
      ...(event.approval_id === undefined
        ? {}
        : { approval_id: event.approval_id }),
      ...(optionalString(payload, "external_operation_record_id") === undefined
        ? {}
        : {
            external_operation_record_id: optionalString(
              payload,
              "external_operation_record_id"
            ) as string
          }),
      input_digest: stringValue(payload, "input_digest"),
      evidence_refs: stringList(payload, "evidence_refs"),
      projection_complete: true,
      last_event_id: event.event_id,
      updated_at: event.occurred_at,
      version: 1
    };
  }
  const targetState = OPERATION_EVENT_STATES[event.event_type];
  if (targetState === undefined) return current;
  if (current === undefined) {
    throw new EventProjectionError(
      "PC_OPERATION_NOT_FOUND",
      "Operation transition event has no BusinessOperation projection"
    );
  }
  assertAggregateRevision(event, current.version + 1);
  if (!OPERATION_TRANSITIONS[current.state].includes(targetState)) {
    throw new EventProjectionError(
      "PC_OPERATION_TRANSITION_INVALID",
      `BusinessOperation cannot transition from ${current.state} to ${targetState}`
    );
  }
  const payload = event.payload;
  return {
    ...current,
    state: targetState,
    ...(event.approval_id === undefined
      ? {}
      : { approval_id: event.approval_id }),
    ...(optionalString(payload, "external_operation_record_id") === undefined
      ? {}
      : {
          external_operation_record_id: optionalString(
            payload,
            "external_operation_record_id"
          ) as string
        }),
    ...(optionalString(payload, "result_digest") === undefined
      ? {}
      : { result_digest: optionalString(payload, "result_digest") as string }),
    evidence_refs: unique([
      ...current.evidence_refs,
      ...stringList(payload, "evidence_refs")
    ]),
    projection_complete: true,
    last_event_id: event.event_id,
    updated_at: event.occurred_at,
    version: current.version + 1
  };
}

function makeEnvelope(input: {
  event_type: string;
  producer?: string;
  producer_version?: string;
  tenant_id: string;
  principal_id: string;
  stream_kind: EventStreamKind;
  stream_id: string;
  stream_sequence: number;
  aggregate_revision?: number;
  business_task_id?: string;
  operation_id?: string;
  approval_id?: string;
  correlation_id?: string;
  causation_id?: string;
  pc_session_id?: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}): EventEnvelope {
  const payloadDigest = digest(input.payload);
  return {
    contract_name: "pc.event-envelope/1",
    contract_version: 1,
    event_id: `event_${randomUUID()}`,
    event_type: input.event_type,
    event_schema_version: 1,
    producer: input.producer ?? "pc-control-plane",
    producer_version: input.producer_version ?? "1.0.0",
    tenant_id: input.tenant_id,
    principal_id: input.principal_id,
    stream_kind: input.stream_kind,
    stream_id: input.stream_id,
    stream_sequence: input.stream_sequence,
    ...(input.aggregate_revision === undefined
      ? {}
      : { aggregate_revision: input.aggregate_revision }),
    ...(input.business_task_id === undefined
      ? {}
      : { business_task_id: input.business_task_id }),
    ...(input.operation_id === undefined
      ? {}
      : { operation_id: input.operation_id }),
    ...(input.approval_id === undefined
      ? {}
      : { approval_id: input.approval_id }),
    ...(input.correlation_id === undefined
      ? {}
      : { correlation_id: input.correlation_id }),
    ...(input.causation_id === undefined
      ? {}
      : { causation_id: input.causation_id }),
    ...(input.pc_session_id === undefined
      ? {}
      : { pc_session_id: input.pc_session_id }),
    durability: "DURABLE_PC",
    occurred_at: input.occurred_at,
    observed_at: input.occurred_at,
    payload: structuredClone(input.payload),
    payload_digest: payloadDigest
  };
}

export class EventProjectionService {
  private recoveryAuthorization: RecoveryAuthorizationPort | undefined;
  private recoveryGateway: RecoveryGatewayPort | undefined;
  private recoveryRuntime: RecoveryRuntimePort | undefined;

  constructor(
    private readonly repository: EventProjectionRepository,
    private readonly authority?: EventAuthorityPort,
    recoveryAuthorization?: RecoveryAuthorizationPort,
    recoveryGateway?: RecoveryGatewayPort,
    recoveryRuntime?: RecoveryRuntimePort,
    private readonly now: () => Date = () => new Date()
  ) {
    this.recoveryAuthorization = recoveryAuthorization;
    this.recoveryGateway = recoveryGateway;
    this.recoveryRuntime = recoveryRuntime;
  }

  initialize(): Promise<void> {
    return this.repository.initialize();
  }

  close(): Promise<void> {
    return this.repository.close();
  }

  registerRecoveryAuthorization(port: RecoveryAuthorizationPort): void {
    this.recoveryAuthorization = port;
  }

  registerRecoveryGateway(port: RecoveryGatewayPort): void {
    this.recoveryGateway = port;
  }

  registerRecoveryRuntime(port: RecoveryRuntimePort): void {
    this.recoveryRuntime = port;
  }

  async ingest(events: readonly EventEnvelope[]): Promise<Array<{
    event_id: string;
    status: EventInboxRecord["status"] | "DUPLICATE";
    reason_codes: string[];
  }>> {
    const results: Array<{
      event_id: string;
      status: EventInboxRecord["status"] | "DUPLICATE";
      reason_codes: string[];
    }> = [];
    for (const envelope of events) {
      this.validateEnvelope(envelope);
      const received = await this.repository.receiveEvent(
        structuredClone(envelope),
        this.now().toISOString()
      );
      if (received.duplicate) {
        results.push({
          event_id: envelope.event_id,
          status: "DUPLICATE",
          reason_codes: ["event_already_received"]
        });
        continue;
      }
      if (received.sequence_conflict) {
        results.push({
          event_id: envelope.event_id,
          status: "QUARANTINED",
          reason_codes: ["stream_sequence_conflict"]
        });
        continue;
      }
      if (this.authority !== undefined) {
        const authority = await this.authority.evaluate(envelope);
        if (!authority.allowed) {
          const stale = await this.repository.markEvent({
            producer: envelope.producer,
            event_id: envelope.event_id,
            expected_status: "PENDING",
            status: "STALE",
            reason_codes: [authority.code],
            applied_at: this.now().toISOString()
          });
          results.push({
            event_id: envelope.event_id,
            status: stale.status,
            reason_codes: [...stale.reason_codes]
          });
          continue;
        }
      }
      const applied = await this.advanceStream(envelope);
      results.push(applied);
    }
    return results;
  }

  async createTask(input: {
    tenant_id: string;
    owner_principal_id: string;
    profile_release_id: string;
    project_id?: string;
    source_session_ids?: string[];
  }): Promise<BusinessTask> {
    const taskId = `task_${randomUUID()}`;
    const now = this.now().toISOString();
    const event = makeEnvelope({
      event_type: "pc.task.created",
      tenant_id: required(input.tenant_id, "tenant_id"),
      principal_id: required(
        input.owner_principal_id,
        "owner_principal_id"
      ),
      stream_kind: "TASK",
      stream_id: taskId,
      stream_sequence: 1,
      aggregate_revision: 1,
      business_task_id: taskId,
      payload: {
        profile_release_id: required(
          input.profile_release_id,
          "profile_release_id"
        ),
        ...(input.project_id === undefined
          ? {}
          : { project_id: required(input.project_id, "project_id") }),
        source_session_ids: unique(input.source_session_ids ?? [])
      },
      occurred_at: now
    });
    await this.ingest([event]);
    return this.requireTask(taskId);
  }

  async transitionTask(input: {
    business_task_id: string;
    tenant_id: string;
    principal_id: string;
    state: Exclude<BusinessTaskState, "DRAFT">;
    pc_session_id?: string;
    reason_codes?: string[];
  }): Promise<BusinessTask> {
    const current = await this.requireTask(input.business_task_id);
    this.assertOwner(current, input.tenant_id, input.principal_id);
    const eventType = Object.entries(TASK_EVENT_STATES)
      .find(([, state]) => state === input.state)?.[0];
    if (eventType === undefined) {
      throw new EventProjectionError(
        "PC_TASK_TRANSITION_INVALID",
        "Unsupported BusinessTask target state"
      );
    }
    const event = makeEnvelope({
      event_type: eventType,
      tenant_id: current.tenant_id,
      principal_id: current.owner_principal_id,
      stream_kind: "TASK",
      stream_id: current.business_task_id,
      stream_sequence: current.version + 1,
      aggregate_revision: current.version + 1,
      business_task_id: current.business_task_id,
      ...(input.pc_session_id === undefined
        ? {}
        : { pc_session_id: input.pc_session_id }),
      payload: { reason_codes: unique(input.reason_codes ?? []) },
      occurred_at: this.now().toISOString()
    });
    await this.ingest([event]);
    return this.requireTask(current.business_task_id);
  }

  async planOperation(input: {
    operation_id?: string;
    business_task_id: string;
    tenant_id: string;
    principal_id: string;
    operation_kind: OperationKind;
    recovery_class: RecoveryClass;
    input_digest: string;
    approval_id?: string;
    external_operation_record_id?: string;
    evidence_refs?: string[];
  }): Promise<BusinessOperation> {
    const task = await this.requireTask(input.business_task_id);
    this.assertOwner(task, input.tenant_id, input.principal_id);
    const operationId = input.operation_id ?? `business_operation_${randomUUID()}`;
    const event = makeEnvelope({
      event_type: "pc.operation.planned",
      tenant_id: task.tenant_id,
      principal_id: task.owner_principal_id,
      stream_kind: "OPERATION",
      stream_id: operationId,
      stream_sequence: 1,
      aggregate_revision: 1,
      business_task_id: task.business_task_id,
      operation_id: operationId,
      ...(input.approval_id === undefined
        ? {}
        : { approval_id: input.approval_id }),
      correlation_id: task.business_task_id,
      payload: {
        business_task_id: task.business_task_id,
        operation_kind: input.operation_kind,
        recovery_class: input.recovery_class,
        input_digest: required(input.input_digest, "input_digest"),
        ...(input.external_operation_record_id === undefined
          ? {}
          : {
              external_operation_record_id:
                input.external_operation_record_id
            }),
        evidence_refs: unique(input.evidence_refs ?? [])
      },
      occurred_at: this.now().toISOString()
    });
    await this.ingest([event]);
    return this.requireOperation(operationId);
  }

  async transitionOperation(input: {
    operation_id: string;
    tenant_id: string;
    principal_id: string;
    state: Exclude<BusinessOperationState, "PLANNED">;
    result_digest?: string;
    evidence_refs?: string[];
    external_operation_record_id?: string;
    producer?: string;
  }): Promise<BusinessOperation> {
    const current = await this.requireOperation(input.operation_id);
    if (
      current.tenant_id !== input.tenant_id
      || current.owner_principal_id !== input.principal_id
    ) {
      throw new EventProjectionError(
        "PC_OPERATION_SCOPE_DENIED",
        "BusinessOperation belongs to another Principal"
      );
    }
    const eventType = Object.entries(OPERATION_EVENT_STATES)
      .find(([, state]) => state === input.state)?.[0];
    if (eventType === undefined) {
      throw new EventProjectionError(
        "PC_OPERATION_TRANSITION_INVALID",
        "Unsupported BusinessOperation target state"
      );
    }
    const producer = input.producer ?? "pc-control-plane";
    const producerCursor = await this.repository.getCursor({
      producer,
      stream_kind: "OPERATION",
      stream_id: current.operation_id
    });
    const event = makeEnvelope({
      event_type: eventType,
      producer,
      tenant_id: current.tenant_id,
      principal_id: current.owner_principal_id,
      stream_kind: "OPERATION",
      stream_id: current.operation_id,
      stream_sequence: (producerCursor?.last_sequence ?? 0) + 1,
      aggregate_revision: current.version + 1,
      business_task_id: current.business_task_id,
      operation_id: current.operation_id,
      ...(current.approval_id === undefined
        ? {}
        : { approval_id: current.approval_id }),
      correlation_id: current.business_task_id,
      payload: {
        ...(input.result_digest === undefined
          ? {}
          : { result_digest: input.result_digest }),
        ...(input.external_operation_record_id === undefined
          ? {}
          : {
              external_operation_record_id:
                input.external_operation_record_id
            }),
        evidence_refs: unique(input.evidence_refs ?? [])
      },
      occurred_at: this.now().toISOString()
    });
    await this.ingest([event]);
    return this.requireOperation(current.operation_id);
  }

  getTask(businessTaskId: string): Promise<BusinessTask | undefined> {
    return this.repository.getTask(businessTaskId);
  }

  async recordReadVerification(input: {
    operation: BusinessOperation;
    state: "VERIFYING" | "SUCCEEDED";
    result_digest: string;
    evidence_refs: string[];
    occurred_at: string;
    verifier_version: string;
  }): Promise<BusinessOperation> {
    const current = input.operation;
    if (current.operation_kind !== "READ" || !(input.state === "VERIFYING"
      ? current.state === "DISPATCHED" : current.state === "VERIFYING")) {
      throw new EventProjectionError("PC_READ_VERIFICATION_STATE_CONFLICT", "READ verification has an invalid predecessor state");
    }
    const event = makeEnvelope({ event_type: input.state === "SUCCEEDED" ? "pc.operation.verified" : "pc.operation.verifying",
      producer: input.state === "SUCCEEDED" ? "pc-read-verifier" : "pc-read-verifier-recovery",
      producer_version: input.verifier_version, tenant_id: current.tenant_id, principal_id: current.owner_principal_id,
      stream_kind: "OPERATION", stream_id: current.operation_id, stream_sequence: 1, aggregate_revision: current.version + 1,
      business_task_id: current.business_task_id, operation_id: current.operation_id, correlation_id: current.business_task_id,
      payload: { result_digest: input.result_digest, external_operation_record_id: current.operation_id,
        evidence_refs: unique(input.evidence_refs), verifier_version: input.verifier_version }, occurred_at: input.occurred_at });
    event.event_id = `read-verification_${digest({ operation: current.operation_id, revision: current.version,
      state: input.state, digest: input.result_digest }).slice(7)}`;
    this.validateEnvelope(event);
    if (this.authority && !(await this.authority.evaluate(event)).allowed) {
      throw new EventProjectionError("PC_READ_VERIFICATION_AUTHORITY_DENIED", "System verifier event was denied");
    }
    const received = await this.repository.receiveEvent(event, this.now().toISOString());
    if (received.sequence_conflict || !["PENDING", "APPLIED"].includes(received.record.status)) {
      throw new EventProjectionError("PC_READ_VERIFICATION_EVENT_CONFLICT", "Verifier event conflicts with durable history");
    }
    // Resume a durable pending event as well as a fresh one. Repository CAS commits
    // event + projection atomically; a competing verifier may already have won.
    if (received.record.status === "PENDING") {
      try { await this.applyRecord(received.record.envelope); }
      catch (error) {
        const latest = await this.requireOperation(current.operation_id);
        if (input.state === "VERIFYING" && latest.state === "SUCCEEDED" && latest.result_digest === input.result_digest) return latest;
        if (latest.last_event_id !== event.event_id || latest.state !== input.state
          || latest.result_digest !== input.result_digest) throw error;
      }
    }
    const latest = await this.requireOperation(current.operation_id);
    if (input.state === "VERIFYING" && latest.state === "SUCCEEDED" && latest.result_digest === input.result_digest) return latest;
    if (latest.state !== input.state || latest.last_event_id !== event.event_id || latest.result_digest !== input.result_digest) {
      throw new EventProjectionError("PC_READ_VERIFICATION_STATE_CONFLICT", "Operation changed during verification");
    }
    return latest;
  }

  listTasks(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<BusinessTask[]> {
    return this.repository.listTasks(tenantId, ownerPrincipalId);
  }

  getOperation(
    operationId: string
  ): Promise<BusinessOperation | undefined> {
    return this.repository.getOperation(operationId);
  }

  listTaskOperations(
    businessTaskId: string
  ): Promise<BusinessOperation[]> {
    return this.repository.listTaskOperations(businessTaskId);
  }

  getCursor(input: {
    producer: string;
    stream_kind: EventStreamKind;
    stream_id: string;
  }): Promise<EventCursor | undefined> {
    return this.repository.getCursor(input);
  }

  async rebuildTask(
    businessTaskId: string
  ): Promise<{
    task: BusinessTask;
    operations: BusinessOperation[];
    checkpoint: ProjectionCheckpoint;
    digest_matches: boolean;
  }> {
    const before = await this.requireTask(businessTaskId);
    const records = await this.repository.listTaskEvents(
      businessTaskId,
      ["APPLIED"]
    );
    const taskEvents = records
      .map((entry) => entry.envelope)
      .filter((event) =>
        event.event_type.startsWith("pc.task.")
        && event.aggregate_revision !== undefined
      )
      .sort((left, right) =>
        (left.aggregate_revision as number)
        - (right.aggregate_revision as number)
      );
    let task: BusinessTask | undefined;
    for (const event of taskEvents) task = projectTask(event, task);
    if (task === undefined) {
      throw new EventProjectionError(
        "PC_TASK_REBUILD_EMPTY",
        "No task creation event exists for rebuild"
      );
    }
    const operationGroups = new Map<string, EventEnvelope[]>();
    for (const entry of records) {
      const event = entry.envelope;
      if (
        !event.event_type.startsWith("pc.operation.")
        || event.operation_id === undefined
        || event.aggregate_revision === undefined
      ) continue;
      const group = operationGroups.get(event.operation_id) ?? [];
      group.push(event);
      operationGroups.set(event.operation_id, group);
    }
    const operations: BusinessOperation[] = [];
    for (const group of operationGroups.values()) {
      group.sort((left, right) =>
        (left.aggregate_revision as number)
        - (right.aggregate_revision as number)
      );
      let operation: BusinessOperation | undefined;
      for (const event of group) {
        operation = projectOperation(event, operation);
      }
      if (operation !== undefined) operations.push(operation);
    }
    operations.sort((left, right) =>
      left.operation_id.localeCompare(right.operation_id)
    );
    const stateDigest = digest({ task, operations });
    const checkpoint: ProjectionCheckpoint = {
      checkpoint_id: `checkpoint_${randomUUID()}`,
      projector_name: PROJECTOR_NAME,
      projector_version: PROJECTOR_VERSION,
      projection_schema_version: PROJECTION_SCHEMA_VERSION,
      tenant_id: task.tenant_id,
      business_task_id: task.business_task_id,
      source_event_count: records.length,
      last_event_id: records.at(-1)?.envelope.event_id ?? task.last_event_id,
      aggregate_revision: task.version,
      state_digest: stateDigest,
      created_at: this.now().toISOString()
    };
    const beforeDigest = digest({
      task: before,
      operations: await this.repository.listTaskOperations(businessTaskId)
    });
    await this.repository.replaceTaskProjection({
      task,
      operations,
      checkpoint
    });
    return {
      task,
      operations,
      checkpoint,
      digest_matches: beforeDigest === stateDigest
    };
  }

  async openRecoveryCase(input: {
    tenant_id: string;
    owner_principal_id: string;
    business_task_id?: string;
    trigger: RecoveryTrigger;
    affected_runtime_id?: string;
    affected_session_id?: string;
    affected_operation_ids?: string[];
    current_assignment?: Record<string, unknown>;
    persistent_facts?: Record<string, unknown>;
    authorization_checkpoint?: Record<string, unknown>;
  }): Promise<RecoveryCase> {
    const operationIds = unique(input.affected_operation_ids ?? []);
    const operations = await Promise.all(
      operationIds.map((operationId) => this.requireOperation(operationId))
    );
    for (const operation of operations) {
      if (
        operation.tenant_id !== input.tenant_id
        || operation.owner_principal_id !== input.owner_principal_id
      ) {
        throw new EventProjectionError(
          "PC_RECOVERY_SCOPE_DENIED",
          "RecoveryCase contains an Operation from another Principal"
        );
      }
    }
    const decision = this.classifyRecovery(input.trigger, operations);
    const state: RecoveryCase["state"] =
      decision.action === "REQUIRE_MANUAL"
        ? "MANUAL_REQUIRED"
        : decision.action === "WAIT_FOR_APPROVAL"
          ? "WAITING_APPROVAL"
          : "RECOVERY_PENDING";
    const now = this.now().toISOString();
    const recoveryCase: RecoveryCase = {
      contract_name: "pc.recovery-case/1",
      contract_version: 1,
      recovery_case_id: `recovery_${randomUUID()}`,
      tenant_id: required(input.tenant_id, "tenant_id"),
      owner_principal_id: required(
        input.owner_principal_id,
        "owner_principal_id"
      ),
      ...(input.business_task_id === undefined
        ? {}
        : { business_task_id: input.business_task_id }),
      trigger: input.trigger,
      ...(input.affected_runtime_id === undefined
        ? {}
        : { affected_runtime_id: input.affected_runtime_id }),
      ...(input.affected_session_id === undefined
        ? {}
        : { affected_session_id: input.affected_session_id }),
      affected_operation_ids: operationIds,
      current_assignment: structuredClone(input.current_assignment ?? {}),
      persistent_facts: structuredClone(input.persistent_facts ?? {}),
      authorization_checkpoint: structuredClone(
        input.authorization_checkpoint ?? {}
      ),
      decision,
      state,
      ...(state === "MANUAL_REQUIRED"
        ? {
            manual_action: {
              required: true,
              reason_codes: decision.reason_codes
            }
          }
        : {}),
      created_at: now,
      updated_at: now,
      version: 1
    };
    await this.repository.saveRecoveryCase(recoveryCase);
    if (input.business_task_id !== undefined) {
      const task = await this.repository.getTask(input.business_task_id);
      const targetState: BusinessTaskState =
        input.trigger === "APPROVAL_WAIT"
          ? "WAITING_APPROVAL"
          : "RECOVERING";
      if (
        task !== undefined
        && task.state !== targetState
        && TASK_TRANSITIONS[task.state].includes(targetState)
      ) {
        await this.transitionTask({
          business_task_id: task.business_task_id,
          tenant_id: task.tenant_id,
          principal_id: task.owner_principal_id,
          state: targetState,
          reason_codes: [`recovery_case:${recoveryCase.recovery_case_id}`]
        });
      }
    }
    return recoveryCase;
  }

  getRecoveryCase(
    recoveryCaseId: string
  ): Promise<RecoveryCase | undefined> {
    return this.repository.getRecoveryCase(recoveryCaseId);
  }

  listRecoveryCases(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<RecoveryCase[]> {
    return this.repository.listRecoveryCases(tenantId, ownerPrincipalId);
  }

  async reconcileRecoveryCase(input: {
    recovery_case_id: string;
    tenant_id: string;
    principal_id: string;
    authorization?: {
      actions: string[];
      resource_scope_refs: string[];
      tool_release_ids: string[];
      policy_model_revision: number;
      profile_release_id?: string;
    };
  }): Promise<{
    recovery_case: RecoveryCase;
    results: ReconciliationResult[];
  }> {
    const recoveryCase = await this.requireRecoveryCase(
      input.recovery_case_id
    );
    this.assertRecoveryOwner(recoveryCase, input.tenant_id, input.principal_id);
    await this.assertRecoveryAuthorization(recoveryCase, input.authorization);
    if (this.recoveryGateway === undefined) {
      throw new EventProjectionError(
        "PC_RECOVERY_GATEWAY_UNAVAILABLE",
        "Recovery Gateway is not configured",
        true
      );
    }
    const reconciling = await this.updateRecoveryCaseState(
      recoveryCase,
      "RECONCILING"
    );
    const results: ReconciliationResult[] = [];
    let unresolved = false;
    for (const operationId of reconciling.affected_operation_ids) {
      const external = await this.recoveryGateway.getOperation(operationId);
      if (external === undefined) {
        unresolved = true;
        continue;
      }
      const beforeReconciliation = await this.repository.getOperation(
        operationId
      );
      if (beforeReconciliation?.state === "OUTCOME_UNKNOWN") {
        await this.transitionOperation({
          operation_id: operationId,
          tenant_id: beforeReconciliation.tenant_id,
          principal_id: beforeReconciliation.owner_principal_id,
          state: "RECONCILING",
          producer: "pc-recovery-coordinator"
        });
      }
      const gatewayResult = external.outcome_state === "OUTCOME_UNKNOWN"
        ? await this.recoveryGateway.reconcile(operationId)
        : {
            outcome_state: external.outcome_state,
            ...(external.provider_operation_id === undefined
              ? {}
              : { provider_operation_id: external.provider_operation_id }),
            external_evidence_refs: []
          };
      const action: ReconciliationResult["action"] =
        gatewayResult.outcome_state === "KNOWN_SUCCESS"
        ? "RECORD_SUCCESS"
        : gatewayResult.outcome_state === "KNOWN_FAILURE"
          ? "RECORD_FAILURE"
          : gatewayResult.outcome_state === "NOT_STARTED"
            ? "RETRY_SAME_KEY"
            : "CONTINUE_RECONCILIATION";
      const result: ReconciliationResult = {
        contract_name: "pc.reconciliation-result/1",
        contract_version: 1,
        operation_id: operationId,
        provider_facts: {
          ...(gatewayResult.provider_operation_id === undefined
            ? {}
            : {
                provider_operation_id:
                  gatewayResult.provider_operation_id
              })
        },
        resolved_outcome_state: gatewayResult.outcome_state,
        action,
        evidence_refs: [...gatewayResult.external_evidence_refs],
        reconciled_at: this.now().toISOString()
      };
      await this.repository.saveReconciliationResult(result);
      results.push(result);
      const businessOperation = await this.repository.getOperation(operationId);
      if (businessOperation !== undefined) {
        if (
          gatewayResult.outcome_state === "KNOWN_SUCCESS"
        ) {
          if (businessOperation.state !== "SUCCEEDED") {
            await this.transitionOperation({
              operation_id: operationId,
              tenant_id: businessOperation.tenant_id,
              principal_id: businessOperation.owner_principal_id,
              state: "SUCCEEDED",
              evidence_refs: result.evidence_refs,
              producer: "pc-recovery-coordinator"
            });
          }
        } else if (
          gatewayResult.outcome_state === "KNOWN_FAILURE"
        ) {
          if (businessOperation.state !== "FAILED") {
            await this.transitionOperation({
              operation_id: operationId,
              tenant_id: businessOperation.tenant_id,
              principal_id: businessOperation.owner_principal_id,
              state: "FAILED",
              evidence_refs: result.evidence_refs,
              producer: "pc-recovery-coordinator"
            });
          }
        } else if (gatewayResult.outcome_state === "NOT_STARTED") {
          unresolved = true;
        } else {
          unresolved = true;
        }
      }
    }
    const completed = await this.updateRecoveryCaseState(
      await this.requireRecoveryCase(recoveryCase.recovery_case_id),
      unresolved ? "RECONCILING" : "RECOVERED"
    );
    if (completed.state === "RECOVERED") {
      await this.resumeTaskAfterRecovery(completed);
    }
    return { recovery_case: completed, results };
  }

  async migrateRecoveryCase(input: {
    recovery_case_id: string;
    tenant_id: string;
    principal_id: string;
    target_runtime_id: string;
    target_runtime_epoch: number;
    effective_profile_snapshot_id: string;
    workspace_view_snapshot_id: string;
    authorization_revision: number;
    lease_duration_ms: number;
    authorization?: {
      actions: string[];
      resource_scope_refs: string[];
      tool_release_ids: string[];
      policy_model_revision: number;
      profile_release_id?: string;
    };
  }): Promise<RecoveryCase> {
    const recoveryCase = await this.requireRecoveryCase(
      input.recovery_case_id
    );
    this.assertRecoveryOwner(recoveryCase, input.tenant_id, input.principal_id);
    await this.assertRecoveryAuthorization(recoveryCase, input.authorization);
    if (
      this.recoveryRuntime === undefined
      || recoveryCase.affected_session_id === undefined
    ) {
      throw new EventProjectionError(
        "PC_RECOVERY_RUNTIME_UNAVAILABLE",
        "Recovery Runtime migration is not configured",
        true
      );
    }
    const recovering = await this.updateRecoveryCaseState(
      recoveryCase,
      "RECOVERING"
    );
    const pcSessionId = recoveryCase.affected_session_id;
    const assignment = await this.recoveryRuntime.migrate({
      recovery_case_id: recovering.recovery_case_id,
      ...(recovering.affected_runtime_id === undefined
        ? {}
        : { old_runtime_id: recovering.affected_runtime_id }),
      pc_session_id: pcSessionId,
      target_runtime_id: input.target_runtime_id,
      target_runtime_epoch: input.target_runtime_epoch,
      tenant_id: recovering.tenant_id,
      principal_id: recovering.owner_principal_id,
      effective_profile_snapshot_id: input.effective_profile_snapshot_id,
      workspace_view_snapshot_id: input.workspace_view_snapshot_id,
      authorization_revision: input.authorization_revision,
      lease_duration_ms: input.lease_duration_ms
    });
    const completed = await this.repository.updateRecoveryCase({
      ...recovering,
      current_assignment: assignment,
      state: "RECOVERED",
      updated_at: this.now().toISOString(),
      version: recovering.version + 1
    }, recovering.version);
    await this.resumeTaskAfterRecovery(completed);
    return completed;
  }

  private async advanceStream(envelope: EventEnvelope): Promise<{
    event_id: string;
    status: EventInboxRecord["status"];
    reason_codes: string[];
  }> {
    const current = await this.repository.getCursor({
      producer: envelope.producer,
      stream_kind: envelope.stream_kind,
      stream_id: envelope.stream_id
    }) ?? emptyCursor({
      producer: envelope.producer,
      stream_kind: envelope.stream_kind,
      stream_id: envelope.stream_id,
      captured_at: this.now().toISOString()
    });
    if (envelope.stream_sequence <= current.last_sequence) {
      const quarantined = await this.repository.markEvent({
        producer: envelope.producer,
        event_id: envelope.event_id,
        expected_status: "PENDING",
        status: "QUARANTINED",
        reason_codes: ["late_or_reused_stream_sequence"],
        applied_at: this.now().toISOString()
      });
      return {
        event_id: envelope.event_id,
        status: quarantined.status,
        reason_codes: quarantined.reason_codes
      };
    }
    if (envelope.stream_sequence > current.expected_next_sequence) {
      await this.repository.saveCursor({
        ...current,
        state: "GAP",
        gap_detected_at: current.gap_detected_at ?? this.now().toISOString(),
        captured_at: this.now().toISOString()
      });
      if (envelope.business_task_id !== undefined) {
        const task = await this.repository.getTask(envelope.business_task_id);
        if (task !== undefined) {
          await this.repository.setTaskProjectionCompleteness(
            withTaskDigest({
              ...task,
              projection_complete: false
            }),
            task.version
          );
        }
      }
      return {
        event_id: envelope.event_id,
        status: "PENDING",
        reason_codes: [
          `gap_expected:${current.expected_next_sequence}`,
          `gap_received:${envelope.stream_sequence}`
        ]
      };
    }
    try {
      await this.applyRecord(envelope);
      await this.drainPending(envelope);
      const record = await this.repository.getInboxRecord(
        envelope.producer,
        envelope.event_id
      );
      return {
        event_id: envelope.event_id,
        status: record?.status ?? "APPLIED",
        reason_codes: record?.reason_codes ?? ["event_applied"]
      };
    } catch (error) {
      if (!(error instanceof EventProjectionError)) throw error;
      const quarantined = await this.repository.markEvent({
        producer: envelope.producer,
        event_id: envelope.event_id,
        expected_status: "PENDING",
        status: "QUARANTINED",
        reason_codes: [error.code],
        applied_at: this.now().toISOString()
      });
      await this.repository.saveCursor({
        ...current,
        state: "QUARANTINED",
        captured_at: this.now().toISOString()
      });
      return {
        event_id: envelope.event_id,
        status: quarantined.status,
        reason_codes: quarantined.reason_codes
      };
    }
  }

  private async applyRecord(envelope: EventEnvelope): Promise<void> {
    const currentTask = envelope.business_task_id === undefined
      ? undefined
      : await this.repository.getTask(envelope.business_task_id);
    const currentOperation = envelope.operation_id === undefined
      ? undefined
      : await this.repository.getOperation(envelope.operation_id);
    const task = projectTask(envelope, currentTask);
    const operation = projectOperation(envelope, currentOperation);
    if (
      operation !== undefined
      && task !== undefined
      && operation.business_task_id !== task.business_task_id
    ) {
      throw new EventProjectionError(
        "PC_EVENT_AGGREGATE_SCOPE_MISMATCH",
        "Task and Operation projections belong to different aggregates"
      );
    }
    const appliedAt = this.now().toISOString();
    await this.repository.commitAppliedEvent({
      producer: envelope.producer,
      event_id: envelope.event_id,
      cursor: cursorFor(envelope, "COMPLETE", appliedAt),
      ...(task === undefined ? {} : { task }),
      ...(currentTask === undefined
        ? {}
        : { expected_task_version: currentTask.version }),
      ...(operation === undefined ? {} : { operation }),
      ...(currentOperation === undefined
        ? {}
        : { expected_operation_version: currentOperation.version }),
      applied_at: appliedAt
    });
  }

  private async drainPending(anchor: EventEnvelope): Promise<void> {
    while (true) {
      const cursor = await this.repository.getCursor({
        producer: anchor.producer,
        stream_kind: anchor.stream_kind,
        stream_id: anchor.stream_id
      });
      if (cursor === undefined) return;
      const pending = await this.repository.listStreamEvents({
        producer: anchor.producer,
        stream_kind: anchor.stream_kind,
        stream_id: anchor.stream_id,
        statuses: ["PENDING"]
      });
      const next = pending.find((record) =>
        record.envelope.stream_sequence === cursor.expected_next_sequence
      );
      if (next === undefined) {
        const future = pending.some((record) =>
          record.envelope.stream_sequence > cursor.expected_next_sequence
        );
        const withoutGap = { ...cursor };
        delete withoutGap.gap_detected_at;
        await this.repository.saveCursor(future
          ? {
              ...cursor,
              state: "GAP",
              gap_detected_at:
                cursor.gap_detected_at ?? this.now().toISOString(),
              captured_at: this.now().toISOString()
            }
          : {
              ...withoutGap,
              state: "COMPLETE",
              captured_at: this.now().toISOString()
            });
        if (anchor.business_task_id !== undefined && !future) {
          const task = await this.repository.getTask(
            anchor.business_task_id
          );
          if (task !== undefined && !task.projection_complete) {
            await this.repository.setTaskProjectionCompleteness(
              withTaskDigest({
                ...task,
                projection_complete: true
              }),
              task.version
            );
          }
        }
        return;
      }
      await this.applyRecord(next.envelope);
    }
  }

  private validateEnvelope(envelope: EventEnvelope): void {
    if (
      envelope.contract_name !== "pc.event-envelope/1"
      || envelope.contract_version !== 1
      || envelope.event_schema_version !== 1
    ) {
      throw new EventProjectionError(
        "PC_EVENT_SCHEMA_UNSUPPORTED",
        "Event Envelope contract or schema version is unsupported"
      );
    }
    required(envelope.event_id, "event_id");
    required(envelope.event_type, "event_type");
    required(envelope.producer, "producer");
    required(envelope.producer_version, "producer_version");
    required(envelope.tenant_id, "tenant_id");
    required(envelope.principal_id, "principal_id");
    required(envelope.stream_id, "stream_id");
    positiveInteger(envelope.stream_sequence, "stream_sequence");
    if (
      envelope.aggregate_revision !== undefined
      && (!Number.isInteger(envelope.aggregate_revision)
        || envelope.aggregate_revision <= 0)
    ) {
      throw new EventProjectionError(
        "PC_EVENT_INVALID_ARGUMENT",
        "aggregate_revision must be a positive integer"
      );
    }
    const payloadDigest = digest(envelope.payload);
    if (payloadDigest !== envelope.payload_digest) {
      throw new EventProjectionError(
        "PC_EVENT_PAYLOAD_DIGEST_MISMATCH",
        "Event payload does not match payload_digest"
      );
    }
    if (
      !Number.isFinite(Date.parse(envelope.occurred_at))
      || !Number.isFinite(Date.parse(envelope.observed_at))
    ) {
      throw new EventProjectionError(
        "PC_EVENT_TIME_INVALID",
        "Event timestamps must be valid date-time values"
      );
    }
  }

  private classifyRecovery(
    trigger: RecoveryTrigger,
    operations: BusinessOperation[]
  ): RecoveryCase["decision"] {
    if (trigger === "APPROVAL_WAIT") {
      return {
        classification: "RECONCILE_BEFORE_RETRY",
        action: "WAIT_FOR_APPROVAL",
        reason_codes: ["durable_approval_wait"]
      };
    }
    if (trigger === "RUNTIME_LOST" || trigger === "ASSIGNMENT_EXPIRED") {
      return {
        classification: "REPLAY_SAFE",
        action: "MIGRATE_RUNTIME",
        reason_codes: ["runtime_authority_lost"]
      };
    }
    if (operations.some((operation) =>
      operation.recovery_class === "NON_RECOVERABLE"
    )) {
      return {
        classification: "NON_RECOVERABLE",
        action: "REQUIRE_MANUAL",
        reason_codes: ["non_recoverable_operation"]
      };
    }
    if (operations.some((operation) =>
      operation.recovery_class === "RECONCILE_BEFORE_RETRY"
      || operation.state === "OUTCOME_UNKNOWN"
    )) {
      return {
        classification: "RECONCILE_BEFORE_RETRY",
        action: "RECONCILE",
        reason_codes: ["external_outcome_requires_reconciliation"]
      };
    }
    if (operations.some((operation) =>
      operation.recovery_class === "EXTERNAL_DURABLE_JOB"
    )) {
      return {
        classification: "EXTERNAL_DURABLE_JOB",
        action: "RESUME_EXTERNAL_JOB",
        reason_codes: ["external_job_is_durable"]
      };
    }
    if (operations.some((operation) =>
      operation.recovery_class === "IDEMPOTENT_RETRY"
    )) {
      return {
        classification: "IDEMPOTENT_RETRY",
        action: "RETRY_SAME_KEY",
        reason_codes: ["idempotent_retry_allowed"]
      };
    }
    return {
      classification: "REPLAY_SAFE",
      action: "REPLAY",
      reason_codes: ["stable_checkpoint_replay"]
    };
  }

  private async assertRecoveryAuthorization(
    recoveryCase: RecoveryCase,
    input?: {
      actions: string[];
      resource_scope_refs: string[];
      tool_release_ids: string[];
      policy_model_revision: number;
      profile_release_id?: string;
    }
  ): Promise<void> {
    if (input === undefined) return;
    if (this.recoveryAuthorization === undefined) {
      throw new EventProjectionError(
        "PC_RECOVERY_AUTHORIZATION_UNAVAILABLE",
        "Recovery authorization is not configured",
        true
      );
    }
    const decision = await this.recoveryAuthorization.evaluate({
      principal_id: recoveryCase.owner_principal_id,
      actions: input.actions,
      resource_scope_refs: input.resource_scope_refs,
      tool_release_ids: input.tool_release_ids,
      policy_model_revision: input.policy_model_revision,
      ...(input.profile_release_id === undefined
        ? {}
        : { profile_release_id: input.profile_release_id })
    });
    if (decision.decision !== "ALLOW") {
      throw new EventProjectionError(
        "PC_RECOVERY_AUTHORIZATION_DENIED",
        "Current authorization denies recovery",
        false,
        { reason_codes: [...decision.reason_codes] }
      );
    }
  }

  private async updateRecoveryCaseState(
    recoveryCase: RecoveryCase,
    state: RecoveryCase["state"]
  ): Promise<RecoveryCase> {
    if (recoveryCase.state === state) return recoveryCase;
    return this.repository.updateRecoveryCase({
      ...recoveryCase,
      state,
      updated_at: this.now().toISOString(),
      version: recoveryCase.version + 1
    }, recoveryCase.version);
  }

  private async resumeTaskAfterRecovery(
    recoveryCase: RecoveryCase
  ): Promise<void> {
    if (recoveryCase.business_task_id === undefined) return;
    const task = await this.repository.getTask(recoveryCase.business_task_id);
    if (
      task === undefined
      || task.state === "RUNNING"
      || !TASK_TRANSITIONS[task.state].includes("RUNNING")
    ) return;
    await this.transitionTask({
      business_task_id: task.business_task_id,
      tenant_id: task.tenant_id,
      principal_id: task.owner_principal_id,
      state: "RUNNING",
      reason_codes: [`recovery_completed:${recoveryCase.recovery_case_id}`]
    });
  }

  private async requireTask(businessTaskId: string): Promise<BusinessTask> {
    const task = await this.repository.getTask(businessTaskId);
    if (task === undefined) {
      throw new EventProjectionError(
        "PC_TASK_NOT_FOUND",
        "BusinessTask was not found"
      );
    }
    return task;
  }

  private async requireOperation(
    operationId: string
  ): Promise<BusinessOperation> {
    const operation = await this.repository.getOperation(operationId);
    if (operation === undefined) {
      throw new EventProjectionError(
        "PC_OPERATION_NOT_FOUND",
        "BusinessOperation was not found"
      );
    }
    return operation;
  }

  private async requireRecoveryCase(
    recoveryCaseId: string
  ): Promise<RecoveryCase> {
    const recoveryCase = await this.repository.getRecoveryCase(recoveryCaseId);
    if (recoveryCase === undefined) {
      throw new EventProjectionError(
        "PC_RECOVERY_CASE_NOT_FOUND",
        "RecoveryCase was not found"
      );
    }
    return recoveryCase;
  }

  private assertOwner(
    task: BusinessTask,
    tenantId: string,
    principalId: string
  ): void {
    if (
      task.tenant_id !== tenantId
      || task.owner_principal_id !== principalId
    ) {
      throw new EventProjectionError(
        "PC_TASK_SCOPE_DENIED",
        "BusinessTask belongs to another Principal"
      );
    }
  }

  private assertRecoveryOwner(
    recoveryCase: RecoveryCase,
    tenantId: string,
    principalId: string
  ): void {
    if (
      recoveryCase.tenant_id !== tenantId
      || recoveryCase.owner_principal_id !== principalId
    ) {
      throw new EventProjectionError(
        "PC_RECOVERY_SCOPE_DENIED",
        "RecoveryCase belongs to another Principal"
      );
    }
  }
}
