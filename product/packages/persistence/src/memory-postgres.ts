import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow
} from "pg";
import type {
  CaptureMutation,
  MemoryAggregate,
  MemoryAuthorityEvent,
  MemoryAuthorityRepository,
  MemoryCommandReplayLookup,
  MemoryCommandRecord,
  MemoryMutationResult,
  MemoryObject,
  MemoryPolicyDecision,
  MemoryRevision,
  MemorySourceEvidence,
  RevokeMutation,
  ReviseMutation
} from "@pc/memory";
import { MemoryError } from "@pc/memory";

const MIGRATION_COMPONENT = "memory-authority";
const MIGRATION_VERSION = 1;
const MIGRATION_NAME = "0001_memory_authority.sql";

interface PayloadRow<T> extends QueryResultRow { payload: T }
interface CommandRow extends QueryResultRow {
  command_id: string;
  tenant_id: string;
  principal_id: string;
  idempotency_key: string;
  command_kind: MemoryCommandRecord["command_kind"];
  payload_digest: string;
  result: Record<string, unknown>;
  created_at: Date | string;
  completed_at: Date | string;
}

function migrationDigest(sql: string): string {
  return `sha256:${createHash("sha256").update(sql).digest("hex")}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && (error as { code?: string }).code === "23505";
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
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

export class PostgresMemoryAuthorityRepository implements MemoryAuthorityRepository {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(config: string | PoolConfig | Pool) {
    if (config instanceof Pool) {
      this.pool = config;
      this.ownsPool = false;
    } else {
      this.pool = new Pool(typeof config === "string" ? { connectionString: config } : config);
      this.ownsPool = true;
    }
  }

  async initialize(): Promise<void> {
    const migrationUrl = new URL("../migrations/memory/0001_memory_authority.sql", import.meta.url);
    const sql = await readFile(migrationUrl, "utf8");
    const digest = migrationDigest(sql);
    await transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [MIGRATION_COMPONENT]);
      await client.query(`CREATE TABLE IF NOT EXISTS pc_schema_migration (
        component TEXT NOT NULL, version BIGINT NOT NULL, migration_name TEXT NOT NULL,
        migration_digest TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (component, version), UNIQUE (component, migration_name))`);
      const existing = await client.query<{ migration_digest: string }>(
        "SELECT migration_digest FROM pc_schema_migration WHERE component = $1 AND version = $2",
        [MIGRATION_COMPONENT, MIGRATION_VERSION]
      );
      if (existing.rows[0] !== undefined) {
        if (existing.rows[0].migration_digest !== digest) {
          throw new MemoryError("MEMORY_MIGRATION_DIGEST_MISMATCH", "Applied Memory migration digest changed");
        }
        return;
      }
      await client.query(sql);
      await client.query(
        `INSERT INTO pc_schema_migration(component, version, migration_name, migration_digest, applied_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [MIGRATION_COMPONENT, MIGRATION_VERSION, MIGRATION_NAME, digest]
      );
    });
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }

  replayCommand(input: MemoryCommandReplayLookup): Promise<MemoryMutationResult | undefined> {
    return this.replay(this.pool, input);
  }

  capture(input: CaptureMutation): Promise<MemoryMutationResult> {
    return this.execute(input.command, async (client) => {
      await this.insertObject(client, input.object);
      await this.insertEvidence(client, input.source_evidence);
      await this.insertRevision(client, input.revision);
      await this.insertRevisionEvidence(client, input.revision);
      await this.insertCommand(client, input.command);
      await this.insertDecision(client, input.policy_decision);
      await this.insertEvent(client, input.authority_event);
      return { aggregate: { object: input.object, current_revision: input.revision, source_evidence: input.source_evidence }, replayed: false };
    });
  }

  revise(input: ReviseMutation): Promise<MemoryMutationResult> {
    return this.execute(input.command, async (client) => {
      await this.assertCas(client, input.object.memory_id, input.command.tenant_id, input.command.principal_id, input.expected_object_version, input.expected_current_revision_id);
      const prior = await client.query(
        `UPDATE pc_memory_revision SET revision_state = 'SUPERSEDED', payload = $3::jsonb
         WHERE memory_id = $1 AND revision_id = $2 AND revision_state = 'CURRENT'`,
        [input.object.memory_id, input.previous_revision.revision_id, JSON.stringify(input.previous_revision)]
      );
      if (prior.rowCount !== 1) throw new MemoryError("MEMORY_REVISION_CONFLICT", "Current Memory Revision changed", true);
      await this.insertEvidence(client, input.source_evidence);
      await this.insertRevision(client, input.revision);
      await this.insertRevisionEvidence(client, input.revision);
      await this.updateObject(client, input.object, input.expected_object_version);
      await this.insertCommand(client, input.command);
      await this.insertDecision(client, input.policy_decision);
      await this.insertEvent(client, input.authority_event);
      return { aggregate: { object: input.object, current_revision: input.revision, source_evidence: input.source_evidence }, replayed: false };
    });
  }

  revoke(input: RevokeMutation): Promise<MemoryMutationResult> {
    return this.execute(input.command, async (client) => {
      await this.assertCas(client, input.object.memory_id, input.command.tenant_id, input.command.principal_id, input.expected_object_version, input.expected_current_revision_id);
      const prior = await client.query(
        `UPDATE pc_memory_revision SET revision_state = 'WITHDRAWN', payload = $3::jsonb
         WHERE memory_id = $1 AND revision_id = $2 AND revision_state = 'CURRENT'`,
        [input.object.memory_id, input.withdrawn_revision.revision_id, JSON.stringify(input.withdrawn_revision)]
      );
      if (prior.rowCount !== 1) throw new MemoryError("MEMORY_REVISION_CONFLICT", "Current Memory Revision changed", true);
      await this.updateObject(client, input.object, input.expected_object_version);
      await this.insertCommand(client, input.command);
      await this.insertDecision(client, input.policy_decision);
      await this.insertEvent(client, input.authority_event);
      const evidence = await this.getEvidenceForRevision(client, input.withdrawn_revision.revision_id);
      return { aggregate: { object: input.object, current_revision: input.withdrawn_revision, source_evidence: evidence }, replayed: false };
    });
  }

  getOwnedAggregate(input: { memory_id: string; tenant_id: string; owner_principal_id: string }): Promise<MemoryAggregate | undefined> {
    return this.getAggregate(this.pool, input.memory_id, input.tenant_id, input.owner_principal_id);
  }

  async listAuthorityEvents(input: { tenant_id: string; memory_id?: string; after_sequence?: number }): Promise<MemoryAuthorityEvent[]> {
    const values: unknown[] = [input.tenant_id, input.after_sequence ?? 0];
    const memoryClause = input.memory_id === undefined ? "" : " AND memory_id = $3";
    if (input.memory_id !== undefined) values.push(input.memory_id);
    const result = await this.pool.query<PayloadRow<MemoryAuthorityEvent>>(
      `SELECT payload FROM pc_memory_authority_event
       WHERE tenant_id = $1 AND producer_sequence > $2${memoryClause}
       ORDER BY memory_id, producer_sequence`, values
    );
    return result.rows.map((row) => row.payload);
  }

  private async execute(command: MemoryCommandRecord, operation: (client: PoolClient) => Promise<MemoryMutationResult>): Promise<MemoryMutationResult> {
    try {
      return await transaction(this.pool, async (client) => {
        const replay = await this.replay(client, command);
        return replay ?? operation(client);
      });
    } catch (error) {
      const replay = await this.replay(this.pool, command);
      if (replay !== undefined) return replay;
      if (isUniqueViolation(error)) throw new MemoryError("MEMORY_VERSION_CONFLICT", "Memory command conflicts with existing authority", true);
      throw error;
    }
  }

  private async replay(client: Pool | PoolClient, command: MemoryCommandReplayLookup): Promise<MemoryMutationResult | undefined> {
    const result = await client.query<CommandRow>(
      `SELECT command_id, tenant_id, principal_id, idempotency_key, command_kind,
              payload_digest, result, created_at, completed_at
       FROM pc_memory_command WHERE tenant_id = $1 AND principal_id = $2 AND idempotency_key = $3`,
      [command.tenant_id, command.principal_id, command.idempotency_key]
    );
    const stored = result.rows[0];
    if (stored === undefined) return undefined;
    if (stored.command_kind !== command.command_kind || stored.payload_digest !== command.payload_digest) {
      throw new MemoryError("MEMORY_VERSION_CONFLICT", "Idempotency key was reused with another payload");
    }
    const object = stored.result.object as MemoryObject | undefined;
    const revisionId = stored.result.revision_id;
    if (
      object === undefined
      || typeof object !== "object"
      || object.tenant_id !== command.tenant_id
      || object.owner_principal_id !== command.principal_id
      || typeof object.memory_id !== "string"
      || typeof revisionId !== "string"
    ) {
      throw new MemoryError("MEMORY_INVALID_STATE", "Stored Memory command result is invalid");
    }
    const revisionResult = await client.query<PayloadRow<MemoryRevision>>(
      "SELECT payload FROM pc_memory_revision WHERE memory_id = $1 AND revision_id = $2",
      [object.memory_id, revisionId]
    );
    const revision = revisionResult.rows[0]?.payload;
    if (revision === undefined) {
      throw new MemoryError("MEMORY_INVALID_STATE", "Stored Memory command Revision is unavailable");
    }
    return {
      aggregate: {
        object,
        current_revision: revision,
        source_evidence: await this.getEvidenceForRevision(client, revisionId)
      },
      replayed: true
    };
  }

  private async getAggregate(client: Pool | PoolClient, memoryId: string, tenantId: string, ownerId: string): Promise<MemoryAggregate | undefined> {
    const objectResult = await client.query<PayloadRow<MemoryObject>>(
      `SELECT payload FROM pc_memory_object
       WHERE memory_id = $1 AND tenant_id = $2 AND owner_principal_id = $3`,
      [memoryId, tenantId, ownerId]
    );
    const object = objectResult.rows[0]?.payload;
    if (object === undefined || object.current_revision_id === undefined) return undefined;
    const revisionResult = await client.query<PayloadRow<MemoryRevision>>(
      "SELECT payload FROM pc_memory_revision WHERE memory_id = $1 AND revision_id = $2",
      [memoryId, object.current_revision_id]
    );
    const revision = revisionResult.rows[0]?.payload;
    if (revision === undefined) throw new MemoryError("MEMORY_INVALID_STATE", "Memory current Revision is missing");
    return { object, current_revision: revision, source_evidence: await this.getEvidenceForRevision(client, revision.revision_id) };
  }

  private async getEvidenceForRevision(client: Pool | PoolClient, revisionId: string): Promise<MemorySourceEvidence[]> {
    const result = await client.query<PayloadRow<MemorySourceEvidence>>(
      `SELECT evidence.payload FROM pc_memory_revision_evidence link
       JOIN pc_memory_source_evidence evidence ON evidence.source_evidence_id = link.source_evidence_id
       WHERE link.revision_id = $1 ORDER BY link.ordinal`, [revisionId]
    );
    return result.rows.map((row) => row.payload);
  }

  private async assertCas(client: PoolClient, memoryId: string, tenantId: string, ownerId: string, version: number, revisionId: string): Promise<void> {
    const result = await client.query<{ version: string | number; current_revision_id: string | null }>(
      `SELECT version, current_revision_id FROM pc_memory_object
       WHERE memory_id = $1 AND tenant_id = $2 AND owner_principal_id = $3 FOR UPDATE`,
      [memoryId, tenantId, ownerId]
    );
    const row = result.rows[0];
    if (row === undefined || Number(row.version) !== version || row.current_revision_id !== revisionId) {
      throw new MemoryError("MEMORY_REVISION_CONFLICT", "Memory Object or Revision changed", true);
    }
  }

  private insertObject(client: PoolClient, object: MemoryObject): Promise<unknown> {
    return client.query(
      `INSERT INTO pc_memory_object(memory_id, tenant_id, owner_principal_id, subject_principal_id,
       scope_type, scope_id, memory_kind, sensitivity, object_state, current_revision_id,
       policy_revision, version, created_at, updated_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
      [object.memory_id, object.tenant_id, object.owner_principal_id, object.subject_principal_id ?? null,
        object.scope_type, object.scope_id, object.memory_kind, object.sensitivity, object.object_state,
        object.current_revision_id ?? null, object.policy_revision, object.version, object.created_at,
        object.updated_at, JSON.stringify(object)]
    );
  }

  private async updateObject(client: PoolClient, object: MemoryObject, expectedVersion: number): Promise<void> {
    const result = await client.query(
      `UPDATE pc_memory_object SET sensitivity=$2, object_state=$3, current_revision_id=$4,
       policy_revision=$5, version=$6, updated_at=$7, payload=$8::jsonb
       WHERE memory_id=$1 AND version=$9`,
      [object.memory_id, object.sensitivity, object.object_state, object.current_revision_id ?? null,
        object.policy_revision, object.version, object.updated_at, JSON.stringify(object), expectedVersion]
    );
    if (result.rowCount !== 1) throw new MemoryError("MEMORY_VERSION_CONFLICT", "Memory Object version changed", true);
  }

  private insertRevision(client: PoolClient, revision: MemoryRevision): Promise<unknown> {
    return client.query(
      `INSERT INTO pc_memory_revision(revision_id, memory_id, revision_no, revision_state,
       content_digest, confidence, valid_from, valid_to, recorded_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [revision.revision_id, revision.memory_id, revision.revision_no, revision.revision_state,
        revision.content_digest, revision.confidence, revision.valid_from, revision.valid_to ?? null,
        revision.recorded_at, JSON.stringify(revision)]
    );
  }

  private async insertEvidence(client: PoolClient, evidence: readonly MemorySourceEvidence[]): Promise<void> {
    for (const item of evidence) {
      await client.query(
        `INSERT INTO pc_memory_source_evidence(source_evidence_id, tenant_id, source_kind,
         source_authority, source_object_id, source_version_id, sensitivity, captured_at,
         observed_at, evidence_digest, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [item.source_evidence_id, item.tenant_id, item.source_kind, item.source_authority,
          item.source_object_id, item.source_version_id ?? null, item.sensitivity, item.captured_at,
          item.observed_at, item.evidence_digest, JSON.stringify(item)]
      );
    }
  }

  private async insertRevisionEvidence(client: PoolClient, revision: MemoryRevision): Promise<void> {
    for (const [ordinal, evidenceId] of revision.source_evidence_ids.entries()) {
      await client.query(
        "INSERT INTO pc_memory_revision_evidence(revision_id, source_evidence_id, ordinal) VALUES ($1,$2,$3)",
        [revision.revision_id, evidenceId, ordinal]
      );
    }
  }

  private insertCommand(client: PoolClient, command: MemoryCommandRecord): Promise<unknown> {
    return client.query(
      `INSERT INTO pc_memory_command(command_id, tenant_id, principal_id, idempotency_key,
       command_kind, payload_digest, result, created_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [command.command_id, command.tenant_id, command.principal_id, command.idempotency_key,
        command.command_kind, command.payload_digest, JSON.stringify(command.result),
        command.created_at, command.completed_at]
    );
  }

  private insertDecision(client: PoolClient, decision: MemoryPolicyDecision): Promise<unknown> {
    return client.query(
      `INSERT INTO pc_memory_policy_decision(decision_id, tenant_id, principal_id, memory_id,
       revision_id, decision_kind, decision, authorization_revision, policy_revision,
       decided_at, decision_digest, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [decision.decision_id, decision.tenant_id, decision.principal_id, decision.memory_id ?? null,
        decision.revision_id ?? null, decision.decision_kind, decision.decision,
        decision.authorization_revision, decision.policy_revision, decision.decided_at,
        decision.decision_digest, JSON.stringify(decision)]
    );
  }

  private insertEvent(client: PoolClient, event: MemoryAuthorityEvent): Promise<unknown> {
    return client.query(
      `INSERT INTO pc_memory_authority_event(event_id, tenant_id, memory_id, revision_id,
       object_version, producer_sequence, change_kind, occurred_at, causation_command_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [event.event_id, event.tenant_id, event.memory_id, event.revision_id ?? null,
        event.object_version, event.producer_sequence, event.change_kind, event.occurred_at,
        event.causation_command_id, JSON.stringify(event)]
    );
  }
}
