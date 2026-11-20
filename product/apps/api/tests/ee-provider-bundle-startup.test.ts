import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { HttpEeClawAuthorizationAdapter } from "@pc/application";
import { EeProviderBundle } from "../src/ee-provider-bundle.js";

const baseEnvironment = {
  PC_LOGIN_MODE: "ee", PC_GATEWAY_STORE: "memory", PC_PILOT_TENANT_ID: "d4a-startup",
  EECLAW_ADAPTER_URL: "http://127.0.0.1:1", EECLAW_ADAPTER_SECRET: "d4a-synthetic-adapter-secret",
  EE_MCP_ADAPTER_URL: "http://127.0.0.1:1/mcp", EE_MCP_ADAPTER_SECRET: "d4a-synthetic-mcp-secret"
};

describe("D4A real local HTTP boundary (synthetic responses, not real EE acceptance)", () => {
  it.each([[401, "{}", "authentication"], [200, "not-json", "protocol"], [200, '{"ok":true,"data":{"contract_version":99}}', "compatibility"]])(
    "classifies compatibility HTTP %s without a generic 500 or business recovery", async (status, body, category) => {
      const http = createServer((_req, response) => { response.writeHead(Number(status)).end(body); });
      http.listen(0, "127.0.0.1");
      await once(http, "listening");
      try {
        const address = http.address();
        if (!address || typeof address === "string") throw new Error("Missing local address");
        const environment = { ...baseEnvironment, EECLAW_ADAPTER_URL: `http://127.0.0.1:${address.port}` };
        const bundle = new EeProviderBundle({ environment: () => environment, build: async config => {
          const adapter = new HttpEeClawAuthorizationAdapter({ baseUrl: config.authorization_url, sharedSecret: config.authorization_secret,
            resolveAccountId: async () => "1", resolvePermissionKey: () => "page:architecture" });
          await adapter.fetchCompatibility();
          throw new Error("Unexpected compatible response");
        } });
        await expect(bundle.reload()).rejects.toMatchObject({ code: `PC_PROVIDER_BUNDLE_${String(category).toUpperCase()}` });
        expect(bundle.descriptor().reason_codes).toEqual([`bundle_failure:${category}`]);
        expect(bundle.active()).toBeUndefined();
        await expect(bundle.reload()).rejects.toMatchObject({ code: "PC_PROVIDER_RETRY_BLOCKED" });
      } finally {
        http.closeAllConnections();
        await new Promise<void>(resolve => http.close(() => resolve()));
      }
    });
});

async function apiStartup(mode: "unreachable" | "partial" | "standalone") {
  const closedPort = createServer();
  closedPort.listen(0, "127.0.0.1");
  await once(closedPort, "listening");
  const address = closedPort.address();
  if (!address || typeof address === "string") throw new Error("Missing isolated probe port");
  const unreachable = `http://127.0.0.1:${address.port}`;
  await new Promise<void>(resolve => closedPort.close(() => resolve()));
  const root = await mkdtemp(join(tmpdir(), "pc-d4a-smoke-"));
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(PC_|EE_|EECLAW_|DATABASE_URL$|PORT$|HOST$)/u.test(key)));
  Object.assign(env, {
    PORT: "0", HOST: "127.0.0.1", PC_PILOT_TENANT_ID: "d4a-startup",
    PC_ENVELOPE_SIGNING_KEY: "d4a-isolated-smoke-signing-key-0000000000",
    PC_IDENTITY_STORE: "memory", PC_PROFILE_STORE: "memory", PC_RESOURCE_STORE: "memory",
    PC_RUNTIME_REGISTRY_STORE: "memory", PC_EVENT_STORE: "memory", PC_SSTS_STORE: "memory",
    PC_WORKBENCH_RUNTIME_URL: unreachable, PC_BLOB_ROOT: join(root, "blobs"), PC_MATERIALIZATION_ROOT: join(root, "workspaces"),
    ...(mode === "unreachable" ? { ...baseEnvironment, EECLAW_ADAPTER_URL: unreachable, EE_MCP_ADAPTER_URL: `${unreachable}/mcp` }
      : mode === "partial" ? { EECLAW_ADAPTER_URL: unreachable } : { PC_LOGIN_MODE: "local" })
  });
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, "src/main.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", data => { output += String(data); });
  child.stderr.on("data", data => { output += String(data); });
  try {
    // Verify a real refused loopback connection, not fetch's forbidden-port list.
    await expect(fetch(unreachable)).rejects.toMatchObject({ cause: { code: "ECONNREFUSED" } });
    let url: string | undefined;
    for (let index = 0; index < 200; index++) {
      url = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)?.[1];
      if (url) break;
      if (child.exitCode !== null) throw new Error(`Isolated API exited: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!url) throw new Error(`Isolated API startup timed out: ${output}`);
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    const health = await response.json() as { provider_bundle: { bundle_state: string; reason_codes: string[]; bundle_generation: string; registration_revision: number };
      provider_health: { configuration_revision: number }; capabilities: Record<string, string> };
    expect(health.provider_bundle.bundle_state).toBe(mode === "standalone" ? "UNCONFIGURED" : "UNAVAILABLE");
    expect(health.provider_bundle.reason_codes).toContain(mode === "unreachable" ? "bundle_failure:transport" : mode === "partial" ? "bundle_failure:configuration" : "bundle_unconfigured");
    expect(health.capabilities).toMatchObject({ core: "configured", personal_workbench: "available", project_workbench: "unavailable" });
    expect(health.provider_health.configuration_revision).toBe(health.provider_bundle.registration_revision);
    expect((await fetch(`${url}/ready`)).status).toBe(200);
    if (mode !== "standalone") {
      const retry = await fetch(`${url}/v1/providers/eeclaw/retry`, { method: "POST" });
      const body = await retry.json();
      if (mode === "partial") {
        expect(retry.status).toBe(400);
        expect(body).toMatchObject({ error: { code: "PC_PROVIDER_BUNDLE_CONFIGURATION", retryable: false } });
      } else {
        expect(retry.status).toBe(503);
        expect(body.error.code).toMatch(/^PC_PROVIDER_(BUNDLE_TRANSPORT|RETRY_BLOCKED)$/u);
        expect(body.error.retryable).toBe(true);
      }
      const after = await (await fetch(`${url}/health`)).json();
      expect(after.provider_bundle.bundle_state).toBe("UNAVAILABLE");
      expect(after.capabilities.project_workbench).toBe("unavailable");
    }
    return health;
  } finally {
    const stopped = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, "exit");
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await stopped;
    await rm(root, { recursive: true, force: true });
  }
}

describe("D4A real main.ts startup with isolated memory stores", () => {
  it("keeps PC Core alive when the actual EE port is unreachable and does not resurrect restart generations", async () => {
    const first = await apiStartup("unreachable");
    const restart = await apiStartup("unreachable");
    expect(restart.provider_bundle.bundle_generation).not.toBe(first.provider_bundle.bundle_generation);
  }, 30_000);
  it("keeps partial EE configuration local to the bundle", async () => { await apiStartup("partial"); }, 20_000);
  it("starts standalone PC Core with no EE configuration", async () => { await apiStartup("standalone"); }, 20_000);
});
