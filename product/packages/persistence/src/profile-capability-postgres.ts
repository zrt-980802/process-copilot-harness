import { randomUUID } from "node:crypto";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow
} from "pg";
import type { ProfileCapabilityRepository } from "@pc/application";
import type {
  EffectiveProfileSnapshot,
  ExpertProfileRelease,
  PluginRelease,
  ProfileAssignment,
  ProfileResolutionReport,
  ReleaseStatus,
  ToolRelease
} from "@pc/domain";
import { ProfileCapabilityError } from "@pc/domain";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS pc_expert_profile_release (
  profile_release_id TEXT PRIMARY KEY,
  release_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS pc_tool_release (
  tool_release_id TEXT PRIMARY KEY,
  release_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS pc_plugin_release (
  plugin_release_id TEXT PRIMARY KEY,
  release_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS pc_profile_assignment (
  profile_assignment_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  profile_release_id TEXT NOT NULL REFERENCES pc_expert_profile_release(profile_release_id),
  status TEXT NOT NULL,
  revision BIGINT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS pc_profile_assignment_one_active
  ON pc_profile_assignment(principal_id, profile_release_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS pc_profile_resolution_report (
  resolution_report_id TEXT PRIMARY KEY,
  requested_profile_release_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS pc_effective_profile_snapshot (
  effective_profile_snapshot_id TEXT PRIMARY KEY,
  pc_session_id TEXT NOT NULL,
  profile_release_id TEXT NOT NULL,
  authorization_revision BIGINT NOT NULL,
  snapshot_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_effective_profile_snapshot_session
  ON pc_effective_profile_snapshot(pc_session_id, created_at);
`;

interface ReleaseRow extends QueryResultRow {
  release_digest: string;
  status: ReleaseStatus;
  payload: Record<string, unknown>;
}

interface AssignmentRow extends QueryResultRow {
  profile_assignment_id: string;
  principal_id: string;
  profile_release_id: string;
  status: ProfileAssignment["status"];
  revision: string | number;
  assigned_at: Date | string;
  revoked_at: Date | string | null;
}

interface SnapshotRow extends QueryResultRow {
  payload: EffectiveProfileSnapshot;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function assignmentFromRow(row: AssignmentRow): ProfileAssignment {
  return {
    profile_assignment_id: row.profile_assignment_id,
    principal_id: row.principal_id,
    profile_release_id: row.profile_release_id,
    status: row.status,
    revision: Number(row.revision),
    assigned_at: iso(row.assigned_at),
    ...(row.revoked_at === null ? {} : { revoked_at: iso(row.revoked_at) })
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

export class PostgresProfileCapabilityRepository
implements ProfileCapabilityRepository {
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

  putProfileRelease(
    release: ExpertProfileRelease
  ): Promise<ExpertProfileRelease> {
    return this.putRelease(
      "pc_expert_profile_release",
      "profile_release_id",
      release.profile_release_id,
      release
    );
  }

  async getProfileRelease(
    profileReleaseId: string
  ): Promise<ExpertProfileRelease | undefined> {
    const row = await this.getRelease(
      "pc_expert_profile_release",
      "profile_release_id",
      profileReleaseId
    );
    return row?.payload as ExpertProfileRelease | undefined;
  }

  async transitionProfileRelease(
    profileReleaseId: string,
    expectedStatus: ReleaseStatus,
    status: ReleaseStatus
  ): Promise<ExpertProfileRelease> {
    const result = await this.pool.query<ReleaseRow>(
      `UPDATE pc_expert_profile_release
       SET status = $3,
           payload = jsonb_set(payload, '{status}', to_jsonb($3::text))
       WHERE profile_release_id = $1 AND status = $2
       RETURNING *`,
      [profileReleaseId, expectedStatus, status]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ProfileCapabilityError(
        "PC_PROFILE_RELEASE_STATE_CONFLICT",
        "Profile Release status changed",
        true
      );
    }
    return row.payload as unknown as ExpertProfileRelease;
  }

  putToolRelease(release: ToolRelease): Promise<ToolRelease> {
    return this.putRelease(
      "pc_tool_release",
      "tool_release_id",
      release.tool_release_id,
      release
    );
  }

  async getToolRelease(
    toolReleaseId: string
  ): Promise<ToolRelease | undefined> {
    const row = await this.getRelease(
      "pc_tool_release",
      "tool_release_id",
      toolReleaseId
    );
    return row?.payload as ToolRelease | undefined;
  }

  putPluginRelease(release: PluginRelease): Promise<PluginRelease> {
    return this.putRelease(
      "pc_plugin_release",
      "plugin_release_id",
      release.plugin_release_id,
      release
    );
  }

  async getPluginRelease(
    pluginReleaseId: string
  ): Promise<PluginRelease | undefined> {
    const row = await this.getRelease(
      "pc_plugin_release",
      "plugin_release_id",
      pluginReleaseId
    );
    return row?.payload as PluginRelease | undefined;
  }

  assignProfile(
    principalId: string,
    profileReleaseId: string,
    now: string
  ): Promise<ProfileAssignment> {
    return transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${principalId}:${profileReleaseId}`]
      );
      const current = await client.query<AssignmentRow>(
        `SELECT * FROM pc_profile_assignment
         WHERE principal_id = $1 AND profile_release_id = $2
           AND status = 'active'`,
        [principalId, profileReleaseId]
      );
      if (current.rows[0] !== undefined) {
        return assignmentFromRow(current.rows[0]);
      }
      const inserted = await client.query<AssignmentRow>(
        `INSERT INTO pc_profile_assignment (
           profile_assignment_id, principal_id, profile_release_id,
           status, revision, assigned_at
         ) VALUES ($1, $2, $3, 'active', 1, $4)
         RETURNING *`,
        [randomUUID(), principalId, profileReleaseId, now]
      );
      return assignmentFromRow(inserted.rows[0] as AssignmentRow);
    });
  }

  async getActiveProfileAssignment(
    principalId: string,
    profileReleaseId: string
  ): Promise<ProfileAssignment | undefined> {
    const result = await this.pool.query<AssignmentRow>(
      `SELECT * FROM pc_profile_assignment
       WHERE principal_id = $1 AND profile_release_id = $2
         AND status = 'active'`,
      [principalId, profileReleaseId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : assignmentFromRow(row);
  }

  async saveResolution(
    report: ProfileResolutionReport,
    snapshot?: EffectiveProfileSnapshot
  ): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO pc_profile_resolution_report (
           resolution_report_id, requested_profile_release_id,
           created_at, payload
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (resolution_report_id) DO NOTHING`,
        [
          report.resolution_report_id,
          report.requested_profile_release_id,
          report.created_at,
          JSON.stringify(report)
        ]
      );
      if (snapshot !== undefined) {
        await client.query(
          `INSERT INTO pc_effective_profile_snapshot (
             effective_profile_snapshot_id, pc_session_id, profile_release_id,
             authorization_revision, snapshot_digest, created_at, payload
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (effective_profile_snapshot_id) DO NOTHING`,
          [
            snapshot.effective_profile_snapshot_id,
            snapshot.pc_session_id,
            snapshot.profile_release_id,
            snapshot.authorization_revision,
            snapshot.snapshot_digest,
            snapshot.created_at,
            JSON.stringify(snapshot)
          ]
        );
      }
    });
  }

  async getEffectiveProfileSnapshot(
    snapshotId: string
  ): Promise<EffectiveProfileSnapshot | undefined> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT payload FROM pc_effective_profile_snapshot
       WHERE effective_profile_snapshot_id = $1`,
      [snapshotId]
    );
    return result.rows[0]?.payload;
  }

  async listSessionSnapshots(pcSessionId: string): Promise<EffectiveProfileSnapshot[]> {
    const result = await this.pool.query<SnapshotRow>(
      "SELECT payload FROM pc_effective_profile_snapshot WHERE pc_session_id = $1 ORDER BY created_at",
      [pcSessionId]
    );
    return result.rows.map((row) => row.payload);
  }

  private async putRelease<T extends {
    release_digest: string;
    status: ReleaseStatus;
  }>(
    table: string,
    idColumn: string,
    id: string,
    release: T
  ): Promise<T> {
    await this.pool.query(
      `INSERT INTO ${table} (${idColumn}, release_digest, status, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (${idColumn}) DO NOTHING`,
      [id, release.release_digest, release.status, JSON.stringify(release)]
    );
    const current = await this.getRelease(table, idColumn, id);
    if (current === undefined) {
      throw new ProfileCapabilityError(
        "PC_PROFILE_RELEASE_PERSISTENCE_FAILED",
        "Release could not be persisted"
      );
    }
    if (current.release_digest !== release.release_digest) {
      throw new ProfileCapabilityError(
        "PC_PROFILE_RELEASE_CONFLICT",
        "Release ID already contains different immutable content"
      );
    }
    return current.payload as T;
  }

  private async getRelease(
    table: string,
    idColumn: string,
    id: string
  ): Promise<ReleaseRow | undefined> {
    const result = await this.pool.query<ReleaseRow>(
      `SELECT release_digest, status, payload
       FROM ${table} WHERE ${idColumn} = $1`,
      [id]
    );
    return result.rows[0];
  }
}
