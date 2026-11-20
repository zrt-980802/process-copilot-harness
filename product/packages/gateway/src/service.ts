import { createHash, randomUUID } from "node:crypto";
import type { ToolRelease } from "@pc/domain";
import type {
  ApprovalStatus,
  BusinessApprovalSnapshot,
  ConnectorRegistration,
  CredentialIssuerPort,
  CredentialLeaseRecord,
  ExternalAccountBinding,
  ExternalOperationRecord,
  GatewayAuditEntry,
  GatewayEventPublisherPort,
  GatewayIdentityPort,
  GatewayProfilePort,
  GatewayProviderPort,
  GatewayRepository,
  GatewayRuntimePort,
  GatewayWorkspacePort,
  McpSessionBinding,
  OperationKind,
  ToolExecutionEnvelope,
  ToolExecutionResult
} from "./types.js";
import {
  ControlledGatewayError as GatewayError,
  GatewayProviderError
} from "./types.js";

const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_MCP_BINDING_TTL_MS = 5 * 60_000;
const DEFAULT_APPROVAL_TTL_MS = 10 * 60_000;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new GatewayError(
      "PC_GATEWAY_INVALID_ARGUMENT",
      `${field} is required`,
      false,
      { field }
    );
  }
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GatewayError(
      "PC_GATEWAY_INVALID_ARGUMENT",
      `${field} must be a positive integer`,
      false,
      { field }
    );
  }
  return value;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new GatewayError(
        "PC_GATEWAY_NON_JSON_ARGUMENT",
        "Arguments contain a non-finite number"
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  throw new GatewayError(
    "PC_GATEWAY_NON_JSON_ARGUMENT",
    "Arguments contain a non-JSON value"
  );
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => required(value, "list item")))].sort();
}

function risk(tool: ToolRelease): {
  operation_kind: OperationKind;
  risk_class: BusinessApprovalSnapshot["risk_class"];
  requires_readback: boolean;
} {
  const manifest = tool.risk_manifest;
  const actionClass = manifest.action_class;
  const sensitivity = manifest.sensitivity;
  if (
    actionClass !== "READ"
    && actionClass !== "WRITE"
    && actionClass !== "DESTRUCTIVE"
    && actionClass !== "EXTERNAL_SIDE_EFFECT"
  ) {
    throw new GatewayError(
      "PC_GATEWAY_TOOL_RISK_UNCLASSIFIED",
      "Tool Release has no supported action class"
    );
  }
  if (
    sensitivity !== "LOW"
    && sensitivity !== "MEDIUM"
    && sensitivity !== "HIGH"
    && sensitivity !== "CRITICAL"
  ) {
    throw new GatewayError(
      "PC_GATEWAY_TOOL_RISK_UNCLASSIFIED",
      "Tool Release has no supported sensitivity"
    );
  }
  return {
    operation_kind: actionClass,
    risk_class: sensitivity,
    requires_readback: manifest.requires_readback === true
  };
}

function targetDigest(input: {
  connector_id: string;
  tool_release_id: string;
  resource_scope_refs: readonly string[];
  workspace_view_snapshot_ref?: string;
}): string {
  return digest({
    connector_id: input.connector_id,
    tool_release_id: input.tool_release_id,
    resource_scope_refs: unique(input.resource_scope_refs),
    workspace_view_snapshot_ref: input.workspace_view_snapshot_ref ?? null
  });
}

function resultFor(
  operationId: string,
  input: Omit<
    ToolExecutionResult,
    "contract_name" | "contract_version" | "operation_id" | "result_digest"
  >
): ToolExecutionResult {
  const semantic = {
    status: input.status,
    ...(input.provider_operation_id === undefined
      ? {}
      : { provider_operation_id: input.provider_operation_id }),
    result: clone(input.result),
    external_evidence_refs: [...input.external_evidence_refs],
    retryable: input.retryable,
    outcome_state: input.outcome_state,
    reconciliation_required: input.reconciliation_required,
    completed_at: input.completed_at
  };
  return {
    contract_name: "pc.tool-execution-result/1",
    contract_version: 1,
    operation_id: operationId,
    ...semantic,
    result_digest: digest(semantic)
  };
}

export class ControlledExecutionGatewayService {
  constructor(
    private readonly repository: GatewayRepository,
    private readonly identity: GatewayIdentityPort,
    private readonly profiles: GatewayProfilePort,
    private readonly runtime: GatewayRuntimePort,
    private readonly workspace: GatewayWorkspacePort,
    private readonly credentialIssuer: CredentialIssuerPort,
    private readonly provider: GatewayProviderPort,
    private readonly now: () => Date = () => new Date(),
    private readonly eventPublisher?: GatewayEventPublisherPort
  ) {}

  initialize(): Promise<void> {
    return this.repository.initialize();
  }

  close(): Promise<void> {
    return this.repository.close();
  }

  async registerConnector(input: {
    tenant_id: string;
    mcp_server_id: string;
    endpoint_ref: string;
    provider_key: string;
    auth_mode: ConnectorRegistration["auth_mode"];
    audience: string;
    allowed_scopes: string[];
    tool_release_ids: string[];
    capability_digest: string;
  }, options: { registration_key?: string } = {}): Promise<ConnectorRegistration> {
    const tools = unique(input.tool_release_ids);
    if (tools.length === 0) {
      throw new GatewayError(
        "PC_GATEWAY_CONNECTOR_TOOLS_REQUIRED",
        "Connector requires at least one exact Tool Release"
      );
    }
    for (const toolId of tools) {
      const tool = await this.profiles.getToolRelease(toolId);
      if (tool === undefined || tool.status !== "PUBLISHED") {
        throw new GatewayError(
          "PC_GATEWAY_TOOL_RELEASE_UNAVAILABLE",
          `Tool Release is unavailable: ${toolId}`
        );
      }
      risk(tool);
    }
    const now = this.now().toISOString();
    return this.repository.putConnector({
      connector_id: options.registration_key === undefined
        ? `connector_${randomUUID()}`
        : `connector_${digest({ ...input, registration_key: options.registration_key }).slice(7)}`,
      tenant_id: required(input.tenant_id, "tenant_id"),
      mcp_server_id: required(input.mcp_server_id, "mcp_server_id"),
      endpoint_ref: required(input.endpoint_ref, "endpoint_ref"),
      provider_key: required(input.provider_key, "provider_key"),
      auth_mode: input.auth_mode,
      audience: required(input.audience, "audience"),
      allowed_scopes: unique(input.allowed_scopes),
      tool_release_ids: tools,
      state: "ACTIVE",
      registration_revision: 1,
      capability_digest: required(
        input.capability_digest,
        "capability_digest"
      ),
      created_at: now,
      updated_at: now
    });
  }

