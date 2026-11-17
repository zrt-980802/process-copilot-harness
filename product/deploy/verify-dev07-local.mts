import { PostgresGatewayRepository } from "../packages/persistence/src/index.js";
import type {
  BusinessApprovalSnapshot,
  ConnectorRegistration,
  ExternalAccountBinding,
  ExternalOperationRecord,
  GatewayAuditEntry,
  McpSessionBinding
} from "@pc/gateway";

const databaseUrl = process.env.DATABASE_URL;
const verificationId = process.env.PC_DEV07_VERIFICATION_ID;
const mode = process.argv[2];

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("DATABASE_URL is required");
}
if (verificationId === undefined || verificationId.trim() === "") {
  throw new Error("PC_DEV07_VERIFICATION_ID is required");
}
if (mode !== "setup" && mode !== "recover") {
  throw new Error("Usage: verify-dev07-local.mjs <setup|recover>");
}

const suffix = verificationId.replace(/[^a-zA-Z0-9_-]/gu, "_");
const connector: ConnectorRegistration = {
  connector_id: `connector_${suffix}`,
  tenant_id: `tenant_${suffix}`,
  mcp_server_id: `mcp_${suffix}`,
  endpoint_ref: "internal://dev07-verification",
  provider_key: "deterministic",
  auth_mode: "delegated",
  audience: "dev07-verification",
  allowed_scopes: ["records.write"],
  tool_release_ids: ["tool:dev07-write:1"],
  state: "ACTIVE",
  registration_revision: 1,
  capability_digest: `sha256:${"a".repeat(64)}`,
  created_at: "2026-11-10T12:00:00.000Z",
  updated_at: "2026-11-10T12:00:00.000Z"
};
const account: ExternalAccountBinding = {
  external_account_binding_id: `account_${suffix}`,
  tenant_id: connector.tenant_id,
  connector_id: connector.connector_id,
  principal_id: `principal_${suffix}`,
  external_account_id: `external_${suffix}`,
  credential_subject: `subject_${suffix}`,
  secret_ref: `local-secret-ref:${suffix}`,
  status: "ACTIVE",
  credential_generation: 1,
  created_at: "2026-11-10T12:00:00.000Z",
  updated_at: "2026-11-10T12:00:00.000Z"
};
const mcp: McpSessionBinding = {
  contract_name: "pc.mcp-session-binding/1",
  contract_version: 1,
  binding_id: `mcp_binding_${suffix}`,
  tenant_id: connector.tenant_id,
  principal_id: account.principal_id,
  pc_session_id: `session_${suffix}`,
  connector_id: connector.connector_id,
  mcp_server_id: connector.mcp_server_id,
  protocol_session_id: `protocol_${suffix}`,
  authorization_revision: 2,
  credential_generation: 1,
  tool_catalog_digest: `sha256:${"b".repeat(64)}`,
  created_at: "2026-11-10T12:00:00.000Z",
  expires_at: "2026-11-11T12:00:00.000Z",
  state: "ACTIVE"
};
const approval: BusinessApprovalSnapshot = {
  contract_name: "pc.business-approval-snapshot/1",
  contract_version: 1,
  approval_id: `approval_${suffix}`,
  approval_version: 1,
  status: "PENDING",
  subject_principal_id: account.principal_id,
  actor_principal_id: account.principal_id,
  operation_kind: "EXTERNAL_SIDE_EFFECT",
  target_digest: `sha256:${"c".repeat(64)}`,
  argument_digest: `sha256:${"d".repeat(64)}`,
  risk_class: "HIGH",
  authorization_revision: 2,
  requested_at: "2026-11-10T12:00:00.000Z",
  expires_at: "2026-11-11T12:00:00.000Z",
  decision: {
    outcome: "PENDING",
    reason_codes: ["approval_requested"]
  },
  decision_evidence_refs: [],
  snapshot_digest: `sha256:${"e".repeat(64)}`,
  tenant_id: connector.tenant_id,
  operation_id: `operation_${suffix}`,
  tool_release_id: "tool:dev07-write:1",
  connector_id: connector.connector_id,
  requested_by: account.principal_id
};
const operation: ExternalOperationRecord = {
  contract_name: "pc.external-operation-record/1",
  contract_version: 1,
  operation_id: approval.operation_id,
  operation_kind: approval.operation_kind,
  idempotency_key: `idempotency_${suffix}`,
  fencing_token: `fence_${suffix}`,
  request_digest: `sha256:${"f".repeat(64)}`,
  provider_operation_id: `provider_${suffix}`,
  dispatch_state: "UNKNOWN",
  outcome_state: "OUTCOME_UNKNOWN",
  recovery_class: "RECONCILE_BEFORE_RETRY",
  evidence_refs: [],
  version: 2,
  tenant_id: connector.tenant_id,
  principal_id: account.principal_id,
  pc_session_id: mcp.pc_session_id,
  connector_id: connector.connector_id,
  tool_release_id: approval.tool_release_id,
  schema_digest: "1".repeat(64),
  argument_digest: approval.argument_digest,
  assignment_id: `assignment_${suffix}`,
  approval_id: approval.approval_id,
  mcp_binding_id: mcp.binding_id,
  created_at: "2026-11-10T12:00:00.000Z",
  updated_at: "2026-11-10T12:00:01.000Z"
};

