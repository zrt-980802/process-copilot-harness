import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

const base = "http://127.0.0.1:18891";
const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "reports/real-ee-read-retest-01", `outage-${randomUUID()}`);
await mkdir(output, { recursive: true });
const checks = [];
let stopped = false;
let failure;
let adminToken;
function control(action) {
  const result = spawnSync("E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe", ["integration/real-ee-read-retest-01/run.py", action],
    { cwd: root, env: process.env, encoding: "utf8", timeout: 120_000 });
  assert.equal(result.status, 0, `Isolated control failed: ${action}`);
}
function query(sql) {
  const result = spawnSync("docker", ["exec", "pc-real-ee-read-retest-01-pc-postgres-1", "psql", "-U", "pc", "-d", "pc", "-At", "-c", sql], { encoding: "utf8" });
  assert.equal(result.status, 0, "Isolated PostgreSQL query failed");
  return result.stdout.trim();
}
async function request(route, token, body) {
  const response = await fetch(base + "/api" + route, { method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(200_000) });
  const value = await response.json();
  return { status: response.status, value };
}
async function login(account, password = process.env[`RC_${account.toUpperCase()}_PASSWORD`], verifySource = false) {
  const headers = { "content-type": "application/json" };
  const login = await fetch(base + "/api/ee-auth/login", { method: "POST", headers,
    body: JSON.stringify({ username: `rc.${account}`, password }) });
  assert.equal(login.status, 200, "EE login failed");
  headers.cookie = login.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
  headers["x-csrf-token"] = (await login.json()).data.csrf_token;
  if (verifySource) {
    const source = await fetch("http://127.0.0.1:18892/api/projects?project_code=RCI-ENG", { headers });
    assert.equal(source.status, 200, "Direct EE project permission denied");
    assert(JSON.stringify(await source.json()).includes("RCI-ENG"), "Direct EE project not visible");
  }
  const verifier = randomBytes(32).toString("base64url");
  const launch = await fetch(base + "/api/ee-auth/process-copilot/launch", { method: "POST", headers,
    body: JSON.stringify({ audience: "process-copilot", code_challenge: createHash("sha256").update(verifier).digest("base64url") }) });
  assert.equal(launch.status, 200, "EE ticket failed");
  const exchange = await request("/v1/auth/ee/exchange", undefined, { ticket: (await launch.json()).data.ticket, code_verifier: verifier });
  assert.equal(exchange.status, 200, "PC exchange failed");
  return exchange.value.access_token;
}
async function retry() {
  const result = await request("/v1/providers/eeclaw/retry", adminToken, {});
  assert.equal(result.status, 200, "Authorized provider retry failed");
}
async function waitEeHealthy() {
  for (const url of ["http://127.0.0.1:18892/api/health", "http://127.0.0.1:18893/health"]) {
    const deadline = Date.now() + 60_000;
    while (true) {
      try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* Wait for startup. */ }
      if (Date.now() >= deadline) throw new Error("EE recovery health timeout");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}
try {
  adminToken = await login("admin");
  await retry();
  const engineer = await login("engineer");
  const reviewer = await login("reviewer");
  const suffix = randomBytes(6).toString("hex");
  const testUser = `rc.pcdeny-${suffix}`;
  const testPassword = randomBytes(24).toString("base64url");
  const seed = spawnSync("docker", ["exec", "-i", "-e", "RC_TEST_USER", "-e", "RC_TEST_PASSWORD", "pc-real-ee-read-retest-01-ee-api-1", "python", "-"],
    { input: readFileSync(path.join(root, "integration/real-ee-read-retest-01/pc-deny-fixture.py")), env: { ...process.env, RC_TEST_USER: testUser, RC_TEST_PASSWORD: testPassword }, encoding: "utf8" });
  assert.equal(seed.status, 0, "Isolated EE account setup failed");
  const pcDeniedToken = await login(`pcdeny-${suffix}`, testPassword, true);
  const pcDenied = await request("/v1/workbench/tasks", pcDeniedToken, { title: "PC policy denied", project_code: "RCI-ENG", mode: "CHAT" });
  assert.equal(pcDenied.status, 403, "PC policy failed to deny EE-authorized project");
  checks.push({ step: "ee-allow-pc-deny", direct_ee_project: 200, pc_task: pcDenied.status, error: pcDenied.value.error?.code });
  const unauthenticated = await request("/v1/workbench/projects");
  assert.equal(unauthenticated.status, 401);
  const fakeAdmin = await request("/v1/providers/eeclaw/retry", engineer, { principal_id: "admin", action: "provider.manage", scope: "global:*" });
  assert.equal(fakeAdmin.status, 403);
  const eeDenied = await request("/v1/workbench/tasks", adminToken, { title: "Denied source membership", project_code: "RCI-FULLA", mode: "CHAT" });
  assert.equal(eeDenied.status, 403);
  checks.push({ step: "unauthenticated-and-explicit-provider-management-and-ee-membership", unauthenticated: unauthenticated.status,
    fake_admin: fakeAdmin.status, source_denied: eeDenied.status });
  const projects = await request("/v1/workbench/projects", engineer);
  assert.equal(projects.status, 200);
  assert(projects.value.items.some(item => item.project_code === "RCI-ENG"));
  const personal = await request("/v1/workbench/tasks", engineer, { title: `Outage personal ${randomUUID()}`, mode: "CHAT" });
  assert.equal(personal.status, 201);
  const workspace = personal.value.workspace_id;
  const cross = await request(`/v1/ssts-tasks/${workspace}`, reviewer);
  assert([403, 404].includes(cross.status), "Other subject accessed personal workspace");
  const meBefore = await request("/v1/identity/me", engineer);
  const principal = meBefore.value.principal.principal_id;
  assert(/^[0-9a-f-]{36}$/u.test(principal));
  const oldOperation = query(`SELECT operation_id FROM pc_business_operation_projection WHERE owner_principal_id='${principal}' AND state='SUCCEEDED' ORDER BY operation_id LIMIT 1`);
  assert(/^tool_[0-9a-f]{64}$/u.test(oldOperation), "No previously observed real READ operation");
  const before = query("SELECT count(*) FROM pc_gateway_operation");
  const oldOwner = await request(`/v1/operations/${oldOperation}`, engineer);
  const oldOther = await request(`/v1/operations/${oldOperation}`, reviewer);
  const after = query("SELECT count(*) FROM pc_gateway_operation");
  checks.push({ step: "cross-subject-and-old-generation-result", personal_other: cross.status, operation: oldOperation,
    old_owner: oldOwner.status, owner_error: oldOwner.value.error?.code, old_other: oldOther.status,
    other_error: oldOther.value.error?.code, dispatch_count_before: before, dispatch_count_after: after });
  assert.equal(oldOwner.status, 403);
  assert.equal(oldOther.status, 403);
  assert.equal(after, before);
  checks.push({ step: "real-ee-authorized-project-and-pc-personal-created", workspace });
  stopped = true; control("stop-ee");
  const me = await request("/v1/identity/me", engineer);
  const list = await request("/v1/ssts-tasks?scope=personal", engineer);
  const denied = await request("/v1/workbench/projects", engineer);
  checks.push({ step: "ee-offline", identity: me.status, personal_list: list.status, ee_projects: denied.status, ee_error: denied.value.error?.code });
  assert.equal(me.status, 200);
  assert.equal(list.status, 200);
  assert.notEqual(denied.status, 200);
  const turn = await request(`/v1/workbench/tasks/${workspace}/turns`, engineer,
    { prompt: "Reply with the single word CONNECTED.", request_id: randomUUID() });
  checks.push({ step: "ee-offline-personal-turn", status: turn.status, error: turn.value.error?.code,
    has_response: typeof turn.value.content === "string" && turn.value.content.length > 0 });
  control("start-ee"); stopped = false;
  await waitEeHealthy();
  await retry();
  const restored = await request("/v1/workbench/projects", engineer);
  checks.push({ step: "ee-recovered", status: restored.status, engineering_visible: restored.value.items?.some(item => item.project_code === "RCI-ENG") });
  assert.equal(restored.status, 200);
  assert(restored.value.items.some(item => item.project_code === "RCI-ENG"));
  const onlineTurn = await request(`/v1/workbench/tasks/${workspace}/turns`, engineer,
    { prompt: "Reply with the single word CONNECTED.", request_id: randomUUID() });
  checks.push({ step: "ee-online-personal-turn-control", status: onlineTurn.status, error: onlineTurn.value.error?.code,
    has_response: typeof onlineTurn.value.content === "string" && onlineTurn.value.content.length > 0 });
  assert.equal(onlineTurn.status, 200, "Online personal turn control failed independently of EE availability");
  assert.equal(typeof onlineTurn.value.content, "string");
  assert.equal(turn.status, 200, "Real personal turn failed while EE was unavailable");
  assert.equal(typeof turn.value.content, "string");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (stopped) {
    try { control("start-ee"); stopped = false; } catch { checks.push({ step: "cleanup-ee-restart-failed" }); }
  }
  await writeFile(path.join(output, "result.json"), JSON.stringify({ classification: "real-ee-and-real-pc-api", checks, failure, ee_still_stopped: stopped }, null, 2), { flag: "wx" });
}
console.log(JSON.stringify({ output, checks, failure, ee_still_stopped: stopped }));
if (failure || stopped) process.exitCode = 1;
