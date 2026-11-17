import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { writeFile } from "node:fs/promises";
import { EeMcpGatewayProvider, mcpDigest, type GatewayProviderPort } from "../packages/gateway/src/index.js";

const secret = process.env.EE_MCP_ADAPTER_SECRET!;
assert(secret);
let mode = "normal", realCalls = 0;
const observed: string[] = [];
const proxy = createServer((request, response) => {
  void (async () => {
    const closed = new AbortController();
    response.on("close", () => closed.abort());
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const content = Buffer.concat(chunks);
    const input = content.length ? JSON.parse(content.toString()) : {};
    const headers = Object.fromEntries(Object.entries(request.headers)
      .filter(([key]) => !["host", "connection", "content-length"].includes(key))
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value ?? ""]));
    const upstream = await fetch("http://ee-mcp-adapter:5011/mcp", { method: request.method, headers,
      ...(content.length ? { body: content } : {}), redirect: "error", signal: AbortSignal.any([closed.signal, AbortSignal.timeout(10_000)]) });
    response.writeHead(upstream.status, Object.fromEntries([...upstream.headers]
      .filter(([key]) => !["content-length", "content-encoding", "transfer-encoding", "connection"].includes(key))));
    if (request.method === "GET" && upstream.body) {
      const stream = Readable.fromWeb(upstream.body as never);
      stream.on("error", () => response.destroy());
      stream.pipe(response); return;
    }
    let text = await upstream.text();
    if (input.method === "tools/call") {
      realCalls++;
      const alter = (payload: { result?: { structuredContent?: {
        ok?: boolean; trace_id?: string; catalog_digest?: string; data?: unknown;
      } } }) => {
        assert(payload.result?.structuredContent?.ok === true, "fault injection must follow a successful real EE/MySQL call");
        assert(typeof payload.result.structuredContent.trace_id === "string");
        observed.push(payload.result.structuredContent.trace_id);
        if (mode === "missing") delete payload.result.structuredContent;
        if (mode === "stale") payload.result.structuredContent.catalog_digest = "0".repeat(64);
        if (mode === "secret") payload.result.structuredContent.data = { injected_secret: secret };
        return payload;
      };
      if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
        text = text.split("\n").map(line => line.startsWith("data: ")
          ? `data: ${JSON.stringify(alter(JSON.parse(line.slice(6))))}` : line).join("\n");
      } else text = JSON.stringify(alter(JSON.parse(text)));
      if (mode === "timeout") await new Promise(resolve => setTimeout(resolve, 2000));
    }
    response.end(text);
  })().catch(() => response.destroy());
});
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const address = proxy.address();
assert(address && typeof address !== "string");
const endpoint = `http://127.0.0.1:${address.port}/mcp`;
const provider = new EeMcpGatewayProvider(endpoint, 5000);
const results: unknown[] = [];
try {
  const catalog = await provider.discover(secret);
  const release = catalog.tools.find(tool => tool.tool_definition_id === "ee.get_project_context")!;
  assert(release);
  const id = randomUUID();
  const input: Parameters<GatewayProviderPort["dispatch"]>[0] = {
    operation_id: `minimum-fault-${id}`, idempotency_key: id, external_account_id: "1",
    principal_id: "f2bd0a0d-fbf3-4a02-8c55-d8705801798c", pc_session_id: `minimum-fault-${id}`,
    authorization_revision: 1, resource_scope_refs: ["project:EP37"], access_token: secret, arguments: {},
    deadline: new Date(Date.now() + 60_000).toISOString(),
    tool: { ...release, contract_name: "pc.tool-release/1", contract_version: 1, status: "PUBLISHED", release_digest: mcpDigest(release) },
    connector: { connector_id: id, tenant_id: "tenant_acceptance", mcp_server_id: catalog.server_id, endpoint_ref: endpoint,
      provider_key: "ee_mcp", auth_mode: "app_only", audience: catalog.server_id, allowed_scopes: [...release.required_permissions],
      tool_release_ids: [release.tool_release_id], state: "ACTIVE", registration_revision: 1, capability_digest: catalog.catalog_digest,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    mcp_binding: { contract_name: "pc.mcp-session-binding/1", contract_version: 1, binding_id: id,
      tenant_id: "tenant_acceptance", principal_id: "f2bd0a0d-fbf3-4a02-8c55-d8705801798c", pc_session_id: `minimum-fault-${id}`,
      connector_id: id, mcp_server_id: catalog.server_id, protocol_session_id: "isolated-per-call", authorization_revision: 1,
      credential_generation: 1, tool_catalog_digest: mcpDigest([release.tool_release_id]),
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), state: "ACTIVE" }
  };
  await provider.dispatch(input);
  for (const [fault, expected] of [["missing", "PC_MCP_INVALID_RESPONSE"], ["stale", "PC_MCP_INVALID_RESPONSE"],
    ["secret", "PC_MCP_SECRET_IN_RESPONSE"], ["timeout", "PC_MCP_TIMEOUT"]]) {
    mode = fault;
    const tested = fault === "timeout" ? new EeMcpGatewayProvider(endpoint, 1000) : provider;
    let caught: unknown;
    try { await tested.dispatch({ ...input, operation_id: `minimum-fault-${randomUUID()}` }); }
    catch (error) { caught = error; }
    assert(caught instanceof Error && "code" in caught && "outcome_unknown" in caught);
    assert.equal(caught.code, expected);
    assert(!String(caught).includes(secret));
    results.push({ fault, expected, actual: caught.code, outcome_unknown: caught.outcome_unknown });
  }
  assert.equal(realCalls, 5); assert.equal(observed.length, 5);
  await writeFile("/tmp/minimum-mcp-faults.json", JSON.stringify({ status: "PASS", cases: ["MCP-008", "MCP-009", "MCP-012"],
    scope: "Provider/official SDK -> test-only response transformer -> real EE MCP -> real EE/MySQL; no backend or browser dependency replaced",
    real_calls: realCalls, traces: observed.map(trace => `eea://traces/${trace}`), results }, null, 2));
  console.log("Real EE/MySQL provider malformed-result, stale-output, secret and timeout faults PASS");
} finally {
  proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve()));
}
