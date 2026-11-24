import { createServer, type Server } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { ProfileCapabilityService, RuntimeRegistryService } from "@pc/application";
import { MemoryProfileCapabilityRepository, MemoryResourceRepository, MemoryRuntimeRegistryRepository, MemorySstsDraftRepository } from "@pc/persistence";
import { LocalImmutableBlobStore, LocalWorkspaceMaterializer, ResourceWorkspaceService } from "@pc/resource";
import { DeterministicSstsDraftEngine, SstsDraftService } from "@pc/ssts-draft";
import { ControlledExecutionGatewayService, EphemeralCredentialIssuer } from "@pc/gateway";
import { RuntimeWorkbench } from "../../src/workbench.js";
import { buildApiServer } from "../../src/server.js";
import { installAuthorizationMvp } from "../../src/authorization-mvp.js";
import { EeClawWorkbenchProjectionAdapter } from "../../src/ee-provider.js";
import { gatewayEventPublisher } from "../../src/gateway-event-publisher.js";
import { authorizationMvpFixture } from "./authorization-mvp-fixture.js";

const openServers = new Set<Server>();

async function listen(server: Server) {
  openServers.add(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); openServers.delete(server); }
export async function closeAuthorizationBrowserServers() { await Promise.all([...openServers].map(close)); }

