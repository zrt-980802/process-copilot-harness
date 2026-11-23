import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityAuthorizationService } from "@pc/application";
import type { ToolRelease, SessionAssignment } from "@pc/domain";
import { EventProjectionService } from "@pc/event-projection";
import { ControlledExecutionGatewayService, EphemeralCredentialIssuer, mcpDigest,
  type GatewayProviderPort, type ToolExecutionEnvelope } from "@pc/gateway";
import { MemoryEventProjectionRepository, MemoryGatewayRepository, MemoryIdentityAuthorizationRepository } from "@pc/persistence";
import { gatewayEventPublisher } from "../src/gateway-event-publisher.js";
import { ReadOperationVerifier } from "../src/read-operation-verifier.js";
import { buildApiServer } from "../src/server.js";
import { RuntimeWorkbench, type WorkbenchOptions } from "../src/workbench.js";
import { GatewayProviderError } from "@pc/gateway";

afterEach(() => vi.restoreAllMocks());

async function fixture(autoVerify = true, kind: "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL_SIDE_EFFECT" = "READ") {
  const now = () => new Date("2026-11-23T04:00:00.000Z");
  const identity = new IdentityAuthorizationService(new MemoryIdentityAuthorizationRepository(), "rci03-synthetic-signing-key-00000000000", [], now);
  await identity.provisionPilotAccount({ tenant_id: "rci03", account_key: "engineer", secret: "SyntheticRci03Secret123" });
  const login = await identity.signInPilot("rci03", "engineer", "SyntheticRci03Secret123");
  const principal = login.principal;
  const tool: ToolRelease = { contract_name: "pc.tool-release/1", contract_version: 1,
    tool_release_id: "tool:rci03:read:1", tool_definition_id: "ee.read", version: 1,
    provider_kind: "synthetic-port", input_schema: { type: "object" }, output_schema: { type: "object" },
    schema_digest: "1".repeat(64), risk_manifest: { action_class: kind, sensitivity: "LOW", requires_readback: false },
    required_permissions: ["ee.read"], approval_policy: "NONE", idempotency_class: "IDEMPOTENT", recovery_class: "REPLAY_SAFE",
    compatibility: {}, status: "PUBLISHED", artifact_refs: ["artifact:rci03"], release_digest: "2".repeat(64) };
  const projectionRepository = new MemoryEventProjectionRepository();
  const events = new EventProjectionService(projectionRepository, undefined, undefined, undefined, undefined, now);
  const task = await events.createTask({ tenant_id: principal.tenant_id, owner_principal_id: principal.principal_id,
    profile_release_id: "profile:rci03", project_id: "project-rci03" });
  const repository = new MemoryGatewayRepository();
  const publisher = gatewayEventPublisher(events, repository);
  if (!autoVerify) delete publisher.verifyReadOperation;
  const dispatch = vi.fn<GatewayProviderPort["dispatch"]>(async () => ({ provider_operation_id: "trace-rci03-read",
    result: { ok: true, trace_id: "trace-rci03-read", data: { document: "Synthetic port response" } },
    external_evidence_refs: ["eea://traces/trace-rci03-read"] }));
  const assignment = { assignment_id: "assignment:rci03", tenant_id: principal.tenant_id, user_id: principal.principal_id,
    pc_session_id: "pc_rci03", runtime_id: "runtime:rci03", runtime_epoch: 1, assignment_generation: 1,
    authorization_revision: 1, fencing_token: "fence:rci03", effective_profile_snapshot_id: "profile-snapshot:rci03" } as SessionAssignment;
  const gateway = new ControlledExecutionGatewayService(repository, {
    verifyPrincipalEnvelope: async () => principal,
    evaluatePrincipalAuthorization: async () => ({ decision: "ALLOW", authorization_revision: 1 } as never)
  }, { getToolRelease: async () => tool, getEffectiveProfileSnapshot: async () => ({
    pc_session_id: assignment.pc_session_id, profile_release_id: "profile:rci03", authorization_revision: 1,
    tool_release_ids: [tool.tool_release_id] } as never) }, {
    getSessionProjection: async () => ({ assignment, guard: { allowed: true, code: "ALLOW", reason: "allowed", retryable: false } }),
    evaluateToolGuard: async () => ({ allowed: true, code: "ALLOW", reason: "allowed", retryable: false })
  }, { getWorkspaceView: async () => undefined }, new EphemeralCredentialIssuer(), {
    dispatch, reconcile: async () => { throw new Error("READ projection must not reconcile with Provider"); }
  }, now, publisher);
  const connector = await gateway.registerConnector({ tenant_id: principal.tenant_id, mcp_server_id: "synthetic:rci03",
    endpoint_ref: "internal://synthetic-rci03", provider_key: "synthetic-port", auth_mode: "delegated", audience: "synthetic:rci03",
    allowed_scopes: ["ee.read"], tool_release_ids: [tool.tool_release_id], capability_digest: mcpDigest([tool.tool_release_id]) });
  await gateway.bindExternalAccount({ tenant_id: principal.tenant_id, connector_id: connector.connector_id,
    principal_id: principal.principal_id, external_account_id: "42", credential_subject: "synthetic:42", secret_ref: "synthetic-ref:rci03" });
  const operationId = "rci03-read-red-01";
  const args = { query: "read" };
  await events.planOperation({ operation_id: operationId, business_task_id: task.business_task_id,
    tenant_id: principal.tenant_id, principal_id: principal.principal_id, operation_kind: kind, recovery_class: "REPLAY_SAFE",
    input_digest: mcpDigest(args) });
  const envelope: ToolExecutionEnvelope = { contract_name: "pc.tool-execution-envelope/1", contract_version: 1,
    operation_id: operationId, idempotency_key: "rci03-key-01", tool_release_id: tool.tool_release_id,
    schema_digest: tool.schema_digest, arguments: args, argument_digest: mcpDigest(args), assignment_snapshot_ref: assignment.assignment_id,
    deadline: new Date(now().getTime() + 60_000).toISOString(), recovery_class: "REPLAY_SAFE", principal_envelope: {
      contract_name: "pc.principal-envelope/1", contract_version: 1, envelope_id: "envelope:rci03", issuer: "process-copilot",
      audience: `gateway:${connector.connector_id}`, tenant_id: principal.tenant_id, subject_principal_id: principal.principal_id,
      actor_principal_id: principal.principal_id, business_task_id: task.business_task_id, pc_session_id: assignment.pc_session_id,
      runtime_id: assignment.runtime_id, runtime_epoch: 1, assignment_generation: 1, authorization_revision: 1,
      credential_generation: 1, fencing_token: assignment.fencing_token, allowed_actions: ["ee.read"],
      resource_scope_refs: ["project:project-rci03"], issued_at: now().toISOString(), expires_at: new Date(now().getTime() + 60_000).toISOString(),
      nonce: "nonce:rci03", signature: "synthetic-envelope-port" } };
  const verifier = new ReadOperationVerifier(events, repository);
  const input = { operation_id: operationId, tenant_id: principal.tenant_id, principal_id: principal.principal_id };
  return { gateway, repository, events, projectionRepository, dispatch, envelope, publisher, identity, login, principal, task, tool, verifier, input, connector, assignment };
}

