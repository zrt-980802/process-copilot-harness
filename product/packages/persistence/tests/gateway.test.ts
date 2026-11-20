import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AuthorizationSnapshot,
  EffectiveProfileSnapshot,
  PCPrincipal,
  PrincipalEnvelope,
  SessionAssignment,
  ToolRelease
} from "@pc/domain";
import {
  ControlledExecutionGatewayService,
  DeterministicGatewayProvider,
  EphemeralCredentialIssuer,
  type GatewayAuditEntry,
  type GatewayEventPublisherPort,
  type GatewayIdentityPort,
  type GatewayProfilePort,
  type GatewayRuntimePort,
  type GatewayWorkspacePort,
  type ToolExecutionEnvelope
} from "@pc/gateway";
import { EventProjectionService } from "@pc/event-projection";
import {
  MemoryEventProjectionRepository,
  MemoryGatewayRepository
} from "../src/index.js";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const TENANT_ID = "tenant-1";
const SCOPE_REFS = ["project:project-1"];

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function tool(input: {
  id: string;
  actionClass: "READ" | "WRITE" | "EXTERNAL_SIDE_EFFECT";
  permission: string;
  approval: "NONE" | "ALWAYS";
  recovery?: ToolRelease["recovery_class"];
}): ToolRelease {
  return {
    contract_name: "pc.tool-release/1",
    contract_version: 1,
    tool_release_id: input.id,
    tool_definition_id: input.id.replace(/:\d+$/u, ""),
    version: 1,
    provider_kind: "test-provider",
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    schema_digest: createHash("sha256").update(input.id).digest("hex"),
    risk_manifest: {
      action_class: input.actionClass,
      external_side_effect: input.actionClass === "EXTERNAL_SIDE_EFFECT",
      sensitivity: input.approval === "ALWAYS" ? "HIGH" : "LOW",
      requires_readback: false
    },
    required_permissions: [input.permission],
    approval_policy: input.approval,
    idempotency_class: "IDEMPOTENT",
    recovery_class: input.recovery ?? "REPLAY_SAFE",
    compatibility: { contract: "1" },
    status: "PUBLISHED",
    artifact_refs: [`artifact:${input.id}`],
    release_digest: createHash("sha256")
      .update(`release:${input.id}`)
      .digest("hex")
  };
}

const READ_TOOL = tool({
  id: "tool:read:1",
  actionClass: "READ",
  permission: "records.read",
  approval: "NONE"
});
const WRITE_TOOL = tool({
  id: "tool:write:1",
  actionClass: "EXTERNAL_SIDE_EFFECT",
  permission: "records.write",
  approval: "ALWAYS",
  recovery: "RECONCILE_BEFORE_RETRY"
});

function principal(principalId: string): PCPrincipal {
  return {
    principal_id: principalId,
    principal_type: "human",
    tenant_id: TENANT_ID,
    lifecycle_status: "active",
    primary_identity_ref: `identity:${principalId}`,
    identity_revision: 1,
    authorization_revision: 2,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString()
  };
}

function assignment(input: {
  principalId: string;
  sessionId: string;
  profileSnapshotId: string;
  generation?: number;
  fencingToken?: string;
}): SessionAssignment {
  return {
    contract_name: "pc.session-assignment-snapshot/1",
    contract_version: 1,
    assignment_id: `assignment:${input.sessionId}`,
    tenant_id: TENANT_ID,
    user_id: input.principalId,
    pc_session_id: input.sessionId,
    runtime_id: "runtime-1",
    runtime_epoch: 1,
    assignment_generation: input.generation ?? 1,
    fencing_token: input.fencingToken ?? `fence:${input.sessionId}`,
    lease_id: `lease:${input.sessionId}`,
    lease_expires_at: "2026-11-10T13:00:00.000Z",
    state: "ACTIVE",
    effective_profile_snapshot_id: input.profileSnapshotId,
    workspace_view_snapshot_id: `workspace:${input.sessionId}`,
    authorization_revision: 2,
    version: 1,
    current: true,
    assigned_at: NOW.toISOString(),
    accepted_at: NOW.toISOString()
  };
}

