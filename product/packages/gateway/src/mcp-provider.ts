import { createHash } from "node:crypto";
import {
  Client, ProtocolError, SdkError, SdkErrorCode, SdkHttpError,
  StreamableHTTPClientTransport
} from "@modelcontextprotocol/client";
import type { ToolRelease } from "@pc/domain";
import type {
  ConnectorRegistration, CredentialIssuerPort, GatewayProviderPort
} from "./types.js";
import { GatewayProviderError } from "./types.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function mcpDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayProviderError("PC_MCP_INVALID_RESPONSE", "Invalid MCP response", false);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value || /[\r\n]/u.test(value)) {
    throw new GatewayProviderError("PC_MCP_INVALID_CONTEXT", "Invalid MCP context", false);
  }
  return value;
}

function failure(error: unknown, dispatched: boolean, signal?: AbortSignal): GatewayProviderError {
  if (error instanceof GatewayProviderError) return error;
  const timeout = error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout;
  const denied = error instanceof SdkHttpError && [401, 403].includes(error.status);
  const invalidRequest = error instanceof ProtocolError && [-32600, -32601, -32602].includes(error.code);
  const code = signal?.aborted ? "PC_MCP_CANCELLED" : timeout ? "PC_MCP_TIMEOUT"
    : denied ? "PC_MCP_HTTP_DENIED" : error instanceof SdkHttpError ? "PC_MCP_HTTP_FAILED"
      : error instanceof ProtocolError ? "PC_MCP_PROTOCOL_FAILED"
        : "PC_MCP_TRANSPORT_FAILED";
  return new GatewayProviderError(code, "MCP request failed",
    dispatched && !denied && !invalidRequest, !dispatched && !denied && !invalidRequest);
}

export interface EeMcpCatalog {
  server_id: string;
  catalog_digest: string;
  tools: Array<Omit<ToolRelease, "contract_name" | "contract_version" | "status" | "release_digest">>;
}

export class EeMcpCredentialIssuer implements CredentialIssuerPort {
  constructor(private readonly endpoint: string, private readonly secret: string) {
    text(secret);
  }

  async issue(input: Parameters<CredentialIssuerPort["issue"]>[0]): ReturnType<CredentialIssuerPort["issue"]> {
    if (input.connector.provider_key !== "ee_mcp"
      || input.connector.endpoint_ref !== this.endpoint
      || input.account.connector_id !== input.connector.connector_id
      || input.account.tenant_id !== input.connector.tenant_id
      || input.account.credential_subject !== "service:ee-mcp-adapter"
      || input.scopes.some((scope) => !input.connector.allowed_scopes.includes(scope))
      || input.account.secret_ref !== "config:EE_MCP_ADAPTER_SECRET"
      || input.account.status !== "ACTIVE"
      || !Number.isFinite(Date.parse(input.expires_at))
      || Date.parse(input.expires_at) <= Date.now()) {
      throw new GatewayProviderError("PC_MCP_CREDENTIAL_SCOPE_DENIED", "Credential scope denied", false);
    }
    return {
      access_token: this.secret,
      credential_subject: input.account.credential_subject,
      binding_mode: "bearer"
    };
  }
}

export class EeMcpGatewayProvider implements GatewayProviderPort {
  private readonly endpoint: URL;

  constructor(endpoint: string, private readonly timeoutMs = 30_000) {
    this.endpoint = new URL(endpoint);
    if (!["http:", "https:"].includes(this.endpoint.protocol)
      || this.endpoint.username || this.endpoint.password
      || this.endpoint.search || this.endpoint.hash
      || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Invalid EE MCP endpoint or timeout");
    }
  }

