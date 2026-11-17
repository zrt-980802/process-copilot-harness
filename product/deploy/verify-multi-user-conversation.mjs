/* global document */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import puppeteer from "puppeteer-core";
import { readAccessAccounts } from "./read-access-accounts.mjs";

const evidence = process.env.PC_TEST_EVIDENCE_DIR ?? "reports/multi-user-conversation";
const runTag = process.env.PC_TEST_RUN_TAG ?? "";
await mkdir(evidence, { recursive: true });
const result = { status: "RUNNING", checks: [], accounts: [], turns: [] };
const errors = [];
let acceptanceAdmin, acceptanceOriginal;
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const check = name => { result.checks.push(name); console.log(name); };
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();
const userContainers = () => docker("ps", "-a", "--filter", "label=pc.demo.project=pc-workbench-demo", "--format", "{{.Names}}").split("\n").filter(Boolean).sort();
async function context() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(120_000);
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  return { ctx, page };
}
async function call(page, path, method = "GET", body, pc = true) {
  return page.evaluate(async ({ path, method, body, pc }) => {
    const csrf = document.cookie.split("; ").find(p => p.startsWith("eea_csrf="))?.slice(9);
    const token = sessionStorage.getItem("pc.minimum-test.token");
    const response = await fetch(path, { method, headers: { "content-type": "application/json",
      ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}), ...(pc && token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); } catch { value = { error: text.slice(0, 200) }; }
    return { status: response.status, body: value };
  }, { path, method, body, pc });
}
async function api(actor, path, method = "GET", body) {
  const response = await call(actor.page, `/api${path}`, method, body);
  assert(response.status >= 200 && response.status < 300, `${path}: ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body;
}
async function login(actor, username, password) {
  await actor.page.bringToFront();
  await actor.page.goto("http://127.0.0.1:18091/", { waitUntil: "networkidle0" });
  await actor.page.waitForSelector(".login-form");
  await actor.page.type('[autocomplete="username"]', username);
  await actor.page.type('[autocomplete="current-password"]', password);
  await actor.page.click('[data-test="login"]');
  await actor.page.waitForSelector('.personal-home[aria-busy="false"]');
  actor.me = await api(actor, "/v1/identity/me");
  actor.name = username;
  return actor;
}
async function create(actor, label, project_code) {
  const title = `Multi-user acceptance: ${label}${runTag ? ` [${runTag}]` : ""}`;
  const tasks = (await api(actor, "/v1/ssts-tasks")).tasks;
  const existing = tasks.find(t => t.title === title);
  const workspace = existing ?? await api(actor, "/v1/workbench/tasks", "POST", { title, mode: "CHAT", ...(project_code ? { project_code } : {}) });
  assert(workspace?.workspace_id, "created workspace required");
  return workspace;
}
async function turn(actor, workspace, prompt, expected) {
  const started = Date.now();
  const response = await api(actor, `/v1/workbench/tasks/${workspace.workspace_id}/turns`, "POST", { prompt });
  assert(response.content?.trim(), "real model response is empty");
  if (expected) assert(response.content.includes(expected), `${actor.name} response missing ${expected}: ${response.content}`);
  result.turns.push({ account: actor.name, workspace_id: workspace.workspace_id, turn_id: response.turn_id,
    content: response.content, elapsed_ms: Date.now() - started });
  console.log(`Real model turn completed: ${actor.name} (${Date.now() - started} ms)`);
  return response;
}
const base = workspace => `/v1/workbench/tasks/${workspace.workspace_id}`;
try {
  const before = userContainers();
  const engineer = await login(await context(), "demo.engineer", "LocalAcceptanceSecret123");
  const reviewer = await login(await context(), "demo.reviewer", "LocalReviewerSecret123");
  const admin = await login(await context(), "demo.admin", "LocalDemoAdminSecret123");
  const adminEe = await admin.ctx.newPage();
  await adminEe.goto("http://127.0.0.1:18092/access-control", { waitUntil: "networkidle0" });
  const fresh = await context();
  await fresh.page.goto("http://127.0.0.1:18092/login", { waitUntil: "networkidle0" });
  const username = "conversation.acceptance";
  const password = "LocalConversationAcceptanceSecret123";
  const prior = (await readAccessAccounts(query => call(adminEe, `/api/v1/${query}`, "GET", undefined, false))).find(a => a.username === username);
  acceptanceAdmin = adminEe;
  acceptanceOriginal = prior;
  if (prior) {
    assert.equal(prior.display_name, "Conversation acceptance", "reserved synthetic acceptance account required");
    if (prior.status !== "active") assert.equal((await call(adminEe, `/api/v1/access/accounts/${prior.id}`, "PATCH", {
      display_name: "Conversation acceptance", email: null, status: "active" }, false)).status, 200);
  }
  const registered = await call(fresh.page, "/api/v1/auth/register", "POST", { username, display_name: "Conversation acceptance", password, password_confirm: password }, false);
  if (registered.status !== 201) assert.equal((await call(fresh.page, "/api/v1/auth/login", "POST", { username, password }, false)).status, 200);
  await fresh.page.goto("http://127.0.0.1:18091/", { waitUntil: "networkidle0" });
  await fresh.page.waitForSelector('.personal-home[aria-busy="false"]');
  fresh.me = await api(fresh, "/v1/identity/me"); fresh.name = username;
  const actors = [engineer, reviewer, admin, fresh];
  for (const actor of actors) {
    actor.chat = await create(actor, "personal");
    const state = await api(actor, `${base(actor.chat)}/execution`);
    if (!state.session) assert.deepEqual((await api(actor, `${base(actor.chat)}/conversation`)).messages, []);
    result.accounts.push({ username: actor.name, principal_id: actor.me.principal.principal_id,
      ee_account_id: actor.me.account.id, workspace_id: actor.chat.workspace_id });
  }
  assert.deepEqual(userContainers(), before);
  for (const actor of [admin, fresh]) {
    assert.deepEqual((await api(actor, "/v1/workbench/projects")).items, []);
    assert.deepEqual((await api(actor, "/v1/workbench/catalog?project_code=EP37")).tools, []);
    assert.equal((await call(actor.page, "/api/v1/workbench/tasks", "POST", { title: "forbidden project", mode: "CHAT", project_code: "EP37" })).status, 403);
  }
  check("Four real accounts log in and create empty chats without allocating runtimes; ungranted accounts have no project tools");
  const markers = ["ENGINEER_MK_4671", "REVIEWER_MK_8259", "ADMIN_MK_3197", "FRESH_MK_7523"].map(marker => `${marker}${runTag ? `_${runTag}` : ""}`);
  await Promise.all(actors.map((actor, i) => turn(actor, actor.chat, `Remember this private conversation marker: ${markers[i]}. Reply with that marker only.`, markers[i])));
  const states = await Promise.all(actors.map(actor => api(actor, `${base(actor.chat)}/execution`)));
  const runtimeIds = states.map(state => state.session.assignment.runtime_id);
  assert.equal(new Set(runtimeIds).size, 4);
  for (let i = 0; i < actors.length; i++) {
    actors[i].runtime = runtimeIds[i];
    const history = await api(actors[i], `${base(actors[i].chat)}/conversation`);
    assert(history.messages.some(m => m.role === "assistant" && m.content.includes(markers[i])));
    for (let j = 0; j < actors.length; j++) if (i !== j) assert(!JSON.stringify(history).includes(markers[j]));
    for (const suffix of ["/conversation", "/execution", "/project-data"]) assert.equal((await call(actors[(i + 1) % 4].page, `/api${base(actors[i].chat)}${suffix}`)).status, 403);
    for (const suffix of ["/cancel", "/turns", "/tools"]) assert.equal((await call(actors[(i + 1) % 4].page, `/api${base(actors[i].chat)}${suffix}`, "POST", { prompt: "foreign", call_id: randomUUID(), arguments: {}, tool_release_id: "forged" })).status, 403);
  }
  check("All four accounts completed concurrent real model turns in distinct runtimes; history and commands reject cross-user access");
  const second = await create(reviewer, "second isolated personal");
  await Promise.all([
    turn(reviewer, reviewer.chat, "What private marker did I give earlier? Reply only with the marker.", markers[1]),
    turn(reviewer, second, "This is a new conversation. Reply exactly SECOND_SESSION_OK.", "SECOND_SESSION_OK")
  ]);
  assert.equal((await api(reviewer, `${base(second)}/execution`)).session.assignment.runtime_id, reviewer.runtime);
  assert(!JSON.stringify(await api(reviewer, `${base(second)}/conversation`)).includes(markers[1]));
  check("Two concurrent sessions of one user reuse their runtime while retaining separate conversation histories");
  const project = await create(reviewer, "reviewer EP37", "EP37");
  const catalog = (await api(reviewer, "/v1/workbench/catalog?project_code=EP37")).tools;
  assert.equal(catalog.length, 4);
  await turn(reviewer, project, "Call ee.get_project_context for the current project. Summarize the real project name and cite the returned eea://traces/ reference. Do not guess.", "eea://traces/");
  const projectState = await api(reviewer, `${base(project)}/execution`);
  assert(projectState.ledger.some(entry => entry.external?.outcome_state === "KNOWN_SUCCESS"));
  const facts = await api(reviewer, `${base(project)}/project-data`);
  assert(Object.keys(facts.results).length > 0);
  assert(!facts.results["ee.list_functions"]);
  const engineerCatalog = (await api(engineer, "/v1/workbench/catalog?project_code=EP37")).tools;
  const forbidden = engineerCatalog.find(t => t.tool_definition_id === "ee.list_functions");
  assert.equal((await call(reviewer.page, `/api${base(project)}/tools`, "POST", { tool_release_id: forbidden.tool_release_id, call_id: randomUUID(), arguments: {} })).status, 403);
  assert.equal((await call(reviewer.page, `/api${base(reviewer.chat)}/tools`, "POST", { tool_release_id: catalog[0].tool_release_id, call_id: randomUUID(), arguments: {} })).status, 403);
  check("Reviewer project conversation calls real permitted MCP; forbidden functions and personal-chat enterprise tools are denied");
  const roles = (await call(adminEe, "/api/v1/access/roles", "GET", undefined, false)).body.data.items;
  const accounts = await readAccessAccounts(query => call(adminEe, `/api/v1/${query}`, "GET", undefined, false));
  const reviewerRole = roles.find(role => accounts.find(a => a.id === reviewer.me.account.id).roles.some(r => r.id === role.id));
  const pageKeys = reviewerRole.permissions.filter(p => p.effect === "allow" && p.permission_key.startsWith("page:") && p.permission_key !== "page:*").map(p => p.permission_key);
  const actionKeys = reviewerRole.permissions.filter(p => p.effect === "allow" && p.permission_key.startsWith("action:")).map(p => p.permission_key);
  try {
    assert.equal((await call(adminEe, `/api/v1/access/roles/${reviewerRole.id}/permissions`, "PUT", {
      allowed_page_keys: pageKeys.filter(key => key !== "page:architecture"), allowed_action_keys: actionKeys }, false)).status, 200);
    assert.equal((await call(reviewer.page, `/api${base(project)}/turns`, "POST", { prompt: "must not execute with missing required tool permission" })).status, 403);
    await turn(reviewer, reviewer.chat, "Reply exactly PERSONAL_STILL_OK.", "PERSONAL_STILL_OK");
  } finally {
    assert.equal((await call(adminEe, `/api/v1/access/roles/${reviewerRole.id}/permissions`, "PUT", {
      allowed_page_keys: pageKeys, allowed_action_keys: actionKeys }, false)).status, 200);
  }
  check("Removing a real EE role permission rejects existing project chat while personal chat remains available; role restored");
  await reviewer.page.bringToFront();
  await reviewer.page.evaluate(id => sessionStorage.setItem("pc.minimum-test.task", id), reviewer.chat.workspace_id);
  await reviewer.page.reload({ waitUntil: "networkidle0" });
  await reviewer.page.waitForSelector('.personal-home[aria-busy="false"]');
  await reviewer.page.$$eval(".nav-rail > button", nodes => nodes.find(n => n.textContent.trim() === "对话").click());
  await reviewer.page.waitForSelector(".chat-message.assistant");
  const uiTitle = `Browser acceptance chat${runTag ? ` [${runTag}]` : ""}`;
  await reviewer.page.$eval('[aria-label="对话名称"]', (node, title) => { node.value = title; node.dispatchEvent(new Event("input", { bubbles: true })); }, uiTitle);
  await reviewer.page.click('[data-test="new-conversation"]');
  await reviewer.page.waitForFunction(title => document.querySelector('.workspace-header h1')?.textContent === title, {}, uiTitle);
  const uiWorkspace = (await api(reviewer, "/v1/ssts-tasks")).tasks.find(t => t.title === uiTitle);
  assert.equal((await api(reviewer, `${base(uiWorkspace)}/execution`)).session, undefined);
  await reviewer.page.type('.turn-composer textarea', "Reply with a Markdown heading '## Browser acceptance' and a two-column Markdown table containing UI_CHAT_OK and READY. No tools.");
  await reviewer.page.click('.turn-composer button[type="submit"]');
  await reviewer.page.waitForFunction(() => document.querySelector('.chat-message.assistant')?.textContent.includes("UI_CHAT_OK"));
  assert(await reviewer.page.$('.chat-message.assistant h2'));
  assert(await reviewer.page.$('.chat-message.assistant table'));
  check("Browser new-conversation and send controls complete a real model turn; Markdown heading and table render");
  for (const width of [1440, 1100, 390]) {
    await reviewer.page.setViewport({ width, height: 900 });
    assert(await reviewer.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `overflow ${width}`);
    assert(await reviewer.page.$('[data-test="new-conversation"]'));
    const composer = await reviewer.page.$eval('.turn-composer textarea', node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    assert(composer.top >= 0 && composer.bottom <= 900, `composer clipped ${width}: ${JSON.stringify(composer)}`);
    await reviewer.page.screenshot({ path: `${evidence}/reviewer-chat-${width}.png`, fullPage: true });
  }
  await reviewer.page.setViewport({ width: 1440, height: 1000 });
  check("Reviewer chat survives browser reload; new chat and history render at desktop, narrow desktop and mobile widths");
  docker("restart", "pc-workbench-demo-pc-api-1", reviewer.runtime);
  await reviewer.page.waitForFunction(async () => { try { return (await fetch('/api/ready')).ok; } catch { return false; } });
  await turn(reviewer, reviewer.chat, "What private marker did I give earlier? Reply only with the marker.", markers[1]);
  assert.equal((await api(reviewer, `${base(reviewer.chat)}/execution`)).session.assignment.runtime_id, reviewer.runtime);
  const inspected = JSON.parse(docker("inspect", "--format", "{{json .Mounts}}", reviewer.runtime));
  assert(inspected.some(m => m.Destination.endsWith(reviewer.me.principal.principal_id) && m.RW === false));
  assert(!inspected.some(m => m.Destination === "/data" || m.Destination.includes("docker.sock")));
  const parent = JSON.parse(docker("inspect", "--format", "{{json .Mounts}}", "pc-workbench-demo-pc-runtime-1"));
  assert(parent.some(m => m.Destination === "/runtime-state"));
  check("API and reviewer runtime restart retain model context; reviewer mounts only their own read-only data subtree");
  for (const runtimeId of runtimeIds) {
    const health = JSON.parse(docker("exec", runtimeId === "pc-workbench-demo-runtime" ? "pc-workbench-demo-pc-runtime-1" : runtimeId,
      "node", "-e", "console.log(await (await fetch('http://127.0.0.1:3100/health')).text())"));
    assert.equal(health.event_export.state, "READY", `event export ${runtimeId}: ${JSON.stringify(health.event_export)}`);
    assert(health.event_export.last_success_at, `no events exported by ${runtimeId}`);
  }
  check("All four runtimes export actual conversation events successfully to the authenticated API ingestion route");
  const legacy = (await api(engineer, "/v1/ssts-tasks")).tasks.find(t => t.function_code === "FN-EP37-001");
  assert(legacy);
  const legacyFacts = await api(engineer, `${base(legacy)}/project-data`);
  assert.equal(Object.keys(legacyFacts.results).length, 6);
  assert((await api(engineer, `${base(legacy)}/conversation`)).messages.some(m => m.role === "assistant"));
  check("Original engineer SSTS task, history and six real MCP reads remain usable");
  const inFlight = call(fresh.page, `/api${base(fresh.chat)}/turns`, "POST", { prompt: "Write a detailed 600 word technical explanation of database transactions and isolation levels." });
  const freshRuntime = runtimeIds[3];
  let running = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const health = JSON.parse(docker("exec", freshRuntime, "node", "-e", "console.log(await (await fetch('http://127.0.0.1:3100/health')).text())"));
    if (health.active_sessions > 0) { running = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(running, "must observe a real running turn before revocation");
  const revoked = await call(adminEe, `/api/v1/access/accounts/${fresh.me.account.id}/revoke-sessions`, "POST", {}, false);
  assert.equal(revoked.status, 200);
  assert.equal((await inFlight).status, 401, "revoked caller must not receive the in-flight model output");
  assert.equal((await call(fresh.page, `/api${base(fresh.chat)}/conversation`)).status, 401);
  assert.equal((await call(fresh.page, `/api${base(fresh.chat)}/turns`, "POST", { prompt: "must not execute" })).status, 401);
  assert.equal((await call(adminEe, `/api/v1/access/accounts/${fresh.me.account.id}`, "PATCH", { display_name: "Conversation acceptance", email: null, status: "disabled" }, false)).status, 200);
  check("Real EE revocation during a running model turn prevents output delivery and blocks history/further execution; synthetic account disabled");
  assert.deepEqual(errors, []);
  result.runtime_ids = runtimeIds;
  result.console_errors = errors;
  result.status = "PASS";
} catch (error) { result.status = "FAIL"; result.failure = error.stack; throw error; }
finally {
  try {
    if (acceptanceAdmin && acceptanceOriginal) {
      const restored = await call(acceptanceAdmin, `/api/v1/access/accounts/${acceptanceOriginal.id}`, "PATCH", {
        display_name: acceptanceOriginal.display_name, email: acceptanceOriginal.email, status: acceptanceOriginal.status }, false);
      assert.equal(restored.status, 200, "restore acceptance account status");
    }
  } finally { await writeFile(`${evidence}/result.json`, JSON.stringify(result, null, 2)); await browser.close(); }
}
