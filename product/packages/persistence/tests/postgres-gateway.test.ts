import { describe, expect, it } from "vitest";
import type {
  BusinessApprovalSnapshot,
  ConnectorRegistration,
  ExternalAccountBinding,
  ExternalOperationRecord,
  GatewayAuditEntry,
  McpSessionBinding
} from "@pc/gateway";
import { PostgresGatewayRepository } from "../src/index.js";

const databaseUrl = process.env.PC_TEST_POSTGRES_URL;

describe.skipIf(databaseUrl === undefined)(
  "Postgres Controlled Gateway authority",
  () => {
    it("persists approval consumption, MCP binding and unknown operation across restart", async () => {
      const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const connector: ConnectorRegistration = {
        connector_id: `connector_${suffix}`,
        tenant_id: `tenant_${suffix}`,
        mcp_server_id: `mcp_${suffix}`,
        endpoint_ref: "internal://provider",
        provider_key: "test-provider",
        auth_mode: "delegated",
        audience: "test-provider",
        allowed_scopes: ["records.write"],
        tool_release_ids: ["tool:write:1"],
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
        secret_ref: `secret_ref_${suffix}`,
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
        expires_at: "2026-11-10T13:00:00.000Z",
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
        expires_at: "2026-11-10T13:00:00.000Z",
        decision: {
          outcome: "PENDING",
          reason_codes: ["approval_requested"]
        },
        decision_evidence_refs: [],
        snapshot_digest: `sha256:${"e".repeat(64)}`,
        tenant_id: connector.tenant_id,
        operation_id: `operation_${suffix}`,
        tool_release_id: "tool:write:1",
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
        dispatch_state: "PENDING",
        outcome_state: "NOT_STARTED",
        recovery_class: "RECONCILE_BEFORE_RETRY",
        evidence_refs: [],
        version: 1,
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
        updated_at: "2026-11-10T12:00:00.000Z"
      };
      const audit: GatewayAuditEntry = {
        audit_id: `audit_${suffix}`,
        event_type: "OUTCOME_UNKNOWN",
        tenant_id: connector.tenant_id,
        principal_id: account.principal_id,
        operation_id: operation.operation_id,
        connector_id: connector.connector_id,
        tool_release_id: operation.tool_release_id,
        outcome: "UNKNOWN",
        reason_codes: ["transport_lost"],
        evidence_refs: [],
        payload_digest: `sha256:${"2".repeat(64)}`,
        occurred_at: "2026-11-10T12:00:01.000Z"
      };

      const first = new PostgresGatewayRepository(databaseUrl as string);
      await first.initialize();
      try {
        await first.putConnector(connector);
        await first.putExternalAccountBinding(account);
        await first.saveMcpSessionBinding(mcp);
        await first.saveApproval(approval);
        const approved = await first.decideApproval({
          approval_id: approval.approval_id,
          expected_version: 1,
          expected_status: "PENDING",
          status: "APPROVED",
          decision: {
            outcome: "APPROVE",
            decided_by: `approver_${suffix}`,
            reason_codes: ["approved"]
          },
          decision_evidence_refs: [`ticket_${suffix}`],
          decided_at: "2026-11-10T12:00:00.500Z"
        });
        await first.beginOperation({
          operation,
          approval_id: approval.approval_id,
          approval_version: approved.approval_version,
          now: "2026-11-10T12:00:00.750Z"
        });
        await first.updateOperation({
          ...operation,
          provider_operation_id: `provider_${suffix}`,
          dispatch_state: "UNKNOWN",
          outcome_state: "OUTCOME_UNKNOWN",
          version: 2,
          updated_at: "2026-11-10T12:00:01.000Z"
        }, 1);
        await first.appendAudit(audit);
      } finally {
        await first.close();
      }

      const restarted = new PostgresGatewayRepository(databaseUrl as string);
      await restarted.initialize();
      try {
        await expect(restarted.getConnector(connector.connector_id))
          .resolves.toMatchObject({ capability_digest: connector.capability_digest });
        await expect(restarted.getExternalAccountBinding(
          account.external_account_binding_id
        )).resolves.toMatchObject({
          principal_id: account.principal_id,
          credential_generation: 1
        });
        await expect(restarted.getMcpSessionBinding(mcp.binding_id))
          .resolves.toMatchObject({
            pc_session_id: mcp.pc_session_id,
            state: "ACTIVE"
          });
        await expect(restarted.getApproval(approval.approval_id))
          .resolves.toMatchObject({
            status: "CONSUMED",
            approval_version: 3,
            decision_evidence_refs: [`ticket_${suffix}`]
          });
        await expect(restarted.getOperation(operation.operation_id))
          .resolves.toMatchObject({
            dispatch_state: "UNKNOWN",
            outcome_state: "OUTCOME_UNKNOWN",
            version: 2
          });
        await expect(restarted.listAudit(operation.operation_id))
          .resolves.toMatchObject([{ event_type: "OUTCOME_UNKNOWN" }]);
      } finally {
        await restarted.close();
      }
    });
  }
);
