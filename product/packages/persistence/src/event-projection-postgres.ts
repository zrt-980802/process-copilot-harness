import { randomUUID } from "node:crypto";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow
} from "pg";
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

const MIGRATION = `
CREATE TABLE IF NOT EXISTS pc_event_inbox (
  inbox_id TEXT NOT NULL,
  producer TEXT NOT NULL,
  event_id TEXT NOT NULL,
  stream_kind TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  stream_sequence BIGINT NOT NULL,
  business_task_id TEXT,
  operation_id TEXT,
  status TEXT NOT NULL,
  reason_codes JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  PRIMARY KEY (producer, event_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS pc_event_inbox_stream_sequence_active
  ON pc_event_inbox(producer, stream_kind, stream_id, stream_sequence)
  WHERE status <> 'QUARANTINED';

CREATE INDEX IF NOT EXISTS pc_event_inbox_stream
  ON pc_event_inbox(producer, stream_kind, stream_id, stream_sequence);

CREATE INDEX IF NOT EXISTS pc_event_inbox_task
  ON pc_event_inbox(business_task_id, received_at);

CREATE TABLE IF NOT EXISTS pc_event_cursor (
  producer TEXT NOT NULL,
  stream_kind TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  last_sequence BIGINT NOT NULL,
  state TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (producer, stream_kind, stream_id)
);

CREATE TABLE IF NOT EXISTS pc_business_task_projection (
  business_task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  version BIGINT NOT NULL,
  state TEXT NOT NULL,
  projection_complete BOOLEAN NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_business_task_projection_owner
  ON pc_business_task_projection(tenant_id, owner_principal_id);

CREATE TABLE IF NOT EXISTS pc_business_operation_projection (
  operation_id TEXT PRIMARY KEY,
  business_task_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  version BIGINT NOT NULL,
  state TEXT NOT NULL,
  projection_complete BOOLEAN NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_business_operation_projection_task
  ON pc_business_operation_projection(business_task_id, operation_id);

CREATE TABLE IF NOT EXISTS pc_projection_checkpoint (
  business_task_id TEXT PRIMARY KEY,
  checkpoint_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS pc_recovery_case (
  recovery_case_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  state TEXT NOT NULL,
  version BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_recovery_case_owner
  ON pc_recovery_case(tenant_id, owner_principal_id, created_at);

CREATE TABLE IF NOT EXISTS pc_reconciliation_result (
  operation_id TEXT PRIMARY KEY,
  reconciled_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
`;

interface InboxRow extends QueryResultRow {
  inbox_id: string;
  status: InboxStatus;
  reason_codes: string[];
  received_at: Date | string;
  applied_at: Date | string | null;
  payload: EventEnvelope;
}

