import { randomUUID } from "node:crypto";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow
} from "pg";
import type {
  CreateAssignmentInput,
  RegisterRuntimeInput,
  RenewAssignmentInput,
  RuntimeRegistryRepository,
  TransitionAssignmentInput
} from "@pc/application";
import type {
  AssignmentAuthorityState,
  RuntimeCapabilityManifest,
  RuntimeHealthReport,
  RuntimeRecord,
  RuntimeRegistryState,
  SessionAssignment
} from "@pc/domain";
import { RuntimeRegistryError } from "@pc/domain";

const TERMINAL_ASSIGNMENT_STATES = new Set<AssignmentAuthorityState>([
  "RELEASED",
  "EXPIRED",
  "REJECTED"
]);

const RUNTIME_TRANSITIONS: Record<RuntimeRegistryState, RuntimeRegistryState[]> = {
  PROVISIONING: ["STARTING", "FAILED", "TERMINATED"],
  STARTING: ["READY", "FAILED", "TERMINATED"],
  READY: ["IDLE", "ACTIVE", "DRAINING", "FAILED", "LOST", "TERMINATED"],
  IDLE: ["READY", "ACTIVE", "DRAINING", "FAILED", "LOST", "TERMINATED"],
  ACTIVE: ["READY", "IDLE", "DRAINING", "FAILED", "LOST", "TERMINATED"],
  DRAINING: ["TERMINATED", "FAILED", "LOST"],
  TERMINATED: [],
  FAILED: ["TERMINATED"],
  LOST: ["TERMINATED"]
};

const MIGRATION = `
CREATE SEQUENCE IF NOT EXISTS pc_fencing_token_seq AS BIGINT START WITH 1;

CREATE TABLE IF NOT EXISTS pc_runtime_record (
  runtime_id TEXT NOT NULL,
  runtime_epoch BIGINT NOT NULL,
  tenant_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  worker_pool_id TEXT NOT NULL,
  state TEXT NOT NULL,
  profile_bundle_digest TEXT NOT NULL,
  capability_manifest_digest TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  capacity JSONB NOT NULL DEFAULT '{}'::jsonb,
  health_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL,
  last_report_seq BIGINT NOT NULL DEFAULT -1,
  current_record BOOLEAN NOT NULL DEFAULT TRUE,
  drain_reason TEXT,
  terminated_at TIMESTAMPTZ,
  cleanup_report JSONB,
  PRIMARY KEY (runtime_id, runtime_epoch)
);

CREATE UNIQUE INDEX IF NOT EXISTS pc_runtime_record_one_current
  ON pc_runtime_record(runtime_id)
  WHERE current_record;

CREATE TABLE IF NOT EXISTS pc_runtime_capability_manifest (
  runtime_id TEXT NOT NULL,
  runtime_epoch BIGINT NOT NULL,
  manifest JSONB NOT NULL,
  PRIMARY KEY (runtime_id, runtime_epoch),
  FOREIGN KEY (runtime_id, runtime_epoch)
    REFERENCES pc_runtime_record(runtime_id, runtime_epoch)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pc_session_assignment (
  assignment_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pc_session_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  runtime_epoch BIGINT NOT NULL,
  assignment_generation BIGINT NOT NULL,
  fencing_token TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL,
  effective_profile_snapshot_id TEXT NOT NULL,
  workspace_view_snapshot_id TEXT NOT NULL,
  authorization_revision BIGINT NOT NULL,
  version BIGINT NOT NULL,
  current_assignment BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  last_renewed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_code TEXT,
  UNIQUE (pc_session_id, assignment_generation),
  FOREIGN KEY (runtime_id, runtime_epoch)
    REFERENCES pc_runtime_record(runtime_id, runtime_epoch)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS pc_session_assignment_one_current
  ON pc_session_assignment(pc_session_id)
  WHERE current_assignment;

CREATE INDEX IF NOT EXISTS pc_session_assignment_runtime
  ON pc_session_assignment(runtime_id, runtime_epoch, assigned_at);
`;