  private async session<T>(
    headers: Record<string, string>, deadline: string, signal: AbortSignal | undefined,
    run: (client: Client, signal: AbortSignal, timeout: number) => Promise<T>
  ): Promise<T> {
    const remaining = Math.min(Date.parse(deadline) - Date.now(), this.timeoutMs);
    if (!Number.isFinite(remaining) || remaining <= 0 || signal?.aborted) {
      throw new GatewayProviderError(
        signal?.aborted ? "PC_MCP_CANCELLED" : "PC_MCP_TIMEOUT", "MCP request not started", false);
    }
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, remaining);
    const client = new Client({ name: "process-copilot-gateway", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      requestInit: { headers, redirect: "error", signal: abort.signal },
      fetch: (url, init) => {
        const target = new URL(url instanceof Request ? url.url : String(url));
        if (target.origin !== this.endpoint.origin || target.pathname !== this.endpoint.pathname) {
          throw new GatewayProviderError("PC_MCP_ENDPOINT_DENIED", "Unexpected MCP endpoint", false);
        }
        return fetch(url, { ...init, redirect: "error", signal: init?.signal
          ? AbortSignal.any([init.signal, abort.signal]) : abort.signal });
      }
    });
    try {
      await client.connect(transport, { signal: abort.signal, timeout: remaining });
      return await run(client, abort.signal, remaining);
    } catch (error) {
      if (timedOut && !signal?.aborted) {
        throw new SdkError(SdkErrorCode.RequestTimeout, "MCP request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      abort.abort();
      await client.close().catch(() => undefined);
    }
  }

  async discover(accessToken: string): Promise<EeMcpCatalog> {
    try {
      return await this.session({ Authorization: `Bearer ${text(accessToken)}` },
        new Date(Date.now() + this.timeoutMs).toISOString(), undefined, async (client, signal, timeout) => {
          const server = client.getServerVersion();
          if (server?.name !== "ee-process-copilot-adapter") {
            throw new GatewayProviderError("PC_MCP_SERVER_MISMATCH", "Unexpected MCP server", false);
          }
          const listing = await client.listTools({}, { signal, timeout });
          if (listing.nextCursor !== undefined) {
            throw new GatewayProviderError("PC_MCP_CATALOG_INCOMPLETE", "Incomplete MCP catalog", false);
          }
          const resource = await client.readResource({ uri: "eea://catalog/read-tools" }, { signal, timeout });
          const content = resource.contents[0];
          if (resource.contents.length !== 1 || content === undefined || !("text" in content)
            || content.uri !== "eea://catalog/read-tools") {
            throw new GatewayProviderError("PC_MCP_CATALOG_INVALID", "Invalid MCP catalog", false);
          }
          const projection = record(JSON.parse(content.text));
          const catalogDigest = text(projection.catalog_digest);
          if (!/^[a-f0-9]{64}$/u.test(catalogDigest) || !Array.isArray(projection.tools)
            || listing.tools.length === 0 || listing.tools.length !== projection.tools.length
            || new Set(listing.tools.map((tool) => tool.name)).size !== listing.tools.length) {
            throw new GatewayProviderError("PC_MCP_CATALOG_INVALID", "Invalid MCP catalog", false);
          }
          const metadata = new Map(projection.tools.map((item) => {
            const entry = record(item);
            return [text(entry.name), entry];
          }));
          if (metadata.size !== listing.tools.length) {
            throw new GatewayProviderError("PC_MCP_CATALOG_INVALID", "Duplicate MCP metadata", false);
          }
          const tools: EeMcpCatalog["tools"] = listing.tools.map((tool) => {
            const entry = metadata.get(tool.name);
            const eea = record(tool._meta?.eea);
            const write = tool.name === "ee.submit_ssts_review" && entry?.operation === "write"
              && entry.approval_policy === "EXACT_ARGUMENTS" && entry.recovery_class === "RECONCILE_BEFORE_RETRY"
              && entry.capability_id === "eea.architecture.eea_pc_submit_ssts_review";
            if (entry === undefined || canonical(entry) !== canonical({ name: tool.name, ...eea })
              || tool.annotations?.readOnlyHint !== !write || tool.annotations.destructiveHint !== false
              || tool.annotations.idempotentHint !== !write || tool.annotations.openWorldHint !== false
              || (!write && entry.operation !== undefined && entry.operation !== "read")
              || typeof entry.project_scoped !== "boolean"
              || typeof entry.capability_version !== "string" || !entry.capability_version
              || !(typeof entry.capability_id === "string" && entry.capability_id.length > 0
                && entry.authority_contract === null
                || entry.capability_id === null && entry.authority_contract === "eeclaw.accessible-projects/1")
              || tool.inputSchema.additionalProperties !== false
              || Object.hasOwn(tool.inputSchema.properties ?? {}, "project_code")
              || !/^page:[a-z0-9_-]+$/u.test(text(entry.page_permission))) {
              throw new GatewayProviderError("PC_MCP_CATALOG_UNSAFE", "Unverified MCP read tool", false);
            }
            const schemaDigest = mcpDigest({ input: tool.inputSchema, output: tool.outputSchema ?? {} });
            const releaseKey = mcpDigest({ endpoint: this.endpoint.href, server, catalogDigest, tool });
            return {
              tool_release_id: `tool:ee_mcp:${releaseKey.slice(7)}`,
              tool_definition_id: tool.name,
              version: 1,
              provider_kind: "ee_mcp",
              input_schema: structuredClone(tool.inputSchema),
              output_schema: structuredClone(tool.outputSchema ?? {}),
              schema_digest: schemaDigest,
              risk_manifest: { action_class: write ? "WRITE" : "READ", sensitivity: write ? "MEDIUM" : "LOW", requires_readback: write },
              required_permissions: write ? ["ee.ssts.review.request"] : [text(entry.page_permission)],
              approval_policy: write ? "EXPLICIT" : "NONE",
              idempotency_class: "IDEMPOTENT",
              recovery_class: write ? "RECONCILE_BEFORE_RETRY" : "REPLAY_SAFE",
              compatibility: { mcp_tool_name: tool.name, project_scoped: entry.project_scoped,
                display_name: typeof entry.display_name === "string" ? entry.display_name : tool.name,
                domain: typeof entry.domain === "string" ? entry.domain : "other",
                description: tool.description ?? tool.name,
                catalog_digest: catalogDigest, server_name: server.name, server_version: server.version },
              artifact_refs: [`eea://catalog/read-tools#${catalogDigest}`, schemaDigest]
            };
          });
          return { server_id: server.name, catalog_digest: catalogDigest, tools };
        });
    } catch (error) {
      throw failure(error, false);
    }
  }

  async dispatch(input: Parameters<GatewayProviderPort["dispatch"]>[0]): ReturnType<GatewayProviderPort["dispatch"]> {
    let dispatched = false;
    try {
      if (input.connector.endpoint_ref !== this.endpoint.href || input.connector.provider_key !== "ee_mcp"
        || input.tool.provider_kind !== "ee_mcp"
        || !["READ", "WRITE"].includes(String(input.tool.risk_manifest.action_class))
        || (input.tool.risk_manifest.action_class === "WRITE" && (!input.approval_id
          || input.tool.compatibility.mcp_tool_name !== "ee.submit_ssts_review"))
        || !input.connector.tool_release_ids.includes(input.tool.tool_release_id)
        || input.connector.state !== "ACTIVE" || input.mcp_binding.state !== "ACTIVE"
        || input.mcp_binding.tenant_id !== input.connector.tenant_id
        || input.mcp_binding.mcp_server_id !== input.connector.mcp_server_id
        || input.mcp_binding.tool_catalog_digest !== mcpDigest([...input.connector.tool_release_ids].sort())
        || input.mcp_binding.principal_id !== input.principal_id
        || input.mcp_binding.pc_session_id !== input.pc_session_id
        || input.mcp_binding.connector_id !== input.connector.connector_id
        || input.mcp_binding.authorization_revision !== input.authorization_revision
        || !/^[1-9][0-9]*$/u.test(input.external_account_id)) {
        throw new GatewayProviderError("PC_MCP_CONTEXT_MISMATCH", "MCP security context mismatch", false);
      }
      const projects = input.resource_scope_refs.filter((scope) => scope.startsWith("project:"));
      const projectRequired = input.tool.compatibility.project_scoped;
      if (typeof projectRequired !== "boolean" || projects.length > 1
        || (projectRequired && projects.length !== 1)
        || projects.some((scope) => !/^project:[A-Za-z0-9_-]+$/u.test(scope))
        || Object.hasOwn(input.arguments, "project_code")) {
        throw new GatewayProviderError("PC_MCP_PROJECT_SCOPE_DENIED", "Invalid MCP project scope", false);
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${text(input.access_token)}`,
        "X-EE-Account-Id": input.external_account_id,
        "X-PC-Principal-Id": text(input.principal_id),
        "X-PC-Session-Id": text(input.pc_session_id),
        "X-PC-Request-Id": text(input.operation_id),
        "X-PC-Deadline-At-Ms": String(Date.parse(input.deadline))
      };
      if (projects[0] !== undefined) headers["X-EE-Project-Code"] = projects[0].slice(8);
      if (input.approval_id) {
        headers["X-PC-Write-Approved"] = "1";
        headers["X-PC-Approval-Id"] = text(input.approval_id);
      }
      return await this.session(headers, input.deadline, input.signal, async (client, signal, timeout) => {
        const server = client.getServerVersion();
        if (server?.name !== input.connector.mcp_server_id
          || server.version !== input.tool.compatibility.server_version) {
          throw new GatewayProviderError("PC_MCP_SERVER_MISMATCH", "Unexpected MCP server", false);
        }
        dispatched = true;
        const response = await client.callTool({ name: text(input.tool.compatibility.mcp_tool_name),
          arguments: input.arguments }, { signal, timeout });
        if (response.isError) {
          throw new GatewayProviderError("PC_MCP_TOOL_REJECTED", "EE rejected the MCP tool call",
            input.tool.risk_manifest.action_class === "WRITE");
        }
        if (response.structuredContent === undefined) {
          throw new GatewayProviderError("PC_MCP_INVALID_RESPONSE", "Missing EE tool result", true);
        }
        const payload = record(response.structuredContent);
        if (payload.ok !== true || payload.catalog_digest !== input.tool.compatibility.catalog_digest
          || typeof payload.trace_id !== "string" || !payload.trace_id
          || typeof payload.root_trace_id !== "string" || !payload.root_trace_id) {
          throw new GatewayProviderError("PC_MCP_INVALID_RESPONSE", "Invalid EE tool result", true);
        }
        const result = structuredClone(payload);
        const externalEvidence = [`eea://traces/${encodeURIComponent(payload.trace_id)}`,
          `eea://traces/${encodeURIComponent(payload.root_trace_id)}`];
        if (input.tool.risk_manifest.action_class === "WRITE") {
          const readback = await client.callTool({ name: "ee.get_ssts", arguments: { ssts_code: input.arguments.ssts_code } }, { signal, timeout });
          const observed = record(readback.structuredContent);
          if (readback.isError || observed.ok !== true || !observed.trace_id) {
            throw new GatewayProviderError("PC_MCP_READBACK_REQUIRED", "Owner write requires independent readback", true);
          }
          result.readback = observed;
          externalEvidence.push(`eea://traces/${encodeURIComponent(String(observed.trace_id))}`);
        }
        if (JSON.stringify(result).includes(input.access_token)) {
          throw new GatewayProviderError("PC_MCP_SECRET_IN_RESPONSE", "Unsafe MCP response", true);
        }
        return { provider_operation_id: payload.trace_id, result,
          external_evidence_refs: externalEvidence };
      });
    } catch (error) {
      throw failure(error, dispatched, input.signal);
    }
  }

  async reconcile(input: Parameters<GatewayProviderPort["reconcile"]>[0]): ReturnType<GatewayProviderPort["reconcile"]> {
    const unknown = { outcome: "OUTCOME_UNKNOWN" as const, evidence_refs: [] as string[] };
    const { operation } = input;
    const project = operation.resource_scope_refs?.filter((scope) => /^project:[A-Za-z0-9_-]+$/u.test(scope));
    if (!input.access_token || !input.external_account_id || operation.operation_kind !== "WRITE"
      || input.connector.endpoint_ref !== this.endpoint.href || project?.length !== 1 || !operation.arguments?.ssts_code) return unknown;
    try {
      return await this.session({ Authorization: `Bearer ${text(input.access_token)}`,
        "X-EE-Account-Id": text(input.external_account_id), "X-PC-Principal-Id": operation.principal_id,
        "X-PC-Session-Id": operation.pc_session_id, "X-EE-Project-Code": project[0]!.slice(8),
        "X-PC-Request-Id": `reconcile-${operation.operation_id}` }, new Date(Date.now() + this.timeoutMs).toISOString(), undefined,
      async (client, signal, timeout) => {
        const resource = await client.readResource({ uri: `eea://operations/${operation.operation_id}` }, { signal, timeout });
        const content = resource.contents[0];
        if (!content || !("text" in content)) return unknown;
        const receipt = record(JSON.parse(content.text));
        if (receipt.status !== "success" || typeof receipt.trace_id !== "string") return unknown;
        const readback = await client.callTool({ name: "ee.get_ssts", arguments: { ssts_code: operation.arguments!.ssts_code } }, { signal, timeout });
        const observed = record(readback.structuredContent);
        if (readback.isError || observed.ok !== true || typeof observed.trace_id !== "string") return unknown;
        return { outcome: "KNOWN_SUCCESS" as const, provider_operation_id: receipt.trace_id,
          result: { receipt, readback: observed }, evidence_refs: [`eea://traces/${receipt.trace_id}`, `eea://traces/${observed.trace_id}`] };
      });
    } catch { return unknown; }
  }
}

