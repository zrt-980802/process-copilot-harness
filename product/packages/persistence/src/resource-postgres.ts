import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow
} from "pg";
import type {
  MaterializationRecord,
  Resource,
  ResourceAuditEntry,
  ResourceBinding,
  ResourceLifecycle,
  ResourceRepository,
  ResourceVersion,
  WorkspaceViewSnapshot
} from "@pc/resource";
import { ResourceError } from "@pc/resource";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS pc_resource (
  resource_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_resource_tenant
  ON pc_resource(tenant_id, lifecycle_status);

CREATE TABLE IF NOT EXISTS pc_resource_version (
  resource_version_id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES pc_resource(resource_id) ON DELETE RESTRICT,
  version_seq BIGINT NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE (resource_id, version_seq)
);

CREATE TABLE IF NOT EXISTS pc_resource_binding (
  binding_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL REFERENCES pc_resource(resource_id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_resource_binding_resource
  ON pc_resource_binding(resource_id, created_at);

CREATE INDEX IF NOT EXISTS pc_resource_binding_scope
  ON pc_resource_binding(tenant_id, scope_type, scope_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS pc_workspace_view_snapshot (
  workspace_view_snapshot_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  pc_session_id TEXT NOT NULL,
  authorization_revision BIGINT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_workspace_view_scope
  ON pc_workspace_view_snapshot(tenant_id, principal_id, pc_session_id, created_at);

CREATE TABLE IF NOT EXISTS pc_materialization (
  materialization_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  workspace_view_snapshot_id TEXT NOT NULL
    REFERENCES pc_workspace_view_snapshot(workspace_view_snapshot_id) ON DELETE RESTRICT,
  pc_session_id TEXT NOT NULL,
  target_runtime_id TEXT NOT NULL,
  target_runtime_epoch BIGINT NOT NULL,
  state TEXT NOT NULL,
  cleanup_state TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_materialization_admission
  ON pc_materialization(
    workspace_view_snapshot_id,
    pc_session_id,
    target_runtime_id,
    target_runtime_epoch,
    expires_at
  );

CREATE INDEX IF NOT EXISTS pc_materialization_cleanup
  ON pc_materialization(cleanup_state, expires_at);

CREATE TABLE IF NOT EXISTS pc_resource_audit (
  audit_id TEXT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  resource_ids TEXT[] NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_resource_audit_resource_ids
  ON pc_resource_audit USING GIN(resource_ids);
`;

interface PayloadRow<T> extends QueryResultRow {
  payload: T;
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

export class PostgresResourceRepository implements ResourceRepository {
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

  createResource(resource: Resource, version: ResourceVersion): Promise<void> {
    return transaction(this.pool, async (client) => {
      try {
        await client.query(
          `INSERT INTO pc_resource (
             resource_id, tenant_id, lifecycle_status, current_version_id, payload
           ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            resource.resource_id,
            resource.tenant_id,
            resource.lifecycle_status,
            resource.current_version_id,
            JSON.stringify(resource)
          ]
        );
        await client.query(
          `INSERT INTO pc_resource_version (
             resource_version_id, resource_id, version_seq, payload
           ) VALUES ($1, $2, $3, $4::jsonb)`,
          [
            version.resource_version_id,
            version.resource_id,
            version.version_seq,
            JSON.stringify(version)
          ]
        );
      } catch (error) {
        if (
          error instanceof Error
          && "code" in error
          && (error as { code?: string }).code === "23505"
        ) {
          throw new ResourceError(
            "PC_RESOURCE_CONFLICT",
            "Resource or ResourceVersion already exists"
          );
        }
        throw error;
      }
    });
  }

  async getResource(resourceId: string): Promise<Resource | undefined> {
    const result = await this.pool.query<PayloadRow<Resource>>(
      "SELECT payload FROM pc_resource WHERE resource_id = $1",
      [resourceId]
    );
    return result.rows[0]?.payload;
  }

  async getVersion(
    resourceVersionId: string
  ): Promise<ResourceVersion | undefined> {
    const result = await this.pool.query<PayloadRow<ResourceVersion>>(
      "SELECT payload FROM pc_resource_version WHERE resource_version_id = $1",
      [resourceVersionId]
    );
    return result.rows[0]?.payload;
  }

  async listVersions(resourceId: string): Promise<ResourceVersion[]> {
    const result = await this.pool.query<PayloadRow<ResourceVersion>>(
      `SELECT payload FROM pc_resource_version
       WHERE resource_id = $1
       ORDER BY version_seq`,
      [resourceId]
    );
    return result.rows.map((row) => row.payload);
  }

  appendVersion(
    resourceId: string,
    expectedVersionId: string,
    version: ResourceVersion,
    updatedAt: string
  ): Promise<Resource> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<PayloadRow<Resource>>(
        "SELECT payload FROM pc_resource WHERE resource_id = $1 FOR UPDATE",
        [resourceId]
      );
      const resource = selected.rows[0]?.payload;
      if (resource === undefined) {
        throw new ResourceError("PC_RESOURCE_NOT_FOUND", "Resource was not found");
      }
      if (resource.current_version_id !== expectedVersionId) {
        throw new ResourceError(
          "PC_RESOURCE_VERSION_CONFLICT",
          "Resource current version changed",
          true
        );
      }
      const updated: Resource = {
        ...resource,
        current_version_id: version.resource_version_id,
        updated_at: updatedAt
      };
      try {
        await client.query(
          `INSERT INTO pc_resource_version (
             resource_version_id, resource_id, version_seq, payload
           ) VALUES ($1, $2, $3, $4::jsonb)`,
          [
            version.resource_version_id,
            version.resource_id,
            version.version_seq,
            JSON.stringify(version)
          ]
        );
      } catch (error) {
        if (
          error instanceof Error
          && "code" in error
          && (error as { code?: string }).code === "23505"
        ) {
          throw new ResourceError(
            "PC_RESOURCE_VERSION_CONFLICT",
            "ResourceVersion sequence changed",
            true
          );
        }
        throw error;
      }
      await client.query(
        `UPDATE pc_resource
         SET current_version_id = $2, payload = $3::jsonb
         WHERE resource_id = $1`,
        [resourceId, version.resource_version_id, JSON.stringify(updated)]
      );
      return updated;
    });
  }

  updateLifecycle(
    resourceId: string,
    expectedLifecycle: ResourceLifecycle,
    lifecycle: ResourceLifecycle,
    updatedAt: string
  ): Promise<Resource> {
    return transaction(this.pool, async (client) => {
      const selected = await client.query<PayloadRow<Resource>>(
        "SELECT payload FROM pc_resource WHERE resource_id = $1 FOR UPDATE",
        [resourceId]
      );
      const resource = selected.rows[0]?.payload;
      if (resource === undefined) {
        throw new ResourceError("PC_RESOURCE_NOT_FOUND", "Resource was not found");
      }
      if (resource.lifecycle_status !== expectedLifecycle) {
        throw new ResourceError(
          "PC_RESOURCE_LIFECYCLE_CONFLICT",
          "Resource lifecycle changed",
          true
        );
      }
      const updated: Resource = {
        ...resource,
        lifecycle_status: lifecycle,
        updated_at: updatedAt
      };
      await client.query(
        `UPDATE pc_resource
         SET lifecycle_status = $2, payload = $3::jsonb
         WHERE resource_id = $1`,
        [resourceId, lifecycle, JSON.stringify(updated)]
      );
      return updated;
    });
  }

  async createBinding(binding: ResourceBinding): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_resource_binding (
           binding_id, tenant_id, resource_id, scope_type, scope_id,
           revoked_at, created_at, payload
         ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7::jsonb)`,
        [
          binding.binding_id,
          binding.tenant_id,
          binding.resource_id,
          binding.scope_type,
          binding.scope_id,
          binding.created_at,
          JSON.stringify(binding)
        ]
      );
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && (error as { code?: string }).code === "23505"
      ) {
        throw new ResourceError(
          "PC_RESOURCE_BINDING_CONFLICT",
          "Binding already exists"
        );
      }
      throw error;
    }
  }

  async getBinding(bindingId: string): Promise<ResourceBinding | undefined> {
    const result = await this.pool.query<PayloadRow<ResourceBinding>>(
      "SELECT payload FROM pc_resource_binding WHERE binding_id = $1",
      [bindingId]
    );
    return result.rows[0]?.payload;
  }

  async listBindings(resourceId: string): Promise<ResourceBinding[]> {
    const result = await this.pool.query<PayloadRow<ResourceBinding>>(
      `SELECT payload FROM pc_resource_binding
       WHERE resource_id = $1
       ORDER BY created_at`,
      [resourceId]
    );
    return result.rows.map((row) => row.payload);
  }

  revokeBinding(bindingId: string, revokedAt: string): Promise<ResourceBinding> {
    return transaction(this.pool, async (client) => {
      const result = await client.query<PayloadRow<ResourceBinding>>(
        "SELECT payload FROM pc_resource_binding WHERE binding_id = $1 FOR UPDATE",
        [bindingId]
      );
      const binding = result.rows[0]?.payload;
      if (binding === undefined) {
        throw new ResourceError(
          "PC_RESOURCE_BINDING_NOT_FOUND",
          "Binding was not found"
        );
      }
      if (binding.revoked_at !== undefined) return binding;
      const updated = { ...binding, revoked_at: revokedAt };
      await client.query(
        `UPDATE pc_resource_binding
         SET revoked_at = $2, payload = $3::jsonb
         WHERE binding_id = $1`,
        [bindingId, revokedAt, JSON.stringify(updated)]
      );
      return updated;
    });
  }

  async saveWorkspaceView(snapshot: WorkspaceViewSnapshot): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_workspace_view_snapshot (
           workspace_view_snapshot_id, tenant_id, principal_id, pc_session_id,
           authorization_revision, expires_at, created_at, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          snapshot.workspace_view_snapshot_id,
          snapshot.tenant_id,
          snapshot.principal_id,
          snapshot.pc_session_id,
          snapshot.authorization_revision,
          snapshot.expires_at ?? null,
          snapshot.created_at,
          JSON.stringify(snapshot)
        ]
      );
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && (error as { code?: string }).code === "23505"
      ) {
        throw new ResourceError(
          "PC_RESOURCE_WORKSPACE_VIEW_CONFLICT",
          "Workspace View Snapshot already exists"
        );
      }
      throw error;
    }
  }

  async getWorkspaceView(
    workspaceViewSnapshotId: string
  ): Promise<WorkspaceViewSnapshot | undefined> {
    const result = await this.pool.query<PayloadRow<WorkspaceViewSnapshot>>(
      `SELECT payload FROM pc_workspace_view_snapshot
       WHERE workspace_view_snapshot_id = $1`,
      [workspaceViewSnapshotId]
    );
    return result.rows[0]?.payload;
  }

  async saveMaterialization(record: MaterializationRecord): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_materialization (
           materialization_id, tenant_id, principal_id,
           workspace_view_snapshot_id, pc_session_id,
           target_runtime_id, target_runtime_epoch, state,
           cleanup_state, expires_at, requested_at, payload
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
         )`,
        [
          record.materialization_id,
          record.tenant_id,
          record.principal_id,
          record.workspace_view_snapshot_id,
          record.pc_session_id,
          record.target_runtime_id,
          record.target_runtime_epoch,
          record.state,
          record.cleanup_state,
          record.expires_at,
          record.requested_at,
          JSON.stringify(record)
        ]
      );
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && (error as { code?: string }).code === "23505"
      ) {
        throw new ResourceError(
          "PC_RESOURCE_MATERIALIZATION_CONFLICT",
          "Materialization already exists"
        );
      }
      throw error;
    }
  }

  async getMaterialization(
    materializationId: string
  ): Promise<MaterializationRecord | undefined> {
    const result = await this.pool.query<PayloadRow<MaterializationRecord>>(
      "SELECT payload FROM pc_materialization WHERE materialization_id = $1",
      [materializationId]
    );
    return result.rows[0]?.payload;
  }

  async findActiveMaterialization(input: {
    workspace_view_snapshot_id: string;
    pc_session_id: string;
    target_runtime_id: string;
    target_runtime_epoch: number;
    now: string;
  }): Promise<MaterializationRecord | undefined> {
    const result = await this.pool.query<PayloadRow<MaterializationRecord>>(
      `SELECT payload FROM pc_materialization
       WHERE workspace_view_snapshot_id = $1
         AND pc_session_id = $2
         AND target_runtime_id = $3
         AND target_runtime_epoch = $4
         AND state = 'READY'
         AND cleanup_state = 'ACTIVE'
         AND expires_at > $5
       ORDER BY requested_at DESC
       LIMIT 1`,
      [
        input.workspace_view_snapshot_id,
        input.pc_session_id,
        input.target_runtime_id,
        input.target_runtime_epoch,
        input.now
      ]
    );
    return result.rows[0]?.payload;
  }

  async listExpiredMaterializations(
    now: string
  ): Promise<MaterializationRecord[]> {
    const result = await this.pool.query<PayloadRow<MaterializationRecord>>(
      `SELECT payload FROM pc_materialization
       WHERE cleanup_state = 'ACTIVE'
         AND expires_at <= $1
       ORDER BY expires_at`,
      [now]
    );
    return result.rows.map((row) => row.payload);
  }

  async updateMaterialization(record: MaterializationRecord): Promise<void> {
    const result = await this.pool.query(
      `UPDATE pc_materialization
       SET state = $2, cleanup_state = $3, payload = $4::jsonb
       WHERE materialization_id = $1`,
      [
        record.materialization_id,
        record.state,
        record.cleanup_state,
        JSON.stringify(record)
      ]
    );
    if (result.rowCount === 0) {
      throw new ResourceError(
        "PC_RESOURCE_MATERIALIZATION_NOT_FOUND",
        "Materialization was not found"
      );
    }
  }

  async appendAudit(entry: ResourceAuditEntry): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_resource_audit (
           audit_id, occurred_at, resource_ids, payload
         ) VALUES ($1, $2, $3, $4::jsonb)`,
        [
          entry.audit_id,
          entry.occurred_at,
          entry.resource_refs.map((reference) => reference.resource_id),
          JSON.stringify(entry)
        ]
      );
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && (error as { code?: string }).code === "23505"
      ) {
        throw new ResourceError(
          "PC_RESOURCE_AUDIT_CONFLICT",
          "Audit entry already exists"
        );
      }
      throw error;
    }
  }

  async listAudit(resourceId: string): Promise<ResourceAuditEntry[]> {
    const result = await this.pool.query<PayloadRow<ResourceAuditEntry>>(
      `SELECT payload FROM pc_resource_audit
       WHERE resource_ids @> ARRAY[$1]::text[]
       ORDER BY occurred_at`,
      [resourceId]
    );
    return result.rows.map((row) => row.payload);
  }
}
