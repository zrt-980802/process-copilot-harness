/* global document, window, location, history */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const root = path.resolve(import.meta.dirname, "../..");
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const output = path.join(root, "reports/real-ee-read-retest-01", `browser-${stamp}`);
await mkdir(output, { recursive: true });
const base = "http://127.0.0.1:18891", standalone = "http://127.0.0.1:18890";
const calls = [], responses = [], checks = [], errors = [];
let stage = "initial", browser, activePage, adminToken;
let eeStopped = false, membershipRevoked = false;
const secrets = Object.entries(process.env).filter(([key, value]) => /PASSWORD|SECRET|API_KEY|SIGNING_KEY/u.test(key) && value?.length > 8).map(([, value]) => value);
async function save(name, value) {
  let text = JSON.stringify(value, null, 2); for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
  await writeFile(path.join(output, name), text);
}
function control(action) {
  const result = spawnSync(process.env.RC_PYTHON || "E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe", ["integration/real-ee-read-retest-01/run.py", action], { cwd: root, env: process.env, encoding: "utf8", timeout: 120_000 });
  assert.equal(result.status, 0, `Isolated control ${action} failed`);
  return result.stdout;
}
async function request(page, route, body) {
  return page.evaluate(async (route, body) => {
    const token = sessionStorage.getItem("pc.minimum-test.token");
    const response = await fetch(`/api${route}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, route, body);
}
async function recover() {
  if (!adminToken) {
  const headers = { "content-type": "application/json" };
  const login = await fetch(base + "/api/ee-auth/login", { method: "POST", headers, body: JSON.stringify({ username: "rc.admin", password: process.env.RC_ADMIN_PASSWORD }) });
  assert.equal(login.status, 200, "Test administrator EE login failed");
  const loginData = (await login.json()).data;
  headers.cookie = login.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
  headers["x-csrf-token"] = loginData.csrf_token;
  const verifier = randomBytes(32).toString("base64url");
  const launch = await fetch(base + "/api/ee-auth/process-copilot/launch", { method: "POST", headers,
    body: JSON.stringify({ audience: "process-copilot", code_challenge: createHash("sha256").update(verifier).digest("base64url") }) });
  assert.equal(launch.status, 200, "Test administrator ticket failed");
  const ticket = (await launch.json()).data.ticket;
  const exchange = await fetch(base + "/api/v1/auth/ee/exchange", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket, code_verifier: verifier }) });
  const exchangeData = await exchange.json();
  assert.equal(exchange.status, 200, `Test administrator PC exchange failed: ${JSON.stringify(exchangeData.error ?? {})}`);
  adminToken = exchangeData.access_token;
  }
  const response = await fetch(base + "/api/v1/providers/eeclaw/retry", { method: "POST", headers: { authorization: `Bearer ${adminToken}` } });
  const data = await response.json();
  responses.push({ stage, route: "explicit-provider-retry", status: response.status, body: data });
  assert.equal(response.status, 200, `Provider reload: ${JSON.stringify(data)}`);
}
const settle = page => page.waitForNetworkIdle({ idleTime: 200, timeout: 30_000 });
const nav = page => page.$$eval(".nav-rail > button", nodes => nodes.map(node => node.title));
const clickNav = (page, name) => page.click(`.nav-rail > button[title="${name}"]`);
async function screenshot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Horizontal overflow");
}
async function hidden(page, forbidden = /EE|SSTS|RCI-|RC Alpha|RC Beta|ee\./u) {
  const text = await page.$eval("body", node => node.textContent);
  assert(!forbidden.test(text), `External content remains in ${stage}: ${text}`);
  const client = await page.createCDPSession();
  const tree = await client.send("Accessibility.getFullAXTree"); await client.detach();
  assert(!forbidden.test(JSON.stringify(tree.nodes.filter(node => !node.ignored).map(node => node.name?.value))), "Hidden accessible content");
}
async function login(account, width, local = false) {
  stage = `${account}-${width}`; console.log(`REAL ${stage}`);
  if (!local) await recover();
  const context = await browser.createBrowserContext();
  const page = await context.newPage(); activePage = page;
  await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
  page.on("pageerror", error => errors.push({ stage, error: error.message }));
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/")) calls.push({ stage, method: request.method(), path: url.pathname + url.search }); });
  page.on("response", response => { const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 400) {
      void response.json().then(body => responses.push({ stage, route: url.pathname, status: response.status(), error_code: body?.error?.code })).catch(() => {});
    }
    if (/\/api\/(health|v1\/workbench\/(catalog|projects|capability-availability)|v1\/workbench\/tasks\/[^/]+\/(project-data|tools))$/u.test(url.pathname)) {
      void response.json().then(body => responses.push({ stage, route: url.pathname + url.search, status: response.status(), body })).catch(() => {});
    }
  });
  await page.goto((local ? standalone : base) + "/#owner=eea://projects/OLD", { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-test="login"]');
  await page.type('[autocomplete="username"]', `rc.${account}`);
  await page.type('[autocomplete="current-password"]', process.env[`RC_${account.toUpperCase()}_PASSWORD`]);
  await page.click('[data-test="login"]');
  await page.waitForSelector(".personal-home", { timeout: 30_000 }); await settle(page);
  assert.equal(await page.evaluate(() => location.hash), "");
  return { page, context };
}
async function create(page, project, title, ssts = false) {
  if (ssts && project) {
    await recover();
    await page.click(".refresh-experience"); await settle(page);
    await projectScope(page, project);
  }
  await clickNav(page, ssts ? "工作台" : "对话");
  if (ssts) {
    await page.$eval('[aria-label="新任务标题"]', (node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); }, title);
    await page.click('[data-test="create-task"]');
  } else {
    await page.select('[aria-label="对话范围"]', project);
    await page.$eval('[aria-label="对话名称"]', (node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); }, title);
    await page.click('[data-test="new-conversation"]');
  }
  await page.waitForFunction(title => document.querySelector(".workspace-header")?.textContent.includes(title), { timeout: 30_000 }, title);
  await settle(page);
  return page.$eval('.task-item.active', node => node.textContent);
}
async function projectScope(page, code) {
  await clickNav(page, "项目总览"); await settle(page);
  await page.select('[aria-label="当前项目"]', code); await settle(page);
}
try {
  await recover();
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  for (const width of [1440, 390]) {
    for (const account of ["personal", "zero", "admin"]) {
      const { page, context } = await login(account, width, account === "personal");
      await hidden(page); assert.deepEqual(await nav(page), ["首页", "对话"]);
      await page.click(".account-summary"); assert.equal(await page.$(".account-identifiers"), null); await page.click('[title="关闭账号设置"]');
      const paths = calls.filter(call => call.stage === stage).map(call => call.path);
      assert(!paths.some(route => /catalog|approvals|project-data/u.test(route)));
      if (account === "personal") assert(!paths.some(route => /ee-auth|workbench\/projects|capability-availability/u.test(route)));
      if (account === "admin") {
        const catalog = await request(page, "/v1/workbench/catalog?project_code=RCI-FULLA");
        assert.equal(catalog.status, 200); assert.deepEqual(catalog.body.tools, []);
        const denied = await request(page, "/v1/workbench/tasks", { title: "Must not create", project_code: "RCI-FULLA", mode: "CHAT" });
        assert.equal(denied.status, 403); responses.push({ stage, explicit_source_denial: denied, catalog });
      }
      await screenshot(page, `${account}-${width}`); checks.push(`${stage}: personal shell, request and account isolation`);
      await context.close();
    }
    if (process.env.RC_SKIP_GENERIC !== "1") {
      const { page, context } = await login("generic", width);
      assert((await nav(page)).includes("项目总览")); assert(!(await nav(page)).includes("工作台"));
      await create(page, "RCI-GENERIC", `Generic ${stamp} ${width}`);
      await clickNav(page, "项目总览"); await settle(page);
      assert.match(await page.$eval("body", node => node.textContent), /RC Generic Project/u);
      assert.equal(await page.$(".provider-unavailable, .workbench-alert"), null);
      assert(!/SSTS|EE 技术规范/u.test(await page.$eval("body", node => node.textContent)));
      await screenshot(page, `generic-${width}`); checks.push(`${stage}: actual source authorization removes SSTS tools`);
      await context.close();
    }
    {
      const { page, context } = await login("engineer", width);
      await projectScope(page, "RCI-ENG");
      await create(page, "RCI-ENG", `Engineering ${stamp} ${width}`, true);
      await clickNav(page, "工程"); await settle(page);
      assert.match(await page.$eval("body", node => node.textContent), /RCI-ENG supervision function/u);
      assert(!/EE 技术规范/u.test(await page.$eval("body", node => node.textContent)));
      await screenshot(page, `engineering-no-specifications-${width}`); checks.push(`${stage}: real functions without specification data`);
      await projectScope(page, "RCI-FULLA");
      await create(page, "RCI-FULLA", `Full Alpha ${stamp} ${width}`, true);
      await clickNav(page, "成果"); await settle(page);
      assert.match(await page.$eval("body", node => node.textContent), /SSTS-RCI-FULLA-1/u);
      await page.click(".data-table tbody tr"); await settle(page);
      assert.match(await page.$eval(".detail-drawer", node => node.textContent), /Source version 1/u);
      await screenshot(page, `full-detail-${width}`); checks.push(`${stage}: real specification snapshot and source`);
      await page.click('[title="关闭详情"]');
      await page.click(".account-summary"); await page.click(".account-identifiers summary"); await settle(page);
      assert.match(await page.$eval(".account-identifiers", node => node.textContent), /rc.engineer/u);
      await page.click('[title="关闭账号设置"]');
      await recover(); await page.click(".refresh-experience"); await settle(page);
      await projectScope(page, "RCI-FULLA");
      await clickNav(page, "工作台"); await settle(page);
      await page.click('.execution-tabs button:nth-child(2)');
      const readTool = await page.$$('.tool-roster button');
      for (const button of readTool) if ((await button.evaluate(node => node.textContent)).includes("ee.list_functions")) { await button.click(); break; }
      await page.click('.tool-form button[type="submit"]'); await settle(page);
      await page.click('.execution-tabs button:nth-child(3)');
      const operationStates = await page.$$eval(".evidence-row > span", nodes => nodes.map(node => node.textContent.trim()));
      assert(operationStates.length > 0 && operationStates.every(state => state === "SUCCEEDED"),
        `Business Operation not finalized: ${JSON.stringify(operationStates)}`);
      await screenshot(page, `real-mcp-trace-${width}`); checks.push(`${stage}: actual MCP dispatch, Operation and EE Trace`);
      await clickNav(page, "成果"); await settle(page); await page.click(".data-table tbody tr"); await settle(page);
      control("revoke"); membershipRevoked = true; await page.click(".refresh-experience"); await settle(page);
      await hidden(page, /RCI-FULLA|RC Alpha|SSTS-RCI-FULLA|Full Alpha/u);
      const visibleDetail = await page.$$eval(".detail-drawer, dialog[open] .account-identifiers",
        nodes => nodes.some(node => node.checkVisibility()));
      assert.equal(visibleDetail, false);
      await page.evaluate(() => { history.pushState(null, "", "#owner=eea://projects/RCI-FULLA"); history.back(); }); await settle(page);
      await hidden(page, /RCI-FULLA|RC Alpha|SSTS-RCI-FULLA|Full Alpha/u);
      await page.reload({ waitUntil: "networkidle0" }); await settle(page); await hidden(page, /RCI-FULLA|RC Alpha|SSTS-RCI-FULLA|Full Alpha/u);
      await screenshot(page, `revoked-${width}`); checks.push(`${stage}: revocation, detail cleanup, history and reload`);
      control("restore"); membershipRevoked = false; await context.close();
    }
    {
      const { page, context } = await login("reviewer", width);
      assert(!/RCI-FULLA|RC Alpha|RCI-ENG/u.test(await page.$eval("body", node => node.textContent)));
      const catalog = await request(page, "/v1/workbench/catalog?project_code=RCI-FULLA"); assert.deepEqual(catalog.body.tools, []);
      const denied = await request(page, "/v1/workbench/tasks", { title: "Must not create", project_code: "RCI-FULLA", mode: "CHAT" }); assert.equal(denied.status, 403);
      responses.push({ stage, cross_project: denied });
      await screenshot(page, `reviewer-isolation-${width}`); checks.push(`${stage}: disjoint accounts/projects`);
      await context.close();
    }
  }
  stage = "outage-connected-personal";
  const { page, context } = await login("engineer", 1440);
  await create(page, "", `Personal outage ${stamp}`);
  eeStopped = true; control("stop-ee");
  await page.click(".refresh-experience"); await settle(page);
  await hidden(page);
  await page.type('.workbench [aria-label="运行消息"]', "Reply with the single word CONNECTED.");
  await page.click('.workbench .turn-composer button[type="submit"]');
  await settle(page);
  await screenshot(page, "connected-personal-during-ee-outage");
  assert(!await page.$('.execution-workbench [role="alert"]'), "PC personal conversation failed during EE outage");
  assert.match(await page.$eval(".chat-transcript", node => node.textContent), /CONNECTED/u);
  checks.push("existing connected personal conversation survives real EE outage");
  control("start-ee"); eeStopped = false; await recover(); await context.close();
  assert.deepEqual(errors, []);
  const status = process.env.RC_SKIP_GENERIC === "1" ? "PARTIAL" : "PASS";
  await save("result.json", { status, classification: "real-pc-ee-api-mcp-isolated-integration", checks, calls, responses, errors });
  console.log(`REAL EE ${status}: ${output}`);
} catch (error) {
  await activePage?.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  await save("failure.json", { status: "FAIL", stage, error: error.stack, checks, calls, responses, errors });
  console.error(`REAL EE FAIL at ${stage}; evidence ${output}`);
  throw error;
} finally {
  try {
    if (membershipRevoked) control("restore");
    if (eeStopped) control("start-ee");
  } finally { await browser?.close(); }
}
