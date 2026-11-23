import { afterEach, describe, expect, it, vi } from "vitest";
import { EventProjectionService } from "@pc/event-projection";
import { ReadOperationVerifier } from "../src/read-operation-verifier.js";
import { buildApiServer } from "../src/server.js";
import { RuntimeWorkbench, type WorkbenchOptions } from "../src/workbench.js";
import { GatewayProviderError } from "@pc/gateway";
import { readOperationFixture as fixture } from "./support/read-operation-fixture.js";

afterEach(() => vi.restoreAllMocks());

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
