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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function index(...parts: string[]): string {
  return parts.join("\u0000");
}

export class MemoryGatewayRepository implements GatewayRepository {
  private readonly connectors = new Map<string, ConnectorRegistration>();
  private readonly accounts = new Map<string, ExternalAccountBinding>();
  private readonly leases = new Map<string, CredentialLeaseRecord>();
  private readonly mcpBindings = new Map<string, McpSessionBinding>();
  private readonly approvals = new Map<string, BusinessApprovalSnapshot>();
  private readonly operations = new Map<string, ExternalOperationRecord>();
  private readonly idempotency = new Map<string, string>();
  private readonly audits: GatewayAuditEntry[] = [];

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  putConnector(
    connector: ConnectorRegistration
  ): Promise<ConnectorRegistration> {
    const current = this.connectors.get(connector.connector_id);
    if (
      current !== undefined
      && current.capability_digest !== connector.capability_digest
    ) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_CONNECTOR_CONFLICT",
        "Connector ID already contains different registration content"
      );
    }
    if (current === undefined) {
      this.connectors.set(connector.connector_id, clone(connector));
    }
    return Promise.resolve(clone(current ?? connector));
  }

  getConnector(
    connectorId: string
  ): Promise<ConnectorRegistration | undefined> {
    const connector = this.connectors.get(connectorId);
    return Promise.resolve(
      connector === undefined ? undefined : clone(connector)
    );
  }

  findConnectorForTool(
    tenantId: string,
    toolReleaseId: string
  ): Promise<ConnectorRegistration | undefined> {
    const connector = [...this.connectors.values()].find((candidate) =>
      candidate.tenant_id === tenantId
      && candidate.state === "ACTIVE"
      && candidate.tool_release_ids.includes(toolReleaseId)
    );
    return Promise.resolve(
      connector === undefined ? undefined : clone(connector)
    );
  }

  updateConnectorState(input: {
    connector_id: string;
    tenant_id: string;
    expected_revision: number;
    state: ConnectorRegistration["state"];
    updated_at: string;
  }): Promise<ConnectorRegistration> {
    const connector = this.connectors.get(input.connector_id);
    if (
      connector === undefined
      || connector.tenant_id !== input.tenant_id
      || connector.registration_revision !== input.expected_revision
    ) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_CONNECTOR_CAS_CONFLICT",
        "Connector registration revision changed",
        true
      );
    }
    const updated: ConnectorRegistration = {
      ...connector,
      state: input.state,
      registration_revision: connector.registration_revision + 1,
      updated_at: input.updated_at
    };
    this.connectors.set(updated.connector_id, updated);
    return Promise.resolve(clone(updated));
  }

  putExternalAccountBinding(
    binding: ExternalAccountBinding
  ): Promise<ExternalAccountBinding> {
    const conflict = [...this.accounts.values()].find((candidate) =>
      candidate.tenant_id === binding.tenant_id
      && candidate.connector_id === binding.connector_id
      && candidate.principal_id === binding.principal_id
      && candidate.status === "ACTIVE"
    );
    if (conflict !== undefined) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_EXTERNAL_ACCOUNT_CONFLICT",
        "Principal already has an active account for this Connector"
      );
    }
    this.accounts.set(
      binding.external_account_binding_id,
      clone(binding)
    );
    return Promise.resolve(clone(binding));
  }

  getExternalAccountBinding(
    bindingId: string
  ): Promise<ExternalAccountBinding | undefined> {
    const binding = this.accounts.get(bindingId);
    return Promise.resolve(binding === undefined ? undefined : clone(binding));
  }

  listActiveExternalAccountBindings(tenantId: string, connectorId: string, principalId: string): Promise<ExternalAccountBinding[]> {
    return Promise.resolve([...this.accounts.values()].filter(account => account.tenant_id === tenantId
      && account.connector_id === connectorId && account.principal_id === principalId && account.status === "ACTIVE").map(clone));
  }

  findExternalAccountBinding(
    tenantId: string,
    connectorId: string,
    principalId: string,
    includeInactive = false
  ): Promise<ExternalAccountBinding | undefined> {
    const binding = [...this.accounts.values()].find((candidate) =>
      candidate.tenant_id === tenantId
      && candidate.connector_id === connectorId
      && candidate.principal_id === principalId
      && (includeInactive || candidate.status === "ACTIVE")
    );
    return Promise.resolve(binding === undefined ? undefined : clone(binding));
  }

  rotateExternalAccountBinding(input: {
    binding_id: string;
    tenant_id: string;
    principal_id: string;
    expected_generation: number;
    secret_ref: string;
    updated_at: string;
  }): Promise<ExternalAccountBinding> {
    const binding = this.requireAccount(input.binding_id);
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
    const updated: ExternalAccountBinding = {
      ...binding,
      secret_ref: input.secret_ref,
      credential_generation: binding.credential_generation + 1,
      updated_at: input.updated_at
    };
    this.accounts.set(updated.external_account_binding_id, updated);
    return Promise.resolve(clone(updated));
  }

  revokeExternalAccountBinding(input: {
    binding_id: string;
    tenant_id: string;
    principal_id: string;
    expected_generation: number;
    revoked_at: string;
  }): Promise<ExternalAccountBinding> {
    const binding = this.requireAccount(input.binding_id);
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
    const updated: ExternalAccountBinding = {
      ...binding,
      status: "REVOKED",
      updated_at: input.revoked_at,
      revoked_at: input.revoked_at
    };
    this.accounts.set(updated.external_account_binding_id, updated);
    return Promise.resolve(clone(updated));
  }

  saveCredentialLease(record: CredentialLeaseRecord): Promise<void> {
    this.leases.set(record.lease.credential_lease_id, clone(record));
    return Promise.resolve();
  }

  getCredentialLease(
    leaseId: string
  ): Promise<CredentialLeaseRecord | undefined> {
    const lease = this.leases.get(leaseId);
    return Promise.resolve(lease === undefined ? undefined : clone(lease));
  }

  revokeStaleSecurityState(input: {
    connector_id: string;
    principal_id: string;
    minimum_generation: number;
    revoked_at: string;
  }): Promise<void> {
    for (const [leaseId, record] of this.leases) {
      if (
        record.lease.connector_id === input.connector_id
        && record.principal_id === input.principal_id
        && record.lease.generation < input.minimum_generation
        && record.state === "ACTIVE"
      ) {
        this.leases.set(leaseId, {
          ...record,
          state: "REVOKED",
          revoked_at: input.revoked_at
        });
      }
    }
    for (const [bindingId, binding] of this.mcpBindings) {
      if (
        binding.connector_id === input.connector_id
        && binding.principal_id === input.principal_id
        && binding.credential_generation < input.minimum_generation
        && binding.state === "ACTIVE"
      ) {
        this.mcpBindings.set(bindingId, {
          ...binding,
          state: "REAUTH_REQUIRED"
        });
      }
    }
    return Promise.resolve();
  }

  findMcpSessionBinding(input: {
    tenant_id: string;
    principal_id: string;
    pc_session_id: string;
    connector_id: string;
    authorization_revision: number;
    credential_generation: number;
    tool_catalog_digest: string;
    now: string;
  }): Promise<McpSessionBinding | undefined> {
    const binding = [...this.mcpBindings.values()].find((candidate) =>
      candidate.tenant_id === input.tenant_id
      && candidate.principal_id === input.principal_id
      && candidate.pc_session_id === input.pc_session_id
      && candidate.connector_id === input.connector_id
      && candidate.authorization_revision === input.authorization_revision
      && candidate.credential_generation === input.credential_generation
      && candidate.tool_catalog_digest === input.tool_catalog_digest
      && candidate.state === "ACTIVE"
      && Date.parse(candidate.expires_at) > Date.parse(input.now)
    );
    return Promise.resolve(binding === undefined ? undefined : clone(binding));
  }

  saveMcpSessionBinding(binding: McpSessionBinding): Promise<void> {
    this.mcpBindings.set(binding.binding_id, clone(binding));
    return Promise.resolve();
  }

  getMcpSessionBinding(
    bindingId: string
  ): Promise<McpSessionBinding | undefined> {
    const binding = this.mcpBindings.get(bindingId);
    return Promise.resolve(binding === undefined ? undefined : clone(binding));
  }

  saveApproval(approval: BusinessApprovalSnapshot): Promise<void> {
    if (this.approvals.has(approval.approval_id)) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_APPROVAL_CONFLICT",
        "Approval ID already exists"
      );
    }
    this.approvals.set(approval.approval_id, clone(approval));
    return Promise.resolve();
  }

  getApproval(
    approvalId: string
  ): Promise<BusinessApprovalSnapshot | undefined> {
    const approval = this.approvals.get(approvalId);
    return Promise.resolve(
      approval === undefined ? undefined : clone(approval)
    );
  }

  listApprovals(tenantId: string): Promise<BusinessApprovalSnapshot[]> {
    return Promise.resolve([...this.approvals.values()].filter((item) => item.tenant_id === tenantId).map(clone));
  }

  decideApproval(input: {
    approval_id: string;
    expected_version: number;
    expected_status: ApprovalStatus;
    status: ApprovalStatus;
    decision: BusinessApprovalSnapshot["decision"];
    decision_evidence_refs: string[];
    decided_at: string;
  }): Promise<BusinessApprovalSnapshot> {
    const approval = this.requireApproval(input.approval_id);
    if (
      approval.approval_version !== input.expected_version
      || approval.status !== input.expected_status
    ) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_APPROVAL_CAS_CONFLICT",
        "Approval version or status changed",
        true
      );
    }
    const updated: BusinessApprovalSnapshot = {
      ...approval,
      approval_version: approval.approval_version + 1,
      status: input.status,
      decision: clone(input.decision),
      decision_evidence_refs: [...input.decision_evidence_refs],
      decided_at: input.decided_at
    };
    this.approvals.set(updated.approval_id, updated);
    return Promise.resolve(clone(updated));
  }

  findOperationByIdempotency(
    tenantId: string,
    connectorId: string,
    idempotencyKey: string
  ): Promise<ExternalOperationRecord | undefined> {
    const operationId = this.idempotency.get(
      index(tenantId, connectorId, idempotencyKey)
    );
    const operation = operationId === undefined
      ? undefined
      : this.operations.get(operationId);
    return Promise.resolve(
      operation === undefined ? undefined : clone(operation)
    );
  }

  beginOperation(input: {
    operation: ExternalOperationRecord;
    approval_id?: string;
    approval_version?: number;
    now: string;
  }): Promise<{ operation: ExternalOperationRecord; created: boolean }> {
    const idempotencyIndex = index(
      input.operation.tenant_id,
      input.operation.connector_id,
      input.operation.idempotency_key
    );
    const existingId = this.idempotency.get(idempotencyIndex);
    if (existingId !== undefined) {
      const existing = this.operations.get(existingId);
      if (existing === undefined) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_OPERATION_CORRUPT",
          "Idempotency index points to a missing operation"
        );
      }
      return Promise.resolve({ operation: clone(existing), created: false });
    }
    if (this.operations.has(input.operation.operation_id)) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_OPERATION_ID_CONFLICT",
        "Operation ID already exists"
      );
    }
    if (input.approval_id !== undefined) {
      const approval = this.requireApproval(input.approval_id);
      if (
        input.approval_version === undefined
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
      this.approvals.set(approval.approval_id, {
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
      });
    }
    this.operations.set(
      input.operation.operation_id,
      clone(input.operation)
    );
    this.idempotency.set(idempotencyIndex, input.operation.operation_id);
    return Promise.resolve({
      operation: clone(input.operation),
      created: true
    });
  }

  getOperation(
    operationId: string
  ): Promise<ExternalOperationRecord | undefined> {
    const operation = this.operations.get(operationId);
    return Promise.resolve(
      operation === undefined ? undefined : clone(operation)
    );
  }

  updateOperation(
    operation: ExternalOperationRecord,
    expectedVersion: number
  ): Promise<ExternalOperationRecord> {
    const current = this.operations.get(operation.operation_id);
    if (current === undefined || current.version !== expectedVersion) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_OPERATION_CAS_CONFLICT",
        "Operation version changed",
        true
      );
    }
    this.operations.set(operation.operation_id, clone(operation));
    return Promise.resolve(clone(operation));
  }

  appendAudit(entry: GatewayAuditEntry): Promise<void> {
    this.audits.push(clone(entry));
    return Promise.resolve();
  }

  listAudit(operationId: string): Promise<GatewayAuditEntry[]> {
    return Promise.resolve(
      this.audits
        .filter((entry) => entry.operation_id === operationId)
        .map(clone)
    );
  }

  private requireAccount(bindingId: string): ExternalAccountBinding {
    const binding = this.accounts.get(bindingId);
    if (binding === undefined) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_EXTERNAL_ACCOUNT_NOT_FOUND",
        "External Account Binding was not found"
      );
    }
    return binding;
  }

  private requireApproval(approvalId: string): BusinessApprovalSnapshot {
    const approval = this.approvals.get(approvalId);
    if (approval === undefined) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_APPROVAL_NOT_FOUND",
        "Approval was not found"
      );
    }
    return approval;
  }
}
