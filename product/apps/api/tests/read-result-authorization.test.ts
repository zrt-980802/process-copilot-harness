import { afterEach, describe, expect, it, vi } from "vitest";
import { readOperationFixture } from "./support/read-operation-fixture.js";
import { buildApiServer } from "../src/server.js";
import { GatewayProviderError } from "@pc/gateway";

afterEach(() => vi.restoreAllMocks());
type Fixture = Awaited<ReturnType<typeof readOperationFixture>>;

async function account(f: Fixture) {
  return (await f.repository.findExternalAccountBinding(f.principal.tenant_id, f.connector.connector_id, f.principal.principal_id))!;
}

async function revoke(f: Fixture) {
  const binding = await account(f);
  await f.gateway.revokeExternalAccount({ tenant_id: f.principal.tenant_id, principal_id: f.principal.principal_id,
    binding_id: binding.external_account_binding_id, expected_generation: binding.credential_generation });
}

async function assertDenied(f: Fixture, pending: Promise<unknown>, reason?: string) {
  const outcome = await pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  const external = await f.repository.getOperation(f.input.operation_id);
  const business = await f.events.getOperation(f.input.operation_id);
  const verified = (await f.projectionRepository.listTaskEvents(f.task.business_task_id))
    .filter(record => record.envelope.event_type === "pc.operation.verified");
  const observed = { c22: external?.result?.status, c24: external?.outcome_state, c28: business?.state,
    dispatches: f.dispatch.mock.calls.length, verified_events: verified.length };
  expect(outcome.error, JSON.stringify(observed)).toMatchObject({ code: "PC_GATEWAY_RESULT_DELIVERY_DENIED" });
  if (reason) expect(outcome.error).toMatchObject({ details: { reason_codes: [reason] } });
  expect(outcome.value).toBeUndefined();
  expect(JSON.stringify(outcome.error)).not.toContain("Synthetic port response");
  expect(external).toMatchObject({ dispatch_state: "COMPLETED", outcome_state: "KNOWN_SUCCESS",
    result: { status: "SUCCEEDED", outcome_state: "KNOWN_SUCCESS" } });
  expect(business?.state).toBe("VERIFYING");
  expect(verified).toHaveLength(0);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  const audit = (await f.repository.listAudit(f.input.operation_id)).filter(entry => entry.event_type === "RESULT_DELIVERY_DENIED");
  expect(audit.length).toBeGreaterThan(0);
  expect(audit.at(-1)).toMatchObject({ outcome: "DENY", evidence_refs: [] });
  expect(JSON.stringify(audit)).not.toContain("Synthetic port response");
}

