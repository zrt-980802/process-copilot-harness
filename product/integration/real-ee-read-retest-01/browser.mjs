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
const observations = [];
const targetedTimeout = 20_000;
const projectRenderTimeout = 25_000;
let stage = "initial", browser, activePage, adminToken;
let eeStopped = false, membershipRevoked = false;
let modelOutageTurn, lastCreatedWorkspaceId;
const secrets = Object.entries(process.env).filter(([key, value]) => /PASSWORD|SECRET|API_KEY|SIGNING_KEY/u.test(key) && value?.length > 8).map(([, value]) => value);
async function save(name, value) {
  let text = JSON.stringify(value, null, 2); for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
  await writeFile(path.join(output, name), text);
}
function safeHttp(result) {
  return { status: result.status, ...(result.body?.error?.code ? { error_code: result.body.error.code } : {}) };
}
function safeFailure(error) {
  const stack = error instanceof Error ? error.stack ?? "" : "";
  const location = /browser\.mjs:\d+:\d+/u.exec(stack)?.[0];
  return { name: error instanceof Error ? error.name : "Error",
    ...(typeof error?.code === "string" ? { code: error.code } : {}), ...(location ? { location } : {}) };
}
function recordObservation(kind, body) {
  if (kind === "health") {
    observations.push({ stage, kind, provider_registration_id: body.provider_health?.provider_registration_id,
      provider_state: body.provider_health?.provider_state, checked_at: body.provider_health?.checked_at,
      observed_at: body.provider_bundle?.observed_at, expires_at: body.provider_bundle?.expires_at,
      bundle_generation: body.provider_bundle?.bundle_generation });
  } else {
    observations.push({ stage, kind, provider_registration_id: body.provider_registration_id,
      principal_id: body.principal_id, tenant_id: body.tenant_id, observed_at: body.observed_at,
      expires_at: body.expires_at });
  }
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
async function unavailable(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(3_000) }); return false; }
  catch { return true; }
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
  responses.push({ stage, route: "explicit-provider-retry", ...safeHttp({ status: response.status, body: data }) });
  assert.equal(response.status, 200, `Provider reload failed: ${data?.error?.code ?? response.status}`);
}
const settle = page => page.waitForNetworkIdle({ idleTime: 200, timeout: 30_000 });
const nav = page => page.$$eval(".nav-rail > button", nodes => nodes.map(node => node.title));
const clickNav = (page, name) => page.click(`.nav-rail > button[title="${name}"]`);
async function clickExecutionTab(page, label) {
  await page.waitForFunction(label => [...document.querySelectorAll('.execution-tabs button[role="tab"]')]
    .some(node => node.textContent?.trim().startsWith(label)), { timeout: 30_000 }, label);
  const clicked = await page.$$eval('.execution-tabs button[role="tab"]', (nodes, label) => {
    const target = nodes.find(node => node.textContent?.trim().startsWith(label));
    if (!target || typeof target.click !== "function") return false;
    target.click(); return true;
  }, label);
  assert.equal(clicked, true, `Execution tab unavailable: ${label}`);
}
async function chooseTool(page, name) {
  await page.waitForFunction(name => [...document.querySelectorAll(".tool-roster button")]
    .some(node => node.textContent?.includes(name)), { timeout: 30_000 }, name);
  const count = await page.$$eval(".tool-roster button", (nodes, name) => nodes
    .filter(node => node.textContent?.includes(name)).length, name);
  assert.equal(count, 1, `Expected one current ${name} tool, found ${count}`);
  await page.$$eval(".tool-roster button", (nodes, name) => {
    const target = nodes.find(node => node.textContent?.includes(name));
    if (target && typeof target.click === "function") target.click();
  }, name);
  await page.waitForSelector('.tool-form button[type="submit"]:not([disabled])', { timeout: 30_000 });
}
async function screenshot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Horizontal overflow");
}
async function hidden(page, forbidden = /EE|SSTS|RCI-|RC Alpha|RC Beta|ee\./u) {
  const text = await page.$eval("body", node => node.textContent);
  assert(!forbidden.test(text), `External content remains in ${stage}`);
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
  page.on("pageerror", error => errors.push({ stage, ...safeFailure(error) }));
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/")) calls.push({ stage, method: request.method(), path: url.pathname + url.search }); });
  page.on("response", response => { const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 400) {
      void response.json().then(body => responses.push({ stage, route: url.pathname, status: response.status(), error_code: body?.error?.code })).catch(() => {});
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
async function create(page, project, title, ssts = false, expectedRow) {
  if (ssts && project) {
    await prepareCurrentProject(page, project);
  }
  await clickNav(page, ssts ? "工作台" : "对话");
  if (ssts) await page.waitForFunction(project => document.querySelector('[aria-label="项目"]')?.value === project,
    { timeout: targetedTimeout }, project);
  const createdPromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/v1/workbench/tasks";
  }, { timeout: 30_000 });
  if (ssts) {
    await page.$eval('[aria-label="新任务标题"]', (node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); }, title);
    await page.click('[data-test="create-task"]');
  } else {
    await page.select('[aria-label="对话范围"]', project);
    await page.$eval('[aria-label="对话名称"]', (node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); }, title);
    await page.click('[data-test="new-conversation"]');
  }
  const createdResponse = await createdPromise;
  assert.equal(createdResponse.status(), 201, "Workspace creation failed");
  const created = await createdResponse.json();
  assert.match(created.workspace_id, /^ssts_workspace_[A-Za-z0-9-]+$/u);
  lastCreatedWorkspaceId = created.workspace_id;
  await page.waitForFunction(title => document.querySelector(".workspace-header")?.textContent.includes(title), { timeout: 30_000 }, title);
  const activeTask = await page.$eval('.task-item.active', node => node.textContent);
  if (expectedRow) await waitForProjectRow(page, created.workspace_id, expectedRow.view, expectedRow.selector, expectedRow.text);
  else if (!ssts) await settle(page);
  return activeTask;
}
async function projectScope(page, code, catalog) {
  await clickNav(page, "项目总览");
  await page.waitForFunction(code => [...document.querySelectorAll('[aria-label="当前项目"] option')]
    .some(option => option.value === code), { timeout: targetedTimeout }, code);
  const current = await page.$eval('[aria-label="当前项目"]', node => node.value);
  if (current !== code) await page.select('[aria-label="当前项目"]', code);
  assert.equal((await catalog).status(), 200, `Current catalog unavailable for ${code}`);
  responses.push({ stage, route: `/api/v1/workbench/catalog?project_code=${code}`, status: 200, project_code: code });
  await page.waitForFunction(code => document.querySelector('[aria-label="当前项目"]')?.value === code
    && [...document.querySelectorAll('.nav-rail > button')].some(node => node.title === "工作台")
    && !document.querySelector('.provider-unavailable'), { timeout: targetedTimeout }, code);
}
async function prepareCurrentProject(page, code) {
  await recover();
  const health = page.waitForResponse(response => new URL(response.url()).pathname === "/api/health",
    { timeout: targetedTimeout });
  const availability = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/workbench/capability-availability",
    { timeout: targetedTimeout });
  const projects = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === "/api/v1/workbench/projects";
  }, { timeout: targetedTimeout });
  const catalog = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === "/api/v1/workbench/catalog"
      && url.searchParams.get("project_code") === code;
  }, { timeout: targetedTimeout });
  await page.click(".refresh-experience");
  const [healthResponse, availabilityResponse, projectsResponse] = await Promise.all([health, availability, projects]);
  assert.equal(healthResponse.status(), 200, "Experience health refresh failed");
  assert.equal(availabilityResponse.status(), 200, "Capability availability refresh failed");
  assert.equal(projectsResponse.status(), 200, "Current project directory unavailable");
  recordObservation("health", await healthResponse.json());
  recordObservation("availability", await availabilityResponse.json());
  await page.waitForFunction(() => !document.querySelector(".provider-unavailable")
    && !!document.querySelector('.nav-rail > button[title="项目总览"]'), { timeout: targetedTimeout });
  await projectScope(page, code, catalog);
}
async function waitForProjectRow(page, workspaceId, view, selector, expected) {
  const route = `/api/v1/workbench/tasks/${workspaceId}/project-data`;
  const projectData = page.waitForResponse(response => new URL(response.url()).pathname === route,
    { timeout: targetedTimeout });
  await clickNav(page, view);
  const response = await projectData;
  assert.equal(response.status(), 200, `Project data unavailable for ${workspaceId}`);
  responses.push({ stage, route, status: response.status(), workspace_id: workspaceId });
  await page.waitForFunction(({ selector, expected }) => [...document.querySelectorAll(selector)]
    .some(node => node.textContent?.trim() === expected), { timeout: projectRenderTimeout }, { selector, expected });
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
        assert.equal(denied.status, 403); responses.push({ stage, route: "explicit-source-denial",
          denial: safeHttp(denied), catalog: safeHttp(catalog) });
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
      await create(page, "RCI-ENG", `Engineering ${stamp} ${width}`, true,
        { view: "工程", selector: ".relationship-map .function-node strong", text: "RCI-ENG supervision function" });
      assert(!/EE 技术规范/u.test(await page.$eval("body", node => node.textContent)));
      await screenshot(page, `engineering-no-specifications-${width}`); checks.push(`${stage}: real functions without specification data`);
      await create(page, "RCI-FULLA", `Full Alpha ${stamp} ${width}`, true,
        { view: "成果", selector: ".data-table tbody tr .code-cell", text: "SSTS-RCI-FULLA-1" });
      const detailOpened = await page.$$eval(".data-table tbody tr", rows => {
        const row = rows.find(node => node.querySelector(".code-cell")?.textContent?.trim() === "SSTS-RCI-FULLA-1");
        if (!row || typeof row.click !== "function") return false;
        row.click(); return true;
      });
      assert.equal(detailOpened, true, "Expected current RCI-FULLA specification row");
      await page.waitForFunction(() => document.querySelector(".detail-drawer")?.textContent.includes("Source version 1"), { timeout: 15_000 });
      await screenshot(page, `full-detail-${width}`); checks.push(`${stage}: real specification snapshot and source`);
      await page.click('[title="关闭详情"]');
      await page.click(".account-summary"); await page.click(".account-identifiers summary"); await settle(page);
      assert.match(await page.$eval(".account-identifiers", node => node.textContent), /rc.engineer/u);
      await page.click('[title="关闭账号设置"]');
      const currentTask = await create(page, "RCI-FULLA", `MCP trace ${stamp} ${width}`, true);
      assert.match(currentTask, /MCP trace/u);
      await clickExecutionTab(page, "工具");
      await chooseTool(page, "ee.list_functions");
      const toolResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === "POST"
          && url.pathname === `/api/v1/workbench/tasks/${lastCreatedWorkspaceId}/tools`;
      }, { timeout: 60_000 });
      await page.click('.tool-form button[type="submit"]');
      assert.equal((await toolResponse).status(), 200, "Current MCP tool call failed");
      await clickExecutionTab(page, "证据与追溯");
      await page.waitForFunction(() => {
        const states = [...document.querySelectorAll(".evidence-row > span")].map(node => node.textContent?.trim());
        return states.length > 0 && states.every(state => state === "SUCCEEDED");
      }, { timeout: 30_000 });
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
      responses.push({ stage, route: "cross-project-denial", denial: safeHttp(denied), catalog: safeHttp(catalog) });
      await screenshot(page, `reviewer-isolation-${width}`); checks.push(`${stage}: disjoint accounts/projects`);
      await context.close();
    }
  }
  stage = "outage-connected-personal";
  const { page, context } = await login("engineer", 1440);
  stage = "outage-connected-personal";
  await create(page, "", `Personal outage ${stamp}`);
  const outageWorkspaceId = lastCreatedWorkspaceId;
  assert(outageWorkspaceId, "Personal outage workspace is required");
  eeStopped = true; control("stop-ee");
  const eeUnavailable = {
    api: await unavailable("http://127.0.0.1:18892/api/health"),
    mcp: await unavailable("http://127.0.0.1:18893/health")
  };
  assert.deepEqual(eeUnavailable, { api: true, mcp: true }, "EE endpoints must be stopped before the personal turn");
  await page.click(".refresh-experience"); await settle(page);
  await hidden(page);
  await page.waitForFunction(() => document.querySelector('.chat-transcript')?.getAttribute("aria-busy") === "false");
  const conversationPath = `/v1/workbench/tasks/${outageWorkspaceId}/conversation`;
  const baselineConversation = await request(page, conversationPath);
  assert.equal(baselineConversation.status, 200);
  const baselineIds = baselineConversation.body.messages.map(message => message.message_id);
  assert.deepEqual(await page.$$eval('.chat-message[data-message-id]', nodes => nodes.map(node => node.dataset.messageId)), baselineIds);
  const prompt = "Calculate nineteen plus twenty-three. Reply with only the decimal result.";
  const turnStartedAt = new Date().toISOString();
  const turnResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "POST"
      && url.pathname === `/api/v1/workbench/tasks/${outageWorkspaceId}/turns`;
  }, { timeout: 240_000 });
  await page.type('.workbench [aria-label="运行消息"]', prompt);
  await page.click('.workbench .turn-composer button[type="submit"]');
  const turnResponse = await turnResponsePromise;
  assert.equal(turnResponse.status(), 200, "Personal model turn did not complete successfully");
  const turn = await turnResponse.json();
  assert.match(turn.turn_id, /^[A-Za-z0-9:_-]+$/u);
  assert.equal(turn.content.trim(), "42", "Personal model turn returned unexpected content");
  await page.waitForFunction(({ known, expected }) => {
    const transcript = document.querySelector('.chat-transcript');
    if (transcript?.getAttribute("aria-busy") !== "false" || document.querySelector('.chat-running')) return false;
    return [...document.querySelectorAll('.chat-message.assistant[data-message-id]')]
      .some(node => !known.includes(node.dataset.messageId)
        && node.querySelector('.chat-markdown')?.textContent?.trim() === expected);
  }, { timeout: 60_000 }, { known: baselineIds, expected: "42" });
  const conversation = await request(page, conversationPath);
  assert.equal(conversation.status, 200);
  const newMessages = conversation.body.messages.filter(message => !baselineIds.includes(message.message_id));
  assert.equal(newMessages.length, 2, "Expected exactly one new user and assistant message");
  const userMessages = newMessages.filter(message => message.role === "user" && message.content === prompt);
  const assistantMessages = newMessages.filter(message => message.role === "assistant" && message.content.trim() === "42");
  assert.equal(userMessages.length, 1, "Expected one new projected user message");
  assert.equal(assistantMessages.length, 1, "Expected one new projected assistant message");
  const userMessage = userMessages[0], assistantMessage = assistantMessages[0];
  assert.equal(assistantMessage.sequence, userMessage.sequence + 1, "Assistant projection must immediately follow the user message");
  assert.equal(conversation.body.messages.length, baselineConversation.body.messages.length + 2);
  const domAssistant = await page.$$eval('.chat-message.assistant[data-message-id]', (nodes, messageId) => {
    const matches = nodes.filter(node => node.dataset.messageId === messageId);
    return { count: matches.length, visible: matches[0]?.checkVisibility() ?? false,
      content: matches[0]?.querySelector('.chat-markdown')?.textContent?.trim() ?? "" };
  }, assistantMessage.message_id);
  assert.deepEqual(domAssistant, { count: 1, visible: true, content: "42" });
  assert.equal(await page.$('.chat-error, .inline-error, .chat-running'), null);
  modelOutageTurn = {
    stage, workspace_id: outageWorkspaceId, turn_id: turn.turn_id,
    turn_http_status: turnResponse.status(), assistant_message_id: assistantMessage.message_id,
    user_sequence: userMessage.sequence, assistant_sequence: assistantMessage.sequence,
    assistant_content_sha256: createHash("sha256").update(turn.content.trim()).digest("hex"),
    conversation_before_count: baselineIds.length, conversation_after_count: conversation.body.messages.length,
    ee_endpoints_stopped: eeUnavailable, turn_started_at: turnStartedAt, turn_completed_at: new Date().toISOString(),
    assertions: ["turn_known_success", "new_assistant_projection", "dom_role_bound", "no_ui_error"]
  };
  await settle(page);
  await screenshot(page, "connected-personal-during-ee-outage");
  assert(!await page.$('.execution-workbench [role="alert"]'), "PC personal conversation failed during EE outage");
  checks.push("existing linked personal conversation completes a model turn during real EE outage");
  control("start-ee"); eeStopped = false; await recover(); await context.close();
  assert.deepEqual(errors, []);
  const status = process.env.RC_SKIP_GENERIC === "1" ? "PARTIAL" : "PASS";
  await save("result.json", { status, classification: "real-pc-ee-api-mcp-isolated-integration", checks,
    model_outage_turn: modelOutageTurn, observations, calls, responses, errors });
  console.log(`REAL EE ${status}: ${output}`);
} catch (error) {
  await activePage?.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  await save("failure.json", { status: "FAIL", stage, failure: safeFailure(error), checks, observations, calls, responses, errors });
  console.error(`REAL EE FAIL at ${stage}; evidence ${output}`);
  throw new Error(`Real EE browser fixture failed at ${stage}`);
} finally {
  try {
    if (membershipRevoked) control("restore");
    if (eeStopped) control("start-ee");
  } finally { await browser?.close(); }
}
