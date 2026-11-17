/* global document, innerWidth, innerHeight, window */
import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const root = "http://127.0.0.1:18091";
const evidence = process.env.PC_TEST_EVIDENCE_DIR ?? `reports/workbench-markdown/${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
await mkdir(evidence, { recursive: true });
assert.equal((await readdir(evidence)).length, 0, "Use a new evidence directory; previous evidence must be retained");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
const errors = [];
const pending = new Map();
const requests = [];
const stages = [];
let stage = "launch";
let page;
async function readyHome() {
  await page.waitForSelector('.personal-home[aria-busy="false"]');
  assert.equal(await page.$(".home-error"), null, "Home must load successfully");
  assert.equal(await page.$(".home-warning"), null, "Home must load all existing records");
}
async function navigate(name, operation) {
  stage = name;
  const started = Date.now();
  const response = await operation();
  assert([200, 304].includes(response?.status()), "Document must load successfully (including cache validation)");
  await readyHome();
  stages.push({ name, duration_ms: Date.now() - started });
}
try {
  page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const entry = { path: new URL(request.url()).pathname, method: request.method(), stage, started: Date.now() };
    requests.push(entry); pending.set(request, entry);
  });
  page.on("requestfinished", (request) => {
    const entry = pending.get(request);
    if (entry) { entry.duration_ms = Date.now() - entry.started; entry.status = request.response()?.status(); }
    pending.delete(request);
  });
  page.on("requestfailed", (request) => {
    const entry = pending.get(request);
    if (entry) { entry.duration_ms = Date.now() - entry.started; entry.failure = request.failure()?.errorText; }
    pending.delete(request);
  });
  await page.setViewport({ width: 1440, height: 1000 });
  stage = "login-document";
  assert.equal((await page.goto(root, { waitUntil: "domcontentloaded" }))?.status(), 200);
  await page.waitForSelector('[data-test="login"]');
  assert.equal(await page.$$eval(".login-form label", (nodes) => nodes.length), 2);
  assert.equal(await page.$('[autocomplete="organization"]'), null);
  await page.screenshot({ path: `${evidence}/login-1440.png`, fullPage: true });
  await page.type('[autocomplete="username"]', "demo.engineer");
  await page.type('[autocomplete="current-password"]', "LocalAcceptanceSecret123");
  await page.click('[data-test="login"]');
  stage = "login-home";
  await readyHome();
  const token = await page.evaluate(() => sessionStorage.getItem("pc.minimum-test.token"));
  async function api(path) {
    const response = await fetch(`${root}/api${path}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    return response.json();
  }
  const tasks = (await api("/v1/ssts-tasks")).tasks;
  const task = tasks.find((entry) => entry.function_code === "FN-EP37-001");
  assert(task, "Original SSTS task must remain available");
  await page.evaluate((id) => sessionStorage.setItem("pc.minimum-test.task", id), task.workspace_id);
  await navigate("restore-home", () => page.reload({ waitUntil: "domcontentloaded" }));
  async function openChat() {
    await page.$$eval(".nav-rail > button", (nodes) => nodes.find((node) => node.textContent.trim() === "对话").click());
    await page.waitForSelector(".chat-message.assistant .chat-markdown");
  }
  await openChat();
  stage = "real-markdown";
  assert(await page.$(".chat-markdown table"), "Existing SSTS response must render its Markdown table");
  assert(await page.$(".chat-markdown h2"), "Existing SSTS response must render headings");
  await page.screenshot({ path: `${evidence}/real-conversation-1440.png`, fullPage: true });

  const historyPath = `/v1/workbench/tasks/${task.workspace_id}/conversation`;
  const stored = await api(historyPath);
  const fixture = ["## Markdown 验证", "", "**重点**与*强调*、~~删除~~、`FN-EP37-001`。", "",
    "- 第一个项目", "- 第二个项目", "", "1. 检查输入", "2. 确认结果", "", "> 评审备注", "",
    "| 功能 | 状态 |", "| --- | --- |", "| 电源监测 | 已确认 |", "| CAN 新鲜度 | 待评审 |", "",
    "```json", '{"code":"FN-EP37-001","value":"' + "long-code-value-".repeat(20) + '"}', "```", "",
    "[参考链接](https://example.com/reference)", "[危险链接](javascript:window.__markdownUnsafe=1)",
    '<script>window.__markdownUnsafe=1</script><img src=x onerror="window.__markdownUnsafe=1">',
    '<svg onload="window.__markdownUnsafe=1"></svg><iframe srcdoc="<script>alert(1)</script>"></iframe>'].join("\n");
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().endsWith(historyPath)) {
      void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({
        messages: [...stored.messages, { message_id: "markdown-rendering-fixture", role: "assistant", content: fixture,
          sequence: 999999, occurred_at: new Date().toISOString() }] }) });
    } else void request.continue();
  });
  await navigate("fixture-home", () => page.reload({ waitUntil: "domcontentloaded" }));
  await openChat();
  stage = "fixture-markdown";
  const selector = '[data-message-id="markdown-rendering-fixture"] .chat-markdown';
  await page.waitForSelector(`${selector} table`);
  const rendered = await page.$eval(selector, (node) => ({
    heading: node.querySelector("h2")?.textContent, strong: node.querySelector("strong")?.textContent,
    tableRows: node.querySelectorAll("tbody tr").length, unordered: node.querySelectorAll("ul li").length,
    ordered: node.querySelectorAll("ol li").length, code: node.querySelector("pre code")?.textContent,
    link: node.querySelector("a")?.getAttribute("href"), quote: !!node.querySelector("blockquote"),
    unsafeNodes: node.querySelectorAll("script,img,svg,iframe,[onerror],[onload],a[href^='javascript:']").length,
    executed: window.__markdownUnsafe === 1
  }));
  assert.equal(rendered.heading, "Markdown 验证"); assert.equal(rendered.strong, "重点");
  assert.equal(rendered.tableRows, 2); assert.equal(rendered.unordered, 2); assert.equal(rendered.ordered, 2);
  assert(rendered.code.includes('"code":"FN-EP37-001"')); assert(rendered.quote);
  assert.equal(rendered.link, "https://example.com/reference");
  assert.equal(rendered.unsafeNodes, 0); assert.equal(rendered.executed, false);
  const dimensions = [];
  for (const width of [1440, 1100, 390]) {
    stage = `layout-${width}`;
    await page.setViewport({ width, height: 1000 });
    await page.$eval(selector, (node) => node.scrollIntoView({ block: "end" }));
    const sizes = await page.evaluate(() => {
      const composer = document.querySelector(".turn-composer").getBoundingClientRect();
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        composerBottom: composer.bottom, height: innerHeight };
    });
    assert(sizes.scrollWidth <= sizes.width); assert(sizes.composerBottom <= sizes.height);
    dimensions.push(sizes);
    await page.screenshot({ path: `${evidence}/markdown-fixture-${width}.png`, fullPage: true });
  }
  assert.deepEqual((await api(historyPath)).messages, stored.messages, "Browser fixture must not modify persisted history");
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/result.json`, JSON.stringify({ status: "pass", loginTenantHidden: true,
    realHistoryRendered: true, fixtureOnlyInBrowser: true, rendered, dimensions, pageErrors: errors, stages }, null, 2), { flag: "wx" });
  console.log("Hidden tenant login, real Markdown history, formatting, safe HTML and responsive layout PASS");
} catch (error) {
  const failure = { status: "FAIL", stage, error: error.message, stages, pageErrors: errors,
    pending: [...pending.values()] };
  if (page) {
    await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true }).catch(() => {});
    failure.document = await page.evaluate(() => ({ readyState: document.readyState,
      homeBusy: document.querySelector(".personal-home")?.getAttribute("aria-busy"),
      homePresent: !!document.querySelector(".personal-home"), loginPresent: !!document.querySelector(".login-form") })).catch(() => null);
  }
  await writeFile(`${evidence}/failure.json`, JSON.stringify(failure, null, 2), { flag: "wx" });
  throw error;
} finally {
  await writeFile(`${evidence}/network.json`, JSON.stringify({ stages, requests,
    pending: [...pending.values()] }, null, 2), { flag: "wx" });
  await browser.close();
}
