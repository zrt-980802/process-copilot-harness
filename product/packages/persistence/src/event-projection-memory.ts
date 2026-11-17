import { randomUUID } from "node:crypto";
import type {
  BusinessOperation,
  BusinessTask,
  EventCursor,
  EventEnvelope,
  EventInboxRecord,
  EventProjectionRepository,
  EventReceiveResult,
  InboxStatus,
  ProjectionCheckpoint,
  ReconciliationResult,
  RecoveryCase
} from "@pc/event-projection";
import { EventProjectionError } from "@pc/event-projection";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function key(...parts: Array<string | number>): string {
  return parts.join("\u0000");
}

export class MemoryEventProjectionRepository
implements EventProjectionRepository {
  private readonly inbox = new Map<string, EventInboxRecord>();
  private readonly streamSequences = new Map<string, string>();
  private readonly cursors = new Map<string, EventCursor>();
  private readonly tasks = new Map<string, BusinessTask>();
  private readonly operations = new Map<string, BusinessOperation>();
  private readonly checkpoints = new Map<string, ProjectionCheckpoint>();
  private readonly recoveryCases = new Map<string, RecoveryCase>();
  private readonly reconciliation = new Map<string, ReconciliationResult>();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  receiveEvent(
    envelope: EventEnvelope,
    receivedAt: string
  ): Promise<EventReceiveResult> {
    const inboxKey = key(envelope.producer, envelope.event_id);
    const current = this.inbox.get(inboxKey);
    if (current !== undefined) {
      if (JSON.stringify(current.envelope) !== JSON.stringify(envelope)) {
        throw new EventProjectionError(
          "PC_EVENT_ID_CONFLICT",
          "Producer reused event_id with different immutable content"
        );
      }
      return Promise.resolve({
        record: clone(current),
        duplicate: true,
        sequence_conflict: false
      });
    }
    const sequenceKey = key(
      envelope.producer,
      envelope.stream_kind,
      envelope.stream_id,
      envelope.stream_sequence
    );
    const conflictingEventId = this.streamSequences.get(sequenceKey);
    const sequenceConflict =
      conflictingEventId !== undefined
      && conflictingEventId !== envelope.event_id;
    const record: EventInboxRecord = {
      inbox_id: `inbox_${randomUUID()}`,
      envelope: clone(envelope),
      status: sequenceConflict ? "QUARANTINED" : "PENDING",
      reason_codes: sequenceConflict ? ["stream_sequence_conflict"] : [],
      received_at: receivedAt
    };
    this.inbox.set(inboxKey, record);
    if (!sequenceConflict) {
      this.streamSequences.set(sequenceKey, envelope.event_id);
    }
    return Promise.resolve({
      record: clone(record),
      duplicate: false,
      sequence_conflict: sequenceConflict
    });
  }

  getInboxRecord(
    producer: string,
    eventId: string
  ): Promise<EventInboxRecord | undefined> {
    const record = this.inbox.get(key(producer, eventId));
    return Promise.resolve(record === undefined ? undefined : clone(record));
  }

  listStreamEvents(input: {
    producer: string;
    stream_kind: EventEnvelope["stream_kind"];
    stream_id: string;
    statuses?: InboxStatus[];
  }): Promise<EventInboxRecord[]> {
    return Promise.resolve(
      [...this.inbox.values()]
        .filter((record) =>
          record.envelope.producer === input.producer
          && record.envelope.stream_kind === input.stream_kind
          && record.envelope.stream_id === input.stream_id
          && (
            input.statuses === undefined
            || input.statuses.includes(record.status)
          )
        )
        .sort((left, right) =>
          left.envelope.stream_sequence - right.envelope.stream_sequence
        )
        .map(clone)
    );
  }

  listTaskEvents(
    businessTaskId: string,
    statuses?: InboxStatus[]
  ): Promise<EventInboxRecord[]> {
    return Promise.resolve(
      [...this.inbox.values()]
        .filter((record) =>
          record.envelope.business_task_id === businessTaskId
          && (
            statuses === undefined
            || statuses.includes(record.status)
          )
        )
        .sort((left, right) =>
          left.envelope.observed_at.localeCompare(
            right.envelope.observed_at
          )
          || left.envelope.event_id.localeCompare(right.envelope.event_id)
        )
        .map(clone)
    );
  }

  getCursor(input: {
    producer: string;
    stream_kind: EventEnvelope["stream_kind"];
    stream_id: string;
  }): Promise<EventCursor | undefined> {
    const cursor = this.cursors.get(
      key(input.producer, input.stream_kind, input.stream_id)
    );
    return Promise.resolve(cursor === undefined ? undefined : clone(cursor));
  }

  saveCursor(cursor: EventCursor): Promise<void> {
    this.cursors.set(
      key(cursor.producer, cursor.stream_kind, cursor.stream_id),
      clone(cursor)
    );
    return Promise.resolve();
  }

  markEvent(input: {
    producer: string;
    event_id: string;
    expected_status: InboxStatus;
    status: InboxStatus;
    reason_codes: string[];
    applied_at?: string;
  }): Promise<EventInboxRecord> {
    const record = this.requireRecord(input.producer, input.event_id);
    if (record.status !== input.expected_status) {
      throw new EventProjectionError(
        "PC_EVENT_INBOX_CAS_CONFLICT",
        "Event Inbox status changed",
        true
      );
    }
    const updated: EventInboxRecord = {
      ...record,
      status: input.status,
      reason_codes: [...input.reason_codes],
      ...(input.applied_at === undefined
        ? {}
        : { applied_at: input.applied_at })
    };
    this.inbox.set(key(input.producer, input.event_id), updated);
    return Promise.resolve(clone(updated));
  }

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
  }): Promise<void> {
    const record = this.requireRecord(input.producer, input.event_id);
    if (record.status !== "PENDING") {
      throw new EventProjectionError(
        "PC_EVENT_INBOX_CAS_CONFLICT",
        "Event Inbox status changed",
        true
      );
    }
    if (input.task !== undefined) {
      const current = this.tasks.get(input.task.business_task_id);
      this.assertVersion(
        current?.version,
        input.expected_task_version,
        "BusinessTask"
      );
    }
    if (input.operation !== undefined) {
      const current = this.operations.get(input.operation.operation_id);
      this.assertVersion(
        current?.version,
        input.expected_operation_version,
        "BusinessOperation"
      );
    }
    if (input.task !== undefined) {
      this.tasks.set(input.task.business_task_id, clone(input.task));
    }
    if (input.operation !== undefined) {
      this.operations.set(
        input.operation.operation_id,
        clone(input.operation)
      );
    }
    if (input.recovery_case !== undefined) {
      this.recoveryCases.set(
        input.recovery_case.recovery_case_id,
        clone(input.recovery_case)
      );
    }
    this.cursors.set(
      key(
        input.cursor.producer,
        input.cursor.stream_kind,
        input.cursor.stream_id
      ),
      clone(input.cursor)
    );
    this.inbox.set(key(input.producer, input.event_id), {
      ...record,
      status: "APPLIED",
      reason_codes: ["event_applied"],
      applied_at: input.applied_at
    });
    return Promise.resolve();
  }

  setTaskProjectionCompleteness(
    task: BusinessTask,
    expectedVersion: number
  ): Promise<void> {
    const current = this.tasks.get(task.business_task_id);
    if (current === undefined || current.version !== expectedVersion) {
      throw new EventProjectionError(
        "PC_EVENT_PROJECTION_CAS_CONFLICT",
        "BusinessTask version changed",
        true
      );
    }
    this.tasks.set(task.business_task_id, clone(task));
    return Promise.resolve();
  }

  getTask(businessTaskId: string): Promise<BusinessTask | undefined> {
    const task = this.tasks.get(businessTaskId);
    return Promise.resolve(task === undefined ? undefined : clone(task));
  }

  listTasks(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<BusinessTask[]> {
    return Promise.resolve(
      [...this.tasks.values()]
        .filter((task) =>
          task.tenant_id === tenantId
          && task.owner_principal_id === ownerPrincipalId
        )
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .map(clone)
    );
  }

  getOperation(
    operationId: string
  ): Promise<BusinessOperation | undefined> {
    const operation = this.operations.get(operationId);
    return Promise.resolve(
      operation === undefined ? undefined : clone(operation)
    );
  }

  listTaskOperations(businessTaskId: string): Promise<BusinessOperation[]> {
    return Promise.resolve(
      [...this.operations.values()]
        .filter((operation) =>
          operation.business_task_id === businessTaskId
        )
        .sort((left, right) =>
          left.operation_id.localeCompare(right.operation_id)
        )
        .map(clone)
    );
  }

  replaceTaskProjection(input: {
    task: BusinessTask;
    operations: BusinessOperation[];
    checkpoint: ProjectionCheckpoint;
  }): Promise<void> {
    this.tasks.set(input.task.business_task_id, clone(input.task));
    for (const [operationId, operation] of this.operations) {
      if (operation.business_task_id === input.task.business_task_id) {
        this.operations.delete(operationId);
      }
    }
    for (const operation of input.operations) {
      this.operations.set(operation.operation_id, clone(operation));
    }
    this.checkpoints.set(
      input.checkpoint.business_task_id,
      clone(input.checkpoint)
    );
    return Promise.resolve();
  }

  getCheckpoint(
    businessTaskId: string
  ): Promise<ProjectionCheckpoint | undefined> {
    const checkpoint = this.checkpoints.get(businessTaskId);
    return Promise.resolve(
      checkpoint === undefined ? undefined : clone(checkpoint)
    );
  }

  saveRecoveryCase(recoveryCase: RecoveryCase): Promise<void> {
    if (this.recoveryCases.has(recoveryCase.recovery_case_id)) {
      throw new EventProjectionError(
        "PC_RECOVERY_CASE_CONFLICT",
        "RecoveryCase ID already exists"
      );
    }
    this.recoveryCases.set(
      recoveryCase.recovery_case_id,
      clone(recoveryCase)
    );
    return Promise.resolve();
  }

  getRecoveryCase(
    recoveryCaseId: string
  ): Promise<RecoveryCase | undefined> {
    const recoveryCase = this.recoveryCases.get(recoveryCaseId);
    return Promise.resolve(
      recoveryCase === undefined ? undefined : clone(recoveryCase)
    );
  }

  updateRecoveryCase(
    recoveryCase: RecoveryCase,
    expectedVersion: number
  ): Promise<RecoveryCase> {
    const current = this.recoveryCases.get(recoveryCase.recovery_case_id);
    if (current === undefined || current.version !== expectedVersion) {
      throw new EventProjectionError(
        "PC_RECOVERY_CASE_CAS_CONFLICT",
        "RecoveryCase version changed",
        true
      );
    }
    this.recoveryCases.set(
      recoveryCase.recovery_case_id,
      clone(recoveryCase)
    );
    return Promise.resolve(clone(recoveryCase));
  }

  listRecoveryCases(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<RecoveryCase[]> {
    return Promise.resolve(
      [...this.recoveryCases.values()]
        .filter((recoveryCase) =>
          recoveryCase.tenant_id === tenantId
          && recoveryCase.owner_principal_id === ownerPrincipalId
        )
        .sort((left, right) =>
          left.created_at.localeCompare(right.created_at)
        )
        .map(clone)
    );
  }

  saveReconciliationResult(result: ReconciliationResult): Promise<void> {
    this.reconciliation.set(result.operation_id, clone(result));
    return Promise.resolve();
  }

  getReconciliationResult(
    operationId: string
  ): Promise<ReconciliationResult | undefined> {
    const result = this.reconciliation.get(operationId);
    return Promise.resolve(result === undefined ? undefined : clone(result));
  }

  private requireRecord(
    producer: string,
    eventId: string
  ): EventInboxRecord {
    const record = this.inbox.get(key(producer, eventId));
    if (record === undefined) {
      throw new EventProjectionError(
        "PC_EVENT_INBOX_NOT_FOUND",
        "Event Inbox record was not found"
      );
    }
    return record;
  }

  private assertVersion(
    currentVersion: number | undefined,
    expectedVersion: number | undefined,
    subject: string
  ): void {
    if (
      (expectedVersion === undefined && currentVersion !== undefined)
      || (
        expectedVersion !== undefined
        && currentVersion !== expectedVersion
      )
    ) {
      throw new EventProjectionError(
        "PC_EVENT_PROJECTION_CAS_CONFLICT",
        `${subject} version changed`,
        true
      );
    }
  }
}