  updateConnectorState(input: {
    tenant_id: string;
    connector_id: string;
    expected_revision: number;
    state: ConnectorRegistration["state"];
  }): Promise<ConnectorRegistration> {
    return this.repository.updateConnectorState({
      ...input,
      updated_at: this.now().toISOString()
    });
  }

  async bindExternalAccount(input: {
    tenant_id: string;
    connector_id: string;
    principal_id: string;
    external_account_id: string;
    credential_subject: string;
    secret_ref: string;
  }): Promise<ExternalAccountBinding> {
    const connector = await this.requireConnector(input.connector_id);
    if (connector.tenant_id !== input.tenant_id || connector.state !== "ACTIVE") {
      throw new GatewayError(
        "PC_GATEWAY_CONNECTOR_UNAVAILABLE",
        "Connector is unavailable for this tenant"
      );
    }
    const now = this.now().toISOString();
    return this.repository.putExternalAccountBinding({
      external_account_binding_id: `account_binding_${randomUUID()}`,
      tenant_id: input.tenant_id,
      connector_id: connector.connector_id,
      principal_id: required(input.principal_id, "principal_id"),
      external_account_id: required(
        input.external_account_id,
        "external_account_id"
      ),
      credential_subject: required(
        input.credential_subject,
        "credential_subject"
      ),
      secret_ref: required(input.secret_ref, "secret_ref"),
      status: "ACTIVE",
      credential_generation: 1,
      created_at: now,
      updated_at: now
    });
  }

  async rotateExternalAccount(input: {
    tenant_id: string;
    principal_id: string;
    binding_id: string;
    expected_generation: number;
    secret_ref: string;
  }): Promise<ExternalAccountBinding> {
    const now = this.now().toISOString();
    const binding = await this.repository.rotateExternalAccountBinding({
      ...input,
      updated_at: now
    });
    await this.repository.revokeStaleSecurityState({
      connector_id: binding.connector_id,
      principal_id: binding.principal_id,
      minimum_generation: binding.credential_generation,
      revoked_at: now
    });
    return binding;
  }

  async revokeExternalAccount(input: {
    tenant_id: string;
    principal_id: string;
    binding_id: string;
    expected_generation: number;
  }): Promise<ExternalAccountBinding> {
    const now = this.now().toISOString();
    const binding = await this.repository.revokeExternalAccountBinding({
      ...input,
      revoked_at: now
    });
    await this.repository.revokeStaleSecurityState({
      connector_id: binding.connector_id,
      principal_id: binding.principal_id,
      minimum_generation: binding.credential_generation + 1,
      revoked_at: now
    });
    return binding;
  }

