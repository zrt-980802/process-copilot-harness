import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = "http://127.0.0.1:18891";
const root = path.resolve(import.meta.dirname, "../..");
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const output = path.join(root, "reports/rci-03-real-ee-adversarial-01", `a1-${stamp}`);
await mkdir(output, { recursive: true });
const evidence = { status: "FAIL", scenario_id: "A1-current-generation-cross-principal",
  started_at: new Date().toISOString(), checks: [] };
const secrets = Object.entries(process.env)
  .filter(([key, value]) => /PASSWORD|SECRET|API_KEY|SIGNING_KEY/u.test(key) && value?.length > 8)
  .map(([, value]) => value);

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function query(sql) {
  const result = spawnSync("docker", ["exec", "pc-real-ee-read-retest-01-pc-postgres-1",
    "psql", "-U", "pc", "-d", "pc", "-At", "-c", sql], { encoding: "utf8" });
  assert.equal(result.status, 0, "Isolated PostgreSQL query failed");
  return result.stdout.trim();
}
function operationIds() {
  return new Set(query("SELECT operation_id FROM pc_gateway_operation ORDER BY operation_id").split(/\r?\n/u).filter(Boolean));
}
async function request(route, token, body) {
  const response = await fetch(base + "/api" + route, { method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(200_000) });
  return { status: response.status, value: await response.json() };
}
async function login(account) {
  const headers = { "content-type": "application/json" };
  const response = await fetch(base + "/api/ee-auth/login", { method: "POST", headers,
    body: JSON.stringify({ username: `rc.${account}`, password: process.env[`RC_${account.toUpperCase()}_PASSWORD`] }) });
  assert.equal(response.status, 200, `${account} EE login failed`);
  const value = await response.json();
  headers.cookie = response.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
  headers["x-csrf-token"] = value.data.csrf_token;
  const verifier = randomBytes(32).toString("base64url");
  const launch = await fetch(base + "/api/ee-auth/process-copilot/launch", { method: "POST", headers,
    body: JSON.stringify({ audience: "process-copilot",
      code_challenge: createHash("sha256").update(verifier).digest("base64url") }) });
  assert.equal(launch.status, 200, `${account} ticket failed`);
  const exchange = await request("/v1/auth/ee/exchange", undefined,
    { ticket: (await launch.json()).data.ticket, code_verifier: verifier });
  assert.equal(exchange.status, 200, `${account} PC exchange failed`);
  return exchange.value.access_token;
}
async function save() {
  let text = JSON.stringify({ ...evidence, completed_at: new Date().toISOString() }, null, 2);
  for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
  await writeFile(path.join(output, "result.json"), text, { flag: "wx" });
}

