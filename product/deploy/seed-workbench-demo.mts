import { IdentityAuthorizationService } from "../packages/application/src/index.js";
import { PostgresIdentityAuthorizationRepository } from "../packages/persistence/src/index.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";

const identity = new IdentityAuthorizationService(new PostgresIdentityAuthorizationRepository(process.env.DATABASE_URL!), process.env.PC_ENVELOPE_SIGNING_KEY!);
const tenant = process.env.PC_PILOT_TENANT_ID!;
let token = "";
async function request(path: string, body?: unknown) {
  const response = await fetch(`http://pc-api:3000${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(600_000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(payload)}`);
  return payload;
}
try {
  await mkdir("/data/demo", { recursive: true });
  const manifestPath = "/data/demo/seed-tasks.json";
  const manifest: Record<string, { workspace_id: string; completed: boolean }> = await readFile(manifestPath, "utf8").then(JSON.parse).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return {};
    throw error;
  });
  async function saveManifest() {
    await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest));
    await rename(`${manifestPath}.tmp`, manifestPath);
  }
  await identity.initialize();
  for (const [key, secret, eeId, actions] of [
    ["pilot.acceptance", "LocalAcceptanceSecret123", process.env.PC_PILOT_EECLAW_ACCOUNT_ID!, ["page:projects", "page:requirements", "page:functions", "page:architecture", "ee.ssts.review.request"]],
    ["reviewer.acceptance", "LocalReviewerSecret123", process.env.PC_REVIEWER_EE_ACCOUNT_ID!, ["approval.decide", "page:projects", "page:architecture"]]
  ] as const) {
    let principal = await identity.getPilotPrincipal(tenant, key)
      ?? (await identity.provisionPilotAccount({ tenant_id: tenant, account_key: key, secret })).principal;
    if (!await identity.resolveExternalSubject(principal.principal_id, "eeclaw")) {
      await identity.linkVerifiedIdentity({ principal_id: principal.principal_id, identity_provider_ref: "eeclaw", issuer: process.env.EECLAW_ADAPTER_URL!,
        external_subject: eeId, tenant_or_org_ref: tenant, verification_level: "admin_reauthentication",
        expected_identity_revision: principal.identity_revision });
      principal = (await identity.getPilotPrincipal(tenant, key))!;
    }
    if (principal.authorization_revision === 2) await identity.replaceAuthorizationGrants({
      principal_id: principal.principal_id, expected_authorization_revision: principal.authorization_revision,
      grants: ["EP37", "EP38"].flatMap((scope_id) => actions.map((action) => ({
        action, scope_type: "project" as const, scope_id, effect: "allow" as const, evidence_ref: "local-demo:explicit-seed" }))) });
  }
  const eeHeaders: Record<string, string> = { "content-type": "application/json" };
  async function ee(path: string, body: unknown) {
    const response = await fetch(`http://ee-api:5000/api/v1/auth/${path}`, { method: "POST", headers: eeHeaders, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(`EE seed login failed: ${response.status}`);
    if (response.headers.getSetCookie().length) eeHeaders.cookie = response.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
    return payload.data;
  }
  const login = await ee("login", { username: "demo.engineer", password: "LocalAcceptanceSecret123" });
  eeHeaders["x-csrf-token"] = login.csrf_token;
  const verifier = randomBytes(32).toString("base64url");
  const launch = await ee("process-copilot/launch", { audience: "process-copilot", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  token = (await request("/v1/auth/ee/exchange", { ticket: launch.ticket, code_verifier: verifier })).access_token;
  const principal = (await request("/v1/identity/me")).principal;
  const { tasks } = await request("/v1/ssts-tasks");
  for (const [project, title, fun, complete] of [
    ["EP37", "电源状态监测 · SSTS 草稿", "FN-EP37-001", true],
    ["EP37", "CAN 新鲜度 · 输入待补齐", "FN-EP37-003", false],
    ["EP38", "远航 S2 · 电源监测草稿", "FN-EP38-001", true]
  ] as const) {
    const key = `${project}:${fun}`;
    if (manifest[key]?.completed) continue;
    const previous = manifest[key]?.workspace_id ?? tasks.find((task: { title: string; project_code: string }) => task.title === title && task.project_code === project)?.workspace_id;
    const workspace = previous ? (await request(`/v1/ssts-tasks/${previous}`)).workspace
      : await request("/v1/workbench/tasks", { title, project_code: project, function_code: fun, mode: "REVIEW" });
    manifest[key] = { workspace_id: workspace.workspace_id, completed: false };
    await saveManifest();
    const projection = await request(`/v1/ssts-tasks/${workspace.workspace_id}`);
    for (const [slot, content] of [
      ["PRD", `# 本地合成演示 PRD\n项目 ${project}，功能 ${fun}。电源监测在100ms内诊断无效电压，状态切换记录原因。恢复稳定500ms。电压阈值待确认，不能自行补全。需求 REQ-${project}-001。`],
      ...(complete ? [["ARCHITECTURE", `# 本地合成演示架构\n${fun}：电源 ECU 采集电压，CAN 发布电源模式。监控单元对信号进行防抖、新鲜度检查和异常恢复。通信矩阵尚未批准，阈值及报文ID保持开放项。`]] : [])
    ]) {
      if (projection.inputs.some((input: { slot: string }) => input.slot === slot)) continue;
      const resource = await request("/v1/resources/uploads", { kind: "UPLOAD", display_name: `${project}-${slot}-demo.md`, classification: "INTERNAL",
        owner_scope: { scope_type: "USER_ROOT", scope_id: principal.principal_id }, media_type: "text/markdown",
        content_base64: Buffer.from(content!).toString("base64"), provenance: { source_system: "local-synthetic-demo", acquisition_operation: "demo-seed" } });
      await request(`/v1/ssts-tasks/${workspace.workspace_id}/inputs`, { slot, resource_id: resource.resource.resource_id, resource_version_id: resource.version.resource_version_id });
    }
    if (["CREATED", "INPUT_INCOMPLETE", "READY"].includes(workspace.state)) await request(`/v1/ssts-tasks/${workspace.workspace_id}/check-inputs`, {});
    manifest[key] = { workspace_id: workspace.workspace_id, completed: true };
    await saveManifest();
  }
  console.log("Local demo accounts, project grants, three tasks and source inputs are ready. No AI output was seeded.");
} finally { await identity.close(); }
