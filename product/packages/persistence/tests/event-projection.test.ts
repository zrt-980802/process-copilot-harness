import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EventProjectionService,
  type EventAuthorityPort,
  type EventEnvelope,
  type RecoveryGatewayPort,
  type RecoveryRuntimePort
} from "@pc/event-projection";
import { MemoryEventProjectionRepository } from "../src/index.js";

const NOW = new Date("2026-11-10T13:00:00.000Z");

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function event(input: {
  id: string;
  type: string;
  streamKind: EventEnvelope["stream_kind"];
  streamId: string;
  streamSequence: number;
  aggregateRevision?: number;
  taskId?: string;
  operationId?: string;
  payload?: Record<string, unknown>;
  producer?: string;
  runtimeId?: string;
  runtimeEpoch?: number;
  assignmentGeneration?: number;
  fencingToken?: string;
}): EventEnvelope {
  const payload = input.payload ?? {};
  return {
    contract_name: "pc.event-envelope/1",
    contract_version: 1,
    event_id: input.id,
    event_type: input.type,
    event_schema_version: 1,
    producer: input.producer ?? "pc-control-plane",
    producer_version: "1.0.0",
    tenant_id: "tenant-1",
    principal_id: "principal-1",
    stream_kind: input.streamKind,
    stream_id: input.streamId,
    stream_sequence: input.streamSequence,
    ...(input.aggregateRevision === undefined
      ? {}
      : { aggregate_revision: input.aggregateRevision }),
    ...(input.taskId === undefined
      ? {}
      : { business_task_id: input.taskId }),
    ...(input.operationId === undefined
      ? {}
      : { operation_id: input.operationId }),
    ...(input.runtimeId === undefined
      ? {}
      : { runtime_id: input.runtimeId }),
    ...(input.runtimeEpoch === undefined
      ? {}
      : { runtime_epoch: input.runtimeEpoch }),
    ...(input.assignmentGeneration === undefined
      ? {}
      : { assignment_generation: input.assignmentGeneration }),
    ...(input.fencingToken === undefined
      ? {}
      : { fencing_token: input.fencingToken }),
    durability: "DURABLE_PC",
    occurred_at: NOW.toISOString(),
    observed_at: NOW.toISOString(),
    payload,
    payload_digest: digest(payload)
  };
}

async function fixture(
  authority?: EventAuthorityPort,
  gateway?: RecoveryGatewayPort,
  runtime?: RecoveryRuntimePort
) {
  const repository = new MemoryEventProjectionRepository();
  const service = new EventProjectionService(
    repository,
    authority,
    undefined,
    gateway,
    runtime,
    () => new Date(NOW)
  );
  await service.initialize();
  return { repository, service };
}

