import { createServer, type IncomingHttpHeaders } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";
import {
  EeMcpCredentialIssuer, EeMcpGatewayProvider, mcpDigest,
  type GatewayProviderPort
} from "../src/index.js";

const SECRET = "protocol-test-service-secret";
const DIGEST = "a".repeat(64);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function fixture(legacy = false) {
  const state = {
    mode: "ok", calls: [] as IncomingHttpHeaders[], schemaVersion: 1, serverVersion: "test",
    unsafe: false, duplicate: false, status: 200, redirect: false, openStreams: 0, totalStreams: 0,
    started: () => {}, wait: Promise.resolve()
  };
  const http = createServer((req, res) => {
    void (async () => {
      if (state.redirect) {
        res.writeHead(307, { location: "http://127.0.0.1:1/stolen" }).end(); return;
      }
      if (req.headers.authorization !== `Bearer ${SECRET}` || state.status !== 200) {
        res.writeHead(state.status === 200 ? 401 : state.status).end(SECRET); return;
      }
      if (legacy && req.method === "GET") {
        state.openStreams++; state.totalStreams++;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": test stream\n\n");
        res.on("close", () => { state.openStreams--; });
        return;
      }
      const server = new McpServer({ name: "ee-process-copilot-adapter", version: state.serverVersion },
        legacy ? { supportedProtocolVersions: ["2025-11-25"] } : {});
      const metadata = {
        capability_id: "eea.functions.eea_list_functions", authority_contract: null,
        capability_version: "1", page_permission: "page:functions", project_scoped: true
      };
      server.registerTool("ee.list_functions", {
        inputSchema: z.strictObject(state.schemaVersion === 1 ? {} : { limit: z.number().optional() }),
        annotations: { readOnlyHint: !state.unsafe, destructiveHint: false,
          idempotentHint: true, openWorldHint: false },
        _meta: { eea: metadata }
      }, async () => {
        state.calls.push(req.headers);
        state.started();
        await state.wait;
        if (state.mode === "lost") res.destroy();
        if (state.mode === "error") return { isError: true, content: [{ type: "text", text: SECRET }] };
        const result = { ok: true, catalog_digest: state.mode === "stale" ? "b".repeat(64) : DIGEST,
          trace_id: "trace-test", root_trace_id: "trace-root", data: {
            value: state.mode === "leak" ? SECRET : "authorized-data"
          } };
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      });
      server.registerResource("catalog", "eea://catalog/read-tools", {}, () => ({
        contents: [{ uri: "eea://catalog/read-tools", text: JSON.stringify({
          catalog_digest: DIGEST,
          tools: Array.from({ length: state.duplicate ? 2 : 1 }, () => ({ name: "ee.list_functions", ...metadata }))
        }) }]
      }));
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
        enableJsonResponse: true });
      res.on("close", () => { void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    })().catch(() => { res.destroy(); });
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  cleanup.push(async () => { http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); });
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  const endpoint = `http://127.0.0.1:${address.port}/mcp`;
  const provider = new EeMcpGatewayProvider(endpoint, 2_000);
  return { state, endpoint, provider };
}

async function dispatchInput(context: Awaited<ReturnType<typeof fixture>>): Promise<Parameters<GatewayProviderPort["dispatch"]>[0]> {
  const catalog = await context.provider.discover(SECRET);
  const release = catalog.tools[0];
  if (!release) throw new Error("Missing release");
  return {
    operation_id: "operation-test", idempotency_key: "key-test", external_account_id: "17", principal_id: "principal-1",
    pc_session_id: "session-1", authorization_revision: 2, resource_scope_refs: ["project:EP37"],
    access_token: SECRET, arguments: {}, deadline: new Date(Date.now() + 30_000).toISOString(),
    tool: { ...release, contract_name: "pc.tool-release/1", contract_version: 1,
      status: "PUBLISHED", release_digest: mcpDigest(release) },
    connector: { connector_id: "connector-1", tenant_id: "tenant-1",
      mcp_server_id: catalog.server_id, endpoint_ref: context.endpoint,
      provider_key: "ee_mcp", auth_mode: "app_only", audience: catalog.server_id,
      allowed_scopes: ["page:functions"], tool_release_ids: [release.tool_release_id],
      state: "ACTIVE", registration_revision: 1, capability_digest: DIGEST,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    mcp_binding: { contract_name: "pc.mcp-session-binding/1", contract_version: 1,
      binding_id: "binding-1", tenant_id: "tenant-1", principal_id: "principal-1", pc_session_id: "session-1",
      connector_id: "connector-1", mcp_server_id: catalog.server_id, protocol_session_id: "isolated-per-call",
      authorization_revision: 2, credential_generation: 1, tool_catalog_digest: mcpDigest([release.tool_release_id]),
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), state: "ACTIVE" }
  };
}

