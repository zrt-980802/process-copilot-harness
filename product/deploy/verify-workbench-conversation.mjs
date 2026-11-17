import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const root = "http://127.0.0.1:18091";
const evidence = "reports/workbench-conversation";
await mkdir(evidence, { recursive: true });
async function api(path, token, body) {
  const response = await fetch(`${root}/api${path}`, { method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const token = (await api("/v1/pilot/sign-in", undefined, { tenant_id: "tenant_acceptance",
  account_key: "pilot.acceptance", secret: "LocalAcceptanceSecret123" })).data.access_token;
const tasks = (await api("/v1/ssts-tasks", token)).data.tasks;
const task = tasks.find((entry) => entry.function_code === "FN-EP37-001");
const path = `/v1/workbench/tasks/${task.workspace_id}/conversation`;
const initial = await api(path, token);
assert.equal(initial.status, 200);
assert(initial.data.messages.some((entry) => entry.role === "user"));
assert(initial.data.messages.some((entry) => entry.role === "assistant"));
assert.equal((await api(path)).status, 401);
const reviewer = (await api("/v1/pilot/sign-in", undefined, { tenant_id: "tenant_acceptance",
  account_key: "reviewer.acceptance", secret: "LocalReviewerSecret123" })).data.access_token;
assert.equal((await api(path, reviewer)).status, 403);
let priorToolCalls = 0;
if (process.argv.includes("--restore")) {
  const before = (await api(`/v1/workbench/tasks/${task.workspace_id}/execution`, token)).data;
  priorToolCalls = before.events.filter((event) => event.event_type === "dsh.tool/call").length;
  const containerId = () => execFileSync("docker", ["inspect", "--format", "{{.Id}}", "pc-workbench-demo-pc-runtime-1"], { encoding: "utf8" }).trim();
  const originalContainer = containerId();
  const result = JSON.parse(execFileSync("docker", ["exec", "pc-workbench-demo-pc-api-1", "node", "-e",
    'fetch("http://127.0.0.1:3000/v1/session-assignments/"+encodeURIComponent(process.argv[1])+"/revoke",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expected_version:Number(process.argv[2]),reason:"local-conversation-restoration-verification"})}).then(async r=>{const x=await r.json();if(!r.ok)throw Error(JSON.stringify(x));console.log(JSON.stringify(x))})',
    before.session.assignment.pc_session_id, String(before.session.assignment.version)], { encoding: "utf8" }));
  assert.equal(result.assignment.state, "RELEASED");
  const restored = await api(path, token);
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(restored.data.messages, initial.data.messages);
  assert.equal(containerId(), originalContainer);
  const after = (await api(`/v1/workbench/tasks/${task.workspace_id}/execution`, token)).data;
  assert(after.session.assignment.assignment_generation > before.session.assignment.assignment_generation);
  assert.equal(after.events.at(-1).dsh_session_id, before.events.at(-1).dsh_session_id);
  await writeFile(`${evidence}/sdk-restoration.json`, JSON.stringify({ status: "pass", sameContainer: true,
    beforeGeneration: before.session.assignment.assignment_generation,
    afterGeneration: after.session.assignment.assignment_generation, restoredMessages: restored.data.messages.length }, null, 2));
}

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
const errors = [];
const checks = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => {
    if (response.url().endsWith("/execution")) {
      const data = await response.json();
      console.log(`Execution projection: status=${response.status()}, session=${!!data.session}, events=${data.events?.length}`);
    }
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(root, { waitUntil: "networkidle0" });
  await page.evaluate((values) => {
    sessionStorage.setItem("pc.minimum-test.token", values.token);
    sessionStorage.setItem("pc.minimum-test.task", values.id);
  }, { token, id: task.workspace_id });
  await page.reload({ waitUntil: "networkidle0" });
  async function nav(label) {
    await page.$$eval(".nav-rail > button", (nodes, name) => nodes.find((node) => node.textContent.trim() === name).click(), label);
  }
  async function loaded() { await page.waitForFunction(() => document.querySelectorAll(".chat-message[data-message-id]").length > 0 && document.querySelector('.chat-transcript[aria-busy="false"]') && !document.querySelector(".chat-error"), { timeout: 60_000 }); }
  async function ids() { return page.$$eval(".chat-message[data-message-id]", (nodes) => nodes.map((node) => node.dataset.messageId)); }
  async function dimensions() {
    const result = await page.evaluate(() => {
      const composer = document.querySelector(".turn-composer").getBoundingClientRect();
      const log = document.querySelector(".chat-transcript").getBoundingClientRect();
      return { width: innerWidth, viewportHeight: innerHeight, documentWidth: document.documentElement.scrollWidth,
        composerBottom: composer.bottom, composerTop: composer.top, logBottom: log.bottom, logHeight: log.height };
    });
    assert(result.documentWidth <= result.width, JSON.stringify(result));
    assert(result.composerBottom <= result.viewportHeight + 1, JSON.stringify(result));
    assert(result.composerTop >= result.logBottom - 1 && result.logHeight >= 100, JSON.stringify(result));
    return result;
  }
  await nav("对话"); await loaded();
  await page.waitForFunction(() => document.querySelector(".chat-context")?.textContent.includes("会话已连接"), { timeout: 30_000 });
  assert.deepEqual(await ids(), initial.data.messages.map((entry) => entry.message_id));
  checks.push({ step: "restored-existing-history", dimensions: await dimensions() });
  await page.screenshot({ path: `${evidence}/conversation-1440.png`, fullPage: true });
  const prompt = process.argv.includes("--restore")
    ? "调用 ee.list_functions 和 ee.get_function_ssts_matrix，简要列出当前项目没有已确认 SSTS 关联的功能编码。只读，不修改数据。"
    : "只回复：对话窗口恢复验收通过。本轮不要调用工具或修改任何数据。";
  await page.type('[aria-label="运行消息"]', prompt);
  await nav("工程"); await nav("对话");
  assert.equal(await page.$eval('[aria-label="运行消息"]', (node) => node.value), prompt);
  await page.waitForSelector('.turn-composer button[type="submit"]:not(:disabled)', { timeout: 60_000 });
  const response = page.waitForResponse((entry) => entry.url().endsWith(`/tasks/${task.workspace_id}/turns`) && entry.request().method() === "POST", { timeout: 180_000 });
  await page.click('.turn-composer button[type="submit"]');
  assert.equal((await response).status(), 200);
  await page.waitForFunction((count) => document.querySelectorAll(".chat-message[data-message-id]").length > count && !document.querySelector(".chat-running"), { timeout: 60_000 }, initial.data.messages.length);
  const savedIds = await ids();
  const expected = process.argv.includes("--restore") ? "FN-EP37-006" : "对话窗口恢复验收通过";
  assert(await page.$eval(".chat-message.assistant:last-of-type", (node, text) => node.textContent.includes(text), expected));
  if (process.argv.includes("--restore")) {
    const state = (await api(`/v1/workbench/tasks/${task.workspace_id}/execution`, token)).data;
    const toolCalls = state.events.filter((event) => event.event_type === "dsh.tool/call").length;
    assert(toolCalls > priorToolCalls, "Restored model turn must make fresh real tool calls");
    checks.push({ step: "fresh-tools-after-sdk-restoration", priorToolCalls, toolCalls });
  }
  await nav("工作台");
  assert(await page.$eval(".conversation-band", (node) => getComputedStyle(node).display !== "none"));
  assert(await page.$eval('[data-test="download-draft"]', (node) => node.getBoundingClientRect().width > 0));
  await page.screenshot({ path: `${evidence}/original-workbench-1440.png`, fullPage: true });
  await nav("对话");
  assert.deepEqual(await ids(), savedIds);
  await page.reload({ waitUntil: "networkidle0" });
  await nav("对话"); await loaded();
  assert.deepEqual(await ids(), savedIds);
  checks.push({ step: "real-model-turn-navigation-and-reload", messageCount: savedIds.length });
  for (const width of [1100, 390]) {
    await page.setViewport({ width, height: 900 });
    checks.push({ step: `responsive-${width}`, dimensions: await dimensions() });
    await page.screenshot({ path: `${evidence}/conversation-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/result.json`, JSON.stringify({ status: "pass", checks,
    auth: { anonymous: 401, otherOwner: 403 }, pageErrors: errors }, null, 2));
  console.log("Conversation history, real model turn, original workbench, navigation, reload, isolation and responsive layout PASS");
} finally { await browser.close(); }