function profileSnapshot(
  sessionId: string,
  snapshotId: string,
  toolReleaseIds: string[]
): EffectiveProfileSnapshot {
  return {
    contract_name: "pc.effective-profile-snapshot/1",
    contract_version: 1,
    effective_profile_snapshot_id: snapshotId,
    pc_session_id: sessionId,
    profile_release_id: "profile:test:1",
    profile_assignment_ids: ["profile-assignment-1"],
    authorization_revision: 2,
    tool_release_ids: toolReleaseIds,
    plugin_release_ids: [],
    model_selection: {},
    knowledge_view_refs: [],
    dsh_preset_ref: "preset:test",
    runtime_requirements: {
      dsh_version: "0.2.1-rc.3",
      bridge_protocol_version: "1.0",
      profile_digest: "profile-digest",
      bundle_lock_digest: "bundle-digest"
    },
    resolution_report_id: `report:${sessionId}`,
    created_at: NOW.toISOString(),
    snapshot_digest: digest({ sessionId, toolReleaseIds })
  };
}

class FakeIdentity implements GatewayIdentityPort {
  readonly principals = new Map<string, PCPrincipal>();
  authorizationRevision = 2;

  verifyPrincipalEnvelope(envelope: PrincipalEnvelope, audience?: string): Promise<PCPrincipal> {
    if (audience && audience !== envelope.audience) throw new Error("Principal Envelope target mismatch");
    const value = this.principals.get(envelope.subject_principal_id);
    if (value === undefined) throw new Error("principal missing");
    return Promise.resolve(value);
  }

  evaluatePrincipalAuthorization(input: {
    principal_id: string;
    actions: readonly string[];
    resource_scope_refs: readonly string[];
    tool_release_ids: readonly string[];
    policy_model_revision: number;
    profile_release_id?: string;
  }): Promise<AuthorizationSnapshot> {
    return Promise.resolve({
      contract_name: "pc.authorization-snapshot/1",
      contract_version: 1,
      authorization_revision: this.authorizationRevision,
      policy_model_revision: input.policy_model_revision,
      principal_id: input.principal_id,
      ...(input.profile_release_id === undefined
        ? {}
        : { profile_release_id: input.profile_release_id }),
      allowed_actions: [...input.actions],
      resource_scope_digest: digest(input.resource_scope_refs),
      tool_set_digest: digest(input.tool_release_ids),
      decision: "ALLOW",
      reason_codes: ["test_allow"],
      issued_at: NOW.toISOString(),
      expires_at: "2026-11-10T12:01:00.000Z",
      decision_evidence_refs: ["test:authorization"]
    });
  }
}

class FakeProfiles implements GatewayProfilePort {
  readonly tools = new Map<string, ToolRelease>([
    [READ_TOOL.tool_release_id, READ_TOOL],
    [WRITE_TOOL.tool_release_id, WRITE_TOOL]
  ]);
  readonly snapshots = new Map<string, EffectiveProfileSnapshot>();

  getToolRelease(toolReleaseId: string): Promise<ToolRelease | undefined> {
    return Promise.resolve(this.tools.get(toolReleaseId));
  }

  getEffectiveProfileSnapshot(
    snapshotId: string
  ): Promise<EffectiveProfileSnapshot | undefined> {
    return Promise.resolve(this.snapshots.get(snapshotId));
  }
}

class FakeRuntime implements GatewayRuntimePort {
  readonly assignments = new Map<string, SessionAssignment>();
  guardAllowed = true;