interface PayloadRow<T> extends QueryResultRow {
  payload: T;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function inboxFromRow(row: InboxRow): EventInboxRecord {
  return {
    inbox_id: row.inbox_id,
    envelope: row.payload,
    status: row.status,
    reason_codes: row.reason_codes,
    received_at: iso(row.received_at),
    ...(row.applied_at === null ? {} : { applied_at: iso(row.applied_at) })
  };
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresEventProjectionRepository
implements EventProjectionRepository {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(config: string | PoolConfig | Pool) {
    if (config instanceof Pool) {
      this.pool = config;
      this.ownsPool = false;
    } else {
      this.pool = new Pool(
        typeof config === "string" ? { connectionString: config } : config
      );
      this.ownsPool = true;
    }
  }

  async initialize(): Promise<void> {
    await this.pool.query(MIGRATION);
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }

  receiveEvent(
    envelope: EventEnvelope,
    receivedAt: string
  ): Promise<EventReceiveResult> {
    return transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${envelope.producer}:${envelope.stream_kind}:${envelope.stream_id}`]
      );
      const existing = await client.query<InboxRow & { same_payload: boolean }>(
        `SELECT *, payload = $3::jsonb AS same_payload
         FROM pc_event_inbox
         WHERE producer = $1 AND event_id = $2`,
        [envelope.producer, envelope.event_id, JSON.stringify(envelope)]
      );
      const current = existing.rows[0];
      if (current !== undefined) {
        if (!current.same_payload) {
          throw new EventProjectionError(
            "PC_EVENT_ID_CONFLICT",
            "Producer reused event_id with different immutable content"
          );
        }
        return {
          record: inboxFromRow(current),
          duplicate: true,
          sequence_conflict: false
        };
      }
      const sequence = await client.query<{ event_id: string }>(
        `SELECT event_id FROM pc_event_inbox
         WHERE producer = $1
           AND stream_kind = $2
           AND stream_id = $3
           AND stream_sequence = $4
           AND status <> 'QUARANTINED'
         LIMIT 1`,
        [
          envelope.producer,
          envelope.stream_kind,
          envelope.stream_id,
          envelope.stream_sequence
        ]
      );
      const sequenceConflict = sequence.rows[0] !== undefined;
      const status: InboxStatus = sequenceConflict
        ? "QUARANTINED"
        : "PENDING";
      const reasonCodes = sequenceConflict
        ? ["stream_sequence_conflict"]
        : [];
      const inserted = await client.query<InboxRow>(
        `INSERT INTO pc_event_inbox (
           inbox_id, producer, event_id, stream_kind, stream_id,
           stream_sequence, business_task_id, operation_id, status,
           reason_codes, received_at, payload
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
         )
         RETURNING *`,
        [
          `inbox_${randomUUID()}`,
          envelope.producer,
          envelope.event_id,
          envelope.stream_kind,
          envelope.stream_id,
          envelope.stream_sequence,
          envelope.business_task_id ?? null,
          envelope.operation_id ?? null,
          status,
          JSON.stringify(reasonCodes),
          receivedAt,
          JSON.stringify(envelope)
        ]
      );
      return {
        record: inboxFromRow(inserted.rows[0] as InboxRow),
        duplicate: false,
        sequence_conflict: sequenceConflict
      };
    });
  }

  async getInboxRecord(
    producer: string,
    eventId: string
  ): Promise<EventInboxRecord | undefined> {
    const result = await this.pool.query<InboxRow>(
      `SELECT * FROM pc_event_inbox
       WHERE producer = $1 AND event_id = $2`,
      [producer, eventId]
    );
    return result.rows[0] === undefined
      ? undefined
      : inboxFromRow(result.rows[0]);
  }

  async listStreamEvents(input: {
    producer: string;
    stream_kind: EventEnvelope["stream_kind"];
    stream_id: string;
    statuses?: InboxStatus[];
  }): Promise<EventInboxRecord[]> {
    const result = await this.pool.query<InboxRow>(
      `SELECT * FROM pc_event_inbox
       WHERE producer = $1
         AND stream_kind = $2
         AND stream_id = $3
         AND ($4::text[] IS NULL OR status = ANY($4::text[]))
       ORDER BY stream_sequence, event_id`,
      [
        input.producer,
        input.stream_kind,
        input.stream_id,
        input.statuses ?? null
      ]
    );
    return result.rows.map(inboxFromRow);
  }

  async listTaskEvents(
    businessTaskId: string,
    statuses?: InboxStatus[]
  ): Promise<EventInboxRecord[]> {
    const result = await this.pool.query<InboxRow>(
      `SELECT * FROM pc_event_inbox
       WHERE business_task_id = $1
         AND ($2::text[] IS NULL OR status = ANY($2::text[]))
       ORDER BY received_at, event_id`,
      [businessTaskId, statuses ?? null]
    );
    return result.rows.map(inboxFromRow);
  }

  async getCursor(input: {
    producer: string;
    stream_kind: EventEnvelope["stream_kind"];
    stream_id: string;
  }): Promise<EventCursor | undefined> {
    const result = await this.pool.query<PayloadRow<EventCursor>>(
      `SELECT payload FROM pc_event_cursor
       WHERE producer = $1 AND stream_kind = $2 AND stream_id = $3`,
      [input.producer, input.stream_kind, input.stream_id]
    );
    return result.rows[0]?.payload;
  }

  async saveCursor(cursor: EventCursor): Promise<void> {
    await this.pool.query(
      `INSERT INTO pc_event_cursor (
         producer, stream_kind, stream_id, last_sequence, state, payload
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (producer, stream_kind, stream_id)
       DO UPDATE SET
         last_sequence = EXCLUDED.last_sequence,
         state = EXCLUDED.state,
         payload = EXCLUDED.payload
       WHERE EXCLUDED.last_sequence >= pc_event_cursor.last_sequence`,
      [
        cursor.producer,
        cursor.stream_kind,
        cursor.stream_id,
        cursor.last_sequence,
        cursor.state,
        JSON.stringify(cursor)
      ]
    );
  }

  async markEvent(input: {
    producer: string;
    event_id: string;
    expected_status: InboxStatus;
    status: InboxStatus;
    reason_codes: string[];
    applied_at?: string;
  }): Promise<EventInboxRecord> {
    const result = await this.pool.query<InboxRow>(
      `UPDATE pc_event_inbox
       SET status = $4,
           reason_codes = $5,
           applied_at = $6
       WHERE producer = $1 AND event_id = $2 AND status = $3
       RETURNING *`,
      [
        input.producer,
        input.event_id,
        input.expected_status,
        input.status,
        JSON.stringify(input.reason_codes),
        input.applied_at ?? null
      ]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new EventProjectionError(
        "PC_EVENT_INBOX_CAS_CONFLICT",
        "Event Inbox status changed",
        true
      );
    }
    return inboxFromRow(row);
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
    return transaction(this.pool, async (client) => {
      const inbox = await client.query<InboxRow>(
        `SELECT * FROM pc_event_inbox
         WHERE producer = $1 AND event_id = $2
         FOR UPDATE`,
        [input.producer, input.event_id]
      );
      if (inbox.rows[0]?.status !== "PENDING") {
        throw new EventProjectionError(
          "PC_EVENT_INBOX_CAS_CONFLICT",
          "Event Inbox status changed",
          true
        );
      }
      if (input.task !== undefined) {
        await this.upsertTask(
          client,
          input.task,
          input.expected_task_version
        );
      }
      if (input.operation !== undefined) {
        await this.upsertOperation(
          client,
          input.operation,
          input.expected_operation_version
        );
      }
      if (input.recovery_case !== undefined) {
        await client.query(
          `INSERT INTO pc_recovery_case (
             recovery_case_id, tenant_id, owner_principal_id, state,
             version, created_at, payload
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (recovery_case_id) DO NOTHING`,
          [
            input.recovery_case.recovery_case_id,
            input.recovery_case.tenant_id,
            input.recovery_case.owner_principal_id,
            input.recovery_case.state,
            input.recovery_case.version,
            input.recovery_case.created_at,
            JSON.stringify(input.recovery_case)
          ]
        );
      }
      await client.query(
        `INSERT INTO pc_event_cursor (
           producer, stream_kind, stream_id, last_sequence, state, payload
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (producer, stream_kind, stream_id)
         DO UPDATE SET
           last_sequence = EXCLUDED.last_sequence,
           state = EXCLUDED.state,
           payload = EXCLUDED.payload`,
        [
          input.cursor.producer,
          input.cursor.stream_kind,
          input.cursor.stream_id,
          input.cursor.last_sequence,
          input.cursor.state,
          JSON.stringify(input.cursor)
        ]
      );
      await client.query(
        `UPDATE pc_event_inbox
         SET status = 'APPLIED',
             reason_codes = '["event_applied"]'::jsonb,
             applied_at = $3
         WHERE producer = $1 AND event_id = $2`,
        [input.producer, input.event_id, input.applied_at]
      );
    });
  }

  async setTaskProjectionCompleteness(
    task: BusinessTask,
    expectedVersion: number
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE pc_business_task_projection
       SET projection_complete = $3, payload = $4
       WHERE business_task_id = $1 AND version = $2`,
      [
        task.business_task_id,
        expectedVersion,
        task.projection_complete,
        JSON.stringify(task)
      ]
    );
    if (result.rowCount !== 1) {
      throw new EventProjectionError(
        "PC_EVENT_PROJECTION_CAS_CONFLICT",
        "BusinessTask version changed",
        true
      );
    }
  }

  async getTask(
    businessTaskId: string
  ): Promise<BusinessTask | undefined> {
    const result = await this.pool.query<PayloadRow<BusinessTask>>(
      `SELECT payload FROM pc_business_task_projection
       WHERE business_task_id = $1`,
      [businessTaskId]
    );
    return result.rows[0]?.payload;
  }

  async listTasks(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<BusinessTask[]> {
    const result = await this.pool.query<PayloadRow<BusinessTask>>(
      `SELECT payload FROM pc_business_task_projection
       WHERE tenant_id = $1 AND owner_principal_id = $2
       ORDER BY payload->>'created_at', business_task_id`,
      [tenantId, ownerPrincipalId]
    );
    return result.rows.map((row) => row.payload);
  }

  async getOperation(
    operationId: string
  ): Promise<BusinessOperation | undefined> {
    const result = await this.pool.query<PayloadRow<BusinessOperation>>(
      `SELECT payload FROM pc_business_operation_projection
       WHERE operation_id = $1`,
      [operationId]
    );
    return result.rows[0]?.payload;
  }

  async listTaskOperations(
    businessTaskId: string
  ): Promise<BusinessOperation[]> {
    const result = await this.pool.query<PayloadRow<BusinessOperation>>(
      `SELECT payload FROM pc_business_operation_projection
       WHERE business_task_id = $1
       ORDER BY operation_id`,
      [businessTaskId]
    );
    return result.rows.map((row) => row.payload);
  }

  replaceTaskProjection(input: {
    task: BusinessTask;
    operations: BusinessOperation[];
    checkpoint: ProjectionCheckpoint;
  }): Promise<void> {
    return transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [input.task.business_task_id]
      );
      await client.query(
        `INSERT INTO pc_business_task_projection (
           business_task_id, tenant_id, owner_principal_id, version,
           state, projection_complete, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (business_task_id)
         DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           owner_principal_id = EXCLUDED.owner_principal_id,
           version = EXCLUDED.version,
           state = EXCLUDED.state,
           projection_complete = EXCLUDED.projection_complete,
           payload = EXCLUDED.payload`,
        [
          input.task.business_task_id,
          input.task.tenant_id,
          input.task.owner_principal_id,
          input.task.version,
          input.task.state,
          input.task.projection_complete,
          JSON.stringify(input.task)
        ]
      );
      await client.query(
        `DELETE FROM pc_business_operation_projection
         WHERE business_task_id = $1`,
        [input.task.business_task_id]
      );
      for (const operation of input.operations) {
        await this.upsertOperation(client, operation, undefined);
      }
      await client.query(
        `INSERT INTO pc_projection_checkpoint (
           business_task_id, checkpoint_id, created_at, payload
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (business_task_id)
         DO UPDATE SET
           checkpoint_id = EXCLUDED.checkpoint_id,
           created_at = EXCLUDED.created_at,
           payload = EXCLUDED.payload`,
        [
          input.checkpoint.business_task_id,
          input.checkpoint.checkpoint_id,
          input.checkpoint.created_at,
          JSON.stringify(input.checkpoint)
        ]
      );
    });
  }

  async getCheckpoint(
    businessTaskId: string
  ): Promise<ProjectionCheckpoint | undefined> {
    const result = await this.pool.query<PayloadRow<ProjectionCheckpoint>>(
      `SELECT payload FROM pc_projection_checkpoint
       WHERE business_task_id = $1`,
      [businessTaskId]
    );
    return result.rows[0]?.payload;
  }

  async saveRecoveryCase(recoveryCase: RecoveryCase): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_recovery_case (
           recovery_case_id, tenant_id, owner_principal_id, state,
           version, created_at, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          recoveryCase.recovery_case_id,
          recoveryCase.tenant_id,
          recoveryCase.owner_principal_id,
          recoveryCase.state,
          recoveryCase.version,
          recoveryCase.created_at,
          JSON.stringify(recoveryCase)
        ]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new EventProjectionError(
          "PC_RECOVERY_CASE_CONFLICT",
          "RecoveryCase ID already exists"
        );
      }
      throw error;
    }
  }

  async getRecoveryCase(
    recoveryCaseId: string
  ): Promise<RecoveryCase | undefined> {
    const result = await this.pool.query<PayloadRow<RecoveryCase>>(
      "SELECT payload FROM pc_recovery_case WHERE recovery_case_id = $1",
      [recoveryCaseId]
    );
    return result.rows[0]?.payload;
  }

  async updateRecoveryCase(
    recoveryCase: RecoveryCase,
    expectedVersion: number
  ): Promise<RecoveryCase> {
    const result = await this.pool.query(
      `UPDATE pc_recovery_case
       SET state = $3, version = $4, payload = $5
       WHERE recovery_case_id = $1 AND version = $2`,
      [
        recoveryCase.recovery_case_id,
        expectedVersion,
        recoveryCase.state,
        recoveryCase.version,
        JSON.stringify(recoveryCase)
      ]
    );
    if (result.rowCount !== 1) {
      throw new EventProjectionError(
        "PC_RECOVERY_CASE_CAS_CONFLICT",
        "RecoveryCase version changed",
        true
      );
    }
    return recoveryCase;
  }

  async listRecoveryCases(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<RecoveryCase[]> {
    const result = await this.pool.query<PayloadRow<RecoveryCase>>(
      `SELECT payload FROM pc_recovery_case
       WHERE tenant_id = $1 AND owner_principal_id = $2
       ORDER BY created_at, recovery_case_id`,
      [tenantId, ownerPrincipalId]
    );
    return result.rows.map((row) => row.payload);
  }

  async saveReconciliationResult(
    result: ReconciliationResult
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO pc_reconciliation_result (
         operation_id, reconciled_at, payload
       ) VALUES ($1, $2, $3)
       ON CONFLICT (operation_id)
       DO UPDATE SET
         reconciled_at = EXCLUDED.reconciled_at,
         payload = EXCLUDED.payload`,
      [result.operation_id, result.reconciled_at, JSON.stringify(result)]
    );
  }

  async getReconciliationResult(
    operationId: string
  ): Promise<ReconciliationResult | undefined> {
    const result = await this.pool.query<PayloadRow<ReconciliationResult>>(
      `SELECT payload FROM pc_reconciliation_result
       WHERE operation_id = $1`,
      [operationId]
    );
    return result.rows[0]?.payload;
  }

  private async upsertTask(
    client: PoolClient,
    task: BusinessTask,
    expectedVersion: number | undefined
  ): Promise<void> {
    if (expectedVersion === undefined) {
      try {
        await client.query(
          `INSERT INTO pc_business_task_projection (
             business_task_id, tenant_id, owner_principal_id, version,
             state, projection_complete, payload
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            task.business_task_id,
            task.tenant_id,
            task.owner_principal_id,
            task.version,
            task.state,
            task.projection_complete,
            JSON.stringify(task)
          ]
        );
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
      }
    } else {
      const updated = await client.query(
        `UPDATE pc_business_task_projection
         SET version = $3,
             state = $4,
             projection_complete = $5,
             payload = $6
         WHERE business_task_id = $1 AND version = $2`,
        [
          task.business_task_id,
          expectedVersion,
          task.version,
          task.state,
          task.projection_complete,
          JSON.stringify(task)
        ]
      );
      if (updated.rowCount === 1) return;
    }
    throw new EventProjectionError(
      "PC_EVENT_PROJECTION_CAS_CONFLICT",
      "BusinessTask version changed",
      true
    );
  }

  private async upsertOperation(
    client: PoolClient,
    operation: BusinessOperation,
    expectedVersion: number | undefined
  ): Promise<void> {
    if (expectedVersion === undefined) {
      try {
        await client.query(
          `INSERT INTO pc_business_operation_projection (
             operation_id, business_task_id, tenant_id, owner_principal_id,
             version, state, projection_complete, payload
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            operation.operation_id,
            operation.business_task_id,
            operation.tenant_id,
            operation.owner_principal_id,
            operation.version,
            operation.state,
            operation.projection_complete,
            JSON.stringify(operation)
          ]
        );
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
      }
    } else {
      const updated = await client.query(
        `UPDATE pc_business_operation_projection
         SET version = $3,
             state = $4,
             projection_complete = $5,
             payload = $6
         WHERE operation_id = $1 AND version = $2`,
        [
          operation.operation_id,
          expectedVersion,
          operation.version,
          operation.state,
          operation.projection_complete,
          JSON.stringify(operation)
        ]
      );
      if (updated.rowCount === 1) return;
    }
    throw new EventProjectionError(
      "PC_EVENT_PROJECTION_CAS_CONFLICT",
      "BusinessOperation version changed",
      true
    );
  }
}
