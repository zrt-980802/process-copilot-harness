/* global document, innerWidth */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const root = "http://127.0.0.1:18091";
const evidence = "reports/personal-home";
await mkdir(evidence, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
const errors = [];
const measurements = [];
let page;
try {
  page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(root, { waitUntil: "networkidle0" });
  await page.click('[data-test="login"]');
  async function homeReady() {
    await page.waitForSelector('.personal-home[aria-busy="false"]');
    assert.equal(await page.$(".home-error"), null);
    assert.equal(await page.$(".home-warning"), null);
  }
  async function nav(label) {
    await page.$$eval(".nav-rail > button", (nodes, label) => nodes.find((node) => node.textContent.trim() === label).click(), label);
  }
  async function tab(label) {
    await page.$$eval(".home-tabs button", (nodes, label) => nodes.find((node) => node.textContent.trim() === label).click(), label);
  }
  let token;
  async function api(path) {
    const response = await fetch(`${root}/api${path}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200, path);
    return response.json();
  }
  await homeReady();
  assert(!requests.some((url) => /\/(conversation|project-data|turns)$/.test(url)), "Home must only read saved state");
  token = await page.evaluate(() => sessionStorage.getItem("pc.minimum-test.token"));
  const tasks = (await api("/v1/ssts-tasks")).tasks;
  const projects = (await api("/v1/workbench/projects")).items;
  const { principal } = await api("/v1/identity/me");
  const approvalsBefore = await api("/v1/workbench/approvals");
  const projections = await Promise.all(tasks.map((task) => api(`/v1/ssts-tasks/${task.workspace_id}`)));
  const states = await Promise.all(tasks.map((task) => api(`/v1/workbench/tasks/${task.workspace_id}/execution`)));
  const chatCount = states.filter((state) => state.events.some((event) => event.event_type === "dsh.assistant/message")).length;
  const draftCount = projections.reduce((sum, projection) => sum + projection.drafts.length, 0);
  const metrics = await page.$$eval(".personal-metrics strong", (nodes) => nodes.map((node) => Number(node.textContent)));
  assert.deepEqual(metrics, [projects.length, tasks.filter((task) => !["ACCEPTED", "ARCHIVED"].includes(task.state)).length, chatCount, 0, draftCount]);
  assert.equal(await page.$$(".home-task-row").then((nodes) => nodes.length), metrics[1]);

  for (const width of [1440, 1100, 390]) {
    await page.setViewport({ width, height: 1000 });
    const sizes = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      images: [...document.querySelectorAll(".home-project img")].every((img) => img.complete && img.naturalWidth > 0),
      textOverlaps: [...document.querySelectorAll(".personal-metrics button,.home-task-row,.home-project")].some((node) => node.scrollWidth > node.clientWidth + 1) }));
    assert(sizes.scrollWidth <= sizes.width); assert(sizes.images); assert(!sizes.textOverlaps);
    measurements.push(sizes);
    await page.screenshot({ path: `${evidence}/home-${width}.png`, fullPage: true });
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await page.select('[aria-label="筛选首页项目"]', "EP38");
  assert.equal(await page.$$(".home-task-row").then((nodes) => nodes.length), tasks.filter((task) => task.project_code === "EP38").length);
  await page.type('[aria-label="搜索个人工作"]', "does-not-exist");
  assert.equal(await page.$$(".home-task-row").then((nodes) => nodes.length), 0);
  await page.$eval('[aria-label="搜索个人工作"]', (node) => { node.value = ""; node.dispatchEvent(new Event("input", { bubbles: true })); });
  const other = tasks.find((task) => task.project_code === "EP38");
  await page.click(`[data-workspace="${other.workspace_id}"]`);
  await page.waitForFunction((title) => document.querySelector(".workspace-header h1")?.textContent === title, {}, other.title);
  assert.equal(await page.$eval('[aria-label="当前项目"]', (node) => node.value), "EP38");
  await page.waitForSelector(".execution-tabs");
  await nav("首页"); await homeReady();
  await page.click('[data-project="EP37"]');
  await page.waitForFunction(() => document.querySelector(".source-tag")?.textContent.includes("EE 已连接"), { timeout: 60_000 });
  assert.equal(await page.$eval('[aria-label="当前项目"]', (node) => node.value), "EP37");
  await nav("首页"); await homeReady();
  await page.click('[title="继续最近对话"]');
  await page.waitForSelector(".chat-message.assistant .chat-markdown table");
  assert.equal(await page.$eval('[aria-label="当前项目"]', (node) => node.value), "EP37");
  await page.type(".turn-composer textarea", "未发送的个人首页跳转检查");
  await nav("首页"); await homeReady();
  await page.click('[title="继续最近对话"]');
  assert.equal(await page.$eval(".turn-composer textarea", (node) => node.value), "未发送的个人首页跳转检查");
  await nav("首页"); await homeReady();
  await tab("我的任务");
  await page.select('[aria-label="任务状态筛选"]', "all");
  assert.equal(await page.$$(".home-task-row").then((nodes) => nodes.length), tasks.length);
  await tab("最近对话");
  assert.equal(await page.$$(".home-chat-row").then((nodes) => nodes.length), chatCount);
  await tab("最近成果");
  assert.equal(await page.$$(".home-artifact-row").then((nodes) => nodes.length), draftCount);
  await tab("审批");
  assert.equal(await page.$$(".home-approval-row").then((nodes) => nodes.length), approvalsBefore.items.length);
  if (approvalsBefore.items.length) {
    await page.click(".home-approval-row");
    await page.waitForSelector('[aria-label="审批详情"]');
    assert.equal(await page.$(".approval-actions"), null);
    await page.click('[title="关闭审批详情"]');
  }
  await page.click('[title="账号与设置"]');
  await page.waitForSelector(".account-dialog[open]");
  assert((await page.$eval(".account-dialog", (node) => node.textContent)).includes("pilot.acceptance"));
  assert((await page.$eval(".account-dialog", (node) => node.textContent)).includes(principal.principal_id));
  await page.click(".density-options button:last-child");
  await page.screenshot({ path: `${evidence}/account.png`, fullPage: true });
  await page.keyboard.press("Escape");
  assert.equal(await page.$(".account-dialog[open]"), null);
  await page.reload({ waitUntil: "networkidle0" }); await homeReady();
  assert(await page.$(".desktop-workbench.compact"));
  await page.click('[title="退出登录"]');
  await page.waitForSelector('[autocomplete="username"]');
  await page.$eval('[autocomplete="username"]', (node) => { node.value = "reviewer.acceptance"; node.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval('[autocomplete="current-password"]', (node) => { node.value = "LocalReviewerSecret123"; node.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click('[data-test="login"]'); await homeReady();
  token = await page.evaluate(() => sessionStorage.getItem("pc.minimum-test.token"));
  assert.equal((await api("/v1/ssts-tasks")).tasks.length, 0);
  assert.equal(await page.$(".desktop-workbench.compact"), null);
  assert.equal(await page.$$(".home-task-row,.home-chat-row,.home-artifact-row").then((nodes) => nodes.length), 0);
  const reviewerApprovals = await api("/v1/workbench/approvals");
  await tab("审批");
  assert.equal(await page.$$(".home-approval-row").then((nodes) => nodes.length), reviewerApprovals.items.length);
  await page.screenshot({ path: `${evidence}/reviewer.png`, fullPage: true });

  // Exercise pending/expired requests and versioned decisions in the browser only.
  let fixtureDecision;
  let approvalUnavailable = false;
  let tasksUnavailable = false;
  const base = reviewerApprovals.items[0];
  assert(base);
  const fixture = { ...base, approval_id: "personal-home-ui-fixture", status: "PENDING", decision: undefined,
    expires_at: new Date(Date.now() + 600_000).toISOString(), approval_version: 7 };
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (tasksUnavailable && request.url().endsWith("/v1/ssts-tasks")) {
      void request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "任务暂时无法读取" } }) });
    } else if (request.url().endsWith("/v1/workbench/approvals")) {
      void request.respond({ status: approvalUnavailable ? 503 : 200, contentType: "application/json", body: JSON.stringify(approvalUnavailable
        ? { error: { message: "审批暂时无法读取" } } : { items: [fixture, { ...base, approval_id: "expired-ui-fixture", status: "PENDING", expires_at: new Date(0).toISOString() }] }) });
    } else if (request.url().endsWith(`/approvals/${fixture.approval_id}/decision`)) {
      fixtureDecision = JSON.parse(request.postData()); fixture.status = "APPROVED";
      void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) });
    } else void request.continue();
  });
  await page.click('[title="刷新我的首页"]'); await homeReady();
  assert.equal(await page.$$eval(".personal-metrics strong", (nodes) => Number(nodes[3].textContent)), 1);
  await page.click(".home-approval-row");
  await page.click(".approval-actions button:first-child");
  await page.waitForFunction(() => document.querySelector('[aria-label="审批详情"] .pill')?.textContent.includes("已批准"));
  assert.deepEqual(fixtureDecision, { expected_version: 7, decision: "APPROVE" });
  await page.click('[title="关闭审批详情"]');
  assert.deepEqual(await api("/v1/workbench/approvals"), reviewerApprovals, "Browser fixture must not change stored approvals");
  approvalUnavailable = true;
  await page.click('[title="刷新我的首页"]');
  await page.waitForSelector(".home-warning");
  assert.equal(await page.$(".home-error"), null);
  tasksUnavailable = true;
  await page.click('[title="刷新我的首页"]');
  await page.waitForSelector(".home-error");
  tasksUnavailable = false; approvalUnavailable = false;
  await page.click('[title="重试首页"]'); await homeReady();
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/result.json`, JSON.stringify({ status: "pass", tasks: tasks.length,
    conversations: chatCount, drafts: draftCount, metrics, measurements, defaultHome: true,
    projectNavigation: true, savedConversationAndUnsentInput: true, accountDensityIsolation: true,
    reviewerOwnership: true, approvalFixtureOnlyInBrowser: true, errorRecovery: true, pageErrors: errors }, null, 2));
  console.log("Personal home, actual counts, project/task navigation, saved chat, account settings, reviewer isolation and error recovery PASS");
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    console.error(await page.evaluate(() => ({ title: document.querySelector('.workspace-header h1')?.textContent,
      alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
      chat: document.querySelector('.execution-workbench')?.textContent?.slice(-1800) })));
  }
  throw error;
} finally { await browser.close(); }