export async function synchronizeEeMcpCatalog(input: {
  provider: EeMcpGatewayProvider;
  access_token: string;
  tenant_id: string;
  endpoint: string;
  profiles: { publishToolRelease(tool: EeMcpCatalog["tools"][number]): Promise<ToolRelease> };
  gateway: { registerConnector(
    registration: Omit<ConnectorRegistration, "connector_id" | "state" | "registration_revision" | "created_at" | "updated_at">,
    options: { registration_key: string }
  ): Promise<ConnectorRegistration> };
}): Promise<{ connector: ConnectorRegistration; tools: ToolRelease[] }> {
  const catalog = await input.provider.discover(input.access_token);
  const tools = [];
  for (const tool of catalog.tools) tools.push(await input.profiles.publishToolRelease(tool));
  const connector = await input.gateway.registerConnector({
    tenant_id: input.tenant_id, mcp_server_id: catalog.server_id,
    endpoint_ref: new URL(input.endpoint).href, provider_key: "ee_mcp", auth_mode: "app_only",
    audience: catalog.server_id,
    allowed_scopes: [...new Set(tools.flatMap((tool) => [...tool.required_permissions]))].sort(),
    tool_release_ids: tools.map((tool) => tool.tool_release_id).sort(),
    capability_digest: catalog.catalog_digest
  }, { registration_key: "ee_mcp_catalog" });
  return { connector, tools };
}
