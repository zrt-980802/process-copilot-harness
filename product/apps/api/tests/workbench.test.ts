import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityAuthorizationService, ProfileCapabilityService, RuntimeRegistryService } from "@pc/application";
import type { RuntimeCapabilityManifest } from "@pc/domain";
import { MemoryEventProjectionRepository, MemoryIdentityAuthorizationRepository, MemoryProfileCapabilityRepository, MemoryRuntimeRegistryRepository } from "@pc/persistence";
import { EventProjectionService } from "@pc/event-projection";
import type { SstsTaskWorkspace } from "@pc/ssts-draft";
import type { SstsDraftService } from "@pc/ssts-draft";
import { RuntimeWorkbench, type WorkbenchOptions } from "../src/workbench.js";
import { EeClawWorkbenchProjectionAdapter } from "../src/ee-provider.js";

afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const routing = new IdentityAuthorizationService(new MemoryIdentityAuthorizationRepository(), "workbench-route-test-signing-key-000000000");
  const profiles = new ProfileCapabilityService(new MemoryProfileCapabilityRepository());
  await profiles.initialize();
  const seeded = await profiles.seedFixedFoRelease();
  await profiles.assignProfile("owner", seeded.profile.profile_release_id);
  let live: RuntimeCapabilityManifest = {
    contract_name: "pc.runtime-capability-manifest/1", contract_version: 1,
    runtime_id: "runtime", runtime_epoch: 1, dsh_version: seeded.plugin.dsh_compatibility,
    bridge_protocol_versions: ["1.0"], profile_digest: "profile", bundle_lock_digest: "bundle-old",
    manifest_digest: "bundle-old", plugin_releases: [seeded.plugin.plugin_release_id],
    agent_presets: [], tool_provider_capabilities: ["pc-controlled-gateway"], persistence_capabilities: [],
    event_export_capabilities: [], approval_capabilities: [], resource_capabilities: [], limits: {}, generated_at: new Date().toISOString()
  };
  const registry = new RuntimeRegistryService(new MemoryRuntimeRegistryRepository(), {
    execute: async (_runtime, command) => ({ contract_name: "pc.runtime-command-result/1", contract_version: 1,
      command_id: command.command_id, accepted: true, committed: true, outcome_state: "KNOWN_SUCCESS",
      runtime_observation: {}, completed_at: new Date().toISOString() })
  }, () => new Date(), profiles);
  await registry.initialize();
  const ref = { resource_id: "input", resource_version_id: "version" };
  const view = { workspace_view_snapshot_id: "view", bindings: [{ resource_ref: ref }], expires_at: new Date(Date.now() + 3600_000).toISOString() };
  const workspace = { workspace_id: "workspace", business_task_id: "business", tenant_id: "tenant",
    owner_principal_id: "owner", project_code: "EP37", profile_release_id: seeded.profile.profile_release_id } as SstsTaskWorkspace;
  const authenticate = vi.fn(async () => ({ principal: { tenant_id: "tenant", principal_id: "owner", authorization_revision: 1 } }));
  const options = { registry, profiles, runtimeUrl: "http://runtime", tools: [seeded.tool],
    profileReleaseId: seeded.profile.profile_release_id,
    reviewProfileReleaseId: seeded.profile.profile_release_id,
    connector: { connector_id: "ee", mcp_server_id: "ee-mcp", provider_key: "official-mcp",
      auth_mode: "delegated", state: "ACTIVE", capability_digest: "catalog-digest" },
    projectDirectory: {
      provider_registration_id: "provider:eeclaw",
      resource_authority: "eeclaw",
      listProjects: async () => [{ project_code: "EP37" }]
    },
    workbenchProjection: new EeClawWorkbenchProjectionAdapter(),
    identity: { authenticate, authenticateForProvider: authenticate, classifyAuthorization: routing.classifyAuthorization.bind(routing),
      evaluatePrincipalAuthorization: async () => ({ decision: "ALLOW" }), issuePrincipalEnvelope: async () => ({}) },
    resources: { getResourceProjection: async () => ({ resource: { current_version_id: "version" } }),
      createBinding: async () => ({ binding_id: "binding" }), getWorkspaceView: async () => view,
      createWorkspaceView: async () => view, materialize: async () => ({}) },
    gateway: { getOperation: async () => undefined, listOperationAudit: async () => [] },
    gatewayRepository: { findExternalAccountBinding: async () => ({ status: "ACTIVE", credential_generation: 1 }),
      getOperation: async () => undefined }, events: { listTaskOperations: async () => [] }
  } as unknown as WorkbenchOptions;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/health")
    ? { status: "ok" } : { capability_manifest: live }), { status: 200 })));
  const workbench = new RuntimeWorkbench(options);
  async function register(owner = "owner") {
    return registry.registerRuntime({ runtime_id: live.runtime_id, runtime_epoch: live.runtime_epoch,
      tenant_id: "tenant", owner_user_id: owner, worker_pool_id: "local-dev09a", state: "READY",
      profile_bundle_digest: live.profile_digest, endpoint_url: "http://runtime", capability_manifest: live });
  }
  return { workbench, registry, workspace, profiles, seeded, register, authenticate,
    prepare: () => workbench.prepare(workspace, "token", [ref]),
    standaloneRuntime: () => {
      live = { ...live, tool_provider_capabilities: [] };
      workbench.options.gateway = undefined;
      workbench.options.gatewayRepository = undefined;
      workbench.options.connector = undefined;
      workbench.options.projectDirectory = undefined;
      workbench.options.workbenchProjection = undefined;
      workbench.options.profileReleaseId = undefined;
      workbench.options.reviewProfileReleaseId = undefined;
      workbench.options.tools = [];
    },
    rebuild: () => { live = { ...live, bundle_lock_digest: "bundle-new", manifest_digest: "bundle-new" }; } };
}