/** Real built PC UI/API/services; explicitly synthetic Provider and Runtime Ports. */
export async function authorizationMvpBrowserFixture(root: string, output: string) {
  await mkdir(output, { recursive: true });
  const f = await authorizationMvpFixture(true, undefined, { now: () => new Date() }); await f.server.close();
  const profiles = new ProfileCapabilityService(new MemoryProfileCapabilityRepository()); await profiles.initialize();
  const seeded = await profiles.seedFixedFoRelease();
  const browserTool = await profiles.publishToolRelease({ ...f.tool, input_schema: { type: "object", properties: {} },
    compatibility: { display_name: "查询项目功能", domain: "functions", mcp_tool_name: "ee.list_functions" } });
  const projectProfile = await profiles.publishExpertProfile({ ...seeded.profile, profile_release_id: "profile:mvp:project:1", tool_requirements: [f.tool.tool_release_id], plugin_requirements: [] });
  const personalProfile = await profiles.publishExpertProfile({ ...projectProfile, profile_release_id: "profile:conversation:personal:1", tool_requirements: [],
    output_contract: { kind: "AI_CONVERSATION", enterprise_write: false } });
  const resources = new ResourceWorkspaceService(new MemoryResourceRepository(), new LocalImmutableBlobStore(join(output, "blobs")), new LocalWorkspaceMaterializer(join(output, "views")));
  await resources.initialize();
  const messages = new Map<string, Array<{ role: string; content: string; message_id: string; sequence: number; occurred_at: string }>>();
  const runtimeCalls: string[] = [];
  const manifest = { contract_name: "pc.runtime-capability-manifest/1", contract_version: 1, runtime_id: `runtime-browser-${f.principal.principal_id}`,
    runtime_epoch: 1, dsh_version: seeded.plugin.dsh_compatibility, bridge_protocol_versions: ["1.0"], profile_digest: "synthetic-profile",
    bundle_lock_digest: "synthetic-bundle", manifest_digest: "synthetic-manifest", plugin_releases: [seeded.plugin.plugin_release_id], agent_presets: [],
    tool_provider_capabilities: ["pc-controlled-gateway"], persistence_capabilities: [], event_export_capabilities: [], approval_capabilities: [], resource_capabilities: [], limits: {}, generated_at: new Date().toISOString() };
  const runtime = createServer((request, response) => {
    runtimeCalls.push(request.url!);
    const match = /^\/v1\/sessions\/([^/]+)\/conversation$/u.exec(request.url!);
    const payload = request.url === "/health" ? { status: "ok" } : request.url === "/capabilities" ? { capability_manifest: manifest }
      : match ? { messages: messages.get(decodeURIComponent(match[1]!)) ?? [] } : { events: [] };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
  });
  const runtimeUrl = await listen(runtime);
  const registry = new RuntimeRegistryService(new MemoryRuntimeRegistryRepository(), { execute: async (_runtime, command) => {
    const answer = "合成 Runtime Port 响应：个人任务可用。本检查不代表真实模型验收。";
    if (command.command_type === "START_TURN") {
      const history = messages.get(command.pc_session_id) ?? [];
      for (const [role, content] of [["user", String(command.payload.prompt ?? "个人任务检查")], ["assistant", answer]]) {
        history.push({ role: role!, content: content!, message_id: `${command.command_id}:${role}`, sequence: history.length + 1, occurred_at: new Date().toISOString() });
      }
      messages.set(command.pc_session_id, history);
    }
    return { contract_name: "pc.runtime-command-result/1", contract_version: 1, command_id: command.command_id,
      accepted: true, committed: true, outcome_state: "KNOWN_SUCCESS", runtime_observation: { final_response: answer }, completed_at: new Date().toISOString() };
  } }, () => new Date(), profiles, resources);
  await registry.initialize();
  const ssts = new SstsDraftService(new MemorySstsDraftRepository(), profiles, resources, f.events, new DeterministicSstsDraftEngine()); await ssts.initialize();
  const dispatch = f.dispatch;
  dispatch.mockImplementation(async () => ({ provider_operation_id: "mvp-read-trace", result: { text: "synthetic confidential project data",
    functions: [{ function_code: "MVP-F1", function_name: "合成验证功能", name: "合成验证功能" }] }, external_evidence_refs: ["eea://traces/mvp-read-trace"] }));
  const gateway = new ControlledExecutionGatewayService(f.repository, f.identity, profiles, registry, resources, new EphemeralCredentialIssuer(),
    { dispatch, reconcile: async () => { throw new Error("No write in browser fixture"); } }, () => new Date(), gatewayEventPublisher(f.events, f.repository));
  const observation = () => ({ contract_name: "pc.provider-health/1", contract_version: 1, health_observation_id: "provider-health:mvp",
    provider_registration_id: "provider:eeclaw", configuration_revision: 1, provider_state: f.state.ready ? "HEALTHY" : "UNAVAILABLE", compatibility_status: "COMPATIBLE",
    port_health: {}, reason_codes: [], evidence_refs: [`provider-bundle:${f.state.generation}`], checked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() });
  const bundle = { active: () => f.state.ready ? { generation: f.state.generation, catalog: { connector: f.connector, tools: [browserTool] } } : undefined,
    descriptor: () => ({ contract_name: "pc.provider-bundle/1", contract_version: 1, provider_id: "provider:eeclaw", bundle_state: f.state.ready ? "READY" : "UNAVAILABLE",
      bundle_generation: f.state.generation, registration_revision: 1, catalog_revision: f.connector.capability_digest, observed_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() }), observation };
  const mvp = installAuthorizationMvp({ identity: f.identity, audit: f.repository, profiles, registry, bundle: bundle as never, issuer: f.key.issuer });
  let directoryCalls = 0;
  const workbench = new RuntimeWorkbench({ identity: f.identity, profiles, registry, resources, events: f.events, gateway, gatewayRepository: f.repository,
    runtimeUrl, tools: [browserTool], profileReleaseId: projectProfile.profile_release_id, reviewProfileReleaseId: projectProfile.profile_release_id,
    conversationProfileReleaseId: personalProfile.profile_release_id, connector: f.connector, workbenchProjection: new EeClawWorkbenchProjectionAdapter(),
    projectDirectory: { provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw", listProjects: async ({ principal }) => {
      directoryCalls++; return principal.principal_id === f.principal.principal_id ? [{ project_code: "MVP-A", project_name: "合成授权工程 A" }] : [];
    } },
    providerAvailability: { isUsable: () => f.state.ready, observation: observation as never },
    workspace: async (workspace_id, tenant_id, principal_id) => (await ssts.getWorkspace({ workspace_id, tenant_id, principal_id })).workspace });
  const api = buildApiServer({ identityAuthorization: f.identity, controlledGateway: gateway, profileCapability: profiles, resourceWorkspace: resources,
    runtimeRegistry: registry, eventProjection: f.events, sstsDraft: ssts, workbench, eeBundle: bundle as never, providerMode: "ee-connected" });
  const apiUrl = await api.listen({ host: "127.0.0.1", port: 0 });
  openServers.add(api.server);
  const requests: Array<{ method: string; path: string; status: number }> = [];
  const frontend = createServer((request, response) => { void (async () => {
    const url = new URL(request.url!, "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const headers: Record<string, string> = {};
      if (request.headers.authorization) headers.authorization = request.headers.authorization;
      if (request.headers["content-type"]) headers["content-type"] = request.headers["content-type"];
      const result = await fetch(`${apiUrl}${url.pathname.slice(4)}${url.search}`, { method: request.method!, headers,
        ...(chunks.length ? { body: Buffer.concat(chunks).toString() } : {}) });
      requests.push({ method: request.method!, path: url.pathname + url.search, status: result.status });
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const mime: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
    try { response.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" }).end(await readFile(join(root, "apps/web/dist", file))); }
    catch { response.writeHead(404).end(); }
  })().catch(() => { response.writeHead(500).end("Fixture proxy unavailable"); }); });
  const url = await listen(frontend);
  return { ...f, ...mvp, api, gateway, profiles, registry, ssts, url, requests, runtimeCalls, directoryCalls: () => directoryCalls,
    close: async () => { await api.close(); openServers.delete(api.server); await close(frontend); await close(runtime); await profiles.close(); await registry.close(); await resources.close(); await ssts.close(); } };
}
