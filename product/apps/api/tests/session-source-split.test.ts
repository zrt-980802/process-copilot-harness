import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityAuthorizationService, ProfileCapabilityService, RuntimeRegistryService } from "@pc/application";
import type { RuntimeCommandDispatcher } from "@pc/application";
import { IdentityAuthorizationError, type PCPrincipal, type PilotSession } from "@pc/domain";
import { EventProjectionService } from "@pc/event-projection";
import { MemoryEventProjectionRepository, MemoryIdentityAuthorizationRepository,
  MemoryProfileCapabilityRepository, MemoryResourceRepository,
  MemoryRuntimeRegistryRepository, MemorySstsDraftRepository } from "@pc/persistence";
import { LocalImmutableBlobStore, LocalWorkspaceMaterializer, ResourceWorkspaceService } from "@pc/resource";
import { DeterministicSstsDraftEngine, SstsDraftService } from "@pc/ssts-draft";
import { EeProviderBundle } from "../src/ee-provider-bundle.js";
import { buildApiServer } from "../src/server.js";
import { RuntimeWorkbench } from "../src/workbench.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pc-t1a-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  let time = Date.now();
  const now = () => new Date(time);
  const repository = new MemoryIdentityAuthorizationRepository();
  const identity = new IdentityAuthorizationService(repository, "t1a-fixture-signing-key-0000000000000000", [], now);
  await identity.initialize();
  const login = await identity.signInExternal({ identity_provider_ref: "eeclaw", issuer: "http://ee-t1a.invalid",
    external_subject: "42", tenant_or_org_ref: "t1a" }, randomUUID(), new Date(time + 60_000).toISOString());
  const profiles = new ProfileCapabilityService(new MemoryProfileCapabilityRepository(), now);
  await profiles.initialize();
  const seeded = await profiles.seedFixedFoRelease();
  const profile = await profiles.publishExpertProfile({ ...seeded.profile,
    profile_release_id: "profile:conversation:personal:1", tool_requirements: [],
    output_contract: { kind: "AI_CONVERSATION", enterprise_write: false } });
  await profiles.assignProfile(login.principal.principal_id, profile.profile_release_id);
  const resources = new ResourceWorkspaceService(new MemoryResourceRepository(),
    new LocalImmutableBlobStore(join(root, "blobs")), new LocalWorkspaceMaterializer(join(root, "views")), undefined, now);
  await resources.initialize();
  const commands = vi.fn<RuntimeCommandDispatcher["execute"]>(async (_runtime, command) => ({
    contract_name: "pc.runtime-command-result/1" as const, contract_version: 1 as const,
    command_id: command.command_id, accepted: true, committed: true,
    outcome_state: "KNOWN_SUCCESS" as const, runtime_observation: { final_response: "T1A synthetic Runtime-port response" },
    completed_at: now().toISOString()
  }));
  const registry = new RuntimeRegistryService(new MemoryRuntimeRegistryRepository(), { execute: commands }, now, profiles, resources);
  await registry.initialize();
  const events = new EventProjectionService(new MemoryEventProjectionRepository(), undefined, undefined, undefined, undefined, now);
  await events.initialize();
  const ssts = new SstsDraftService(new MemorySstsDraftRepository(), profiles, resources, events,
    new DeterministicSstsDraftEngine(), now);
  await ssts.initialize();
  const bundle = new EeProviderBundle({ environment: () => ({}), build: async () => { throw new Error("No real EE is started"); } });
  const sourceValidation = vi.fn((session: PilotSession, principal: PCPrincipal) => bundle.identity.validate(session, principal).then(() => undefined));
  identity.registerProviderSessionValidator(sourceValidation);
  const providerCalls = [vi.spyOn(bundle.identity, "validate"), vi.spyOn(bundle.identity, "authenticate"),
    vi.spyOn(bundle.authorization, "evaluate"), vi.spyOn(bundle.directory, "listProjects"),
    vi.spyOn(bundle.capability, "discover"), vi.spyOn(bundle.capability, "dispatch"),
    vi.spyOn(bundle.capability, "reconcile"), vi.spyOn(bundle.credentialIssuer, "issue")];
  const directory = vi.fn(async () => { throw new IdentityAuthorizationError("PC_PROVIDER_UNAVAILABLE", "Synthetic EE outage", true); });
  const workbench = new RuntimeWorkbench({ identity, profiles, resources, registry, events, tools: [],
    runtimeUrl: "http://runtime-t1a.invalid", conversationProfileReleaseId: profile.profile_release_id,
    projectDirectory: { provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw", listProjects: directory },
    providerAvailability: { isUsable: () => false, observation: () => bundle.observation() },
    workspace: async (workspace_id, tenant_id, principal_id) => (await ssts.getWorkspace({ workspace_id, tenant_id, principal_id })).workspace });
  const workspace = await ssts.createWorkspace({ tenant_id: "t1a", principal_id: login.principal.principal_id,
    title: "T1A personal conversation", profile_release_id: profile.profile_release_id });
  const server = buildApiServer({ identityAuthorization: identity, profileCapability: profiles, resourceWorkspace: resources,
    runtimeRegistry: registry, eventProjection: events, sstsDraft: ssts, workbench,
    eeIdentityProvider: bundle.identity, eeBundle: bundle, providerMode: "ee-connected" });
  cleanups.push(() => server.close());
  return { server, identity, repository, login, workspace, workbench, profiles, seeded, resources,
    sourceValidation, directory, providerCalls, commands, now, bundle, ssts, profile,
    advance: (ms: number) => { time += ms; },
    headers: { authorization: `Bearer ${login.access_token}` } };
}

