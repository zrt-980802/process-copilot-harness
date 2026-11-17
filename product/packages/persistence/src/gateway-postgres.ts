import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow
} from "pg";
import type {
  ApprovalStatus,
  BusinessApprovalSnapshot,
  ConnectorRegistration,
  CredentialLeaseRecord,
  ExternalAccountBinding,
  ExternalOperationRecord,
  GatewayAuditEntry,
  GatewayRepository,
  McpSessionBinding
} from "@pc/gateway";
import { ControlledGatewayError } from "@pc/gateway";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS pc_gateway_connector (
  connector_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  state TEXT NOT NULL,
  registration_revision BIGINT NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_gateway_connector_tenant_state
  ON pc_gateway_connector(tenant_id, state);

CREATE TABLE IF NOT EXISTS pc_gateway_external_account (
  external_account_binding_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  status TEXT NOT NULL,
  credential_generation BIGINT NOT NULL,
  payload JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pc_gateway_external_account_one_active
  ON pc_gateway_external_account(tenant_id, connector_id, principal_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS pc_gateway_credential_lease (
  credential_lease_id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  credential_generation BIGINT NOT NULL,
  state TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS pc_gateway_mcp_binding (
  binding_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  pc_session_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  authorization_revision BIGINT NOT NULL,
  credential_generation BIGINT NOT NULL,
  tool_catalog_digest TEXT NOT NULL,
  state TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_gateway_mcp_binding_lookup
  ON pc_gateway_mcp_binding(
    tenant_id, principal_id, pc_session_id, connector_id,
    authorization_revision, credential_generation, tool_catalog_digest
  );

CREATE TABLE IF NOT EXISTS pc_gateway_approval (
  approval_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  approval_version BIGINT NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS pc_gateway_operation (
  operation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  dispatch_state TEXT NOT NULL,
  outcome_state TEXT NOT NULL,
  version BIGINT NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE (tenant_id, connector_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS pc_gateway_audit (
  audit_id TEXT PRIMARY KEY,
  operation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_gateway_audit_operation
  ON pc_gateway_audit(operation_id, occurred_at);
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

export class PostgresGatewayRepository implements GatewayRepository {
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

  async putConnector(
    connector: ConnectorRegistration
  ): Promise<ConnectorRegistration> {
    await this.pool.query(
      `INSERT INTO pc_gateway_connector (
         connector_id, tenant_id, state, registration_revision, payload
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (connector_id) DO NOTHING`,
      [
        connector.connector_id,
        connector.tenant_id,
        connector.state,
        connector.registration_revision,
        JSON.stringify(connector)
      ]
    );
    const current = await this.getConnector(connector.connector_id);
    if (current === undefined) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_CONNECTOR_PERSISTENCE_FAILED",
        "Connector could not be persisted"
      );
    }
    if (current.capability_digest !== connector.capability_digest) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_CONNECTOR_CONFLICT",
        "Connector ID already contains different registration content"
      );
    }
    return current;
  }

  async getConnector(
    connectorId: string
  ): Promise<ConnectorRegistration | undefined> {
    const result = await this.pool.query<PayloadRow<ConnectorRegistration>>(
      "SELECT payload FROM pc_gateway_connector WHERE connector_id = $1",
      [connectorId]
    );
    return result.rows[0]?.payload;
  }

  async findConnectorForTool(
    tenantId: string,
    toolReleaseId: string
  ): Promise<ConnectorRegistration | undefined> {
    const result = await this.pool.query<PayloadRow<ConnectorRegistration>>(
      `SELECT payload FROM pc_gateway_connector
       WHERE tenant_id = $1
         AND state = 'ACTIVE'
         AND payload->'tool_release_ids' ? $2
       ORDER BY connector_id
       LIMIT 1`,
      [tenantId, toolReleaseId]
    );
    return result.rows[0]?.payload;
  }

  async updateConnectorState(input: {
    connector_id: string;
    tenant_id: string;
    expected_revision: number;
    state: ConnectorRegistration["state"];
    updated_at: string;
  }): Promise<ConnectorRegistration> {
    const current = await this.getConnector(input.connector_id);
    if (
      current === undefined
      || current.tenant_id !== input.tenant_id
      || current.registration_revision !== input.expected_revision
    ) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_CONNECTOR_CAS_CONFLICT",
        "Connector registration revision changed",
        true
      );
    }
    const updated: ConnectorRegistration = {
      ...current,
      state: input.state,
      registration_revision: current.registration_revision + 1,
      updated_at: input.updated_at
    };
    const result = await this.pool.query(
      `UPDATE pc_gateway_connector
       SET state = $4, registration_revision = $5, payload = $6
       WHERE connector_id = $1
         AND tenant_id = $2
         AND registration_revision = $3`,
      [
        input.connector_id,
        input.tenant_id,
        input.expected_revision,
        updated.state,
        updated.registration_revision,
        JSON.stringify(updated)
      ]
    );
    if (result.rowCount !== 1) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_CONNECTOR_CAS_CONFLICT",
        "Connector registration revision changed",
        true
      );
    }
    return updated;
  }

  async putExternalAccountBinding(
    binding: ExternalAccountBinding
  ): Promise<ExternalAccountBinding> {
    try {
      await this.pool.query(
        `INSERT INTO pc_gateway_external_account (
           external_account_binding_id, tenant_id, connector_id, principal_id,
           status, credential_generation, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          binding.external_account_binding_id,
          binding.tenant_id,
          binding.connector_id,
          binding.principal_id,
          binding.status,
          binding.credential_generation,
          JSON.stringify(binding)
        ]
      );
      return binding;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ControlledGatewayError(
          "PC_GATEWAY_EXTERNAL_ACCOUNT_CONFLICT",
          "Principal already has an active account for this Connector"
        );
      }
      throw error;
    }
  }

  async getExternalAccountBinding(
    bindingId: string
  ): Promise<ExternalAccountBinding | undefined> {
    const result = await this.pool.query<PayloadRow<ExternalAccountBinding>>(
      `SELECT payload FROM pc_gateway_external_account
       WHERE external_account_binding_id = $1`,
      [bindingId]
    );
    return result.rows[0]?.payload;
  }

  async findExternalAccountBinding(
    tenantId: string,
    connectorId: string,
    principalId: string,
    includeInactive = false
  ): Promise<ExternalAccountBinding | undefined> {
    const result = await this.pool.query<PayloadRow<ExternalAccountBinding>>(
      `SELECT payload FROM pc_gateway_external_account
       WHERE tenant_id = $1
         AND connector_id = $2
         AND principal_id = $3
         AND ($4 OR status = 'ACTIVE')
       ORDER BY credential_generation DESC, external_account_binding_id LIMIT 1`,
      [tenantId, connectorId, principalId, includeInactive]
    );
    return result.rows[0]?.payload;
  }

  rotateExternalAccountBinding(input: {
    binding_id: string;
    tenant_id: string;
    principal_id: string;
    expected_generation: number;
    secret_ref: string;
    updated_at: string;
  }): Promise<ExternalAccountBinding> {
    return this.mutateAccount(input.binding_id, async (binding) => {
      if (
        binding.tenant_id !== input.tenant_id
        || binding.principal_id !== input.principal_id
        || binding.status !== "ACTIVE"
        || binding.credential_generation !== input.expected_generation
      ) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_CREDENTIAL_GENERATION_CONFLICT",
          "External Account Binding generation changed",
          true
        );
      }
      return {
        ...binding,
        secret_ref: input.secret_ref,
        credential_generation: binding.credential_generation + 1,
        updated_at: input.updated_at
      };
    });
  }

  revokeExternalAccountBinding(input: {
    binding_id: string;
    tenant_id: string;
    principal_id: string;
    expected_generation: number;
    revoked_at: string;
  }): Promise<ExternalAccountBinding> {
    return this.mutateAccount(input.binding_id, async (binding) => {
      if (
        binding.tenant_id !== input.tenant_id
        || binding.principal_id !== input.principal_id
        || binding.status !== "ACTIVE"
        || binding.credential_generation !== input.expected_generation
      ) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_CREDENTIAL_GENERATION_CONFLICT",
          "External Account Binding generation changed",
          true
        );
      }
      return {
        ...binding,
        status: "REVOKED",
        updated_at: input.revoked_at,
        revoked_at: input.revoked_at
      };
    });
  }

  async saveCredentialLease(record: CredentialLeaseRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO pc_gateway_credential_lease (
         credential_lease_id, connector_id, principal_id,
         credential_generation, state, expires_at, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (credential_lease_id) DO NOTHING`,
      [
        record.lease.credential_lease_id,
        record.lease.connector_id,
        record.principal_id,
        record.lease.generation,
        record.state,
        record.lease.expires_at,
        JSON.stringify(record)
      ]
    );
  }

  async getCredentialLease(
    leaseId: string
  ): Promise<CredentialLeaseRecord | undefined> {
    const result = await this.pool.query<PayloadRow<CredentialLeaseRecord>>(
      `SELECT payload FROM pc_gateway_credential_lease
       WHERE credential_lease_id = $1`,
      [leaseId]
    );
    return result.rows[0]?.payload;
  }

  async revokeStaleSecurityState(input: {
    connector_id: string;
    principal_id: string;
    minimum_generation: number;
    revoked_at: string;
  }): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `UPDATE pc_gateway_credential_lease
         SET state = 'REVOKED',
             payload = jsonb_set(
               jsonb_set(payload, '{state}', '"REVOKED"'::jsonb),
               '{revoked_at}', to_jsonb($4::text)
             )
         WHERE connector_id = $1
           AND principal_id = $2
           AND credential_generation < $3
           AND state = 'ACTIVE'`,
        [
          input.connector_id,
          input.principal_id,
          input.minimum_generation,
          input.revoked_at
        ]
      );
      await client.query(
        `UPDATE pc_gateway_mcp_binding
         SET state = 'REAUTH_REQUIRED',
             payload = jsonb_set(
               payload, '{state}', '"REAUTH_REQUIRED"'::jsonb
             )
         WHERE connector_id = $1
           AND principal_id = $2
           AND credential_generation < $3
           AND state = 'ACTIVE'`,
        [
          input.connector_id,
          input.principal_id,
          input.minimum_generation
        ]
      );
    });
  }

  async findMcpSessionBinding(input: {
    tenant_id: string;
    principal_id: string;
    pc_session_id: string;
    connector_id: string;
    authorization_revision: number;
    credential_generation: number;
    tool_catalog_digest: string;
    now: string;
  }): Promise<McpSessionBinding | undefined> {
    const result = await this.pool.query<PayloadRow<McpSessionBinding>>(
      `SELECT payload FROM pc_gateway_mcp_binding
       WHERE tenant_id = $1
         AND principal_id = $2
         AND pc_session_id = $3
         AND connector_id = $4
         AND authorization_revision = $5
         AND credential_generation = $6
         AND tool_catalog_digest = $7
         AND state = 'ACTIVE'
         AND expires_at > $8
       ORDER BY expires_at DESC
       LIMIT 1`,
      [
        input.tenant_id,
        input.principal_id,
        input.pc_session_id,
        input.connector_id,
        input.authorization_revision,
        input.credential_generation,
        input.tool_catalog_digest,
        input.now
      ]
    );
    return result.rows[0]?.payload;
  }

  async saveMcpSessionBinding(binding: McpSessionBinding): Promise<void> {
    await this.pool.query(
      `INSERT INTO pc_gateway_mcp_binding (
         binding_id, tenant_id, principal_id, pc_session_id, connector_id,
         authorization_revision, credential_generation, tool_catalog_digest,
         state, expires_at, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (binding_id) DO NOTHING`,
      [
        binding.binding_id,
        binding.tenant_id,
        binding.principal_id,
        binding.pc_session_id,
        binding.connector_id,
        binding.authorization_revision,
        binding.credential_generation,
        binding.tool_catalog_digest,
        binding.state,
        binding.expires_at,
        JSON.stringify(binding)
      ]
    );
  }

  async getMcpSessionBinding(
    bindingId: string
  ): Promise<McpSessionBinding | undefined> {
    const result = await this.pool.query<PayloadRow<McpSessionBinding>>(
      "SELECT payload FROM pc_gateway_mcp_binding WHERE binding_id = $1",
      [bindingId]
    );
    return result.rows[0]?.payload;
  }

  async saveApproval(approval: BusinessApprovalSnapshot): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pc_gateway_approval (
           approval_id, tenant_id, operation_id, status,
           approval_version, payload
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          approval.approval_id,
          approval.tenant_id,
          approval.operation_id,
          approval.status,
          approval.approval_version,
          JSON.stringify(approval)
        ]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ControlledGatewayError(
          "PC_GATEWAY_APPROVAL_CONFLICT",
          "Approval ID already exists"
        );
      }
      throw error;
    }
  }

  async getApproval(
    approvalId: string
  ): Promise<BusinessApprovalSnapshot | undefined> {
    const result = await this.pool.query<
      PayloadRow<BusinessApprovalSnapshot>
    >(
      "SELECT payload FROM pc_gateway_approval WHERE approval_id = $1",
      [approvalId]
    );
    return result.rows[0]?.payload;
  }

  async listApprovals(tenantId: string): Promise<BusinessApprovalSnapshot[]> {
    const result = await this.pool.query<PayloadRow<BusinessApprovalSnapshot>>(
      "SELECT payload FROM pc_gateway_approval WHERE tenant_id=$1 ORDER BY approval_id", [tenantId]);
    return result.rows.map((row) => row.payload);
  }

  async decideApproval(input: {
    approval_id: string;
    expected_version: number;
    expected_status: ApprovalStatus;
    status: ApprovalStatus;
    decision: BusinessApprovalSnapshot["decision"];
    decision_evidence_refs: string[];
    decided_at: string;
  }): Promise<BusinessApprovalSnapshot> {
    return transaction(this.pool, async (client) => {
      const result = await client.query<
        PayloadRow<BusinessApprovalSnapshot>
      >(
        `SELECT payload FROM pc_gateway_approval
         WHERE approval_id = $1
         FOR UPDATE`,
        [input.approval_id]
      );
      const current = result.rows[0]?.payload;
      if (
        current === undefined
        || current.approval_version !== input.expected_version
        || current.status !== input.expected_status
      ) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_APPROVAL_CAS_CONFLICT",
          "Approval version or status changed",
          true
        );
      }
      const updated: BusinessApprovalSnapshot = {
        ...current,
        approval_version: current.approval_version + 1,
        status: input.status,
        decision: input.decision,
        decision_evidence_refs: [...input.decision_evidence_refs],
        decided_at: input.decided_at
      };
      await client.query(
        `UPDATE pc_gateway_approval
         SET status = $2, approval_version = $3, payload = $4
         WHERE approval_id = $1`,
        [
          updated.approval_id,
          updated.status,
          updated.approval_version,
          JSON.stringify(updated)
        ]
      );
      return updated;
    });
  }

  async findOperationByIdempotency(
    tenantId: string,
    connectorId: string,
    idempotencyKey: string
  ): Promise<ExternalOperationRecord | undefined> {
    const result = await this.pool.query<
      PayloadRow<ExternalOperationRecord>
    >(
      `SELECT payload FROM pc_gateway_operation
       WHERE tenant_id = $1
         AND connector_id = $2
         AND idempotency_key = $3`,
      [tenantId, connectorId, idempotencyKey]
    );
    return result.rows[0]?.payload;
  }

  beginOperation(input: {
    operation: ExternalOperationRecord;
    approval_id?: string;
    approval_version?: number;
    now: string;
  }): Promise<{ operation: ExternalOperationRecord; created: boolean }> {
    return transaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [
          [
            input.operation.tenant_id,
            input.operation.connector_id,
            input.operation.idempotency_key
          ].join(":")
        ]
      );
      const existingResult = await client.query<
        PayloadRow<ExternalOperationRecord>
      >(
        `SELECT payload FROM pc_gateway_operation
         WHERE tenant_id = $1
           AND connector_id = $2
           AND idempotency_key = $3
         FOR UPDATE`,
        [
          input.operation.tenant_id,
          input.operation.connector_id,
          input.operation.idempotency_key
        ]
      );
      const existing = existingResult.rows[0]?.payload;
      if (existing !== undefined) {
        return { operation: existing, created: false };
      }
      if (input.approval_id !== undefined) {
        const approvalResult = await client.query<
          PayloadRow<BusinessApprovalSnapshot>
        >(
          `SELECT payload FROM pc_gateway_approval
           WHERE approval_id = $1
           FOR UPDATE`,
          [input.approval_id]
        );
        const approval = approvalResult.rows[0]?.payload;
        if (
          approval === undefined
          || input.approval_version === undefined
          || approval.approval_version !== input.approval_version
          || approval.status !== "APPROVED"
          || approval.operation_id !== input.operation.operation_id
          || input.operation.approval_id !== approval.approval_id
        ) {
          throw new ControlledGatewayError(
            "PC_GATEWAY_APPROVAL_CONSUME_CONFLICT",
            "Approval cannot be consumed for this operation",
            true
          );
        }
        const consumed: BusinessApprovalSnapshot = {
          ...approval,
          approval_version: approval.approval_version + 1,
          status: "CONSUMED",
          decision: {
            ...approval.decision,
            outcome: "CONSUME",
            reason_codes: [
              ...approval.decision.reason_codes,
              "approval_consumed"
            ]
          },
          decided_at: input.now
        };
        await client.query(
          `UPDATE pc_gateway_approval
           SET status = 'CONSUMED', approval_version = $2, payload = $3
           WHERE approval_id = $1`,
          [
            consumed.approval_id,
            consumed.approval_version,
            JSON.stringify(consumed)
          ]
        );
      }
      try {
        await client.query(
          `INSERT INTO pc_gateway_operation (
             operation_id, tenant_id, connector_id, idempotency_key,
             request_digest, dispatch_state, outcome_state, version, payload
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            input.operation.operation_id,
            input.operation.tenant_id,
            input.operation.connector_id,
            input.operation.idempotency_key,
            input.operation.request_digest,
            input.operation.dispatch_state,
            input.operation.outcome_state,
            input.operation.version,
            JSON.stringify(input.operation)
          ]
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ControlledGatewayError(
            "PC_GATEWAY_OPERATION_ID_CONFLICT",
            "Operation ID already exists"
          );
        }
        throw error;
      }
      return { operation: input.operation, created: true };
    });
  }

  async getOperation(
    operationId: string
  ): Promise<ExternalOperationRecord | undefined> {
    const result = await this.pool.query<
      PayloadRow<ExternalOperationRecord>
    >(
      "SELECT payload FROM pc_gateway_operation WHERE operation_id = $1",
      [operationId]
    );
    return result.rows[0]?.payload;
  }

  async updateOperation(
    operation: ExternalOperationRecord,
    expectedVersion: number
  ): Promise<ExternalOperationRecord> {
    const result = await this.pool.query(
      `UPDATE pc_gateway_operation
       SET dispatch_state = $3,
           outcome_state = $4,
           version = $5,
           payload = $6
       WHERE operation_id = $1 AND version = $2`,
      [
        operation.operation_id,
        expectedVersion,
        operation.dispatch_state,
        operation.outcome_state,
        operation.version,
        JSON.stringify(operation)
      ]
    );
    if (result.rowCount !== 1) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_OPERATION_CAS_CONFLICT",
        "Operation version changed",
        true
      );
    }
    return operation;
  }

  async appendAudit(entry: GatewayAuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO pc_gateway_audit (
         audit_id, operation_id, occurred_at, payload
       ) VALUES ($1, $2, $3, $4)`,
      [
        entry.audit_id,
        entry.operation_id ?? null,
        entry.occurred_at,
        JSON.stringify(entry)
      ]
    );
  }

  async listAudit(operationId: string): Promise<GatewayAuditEntry[]> {
    const result = await this.pool.query<PayloadRow<GatewayAuditEntry>>(
      `SELECT payload FROM pc_gateway_audit
       WHERE operation_id = $1
       ORDER BY occurred_at, audit_id`,
      [operationId]
    );
    return result.rows.map((row) => row.payload);
  }

  private mutateAccount(
    bindingId: string,
    mutate: (
      binding: ExternalAccountBinding
    ) => Promise<ExternalAccountBinding>
  ): Promise<ExternalAccountBinding> {
    return transaction(this.pool, async (client) => {
      const result = await client.query<
        PayloadRow<ExternalAccountBinding>
      >(
        `SELECT payload FROM pc_gateway_external_account
         WHERE external_account_binding_id = $1
         FOR UPDATE`,
        [bindingId]
      );
      const binding = result.rows[0]?.payload;
      if (binding === undefined) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_EXTERNAL_ACCOUNT_NOT_FOUND",
          "External Account Binding was not found"
        );
      }
      const updated = await mutate(binding);
      await client.query(
        `UPDATE pc_gateway_external_account
         SET status = $2, credential_generation = $3, payload = $4
         WHERE external_account_binding_id = $1`,
        [
          updated.external_account_binding_id,
          updated.status,
          updated.credential_generation,
          JSON.stringify(updated)
        ]
      );
      return updated;
    });
  }
}