describe("RCI-03 current authorization before READ verification and delivery", () => {
  it("denies idempotent delivery after persisted success and binding revocation", async () => {
    const f = await readOperationFixture(false);
    await f.gateway.execute(f.envelope);
    f.publisher.verifyReadOperation = async input => { await f.verifier.verify(input); };
    await revoke(f);
    await assertDenied(f, f.gateway.execute(f.envelope), "result_binding_unavailable");
  });

  it("denies an old credential generation after rotation before replay", async () => {
    const f = await readOperationFixture(false);
    await f.gateway.execute(f.envelope);
    f.publisher.verifyReadOperation = async input => { await f.verifier.verify(input); };
    const binding = await account(f);
    await f.gateway.rotateExternalAccount({ tenant_id: f.principal.tenant_id, principal_id: f.principal.principal_id,
      binding_id: binding.external_account_binding_id, expected_generation: binding.credential_generation, secret_ref: "synthetic-ref:rotated" });
    await assertDenied(f, f.gateway.execute(f.envelope), "result_credential_generation_stale");
  });

  it("denies the beginOperation race result if binding is revoked during that lookup", async () => {
    const f = await readOperationFixture(false);
    await f.gateway.execute(f.envelope);
    f.publisher.verifyReadOperation = async input => { await f.verifier.verify(input); };
    vi.spyOn(f.repository, "findOperationByIdempotency").mockResolvedValue(undefined);
    const begin = f.repository.beginOperation.bind(f.repository);
    vi.spyOn(f.repository, "beginOperation").mockImplementation(async input => {
      const result = await begin(input);
      await revoke(f);
      return result;
    });
    await assertDenied(f, f.gateway.execute(f.envelope), "result_binding_unavailable");
  });

  it("preserves in-flight Provider success but denies delivery after binding revocation", async () => {
    const f = await readOperationFixture();
    let started!: () => void;
    let release!: () => void;
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    const resumed = new Promise<void>(resolve => { release = resolve; });
    const response = f.dispatch.getMockImplementation()!;
    f.dispatch.mockImplementation(async input => { started(); await resumed; return response(input); });
    const pending = f.gateway.execute(f.envelope);
    await dispatched;
    await revoke(f);
    release();
    await assertDenied(f, pending, "result_binding_unavailable");
  });

  it("preserves in-flight success after credential rotation and recovers with a fresh generation without dispatch", async () => {
    const f = await readOperationFixture();
    let started!: () => void;
    let release!: () => void;
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    const resumed = new Promise<void>(resolve => { release = resolve; });
    const response = f.dispatch.getMockImplementation()!;
    f.dispatch.mockImplementation(async input => { started(); await resumed; return response(input); });
    const pending = f.gateway.execute(f.envelope);
    await dispatched;
    const binding = await account(f);
    const rotated = await f.gateway.rotateExternalAccount({ tenant_id: f.principal.tenant_id, principal_id: f.principal.principal_id,
      binding_id: binding.external_account_binding_id, expected_generation: binding.credential_generation, secret_ref: "synthetic-ref:rotated" });
    release();
    await assertDenied(f, pending, "result_credential_generation_stale");
    const fresh = structuredClone(f.envelope);
    fresh.principal_envelope.credential_generation = rotated.credential_generation;
    expect(await f.gateway.execute(fresh)).toMatchObject({ status: "SUCCEEDED" });
    expect((await f.events.getOperation(f.input.operation_id))?.state).toBe("SUCCEEDED");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect((await f.projectionRepository.listTaskEvents(f.task.business_task_id))
      .filter(entry => entry.envelope.event_type === "pc.operation.verified")).toHaveLength(1);
  });

  it.each(["PC/source Deny", "authorization revision", "authorization expiry", "authorization scope", "Tool permission",
    "external subject", "missing identity", "Connector inactive", "Connector membership", "Connector scope", "Tool unpublished",
    "binding tenant", "binding principal", "binding connector", "binding generation", "rebound identity", "missing binding", "missing envelope generation"])(
    "fails closed on current %s after the admission decision", async variant => {
    const f = await readOperationFixture(false);
    await f.gateway.execute(f.envelope);
    f.publisher.verifyReadOperation = async input => { await f.verifier.verify(input); };
    const lookup = f.repository.findOperationByIdempotency.bind(f.repository);
    vi.spyOn(f.repository, "findOperationByIdempotency").mockImplementation(async (...args) => {
      const result = await lookup(...args);
      const authorization = vi.mocked(f.gatewayIdentity.evaluatePrincipalAuthorization).getMockImplementation()!;
      if (["PC/source Deny", "authorization revision", "authorization expiry", "authorization scope", "Tool permission"].includes(variant)) {
        vi.spyOn(f.gatewayIdentity, "evaluatePrincipalAuthorization").mockImplementation(async input => ({ ...await authorization(input),
          ...(variant === "PC/source Deny" ? { decision: "DENY" as const } : {}),
          ...(variant === "authorization revision" ? { authorization_revision: 2 } : {}),
          ...(variant === "authorization expiry" ? { expires_at: f.envelope.principal_envelope.issued_at } : {}),
          ...(variant === "authorization scope" ? { resource_scope_digest: "sha256:other" } : {}),
          ...(variant === "Tool permission" ? { allowed_actions: [] } : {}) }));
      } else if (["external subject", "missing identity"].includes(variant)) {
        vi.spyOn(f.repository, "getConnector").mockResolvedValue({ ...f.connector, provider_key: "ee_mcp" });
        vi.spyOn(f.gatewayIdentity, "resolveExternalSubject").mockResolvedValue(variant === "external subject" ? "other" : undefined);
      } else if (variant.startsWith("Connector")) {
        vi.spyOn(f.repository, "getConnector").mockResolvedValue({ ...f.connector,
          ...(variant === "Connector inactive" ? { state: "DISABLED" as const } : {}),
          ...(variant === "Connector membership" ? { tool_release_ids: [] } : {}),
          ...(variant === "Connector scope" ? { allowed_scopes: [] } : {}) });
      } else if (variant === "Tool unpublished") {
        f.tool.status = "RETIRED";
      } else if (variant === "missing binding") {
        vi.spyOn(f.repository, "findExternalAccountBinding").mockResolvedValue(undefined);
      } else if (variant === "missing envelope generation") {
        delete f.envelope.principal_envelope.credential_generation;
      } else {
        const current = await account(f);
        vi.spyOn(f.repository, "findExternalAccountBinding").mockResolvedValue({ ...current,
          ...(variant === "binding tenant" ? { tenant_id: "other" } : {}),
          ...(variant === "binding principal" ? { principal_id: "other" } : {}),
          ...(variant === "binding connector" ? { connector_id: "other" } : {}),
          ...(variant === "binding generation" ? { credential_generation: 0 } : {}),
          ...(variant === "rebound identity" ? { external_account_id: "other" } : {}) });
      }
      return result;
    });
    const reason = ["PC/source Deny", "authorization revision", "authorization expiry", "authorization scope", "Tool permission"].includes(variant)
      ? "result_current_authorization_denied" : ["external subject", "missing identity"].includes(variant)
        ? "result_external_identity_mismatch" : variant.startsWith("Connector") ? "result_connector_or_tool_denied"
          : variant === "Tool unpublished" ? "result_current_authority_unavailable" : variant === "rebound identity"
            ? "result_original_subject_mismatch" : variant === "missing envelope generation" ? "result_credential_generation_stale"
              : "result_binding_unavailable";
    await assertDenied(f, f.gateway.execute(f.envelope), reason);
  });

  it("does not overwrite persisted Provider success if the current source authority throws a Provider error", async () => {
    const f = await readOperationFixture();
    const response = f.dispatch.getMockImplementation()!;
    f.dispatch.mockImplementation(async input => {
      const result = await response(input);
      vi.spyOn(f.gatewayIdentity, "evaluatePrincipalAuthorization").mockRejectedValue(new GatewayProviderError(
        "PC_PROVIDER_AUTHORIZATION_UNAVAILABLE", "Synthetic sensitive Provider response", false, true));
      return result;
    });
    await assertDenied(f, f.gateway.execute(f.envelope), "result_current_authority_unavailable");
  });

  it("returns a safe HTTP 403 with no stored body on revoked replay", async () => {
    const f = await readOperationFixture(false);
    await f.gateway.execute(f.envelope);
    f.publisher.verifyReadOperation = async input => { await f.verifier.verify(input); };
    await revoke(f);
    const server = buildApiServer({ identityAuthorization: f.identity, controlledGateway: f.gateway, eventProjection: f.events });
    try {
      const response = await server.inject({ method: "POST", url: "/v1/gateway/execute",
        headers: { authorization: `Bearer ${f.login.access_token}` }, payload: f.envelope });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "PC_GATEWAY_RESULT_DELIVERY_DENIED" } });
      expect(response.body).not.toContain("Synthetic port response");
      expect((await f.events.getOperation(f.input.operation_id))?.state).toBe("VERIFYING");
      expect(f.dispatch).toHaveBeenCalledTimes(1);
    } finally { await server.close(); }
  });
});