describe("DEV-08 Event Inbox and business projection", () => {
  it("deduplicates immutable events and advances a task state machine", async () => {
    const { service } = await fixture();
    const task = await service.createTask({
      tenant_id: "tenant-1",
      owner_principal_id: "principal-1",
      profile_release_id: "profile-1",
      source_session_ids: ["session-1"]
    });
    const duplicateEvent = event({
      id: "event-ready",
      type: "pc.task.ready",
      streamKind: "TASK",
      streamId: task.business_task_id,
      streamSequence: 2,
      aggregateRevision: 2,
      taskId: task.business_task_id
    });
    const first = await service.ingest([duplicateEvent]);
    const duplicate = await service.ingest([duplicateEvent]);
    expect(first).toEqual([{
      event_id: "event-ready",
      status: "APPLIED",
      reason_codes: ["event_applied"]
    }]);
    expect(duplicate[0]?.status).toBe("DUPLICATE");
    await expect(service.getTask(task.business_task_id)).resolves.toMatchObject({
      state: "READY",
      version: 2,
      projection_complete: true
    });
  });

  it("holds out-of-order events until the exact gap is filled", async () => {
    const { service } = await fixture();
    const task = await service.createTask({
      tenant_id: "tenant-1",
      owner_principal_id: "principal-1",
      profile_release_id: "profile-1"
    });
    const started = event({
      id: "event-started",
      type: "pc.task.started",
      streamKind: "TASK",
      streamId: task.business_task_id,
      streamSequence: 3,
      aggregateRevision: 3,
      taskId: task.business_task_id
    });
    expect((await service.ingest([started]))[0]).toMatchObject({
      status: "PENDING",
      reason_codes: ["gap_expected:2", "gap_received:3"]
    });
    await expect(service.getTask(task.business_task_id)).resolves.toMatchObject({
      state: "DRAFT",
      version: 1,
      projection_complete: false
    });
    const ready = event({
      id: "event-ready",
      type: "pc.task.ready",
      streamKind: "TASK",
      streamId: task.business_task_id,
      streamSequence: 2,
      aggregateRevision: 2,
      taskId: task.business_task_id
    });
    await service.ingest([ready]);
    await expect(service.getTask(task.business_task_id)).resolves.toMatchObject({
      state: "RUNNING",
      version: 3,
      projection_complete: true,
      last_event_id: "event-started"
    });
    await expect(service.getCursor({
      producer: "pc-control-plane",
      stream_kind: "TASK",
      stream_id: task.business_task_id
    })).resolves.toMatchObject({
      last_sequence: 3,
      expected_next_sequence: 4,
      state: "COMPLETE"
    });
  });

  it("quarantines reused stream sequences and stale Runtime authority", async () => {
    const authority: EventAuthorityPort = {
      evaluate: (envelope) => Promise.resolve({
        allowed: envelope.fencing_token === "current-fence",
        code: "PC_RUNTIME_FENCE_STALE",
        reason: "stale fence"
      })
    };
    const { service } = await fixture(authority);
    const first = event({
      id: "runtime-event-1",
      type: "dsh.turn/start",
      streamKind: "SESSION",
      streamId: "session-1",
      streamSequence: 1,
      producer: "pc-runtime-bridge",
      runtimeId: "runtime-1",
      runtimeEpoch: 1,
      assignmentGeneration: 1,
      fencingToken: "current-fence"
    });
    await expect(service.ingest([first])).resolves.toMatchObject([
      { status: "APPLIED" }
    ]);
    const conflict = {
      ...first,
      event_id: "runtime-event-conflict",
      payload: { different: true },
      payload_digest: digest({ different: true })
    };
    await expect(service.ingest([conflict])).resolves.toMatchObject([
      {
        status: "QUARANTINED",
        reason_codes: ["stream_sequence_conflict"]
      }
    ]);
    const stale = event({
      id: "runtime-event-stale",
      type: "dsh.turn/end",
      streamKind: "SESSION",
      streamId: "session-1",
      streamSequence: 2,
      producer: "pc-runtime-bridge",
      runtimeId: "runtime-1",
      runtimeEpoch: 1,
      assignmentGeneration: 1,
      fencingToken: "old-fence"
    });
    await expect(service.ingest([stale])).resolves.toMatchObject([
      {
        status: "STALE",
        reason_codes: ["PC_RUNTIME_FENCE_STALE"]
      }
    ]);
  });

  it("keeps provider success separate from verified business success", async () => {
    const { service } = await fixture();
    const task = await service.createTask({
      tenant_id: "tenant-1",
      owner_principal_id: "principal-1",
      profile_release_id: "profile-1"
    });
    await service.transitionTask({
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "READY"
    });
    await service.transitionTask({
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "RUNNING"
    });
    const operation = await service.planOperation({
      operation_id: "operation-1",
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      operation_kind: "WRITE",
      recovery_class: "RECONCILE_BEFORE_RETRY",
      input_digest: `sha256:${"1".repeat(64)}`
    });
    await service.transitionOperation({
      operation_id: operation.operation_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "DISPATCHING"
    });
    await service.transitionOperation({
      operation_id: operation.operation_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "DISPATCHED"
    });
    await service.transitionOperation({
      operation_id: operation.operation_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "VERIFYING",
      result_digest: `sha256:${"2".repeat(64)}`
    });
    await expect(service.getOperation(operation.operation_id))
      .resolves.toMatchObject({ state: "VERIFYING" });
    await service.transitionOperation({
      operation_id: operation.operation_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "SUCCEEDED",
      evidence_refs: ["readback:operation-1"]
    });
    await expect(service.getOperation(operation.operation_id))
      .resolves.toMatchObject({
        state: "SUCCEEDED",
        evidence_refs: ["readback:operation-1"]
      });
  });

  it("rebuilds Task and Operation projections without invoking Runtime work", async () => {
    const { service } = await fixture();
    const task = await service.createTask({
      tenant_id: "tenant-1",
      owner_principal_id: "principal-1",
      profile_release_id: "profile-1"
    });
    await service.transitionTask({
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "READY"
    });
    await service.planOperation({
      operation_id: "operation-rebuild",
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      operation_kind: "READ",
      recovery_class: "REPLAY_SAFE",
      input_digest: `sha256:${"3".repeat(64)}`
    });
    await service.ingest([event({
      id: "event-technical-rebuild",
      type: "dsh.turn/end",
      streamKind: "SESSION",
      streamId: "session-rebuild",
      streamSequence: 1,
      taskId: task.business_task_id,
      producer: "pc-runtime-bridge"
    })]);
    const rebuilt = await service.rebuildTask(task.business_task_id);
    expect(rebuilt.digest_matches).toBe(true);
    expect(rebuilt).toMatchObject({
      task: { state: "READY", version: 2 },
      operations: [{ operation_id: "operation-rebuild", state: "PLANNED" }],
      checkpoint: {
        projector_name: "pc-business-state",
        source_event_count: 4
      }
    });
  });

  it("classifies Outcome Unknown and records reconciliation before recovery", async () => {
    const gateway: RecoveryGatewayPort = {
      getOperation: () => Promise.resolve({
        operation_id: "operation-unknown",
        outcome_state: "OUTCOME_UNKNOWN",
        recovery_class: "RECONCILE_BEFORE_RETRY",
        provider_operation_id: "provider-operation-unknown"
      }),
      reconcile: () => Promise.resolve({
        outcome_state: "KNOWN_SUCCESS",
        provider_operation_id: "provider-operation-unknown",
        external_evidence_refs: ["provider:readback"]
      })
    };
    const { service } = await fixture(undefined, gateway);
    const task = await service.createTask({
      tenant_id: "tenant-1",
      owner_principal_id: "principal-1",
      profile_release_id: "profile-1"
    });
    await service.transitionTask({
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "READY"
    });
    await service.transitionTask({
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "RUNNING"
    });
    const operation = await service.planOperation({
      operation_id: "operation-unknown",
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      operation_kind: "WRITE",
      recovery_class: "RECONCILE_BEFORE_RETRY",
      input_digest: `sha256:${"4".repeat(64)}`
    });
    await service.transitionOperation({
      operation_id: operation.operation_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "DISPATCHING"
    });
    await service.transitionOperation({
      operation_id: operation.operation_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "OUTCOME_UNKNOWN"
    });
    const recovery = await service.openRecoveryCase({
      tenant_id: "tenant-1",
      owner_principal_id: "principal-1",
      business_task_id: task.business_task_id,
      trigger: "OUTCOME_UNKNOWN",
      affected_operation_ids: [operation.operation_id]
    });
    expect(recovery).toMatchObject({
      state: "RECOVERY_PENDING",
      decision: {
        classification: "RECONCILE_BEFORE_RETRY",
        action: "RECONCILE"
      }
    });
    const result = await service.reconcileRecoveryCase({
      recovery_case_id: recovery.recovery_case_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1"
    });
    expect(result).toMatchObject({
      recovery_case: { state: "RECOVERED" },
      results: [{
        resolved_outcome_state: "KNOWN_SUCCESS",
        action: "RECORD_SUCCESS"
      }]
    });
    await expect(service.getOperation(operation.operation_id))
      .resolves.toMatchObject({ state: "SUCCEEDED" });
    await expect(service.getTask(task.business_task_id))
      .resolves.toMatchObject({ state: "RUNNING" });
  });

  it("keeps approval waiting durable and migrates Runtime authority", async () => {
    const migrations: Parameters<RecoveryRuntimePort["migrate"]>[0][] = [];
    const runtime: RecoveryRuntimePort = {
      migrate: (input) => {
        migrations.push(input);
        return Promise.resolve({
          assignment_id: "assignment-recovered",
          runtime_id: input.target_runtime_id,
          runtime_epoch: input.target_runtime_epoch,
          assignment_generation: 2,
          fencing_token: "fence-recovered"
        });
      }
    };
    const { service } = await fixture(undefined, undefined, runtime);
    const task = await service.createTask({
      tenant_id: "tenant-1",
      owner_principal_id: "principal-1",
      profile_release_id: "profile-1",
      source_session_ids: ["session-recovery"]
    });
    await service.transitionTask({
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "READY"
    });
    await service.transitionTask({
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "RUNNING"
    });
    const approvalWait = await service.openRecoveryCase({
      tenant_id: "tenant-1",
      owner_principal_id: "principal-1",
      business_task_id: task.business_task_id,
      trigger: "APPROVAL_WAIT"
    });
    expect(approvalWait).toMatchObject({
      state: "WAITING_APPROVAL",
      decision: { action: "WAIT_FOR_APPROVAL" }
    });
    await expect(service.getTask(task.business_task_id))
      .resolves.toMatchObject({ state: "WAITING_APPROVAL" });
    await service.transitionTask({
      business_task_id: task.business_task_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      state: "RUNNING"
    });

    const runtimeLoss = await service.openRecoveryCase({
      tenant_id: "tenant-1",
      owner_principal_id: "principal-1",
      business_task_id: task.business_task_id,
      trigger: "RUNTIME_LOST",
      affected_runtime_id: "runtime-old",
      affected_session_id: "session-recovery"
    });
    await expect(service.getTask(task.business_task_id))
      .resolves.toMatchObject({ state: "RECOVERING" });
    const migrated = await service.migrateRecoveryCase({
      recovery_case_id: runtimeLoss.recovery_case_id,
      tenant_id: "tenant-1",
      principal_id: "principal-1",
      target_runtime_id: "runtime-new",
      target_runtime_epoch: 2,
      effective_profile_snapshot_id: "profile-snapshot-2",
      workspace_view_snapshot_id: "workspace-view-2",
      authorization_revision: 2,
      lease_duration_ms: 60_000
    });
    expect(migrated).toMatchObject({
      state: "RECOVERED",
      current_assignment: {
        runtime_id: "runtime-new",
        runtime_epoch: 2,
        assignment_generation: 2,
        fencing_token: "fence-recovered"
      }
    });
    expect(migrations).toMatchObject([{
      old_runtime_id: "runtime-old",
      pc_session_id: "session-recovery",
      target_runtime_id: "runtime-new",
      target_runtime_epoch: 2
    }]);
    await expect(service.getTask(task.business_task_id))
      .resolves.toMatchObject({ state: "RUNNING" });
  });
});