const repository = new PostgresGatewayRepository(databaseUrl);
await repository.initialize();
try {
  if (mode === "setup") {
    await repository.putConnector(connector);
    await repository.putExternalAccountBinding(account);
    await repository.saveMcpSessionBinding(mcp);
    await repository.saveApproval(approval);
    const approved = await repository.decideApproval({
      approval_id: approval.approval_id,
      expected_version: 1,
      expected_status: "PENDING",
      status: "APPROVED",
      decision: {
        outcome: "APPROVE",
        decided_by: `approver_${suffix}`,
        reason_codes: ["business_owner_approved"]
      },
      decision_evidence_refs: [`ticket_${suffix}`],
      decided_at: "2026-11-10T12:00:00.500Z"
    });
    await repository.beginOperation({
      operation: {
        ...operation,
        provider_operation_id: undefined,
        dispatch_state: "PENDING",
        outcome_state: "NOT_STARTED",
        version: 1,
        updated_at: "2026-11-10T12:00:00.750Z"
      } as ExternalOperationRecord,
      approval_id: approval.approval_id,
      approval_version: approved.approval_version,
      now: "2026-11-10T12:00:00.750Z"
    });
    await repository.updateOperation(operation, 1);
    const audit: GatewayAuditEntry = {
      audit_id: `audit_unknown_${suffix}`,
      event_type: "OUTCOME_UNKNOWN",
      tenant_id: connector.tenant_id,
      principal_id: account.principal_id,
      operation_id: operation.operation_id,
      connector_id: connector.connector_id,
      tool_release_id: operation.tool_release_id,
      outcome: "UNKNOWN",
      reason_codes: ["transport_lost_after_dispatch"],
      evidence_refs: [],
      payload_digest: `sha256:${"2".repeat(64)}`,
      occurred_at: "2026-11-10T12:00:01.000Z"
    };
    await repository.appendAudit(audit);
    console.log(JSON.stringify({
      mode,
      connector_id: connector.connector_id,
      approval_id: approval.approval_id,
      operation_id: operation.operation_id,
      mcp_binding_id: mcp.binding_id,
      approval_status: "CONSUMED",
      operation_outcome: "OUTCOME_UNKNOWN"
    }));
  } else {
    const [
      recoveredConnector,
      recoveredAccount,
      recoveredMcp,
      recoveredApproval,
      recoveredOperation,
      recoveredAudit
    ] = await Promise.all([
      repository.getConnector(connector.connector_id),
      repository.getExternalAccountBinding(
        account.external_account_binding_id
      ),
      repository.getMcpSessionBinding(mcp.binding_id),
      repository.getApproval(approval.approval_id),
      repository.getOperation(operation.operation_id),
      repository.listAudit(operation.operation_id)
    ]);
    if (
      recoveredConnector?.state !== "ACTIVE"
      || recoveredAccount?.credential_generation !== 1
      || recoveredMcp?.state !== "ACTIVE"
      || recoveredApproval?.status !== "CONSUMED"
      || recoveredOperation?.outcome_state !== "OUTCOME_UNKNOWN"
      || recoveredAudit.length !== 1
    ) {
      throw new Error("DEV-07 PostgreSQL recovery verification failed");
    }
    const serializedEvidence = JSON.stringify({
      operation: recoveredOperation,
      audit: recoveredAudit,
      mcp: recoveredMcp
    });
    if (
      serializedEvidence.includes("local-secret-ref")
      || serializedEvidence.includes("access_token")
      || serializedEvidence.includes("ephemeral.")
    ) {
      throw new Error("Credential material leaked into durable evidence");
    }
    const completedAt = "2026-11-10T12:05:00.000Z";
    const reconciled = await repository.updateOperation({
      ...recoveredOperation,
      dispatch_state: "COMPLETED",
      outcome_state: "KNOWN_SUCCESS",
      last_reconciled_at: completedAt,
      evidence_refs: [`reconciliation_${suffix}`],
      version: recoveredOperation.version + 1,
      updated_at: completedAt,
      result: {
        contract_name: "pc.tool-execution-result/1",
        contract_version: 1,
        operation_id: recoveredOperation.operation_id,
        status: "SUCCEEDED",
        provider_operation_id: recoveredOperation.provider_operation_id,
        result: { reconciled: true },
        result_digest: `sha256:${"3".repeat(64)}`,
        external_evidence_refs: [`reconciliation_${suffix}`],
        retryable: false,
        outcome_state: "KNOWN_SUCCESS",
        reconciliation_required: false,
        completed_at: completedAt
      }
    }, recoveredOperation.version);
    console.log(JSON.stringify({
      mode,
      connector_id: recoveredConnector.connector_id,
      approval_status: recoveredApproval.status,
      mcp_state: recoveredMcp.state,
      recovered_operation_outcome: recoveredOperation.outcome_state,
      reconciled_operation_outcome: reconciled.outcome_state,
      durable_audit_entries: recoveredAudit.length,
      credential_material_leaked: false
    }));
  }
} finally {
  await repository.close();
}