describe("T1A EE-backed PC Session/source boundary", () => {
  it.each(["identity", "personal list", "personal task", "conversation"])(
    "%s survives source unavailable with zero Provider calls", async (path) => {
      const f = await fixture();
      const urls: Record<string, string> = { identity: "/v1/identity/me", "personal list": "/v1/ssts-tasks?scope=personal",
        "personal task": `/v1/ssts-tasks/${f.workspace.workspace_id}`,
        conversation: `/v1/workbench/tasks/${f.workspace.workspace_id}/conversation` };
      const response = await f.server.inject({ url: urls[path]!, headers: f.headers });
      expect(response.statusCode, response.body).toBe(200);
      expect(f.sourceValidation).not.toHaveBeenCalled();
      expect(f.directory).not.toHaveBeenCalled();
      f.providerCalls.forEach(call => expect(call).not.toHaveBeenCalled());
    }
  );

  it("reports only locally proven external identity and never slides fixed expiry", async () => {
    const f = await fixture();
    for (const elapsed of [0, 20_000, 20_000]) {
      f.advance(elapsed);
      const response = await f.server.inject({ url: "/v1/identity/me", headers: f.headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ login_provider: "eeclaw", principal: f.login.principal,
        authentication_context_id: f.login.authentication_context_id, expires_at: f.login.expires_at });
      expect(response.json()).not.toHaveProperty("account");
    }
    f.advance(20_000);
    const expired = await f.server.inject({ url: "/v1/identity/me", headers: f.headers });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe("PC_AUTHENTICATION_REQUIRED");
    f.providerCalls.forEach(call => expect(call).not.toHaveBeenCalled());
  });

  it("creates a personal task and completes a real PC Workbench Turn using only the Runtime Port", async () => {
    const f = await fixture();
    const manifest = { contract_name: "pc.runtime-capability-manifest/1", contract_version: 1,
      runtime_id: "runtime-t1a", runtime_epoch: 1, dsh_version: f.seeded.plugin.dsh_compatibility,
      bridge_protocol_versions: ["1.0"], profile_digest: "profile", bundle_lock_digest: "bundle",
      manifest_digest: "bundle", plugin_releases: [f.seeded.plugin.plugin_release_id],
      agent_presets: [], tool_provider_capabilities: [], persistence_capabilities: [], event_export_capabilities: [],
      approval_capabilities: [], resource_capabilities: [], limits: {}, generated_at: f.now().toISOString() };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url.startsWith("http://runtime-t1a.invalid/")).toBe(true);
      return new Response(JSON.stringify(url.endsWith("/health") ? { status: "ok" }
        : url.endsWith("/capabilities") ? { capability_manifest: manifest } : { messages: [] }));
    }));
    const created = await f.server.inject({ method: "POST", url: "/v1/workbench/tasks", headers: f.headers,
      payload: { title: "T1A personal", mode: "CHAT" } });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().workspace_id;
    const turn = await f.server.inject({ method: "POST", url: `/v1/workbench/tasks/${id}/turns`, headers: f.headers,
      payload: { prompt: "Explain a local PC task", request_id: "t1a-personal-turn-01" } });
    expect(turn.statusCode, turn.body).toBe(200);
    expect(turn.json().content).toBe("T1A synthetic Runtime-port response");
    expect(f.commands.mock.calls.some(([, command]) => command.command_type === "START_TURN")).toBe(true);
    const history = await f.server.inject({ url: `/v1/workbench/tasks/${id}/conversation`, headers: f.headers });
    expect(history.statusCode, history.body).toBe(200);
    expect(f.sourceValidation).not.toHaveBeenCalled();
    expect(f.directory).not.toHaveBeenCalled();
    f.providerCalls.forEach(call => expect(call).not.toHaveBeenCalled());
  });

  it.each(["missing", "revoked", "wrong tenant", "wrong principal", "wrong provider"])(
    "rejects a %s local Identity Link before any source call", async variant => {
      const f = await fixture();
      const link = await f.repository.findVerifiedIdentityLink(f.login.principal.principal_id, "eeclaw");
      vi.spyOn(f.repository, "findVerifiedIdentityLink").mockResolvedValue(variant === "missing" ? undefined : {
        ...link!, ...(variant === "revoked" ? { status: "revoked" as const } : {}),
        ...(variant === "wrong tenant" ? { tenant_or_org_ref: "other" } : {}),
        ...(variant === "wrong principal" ? { principal_id: "other" } : {}),
        ...(variant === "wrong provider" ? { identity_provider_ref: "other" } : {}) });
      await expect(f.identity.authenticate(f.login.access_token)).rejects.toMatchObject({ code: "PC_IDENTITY_LINK_UNVERIFIED" });
      expect(f.sourceValidation).not.toHaveBeenCalled();
      f.providerCalls.forEach(call => expect(call).not.toHaveBeenCalled());
    });

  it("rejects ambiguous verified links instead of selecting the newest or first one", async () => {
    const f = await fixture();
    await f.identity.linkVerifiedIdentity({ principal_id: f.login.principal.principal_id,
      identity_provider_ref: "eeclaw", issuer: "http://another-source.invalid", external_subject: "43",
      tenant_or_org_ref: "t1a", verification_level: "admin_reauthentication",
      expected_identity_revision: f.login.principal.identity_revision });
    await expect(f.repository.findVerifiedIdentityLink(f.login.principal.principal_id, "eeclaw")).resolves.toBeUndefined();
    await expect(f.identity.authenticate(f.login.access_token)).rejects.toMatchObject({ code: "PC_IDENTITY_LINK_UNVERIFIED" });
    expect(f.sourceValidation).not.toHaveBeenCalled();
  });

  it.each(["sign-out", "disabled Principal"])("rejects %s locally", async variant => {
    const f = await fixture();
    if (variant === "sign-out") await f.identity.signOut(f.login.access_token);
    else vi.spyOn(f.repository, "getPrincipal").mockResolvedValue({ ...f.login.principal, lifecycle_status: "disabled" });
    await expect(f.identity.authenticate(f.login.access_token)).rejects.toMatchObject({
      code: variant === "sign-out" ? "PC_AUTHENTICATION_REQUIRED" : "PC_PRINCIPAL_INACTIVE" });
    expect(f.sourceValidation).not.toHaveBeenCalled();
  });

  it.each(["project list", "catalog", "project data", "tool", "write request", "execute approval", "reconcile", "raw execute", "raw approval", "raw decision", "raw reconcile"])(
    "%s fails closed during source outage", async path => {
      const f = await fixture();
      const project = await f.ssts.createWorkspace({ tenant_id: "t1a", principal_id: f.login.principal.principal_id,
        title: "Stored Provider-owned task", profile_release_id: f.profile.profile_release_id, project_code: "T1A" });
      const base = `/v1/workbench/tasks/${project.workspace_id}`;
      const paths = { "project list": "/v1/workbench/projects", catalog: "/v1/workbench/catalog?project_code=T1A",
        "project data": `${base}/project-data`, tool: `${base}/tools`, "write request": `${base}/write-requests`,
        "execute approval": `${base}/approvals/approval/execute`, reconcile: `${base}/operations/operation/reconcile`,
        "raw execute": "/v1/gateway/execute", "raw approval": "/v1/approvals",
        "raw decision": "/v1/approvals/approval/decision", "raw reconcile": "/v1/operations/operation/reconcile" };
      const response = await f.server.inject({ method: ["project list", "catalog", "project data"].includes(path) ? "GET" : "POST",
        url: paths[path], headers: f.headers, ...(["project list", "catalog", "project data"].includes(path) ? {} : { payload: {} }) });
      expect(response.statusCode, response.body).toBe(path === "catalog" ? 400 : 503);
      expect(response.json().error.code).toMatch(/PROVIDER.*UNAVAILABLE/u);
      expect(f.commands).not.toHaveBeenCalled();
      expect(f.bundle.capability.dispatch).not.toHaveBeenCalled();
    });

  it("denies new external login/reauthentication and never replaces or renews an outage Session", async () => {
    const f = await fixture();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.server.inject({ method: "POST", url: "/v1/auth/ee/exchange", headers: f.headers,
        payload: { ticket: "synthetic-ticket", code_verifier: "synthetic-verifier" } });
      expect(response.statusCode).toBe(503);
    }
    const current = await f.identity.authenticate(f.login.access_token);
    expect(current.session.expires_at).toBe(f.login.expires_at);
    expect(current.session.authentication_context_id).toBe(f.login.authentication_context_id);
    expect(current.session.authentication_context_id).toMatch(/^ee:/u);
    expect((await f.server.inject({ method: "POST", url: "/v1/auth/refresh", headers: f.headers })).statusCode).toBe(404);
  });

  it("bounds external proof to the PC eight-hour maximum without refreshing it on local use", async () => {
    const f = await fixture();
    const login = await f.identity.signInExternal({ identity_provider_ref: "eeclaw", issuer: "http://ee-t1a.invalid",
      external_subject: "42", tenant_or_org_ref: "t1a" }, randomUUID(), new Date(f.now().getTime() + 24 * 3600_000).toISOString());
    expect(Date.parse(login.expires_at) - f.now().getTime()).toBe(8 * 3600_000);
    f.advance(7 * 3600_000);
    expect((await f.identity.authenticate(login.access_token)).session.expires_at).toBe(login.expires_at);
    f.advance(3600_000);
    await expect(f.identity.authenticate(login.access_token)).rejects.toMatchObject({ code: "PC_AUTHENTICATION_REQUIRED" });
    f.providerCalls.forEach(call => expect(call).not.toHaveBeenCalled());
  });

  it("fails closed at an external boundary without a source Session validator", async () => {
    const f = await fixture();
    const identity = new IdentityAuthorizationService(f.repository, "t1a-unwired-signing-key-000000000000000", [], f.now);
    await expect(identity.authenticate(f.login.access_token)).resolves.toMatchObject({ principal: f.login.principal });
    await expect(identity.authenticateForProvider(f.login.access_token)).rejects.toMatchObject({ code: "PC_AUTHENTICATION_REQUIRED" });
    f.providerCalls.forEach(call => expect(call).not.toHaveBeenCalled());
  });

  it("keeps PC-only Snapshot/Envelope issuance local and rejects execution evidence after a PC revision change", async () => {
    const f = await fixture();
    const input = { actions: ["conversation.run"], resource_scope_refs: [`user:${f.login.principal.principal_id}`],
      tool_release_ids: [], policy_model_revision: 1 };
    const snapshot = await f.identity.issueAuthorizationSnapshot(f.login.access_token, input);
    expect(snapshot.decision).toBe("ALLOW");
    const envelopeInput = { snapshot, audience: "runtime:personal-conversation", pc_session_id: "pc-t1a",
      runtime_id: "runtime-t1a", runtime_epoch: 1, assignment_generation: 1, resource_scope_refs: input.resource_scope_refs };
    const envelope = await f.identity.issuePrincipalEnvelope(f.login.access_token, envelopeInput);
    expect(Date.parse(envelope.expires_at)).toBeLessThanOrEqual(Date.parse(f.login.expires_at));
    await f.identity.replaceAuthorizationGrants({ principal_id: f.login.principal.principal_id, expected_authorization_revision: 1,
      grants: [{ action: "task.read", scope_type: "global", scope_id: "*", effect: "allow", evidence_ref: "pc:revision-change" }] });
    await expect(f.identity.verifyPrincipalEnvelope(envelope)).rejects.toMatchObject({ code: "PC_PRINCIPAL_ENVELOPE_STALE" });
    await expect(f.identity.issuePrincipalEnvelope(f.login.access_token, envelopeInput)).rejects.toMatchObject({ code: "PC_SESSION_ASSURANCE_DENIED" });
    await expect(f.identity.issueAuthorizationSnapshot(f.login.access_token, input)).rejects.toMatchObject({ code: "PC_SESSION_ASSURANCE_DENIED" });
    expect(f.sourceValidation).not.toHaveBeenCalled();
    f.providerCalls.forEach(call => expect(call).not.toHaveBeenCalled());
  });

  it("preserves Standalone credentials and never invokes the registered source validator", async () => {
    const f = await fixture();
    await f.identity.provisionPilotAccount({ tenant_id: "t1a", account_key: "local.t1a", secret: "SyntheticLocalT1a123" });
    const login = await f.identity.signInPilot("t1a", "local.t1a", "SyntheticLocalT1a123");
    expect(login.authentication_context_id).not.toMatch(/^ee:/u);
    await expect(f.identity.authenticateForProvider(login.access_token)).resolves.toMatchObject({ principal: login.principal });
    expect((await f.identity.issueAuthorizationSnapshot(login.access_token, { actions: ["conversation.run"],
      resource_scope_refs: [`user:${login.principal.principal_id}`], tool_release_ids: [], policy_model_revision: 1 })).decision).toBe("ALLOW");
    expect(f.sourceValidation).not.toHaveBeenCalled();
    f.providerCalls.forEach(call => expect(call).not.toHaveBeenCalled());
  });

  it("requires fresh source validation and authorization after recovery, including subsequent Deny", async () => {
    const f = await fixture();
    const request = { actions: [" ee.read "], resource_scope_refs: ["project:T1A"], tool_release_ids: [], policy_model_revision: 1 };
    const principal = await f.identity.replaceAuthorizationGrants({ principal_id: f.login.principal.principal_id,
      expected_authorization_revision: 1, grants: [{ action: "ee.read", effect: "allow", scope_type: "project",
        scope_id: "T1A", evidence_ref: "pc:test-grant" }] });
    const freshLogin = await f.identity.signInExternal({ identity_provider_ref: "eeclaw", issuer: "http://ee-t1a.invalid",
      external_subject: "42", tenant_or_org_ref: "t1a" }, randomUUID(), f.login.expires_at);
    await expect(f.identity.issueAuthorizationSnapshot(freshLogin.access_token, request)).rejects.toMatchObject({ code: "PC_PROVIDER_UNAVAILABLE" });
    f.sourceValidation.mockResolvedValue(undefined);
    const evaluate = vi.fn(async () => ({ decision: "ALLOW" as "ALLOW" | "DENY", reason_codes: ["source-current"], evidence_refs: ["source:request"] }));
    f.identity.registerExternalAuthorizationPort({ evaluate });
    for (let i = 0; i < 2; i++) expect((await f.identity.issueAuthorizationSnapshot(freshLogin.access_token, request)).decision).toBe("ALLOW");
    expect(evaluate).toHaveBeenCalledTimes(2);
    evaluate.mockResolvedValue({ decision: "DENY", reason_codes: ["source-revoked"], evidence_refs: [] });
    expect((await f.identity.issueAuthorizationSnapshot(freshLogin.access_token, request)).decision).toBe("DENY");
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(f.sourceValidation).toHaveBeenCalledTimes(4);
    await f.identity.replaceAuthorizationGrants({ principal_id: principal.principal_id, expected_authorization_revision: principal.authorization_revision,
      grants: [{ action: "ee.read", effect: "deny", scope_type: "project", scope_id: "T1A", evidence_ref: "pc:deny" }] });
    evaluate.mockClear();
    const deniedLogin = await f.identity.signInExternal({ identity_provider_ref: "eeclaw", issuer: "http://ee-t1a.invalid",
      external_subject: "42", tenant_or_org_ref: "t1a" }, randomUUID(), f.login.expires_at);
    expect((await f.identity.issueAuthorizationSnapshot(deniedLogin.access_token, request)).decision).toBe("DENY");
    expect(evaluate).not.toHaveBeenCalled();
    expect((await f.identity.issueAuthorizationSnapshot(deniedLogin.access_token, { ...request, actions: ["unknown.action"] })).decision).toBe("DENY");
  });
});