describe("DEV-09A-3 official MCP SDK protocol integration", () => {
  it("closes legacy background SSE streams when a session finishes", async () => {
    const f = await fixture(true);
    const input = await dispatchInput(f);
    await f.provider.dispatch(input);
    expect(f.state.totalStreams).toBeGreaterThan(0);
    await expect.poll(() => f.state.openStreams, { timeout: 3_000, interval: 20 }).toBe(0);
  }, 10_000);

  it("discovers exact immutable schemas and changes release identity with schema changes", async () => {
    const f = await fixture();
    const first = await f.provider.discover(SECRET);
    expect(await f.provider.discover(SECRET)).toEqual(first);
    expect(first.tools[0]).toMatchObject({ provider_kind: "ee_mcp", input_schema: { additionalProperties: false },
      required_permissions: ["page:functions"], compatibility: { project_scoped: true } });
    f.state.schemaVersion = 2;
    expect((await f.provider.discover(SECRET)).tools[0]?.tool_release_id).not.toBe(first.tools[0]?.tool_release_id);
    f.state.unsafe = true;
    await expect(f.provider.discover(SECRET)).rejects.toMatchObject({ code: "PC_MCP_CATALOG_UNSAFE" });
    f.state.unsafe = false; f.state.duplicate = true;
    await expect(f.provider.discover(SECRET)).rejects.toMatchObject({ code: "PC_MCP_CATALOG_INVALID" });
  });

  it("constructs authoritative headers and isolates concurrent principals and sessions", async () => {
    const f = await fixture();
    const input = await dispatchInput(f);
    const second = { ...input, operation_id: "operation-2", principal_id: "principal-2",
      external_account_id: "18", pc_session_id: "session-2", resource_scope_refs: ["project:EP38"],
      mcp_binding: { ...input.mcp_binding, principal_id: "principal-2", pc_session_id: "session-2" } };
    const results = await Promise.all([f.provider.dispatch(input), f.provider.dispatch(second)]);
    expect(results.every((r) => r.external_evidence_refs.includes("eea://traces/trace-test"))).toBe(true);
    expect(f.state.calls).toHaveLength(2);
    expect(f.state.calls.find((h) => h["x-pc-principal-id"] === "principal-1")).toMatchObject({
      "x-ee-account-id": "17", "x-pc-session-id": "session-1", "x-ee-project-code": "EP37",
      "x-pc-request-id": "operation-test", authorization: `Bearer ${SECRET}`,
      "x-pc-deadline-at-ms": String(Date.parse(input.deadline))
    });
    expect(f.state.calls.find((h) => h["x-pc-principal-id"] === "principal-2")).toMatchObject({
      "x-ee-account-id": "18", "x-pc-session-id": "session-2", "x-ee-project-code": "EP38"
    });
  });

  it("fails closed before dispatch for mixed identities and untrusted project selection", async () => {
    const f = await fixture();
    const input = await dispatchInput(f);
    for (const patch of [{ external_account_id: "0" }, { principal_id: "other" },
      { pc_session_id: "other" }, { authorization_revision: 3 }]) {
      await expect(f.provider.dispatch({ ...input, ...patch })).rejects.toMatchObject({ code: "PC_MCP_CONTEXT_MISMATCH", outcome_unknown: false });
    }
    for (const scopes of [[], ["project:EP37", "project:EP38"], ["project:../EP37"]]) {
      await expect(f.provider.dispatch({ ...input, resource_scope_refs: scopes })).rejects.toMatchObject({ code: "PC_MCP_PROJECT_SCOPE_DENIED" });
    }
    await expect(f.provider.dispatch({ ...input, arguments: { project_code: "EP38" } })).rejects.toMatchObject({ code: "PC_MCP_PROJECT_SCOPE_DENIED" });
    f.state.serverVersion = "changed";
    await expect(f.provider.dispatch(input)).rejects.toMatchObject({ code: "PC_MCP_SERVER_MISMATCH", outcome_unknown: false });
    expect(f.state.calls).toHaveLength(0);
    const issuer = new EeMcpCredentialIssuer(f.endpoint, SECRET);
    await expect(issuer.issue({ connector: input.connector, account: {
      external_account_binding_id: "account", tenant_id: "tenant-1", principal_id: "principal-1",
      connector_id: "wrong", external_account_id: "17", credential_subject: "service",
      secret_ref: "config:EE_MCP_ADAPTER_SECRET", status: "ACTIVE", credential_generation: 1,
      created_at: "", updated_at: ""
    }, scopes: [], expires_at: input.deadline })).rejects.toMatchObject({ code: "PC_MCP_CREDENTIAL_SCOPE_DENIED" });
  });

  it("sanitizes tool errors, protocol failures, stale output and accidental secret output", async () => {
    const f = await fixture();
    const input = await dispatchInput(f);
    for (const [mode, code, unknown] of [
      ["error", "PC_MCP_TOOL_REJECTED", false], ["lost", "PC_MCP_TRANSPORT_FAILED", true],
      ["stale", "PC_MCP_INVALID_RESPONSE", true], ["leak", "PC_MCP_SECRET_IN_RESPONSE", true]
    ] as const) {
      f.state.mode = mode;
      const error = await f.provider.dispatch(input).catch((e: unknown) => e);
      expect(error).toMatchObject({ code, outcome_unknown: unknown });
      expect(String(error)).not.toContain(SECRET);
    }
    await expect(f.provider.dispatch({ ...input, tool: { ...input.tool,
      compatibility: { ...input.tool.compatibility, mcp_tool_name: "ee.missing" }
    } })).rejects.toMatchObject({ code: "PC_MCP_PROTOCOL_FAILED", outcome_unknown: false });
  });

  it("classifies HTTP rejection and refuses redirects", async () => {
    const f = await fixture();
    const input = await dispatchInput(f);
    f.state.status = 403;
    await expect(f.provider.dispatch(input)).rejects.toMatchObject({ code: "PC_MCP_HTTP_DENIED", outcome_unknown: false });
    f.state.status = 503;
    await expect(f.provider.dispatch(input)).rejects.toMatchObject({ code: "PC_MCP_HTTP_FAILED", outcome_unknown: false });
    f.state.status = 200; f.state.redirect = true;
    await expect(f.provider.dispatch(input)).rejects.toMatchObject({ outcome_unknown: false });
    expect(f.state.calls).toHaveLength(0);
  });

  it("keeps timeout and cancellation after dispatch unknown, and pre-cancellation not started", async () => {
    const f = await fixture();
    const input = await dispatchInput(f);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(f.provider.dispatch({ ...input, signal: cancelled.signal })).rejects.toMatchObject({ code: "PC_MCP_CANCELLED", outcome_unknown: false });
    let release = () => {};
    f.state.wait = new Promise<void>((resolve) => { release = resolve; });
    try {
      const short = new EeMcpGatewayProvider(f.endpoint, 200);
      await expect(short.dispatch(input)).rejects.toMatchObject({ code: "PC_MCP_TIMEOUT", outcome_unknown: true });
      const abort = new AbortController();
      const started = new Promise<void>((resolve) => { f.state.started = resolve; });
      const pending = f.provider.dispatch({ ...input, signal: abort.signal });
      const assertion = expect(pending).rejects.toMatchObject({ code: "PC_MCP_CANCELLED", outcome_unknown: true });
      await started; abort.abort(); await assertion;
    } finally { release(); }
  });
});