  async getSessionProjection(
    pcSessionId: string
  ): ReturnType<GatewayRuntimePort["getSessionProjection"]> {
    const current = this.assignments.get(pcSessionId);
    if (current === undefined) throw new Error("assignment missing");
    return {
      assignment: current,
      guard: {
        allowed: this.guardAllowed,
        code: this.guardAllowed ? "PC_RUNTIME_GUARD_ALLOWED" : "PC_RUNTIME_DENY",
        reason: this.guardAllowed ? "allowed" : "denied",
        retryable: false
      }
    };
  }

  evaluateToolGuard(): Promise<{
    allowed: boolean;
    code: string;
    reason: string;
    retryable: boolean;
  }> {
    return Promise.resolve({
      allowed: this.guardAllowed,
      code: this.guardAllowed ? "PC_RUNTIME_GUARD_ALLOWED" : "PC_RUNTIME_DENY",
      reason: this.guardAllowed ? "allowed" : "denied",
      retryable: false
    });
  }
}

const workspace: GatewayWorkspacePort = {
  getWorkspaceView: () => Promise.resolve(undefined)
};

class FailingAuditRepository extends MemoryGatewayRepository {
  failAudit = false;

  override appendAudit(entry: GatewayAuditEntry): Promise<void> {
    if (this.failAudit) return Promise.reject(new Error("audit unavailable"));
    return super.appendAudit(entry);
  }
}

async function fixture(
  repository: MemoryGatewayRepository = new MemoryGatewayRepository(),
  eventPublisher?: GatewayEventPublisherPort
) {
  const identity = new FakeIdentity();
  const profiles = new FakeProfiles();
  const runtime = new FakeRuntime();
  const provider = new DeterministicGatewayProvider();
  const service = new ControlledExecutionGatewayService(
    repository,
    identity,
    profiles,
    runtime,
    workspace,
    new EphemeralCredentialIssuer(),
    provider,
    () => new Date(NOW),
    eventPublisher
  );
  await service.initialize();
  const connector = await service.registerConnector({
    tenant_id: TENANT_ID,
    mcp_server_id: "mcp:test",
    endpoint_ref: "internal://mcp-test",
    provider_key: "test-provider",
    auth_mode: "delegated",
    audience: "test-provider",
    allowed_scopes: ["records.read", "records.write"],
    tool_release_ids: [READ_TOOL.tool_release_id, WRITE_TOOL.tool_release_id],
    capability_digest: digest({ tools: ["read", "write"] })
  });
  return {
    repository,
    identity,
    profiles,
    runtime,
    provider,
    service,
    connector
  };
}

async function addSession(
  context: Awaited<ReturnType<typeof fixture>>,
  input: {
    principalId: string;
    sessionId: string;
    tools?: string[];
    externalAccountId?: string;
  }
) {
  const snapshotId = `profile-snapshot:${input.sessionId}`;
  const currentAssignment = assignment({
    principalId: input.principalId,
    sessionId: input.sessionId,
    profileSnapshotId: snapshotId
  });
  context.identity.principals.set(
    input.principalId,
    principal(input.principalId)
  );
  context.runtime.assignments.set(input.sessionId, currentAssignment);
  context.profiles.snapshots.set(
    snapshotId,
    profileSnapshot(
      input.sessionId,
      snapshotId,
      input.tools ?? [READ_TOOL.tool_release_id, WRITE_TOOL.tool_release_id]
    )
  );
  const account = await context.service.bindExternalAccount({
    tenant_id: TENANT_ID,
    connector_id: context.connector.connector_id,
    principal_id: input.principalId,
    external_account_id:
      input.externalAccountId ?? `external:${input.principalId}`,
    credential_subject: `subject:${input.principalId}`,
    secret_ref: `secret-ref:${input.principalId}`
  });
  return { assignment: currentAssignment, account };
}