try {
  const admin = await login("admin");
  const retry = await request("/v1/providers/eeclaw/retry", admin, {});
  assert.equal(retry.status, 200, "Provider retry failed");
  const engineer = await login("engineer");
  const reviewer = await login("reviewer");
  const healthBefore = await request("/health");
  assert.equal(healthBefore.status, 200);
  const generation = healthBefore.value.provider_bundle?.bundle_generation;
  assert.equal(typeof generation, "string", "Current Provider generation unavailable");
  const catalog = await request("/v1/workbench/catalog?project_code=RCI-FULLA", engineer);
  assert.equal(catalog.status, 200, "Current Catalog unavailable");
  const tool = catalog.value.tools.find(entry => entry.tool_definition_id === "ee.list_functions");
  assert(tool?.tool_release_id, "ee.list_functions unavailable");
  const workspace = await request("/v1/workbench/tasks", engineer,
    { title: `RCI-03 A1 ${stamp}`, project_code: "RCI-FULLA", mode: "READ" });
  assert.equal(workspace.status, 201, "Current-generation task creation failed");
  const before = operationIds();
  const toolResult = await request(`/v1/workbench/tasks/${workspace.value.workspace_id}/tools`, engineer,
    { tool_release_id: tool.tool_release_id, arguments: { limit: 100 }, call_id: randomUUID() });
  assert.equal(toolResult.status, 200, "Real EE READ failed");
  assert.equal(toolResult.value.isError, false, "Real EE READ returned an MCP error");
  const afterDispatch = operationIds();
  const created = [...afterDispatch].filter(operationId => !before.has(operationId));
  assert.equal(created.length, 1, `Expected one new Gateway operation, found ${created.length}`);
  const operationId = created[0];
  assert.match(operationId, /^tool_[0-9a-f]{64}$/u);
  const dispatchCount = afterDispatch.size;
  const owner = await request(`/v1/operations/${operationId}`, engineer);
  assert.equal(owner.status, 200, "Current owner could not read the current-generation result");
  const auditBefore = Number(query(`SELECT count(*) FROM pc_gateway_audit WHERE operation_id='${operationId}'`));
  const denied = await request(`/v1/operations/${operationId}`, reviewer);
  assert.equal(denied.status, 403, "Cross-principal result access was not denied");
  assert(["PC_GATEWAY_OPERATION_SCOPE_DENIED", "PC_GATEWAY_RESULT_DELIVERY_DENIED"].includes(denied.value.error?.code),
    "Cross-principal denial returned an unexpected error code");
  assert.equal("result" in denied.value || "structuredContent" in denied.value, false,
    "Cross-principal denial exposed a business result field");
  const healthAfter = await request("/health");
  assert.equal(healthAfter.value.provider_bundle?.bundle_generation, generation,
    "Provider generation changed during A1");
  const afterRead = operationIds();
  assert.equal(afterRead.size, dispatchCount, "Result reads redispatched the Provider");
  const gatewayState = query(`SELECT dispatch_state || '|' || outcome_state FROM pc_gateway_operation WHERE operation_id='${operationId}'`);
  const businessState = query(`SELECT state FROM pc_business_operation_projection WHERE operation_id='${operationId}'`);
  const verifiedEvents = Number(query(`SELECT count(*) FROM pc_event_inbox WHERE operation_id='${operationId}' AND payload->>'event_type'='pc.operation.verified'`));
  const auditAfter = Number(query(`SELECT count(*) FROM pc_gateway_audit WHERE operation_id='${operationId}'`));
  const denialAudits = Number(query(`SELECT count(*) FROM pc_gateway_audit WHERE operation_id='${operationId}' AND payload->>'event_type'='RESULT_DELIVERY_DENIED'`));
  assert.equal(gatewayState, "COMPLETED|KNOWN_SUCCESS");
  assert.equal(businessState, "SUCCEEDED");
  assert.equal(verifiedEvents, 1);
  assert.equal(auditAfter, auditBefore + 1, "Cross-principal denial did not append exactly one Gateway audit");
  assert.equal(denialAudits, 1, "Cross-principal denial did not append RESULT_DELIVERY_DENIED");
  evidence.status = "PASS";
  evidence.acceptance_boundary = denialAudits > 0
    ? "DATA_ISOLATION_PASS_WITH_DENIAL_AUDIT"
    : "DATA_ISOLATION_PASS_WITH_OPEN_DENIAL_AUDIT_GAP";
  evidence.checks.push({ generation, workspace_id: workspace.value.workspace_id, operation_id: operationId,
    owner_status: owner.status, cross_principal_status: denied.status, cross_principal_error: denied.value.error.code,
    provider_dispatch_count_before_read: dispatchCount, provider_dispatch_count_after_read: afterRead.size,
    gateway_state: gatewayState, business_state: businessState, verified_event_count: verifiedEvents,
    audit_count_before_denial: auditBefore, audit_count_after_denial: auditAfter,
    result_delivery_denial_audit_count: denialAudits,
    owner_result_sha256: digest(owner.value), owner_result_size: JSON.stringify(owner.value).length,
    denied_response_sha256: digest(denied.value), denied_response_size: JSON.stringify(denied.value).length,
    business_body_present_in_denial: false });
} catch (error) {
  evidence.failure = { name: error instanceof Error ? error.name : "Error",
    code: typeof error?.code === "string" ? error.code : undefined };
} finally {
  await save();
}

console.log(`RCI-03 A1 ${evidence.status}: ${output}`);
if (evidence.status !== "PASS") process.exitCode = 1;