interface RuntimeRow extends QueryResultRow {
  runtime_id: string;
  runtime_epoch: string | number;
  tenant_id: string;
  owner_user_id: string;
  worker_pool_id: string;
  state: RuntimeRegistryState;
  profile_bundle_digest: string;
  capability_manifest_digest: string;
  endpoint_url: string;
  capacity: Record<string, unknown>;
  health_summary: Record<string, unknown>;
  created_at: Date | string;
  last_heartbeat_at: Date | string;
  version: string | number;
  last_report_seq: string | number;
  current_record: boolean;
  drain_reason: string | null;
  terminated_at: Date | string | null;
  cleanup_report: Record<string, unknown> | null;
}

interface AssignmentRow extends QueryResultRow {
  assignment_id: string;
  tenant_id: string;
  user_id: string;
  pc_session_id: string;
  runtime_id: string;
  runtime_epoch: string | number;
  assignment_generation: string | number;
  fencing_token: string;
  lease_id: string;
  lease_expires_at: Date | string;
  state: AssignmentAuthorityState;
  effective_profile_snapshot_id: string;
  workspace_view_snapshot_id: string;
  authorization_revision: string | number;
  version: string | number;
  current_assignment: boolean;
  assigned_at: Date | string;
  accepted_at: Date | string | null;
  last_renewed_at: Date | string | null;
  revoked_at: Date | string | null;
  released_at: Date | string | null;
  expired_at: Date | string | null;
  rejected_at: Date | string | null;
  rejection_code: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function runtimeFromRow(row: RuntimeRow): RuntimeRecord {
  return {
    contract_name: "pc.runtime-record/1",
    contract_version: 1,
    runtime_id: row.runtime_id,
    runtime_epoch: Number(row.runtime_epoch),
    tenant_id: row.tenant_id,
    owner_user_id: row.owner_user_id,
    worker_pool_id: row.worker_pool_id,
    state: row.state,
    profile_bundle_digest: row.profile_bundle_digest,
    capability_manifest_digest: row.capability_manifest_digest,
    endpoint_url: row.endpoint_url,
    capacity: row.capacity,
    health_summary: row.health_summary,
    created_at: iso(row.created_at),
    last_heartbeat_at: iso(row.last_heartbeat_at),
    version: Number(row.version),
    last_report_seq: Number(row.last_report_seq),
    current: row.current_record,
    ...(row.drain_reason === null ? {} : { drain_reason: row.drain_reason }),
    ...(row.terminated_at === null ? {} : { terminated_at: iso(row.terminated_at) }),
    ...(row.cleanup_report === null ? {} : { cleanup_report: row.cleanup_report })
  };
}

function assignmentFromRow(row: AssignmentRow): SessionAssignment {
  return {
    contract_name: "pc.session-assignment-snapshot/1",
    contract_version: 1,
    assignment_id: row.assignment_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    pc_session_id: row.pc_session_id,
    runtime_id: row.runtime_id,
    runtime_epoch: Number(row.runtime_epoch),
    assignment_generation: Number(row.assignment_generation),
    fencing_token: row.fencing_token,
    lease_id: row.lease_id,
    lease_expires_at: iso(row.lease_expires_at),
    state: row.state,
    effective_profile_snapshot_id: row.effective_profile_snapshot_id,
    workspace_view_snapshot_id: row.workspace_view_snapshot_id,
    authorization_revision: Number(row.authorization_revision),
    version: Number(row.version),
    current: row.current_assignment,
    assigned_at: iso(row.assigned_at),
    ...(row.accepted_at === null ? {} : { accepted_at: iso(row.accepted_at) }),
    ...(row.last_renewed_at === null
      ? {}
      : { last_renewed_at: iso(row.last_renewed_at) }),
    ...(row.revoked_at === null ? {} : { revoked_at: iso(row.revoked_at) }),
    ...(row.released_at === null ? {} : { released_at: iso(row.released_at) }),
    ...(row.expired_at === null ? {} : { expired_at: iso(row.expired_at) }),
    ...(row.rejected_at === null ? {} : { rejected_at: iso(row.rejected_at) }),
    ...(row.rejection_code === null ? {} : { rejection_code: row.rejection_code })
  };
}

function assertVersion(actual: number, expected: number, subject: string): void {
  if (actual !== expected) {
    throw new RuntimeRegistryError(
      "PC_RUNTIME_CAS_CONFLICT",
      `${subject} version changed`,
      true,
      { expected, actual }
    );
  }
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

export class PostgresRuntimeRegistryRepository implements RuntimeRegistryRepository {
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

  registerRuntime(
    input: RegisterRuntimeInput,
    now: string
  ): Promise<{ runtime: RuntimeRecord; manifest: RuntimeCapabilityManifest }> {
    return transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [input.runtime_id]
      );
      const currentResult = await client.query<RuntimeRow>(
        `SELECT * FROM pc_runtime_record
         WHERE runtime_id = $1 AND current_record
         FOR UPDATE`,
        [input.runtime_id]
      );
      const currentRow = currentResult.rows[0];
      const current = currentRow === undefined ? undefined : runtimeFromRow(currentRow);
      if (current !== undefined && input.runtime_epoch < current.runtime_epoch) {
        throw new RuntimeRegistryError(
          "PC_RUNTIME_EPOCH_STALE",
          "Cannot register an older Runtime epoch"
        );
      }
      if (
        current !== undefined
        && input.expected_current_version !== undefined
      ) {
        assertVersion(
          current.version,
          input.expected_current_version,
          "RuntimeRecord"
        );
      }
      let runtime: RuntimeRecord;
      if (current !== undefined && input.runtime_epoch === current.runtime_epoch) {
        const updated = await client.query<RuntimeRow>(
          `UPDATE pc_runtime_record
           SET worker_pool_id = $3,
               state = $4,
               profile_bundle_digest = $5,
               capability_manifest_digest = $6,
               endpoint_url = $7,
               capacity = $8::jsonb,
               health_summary = $9::jsonb,
               last_heartbeat_at = $10,
               version = version + 1
           WHERE runtime_id = $1 AND runtime_epoch = $2
           RETURNING *`,
          [
            input.runtime_id,
            input.runtime_epoch,
            input.worker_pool_id,
            input.state ?? current.state,
            input.profile_bundle_digest,
            input.capability_manifest.manifest_digest,
            input.endpoint_url,
            JSON.stringify(input.capacity ?? current.capacity),
            JSON.stringify(input.health_summary ?? current.health_summary),
            now
          ]
        );
        runtime = runtimeFromRow(updated.rows[0] as RuntimeRow);
      } else {
        if (current !== undefined) {
          await client.query(
            `UPDATE pc_runtime_record
             SET current_record = FALSE
             WHERE runtime_id = $1 AND runtime_epoch = $2`,
            [current.runtime_id, current.runtime_epoch]
          );
        }
        const inserted = await client.query<RuntimeRow>(
          `INSERT INTO pc_runtime_record (
             runtime_id, runtime_epoch, tenant_id, owner_user_id, worker_pool_id,
             state, profile_bundle_digest, capability_manifest_digest,
             endpoint_url, capacity, health_summary, created_at,
             last_heartbeat_at, version, last_report_seq, current_record
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10::jsonb, $11::jsonb, $12, $12, 1, -1, TRUE
           )
           RETURNING *`,
          [
            input.runtime_id,
            input.runtime_epoch,
            input.tenant_id,
            input.owner_user_id,
            input.worker_pool_id,
            input.state ?? "STARTING",
            input.profile_bundle_digest,
            input.capability_manifest.manifest_digest,
            input.endpoint_url,
            JSON.stringify(input.capacity ?? {}),
            JSON.stringify(input.health_summary ?? {}),
            now
          ]
        );
        runtime = runtimeFromRow(inserted.rows[0] as RuntimeRow);
      }
      await client.query(
        `INSERT INTO pc_runtime_capability_manifest (
           runtime_id, runtime_epoch, manifest
         ) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (runtime_id, runtime_epoch)
         DO UPDATE SET manifest = EXCLUDED.manifest`,
        [
          input.runtime_id,
          input.runtime_epoch,
          JSON.stringify(input.capability_manifest)
        ]
      );
      return { runtime, manifest: structuredClone(input.capability_manifest) };
    });
  }

  async getCurrentRuntime(runtimeId: string): Promise<RuntimeRecord | undefined> {
    const result = await this.pool.query<RuntimeRow>(
      `SELECT * FROM pc_runtime_record
       WHERE runtime_id = $1 AND current_record`,
      [runtimeId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : runtimeFromRow(row);
  }

  async getRuntime(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<RuntimeRecord | undefined> {
    const result = await this.pool.query<RuntimeRow>(
      `SELECT * FROM pc_runtime_record
       WHERE runtime_id = $1 AND runtime_epoch = $2`,
      [runtimeId, runtimeEpoch]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : runtimeFromRow(row);
  }

  async getCapabilityManifest(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<RuntimeCapabilityManifest | undefined> {
    const result = await this.pool.query<{ manifest: RuntimeCapabilityManifest }>(
      `SELECT manifest FROM pc_runtime_capability_manifest
       WHERE runtime_id = $1 AND runtime_epoch = $2`,
      [runtimeId, runtimeEpoch]
    );
    return result.rows[0]?.manifest;
  }

  updateRuntimeState(input: {
    runtime_id: string;
    runtime_epoch: number;
    expected_version: number;
    state: RuntimeRegistryState;
    changed_at: string;
    drain_reason?: string;
    cleanup_report?: Record<string, unknown>;
  }): Promise<RuntimeRecord> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<RuntimeRow>(
        `SELECT * FROM pc_runtime_record
         WHERE runtime_id = $1 AND runtime_epoch = $2
         FOR UPDATE`,
        [input.runtime_id, input.runtime_epoch]
      );
      const row = selected.rows[0];
      if (row === undefined) {
        throw new RuntimeRegistryError("PC_RUNTIME_NOT_FOUND", "Runtime is not registered");
      }
      const runtime = runtimeFromRow(row);
      if (!runtime.current) {
        throw new RuntimeRegistryError(
          "PC_RUNTIME_EPOCH_STALE",
          "Cannot mutate a non-current Runtime epoch"
        );
      }
      assertVersion(runtime.version, input.expected_version, "RuntimeRecord");
      if (!RUNTIME_TRANSITIONS[runtime.state].includes(input.state)) {
        throw new RuntimeRegistryError(
          "PC_RUNTIME_STATE_TRANSITION_INVALID",
          `Runtime cannot transition from ${runtime.state} to ${input.state}`
        );
      }
      const updated = await client.query<RuntimeRow>(
        `UPDATE pc_runtime_record
         SET state = $3,
             version = version + 1,
             drain_reason = COALESCE($4, drain_reason),
             cleanup_report = COALESCE($5::jsonb, cleanup_report),
             terminated_at = CASE WHEN $3 = 'TERMINATED' THEN $6 ELSE terminated_at END
         WHERE runtime_id = $1 AND runtime_epoch = $2
         RETURNING *`,
        [
          input.runtime_id,
          input.runtime_epoch,
          input.state,
          input.drain_reason ?? null,
          input.cleanup_report === undefined
            ? null
            : JSON.stringify(input.cleanup_report),
          input.changed_at
        ]
      );
      return runtimeFromRow(updated.rows[0] as RuntimeRow);
    });
  }

  recordHeartbeat(
    report: RuntimeHealthReport,
    expectedVersion: number
  ): Promise<RuntimeRecord> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<RuntimeRow>(
        `SELECT * FROM pc_runtime_record
         WHERE runtime_id = $1 AND runtime_epoch = $2
         FOR UPDATE`,
        [report.runtime_id, report.runtime_epoch]
      );
      const row = selected.rows[0];
      if (row === undefined) {
        throw new RuntimeRegistryError("PC_RUNTIME_NOT_FOUND", "Runtime is not registered");
      }
      const runtime = runtimeFromRow(row);
      if (!runtime.current) {
        throw new RuntimeRegistryError(
          "PC_RUNTIME_EPOCH_STALE",
          "Heartbeat targets a non-current Runtime epoch"
        );
      }
      if (runtime.state === "TERMINATED") {
        throw new RuntimeRegistryError(
          "PC_RUNTIME_TERMINATED",
          "Heartbeat cannot revive a terminated Runtime"
        );
      }
      assertVersion(runtime.version, expectedVersion, "RuntimeRecord");
      if (report.report_seq <= runtime.last_report_seq) {
        throw new RuntimeRegistryError(
          "PC_RUNTIME_HEARTBEAT_STALE",
          "Heartbeat sequence is stale"
        );
      }
      const updated = await client.query<RuntimeRow>(
        `UPDATE pc_runtime_record
         SET health_summary = $3::jsonb,
             last_heartbeat_at = $4,
             last_report_seq = $5,
             version = version + 1
         WHERE runtime_id = $1 AND runtime_epoch = $2
         RETURNING *`,
        [
          report.runtime_id,
          report.runtime_epoch,
          JSON.stringify(report),
          report.observed_at,
          report.report_seq
        ]
      );
      return runtimeFromRow(updated.rows[0] as RuntimeRow);
    });
  }

  createPendingAssignment(
    input: CreateAssignmentInput,
    now: string,
    leaseExpiresAt: string
  ): Promise<SessionAssignment> {
    return transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [input.pc_session_id]
      );
      const currentResult = await client.query<AssignmentRow>(
        `SELECT * FROM pc_session_assignment
         WHERE pc_session_id = $1 AND current_assignment
         FOR UPDATE`,
        [input.pc_session_id]
      );
      const currentRow = currentResult.rows[0];
      if (currentRow !== undefined) {
        const current = assignmentFromRow(currentRow);
        if (!TERMINAL_ASSIGNMENT_STATES.has(current.state)) {
          throw new RuntimeRegistryError(
            "PC_RUNTIME_ASSIGNMENT_CONFLICT",
            "Session already has a current non-terminal Assignment",
            true
          );
        }
        await client.query(
          `UPDATE pc_session_assignment
           SET current_assignment = FALSE
           WHERE assignment_id = $1`,
          [current.assignment_id]
        );
      }
      const generationResult = await client.query<{ generation: string | number }>(
        `SELECT COALESCE(MAX(assignment_generation), 0) + 1 AS generation
         FROM pc_session_assignment
         WHERE pc_session_id = $1`,
        [input.pc_session_id]
      );
      const fencingResult = await client.query<{ fencing: string | number }>(
        `SELECT nextval('pc_fencing_token_seq') AS fencing`
      );
      const inserted = await client.query<AssignmentRow>(
        `INSERT INTO pc_session_assignment (
           assignment_id, tenant_id, user_id, pc_session_id, runtime_id,
           runtime_epoch, assignment_generation, fencing_token, lease_id,
           lease_expires_at, state, effective_profile_snapshot_id,
           workspace_view_snapshot_id, authorization_revision, version,
           current_assignment, assigned_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           'PENDING', $11, $12, $13, 1, TRUE, $14
         )
         RETURNING *`,
        [
          randomUUID(),
          input.tenant_id,
          input.user_id,
          input.pc_session_id,
          input.runtime_id,
          input.runtime_epoch,
          Number(generationResult.rows[0]?.generation ?? 1),
          String(fencingResult.rows[0]?.fencing ?? 1),
          randomUUID(),
          leaseExpiresAt,
          input.effective_profile_snapshot_id,
          input.workspace_view_snapshot_id,
          input.authorization_revision,
          now
        ]
      );
      return assignmentFromRow(inserted.rows[0] as AssignmentRow);
    });
  }

  async getCurrentAssignment(
    pcSessionId: string
  ): Promise<SessionAssignment | undefined> {
    const result = await this.pool.query<AssignmentRow>(
      `SELECT * FROM pc_session_assignment
       WHERE pc_session_id = $1 AND current_assignment`,
      [pcSessionId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : assignmentFromRow(row);
  }

  async getAssignment(
    assignmentId: string
  ): Promise<SessionAssignment | undefined> {
    const result = await this.pool.query<AssignmentRow>(
      `SELECT * FROM pc_session_assignment WHERE assignment_id = $1`,
      [assignmentId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : assignmentFromRow(row);
  }

  async listRuntimeAssignments(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<SessionAssignment[]> {
    const result = await this.pool.query<AssignmentRow>(
      `SELECT * FROM pc_session_assignment
       WHERE runtime_id = $1 AND runtime_epoch = $2
       ORDER BY assigned_at, assignment_generation`,
      [runtimeId, runtimeEpoch]
    );
    return result.rows.map(assignmentFromRow);
  }

  async transitionAssignment(
    input: TransitionAssignmentInput
  ): Promise<SessionAssignment> {
    const result = await this.pool.query<AssignmentRow>(
      `UPDATE pc_session_assignment
       SET state = $3,
           version = version + 1,
           accepted_at = CASE WHEN $3 = 'ACTIVE' THEN $4 ELSE accepted_at END,
           revoked_at = CASE WHEN $3 = 'REVOKING' THEN $4 ELSE revoked_at END,
           released_at = CASE WHEN $3 = 'RELEASED' THEN $4 ELSE released_at END,
           expired_at = CASE WHEN $3 = 'EXPIRED' THEN $4 ELSE expired_at END,
           rejected_at = CASE WHEN $3 = 'REJECTED' THEN $4 ELSE rejected_at END,
           rejection_code = CASE WHEN $3 = 'REJECTED' THEN $5 ELSE rejection_code END
       WHERE assignment_id = $1
         AND version = $2
         AND state = ANY($6::text[])
       RETURNING *`,
      [
        input.assignment_id,
        input.expected_version,
        input.state,
        input.changed_at,
        input.rejection_code ?? null,
        input.expected_states
      ]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_CAS_CONFLICT",
        "Assignment version or state changed",
        true
      );
    }
    return assignmentFromRow(row);
  }

  async renewAssignment(
    input: RenewAssignmentInput,
    renewedAt: string,
    leaseExpiresAt: string
  ): Promise<SessionAssignment> {
    const result = await this.pool.query<AssignmentRow>(
      `UPDATE pc_session_assignment
       SET lease_expires_at = $7,
           last_renewed_at = $8,
           version = version + 1
       WHERE pc_session_id = $1
         AND current_assignment
         AND runtime_id = $2
         AND runtime_epoch = $3
         AND assignment_generation = $4
         AND fencing_token = $5
         AND version = $6
         AND state = 'ACTIVE'
         AND lease_expires_at < $7
       RETURNING *`,
      [
        input.pc_session_id,
        input.runtime_id,
        input.runtime_epoch,
        input.assignment_generation,
        input.fencing_token,
        input.expected_version,
        leaseExpiresAt,
        renewedAt
      ]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_LEASE_RENEWAL_REJECTED",
        "Lease renewal coordinates, version, state or expiry are stale",
        true
      );
    }
    return assignmentFromRow(row);
  }

  async expireLeases(now: string): Promise<SessionAssignment[]> {
    const result = await this.pool.query<AssignmentRow>(
      `UPDATE pc_session_assignment
       SET state = 'EXPIRED',
           expired_at = $1,
           version = version + 1
       WHERE current_assignment
         AND state IN ('ACTIVE', 'REVOKING')
         AND lease_expires_at <= $1
       RETURNING *`,
      [now]
    );
    return result.rows.map(assignmentFromRow);
  }
}