function envelope(input: {
  connectorId: string;
  currentAssignment: SessionAssignment;
  tool: ToolRelease;
  operationId: string;
  idempotencyKey?: string;
  arguments?: Record<string, unknown>;
  approvalId?: string;
  credentialGeneration?: number;
  businessTaskId?: string;
}): ToolExecutionEnvelope {
  const args = input.arguments ?? { query: "test" };
  const principalEnvelope: PrincipalEnvelope = {
    contract_name: "pc.principal-envelope/1",
    contract_version: 1,
    envelope_id: `envelope:${input.operationId}`,
    issuer: "process-copilot",
    audience: `gateway:${input.connectorId}`,
    tenant_id: input.currentAssignment.tenant_id,
    subject_principal_id: input.currentAssignment.user_id,
    actor_principal_id: input.currentAssignment.user_id,
    ...(input.businessTaskId === undefined
      ? {}
      : { business_task_id: input.businessTaskId }),
    pc_session_id: input.currentAssignment.pc_session_id,
    runtime_id: input.currentAssignment.runtime_id,
    runtime_epoch: input.currentAssignment.runtime_epoch,
    assignment_generation: input.currentAssignment.assignment_generation,
    fencing_token: input.currentAssignment.fencing_token,
    authorization_revision: input.currentAssignment.authorization_revision,
    credential_generation: input.credentialGeneration ?? 1,
    allowed_actions: [...input.tool.required_permissions],
    resource_scope_refs: SCOPE_REFS,
    issued_at: NOW.toISOString(),
    expires_at: "2026-11-10T12:01:00.000Z",
    nonce: `nonce:${input.operationId}`,
    signature: "test-signature"
  };
  return {
    contract_name: "pc.tool-execution-envelope/1",
    contract_version: 1,
    operation_id: input.operationId,
    idempotency_key: input.idempotencyKey ?? `key:${input.operationId}`,
    tool_release_id: input.tool.tool_release_id,
    schema_digest: input.tool.schema_digest,
    arguments: args,
    argument_digest: digest(args),
    principal_envelope: principalEnvelope,
    assignment_snapshot_ref: input.currentAssignment.assignment_id,
    ...(input.approvalId === undefined
      ? {}
      : { approval_snapshot_ref: input.approvalId }),
    deadline: "2026-11-10T12:01:00.000Z",
    recovery_class: input.tool.recovery_class as ToolExecutionEnvelope["recovery_class"]
  };
}