  async requestApproval(input: {
    command_context?: { workspace_id: string; call_id: string };
    tenant_id: string;
    requested_by: string;
    actor_principal_id: string;
    business_task_id?: string;
    operation_id: string;
    tool_release_id: string;
    arguments: Record<string, unknown>;
    resource_scope_refs: string[];
    workspace_view_snapshot_ref?: string;
    authorization_revision: number;
    ttl_ms?: number;
  }): Promise<BusinessApprovalSnapshot> {
    const tool = await this.requirePublishedTool(input.tool_release_id);
    const connector = await this.requireConnectorForTool(
      input.tenant_id,
      tool.tool_release_id
    );
    const toolRisk = risk(tool);
    const now = this.now();
    const ttlMs = positiveInteger(
      input.ttl_ms ?? DEFAULT_APPROVAL_TTL_MS,
      "ttl_ms"
    );
    const semantic = {
      ...(input.command_context ? { command_context: clone(input.command_context) } : {}),
      tenant_id: input.tenant_id,
      ...(input.business_task_id === undefined
        ? {}
        : {
            business_task_id: required(
              input.business_task_id,
              "business_task_id"
            )
          }),
      operation_id: required(input.operation_id, "operation_id"),
      tool_release_id: tool.tool_release_id,
      connector_id: connector.connector_id,
      subject_principal_id: required(input.requested_by, "requested_by"),
      actor_principal_id: required(
        input.actor_principal_id,
        "actor_principal_id"
      ),
      operation_kind: toolRisk.operation_kind,
      target_digest: targetDigest({
        connector_id: connector.connector_id,
        tool_release_id: tool.tool_release_id,
        resource_scope_refs: input.resource_scope_refs,
        ...(input.workspace_view_snapshot_ref === undefined
          ? {}
          : {
              workspace_view_snapshot_ref:
                input.workspace_view_snapshot_ref
            })
      }),
      argument_digest: digest(input.arguments),
      arguments: clone(input.arguments),
      resource_scope_refs: unique(input.resource_scope_refs),
      risk_class: toolRisk.risk_class,
      authorization_revision: input.authorization_revision,
      requested_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMs).toISOString()
    };
    const approval: BusinessApprovalSnapshot = {
      contract_name: "pc.business-approval-snapshot/1",
      contract_version: 1,
      approval_id: `approval_${randomUUID()}`,
      approval_version: 1,
      status: "PENDING",
      ...semantic,
      requested_by: input.requested_by,
      decision: {
        outcome: "PENDING",
        reason_codes: ["approval_requested"]
      },
      decision_evidence_refs: [],
      snapshot_digest: digest(semantic)
    };
    await this.repository.saveApproval(approval);
    await this.audit({
      event_type: "APPROVAL_REQUESTED",
      tenant_id: approval.tenant_id,
      principal_id: approval.requested_by,
      operation_id: approval.operation_id,
      connector_id: approval.connector_id,
      tool_release_id: approval.tool_release_id,
      outcome: "ALLOW",
      reason_codes: ["approval_snapshot_persisted"],
      evidence_refs: [approval.approval_id, approval.snapshot_digest]
    });
    if (
      this.eventPublisher !== undefined
      && approval.business_task_id !== undefined
    ) {
      await this.eventPublisher.approvalState({
        tenant_id: approval.tenant_id,
        principal_id: approval.subject_principal_id,
        business_task_id: approval.business_task_id,
        operation_id: approval.operation_id,
        approval_id: approval.approval_id,
        state: "AWAITING_APPROVAL",
        evidence_refs: [approval.snapshot_digest]
      });
    }
    return clone(approval);
  }

  async decideApproval(input: {
    tenant_id: string;
    approval_id: string;
    approver_principal_id: string;
    expected_version: number;
    decision: "APPROVE" | "REJECT";
    reason_codes: string[];
    evidence_refs?: string[];
  }): Promise<BusinessApprovalSnapshot> {
    const approval = await this.requireApproval(input.approval_id);
    if (approval.tenant_id !== input.tenant_id) {
      throw new GatewayError(
        "PC_GATEWAY_APPROVAL_SCOPE_MISMATCH",
        "Approval belongs to another tenant"
      );
    }
    if (
      input.decision === "APPROVE"
      && approval.requested_by === input.approver_principal_id
    ) {
      throw new GatewayError(
        "PC_GATEWAY_APPROVAL_SELF_APPROVAL_DENIED",
        "Requester cannot approve the same high-risk operation"
      );
    }
    const now = this.now();
    if (
      approval.expires_at !== undefined
      && Date.parse(approval.expires_at) <= now.getTime()
    ) {
      return this.repository.decideApproval({
        approval_id: approval.approval_id,
        expected_version: input.expected_version,
        expected_status: "PENDING",
        status: "EXPIRED",
        decision: {
          outcome: "EXPIRE",
          reason_codes: ["approval_expired"]
        },
        decision_evidence_refs: [],
        decided_at: now.toISOString()
      });
    }
    const status: ApprovalStatus = input.decision === "APPROVE"
      ? "APPROVED"
      : "REJECTED";
    const decided = await this.repository.decideApproval({
      approval_id: approval.approval_id,
      expected_version: input.expected_version,
      expected_status: "PENDING",
      status,
      decision: {
        outcome: input.decision,
        decided_by: required(
          input.approver_principal_id,
          "approver_principal_id"
        ),
        reason_codes: unique(input.reason_codes)
      },
      decision_evidence_refs: unique(input.evidence_refs ?? []),
      decided_at: now.toISOString()
    });
    await this.audit({
      event_type: "APPROVAL_DECIDED",
      tenant_id: approval.tenant_id,
      principal_id: input.approver_principal_id,
      operation_id: approval.operation_id,
      connector_id: approval.connector_id,
      tool_release_id: approval.tool_release_id,
      outcome: status === "APPROVED" ? "ALLOW" : "DENY",
      reason_codes: decided.decision.reason_codes,
      evidence_refs: [approval.approval_id, ...(input.evidence_refs ?? [])]
    });
    if (
      this.eventPublisher !== undefined
      && approval.business_task_id !== undefined
    ) {
      await this.eventPublisher.approvalState({
        tenant_id: approval.tenant_id,
        principal_id: approval.subject_principal_id,
        business_task_id: approval.business_task_id,
        operation_id: approval.operation_id,
        approval_id: approval.approval_id,
        state: status === "APPROVED" ? "APPROVED" : "FAILED",
        evidence_refs: decided.decision_evidence_refs
      });
    }
    return clone(decided);
  }

  async execute(
    envelope: ToolExecutionEnvelope,
    options: { signal?: AbortSignal } = {}
  ): Promise<ToolExecutionResult> {
    const now = this.now();
    if (Date.parse(envelope.deadline) <= now.getTime()) {
      throw new GatewayError(
        "PC_GATEWAY_DEADLINE_EXPIRED",
        "Tool execution deadline has expired"
      );
    }
    const actualArgumentDigest = digest(envelope.arguments);
    if (actualArgumentDigest !== envelope.argument_digest) {
      throw new GatewayError(
        "PC_GATEWAY_ARGUMENT_DIGEST_MISMATCH",
        "Tool arguments do not match the signed digest"
      );
    }
    const tool = await this.requirePublishedTool(envelope.tool_release_id);
    if (tool.schema_digest !== envelope.schema_digest) {
      throw new GatewayError(
        "PC_GATEWAY_TOOL_SCHEMA_STALE",
        "Tool schema digest is stale"
      );
    }
    if (tool.recovery_class !== envelope.recovery_class) {
      throw new GatewayError(
        "PC_GATEWAY_RECOVERY_CLASS_MISMATCH",
        "Execution recovery class does not match the immutable Tool Release"
      );
    }
    const connector = await this.requireConnectorForTool(
      envelope.principal_envelope.tenant_id,
      tool.tool_release_id,
      envelope.principal_envelope.audience
    );
    const principal = await this.identity.verifyPrincipalEnvelope(
      envelope.principal_envelope,
      `gateway:${connector.connector_id}`
    );
    if (
      principal.tenant_id !== connector.tenant_id
      || principal.principal_id
        !== envelope.principal_envelope.subject_principal_id
    ) {
      throw new GatewayError(
        "PC_GATEWAY_PRINCIPAL_SCOPE_MISMATCH",
        "Principal Envelope does not match the Connector tenant"
      );
    }
    const projection = await this.runtime.getSessionProjection(
      envelope.principal_envelope.pc_session_id
    );
    const assignment = projection.assignment;
    if (
      assignment.assignment_id !== envelope.assignment_snapshot_ref
      || assignment.tenant_id !== principal.tenant_id
      || assignment.user_id !== principal.principal_id
      || assignment.pc_session_id !== envelope.principal_envelope.pc_session_id
      || assignment.runtime_id !== envelope.principal_envelope.runtime_id
      || assignment.runtime_epoch !== envelope.principal_envelope.runtime_epoch
      || assignment.assignment_generation
        !== envelope.principal_envelope.assignment_generation
      || assignment.authorization_revision
        !== envelope.principal_envelope.authorization_revision
      || envelope.principal_envelope.fencing_token === undefined
      || assignment.fencing_token
        !== envelope.principal_envelope.fencing_token
    ) {
      throw new GatewayError(
        "PC_GATEWAY_ASSIGNMENT_STALE",
        "Principal Envelope does not match current Assignment authority"
      );
    }
    const guard = await this.runtime.evaluateToolGuard({
      runtime_id: assignment.runtime_id,
      runtime_epoch: assignment.runtime_epoch,
      pc_session_id: assignment.pc_session_id,
      assignment_generation: assignment.assignment_generation,
      fencing_token: assignment.fencing_token,
      authorization_revision: assignment.authorization_revision,
      tool_call_id: envelope.operation_id
    });
    if (!guard.allowed) {
      throw new GatewayError(guard.code, guard.reason, guard.retryable);
    }
    const profile = await this.profiles.getEffectiveProfileSnapshot(
      assignment.effective_profile_snapshot_id
    );
    if (
      profile === undefined
      || profile.pc_session_id !== assignment.pc_session_id
      || profile.authorization_revision !== assignment.authorization_revision
      || !profile.tool_release_ids.includes(tool.tool_release_id)
    ) {
      throw new GatewayError(
        "PC_GATEWAY_TOOL_NOT_IN_EFFECTIVE_PROFILE",
        "Tool is not part of the current Effective Profile Snapshot"
      );
    }
    await this.assertWorkspace(envelope, assignment);
    const authorization = await this.identity.evaluatePrincipalAuthorization({
      principal_id: principal.principal_id,
      actions: tool.required_permissions,
      resource_scope_refs:
        envelope.principal_envelope.resource_scope_refs,
      tool_release_ids: profile.tool_release_ids,
      policy_model_revision: 1,
      profile_release_id: profile.profile_release_id
    });
    if (
      authorization.decision !== "ALLOW"
      || authorization.authorization_revision
        !== envelope.principal_envelope.authorization_revision
      || tool.required_permissions.some((permission) =>
        !envelope.principal_envelope.allowed_actions.includes(permission)
      )
    ) {
      throw new GatewayError(
        "PC_GATEWAY_AUTHORIZATION_DENIED",
        "Execution-time authorization denied the Tool call"
      );
    }
    const toolRisk = risk(tool);
    const requestDigest = digest({
      tool_release_id: tool.tool_release_id,
      schema_digest: tool.schema_digest,
      argument_digest: envelope.argument_digest,
      principal_id: principal.principal_id,
      pc_session_id: assignment.pc_session_id,
      ...(toolRisk.operation_kind === "READ" ? { assignment_id: assignment.assignment_id } : {}),
      connector_id: connector.connector_id,
      resource_scope_refs:
        envelope.principal_envelope.resource_scope_refs,
      workspace_view_snapshot_ref:
        envelope.workspace_view_snapshot_ref ?? null
    });
    const existing = await this.repository.findOperationByIdempotency(
      connector.tenant_id,
      connector.connector_id,
      envelope.idempotency_key
    );
    if (existing !== undefined) {
      if (existing.request_digest !== requestDigest) {
        throw new GatewayError(
          "PC_GATEWAY_IDEMPOTENCY_CONFLICT",
          "Idempotency key was reused with a different request digest"
        );
      }
      if (existing.result !== undefined) return clone(existing.result);
      throw new GatewayError(
        "PC_GATEWAY_OPERATION_IN_PROGRESS",
        "Idempotent operation is already in progress",
        true
      );
    }
    const account = await this.repository.findExternalAccountBinding(
      connector.tenant_id,
      connector.connector_id,
      principal.principal_id
    );
    if (account === undefined || account.status !== "ACTIVE") {
      throw new GatewayError(
        "PC_GATEWAY_EXTERNAL_ACCOUNT_UNAVAILABLE",
        "No active External Account Binding exists for this Principal"
      );
    }
    if (connector.provider_key === "ee_mcp"
      && await this.identity.resolveExternalSubject?.(principal.principal_id, "eeclaw")
        !== account.external_account_id) {
      throw new GatewayError("PC_GATEWAY_EXTERNAL_IDENTITY_MISMATCH",
        "External Account does not match the verified identity link");
    }
    if (
      envelope.principal_envelope.credential_generation === undefined
      || envelope.principal_envelope.credential_generation
        !== account.credential_generation
    ) {
      throw new GatewayError(
        "PC_GATEWAY_CREDENTIAL_GENERATION_STALE",
        "Principal Envelope does not carry the current Credential Generation"
      );
    }
    if (
      tool.required_permissions.some((permission) =>
        !connector.allowed_scopes.includes(permission)
      )
    ) {
      throw new GatewayError(
        "PC_GATEWAY_CONNECTOR_SCOPE_DENIED",
        "Connector registration does not allow all Tool scopes"
      );
    }
    const approval = await this.validateApproval({
      envelope,
      tool,
      connector,
      operation_kind: toolRisk.operation_kind,
      authorization_revision: authorization.authorization_revision
    });
    const leaseExpiresAt = new Date(
      Math.min(
        now.getTime() + DEFAULT_LEASE_TTL_MS,
        Date.parse(envelope.principal_envelope.expires_at),
        Date.parse(envelope.deadline)
      )
    ).toISOString();
    const credentialMaterial = await this.credentialIssuer.issue({
      connector,
      account,
      scopes: [...tool.required_permissions],
      expires_at: leaseExpiresAt
    });
    if (credentialMaterial.credential_subject !== account.credential_subject) {
      throw new GatewayError(
        "PC_GATEWAY_CREDENTIAL_SUBJECT_MISMATCH",
        "Credential issuer returned an unexpected subject"
      );
    }
    const lease: CredentialLeaseRecord = {
      lease: {
        contract_name: "pc.credential-lease-ref/1",
        contract_version: 1,
        credential_lease_id: `credential_lease_${randomUUID()}`,
        connector_id: connector.connector_id,
        external_account_id: account.external_account_id,
        credential_subject: credentialMaterial.credential_subject,
        audience: connector.audience,
        scope_digest: digest(unique(tool.required_permissions)),
        generation: account.credential_generation,
        expires_at: leaseExpiresAt,
        binding_mode: credentialMaterial.binding_mode
      },
      tenant_id: connector.tenant_id,
      principal_id: principal.principal_id,
      ...(envelope.principal_envelope.business_task_id === undefined
        ? {}
        : {
            business_task_id:
              envelope.principal_envelope.business_task_id
          }),
      pc_session_id: assignment.pc_session_id,
      authorization_revision: authorization.authorization_revision,
      state: "ACTIVE",
      issued_at: now.toISOString()
    };
    await this.repository.saveCredentialLease(lease);
    const mcpBinding = await this.getOrCreateMcpBinding({
      connector,
      account,
      assignment,
      tool_catalog_digest: digest([...connector.tool_release_ids].sort()),
      now
    });
    const operation: ExternalOperationRecord = {
      arguments: clone(envelope.arguments),
      resource_scope_refs: [...envelope.principal_envelope.resource_scope_refs],
      contract_name: "pc.external-operation-record/1",
      contract_version: 1,
      operation_id: required(envelope.operation_id, "operation_id"),
      operation_kind: toolRisk.operation_kind,
      idempotency_key: required(
        envelope.idempotency_key,
        "idempotency_key"
      ),
      fencing_token: assignment.fencing_token,
      request_digest: requestDigest,
      dispatch_state: "PENDING",
      outcome_state: "NOT_STARTED",
      recovery_class: envelope.recovery_class,
      evidence_refs: [],
      version: 1,
      tenant_id: connector.tenant_id,
      principal_id: principal.principal_id,
      ...(envelope.principal_envelope.business_task_id === undefined
        ? {}
        : {
            business_task_id:
              envelope.principal_envelope.business_task_id
          }),
      pc_session_id: assignment.pc_session_id,
      connector_id: connector.connector_id,
      tool_release_id: tool.tool_release_id,
      schema_digest: tool.schema_digest,
      argument_digest: envelope.argument_digest,
      assignment_id: assignment.assignment_id,
      ...(approval === undefined
        ? {}
        : { approval_id: approval.approval_id }),
      credential_lease_id: lease.lease.credential_lease_id,
      mcp_binding_id: mcpBinding.binding_id,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };
    const begun = await this.repository.beginOperation({
      operation,
      ...(approval === undefined
        ? {}
        : {
            approval_id: approval.approval_id,
            approval_version: approval.approval_version
          }),
      now: now.toISOString()
    });
    if (!begun.created) {
      if (begun.operation.request_digest !== requestDigest) {
        throw new GatewayError(
          "PC_GATEWAY_IDEMPOTENCY_CONFLICT",
          "Idempotency key was reused with a different request digest"
        );
      }
      if (begun.operation.result !== undefined) {
        return clone(begun.operation.result);
      }
      throw new GatewayError(
        "PC_GATEWAY_OPERATION_IN_PROGRESS",
        "Idempotent operation is already in progress",
        true
      );
    }
    await this.audit({
      event_type: "TOOL_CALL_ADMITTED",
      tenant_id: connector.tenant_id,
      principal_id: principal.principal_id,
      operation_id: operation.operation_id,
      connector_id: connector.connector_id,
      tool_release_id: tool.tool_release_id,
      outcome: "ALLOW",
      reason_codes: ["all_gateway_guards_passed"],
      evidence_refs: [
        assignment.assignment_id,
        lease.lease.credential_lease_id,
        mcpBinding.binding_id,
        ...(approval === undefined ? [] : [approval.approval_id])
      ]
    });
    if (
      this.eventPublisher !== undefined
      && operation.business_task_id !== undefined
    ) {
      await this.eventPublisher.operationState({
        tenant_id: operation.tenant_id,
        principal_id: operation.principal_id,
        business_task_id: operation.business_task_id,
        operation_id: operation.operation_id,
        state: "DISPATCHING",
        external_operation_record_id: operation.operation_id,
        evidence_refs: []
      });
    }
    const dispatched = await this.repository.updateOperation({
      ...begun.operation,
      dispatch_state: "DISPATCHED",
      version: begun.operation.version + 1,
      updated_at: this.now().toISOString()
    }, begun.operation.version);
    if (
      this.eventPublisher !== undefined
      && operation.business_task_id !== undefined
    ) {
      await this.eventPublisher.operationState({
        tenant_id: operation.tenant_id,
        principal_id: operation.principal_id,
        business_task_id: operation.business_task_id,
        operation_id: operation.operation_id,
        state: "DISPATCHED",
        external_operation_record_id: operation.operation_id,
        evidence_refs: []
      });
    }
    try {
      const providerResult = await this.provider.dispatch({
        ...(approval ? { approval_id: approval.approval_id } : {}),
        connector,
        tool,
        operation_id: operation.operation_id,
        idempotency_key: operation.idempotency_key,
        arguments: clone(envelope.arguments),
        access_token: credentialMaterial.access_token,
        deadline: envelope.deadline,
        mcp_binding: mcpBinding,
        external_account_id: account.external_account_id,
        principal_id: principal.principal_id,
        pc_session_id: assignment.pc_session_id,
        resource_scope_refs: envelope.principal_envelope.resource_scope_refs,
        authorization_revision: authorization.authorization_revision,
        ...(options.signal === undefined ? {} : { signal: options.signal })
      });
      const completedAt = this.now().toISOString();
      const result = resultFor(operation.operation_id, {
        status: "SUCCEEDED",
        provider_operation_id: providerResult.provider_operation_id,
        result: providerResult.result,
        external_evidence_refs: providerResult.external_evidence_refs,
        retryable: false,
        outcome_state: "KNOWN_SUCCESS",
        reconciliation_required: false,
        completed_at: completedAt
      });
      const completed = await this.repository.updateOperation({
        ...dispatched,
        provider_operation_id: providerResult.provider_operation_id,
        dispatch_state: "COMPLETED",
        outcome_state: "KNOWN_SUCCESS",
        evidence_refs: [...providerResult.external_evidence_refs],
        version: dispatched.version + 1,
        updated_at: completedAt,
        result
      }, dispatched.version);
      await this.audit({
        event_type: "TOOL_CALL_COMPLETED",
        tenant_id: connector.tenant_id,
        principal_id: principal.principal_id,
        operation_id: completed.operation_id,
        connector_id: connector.connector_id,
        tool_release_id: tool.tool_release_id,
        outcome: "SUCCESS",
        reason_codes: [
          toolRisk.requires_readback
            ? "provider_readback_verified"
            : "provider_result_accepted"
        ],
        evidence_refs: completed.evidence_refs
      });
      if (
        this.eventPublisher !== undefined
        && operation.business_task_id !== undefined
      ) {
        await this.eventPublisher.operationState({
          tenant_id: operation.tenant_id,
          principal_id: operation.principal_id,
          business_task_id: operation.business_task_id,
          operation_id: operation.operation_id,
          state: "VERIFYING",
          external_operation_record_id: operation.operation_id,
          result_digest: result.result_digest,
          evidence_refs: completed.evidence_refs
        });
      }
      return result;
    } catch (error) {
      if (!(error instanceof GatewayProviderError)) throw error;
      const completedAt = this.now().toISOString();
      const unknown = error.outcome_unknown;
      const result = resultFor(operation.operation_id, {
        status: unknown ? "OUTCOME_UNKNOWN" : "FAILED",
        ...(error.provider_operation_id === undefined
          ? {}
          : { provider_operation_id: error.provider_operation_id }),
        result: { error_code: error.code },
        external_evidence_refs: [],
        retryable: !unknown && error.retryable,
        outcome_state: unknown ? "OUTCOME_UNKNOWN" : "KNOWN_FAILURE",
        reconciliation_required: unknown,
        completed_at: completedAt
      });
      await this.repository.updateOperation({
        ...dispatched,
        ...(error.provider_operation_id === undefined
          ? {}
          : { provider_operation_id: error.provider_operation_id }),
        dispatch_state: unknown ? "UNKNOWN" : "COMPLETED",
        outcome_state: unknown ? "OUTCOME_UNKNOWN" : "KNOWN_FAILURE",
        version: dispatched.version + 1,
        updated_at: completedAt,
        result
      }, dispatched.version);
      await this.audit({
        event_type: unknown ? "OUTCOME_UNKNOWN" : "TOOL_CALL_FAILED",
        tenant_id: connector.tenant_id,
        principal_id: principal.principal_id,
        operation_id: operation.operation_id,
        connector_id: connector.connector_id,
        tool_release_id: tool.tool_release_id,
        outcome: unknown ? "UNKNOWN" : "FAILURE",
        reason_codes: [error.code],
        evidence_refs: []
      });
      if (
        this.eventPublisher !== undefined
        && operation.business_task_id !== undefined
      ) {
        await this.eventPublisher.operationState({
          tenant_id: operation.tenant_id,
          principal_id: operation.principal_id,
          business_task_id: operation.business_task_id,
          operation_id: operation.operation_id,
          state: unknown ? "OUTCOME_UNKNOWN" : "FAILED",
          external_operation_record_id: operation.operation_id,
          result_digest: result.result_digest,
          evidence_refs: []
        });
      }
      return result;
    }
  }

  async reconcile(operationId: string): Promise<ToolExecutionResult> {
    const operation = await this.requireOperation(operationId);
    if (operation.outcome_state !== "OUTCOME_UNKNOWN") {
      if (operation.result === undefined) {
        throw new GatewayError(
          "PC_GATEWAY_OPERATION_NOT_RECONCILABLE",
          "Operation has no reconciliable result"
        );
      }
      return clone(operation.result);
    }
    const connector = await this.requireConnector(operation.connector_id);
    const reconciling = await this.repository.updateOperation({
      ...operation,
      dispatch_state: "RECONCILING",
      version: operation.version + 1,
      updated_at: this.now().toISOString()
    }, operation.version);
    if (
      this.eventPublisher !== undefined
      && operation.business_task_id !== undefined
    ) {
      await this.eventPublisher.operationState({
        tenant_id: operation.tenant_id,
        principal_id: operation.principal_id,
        business_task_id: operation.business_task_id,
        operation_id: operation.operation_id,
        state: "RECONCILING",
        external_operation_record_id: operation.operation_id,
        evidence_refs: operation.evidence_refs
      });
    }
    const tool = await this.requirePublishedTool(operation.tool_release_id);
    const authorization = await this.identity.evaluatePrincipalAuthorization({
      principal_id: operation.principal_id, actions: tool.required_permissions,
      resource_scope_refs: operation.resource_scope_refs ?? [], tool_release_ids: [tool.tool_release_id], policy_model_revision: 1 });
    const account = await this.repository.findExternalAccountBinding(operation.tenant_id, connector.connector_id, operation.principal_id);
    if (authorization.decision !== "ALLOW" || !account || account.status !== "ACTIVE"
      || connector.state !== "ACTIVE"
      || (connector.provider_key === "ee_mcp" && await this.identity.resolveExternalSubject?.(operation.principal_id, "eeclaw") !== account.external_account_id)) {
      throw new GatewayError("PC_GATEWAY_RECONCILE_DENIED", "Current authority denies reconciliation");
    }
    const credential = await this.credentialIssuer.issue({ connector, account, scopes: [...tool.required_permissions],
      expires_at: new Date(this.now().getTime() + 60_000).toISOString() });
    const providerResult = await this.provider.reconcile({
      connector,
      operation: reconciling,
      access_token: credential.access_token,
      external_account_id: account.external_account_id
    });
    const completedAt = this.now().toISOString();
    const stillUnknown = providerResult.outcome === "OUTCOME_UNKNOWN";
    const result = resultFor(operation.operation_id, {
      status: providerResult.outcome === "KNOWN_SUCCESS"
        ? "SUCCEEDED"
        : providerResult.outcome === "KNOWN_FAILURE"
          ? "FAILED"
          : "RECONCILIATION_REQUIRED",
      ...(providerResult.provider_operation_id === undefined
        ? {}
        : { provider_operation_id: providerResult.provider_operation_id }),
      result: "result" in providerResult ? providerResult.result : {},
      external_evidence_refs: providerResult.evidence_refs,
      retryable: false,
      outcome_state: providerResult.outcome,
      reconciliation_required: stillUnknown,
      completed_at: completedAt
    });
    await this.repository.updateOperation({
      ...reconciling,
      ...(providerResult.provider_operation_id === undefined
        ? {}
        : { provider_operation_id: providerResult.provider_operation_id }),
      dispatch_state: stillUnknown ? "UNKNOWN" : "COMPLETED",
      outcome_state: providerResult.outcome,
      last_reconciled_at: completedAt,
      evidence_refs: providerResult.evidence_refs,
      version: reconciling.version + 1,
      updated_at: completedAt,
      result
    }, reconciling.version);
    await this.audit({
      event_type: "OPERATION_RECONCILED",
      tenant_id: operation.tenant_id,
      principal_id: operation.principal_id,
      operation_id: operation.operation_id,
      connector_id: operation.connector_id,
      tool_release_id: operation.tool_release_id,
      outcome: providerResult.outcome === "KNOWN_SUCCESS"
        ? "SUCCESS"
        : providerResult.outcome === "KNOWN_FAILURE"
          ? "FAILURE"
          : "UNKNOWN",
      reason_codes: [`reconciled:${providerResult.outcome}`],
      evidence_refs: providerResult.evidence_refs
    });
    if (
      this.eventPublisher !== undefined
      && operation.business_task_id !== undefined
    ) {
      await this.eventPublisher.operationState({
        tenant_id: operation.tenant_id,
        principal_id: operation.principal_id,
        business_task_id: operation.business_task_id,
        operation_id: operation.operation_id,
        state: providerResult.outcome === "KNOWN_SUCCESS"
          ? "SUCCEEDED"
          : providerResult.outcome === "KNOWN_FAILURE"
            ? "FAILED"
            : "OUTCOME_UNKNOWN",
        external_operation_record_id: operation.operation_id,
        result_digest: result.result_digest,
        evidence_refs: providerResult.evidence_refs
      });
    }
    return result;
  }

  getApproval(approvalId: string): Promise<BusinessApprovalSnapshot | undefined> {
    return this.repository.getApproval(approvalId);
  }

  getConnector(
    connectorId: string
  ): Promise<ConnectorRegistration | undefined> {
    return this.repository.getConnector(connectorId);
  }

  getExternalAccountBinding(
    bindingId: string
  ): Promise<ExternalAccountBinding | undefined> {
    return this.repository.getExternalAccountBinding(bindingId);
  }

  getOperation(operationId: string): Promise<ExternalOperationRecord | undefined> {
    return this.repository.getOperation(operationId);
  }

  getMcpSessionBinding(
    bindingId: string
  ): Promise<McpSessionBinding | undefined> {
    return this.repository.getMcpSessionBinding(bindingId);
  }

  listOperationAudit(operationId: string): Promise<GatewayAuditEntry[]> {
    return this.repository.listAudit(operationId);
  }

  private async assertWorkspace(
    envelope: ToolExecutionEnvelope,
    assignment: {
      workspace_view_snapshot_id: string;
      tenant_id: string;
      user_id: string;
      pc_session_id: string;
      authorization_revision: number;
    }
  ): Promise<void> {
    if (envelope.workspace_view_snapshot_ref === undefined) return;
    if (
      envelope.workspace_view_snapshot_ref
      !== assignment.workspace_view_snapshot_id
    ) {
      throw new GatewayError(
        "PC_GATEWAY_WORKSPACE_VIEW_STALE",
        "Tool execution references a stale Workspace View"
      );
    }
    const view = await this.workspace.getWorkspaceView(
      envelope.workspace_view_snapshot_ref
    );
    if (
      view === undefined
      || view.tenant_id !== assignment.tenant_id
      || view.principal_id !== assignment.user_id
      || view.pc_session_id !== assignment.pc_session_id
      || view.authorization_revision !== assignment.authorization_revision
      || (
        view.expires_at !== undefined
        && Date.parse(view.expires_at) <= this.now().getTime()
      )
    ) {
      throw new GatewayError(
        "PC_GATEWAY_WORKSPACE_VIEW_STALE",
        "Workspace View is missing, expired or outside Assignment scope"
      );
    }
  }

  private async validateApproval(input: {
    envelope: ToolExecutionEnvelope;
    tool: ToolRelease;
    connector: ConnectorRegistration;
    operation_kind: OperationKind;
    authorization_revision: number;
  }): Promise<BusinessApprovalSnapshot | undefined> {
    const requiresApproval = ["ALWAYS", "EXPLICIT"].includes(input.tool.approval_policy)
      || input.operation_kind === "DESTRUCTIVE"
      || input.operation_kind === "EXTERNAL_SIDE_EFFECT";
    if (!requiresApproval) return undefined;
    if (input.envelope.approval_snapshot_ref === undefined) {
      throw new GatewayError(
        "PC_GATEWAY_APPROVAL_REQUIRED",
        "Tool execution requires a durable Approval Snapshot"
      );
    }
    const approval = await this.requireApproval(
      input.envelope.approval_snapshot_ref
    );
    const expectedTarget = targetDigest({
      connector_id: input.connector.connector_id,
      tool_release_id: input.tool.tool_release_id,
      resource_scope_refs:
        input.envelope.principal_envelope.resource_scope_refs,
      ...(input.envelope.workspace_view_snapshot_ref === undefined
        ? {}
        : {
            workspace_view_snapshot_ref:
              input.envelope.workspace_view_snapshot_ref
          })
    });
    if (
      approval.status !== "APPROVED"
      || approval.operation_id !== input.envelope.operation_id
      || approval.tool_release_id !== input.tool.tool_release_id
      || approval.connector_id !== input.connector.connector_id
      || approval.argument_digest !== input.envelope.argument_digest
      || approval.target_digest !== expectedTarget
      || approval.authorization_revision !== input.authorization_revision
      || (
        approval.expires_at !== undefined
        && Date.parse(approval.expires_at) <= this.now().getTime()
      )
    ) {
      throw new GatewayError(
        "PC_GATEWAY_APPROVAL_STALE",
        "Approval Snapshot does not match the exact operation"
      );
    }
    return approval;
  }

  private async getOrCreateMcpBinding(input: {
    connector: ConnectorRegistration;
    account: ExternalAccountBinding;
    assignment: {
      tenant_id: string;
      user_id: string;
      pc_session_id: string;
      authorization_revision: number;
    };
    tool_catalog_digest: string;
    now: Date;
  }): Promise<McpSessionBinding> {
    const existing = await this.repository.findMcpSessionBinding({
      tenant_id: input.assignment.tenant_id,
      principal_id: input.assignment.user_id,
      pc_session_id: input.assignment.pc_session_id,
      connector_id: input.connector.connector_id,
      authorization_revision: input.assignment.authorization_revision,
      credential_generation: input.account.credential_generation,
      tool_catalog_digest: input.tool_catalog_digest,
      now: input.now.toISOString()
    });
    if (existing !== undefined) return existing;
    const binding: McpSessionBinding = {
      contract_name: "pc.mcp-session-binding/1",
      contract_version: 1,
      binding_id: `mcp_binding_${randomUUID()}`,
      tenant_id: input.assignment.tenant_id,
      principal_id: input.assignment.user_id,
      pc_session_id: input.assignment.pc_session_id,
      connector_id: input.connector.connector_id,
      mcp_server_id: input.connector.mcp_server_id,
      protocol_session_id: `mcp_session_${randomUUID()}`,
      authorization_revision: input.assignment.authorization_revision,
      credential_generation: input.account.credential_generation,
      tool_catalog_digest: input.tool_catalog_digest,
      created_at: input.now.toISOString(),
      expires_at: new Date(
        input.now.getTime() + DEFAULT_MCP_BINDING_TTL_MS
      ).toISOString(),
      state: "ACTIVE"
    };
    await this.repository.saveMcpSessionBinding(binding);
    return binding;
  }

  private async requirePublishedTool(toolReleaseId: string): Promise<ToolRelease> {
    const tool = await this.profiles.getToolRelease(toolReleaseId);
    if (tool === undefined || tool.status !== "PUBLISHED") {
      throw new GatewayError(
        "PC_GATEWAY_TOOL_RELEASE_UNAVAILABLE",
        "Tool Release is missing, revoked or superseded"
      );
    }
    return tool;
  }

  private async requireConnectorForTool(
    tenantId: string,
    toolReleaseId: string,
    audience?: string
  ): Promise<ConnectorRegistration> {
    // The signed execution target is exact; historical registrations may share a Tool.
    const connector = audience === undefined
      ? await this.repository.findConnectorForTool(tenantId, toolReleaseId)
      : audience.startsWith("gateway:") ? await this.repository.getConnector(audience.slice("gateway:".length)) : undefined;
    if (connector === undefined || connector.state !== "ACTIVE" || connector.tenant_id !== tenantId
      || !connector.tool_release_ids.includes(toolReleaseId)) {
      throw new GatewayError(
        "PC_GATEWAY_CONNECTOR_UNAVAILABLE",
        "No active Connector Registration provides this Tool Release"
      );
    }
    return connector;
  }

  private async requireConnector(
    connectorId: string
  ): Promise<ConnectorRegistration> {
    const connector = await this.repository.getConnector(connectorId);
    if (connector === undefined) {
      throw new GatewayError(
        "PC_GATEWAY_CONNECTOR_NOT_FOUND",
        "Connector Registration was not found"
      );
    }
    return connector;
  }

  private async requireApproval(
    approvalId: string
  ): Promise<BusinessApprovalSnapshot> {
    const approval = await this.repository.getApproval(approvalId);
    if (approval === undefined) {
      throw new GatewayError(
        "PC_GATEWAY_APPROVAL_NOT_FOUND",
        "Business Approval was not found"
      );
    }
    return approval;
  }

  private async requireOperation(
    operationId: string
  ): Promise<ExternalOperationRecord> {
    const operation = await this.repository.getOperation(operationId);
    if (operation === undefined) {
      throw new GatewayError(
        "PC_GATEWAY_OPERATION_NOT_FOUND",
        "External Operation was not found"
      );
    }
    return operation;
  }

  private async audit(
    input: Omit<
      GatewayAuditEntry,
      "audit_id" | "payload_digest" | "occurred_at"
    >
  ): Promise<void> {
    const occurredAt = this.now().toISOString();
    const semantic = {
      ...clone(input),
      occurred_at: occurredAt
    };
    await this.repository.appendAudit({
      audit_id: `gateway_audit_${randomUUID()}`,
      ...semantic,
      payload_digest: digest(semantic)
    });
  }
}
