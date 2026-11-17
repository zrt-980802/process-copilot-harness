import {
  Pool,
  type PoolConfig,
  type QueryResultRow
} from "pg";
import type {
  SstsConversationMessage,
  SstsDraftAuditEntry,
  SstsDraftGeneration,
  SstsDraftRepository,
  SstsDraftRevision,
  SstsDraftReview,
  SstsGenerationState,
  SstsTaskInput,
  SstsTaskWorkspace
} from "@pc/ssts-draft";
import { SstsDraftError } from "@pc/ssts-draft";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS pc_ssts_workspace (
  workspace_id TEXT PRIMARY KEY,
  business_task_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  state TEXT NOT NULL,
  version BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_ssts_workspace_owner
  ON pc_ssts_workspace(tenant_id, owner_principal_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS pc_ssts_input (
  workspace_id TEXT NOT NULL REFERENCES pc_ssts_workspace(workspace_id) ON DELETE RESTRICT,
  slot TEXT NOT NULL,
  revision BIGINT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (workspace_id, slot)
);

CREATE TABLE IF NOT EXISTS pc_ssts_message (
  message_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES pc_ssts_workspace(workspace_id) ON DELETE RESTRICT,
  sequence BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE (workspace_id, sequence)
);

CREATE TABLE IF NOT EXISTS pc_ssts_generation (
  generation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES pc_ssts_workspace(workspace_id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS pc_ssts_draft (
  draft_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES pc_ssts_workspace(workspace_id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE (workspace_id, revision)
);

CREATE TABLE IF NOT EXISTS pc_ssts_review (
  review_id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE REFERENCES pc_ssts_draft(draft_id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES pc_ssts_workspace(workspace_id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS pc_ssts_audit (
  audit_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES pc_ssts_workspace(workspace_id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_ssts_audit_workspace
  ON pc_ssts_audit(workspace_id, occurred_at);
`;

interface PayloadRow<T> extends QueryResultRow {
  payload: T;
}

function conflict(error: unknown, code: string, message: string): never {
  if (
    error instanceof Error
    && "code" in error
    && (error as { code?: string }).code === "23505"
  ) {
    throw new SstsDraftError(code, message, true);
  }
  throw error;
}

export class PostgresSstsDraftRepository implements SstsDraftRepository {
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

  async createWorkspace(workspace: SstsTaskWorkspace): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_ssts_workspace (
           workspace_id, business_task_id, tenant_id, owner_principal_id,
           state, version, updated_at, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          workspace.workspace_id,
          workspace.business_task_id,
          workspace.tenant_id,
          workspace.owner_principal_id,
          workspace.state,
          workspace.version,
          workspace.updated_at,
          JSON.stringify(workspace)
        ]
      );
    } catch (error) {
      conflict(
        error,
        "PC_SSTS_WORKSPACE_CONFLICT",
        "SSTS Task Workspace already exists"
      );
    }
  }

  async getWorkspace(
    workspaceId: string
  ): Promise<SstsTaskWorkspace | undefined> {
    const result = await this.pool.query<PayloadRow<SstsTaskWorkspace>>(
      "SELECT payload FROM pc_ssts_workspace WHERE workspace_id = $1",
      [workspaceId]
    );
    return result.rows[0]?.payload;
  }

  async listWorkspaces(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<SstsTaskWorkspace[]> {
    const result = await this.pool.query<PayloadRow<SstsTaskWorkspace>>(
      `SELECT payload FROM pc_ssts_workspace
       WHERE tenant_id = $1 AND owner_principal_id = $2
       ORDER BY updated_at DESC`,
      [tenantId, ownerPrincipalId]
    );
    return result.rows.map((row) => row.payload);
  }

  async updateWorkspace(
    workspace: SstsTaskWorkspace,
    expectedVersion: number
  ): Promise<SstsTaskWorkspace> {
    const result = await this.pool.query(
      `UPDATE pc_ssts_workspace
       SET state = $2, version = $3, updated_at = $4, payload = $5::jsonb
       WHERE workspace_id = $1 AND version = $6`,
      [
        workspace.workspace_id,
        workspace.state,
        workspace.version,
        workspace.updated_at,
        JSON.stringify(workspace),
        expectedVersion
      ]
    );
    if (result.rowCount !== 1) {
      throw new SstsDraftError(
        "PC_SSTS_WORKSPACE_CAS_CONFLICT",
        "SSTS Task Workspace version changed",
        true
      );
    }
    return workspace;
  }

  async putInput(input: SstsTaskInput): Promise<SstsTaskInput> {
    const result = await this.pool.query(
      `INSERT INTO pc_ssts_input (workspace_id, slot, revision, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (workspace_id, slot) DO UPDATE
       SET revision = EXCLUDED.revision, payload = EXCLUDED.payload
       WHERE pc_ssts_input.revision = EXCLUDED.revision - 1`,
      [
        input.workspace_id,
        input.slot,
        input.revision,
        JSON.stringify(input)
      ]
    );
    if (result.rowCount !== 1) {
      throw new SstsDraftError(
        "PC_SSTS_INPUT_CAS_CONFLICT",
        "SSTS input revision changed",
        true
      );
    }
    return input;
  }

  async listInputs(workspaceId: string): Promise<SstsTaskInput[]> {
    const result = await this.pool.query<PayloadRow<SstsTaskInput>>(
      `SELECT payload FROM pc_ssts_input
       WHERE workspace_id = $1 ORDER BY slot`,
      [workspaceId]
    );
    return result.rows.map((row) => row.payload);
  }

  async appendMessage(message: SstsConversationMessage): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_ssts_message (
           message_id, workspace_id, sequence, created_at, payload
         ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          message.message_id,
          message.workspace_id,
          message.sequence,
          message.created_at,
          JSON.stringify(message)
        ]
      );
    } catch (error) {
      conflict(
        error,
        "PC_SSTS_MESSAGE_SEQUENCE_CONFLICT",
        "SSTS message sequence already exists"
      );
    }
  }

  async listMessages(
    workspaceId: string
  ): Promise<SstsConversationMessage[]> {
    const result = await this.pool.query<PayloadRow<SstsConversationMessage>>(
      `SELECT payload FROM pc_ssts_message
       WHERE workspace_id = $1 ORDER BY sequence`,
      [workspaceId]
    );
    return result.rows.map((row) => row.payload);
  }

  async createGeneration(generation: SstsDraftGeneration): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_ssts_generation (
           generation_id, workspace_id, idempotency_key, state, updated_at, payload
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          generation.generation_id,
          generation.workspace_id,
          generation.idempotency_key,
          generation.state,
          generation.updated_at,
          JSON.stringify(generation)
        ]
      );
    } catch (error) {
      conflict(
        error,
        "PC_SSTS_GENERATION_CONFLICT",
        "SSTS generation or idempotency key already exists"
      );
    }
  }

  async updateGeneration(
    generation: SstsDraftGeneration,
    expectedState: SstsGenerationState
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE pc_ssts_generation
       SET state = $2, updated_at = $3, payload = $4::jsonb
       WHERE generation_id = $1 AND state = $5`,
      [
        generation.generation_id,
        generation.state,
        generation.updated_at,
        JSON.stringify(generation),
        expectedState
      ]
    );
    if (result.rowCount !== 1) {
      throw new SstsDraftError(
        "PC_SSTS_GENERATION_CAS_CONFLICT",
        "SSTS generation state changed",
        true
      );
    }
  }

  async findGeneration(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<SstsDraftGeneration | undefined> {
    const result = await this.pool.query<PayloadRow<SstsDraftGeneration>>(
      `SELECT payload FROM pc_ssts_generation
       WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey]
    );
    return result.rows[0]?.payload;
  }

  async listInProgressGenerations(): Promise<SstsDraftGeneration[]> {
    return (await this.pool.query<PayloadRow<SstsDraftGeneration>>(
      "SELECT payload FROM pc_ssts_generation WHERE state = 'IN_PROGRESS' ORDER BY updated_at"
    )).rows.map((row) => row.payload);
  }

  async saveDraft(draft: SstsDraftRevision): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_ssts_draft (
           draft_id, workspace_id, revision, created_at, payload
         ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          draft.draft_id,
          draft.workspace_id,
          draft.revision,
          draft.created_at,
          JSON.stringify(draft)
        ]
      );
    } catch (error) {
      conflict(error, "PC_SSTS_DRAFT_CONFLICT", "SSTS Draft already exists");
    }
  }

  async getDraft(draftId: string): Promise<SstsDraftRevision | undefined> {
    const result = await this.pool.query<PayloadRow<SstsDraftRevision>>(
      "SELECT payload FROM pc_ssts_draft WHERE draft_id = $1",
      [draftId]
    );
    return result.rows[0]?.payload;
  }

  async listDrafts(workspaceId: string): Promise<SstsDraftRevision[]> {
    const result = await this.pool.query<PayloadRow<SstsDraftRevision>>(
      `SELECT payload FROM pc_ssts_draft
       WHERE workspace_id = $1 ORDER BY revision`,
      [workspaceId]
    );
    return result.rows.map((row) => row.payload);
  }

  async saveReview(review: SstsDraftReview): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_ssts_review (
           review_id, draft_id, workspace_id, reviewed_at, payload
         ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          review.review_id,
          review.draft_id,
          review.workspace_id,
          review.reviewed_at,
          JSON.stringify(review)
        ]
      );
    } catch (error) {
      conflict(
        error,
        "PC_SSTS_REVIEW_CONFLICT",
        "SSTS Draft already has a human review"
      );
    }
  }

  async getReview(draftId: string): Promise<SstsDraftReview | undefined> {
    const result = await this.pool.query<PayloadRow<SstsDraftReview>>(
      "SELECT payload FROM pc_ssts_review WHERE draft_id = $1",
      [draftId]
    );
    return result.rows[0]?.payload;
  }

  async appendAudit(entry: SstsDraftAuditEntry): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_ssts_audit (
           audit_id, workspace_id, occurred_at, payload
         ) VALUES ($1, $2, $3, $4::jsonb)`,
        [
          entry.audit_id,
          entry.workspace_id,
          entry.occurred_at,
          JSON.stringify(entry)
        ]
      );
    } catch (error) {
      conflict(
        error,
        "PC_SSTS_AUDIT_CONFLICT",
        "SSTS audit entry already exists"
      );
    }
  }

  async listAudit(workspaceId: string): Promise<SstsDraftAuditEntry[]> {
    const result = await this.pool.query<PayloadRow<SstsDraftAuditEntry>>(
      `SELECT payload FROM pc_ssts_audit
       WHERE workspace_id = $1 ORDER BY occurred_at`,
      [workspaceId]
    );
    return result.rows.map((row) => row.payload);
  }
}