describe("DEV-07 Controlled Gateway", () => {
  it("selects the exact envelope Connector when a reload retains the same Tool on an older Connector", async () => {
    const context = await fixture();
    const next = await context.service.registerConnector({ ...context.connector }, { registration_key: "bundle:next-generation" });
    expect(next.connector_id).not.toBe(context.connector.connector_id);
    const { assignment: currentAssignment } = await addSession({ ...context, connector: next }, { principalId: "reload-owner", sessionId: "reload-session" });
    const result = await context.service.execute(envelope({ connectorId: next.connector_id, currentAssignment, tool: READ_TOOL, operationId: "reload-read" }));
    expect(result.status).toBe("SUCCEEDED");
    expect((await context.service.getOperation("reload-read"))?.connector_id).toBe(next.connector_id);
  });
  it.each(["other-tenant", "other-tool", "wrong-audience"])("rejects an exact target with %s without dispatch", async mismatch => {
    const context = await fixture();
    const { assignment: currentAssignment } = await addSession(context, { principalId: "target-owner", sessionId: "target-session" });
    const target = await context.service.registerConnector({ ...context.connector,
      ...(mismatch === "other-tenant" ? { tenant_id: "unrelated-tenant" } : {}),
      ...(mismatch === "other-tool" ? { tool_release_ids: [WRITE_TOOL.tool_release_id] } : {})
    }, { registration_key: `mismatch:${mismatch}` });
    const input = envelope({ connectorId: target.connector_id, currentAssignment, tool: READ_TOOL, operationId: "rejected-target" });
    if (mismatch === "wrong-audience") (input.principal_envelope as { audience: string }).audience = "runtime:personal-conversation";
    await expect(context.service.execute(input)).rejects.toMatchObject({ code: "PC_GATEWAY_CONNECTOR_UNAVAILABLE" });
    expect(await context.service.getOperation("rejected-target")).toBeUndefined();
  });
  it("retains revoked external account ownership for explicit inactive lookup", async () => {
    const context = await fixture();
    const { account } = await addSession(context, { principalId: "revoked-owner", sessionId: "revoked-session" });
    await context.service.revokeExternalAccount({ tenant_id: TENANT_ID, principal_id: "revoked-owner",
      binding_id: account.external_account_binding_id, expected_generation: account.credential_generation });
    expect(await context.repository.findExternalAccountBinding(TENANT_ID, context.connector.connector_id, "revoked-owner")).toBeUndefined();
    expect(await context.repository.findExternalAccountBinding(TENANT_ID, context.connector.connector_id, "revoked-owner", true)).toMatchObject({
      status: "REVOKED", external_account_id: "external:revoked-owner" });
  });
  it("publishes approval, execution and recovery states into DEV-08 projections", async () => {
    const events = new EventProjectionService(
      new MemoryEventProjectionRepository(),
      undefined,
      undefined,
      undefined,
      undefined,
      () => new Date(NOW)
    );
    await events.initialize();
    const eventPublisher: GatewayEventPublisherPort = {
      approvalState: async (input) => {
        const operation = await events.getOperation(input.operation_id);
        if (operation === undefined || operation.state === input.state) return;
        await events.transitionOperation({
          operation_id: input.operation_id,
          tenant_id: input.tenant_id,
          principal_id: input.principal_id,
          state: input.state,
          evidence_refs: input.evidence_refs,
          producer: "pc-gateway"
        });
      },
      operationState: async (input) => {
        const operation = await events.getOperation(input.operation_id);
        if (operation === undefined || operation.state === input.state) return;
        await events.transitionOperation({
          operation_id: input.operation_id,
          tenant_id: input.tenant_id,
          principal_id: input.principal_id,
          state: input.state,
          external_operation_record_id:
            input.external_operation_record_id,
          ...(input.result_digest === undefined
            ? {}
            : { result_digest: input.result_digest }),
          evidence_refs: input.evidence_refs,
          producer: "pc-gateway"
        });
      }
    };
    const context = await fixture(
      new MemoryGatewayRepository(),
      eventPublisher
    );
    const session = await addSession(context, {
      principalId: "principal-projection",
      sessionId: "session-projection"
    });
    const task = await events.createTask({
      tenant_id: TENANT_ID,
      owner_principal_id: "principal-projection",
      profile_release_id: "profile:test:1",
      source_session_ids: ["session-projection"]
    });

    const approvedOperation = await events.planOperation({
      operation_id: "operation-projection-approved",
      business_task_id: task.business_task_id,
      tenant_id: TENANT_ID,
      principal_id: "principal-projection",
      operation_kind: "EXTERNAL_SIDE_EFFECT",
      recovery_class: "RECONCILE_BEFORE_RETRY",
      input_digest: digest({ value: "approved" })
    });
    const approval = await context.service.requestApproval({
      tenant_id: TENANT_ID,
      requested_by: "principal-projection",
      actor_principal_id: "principal-projection",
      business_task_id: task.business_task_id,
      operation_id: approvedOperation.operation_id,
      tool_release_id: WRITE_TOOL.tool_release_id,
      arguments: { value: "approved" },
      resource_scope_refs: SCOPE_REFS,
      authorization_revision: 2
    });
    await expect(events.getOperation(approvedOperation.operation_id))
      .resolves.toMatchObject({ state: "AWAITING_APPROVAL" });
    await context.service.decideApproval({
      tenant_id: TENANT_ID,
      approval_id: approval.approval_id,
      approver_principal_id: "approver-projection",
      expected_version: approval.approval_version,
      decision: "APPROVE",
      reason_codes: ["business_owner_approved"],
      evidence_refs: ["ticket:projection"]
    });
    await context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: WRITE_TOOL,
      operationId: approvedOperation.operation_id,
      arguments: { value: "approved" },
      approvalId: approval.approval_id,
      businessTaskId: task.business_task_id
    }));
    await expect(events.getOperation(approvedOperation.operation_id))
      .resolves.toMatchObject({
        state: "VERIFYING",
        external_operation_record_id: approvedOperation.operation_id
      });
    await events.transitionOperation({
      operation_id: approvedOperation.operation_id,
      tenant_id: TENANT_ID,
      principal_id: "principal-projection",
      state: "SUCCEEDED",
      evidence_refs: ["readback:projection"]
    });
    await expect(events.getOperation(approvedOperation.operation_id))
      .resolves.toMatchObject({
        state: "SUCCEEDED",
        evidence_refs: expect.arrayContaining(["readback:projection"])
      });

    const unknownOperation = await events.planOperation({
      operation_id: "operation-projection-unknown",
      business_task_id: task.business_task_id,
      tenant_id: TENANT_ID,
      principal_id: "principal-projection",
      operation_kind: "READ",
      recovery_class: "REPLAY_SAFE",
      input_digest: digest({ simulate: "unknown" })
    });
    await context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: READ_TOOL,
      operationId: unknownOperation.operation_id,
      arguments: { simulate: "unknown" },
      businessTaskId: task.business_task_id
    }));
    await expect(events.getOperation(unknownOperation.operation_id))
      .resolves.toMatchObject({ state: "OUTCOME_UNKNOWN" });
    events.registerRecoveryGateway({
      getOperation: async (operationId) => {
        const operation = await context.service.getOperation(operationId);
        if (operation === undefined) return undefined;
        return {
          operation_id: operation.operation_id,
          outcome_state: operation.outcome_state,
          recovery_class: operation.recovery_class,
          ...(operation.provider_operation_id === undefined
            ? {}
            : { provider_operation_id: operation.provider_operation_id })
        };
      },
      reconcile: async (operationId) => {
        const result = await context.service.reconcile(operationId);
        return {
          outcome_state: result.outcome_state,
          ...(result.provider_operation_id === undefined
            ? {}
            : { provider_operation_id: result.provider_operation_id }),
          external_evidence_refs: [...result.external_evidence_refs]
        };
      }
    });
    const recovery = await events.openRecoveryCase({
      tenant_id: TENANT_ID,
      owner_principal_id: "principal-projection",
      business_task_id: task.business_task_id,
      trigger: "OUTCOME_UNKNOWN",
      affected_operation_ids: [unknownOperation.operation_id]
    });
    const reconciled = await events.reconcileRecoveryCase({
      recovery_case_id: recovery.recovery_case_id,
      tenant_id: TENANT_ID,
      principal_id: "principal-projection"
    });
    expect(reconciled.recovery_case.state).toBe("RECOVERED");
    await expect(events.getOperation(unknownOperation.operation_id))
      .resolves.toMatchObject({ state: "SUCCEEDED" });

    await context.service.close();
    await events.close();
  });

  it("deduplicates completed and concurrent calls without a second dispatch", async () => {
    const context = await fixture();
    const session = await addSession(context, {
      principalId: "principal-1",
      sessionId: "session-1"
    });
    const request = envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: READ_TOOL,
      operationId: "operation-1",
      idempotencyKey: "stable-key"
    });
    const first = await context.service.execute(request);
    const duplicate = await context.service.execute(request);
    expect(duplicate.result_digest).toBe(first.result_digest);
    expect(context.provider.dispatches).toHaveLength(1);

    const concurrentRequest = envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: READ_TOOL,
      operationId: "operation-concurrent",
      idempotencyKey: "concurrent-key"
    });
    const concurrent = await Promise.allSettled([
      context.service.execute(concurrentRequest),
      context.service.execute(concurrentRequest)
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    expect(context.provider.dispatches).toHaveLength(2);
  });

  it("rejects a reused idempotency key with a different request digest", async () => {
    const context = await fixture();
    const session = await addSession(context, {
      principalId: "principal-1",
      sessionId: "session-1"
    });
    await context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: READ_TOOL,
      operationId: "operation-original",
      idempotencyKey: "same-key",
      arguments: { query: "first" }
    }));
    await expect(context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: READ_TOOL,
      operationId: "operation-changed",
      idempotencyKey: "same-key",
      arguments: { query: "second" }
    }))).rejects.toMatchObject({
      code: "PC_GATEWAY_IDEMPOTENCY_CONFLICT"
    });
  });

  it("isolates MCP bindings by Principal and PC Session", async () => {
    const context = await fixture();
    const first = await addSession(context, {
      principalId: "principal-1",
      sessionId: "session-1"
    });
    const secondSession = assignment({
      principalId: "principal-1",
      sessionId: "session-2",
      profileSnapshotId: "profile-snapshot:session-2"
    });
    context.runtime.assignments.set("session-2", secondSession);
    context.profiles.snapshots.set(
      "profile-snapshot:session-2",
      profileSnapshot(
        "session-2",
        "profile-snapshot:session-2",
        [READ_TOOL.tool_release_id]
      )
    );
    const secondUser = await addSession(context, {
      principalId: "principal-2",
      sessionId: "session-3"
    });

    await context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: first.assignment,
      tool: READ_TOOL,
      operationId: "operation-session-1"
    }));
    await context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: secondSession,
      tool: READ_TOOL,
      operationId: "operation-session-2"
    }));
    await context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: secondUser.assignment,
      tool: READ_TOOL,
      operationId: "operation-session-3"
    }));
    const operations = await Promise.all([
      context.service.getOperation("operation-session-1"),
      context.service.getOperation("operation-session-2"),
      context.service.getOperation("operation-session-3")
    ]);
    expect(new Set(operations.map((operation) => operation?.mcp_binding_id)).size)
      .toBe(3);
  });

  it("fails closed for hidden tools, stale credential generation and stale guard", async () => {
    const context = await fixture();
    const hidden = await addSession(context, {
      principalId: "principal-hidden",
      sessionId: "session-hidden",
      tools: [READ_TOOL.tool_release_id]
    });
    await expect(context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: hidden.assignment,
      tool: WRITE_TOOL,
      operationId: "operation-hidden"
    }))).rejects.toMatchObject({
      code: "PC_GATEWAY_TOOL_NOT_IN_EFFECTIVE_PROFILE"
    });

    const visible = await addSession(context, {
      principalId: "principal-visible",
      sessionId: "session-visible"
    });
    await context.service.rotateExternalAccount({
      tenant_id: TENANT_ID,
      principal_id: "principal-visible",
      binding_id: visible.account.external_account_binding_id,
      expected_generation: 1,
      secret_ref: "secret-ref:rotated"
    });
    await expect(context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: visible.assignment,
      tool: READ_TOOL,
      operationId: "operation-stale-credential",
      credentialGeneration: 1
    }))).rejects.toMatchObject({
      code: "PC_GATEWAY_CREDENTIAL_GENERATION_STALE"
    });

    context.runtime.guardAllowed = false;
    await expect(context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: visible.assignment,
      tool: READ_TOOL,
      operationId: "operation-guard",
      credentialGeneration: 2
    }))).rejects.toMatchObject({ code: "PC_RUNTIME_DENY" });
  });

  it("binds approval to exact arguments and consumes it atomically", async () => {
    const context = await fixture();
    const session = await addSession(context, {
      principalId: "principal-1",
      sessionId: "session-1"
    });
    const approval = await context.service.requestApproval({
      tenant_id: TENANT_ID,
      requested_by: "principal-1",
      actor_principal_id: "principal-1",
      operation_id: "operation-write",
      tool_release_id: WRITE_TOOL.tool_release_id,
      arguments: { value: "approved" },
      resource_scope_refs: SCOPE_REFS,
      authorization_revision: 2
    });
    await expect(context.service.decideApproval({
      tenant_id: TENANT_ID,
      approval_id: approval.approval_id,
      approver_principal_id: "principal-1",
      expected_version: approval.approval_version,
      decision: "APPROVE",
      reason_codes: ["self"]
    })).rejects.toMatchObject({
      code: "PC_GATEWAY_APPROVAL_SELF_APPROVAL_DENIED"
    });
    const approved = await context.service.decideApproval({
      tenant_id: TENANT_ID,
      approval_id: approval.approval_id,
      approver_principal_id: "approver-2",
      expected_version: approval.approval_version,
      decision: "APPROVE",
      reason_codes: ["business_owner_approved"],
      evidence_refs: ["ticket:123"]
    });
    expect(approved.decision_evidence_refs).toEqual(["ticket:123"]);
    await expect(context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: WRITE_TOOL,
      operationId: "operation-write",
      arguments: { value: "changed" },
      approvalId: approval.approval_id
    }))).rejects.toMatchObject({ code: "PC_GATEWAY_APPROVAL_STALE" });

    await expect(context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: WRITE_TOOL,
      operationId: "operation-write",
      arguments: { value: "approved" },
      approvalId: approval.approval_id
    }))).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(context.service.getApproval(approval.approval_id))
      .resolves.toMatchObject({
        status: "CONSUMED",
        decision: { outcome: "CONSUME" }
      });
  });

  it("persists Outcome Unknown and converges through reconciliation", async () => {
    const context = await fixture();
    const session = await addSession(context, {
      principalId: "principal-1",
      sessionId: "session-1"
    });
    const unknown = await context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: READ_TOOL,
      operationId: "operation-unknown",
      arguments: { simulate: "unknown" }
    }));
    expect(unknown).toMatchObject({
      status: "OUTCOME_UNKNOWN",
      outcome_state: "OUTCOME_UNKNOWN",
      reconciliation_required: true
    });
    await expect(context.service.reconcile("operation-unknown"))
      .resolves.toMatchObject({
        status: "SUCCEEDED",
        outcome_state: "KNOWN_SUCCESS",
        reconciliation_required: false
      });
  });

  it("does not dispatch when durable audit persistence fails", async () => {
    const repository = new FailingAuditRepository();
    const context = await fixture(repository);
    const session = await addSession(context, {
      principalId: "principal-1",
      sessionId: "session-1"
    });
    repository.failAudit = true;
    await expect(context.service.execute(envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: READ_TOOL,
      operationId: "operation-audit-failure"
    }))).rejects.toThrow("audit unavailable");
    expect(context.provider.dispatches).toHaveLength(0);
    const operation = await context.service.getOperation(
      "operation-audit-failure"
    );
    expect(operation).toMatchObject({
      dispatch_state: "PENDING",
      outcome_state: "NOT_STARTED"
    });
    expect(JSON.stringify(operation)).not.toContain("ephemeral.");
    expect(JSON.stringify(await context.service.listOperationAudit(
      "operation-audit-failure"
    ))).not.toContain("secret-ref");
  });

  it("rejects stale schema and recovery metadata before credential issue", async () => {
    const context = await fixture();
    const session = await addSession(context, {
      principalId: "principal-1",
      sessionId: "session-1"
    });
    const staleSchema = envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: READ_TOOL,
      operationId: "operation-schema"
    });
    staleSchema.schema_digest = "0".repeat(64);
    await expect(context.service.execute(staleSchema)).rejects.toMatchObject({
      code: "PC_GATEWAY_TOOL_SCHEMA_STALE"
    });
    const staleRecovery = envelope({
      connectorId: context.connector.connector_id,
      currentAssignment: session.assignment,
      tool: READ_TOOL,
      operationId: "operation-recovery"
    });
    staleRecovery.recovery_class = "NON_RECOVERABLE";
    await expect(context.service.execute(staleRecovery)).rejects.toMatchObject({
      code: "PC_GATEWAY_RECOVERY_CLASS_MISMATCH"
    });
  });
});
