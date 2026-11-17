import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const root = "http://127.0.0.1:18091";
const evidence = "reports/workbench-demo";
await mkdir(evidence, { recursive: true });
let token = "";
async function request(path, body, expected = 200) {
  const response = await fetch(`${root}/api${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(650_000) });
  const result = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
  return result;
}
function unwrap(value) { return value.result.data.result ?? value.result.data; }
token = (await request("/v1/pilot/sign-in", { tenant_id: "tenant_acceptance", account_key: "pilot.acceptance", secret: "LocalAcceptanceSecret123" })).access_token;
const tasks = (await request("/v1/ssts-tasks")).tasks;
assert(tasks.length >= 3);
for (const code of ["FN-EP37-001", "FN-EP37-003", "FN-EP38-001"]) {
  assert(tasks.some((task) => task.function_code === code), `Missing seeded workspace: ${code}`);
}
const workspace = tasks.find((task) => task.project_code === "EP37" && task.function_code === "FN-EP37-001");
const projects = (await request("/v1/workbench/projects")).items;
assert.deepEqual(projects.map((project) => project.project_code).sort(), ["EP37", "EP38"]);
const catalog = await request("/v1/workbench/catalog?project_code=EP37");
assert.equal(catalog.tools.length, 9);
assert.equal(new Set(catalog.tools.map((tool) => tool.compatibility.domain)).size, 6);
const datasets = {};
for (const project of projects) {
  const task = tasks.find((task) => task.project_code === project.project_code);
  const projection = await request(`/v1/workbench/tasks/${task.workspace_id}/project-data`);
  const facts = Object.fromEntries(Object.entries(projection.results).map(([name, value]) => [name, unwrap(value)]));
  assert.equal(facts["ee.list_requirements"].items.length, project.project_code === "EP37" ? 6 : 3);
  assert.equal(facts["ee.list_ssts"].items.length, 3);
  assert.equal(facts["ee.get_traceability_stats"].function_total, project.project_code === "EP37" ? 6 : 3);
  assert.equal(facts["ee.get_function_ssts_matrix"].mapping_count, 3);
  datasets[project.project_code] = { facts, traces: Object.values(projection.results).map((value) => value.external_evidence_refs) };
}
await writeFile(`${evidence}/project-data.json`, JSON.stringify(datasets, null, 2));
assert.equal((await request("/v1/workbench/catalog?project_code=EP99")).tools.length, 0);
await request("/v1/workbench/tasks", { title: "Unauthorized demo boundary", project_code: "EP99", mode: "READ" }, 403);
const pilotToken = token;
token = (await request("/v1/pilot/sign-in", { tenant_id: "tenant_acceptance", account_key: "reviewer.acceptance", secret: "LocalReviewerSecret123" })).access_token;
await request(`/v1/workbench/tasks/${workspace.workspace_id}/project-data`, undefined, 403);
token = pilotToken;
if (process.argv.includes("--turn")) {
  const response = await request(`/v1/workbench/tasks/${workspace.workspace_id}/turns`, {
    prompt: "使用 ee.list_functions 和 ee.get_function_ssts_matrix 读取当前项目。用中文简要列出所有没有已确认技术规范关联的功能编码及名称。不要修改EE，不要生成文档，不要根据历史消息猜测。" });
  assert(response.content.includes("FN-EP37-004") && response.content.includes("FN-EP37-005") && response.content.includes("FN-EP37-006"));
  await writeFile(`${evidence}/real-model-recovered-turn.json`, JSON.stringify(response, null, 2));
  console.log("Reassigned DSH session and real model tool-backed engineering answer PASS");
}
if (process.argv.includes("--review")) {
  const base = `/v1/workbench/tasks/${workspace.workspace_id}`;
  const readTool = catalog.tools.find((tool) => tool.tool_definition_id === "ee.get_ssts");
  const writeTool = catalog.tools.find((tool) => tool.tool_definition_id === "ee.submit_ssts_review");
  const read = await request(`${base}/tools`, { tool_release_id: readTool.tool_release_id, arguments: { ssts_code: "SSTS-EP37-003" }, call_id: crypto.randomUUID() });
  const snapshot = unwrap(read.structuredContent);
  if (snapshot.document.status === "draft") {
    const reviewers = (await request("/v1/workbench/approvals")).items;
    assert(Array.isArray(reviewers));
    const command = { tool_release_id: writeTool.tool_release_id, arguments: { ssts_code: "SSTS-EP37-003",
      expected_digest: snapshot.snapshot_digest, reviewer_account_ids: [String(process.env.PC_DEMO_REVIEWER_ID ?? "2")] }, call_id: crypto.randomUUID() };
    await request(`${base}/tools`, { ...command, call_id: crypto.randomUUID() }, 403);
    const approval = await request(`${base}/write-requests`, command);
    token = (await request("/v1/pilot/sign-in", { tenant_id: "tenant_acceptance", account_key: "reviewer.acceptance", secret: "LocalReviewerSecret123" })).access_token;
    await request(`/v1/workbench/approvals/${approval.approval_id}/decision`, { expected_version: approval.approval_version, decision: "APPROVE" });
    token = pilotToken;
    const executed = await request(`${base}/approvals/${approval.approval_id}/execute`, {});
    const readback = await request(`${base}/tools`, { tool_release_id: readTool.tool_release_id, arguments: { ssts_code: "SSTS-EP37-003" }, call_id: crypto.randomUUID() });
    assert.equal(unwrap(readback.structuredContent).document.status, "in_review");
    await writeFile(`${evidence}/controlled-review.json`, JSON.stringify({ approval, executed, readback }, null, 2));
  }
  console.log("Exact approval, separate reviewer, actual Owner write and independent readback PASS");
}
if (process.argv.includes("--generate")) {
  let projection = await request(`/v1/ssts-tasks/${workspace.workspace_id}`);
  if (!projection.drafts.length) {
    const generated = await request(`/v1/ssts-tasks/${workspace.workspace_id}/drafts/generate`, { idempotency_key: "workbench-demo-real-first" }, 201);
    assert.equal(generated.draft.validation.status, "PASSED");
    projection = await request(`/v1/ssts-tasks/${workspace.workspace_id}`);
  }
  const draft = projection.drafts.at(-1);
  assert(draft.source_refs.length >= 6);
  const response = await fetch(`${root}/api/v1/ssts-tasks/${workspace.workspace_id}/drafts/${draft.draft_id}/download`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const content = await response.text();
  assert(content.includes("FN-EP37-001"));
  assert(content.includes("eea://traces/"));
  await writeFile(`${evidence}/real-model-draft.md`, content);
  await writeFile(`${evidence}/real-model-draft.json`, JSON.stringify(draft, null, 2));
}
console.log("Real project data, six MCP groups, project isolation and owner boundary PASS");
if (process.argv.includes("--browser")) {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: ["--no-first-run", "--no-default-browser-check"] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(root, { waitUntil: "networkidle0" });
    await page.click('[data-test="login"]');
    await page.waitForSelector(".nav-rail");
    await page.$$eval(".nav-rail > button", (nodes) => nodes.find((node) => node.textContent.trim() === "工作").click());
    await page.waitForFunction(() => document.querySelector(".source-tag")?.textContent.includes("EE 已连接"), { timeout: 60_000 });
    async function nav(label) { await page.$$eval(".nav-rail > button", (nodes, label) => nodes.find((node) => node.textContent.trim() === label).click(), label); }
    async function noOverflow() { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page overflow"); }
    await noOverflow();
    await page.screenshot({ path: `${evidence}/01-overview-1440.png`, fullPage: true });
    assert(await page.$eval(".project-summary img", (img) => img.complete && img.naturalWidth > 0));
    await nav("工程");
    assert.equal(await page.$$(".relation-row").then((rows) => rows.length), 6);
    assert.equal(await page.$$(".spec-node").then((rows) => rows.length), 3);
    assert.equal(await page.$$(".missing-node").then((rows) => rows.length), 3);
    await page.screenshot({ path: `${evidence}/02-engineering-1440.png`, fullPage: true });
    await page.click('.check-filter input');
    assert.equal(await page.$$(".relation-row").then((rows) => rows.length), 3);
    await nav("需求");
    await page.type('.search-field input', "CAN");
    assert.equal(await page.$$(".data-table tbody tr").then((rows) => rows.length), 1);
    await page.click('.data-table tbody tr');
    await page.waitForSelector('.detail-drawer');
    await page.screenshot({ path: `${evidence}/03-requirement-detail.png`, fullPage: true });
    await page.click('[title="关闭详情"]');
    await nav("首页");
    await page.$$eval(".home-tabs button", nodes => nodes.find(node => node.textContent.trim() === "我的能力").click());
    await page.waitForSelector('.personal-capabilities[aria-busy="false"]');
    assert.equal(await page.$$(".capability-item").then((rows) => rows.length), 9);
    await page.screenshot({ path: `${evidence}/04-capabilities.png`, fullPage: true });
    await nav("资料");
    assert.equal(await page.$$(".data-table tbody tr").then((rows) => rows.length), 3);
    await nav("成果");
    await page.click('.data-table tbody tr');
    await page.waitForFunction(() => document.querySelector('.spec-detail article'));
    await page.screenshot({ path: `${evidence}/05-specification-detail.png`, fullPage: true });
    await page.click('[title="关闭详情"]');
    await nav("工作台");
    await page.waitForSelector('.execution-tabs');
    await noOverflow();
    await page.screenshot({ path: `${evidence}/06-task-workspace-1440.png`, fullPage: true });
    await page.select('select[aria-label="当前项目"]', 'EP38');
    await page.waitForFunction(() => !document.querySelector('.project-loading'));
    await nav("工程");
    await page.waitForFunction(() => !document.querySelector('.project-loading') && document.querySelectorAll('.relation-row').length === 3);
    assert.equal(await page.$$(".relation-row").then((rows) => rows.length), 3);
    assert.equal(await page.$$(".missing-node").then((rows) => rows.length), 0);
    await page.setViewport({ width: 1100, height: 850 });
    await nav("工作");
    await noOverflow();
    await page.screenshot({ path: `${evidence}/07-overview-1100.png`, fullPage: true });
    await page.reload({ waitUntil: "networkidle0" });
    await nav("工作");
    await page.waitForFunction(() => document.querySelector('.source-tag')?.textContent.includes('EE 已连接'), { timeout: 60_000 });
    await noOverflow();
    assert.deepEqual(errors, []);
    console.log("Desktop navigation, real relations, search, missing filter, drawers, image, project switching and reload PASS");
  } finally { await browser.close(); }
}
await writeFile(`${evidence}/result.json`, JSON.stringify({ status: "PASS", projects: 2, tasks: tasks.length, tools: 9,
  real_model: process.argv.includes("--generate"), browser: process.argv.includes("--browser"), controlled_review: process.argv.includes("--review"), verified_at: new Date().toISOString() }, null, 2));
