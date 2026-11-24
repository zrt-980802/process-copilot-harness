import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { evidenceDigest } from "@pc/domain";
import { authorizationMvpFixture } from "./support/authorization-mvp-fixture.js";
import { RuntimeWorkbench } from "../src/workbench.js";

const servers: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
async function fixture(autoVerify = true) { const f = await authorizationMvpFixture(autoVerify); servers.push(f.server); return f; }

async function assertHeld(f: Awaited<ReturnType<typeof fixture>>, pending: Promise<unknown>) {
  await expect(pending).rejects.toMatchObject({ code: "PC_GATEWAY_RESULT_DELIVERY_DENIED" });
  expect(await f.repository.getOperation(f.envelope.operation_id)).toMatchObject({ dispatch_state: "COMPLETED", outcome_state: "KNOWN_SUCCESS", result: { status: "SUCCEEDED" } });
  expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe("VERIFYING");
  expect((await f.projectionRepository.listTaskEvents(f.task.business_task_id)).filter(event => event.envelope.event_type === "pc.operation.verified")).toHaveLength(0);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
}

describe("PC authorization MVP real PC services with synthetic Provider/Runtime Ports", () => {
  it("intersects project discovery with current PC policy before returning project names", async () => {
    const f = await fixture();
    const workbench = new RuntimeWorkbench({ identity: f.identity, projectDirectory: { provider_registration_id: "provider:eeclaw",
      listProjects: async () => [{ project_code: "MVP-A", project_name: "allowed" }, { project_code: "MVP-B", project_name: "not PC authorized" }] } } as never);
    expect(await workbench.projects(f.login.access_token)).toEqual([{ project_code: "MVP-A", project_name: "allowed" }]);
    expect(f.source).toHaveBeenCalledTimes(1);
    f.source.mockImplementation(async () => ({ decision: "DENY", reason_codes: [], evidence_refs: ["synthetic:C41:deny"],
      source: { decision_ref: "synthetic:C41:deny", observed_at: f.now().toISOString() } }));
    expect(await workbench.projects(f.login.access_token)).toEqual([]);
  });

  it("reauthorizes legal historical result reads and rejects another principal", async () => {
    const f = await fixture();
    await f.gateway.execute(f.envelope);
    const result = await f.server.inject({ url: `/v1/operations/${f.envelope.operation_id}`, headers: { authorization: `Bearer ${f.login.access_token}` } });
    expect(result.statusCode, result.body).toBe(200); expect(result.body).toContain("confidential");
    const other = await f.identity.signInExternal({ ...f.key, external_subject: "other" }, randomUUID(), f.login.expires_at);
    const denied = await f.server.inject({ url: `/v1/operations/${f.envelope.operation_id}`, headers: { authorization: `Bearer ${other.access_token}` } });
    expect(denied.statusCode).toBe(403); expect(denied.body).not.toContain("confidential");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it("executes a READ with C67/C68/C69/current Provider audit links and reauthorizes legal replay", async () => {
    const f = await fixture();
    expect(await f.gateway.execute(f.envelope)).toMatchObject({ status: "SUCCEEDED" });
    expect(await f.gateway.execute(f.envelope)).toMatchObject({ status: "SUCCEEDED" });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.source).toHaveBeenCalledTimes(6);
    expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe("SUCCEEDED");
    const audit = (await f.repository.listAudit(f.envelope.operation_id)).filter(row => row.authority_decision);
    expect(audit).toHaveLength(6);
    for (const row of audit) {
      expect(row.authority_decision).toMatchObject({ pc_session_id: f.login.session_assurance!.pc_session_id, pc_decision: "ALLOW", provider_decision: "ALLOW",
        provider_mapping_release_id: "mapping:ee-v1:mvp-1:page:functions", provider_decision_ref: "synthetic:C41:current", decision: "ALLOW", tool_call_id: f.envelope.operation_id });
      expect(row.authority_decision!.decision_digest).toBe(evidenceDigest(row.authority_decision!, "decision_digest"));
    }
    expect(new Set(audit.map(row => row.authority_decision!.decision_id)).size).toBe(6);
    expect((await f.projectionRepository.listTaskEvents(f.task.business_task_id)).filter(event => event.envelope.event_type === "pc.operation.verified")).toHaveLength(1);
  });

  it("keeps PC identity and personal decisions available with zero source calls during outage", async () => {
    const f = await fixture(); f.state.ready = false;
    const identity = await f.server.inject({ url: "/v1/identity/me", headers: { authorization: `Bearer ${f.login.access_token}` } });
    expect(identity.statusCode).toBe(200);
    const decision = await f.server.inject({ method: "POST", url: "/v1/authorization/decisions", headers: { authorization: `Bearer ${f.login.access_token}` },
      payload: { action: "conversation.run", resource_scope_refs: [`user:${f.principal.principal_id}`], tool_release_ids: [] } });
    expect(decision.statusCode, decision.body).toBe(200);
    expect(decision.json()).toMatchObject({ decision_mode: "PC_ONLY", decision: "ALLOW" });
    expect(f.source).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  });

  it("PC Deny wins over independently available source Allow before MCP execution", async () => {
    const f = await fixture();
    await f.identity.replaceAuthorizationGrants({ principal_id: f.principal.principal_id, expected_authorization_revision: 2,
      grants: [{ action: "page:functions", scope_type: "project", scope_id: "MVP-A", effect: "deny", evidence_ref: "pc:removed-action" }] });
    const login = await f.identity.signInExternal(f.key, randomUUID(), f.login.expires_at);
    const result = await f.server.inject({ method: "POST", url: "/v1/authorization/decisions", headers: { authorization: `Bearer ${login.access_token}` },
      payload: { action: "page:functions", resource_scope_refs: ["project:MVP-A"], tool_release_ids: [f.tool.tool_release_id] } });
    expect(result.statusCode).toBe(403); expect(result.json().decision).toMatchObject({ pc_decision: "DENY", decision: "DENY" });
    expect(f.source).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  });

  it("honors current source Deny and source unavailable without a cached Allow", async () => {
    const f = await fixture();
    f.source.mockResolvedValue({ decision: "DENY", reason_codes: ["source-revoked"], evidence_refs: ["synthetic:C41:deny"],
      source: { decision_ref: "synthetic:C41:deny", observed_at: f.now().toISOString() } });
    await expect(f.gateway.execute(f.envelope)).rejects.toMatchObject({ code: "PC_GATEWAY_AUTHORIZATION_DENIED" });
    expect(f.dispatch).not.toHaveBeenCalled();
    f.state.ready = false;
    await expect(f.gateway.execute(f.envelope)).rejects.toMatchObject({ code: "PC_GATEWAY_AUTHORIZATION_DENIED" });
    expect(f.source).toHaveBeenCalledTimes(1);
  });

  it("does not deliver persisted READ content after binding revocation", async () => {
    const f = await fixture(false);
    await f.gateway.execute(f.envelope);
    await f.gateway.revokeExternalAccount({ tenant_id: f.principal.tenant_id, principal_id: f.principal.principal_id,
      binding_id: f.binding.external_account_binding_id, expected_generation: 1 });
    const result = await f.server.inject({ method: "POST", url: "/v1/gateway/execute", headers: { authorization: `Bearer ${f.login.access_token}` }, payload: f.envelope });
    expect(result.statusCode).toBe(403); expect(result.body).not.toContain("confidential");
    expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe("VERIFYING");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it("denies the historical operation result GET after current binding revocation", async () => {
    const f = await fixture(false);
    await f.gateway.execute(f.envelope);
    await f.gateway.revokeExternalAccount({ tenant_id: f.principal.tenant_id, principal_id: f.principal.principal_id,
      binding_id: f.binding.external_account_binding_id, expected_generation: 1 });
    const result = await f.server.inject({ url: `/v1/operations/${f.envelope.operation_id}`, headers: { authorization: `Bearer ${f.login.access_token}` } });
    expect(result.statusCode).toBe(403); expect(result.body).not.toContain("confidential");
    expect((await f.events.getOperation(f.envelope.operation_id))?.state).toBe("VERIFYING");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it.each(["binding revoked", "credential rotated", "source Deny", "provider generation changed"])("holds a true in-flight success after %s", async change => {
    const f = await fixture();
    let started!: () => void, release!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const dispatch = f.dispatch.getMockImplementation()!;
    f.dispatch.mockImplementation(async () => { started(); await held; return dispatch(); });
    const result = f.gateway.execute(f.envelope);
    await startedPromise;
    if (change === "binding revoked") await f.gateway.revokeExternalAccount({ tenant_id: f.principal.tenant_id, principal_id: f.principal.principal_id,
      binding_id: f.binding.external_account_binding_id, expected_generation: 1 });
    if (change === "credential rotated") await f.gateway.rotateExternalAccount({ tenant_id: f.principal.tenant_id, principal_id: f.principal.principal_id,
      binding_id: f.binding.external_account_binding_id, expected_generation: 1, secret_ref: "synthetic:new-secret-ref" });
    if (change === "source Deny") f.source.mockResolvedValue({ decision: "DENY", reason_codes: [], evidence_refs: ["synthetic:C41:deny"],
      source: { decision_ref: "synthetic:C41:deny", observed_at: f.now().toISOString() } });
    if (change === "provider generation changed") { f.state.generation = "epoch.2"; f.state.connector = { ...f.connector, connector_id: "connector:next" }; }
    release(); await assertHeld(f, result);
  });

  it("a changed binding during live authorization overrides the returned Provider Allow", async () => {
    const f = await fixture();
    const response = f.source.getMockImplementation()!;
    f.source.mockImplementation(async () => {
      await f.gateway.revokeExternalAccount({ tenant_id: f.principal.tenant_id, principal_id: f.principal.principal_id,
        binding_id: f.binding.external_account_binding_id, expected_generation: 1 });
      return response();
    });
    await expect(f.gateway.execute(f.envelope)).rejects.toMatchObject({ code: "PC_GATEWAY_AUTHORIZATION_DENIED" });
    expect(f.dispatch).not.toHaveBeenCalled();
    const last = (await f.identity.recentAuthorityDecisions(f.login.access_token)).at(-1)!;
    expect(last).toMatchObject({ provider_decision: "ALLOW", decision: "DENY", reason_codes: ["current_binding_unavailable"] });
  });

  it("fails closed on an unknown Mapping after PC Allow without asking the source", async () => {
    const f = await fixture();
    const result = await f.server.inject({ method: "POST", url: "/v1/authorization/decisions", headers: { authorization: `Bearer ${f.login.access_token}` },
      payload: { action: "ee.unregistered", resource_scope_refs: ["project:MVP-A"], tool_release_ids: [] } });
    expect(result.statusCode).toBe(403);
    expect(result.json().decision).toMatchObject({ pc_decision: "ALLOW", decision_mode: "DENY_UNKNOWN", reason_codes: ["compatibility_mapping_unavailable"] });
    expect(result.json().error.code).toBe("PC_AUTHORITY_MAPPING_DENIED");
    expect(f.source).not.toHaveBeenCalled();
  });

  it("denies another project and ignores forged Session/Principal fields", async () => {
    const f = await fixture();
    const result = await f.server.inject({ method: "POST", url: "/v1/authorization/decisions", headers: { authorization: `Bearer ${f.login.access_token}` },
      payload: { action: "page:functions", resource_scope_refs: ["project:MVP-B"], tool_release_ids: [f.tool.tool_release_id], principal_id: "other", pc_session_id: "other" } });
    expect(result.statusCode).toBe(403); expect(result.json().decision.principal_id).toBe(f.principal.principal_id);
    expect(result.json().decision.pc_session_id).toBe(f.login.session_assurance!.pc_session_id);
    expect(f.source).not.toHaveBeenCalled();
  });

  it("cannot downgrade an actual external Tool to PC_ONLY by declaring PC authority", async () => {
    const f = await fixture();
    const result = await f.server.inject({ method: "POST", url: "/v1/authorization/decisions", headers: { authorization: `Bearer ${f.login.access_token}` },
      payload: { action: "tool.execute", resource_authority: "pc", resource_scope_refs: ["project:MVP-A"], tool_release_ids: [f.tool.tool_release_id] } });
    expect(result.statusCode).toBe(403); expect(result.json().decision).toMatchObject({ decision_mode: "DENY_UNKNOWN", decision: "DENY" });
    expect(f.source).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  });

  it("rejects signed Runtime execution after its PC login Session is revoked", async () => {
    const f = await fixture();
    await f.identity.signOut(f.login.access_token);
    await expect(f.gateway.execute(f.envelope)).rejects.toMatchObject({ code: "PC_SESSION_ASSURANCE_DENIED" });
    expect(f.source).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
  });
});