describe("RCI-03 real Gateway/EventProjection service boundary (synthetic Provider Port)", () => {
  it.each(["first execution", "idempotent replay"])("closes READ projection after %s", async mode => {
    const f = await fixture();
    const result = await f.gateway.execute(f.envelope);
    if (mode === "idempotent replay") await f.gateway.execute(f.envelope);
    expect(result).toMatchObject({ status: "SUCCEEDED", outcome_state: "KNOWN_SUCCESS" });
    expect(await f.repository.getOperation(f.envelope.operation_id)).toMatchObject({ dispatch_state: "COMPLETED", outcome_state: "KNOWN_SUCCESS" });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(await f.events.getOperation(f.envelope.operation_id)).toMatchObject({ state: "SUCCEEDED", result_digest: result.result_digest });
    const verified = (await f.projectionRepository.listTaskEvents(f.task.business_task_id)).filter(r => r.envelope.event_type === "pc.operation.verified");
    expect(verified).toHaveLength(1);
    expect(verified[0]?.envelope.producer).toBe("pc-read-verifier");
    expect(verified[0]?.envelope.payload.verifier_version).toBe("1.0.0");
  });

  it("repairs a persisted VERIFYING result on Gateway idempotent hit without another dispatch", async () => {
    const f = await fixture(false);
    const result = await f.gateway.execute(f.envelope);
    expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe("VERIFYING");
    f.publisher.verifyReadOperation = async input => { await f.verifier.verify(input); };
    expect(await f.gateway.execute(f.envelope)).toEqual(result);
    expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe("SUCCEEDED");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it("also verifies the beginOperation idempotency race result", async () => {
    const f = await fixture(false);
    await f.gateway.execute(f.envelope);
    f.publisher.verifyReadOperation = async input => { await f.verifier.verify(input); };
    vi.spyOn(f.repository, "findOperationByIdempotency").mockResolvedValue(undefined);
    await f.gateway.execute(f.envelope);
    expect((await f.events.getOperation(f.input.operation_id))?.state).toBe("SUCCEEDED");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it.each(["before verifying", "before verified", "pending verified event"])("recovers interruption %s from durable facts without Provider replay", async window => {
    const f = await fixture();
    if (window === "before verifying") {
      const publish = f.publisher.operationState;
      vi.spyOn(f.publisher, "operationState").mockImplementation(async input => {
        if (input.state === "VERIFYING") throw new Error("synthetic process interruption");
        return publish(input);
      });
    } else if (window === "before verified") {
      vi.spyOn(f.publisher, "verifyReadOperation").mockRejectedValueOnce(new Error("synthetic process interruption"));
    } else {
      const commit = f.projectionRepository.commitAppliedEvent.bind(f.projectionRepository);
      vi.spyOn(f.projectionRepository, "commitAppliedEvent").mockImplementationOnce(async input => commit(input));
      vi.spyOn(f.events, "recordReadVerification").mockImplementationOnce(async input => {
        const apply = vi.spyOn(f.projectionRepository, "commitAppliedEvent").mockRejectedValueOnce(new Error("synthetic process interruption"));
        try { return await Object.getPrototypeOf(f.events).recordReadVerification.call(f.events, input); }
        finally { apply.mockRestore(); }
      });
    }
    await expect(f.gateway.execute(f.envelope)).rejects.toThrow("synthetic process interruption");
    const persisted = await f.repository.getOperation(f.envelope.operation_id);
    expect(persisted).toMatchObject({ dispatch_state: "COMPLETED", outcome_state: "KNOWN_SUCCESS" });
    // A fresh service has no process memory from the interrupted verifier.
    const restarted = new ReadOperationVerifier(new EventProjectionService(f.projectionRepository), f.repository);
    expect(await restarted.verify(f.input)).toMatchObject({ after_state: "SUCCEEDED" });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it.each(["operation id", "tenant", "principal", "task", "READ kind", "result id", "C22 digest", "C24 arguments", "Provider evidence", "Provider id", "in progress"])(
    "rejects mismatched persisted %s without changing VERIFYING", async variant => {
      const f = await fixture(false);
      await f.gateway.execute(f.envelope);
      const original = (await f.repository.getOperation(f.envelope.operation_id))!;
      const record = structuredClone(original);
      if (variant === "operation id") record.operation_id = "other";
      if (variant === "tenant") record.tenant_id = "other";
      if (variant === "principal") record.principal_id = "other";
      if (variant === "task") record.business_task_id = "other";
      if (variant === "READ kind") record.operation_kind = "WRITE";
      if (variant === "result id") record.result!.operation_id = "other";
      if (variant === "C22 digest") record.result!.result.data = "modified without rehash";
      if (variant === "C24 arguments") record.arguments = { query: "tampered" };
      if (variant === "Provider evidence") record.evidence_refs = [];
      if (variant === "Provider id") record.provider_operation_id = "other";
      if (variant === "in progress") record.dispatch_state = "DISPATCHED";
      vi.spyOn(f.repository, "getOperation").mockResolvedValue(record);
      await expect(f.verifier.verify(f.input)).rejects.toMatchObject({ code: expect.stringMatching(/^PC_READ_VERIFICATION_/u) });
      expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe("VERIFYING");
      expect(f.dispatch).toHaveBeenCalledTimes(1);
    });

  it.each(["C28 digest", "C28 input", "missing Gateway", "missing result", "missing business task"])("rejects %s", async variant => {
    const f = await fixture(false);
    await f.gateway.execute(f.envelope);
    if (variant.startsWith("C28")) {
      const business = (await f.events.getOperation(f.envelope.operation_id))!;
      vi.spyOn(f.events, "getOperation").mockResolvedValue({ ...business,
        ...(variant === "C28 digest" ? { result_digest: "sha256:wrong" } : { input_digest: "sha256:wrong" }) });
    } else if (variant === "missing business task") vi.spyOn(f.events, "getTask").mockResolvedValue(undefined);
    else {
      const record = (await f.repository.getOperation(f.envelope.operation_id))!;
      vi.spyOn(f.repository, "getOperation").mockResolvedValue(variant === "missing Gateway" ? undefined : { ...record, result: undefined });
    }
    await expect(f.verifier.verify(f.input)).rejects.toMatchObject({ code: expect.stringMatching(/^PC_READ_VERIFICATION_/u) });
    expect((await f.projectionRepository.getOperation(f.envelope.operation_id))?.state).toBe("VERIFYING");
  });

  it.each(["WRITE", "DESTRUCTIVE", "EXTERNAL_SIDE_EFFECT"] as const)("never auto-verifies %s", async kind => {
    const f = await fixture(false);
    await f.gateway.execute(f.envelope);
    const business = (await f.events.getOperation(f.envelope.operation_id))!;
    vi.spyOn(f.events, "getOperation").mockResolvedValue({ ...business, operation_kind: kind });
    await expect(f.verifier.verify(f.input)).rejects.toMatchObject({ code: "PC_READ_VERIFICATION_UNSUPPORTED_KIND" });
    const hook = vi.fn();
    f.publisher.verifyReadOperation = hook;
    const record = (await f.repository.getOperation(f.envelope.operation_id))!;
    vi.spyOn(f.repository, "findOperationByIdempotency").mockResolvedValue({ ...record, operation_kind: kind });
    await f.gateway.execute(f.envelope);
    expect(hook).not.toHaveBeenCalled();
    expect((await f.projectionRepository.getOperation(f.envelope.operation_id))?.state).toBe("VERIFYING");
  });

  it.each(["WRITE", "DESTRUCTIVE", "EXTERNAL_SIDE_EFFECT"] as const)("preserves a freshly executed %s at VERIFYING and rejects its verify API", async kind => {
    const f = await fixture(true, kind);
    if (kind !== "WRITE") {
      const approval = await f.gateway.requestApproval({ tenant_id: f.principal.tenant_id,
        requested_by: f.principal.principal_id, actor_principal_id: f.principal.principal_id, business_task_id: f.task.business_task_id,
        operation_id: f.envelope.operation_id, tool_release_id: f.tool.tool_release_id, arguments: f.envelope.arguments,
        resource_scope_refs: [...f.envelope.principal_envelope.resource_scope_refs], authorization_revision: 1 });
      await f.gateway.decideApproval({ tenant_id: f.principal.tenant_id, approval_id: approval.approval_id,
        approver_principal_id: "synthetic-distinct-reviewer", expected_version: approval.approval_version,
        decision: "APPROVE", reason_codes: ["synthetic-explicit-approval"] });
      f.envelope.approval_snapshot_ref = approval.approval_id;
    }
    expect((await f.gateway.execute(f.envelope)).status).toBe("SUCCEEDED");
    expect((await f.events.getOperation(f.input.operation_id))?.state).toBe("VERIFYING");
    const server = buildApiServer({ identityAuthorization: f.identity, controlledGateway: f.gateway, eventProjection: f.events });
    try {
      const response = await server.inject({ method: "POST", url: `/v1/business-operations/${f.input.operation_id}/verify`,
        headers: { authorization: `Bearer ${f.login.access_token}` }, payload: {} });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("PC_READ_VERIFICATION_UNSUPPORTED_KIND");
      expect((await f.events.getOperation(f.input.operation_id))?.state).toBe("VERIFYING");
    } finally { await server.close(); }
  });

  it.each(["failure", "unknown"])("preserves %s and refuses verification", async outcome => {
    const f = await fixture();
    f.dispatch.mockRejectedValue(new GatewayProviderError("PC_SYNTHETIC_PROVIDER_FAILURE", "Synthetic Provider outcome", outcome === "unknown"));
    await f.gateway.execute(f.envelope);
    const state = outcome === "unknown" ? "OUTCOME_UNKNOWN" : "FAILED";
    expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe(state);
    await expect(f.verifier.verify(f.input)).rejects.toMatchObject({ code: "PC_READ_VERIFICATION_STATE_CONFLICT" });
    expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe(state);
  });

  it("refuses PLANNED instead of jumping over dispatch and verification", async () => {
    const f = await fixture();
    await expect(f.verifier.verify(f.input)).rejects.toMatchObject({ code: "PC_READ_VERIFICATION_STATE_CONFLICT" });
    expect((await f.events.getOperation(f.input.operation_id))?.state).toBe("PLANNED");
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it.each(["direct Gateway", "internal Runtime Tool"])("uses the same system verifier from %s HTTP entry", async entry => {
    const f = await fixture();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.envelope.principal_envelope.issued_at));
    const snapshot = { effective_profile_snapshot_id: "profile-snapshot:rci03", dsh_preset_ref: "preset:rci03",
      tool_release_ids: [f.tool.tool_release_id], knowledge_view_refs: f.envelope.principal_envelope.resource_scope_refs };
    const workspace = { workspace_id: "rci03", business_task_id: f.task.business_task_id,
      tenant_id: f.principal.tenant_id, owner_principal_id: f.principal.principal_id };
    const workbench = new RuntimeWorkbench({ gateway: f.gateway, gatewayRepository: f.repository, connector: f.connector,
      profileReleaseId: "profile:rci03", reviewProfileReleaseId: "profile:rci03", tools: [f.tool],
      projectDirectory: {}, workbenchProjection: {}, events: f.events, workspace: async () => workspace,
      identity: { verifyPrincipalEnvelope: async () => f.principal },
      registry: { getSessionProjection: async () => ({ assignment: { ...f.assignment, pc_session_id: "pc_rci03" } }) },
      profiles: { getToolRelease: async () => f.tool, getEffectiveProfileSnapshot: async () => snapshot }
    } as unknown as WorkbenchOptions);
    const server = buildApiServer({ identityAuthorization: f.identity, controlledGateway: f.gateway, eventProjection: f.events, workbench });
    try {
      const response = await server.inject({ method: "POST", url: entry === "direct Gateway" ? "/v1/gateway/execute" : "/v1/internal/runtime-tools/execute",
        headers: { authorization: `Bearer ${f.login.access_token}` }, payload: entry === "direct Gateway" ? f.envelope
          : { context: { principal_envelope: { ...f.envelope.principal_envelope, pc_session_id: "pc_rci03" },
            effective_profile_snapshot_id: snapshot.effective_profile_snapshot_id, dsh_preset_ref: snapshot.dsh_preset_ref,
            turn_id: "turn:rci03", tools: [{ tool_release_id: f.tool.tool_release_id }] },
          tool_release_id: f.tool.tool_release_id, call_id: "call:rci03", arguments: f.envelope.arguments } });
      expect(response.statusCode, response.body).toBe(200);
      const result = entry === "direct Gateway" ? response.json() : response.json().structuredContent;
      expect((await f.events.getOperation(result.operation_id))?.state).toBe("SUCCEEDED");
      expect(f.dispatch).toHaveBeenCalledTimes(1);
    } finally { await server.close(); }
  });

  it.each(["VERIFYING", "DISPATCHED"])("commits one verified event across concurrent instances from %s and rebuilds identical state", async predecessor => {
    const f = await fixture(false);
    if (predecessor === "DISPATCHED") {
      const publish = f.publisher.operationState;
      vi.spyOn(f.publisher, "operationState").mockImplementation(async input => {
        if (input.state === "VERIFYING") throw new Error("synthetic process interruption");
        return publish(input);
      });
      await expect(f.gateway.execute(f.envelope)).rejects.toThrow("synthetic process interruption");
    } else await f.gateway.execute(f.envelope);
    const result = (await f.repository.getOperation(f.input.operation_id))!.result!;
    const outputs = await Promise.all(Array.from({ length: 8 }, () => new ReadOperationVerifier(
      new EventProjectionService(f.projectionRepository), f.repository).verify(f.input)));
    expect(outputs.every(result => result.after_state === "SUCCEEDED")).toBe(true);
    expect((await f.projectionRepository.listTaskEvents(f.task.business_task_id)).filter(r => r.envelope.event_type === "pc.operation.verified")).toHaveLength(1);
    const rebuilt = await f.events.rebuildTask(f.task.business_task_id);
    expect(rebuilt.digest_matches).toBe(true);
    expect(rebuilt.operations[0]).toMatchObject({ state: "SUCCEEDED", result_digest: result.result_digest });
    await f.verifier.verify(f.input);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it.each(["forged facts", "cross principal", "cross tenant", "owner", "revoked visibility"])("verify API checks %s without accepting client success facts", async variant => {
    const f = await fixture(false);
    await f.gateway.execute(f.envelope);
    let login = f.login;
    if (variant.startsWith("cross")) {
      const tenant = variant === "cross tenant" ? "other" : "rci03";
      await f.identity.provisionPilotAccount({ tenant_id: tenant, account_key: "other", secret: "SyntheticOtherRci03123" });
      login = await f.identity.signInPilot(tenant, "other", "SyntheticOtherRci03123");
    }
    if (variant === "revoked visibility") {
      const account = (await f.repository.findExternalAccountBinding(f.principal.tenant_id,
        (await f.repository.getOperation(f.envelope.operation_id))!.connector_id, f.principal.principal_id))!;
      await f.gateway.revokeExternalAccount({ tenant_id: f.principal.tenant_id, principal_id: f.principal.principal_id,
        binding_id: account.external_account_binding_id, expected_generation: account.credential_generation });
    }
    const server = buildApiServer({ identityAuthorization: f.identity, controlledGateway: f.gateway, eventProjection: f.events });
    try {
      const response = await server.inject({ method: "POST", url: `/v1/business-operations/${f.envelope.operation_id}/verify`,
        headers: { authorization: `Bearer ${login.access_token}` }, payload: variant === "forged facts"
          ? { evidence_refs: ["eea://traces/forged"], result_digest: "sha256:forged" } : {} });
      expect(response.statusCode, response.body).toBe(variant === "owner" ? 200 : 403);
      if (variant === "owner") {
        expect(response.json()).toMatchObject({ before_state: "VERIFYING", after_state: "SUCCEEDED", verifier_version: "1.0.0" });
        expect(response.body).not.toContain("Synthetic port response");
      }
      expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe(variant === "owner" ? "SUCCEEDED" : "VERIFYING");
      expect(f.dispatch).toHaveBeenCalledTimes(1);
    } finally { await server.close(); }
  });
});
