import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EventProjectionService,
  type EventEnvelope,
  type RecoveryGatewayPort
} from "@pc/event-projection";
import { PostgresEventProjectionRepository } from "../src/index.js";

const databaseUrl = process.env.PC_TEST_POSTGRES_URL;
const NOW = new Date("2026-11-10T15:00:00.000Z");

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

function taskEvent(input: {
  suffix: string;
  eventId: string;
  eventType: string;
  taskId: string;
  streamSequence: number;
  aggregateRevision: number;
}): EventEnvelope {
  const payload = {};
  return {
    contract_name: "pc.event-envelope/1",
    contract_version: 1,
    event_id: `${input.eventId}-${input.suffix}`,
    event_type: input.eventType,
    event_schema_version: 1,
    producer: "pc-control-plane",
    producer_version: "1.0.0",
    tenant_id: `tenant-${input.suffix}`,
    principal_id: `principal-${input.suffix}`,
    stream_kind: "TASK",
    stream_id: input.taskId,
    stream_sequence: input.streamSequence,
    aggregate_revision: input.aggregateRevision,
    business_task_id: input.taskId,
    durability: "DURABLE_PC",
    occurred_at: NOW.toISOString(),
    observed_at: NOW.toISOString(),
    payload,
    payload_digest: digest(payload)
  };
}

describe.skipIf(databaseUrl === undefined)(
  "Postgres Event Projection recovery",
  () => {
    it("restores Inbox, Cursor, projections, checkpoints and RecoveryCases", async () => {
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const tenantId = `tenant-${suffix}`;
      const principalId = `principal-${suffix}`;
      let taskId = "";

      const firstRepository = new PostgresEventProjectionRepository(
        databaseUrl as string
      );
      const first = new EventProjectionService(
        firstRepository,
        undefined,
        undefined,
        undefined,
        undefined,
        () => new Date(NOW)
      );
      await first.initialize();
      try {
        const task = await first.createTask({
          tenant_id: tenantId,
          owner_principal_id: principalId,
          profile_release_id: `profile-${suffix}`,
          source_session_ids: [`session-${suffix}`]
        });
        taskId = task.business_task_id;
        const future = taskEvent({
          suffix,
          eventId: "event-started",
          eventType: "pc.task.started",
          taskId,
          streamSequence: 3,
          aggregateRevision: 3
        });
        await expect(first.ingest([future])).resolves.toMatchObject([
          { status: "PENDING" }
        ]);
        await expect(first.getTask(taskId)).resolves.toMatchObject({
          state: "DRAFT",
          projection_complete: false
        });
      } finally {
        await first.close();
      }

      const gateway: RecoveryGatewayPort = {
        getOperation: (operationId) => Promise.resolve({
          operation_id: operationId,
          outcome_state: "OUTCOME_UNKNOWN",
          recovery_class: "RECONCILE_BEFORE_RETRY",
          provider_operation_id: `provider-${suffix}`
        }),
        reconcile: () => Promise.resolve({
          outcome_state: "KNOWN_SUCCESS",
          provider_operation_id: `provider-${suffix}`,
          external_evidence_refs: [`readback-${suffix}`]
        })
      };
      const secondRepository = new PostgresEventProjectionRepository(
        databaseUrl as string
      );
      const second = new EventProjectionService(
        secondRepository,
        undefined,
        undefined,
        gateway,
        undefined,
        () => new Date(NOW)
      );
      let operationId = "";
      let recoveryCaseId = "";
      await second.initialize();
      try {
        await expect(second.getCursor({
          producer: "pc-control-plane",
          stream_kind: "TASK",
          stream_id: taskId
        })).resolves.toMatchObject({
          state: "GAP",
          last_sequence: 1,
          expected_next_sequence: 2
        });
        const ready = taskEvent({
          suffix,
          eventId: "event-ready",
          eventType: "pc.task.ready",
          taskId,
          streamSequence: 2,
          aggregateRevision: 2
        });
        await second.ingest([ready]);
        await expect(second.getTask(taskId)).resolves.toMatchObject({
          state: "RUNNING",
          version: 3,
          projection_complete: true
        });

        operationId = `operation-${suffix}`;
        await second.planOperation({
          operation_id: operationId,
          business_task_id: taskId,
          tenant_id: tenantId,
          principal_id: principalId,
          operation_kind: "WRITE",
          recovery_class: "RECONCILE_BEFORE_RETRY",
          input_digest: digest({ operationId })
        });
        await second.transitionOperation({
          operation_id: operationId,
          tenant_id: tenantId,
          principal_id: principalId,
          state: "DISPATCHING"
        });
        await second.transitionOperation({
          operation_id: operationId,
          tenant_id: tenantId,
          principal_id: principalId,
          state: "OUTCOME_UNKNOWN"
        });
        const recovery = await second.openRecoveryCase({
          tenant_id: tenantId,
          owner_principal_id: principalId,
          business_task_id: taskId,
          trigger: "OUTCOME_UNKNOWN",
          affected_operation_ids: [operationId],
          affected_runtime_id: `runtime-${suffix}`,
          affected_session_id: `session-${suffix}`
        });
        recoveryCaseId = recovery.recovery_case_id;
        const reconciled = await second.reconcileRecoveryCase({
          recovery_case_id: recoveryCaseId,
          tenant_id: tenantId,
          principal_id: principalId
        });
        expect(reconciled.recovery_case.state).toBe("RECOVERED");
        const rebuilt = await second.rebuildTask(taskId);
        expect(rebuilt.digest_matches).toBe(true);
        expect(rebuilt.checkpoint.source_event_count).toBeGreaterThanOrEqual(7);
      } finally {
        await second.close();
      }

      const restartedRepository = new PostgresEventProjectionRepository(
        databaseUrl as string
      );
      const restarted = new EventProjectionService(
        restartedRepository,
        undefined,
        undefined,
        undefined,
        undefined,
        () => new Date(NOW)
      );
      await restarted.initialize();
      try {
        await expect(restarted.getTask(taskId)).resolves.toMatchObject({
          state: "RUNNING",
          projection_complete: true
        });
        await expect(restarted.getOperation(operationId)).resolves.toMatchObject({
          state: "SUCCEEDED",
          evidence_refs: [`readback-${suffix}`]
        });
        await expect(restarted.getRecoveryCase(recoveryCaseId))
          .resolves.toMatchObject({
            state: "RECOVERED",
            affected_operation_ids: [operationId]
          });
        await expect(restartedRepository.getCheckpoint(taskId))
          .resolves.toMatchObject({
            projector_name: "pc-business-state",
            business_task_id: taskId
          });
        await expect(restartedRepository.getReconciliationResult(operationId))
          .resolves.toMatchObject({
            resolved_outcome_state: "KNOWN_SUCCESS",
            action: "RECORD_SUCCESS"
          });
        await expect(restartedRepository.getInboxRecord(
          "pc-control-plane",
          `event-started-${suffix}`
        )).resolves.toMatchObject({
          status: "APPLIED"
        });
      } finally {
        await restarted.close();
      }
    });
  }
);