describe("Workbench admission after a local Runtime rebuild", () => {
  it("projects the existing capability chain without provisioning or leaking internal access data", async () => {
    const f = await fixture();
    await f.prepare();
    f.workbench.options.runtimeSecret = "do-not-return-this-runtime-secret";
    f.workbench.options.events = { listTaskOperations: async () => [{ operation_id: "operation-1",
      business_task_id: "business", tenant_id: "tenant", owner_principal_id: "owner", operation_kind: "READ",
      state: "SUCCEEDED", recovery_class: "REPLAY_SAFE", input_digest: "input", evidence_refs: ["eea://traces/read-1", "internal:evidence"],
      projection_complete: true, last_event_id: "event-1", updated_at: "2026-11-13T00:00:00.000Z", version: 1 }] } as never;
    f.workbench.options.gatewayRepository = { getOperation: async () => ({ tool_release_id: f.seeded.tool.tool_release_id,
      outcome_state: "KNOWN_SUCCESS", arguments: { access_token: "must-not-leak" }, evidence_refs: ["eea://traces/read-1"] }) } as never;
    vi.mocked(fetch).mockClear();

    const chain = await f.workbench.capabilityChain("token", "EP37", f.workspace);

    expect(chain.profile?.profile_release_id).toBe(f.workspace.profile_release_id);
    expect(chain.effective_snapshot?.tool_release_ids).toContain(f.seeded.tool.tool_release_id);
    expect(chain.runtime?.manifest?.tool_provider_capabilities).toContain("pc-controlled-gateway");
    expect(chain.tool_set.map((tool) => tool.tool_release_id)).toEqual([f.seeded.tool.tool_release_id]);
    expect(chain.recent_operations[0]).toMatchObject({ tool_name: f.seeded.tool.tool_definition_id,
      state: "SUCCEEDED", trace_refs: ["eea://traces/read-1"] });
    const serialized = JSON.stringify(chain);
    expect(serialized).not.toContain("do-not-return-this-runtime-secret");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("http://runtime");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("derives reduced and empty Tool Sets from current project authority", async () => {
    const f = await fixture();
    const second = await f.profiles.publishToolRelease({ ...f.seeded.tool,
      tool_release_id: "review-only-tool", tool_definition_id: "ee.review_tool" });
    f.workbench.options.tools = [f.seeded.tool, second];
    vi.spyOn(f.workbench.options.identity, "evaluatePrincipalAuthorization").mockImplementation(async (input) => ({
      decision: input.tool_release_ids.includes(second.tool_release_id) ? "DENY" : "ALLOW"
    }) as never);

    const reviewer = await f.workbench.capabilityChain("token", "EP37");
    expect(reviewer.tool_set.map((tool) => tool.tool_release_id)).toEqual([f.seeded.tool.tool_release_id]);
    expect(fetch).not.toHaveBeenCalled();

    f.workbench.options.projectDirectory.listProjects = async () => [];
    await expect(f.workbench.capabilityChain("token", "EP37"))
      .rejects.toMatchObject({ code: "PC_WORKBENCH_PROJECT_DENIED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the authoritative session projection when its user container is offline", async () => {
    const f = await fixture();
    await f.prepare();
    f.workbench.options.events = { listTaskOperations: async () => [] } as unknown as WorkbenchOptions["events"];
    const resolver = vi.fn();
    f.workbench.options.resolveRuntime = resolver;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const state = await f.workbench.projection(f.workspace);
    expect(state.session?.assignment.runtime_id).toBe("runtime");
    expect(state.runtime_available).toBe(false);
    expect(state.events).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });
  it("creates a personal profile without granting tools or provisioning execution", async () => {
    const f = await fixture();
    const profile = await f.profiles.publishExpertProfile({ ...f.seeded.profile, profile_release_id: "profile:conversation:personal:1",
      tool_requirements: [], output_contract: { kind: "AI_CONVERSATION", enterprise_write: false } });
    f.workbench.options.conversationProfileReleaseId = profile.profile_release_id;
    const createWorkspace = vi.fn(async input => input);
    const workspace = await f.workbench.create({ createWorkspace } as unknown as SstsDraftService, "token", { title: "Personal", mode: "CHAT" });
    expect(workspace).toMatchObject({ principal_id: "owner", profile_release_id: profile.profile_release_id });
    expect(workspace).not.toHaveProperty("project_code");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("runs the personal admission path without any EE provider dependency", async () => {
    const f = await fixture();
    const profile = await f.profiles.publishExpertProfile({
      ...f.seeded.profile,
      profile_release_id: "profile:conversation:personal:1",
      tool_requirements: [],
      output_contract: { kind: "AI_CONVERSATION", enterprise_write: false }
    });
    await f.profiles.assignProfile("owner", profile.profile_release_id);
    f.standaloneRuntime();
    f.workbench.options.conversationProfileReleaseId = profile.profile_release_id;
    const workspace = {
      ...f.workspace,
      project_code: undefined,
      profile_release_id: profile.profile_release_id
    };

    await expect(f.workbench.projects("token")).resolves.toEqual([]);
    await expect(f.workbench.catalog("token", "EP37"))
      .rejects.toMatchObject({ code: "PC_WORKBENCH_PROJECT_PROVIDER_UNAVAILABLE" });
    const prepared = await f.workbench.prepare(workspace, "token", [{
      resource_id: "input",
      resource_version_id: "version"
    }]);
    expect(prepared.context.tools).toEqual([]);
    expect(prepared.context.principal_envelope).toBeDefined();
    expect(vi.mocked(fetch).mock.calls.every(([url]) =>
      String(url).startsWith("http://runtime"))).toBe(true);
  });

  it("keeps personal admission available while closing only unavailable EE paths", async () => {
    const f = await fixture();
    const profile = await f.profiles.publishExpertProfile({
      ...f.seeded.profile,
      profile_release_id: "profile:conversation:personal:1",
      tool_requirements: [],
      output_contract: { kind: "AI_CONVERSATION", enterprise_write: false }
    });
    await f.profiles.assignProfile("owner", profile.profile_release_id);
    f.workbench.options.tools = [];
    f.workbench.options.conversationProfileReleaseId = profile.profile_release_id;
    f.workbench.options.providerAvailability = {
      isUsable: () => false,
      observation: () => ({
        contract_name: "pc.provider-health/1",
        contract_version: 1,
        health_observation_id: "provider-health:eeclaw",
        provider_registration_id: "provider:eeclaw",
        configuration_revision: 1,
        provider_state: "UNAVAILABLE",
        compatibility_status: "UNKNOWN",
        port_health: { project_directory: "UNAVAILABLE" },
        reason_codes: ["provider_project_directory_unavailable"],
        evidence_refs: [],
        checked_at: "2026-11-17T00:00:00.000Z",
        expires_at: "2026-11-17T00:00:30.000Z"
      }),
      beginAttempt: () => ({
        allowed: false,
        probe: false,
        success: () => undefined,
        failure: () => undefined
      })
    };
    const personal = {
      ...f.workspace,
      project_code: undefined,
      profile_release_id: profile.profile_release_id
    };

    expect(f.workbench.hasProjectProvider()).toBe(false);
    await expect(f.workbench.projects("token"))
      .rejects.toMatchObject({ code: "PC_WORKBENCH_PROVIDER_UNAVAILABLE" });
    await expect(f.workbench.catalog("token", "EP37"))
      .rejects.toMatchObject({ code: "PC_WORKBENCH_PROVIDER_UNAVAILABLE" });
    await expect(f.workbench.prepare(personal, "token", [{
      resource_id: "input",
      resource_version_id: "version"
    }])).resolves.toMatchObject({ context: { tools: [] } });
  });

  it("publishes a project CHAT profile from the allowed read subset without weakening SSTS requirements", async () => {
    const f = await fixture();
    const personal = await f.profiles.publishExpertProfile({ ...f.seeded.profile, profile_release_id: "profile:conversation:personal:1",
      tool_requirements: [], output_contract: { kind: "AI_CONVERSATION", enterprise_write: false } });
    const second = await f.profiles.publishToolRelease({ ...f.seeded.tool, tool_release_id: "second", tool_definition_id: "second" });
    const write = await f.profiles.publishToolRelease({ ...f.seeded.tool, tool_release_id: "write", tool_definition_id: "write",
      risk_manifest: { ...f.seeded.tool.risk_manifest, action_class: "WRITE" } });
    f.workbench.options.tools = [f.seeded.tool, second, write];
    f.workbench.options.profileReleaseId = f.seeded.profile.profile_release_id;
    f.workbench.options.conversationProfileReleaseId = personal.profile_release_id;
    vi.spyOn(f.workbench.options.identity, "evaluatePrincipalAuthorization").mockImplementation(async input => ({
      decision: input.tool_release_ids.includes(f.seeded.tool.tool_release_id) ? "DENY" : "ALLOW"
    }) as never);
    const createWorkspace = vi.fn(async input => input);
    const ssts = { createWorkspace } as unknown as SstsDraftService;
    const chat = await f.workbench.create(ssts, "token", { title: "Project chat", project_code: "EP37", mode: "CHAT" });
    expect((await f.profiles.getProfileRelease(chat.profile_release_id))?.tool_requirements).toEqual(["second"]);
    await expect(f.workbench.create(ssts, "token", { title: "SSTS", project_code: "EP37", mode: "READ" })).rejects.toMatchObject({ code: "PC_WORKBENCH_PROFILE_DENIED" });
    expect(createWorkspace).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed prompts before preparing execution", async () => {
    const f = await fixture();
    for (const prompt of [undefined, "", " ", "x".repeat(100_001), "invalid\u0000text", "lone\uD800surrogate"]) {
      await expect(f.workbench.run(f.workspace, "token", prompt as string, [])).rejects.toMatchObject({ code: "PC_WORKBENCH_PROMPT_INVALID" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects non-PostgreSQL JSON strings before recording tool operations", async () => {
    const f = await fixture();
    for (const args of [{ ssts_code: "bad\u0000" }, { nested: [{ "bad\uD800": "value" }] }]) {
      await expect(f.workbench.executeTool({ call_id: "boundary", tool_release_id: "tool", arguments: args,
        context: {} as never })).rejects.toMatchObject({ code: "PC_WORKBENCH_TOOL_ARGUMENT_INVALID" });
    }
    await expect(f.workbench.create({} as SstsDraftService, "token", { title: "bad\u0000", mode: "CHAT" }))
      .rejects.toMatchObject({ code: "PC_WORKBENCH_TASK_INVALID" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a simultaneous turn before admission and releases the guard on failure", async () => {
    const f = await fixture();
    let finish!: () => void;
    vi.spyOn(f.workbench, "prepare").mockImplementation(async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      throw new Error("controlled admission failure");
    });
    const first = f.workbench.run(f.workspace, "token", "first", []);
    const finished = expect(first).rejects.toThrow("controlled admission failure");
    await expect(f.workbench.run(f.workspace, "token", "duplicate", [])).rejects.toMatchObject({ code: "PC_WORKBENCH_TURN_CONFLICT" });
    finish(); await finished;
    const next = f.workbench.run(f.workspace, "token", "next", []);
    const nextFinished = expect(next).rejects.toThrow("controlled admission failure");
    finish(); await nextFinished;
  });
  it("does not allocate a Runtime when reading a never-executed conversation", async () => {
    const f = await fixture();
    const resolver = vi.fn();
    f.workbench.options.resolveRuntime = resolver;
    expect(await f.workbench.conversation(f.workspace, "token", [])).toEqual({ messages: [] });
    expect(resolver).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects inaccessible projects before allocating a Runtime", async () => {
    const f = await fixture();
    f.workbench.options.projectDirectory.listProjects = async () => [];
    const resolver = vi.fn();
    f.workbench.options.resolveRuntime = resolver;
    await expect(f.prepare()).rejects.toMatchObject({ code: "PC_WORKBENCH_PROJECT_DENIED" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("queries and registers the authenticated user's resolved Runtime endpoint", async () => {
    const f = await fixture();
    f.workbench.options.resolveRuntime = vi.fn(async () => "http://personal-runtime");
    await f.prepare();
    expect(fetch).toHaveBeenCalledWith("http://personal-runtime/capabilities", expect.anything());
    expect((await f.registry.getRuntimeProjection("runtime")).runtime.endpoint_url).toBe("http://personal-runtime");
  });
  it("reuses only its exact synthetic project binding for a task with no uploaded inputs", async () => {
    const f = await fixture();
    const resources = f.workbench.options.resources;
    const ref = { resource_id: "context", resource_version_id: "context-v1" };
    const content = Buffer.from(JSON.stringify({ project_code: "EP37", function_code: null,
      profile_release_id: f.workspace.profile_release_id }));
    let acquisition = "session-project-binding";
    const upload = vi.fn(async () => ({ resource_ref: ref })) as unknown as typeof resources.uploadResource;
    resources.uploadResource = upload;
    resources.getResourceProjection = vi.fn(async () => ({
      resource: { resource_id: "context", current_version_id: "context-v1", kind: "EVIDENCE_SNAPSHOT",
        lifecycle_status: "ACTIVE", tenant_id: "tenant", created_by: "owner" },
      versions: [{ resource_version_id: "context-v1", content_digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        provenance: { source_system: "pc-workbench", acquisition_operation: acquisition } }]
    })) as unknown as typeof resources.getResourceProjection;
    const view = { workspace_view_snapshot_id: "view", bindings: [{ resource_ref: ref }],
      expires_at: new Date(Date.now() + 3600_000).toISOString() };
    resources.createWorkspaceView = vi.fn(async () => view) as unknown as typeof resources.createWorkspaceView;
    resources.getWorkspaceView = vi.fn(async () => view) as unknown as typeof resources.getWorkspaceView;
    const first = await f.workbench.prepare(f.workspace, "token", []);
    const second = await f.workbench.prepare(f.workspace, "token", []);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(second.assignment.assignment_id).toBe(first.assignment.assignment_id);
    acquisition = "unrelated-source";
    await f.workbench.prepare(f.workspace, "token", []);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent admission of the same task and reuses its active assignment", async () => {
    const f = await fixture();
    const results = await Promise.all([f.prepare(), f.prepare(), f.prepare()]);
    expect(new Set(results.map(result => result.assignment.assignment_id)).size).toBe(1);
    expect(results.every(result => result.assignment.state === "ACTIVE")).toBe(true);
  });

  it("admits a fresh task against the live bundle when registration still contains the old digest", async () => {
    const f = await fixture();
    await f.register(); f.rebuild();
    const prepared = await f.prepare();
    expect(prepared.assignment.state).toBe("ACTIVE");
    expect(prepared.snapshot.runtime_requirements.bundle_lock_digest).toBe("bundle-new");
    expect((await f.registry.getRuntimeProjection("runtime")).runtime.capability_manifest_digest).toBe("bundle-new");
  });

  it("replaces the old snapshot through a fenced assignment and preserves its immutable evidence", async () => {
    const f = await fixture();
    const first = await f.prepare(); f.rebuild();
    const second = await f.prepare();
    expect(second.assignment.state).toBe("ACTIVE");
    expect(second.assignment.assignment_generation).toBeGreaterThan(first.assignment.assignment_generation);
    expect(BigInt(second.assignment.fencing_token)).toBeGreaterThan(BigInt(first.assignment.fencing_token));
    expect(second.snapshot.effective_profile_snapshot_id).not.toBe(first.snapshot.effective_profile_snapshot_id);
    expect(second.snapshot.runtime_requirements.bundle_lock_digest).toBe("bundle-new");
    expect(await f.profiles.getEffectiveProfileSnapshot(first.snapshot.effective_profile_snapshot_id)).toEqual(first.snapshot);
    expect(second.context.compatible_session_presets).toContain((first.context.compatible_session_presets as string[])[0]);
    expect((await f.profiles.listSessionSnapshots("unrelated-session"))).toEqual([]);
  });

  it("rejects another owner before rewriting the registered manifest", async () => {
    const f = await fixture();
    await f.register("other-owner"); f.rebuild();
    await expect(f.prepare()).rejects.toMatchObject({ code: "PC_RUNTIME_OWNER_SCOPE_DENIED" });
    expect((await f.registry.getRuntimeProjection("runtime")).runtime.capability_manifest_digest).toBe("bundle-old");
  });
  it("denies saved project projections after membership revocation without allocating execution", async () => {
    const f = await fixture();
    const ssts = { getWorkspace: async () => ({ workspace: f.workspace }) } as unknown as SstsDraftService;
    f.workbench.options.projectDirectory.listProjects = async () => [];
    await expect(f.workbench.owned(ssts, "token", f.workspace.workspace_id)).rejects.toMatchObject({ code: "PC_WORKBENCH_PROJECT_DENIED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("persists client request conflicts across API objects without another model turn", async () => {
    const f = await fixture();
    const events = new EventProjectionService(new MemoryEventProjectionRepository());
    await events.initialize();
    const task = await events.createTask({ tenant_id: "tenant", owner_principal_id: "owner", profile_release_id: "profile" });
    f.workspace.business_task_id = task.business_task_id;
    f.workbench.options.events = events;
    const prepared = await f.prepare();
    prepared.context.principal_envelope = { ...prepared.context.principal_envelope,
      subject_principal_id: "owner", tenant_id: "tenant", authorization_revision: 1,
      allowed_actions: f.seeded.tool.required_permissions, resource_scope_refs: ["project:EP37"] };
    vi.spyOn(f.workbench, "prepare").mockResolvedValue(prepared);
    await f.workbench.run(f.workspace, "token", "first prompt", [], undefined, "request-12345678");
    const operation = (await events.listTaskOperations(task.business_task_id))[0]!;
    expect(operation.state).toBe("SUCCEEDED");
    const restarted = new RuntimeWorkbench(f.workbench.options);
    vi.spyOn(restarted, "prepare").mockResolvedValue(prepared);
    const dispatch = vi.spyOn(f.registry, "dispatchSessionCommand");
    for (const prompt of ["first prompt", "different prompt"]) {
      await expect(restarted.run(f.workspace, "token", prompt, [], undefined, "request-12345678"))
        .rejects.toMatchObject({ code: "PC_WORKBENCH_REQUEST_CONFLICT" });
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
});
