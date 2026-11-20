import { describe, expect, it, vi } from "vitest";
import { EeProviderBundle, configurationDigest, type EeBundleCandidate } from "../src/ee-provider-bundle.js";
import { IdentityAuthorizationService } from "@pc/application";
import { MemoryIdentityAuthorizationRepository } from "@pc/persistence";
import { bundleWorkbench } from "../src/ee-provider-bundle.js";
import { RuntimeWorkbench, type WorkbenchOptions } from "../src/workbench.js";
import { buildApiServer } from "../src/server.js";

const environment = {
  PC_LOGIN_MODE: "ee", PC_GATEWAY_STORE: "memory", PC_PILOT_TENANT_ID: "test-bundle",
  EECLAW_ADAPTER_URL: "http://127.0.0.1:1", EECLAW_ADAPTER_SECRET: "unit-authorization",
  EE_MCP_ADAPTER_URL: "http://127.0.0.1:2/mcp", EE_MCP_ADAPTER_SECRET: "unit-mcp"
};

function candidate(generation: string): EeBundleCandidate {
  const metadata = { provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw" };
  return {
    identity: { ...metadata, identity_provider_ref: "eeclaw", authenticate: vi.fn(), validate: vi.fn(), bindings: vi.fn() },
    authorization: { ...metadata, evaluate: vi.fn(async () => ({ decision: "DENY" as const, reason_codes: ["business_deny"], evidence_refs: [] })) },
    directory: { ...metadata, listProjects: vi.fn(async () => []) },
    capability: { ...metadata, provider_key: "ee_mcp", discover: vi.fn(), dispatch: vi.fn(), reconcile: vi.fn() },
    projection: { ...metadata, project: vi.fn() },
    credentialIssuer: { issue: vi.fn() },
    catalog: { connector: { connector_id: generation, capability_digest: generation, tool_release_ids: ["tool1"] }, tools: [{ tool_release_id: "tool1" }] },
    profileReleaseId: generation + ":read", reviewProfileReleaseId: generation + ":review"
  } as unknown as EeBundleCandidate;
}

describe("D4A aggregate EE bundle contract", () => {
  it("keeps unconfigured and partial configuration nonexecutable without building ports", async () => {
    const build = vi.fn();
    for (const [env, state] of [[{}, "UNCONFIGURED"], [{ EECLAW_ADAPTER_URL: environment.EECLAW_ADAPTER_URL }, "UNAVAILABLE"]] as const) {
      const bundle = new EeProviderBundle({ environment: () => env, build });
      if (state === "UNAVAILABLE") {
        await expect(bundle.reload({ manual: true })).rejects.toMatchObject({ code: "PC_PROVIDER_BUNDLE_CONFIGURATION", retryable: false });
      } else await bundle.reload({ manual: true });
      expect(bundle.descriptor().bundle_state).toBe(state);
      expect(bundle.active()).toBeUndefined();
    }
    expect(build).not.toHaveBeenCalled();
  });

  it("publishes all five ports and catalog/profiles in one complete generation", async () => {
    const bundle = new EeProviderBundle({ environment: () => environment, build: async (_, generation) => candidate(generation) });
    await bundle.reload();
    const active = bundle.requireActive();
    expect(bundle.descriptor().bundle_state).toBe("READY");
    expect(active.catalog.connector.connector_id).toBe(active.generation);
    expect(active.profileReleaseId).toBe(active.generation + ":read");
    for (const port of [active.identity, active.authorization, active.directory, active.capability, active.projection]) {
      expect(port.provider_registration_id).toBe("provider:eeclaw");
    }
    const deny = await bundle.authorization.evaluate({ principal: {} as never, action: "draft.read", resource_scope_refs: ["project:P"], observed_at: new Date().toISOString() });
    expect(deny.decision).toBe("DENY");
    expect(bundle.descriptor().bundle_state).toBe("READY");
  });

  it.each([
    ["PC_PROVIDER_UNAVAILABLE", "TRANSPORT", true], ["PC_MCP_TIMEOUT", "TIMEOUT", true],
    ["PC_PROVIDER_AUTHENTICATION_FAILED", "AUTHENTICATION", false],
    ["PC_PROVIDER_INCOMPATIBLE", "COMPATIBILITY", false], ["PC_MCP_INVALID_RESPONSE", "PROTOCOL", false],
    ["PC_PROVIDER_AUTHORITY_CHANGED", "AUTHORITY_CHANGED", false]
  ])("classifies %s and never publishes a failed candidate", async (code, category, automatic) => {
    const build = vi.fn(async () => { throw Object.assign(new Error("sensitive diagnostic never exported"), { code }); });
    const bundle = new EeProviderBundle({ environment: () => environment, build });
    await expect(bundle.reload()).rejects.toMatchObject({ code: expect.stringContaining("PC_PROVIDER_") });
    expect(bundle.active()).toBeUndefined();
    expect(bundle.descriptor().reason_codes).toContain(`bundle_failure:${String(category).toLowerCase()}`);
    expect(bundle.automaticRecoveryAllowed()).toBe(automatic);
    expect(JSON.stringify(bundle.descriptor())).not.toContain("sensitive");
    expect(JSON.stringify(bundle.descriptor())).not.toContain("unit-mcp");
  });

  it("single-flights concurrent reload and fences retained generation references and late results", async () => {
    let finish: ((value: EeBundleCandidate) => void) | undefined;
    let pendingGeneration = "";
    const build = vi.fn(async (_config, generation: string) => candidate(generation));
    const bundle = new EeProviderBundle({ environment: () => environment, build });
    await bundle.reload();
    const old = bundle.requireActive();
    let completeRead: ((value: string) => void) | undefined;
    const oldRead = bundle.invoke(old.generation, () => new Promise<string>((resolve) => { completeRead = resolve; }));
    const stale = expect(oldRead).rejects.toMatchObject({ code: "PC_PROVIDER_GENERATION_STALE" });
    build.mockImplementationOnce(async (_, generation) => { pendingGeneration = generation; return new Promise(resolve => { finish = resolve; }); });
    const first = bundle.reload({ manual: true });
    const second = bundle.reload({ manual: true });
    expect(first).toBe(second);
    expect(bundle.descriptor().bundle_state).toBe("STARTING");
    expect(bundle.active()).toBeUndefined();
    expect(() => bundle.assertGeneration(old.generation)).toThrow();
    completeRead!("old-authorized-data");
    await stale;
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish!(candidate(pendingGeneration));
    await first;
    expect(bundle.requireActive().generation).toBe(pendingGeneration);
    expect(bundle.requireActive().generation).not.toBe(old.generation);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("keeps only diagnostic metadata after mid-reload failure and uses a new epoch on restart", async () => {
    const build = vi.fn(async (_, generation: string) => candidate(generation));
    const bundle = new EeProviderBundle({ environment: () => environment, build });
    await bundle.reload();
    const old = bundle.requireActive();
    build.mockRejectedValueOnce(Object.assign(new Error("bad contract"), { code: "PC_MCP_INVALID_RESPONSE" }));
    await expect(bundle.reload({ manual: true })).rejects.toThrow();
    expect(bundle.active()).toBeUndefined();
    expect(bundle.metadata()?.catalog_revision).toBe(old.catalog.connector.capability_digest);
    expect(bundle.metadata()).not.toHaveProperty("authorization");
    expect(() => bundle.assertGeneration(old.generation)).toThrow();
    const restarted = new EeProviderBundle({ environment: () => environment, build });
    await restarted.reload();
    expect(restarted.requireActive().generation).not.toBe(old.generation);
    expect(() => restarted.assertGeneration(old.generation)).toThrow();
  });

  it("excludes secrets and URL credentials/query from the configuration digest", () => {
    const unsafe = { ...environment, EECLAW_ADAPTER_URL: "http://username:password@127.0.0.1:1?token=private", EE_MCP_ADAPTER_SECRET: "different" };
    expect(configurationDigest(unsafe)).toBe(configurationDigest(environment));
  });

  it("atomically switches catalog/profile/Workbench and fences all retained ports", async () => {
    let source: EeBundleCandidate;
    const core = new RuntimeWorkbench({ tools: [] } as unknown as WorkbenchOptions);
    const bundle = new EeProviderBundle({ environment: () => environment, build: async (_, generation) => {
      source = candidate(generation);
      source.workbench = new RuntimeWorkbench({ tools: source.catalog.tools } as unknown as WorkbenchOptions);
      return source;
    } });
    const view = bundleWorkbench(bundle, core);
    await bundle.reload();
    const old = bundle.requireActive();
    expect(view.options.connector?.connector_id).toBe(old.catalog.connector.connector_id);
    expect(Object.isFrozen(view.options)).toBe(true);
    expect(Object.isFrozen(old.catalog.tools)).toBe(true);
    source!.catalog.connector.capability_digest = "mutation-outside-bundle";
    expect(old.catalog.connector.capability_digest).not.toBe("mutation-outside-bundle");
    const attempt = bundle.health.beginAttempt("provider:eeclaw", "enterprise_authorization");
    await bundle.reload({ manual: true });
    attempt.failure("INCOMPATIBLE", "late-old-attempt");
    const next = bundle.requireActive();
    expect(view.options.connector?.connector_id).toBe(next.catalog.connector.connector_id);
    expect(view.options.profileReleaseId).toBe(next.profileReleaseId);
    expect(next.generation).not.toBe(old.generation);
    await expect(old.identity.bindings()).rejects.toMatchObject({ code: "PC_PROVIDER_GENERATION_STALE" });
    await expect(old.authorization.evaluate({} as never)).rejects.toMatchObject({ code: "PC_PROVIDER_GENERATION_STALE" });
    await expect(old.directory.listProjects({} as never)).rejects.toMatchObject({ code: "PC_PROVIDER_GENERATION_STALE" });
    await expect(old.capability.discover("token")).rejects.toMatchObject({ code: "PC_PROVIDER_GENERATION_STALE" });
    expect(() => old.projection.project({} as never)).toThrow();
    expect(() => bundle.credentialIssuer.issue({ connector: old.catalog.connector } as never)).toThrow();
    await expect(bundle.capability.dispatch({ connector: old.catalog.connector } as never)).rejects.toMatchObject({ code: "PC_PROVIDER_GENERATION_STALE" });
    expect(() => bundle.capability.reconcile({ connector: old.catalog.connector } as never)).toThrow();
  });

  it("bounds transport retries and requires explicit recovery for auth/protocol failures", async () => {
    let now = 1_000_000;
    const build = vi.fn(async (_, generation: string) => candidate(generation));
    const bundle = new EeProviderBundle({ environment: () => environment, build, now: () => now });
    build.mockRejectedValueOnce(new TypeError("transport"));
    await expect(bundle.reload()).rejects.toThrow();
    await expect(bundle.reload({ manual: true })).rejects.toMatchObject({ code: "PC_PROVIDER_RETRY_BLOCKED" });
    expect(build).toHaveBeenCalledTimes(1);
    now += 1000;
    await bundle.reload();
    build.mockRejectedValueOnce(Object.assign(new Error("authentication"), { code: "PC_PROVIDER_AUTHENTICATION_FAILED" }));
    await expect(bundle.reload({ manual: true })).rejects.toThrow();
    await expect(bundle.reload()).rejects.toMatchObject({ code: "PC_PROVIDER_RETRY_BLOCKED" });
    expect(() => bundle.directory.listProjects({} as never)).toThrow();
    expect(build).toHaveBeenCalledTimes(3);
    await bundle.reload({ manual: true });
    expect(bundle.descriptor().bundle_state).toBe("READY");
    now += 30_000;
    expect(bundle.active()).toBeUndefined();
    await expect(bundle.invoke(bundle.descriptor().bundle_generation, async () => "expired")).rejects.toThrow();
  });

  it("does not replay a dispatch whose result crosses a generation change", async () => {
    let finish: (() => void) | undefined;
    const raw = candidate("raw");
    const dispatch = vi.fn(() => new Promise<never>(resolve => { finish = () => resolve({} as never); }));
    raw.capability.dispatch = dispatch;
    const bundle = new EeProviderBundle({ environment: () => environment, build: async (_, generation) => ({ ...raw, catalog: candidate(generation).catalog }) });
    await bundle.reload();
    const call = bundle.capability.dispatch({ connector: bundle.requireActive().catalog.connector } as never);
    const unknown = expect(call).rejects.toMatchObject({ code: "PC_PROVIDER_GENERATION_STALE", outcome_unknown: true });
    await bundle.reload({ manual: true });
    finish!();
    await unknown;
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(bundle.descriptor().bundle_state).toBe("READY");
  });

  it("preserves PC-only zero calls and request-time PC/EE intersection across reload", async () => {
    const identity = new IdentityAuthorizationService(new MemoryIdentityAuthorizationRepository(), "d4a-unit-signing-key-0000000000000000");
    await identity.initialize();
    try {
      const { principal } = await identity.provisionPilotAccount({ tenant_id: "tenant", account_key: "engineer", secret: "UnitOnlySecret123" });
      const evaluate = vi.fn(async () => ({ decision: "ALLOW" as "ALLOW" | "DENY", reason_codes: ["ee-decision"], evidence_refs: ["ee:decision"] }));
      const build = vi.fn(async (_, generation: string) => {
        const value = candidate(generation); value.authorization.evaluate = evaluate; return value;
      });
      const bundle = new EeProviderBundle({ environment: () => environment, build, health: identity.providerHealthRegistry });
      identity.registerExternalAuthorizationPort(bundle.authorization);
      const request = (action: string, scope: string) => identity.evaluatePrincipalAuthorization({ principal_id: principal.principal_id,
        actions: [action], resource_scope_refs: [scope], tool_release_ids: [], policy_model_revision: 1 });
      for (let index = 0; index < 2; index++) {
        await bundle.reload({ manual: true });
        const calls = evaluate.mock.calls.length;
        expect((await request("conversation.run", `user:${principal.principal_id}`)).decision).toBe("ALLOW");
        expect((await request("draft.read", "project:TEST")).decision).toBe("DENY");
        expect(evaluate).toHaveBeenCalledTimes(calls);
      }
      await identity.replaceAuthorizationGrants({ principal_id: principal.principal_id, expected_authorization_revision: principal.authorization_revision,
        grants: [{ effect: "allow", action: "draft.read", scope_type: "project", scope_id: "TEST", evidence_ref: "unit:pc-allow" }] });
      expect((await request("draft.read", "project:TEST")).decision).toBe("ALLOW");
      evaluate.mockResolvedValueOnce({ decision: "DENY", reason_codes: ["business-deny"], evidence_refs: [] });
      expect((await request("draft.read", "project:TEST")).decision).toBe("DENY");
      expect(bundle.descriptor().bundle_state).toBe("READY");
      expect((await request("approval.decide", "project:TEST")).decision).toBe("DENY");
      build.mockRejectedValueOnce(Object.assign(new Error("bad contract"), { code: "PC_PROVIDER_INCOMPATIBLE" }));
      await expect(bundle.reload({ manual: true })).rejects.toThrow();
      const calls = evaluate.mock.calls.length;
      expect((await request("conversation.run", `user:${principal.principal_id}`)).decision).toBe("ALLOW");
      expect((await request("draft.read", "project:TEST")).decision).toBe("DENY");
      expect(evaluate).toHaveBeenCalledTimes(calls);
    } finally { await identity.close(); }
  });

  it("reports C66 and C65 diagnostic generations without presenting failure as empty projects", async () => {
    const build = vi.fn(async (_, generation: string) => candidate(generation));
    const bundle = new EeProviderBundle({ environment: () => environment, build });
    await bundle.reload();
    build.mockRejectedValueOnce(Object.assign(new Error("bad contract"), { code: "PC_PROVIDER_INCOMPATIBLE" }));
    await expect(bundle.reload({ manual: true })).rejects.toThrow();
    const core = new RuntimeWorkbench({ tools: [], identity: { authenticate: async () => ({ principal: { principal_id: "owner", tenant_id: "tenant" } }) },
      projectDirectory: bundle.directory, providerAvailability: { isUsable: () => !!bundle.active(), observation: () => bundle.observation() },
      providerCatalogRevision: () => bundle.descriptor().catalog_revision } as unknown as WorkbenchOptions);
    const server = buildApiServer({ providerMode: "ee-connected", eeBundle: bundle, workbench: bundleWorkbench(bundle, core) });
    try {
      const health = (await server.inject("/health")).json();
      expect(health.provider_bundle).toMatchObject({ bundle_state: "UNAVAILABLE", bundle_generation: bundle.descriptor().bundle_generation });
      expect(health.capabilities).toMatchObject({ personal_workbench: "available", project_workbench: "unavailable" });
      const projects = await server.inject({ url: "/v1/workbench/projects", headers: { authorization: "Bearer token" } });
      expect(projects.statusCode).toBe(503);
      const availability = (await server.inject({ url: "/v1/workbench/capability-availability", headers: { authorization: "Bearer token" } })).json();
      expect(availability.catalog_revision).toBe(bundle.metadata()?.catalog_revision);
      expect(availability.capabilities[0].availability_state).toBe("UNAVAILABLE");
      expect(availability.evidence_refs).toContain(`provider-bundle:${bundle.descriptor().bundle_generation}`);
    } finally { await server.close(); }
  });

  it("fences a whole old Workbench result while retaining the same personal Workbench", async () => {
    let complete: (() => void) | undefined;
    const core = new RuntimeWorkbench({} as WorkbenchOptions);
    const personal = vi.spyOn(core, "run").mockResolvedValue({ content: "personal", turn_id: "turn" });
    const bundle = new EeProviderBundle({ environment: () => environment, build: async (_, generation) => {
      const value = candidate(generation);
      value.workbench = new RuntimeWorkbench({ gateway: {}, gatewayRepository: {}, identity: {
        authenticate: async () => ({ principal: { principal_id: "owner" } }),
        evaluatePrincipalAuthorization: () => new Promise(resolve => { complete = () => resolve({ decision: "ALLOW" }); })
      }, tools: value.catalog.tools } as unknown as WorkbenchOptions);
      return value;
    } });
    const view = bundleWorkbench(bundle, core);
    await bundle.reload();
    const pending = view.catalog("token", "TEST");
    const rejected = expect(pending).rejects.toMatchObject({ code: "PC_PROVIDER_GENERATION_STALE" });
    await vi.waitFor(() => expect(complete).toBeDefined());
    await bundle.reload({ manual: true });
    complete!();
    await rejected;
    await expect(view.run({ workspace_id: "personal" } as never, "token", "hello", [])).resolves.toMatchObject({ content: "personal" });
    await bundle.reload({ manual: true });
    await view.run({ workspace_id: "personal" } as never, "token", "hello", []);
    expect(personal).toHaveBeenCalledTimes(2);
  });

  it("normalizes malformed runtime port results into provider errors rather than HTTP500", async () => {
    const bundle = new EeProviderBundle({ environment: () => environment, build: async (_, generation) => {
      const value = candidate(generation);
      value.directory.listProjects = vi.fn(async () => { throw new SyntaxError("raw-secret-diagnostic"); });
      return value;
    } });
    await bundle.reload();
    await expect(bundle.directory.listProjects({} as never)).rejects.toMatchObject({ code: "PC_PROVIDER_BUNDLE_PROTOCOL", retryable: true });
    expect(bundle.descriptor().reason_codes).toEqual(["bundle_failure:protocol"]);
    expect(JSON.stringify(bundle.descriptor())).not.toContain("raw-secret");
  });

  it("closes every EE port if the shared aggregate health is DEGRADED", async () => {
    const raw = candidate("raw");
    const bundle = new EeProviderBundle({ environment: () => environment, build: async () => raw });
    await bundle.reload();
    bundle.health.markFailure("provider:eeclaw", "UNAVAILABLE", "fault");
    bundle.health.markCompatible("provider:eeclaw", "first-recovery-observation");
    expect(bundle.descriptor().bundle_state).toBe("DEGRADED");
    expect(bundle.observation().provider_state).toBe("DEGRADED");
    expect(bundle.active()).toBeUndefined();
    expect(() => bundle.directory.listProjects({} as never)).toThrow();
    expect(() => bundle.identity.bindings()).toThrow();
    expect(raw.directory.listProjects).not.toHaveBeenCalled();
    expect(raw.identity.bindings).not.toHaveBeenCalled();
  });
});

describe("D4A acceptance remediation contracts", () => {
  function expectRevision(bundle: EeProviderBundle, expected: number) {
    expect(bundle.descriptor().registration_revision).toBe(expected);
    expect(bundle.observation().configuration_revision).toBe(expected);
    expect(bundle.health.observation("provider:eeclaw").configuration_revision).toBe(expected);
  }

  it("keeps first and consecutive reload revisions identical and detaches bootstrap health results", async () => {
    const bundle = new EeProviderBundle({ environment: () => environment, build: async (_, generation) => candidate(generation) });
    expectRevision(bundle, 1);
    const bootstrap = bundle.health.beginAttempt("provider:eeclaw", "enterprise_authorization");
    await bundle.reload();
    expectRevision(bundle, 2);
    bootstrap.failure("INCOMPATIBLE", "late-bootstrap-result");
    expect(bundle.descriptor().bundle_state).toBe("READY");
    const oldFailure = bundle.health.beginAttempt("provider:eeclaw", "enterprise_authorization");
    const oldSuccess = bundle.health.beginAttempt("provider:eeclaw", "project_directory");
    await bundle.reload({ manual: true });
    expectRevision(bundle, 3);
    oldFailure.failure("INCOMPATIBLE", "late-old-failure");
    oldSuccess.success("late-old-success");
    expect(bundle.health.observation("provider:eeclaw").reason_codes).not.toContain("late-old-success");
    expect(bundle.descriptor().bundle_state).toBe("READY");
    await bundle.reload({ manual: true });
    expectRevision(bundle, 4);
  });

  it("preserves revision consistency through failure and a single-flight recovery", async () => {
    const build = vi.fn(async (_, generation: string) => candidate(generation));
    const bundle = new EeProviderBundle({ environment: () => environment, build });
    await bundle.reload();
    const old = bundle.health.beginAttempt("provider:eeclaw", "enterprise_authorization");
    build.mockRejectedValueOnce(Object.assign(new Error("contract"), { code: "PC_MCP_INVALID_RESPONSE" }));
    await expect(bundle.reload({ manual: true })).rejects.toThrow();
    expectRevision(bundle, 3);
    old.success("stale-success-after-failure");
    expect(bundle.active()).toBeUndefined();
    let complete: ((value: EeBundleCandidate) => void) | undefined;
    let nextGeneration = "";
    build.mockImplementationOnce(async (_, generation) => {
      nextGeneration = generation;
      return new Promise(resolve => { complete = resolve; });
    });
    const first = bundle.reload({ manual: true });
    const second = bundle.reload({ manual: true });
    expect(first).toBe(second);
    expectRevision(bundle, 4);
    expect(bundle.descriptor().bundle_state).toBe("STARTING");
    complete!(candidate(nextGeneration));
    await Promise.all([first, second]);
    expectRevision(bundle, 4);
    expect(build).toHaveBeenCalledTimes(3);
    expect(bundle.descriptor().bundle_state).toBe("READY");
  });

  it.each([
    ["partial", { EECLAW_ADAPTER_URL: environment.EECLAW_ADAPTER_URL }],
    ["invalid authorization URL", { ...environment, EECLAW_ADAPTER_URL: "invalid" }],
    ["invalid MCP URL", { ...environment, EE_MCP_ADAPTER_URL: "file:///invalid" }],
    ["URL credentials", { ...environment, EE_MCP_ADAPTER_URL: "https://user:synthetic@invalid.test/mcp" }],
    ["missing tenant", { ...environment, PC_PILOT_TENANT_ID: undefined }],
    ["blank tenant", { ...environment, PC_PILOT_TENANT_ID: " " }]
  ])("returns a stable nonretryable HTTP400 for %s configuration", async (_label, config) => {
    const build = vi.fn();
    const bundle = new EeProviderBundle({ environment: () => config, build });
    const server = buildApiServer({ eeBundle: bundle, retryEeProvider: () => bundle.reload({ manual: true }) });
    try {
      const response = await server.inject({ method: "POST", url: "/v1/providers/eeclaw/retry" });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "PC_PROVIDER_BUNDLE_CONFIGURATION", retryable: false } });
      expect(bundle.descriptor()).toMatchObject({ bundle_state: "UNAVAILABLE", reason_codes: ["bundle_failure:configuration"] });
      expectRevision(bundle, 2);
      expect(bundle.active()).toBeUndefined();
      expect(bundle.automaticRecoveryAllowed()).toBe(false);
      await expect(bundle.reload()).rejects.toMatchObject({ code: "PC_PROVIDER_RETRY_BLOCKED", retryable: false });
      expectRevision(bundle, 2);
      expect(() => bundle.directory.listProjects({} as never)).toThrow();
      expect(build).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it("keeps all revisions consistent after configuration correction and explicit reload", async () => {
    let config: Record<string, string | undefined> = { ...environment, PC_PILOT_TENANT_ID: undefined };
    const bundle = new EeProviderBundle({ environment: () => config, build: async (_, generation) => candidate(generation) });
    await expect(bundle.reload()).rejects.toMatchObject({ code: "PC_PROVIDER_BUNDLE_CONFIGURATION", retryable: false });
    expectRevision(bundle, 2);
    const stale = bundle.health.beginAttempt("provider:eeclaw", "enterprise_authorization");
    config = environment;
    await bundle.reload({ manual: true });
    expectRevision(bundle, 3);
    stale.failure("INCOMPATIBLE", "old-config-failure");
    expect(bundle.descriptor().bundle_state).toBe("READY");
  });

  it.each([
    ["UNCONFIGURED", {}, "PC_PROVIDER_BUNDLE_UNCONFIGURED"],
    ["DISABLED", { ...environment, PC_EE_PROVIDER_DISABLED: "true" }, "PC_PROVIDER_BUNDLE_DISABLED"]
  ])("keeps %s startup safe but returns HTTP409 for an explicit retry", async (state, config, code) => {
    const build = vi.fn();
    const bundle = new EeProviderBundle({ environment: () => config, build });
    await bundle.reload();
    expect(bundle.descriptor().bundle_state).toBe(state);
    expect(bundle.automaticRecoveryAllowed()).toBe(false);
    const server = buildApiServer({ eeBundle: bundle, retryEeProvider: () => bundle.reload({ manual: true }) });
    try {
      const response = await server.inject({ method: "POST", url: "/v1/providers/eeclaw/retry" });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code, retryable: false } });
      expectRevision(bundle, 3);
      expect(bundle.active()).toBeUndefined();
      expect(build).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it.each([
    ["PC_PROVIDER_AUTHENTICATION_FAILED", "AUTHENTICATION", 400, false],
    ["PC_MCP_INVALID_RESPONSE", "PROTOCOL", 400, false],
    ["PC_PROVIDER_INCOMPATIBLE", "COMPATIBILITY", 400, false],
    ["PC_MCP_TRANSPORT_FAILED", "TRANSPORT", 503, true],
    ["PC_MCP_TIMEOUT", "TIMEOUT", 503, true]
  ])("keeps %s distinct from successful retry and generic HTTP500", async (code, failure, status, retryable) => {
    const build = vi.fn(async () => { throw Object.assign(new Error("synthetic-failure"), { code }); });
    const bundle = new EeProviderBundle({ environment: () => environment, build });
    const server = buildApiServer({ eeBundle: bundle, retryEeProvider: () => bundle.reload({ manual: true }) });
    try {
      const response = await server.inject({ method: "POST", url: "/v1/providers/eeclaw/retry" });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ error: { code: `PC_PROVIDER_BUNDLE_${failure}`, retryable } });
      expect(bundle.active()).toBeUndefined();
      expectRevision(bundle, 2);
      if (retryable) {
        const blocked = await server.inject({ method: "POST", url: "/v1/providers/eeclaw/retry" });
        expect(blocked.statusCode).toBe(503);
        expect(blocked.json()).toMatchObject({ error: { code: "PC_PROVIDER_RETRY_BLOCKED", retryable: true } });
        expect(build).toHaveBeenCalledTimes(1);
        expectRevision(bundle, 2);
      }
    } finally { await server.close(); }
  });
});
