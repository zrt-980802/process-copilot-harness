/* global document, window, getComputedStyle */
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

// One read-only demo gate against real services. Never creates chats or changes authority.
const root = path.resolve(import.meta.dirname, "../../..");
const output = path.join(root, "reports/fe-demo-01", new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(output, { recursive: false });
const report = { classification: "DEVELOPMENT PREVIEW", independent_acceptance: false, checks: [], errors: [] };
const save = (name, data) => fs.writeFile(path.join(output, name), JSON.stringify(data, null, 2));
const check = (name, details = {}) => { report.checks.push({ name, status: "PASS", ...details }); console.log(`PASS ${name}`); };
function docker(...args) { return execFileSync("docker", args, { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 }).trim(); }
function dataSnapshot() {
  const pc = {};
  for (const table of ["pc_ssts_workspace", "pc_ssts_input", "pc_ssts_message", "pc_ssts_draft", "pc_ssts_review"]) {
    pc[table] = JSON.parse(docker("exec", "pc-workbench-demo-pc-postgres-1", "psql", "-U", "pc_demo", "-d", "pc_demo", "-Atc",
      `SELECT json_build_object('count',count(*),'md5',md5(COALESCE(json_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''))) FROM ${table} t`));
  }
  const ee = JSON.parse(docker("exec", "pc-workbench-demo-ee-api-1", "python", "-c", `
import json,hashlib
from session.db import get_conn
tables=('eea_projects','eea_requirements','eea_functions','eea_requirement_functions','eea_function_ssts_links','eea_ssts_document','eea_spec_section','eea_spec_review','eea_harness_project_member','platform_account_roles','platform_role_permissions')
with get_conn() as c:
 rows={t:sorted([dict(r) for r in c.execute('SELECT * FROM '+t).fetchall()],key=lambda r:json.dumps(r,sort_keys=True,default=str)) for t in tables}
 rows['account_state']=[dict(r) for r in c.execute('SELECT id,username,status FROM platform_accounts ORDER BY id').fetchall()]
print(json.dumps({t:{'count':len(r),'sha256':hashlib.sha256(json.dumps(r,sort_keys=True,default=str).encode()).hexdigest()} for t,r in rows.items()}))`));
  return { pc, ee };
}
async function api(page, route) {
  return page.evaluate(async (route) => {
    const token = sessionStorage.getItem("pc.minimum-test.token");
    const response = await fetch(`/api${route}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const body = await response.json();
    if (!response.ok) throw new Error(`GET ${route}: ${response.status}`);
    return body;
  }, route);
}
async function screenshot(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false }); }
async function fit(page, selectors) {
  const geometry = await page.evaluate((selectors) => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    return { viewport: { width: window.innerWidth, height: window.innerHeight }, overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      controls: selectors.map((selector) => ({ selector, rect: document.querySelector(selector) ? rect(document.querySelector(selector)) : null })) };
  }, selectors);
  assert.equal(geometry.overflow, false, "page horizontal overflow");
  for (const { selector, rect } of geometry.controls) {
    assert(rect && rect.width > 0 && rect.height > 0 && rect.x >= -1 && rect.right <= geometry.viewport.width + 1 && rect.y >= -1 && rect.bottom <= geometry.viewport.height + 1, `offscreen control: ${selector} ${JSON.stringify(rect)}`);
  }
  return geometry;
}

const before = dataSnapshot();
await save("data-before.json", before);
let browser;
let active;
try {
  for (const origin of ["http://127.0.0.1:18091", "http://127.0.0.1:18092", "http://127.0.0.1:18191", "http://127.0.0.1:18192"]) {
    assert.equal((await fetch(origin)).status, 200, origin);
  }
  check("four-local-frontends-available");
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const accounts = [
    { key: "engineer", username: "demo.engineer", password: process.env.FE_ENGINEER_PASSWORD || "LocalAcceptanceSecret123" },
    { key: "reviewer", username: "demo.reviewer", password: process.env.FE_REVIEWER_PASSWORD || "LocalReviewerSecret123" },
    { key: "admin", username: "demo.admin", password: process.env.FE_ADMIN_PASSWORD || "LocalDemoAdminSecret123" }
  ];
  for (const account of accounts) {
    const context = await browser.createBrowserContext();
    const ee = await context.newPage(); active = ee;
    const errors = [];
    ee.on("pageerror", (error) => errors.push(error.message));
    await ee.setViewport({ width: 1440, height: 1000 });
    await ee.goto("http://127.0.0.1:18192/login?redirect=/403", { waitUntil: "domcontentloaded" });
    await ee.waitForSelector('input[autocomplete="username"]');
    await ee.type('input[autocomplete="username"]', account.username);
    await ee.type('input[autocomplete="current-password"]', account.password);
    await ee.click(".submit-button");
    await ee.waitForSelector(".account-trigger", { timeout: 45000 });
    const identity = (await api(ee, "/v1/auth/me")).data;
    assert.equal(identity.account.username, account.username);
    check(`${account.key}-real-EE-login`);
    for (const width of [1440, 1100, 390]) {
      await ee.setViewport({ width, height: width === 390 ? 844 : 1000 });
      await ee.waitForFunction((mobile) => !!document.querySelector(".mobile-pc-menu-item") === mobile, {}, width === 390);
      if (width === 390) await ee.click(".account-trigger");
      await ee.waitForSelector("a.global-pc-entry", { visible: true });
      const entry = await ee.$eval("a.global-pc-entry", (el) => ({ href: el.href, label: el.getAttribute("aria-label"), title: el.title, inHeader: !!el.closest(".app-header"), inMenu: !!el.closest(".el-dropdown-menu") }));
      assert.equal(entry.href, "http://127.0.0.1:18191/");
      assert.equal(entry.label, "打开 Process Copilot"); assert(entry.title.includes("新标签页"));
      assert.equal(entry.inMenu, width === 390); assert.equal(entry.inHeader, width !== 390);
      assert.equal(await ee.$$eval("a.global-pc-entry", (els) => els.filter((el) => el.getBoundingClientRect().width && getComputedStyle(el).visibility !== "hidden").length), 1);
      const geometry = await fit(ee, [".account-trigger", "a.global-pc-entry"]);
      if (width !== 390) assert(geometry.controls[1].rect.right <= geometry.controls[0].rect.x, "PC link overlaps account");
      await ee.focus("a.global-pc-entry");
      assert(await ee.$eval("a.global-pc-entry", (el) => el === document.activeElement));
      await screenshot(ee, `${account.key}-ee-${width}`);
      check(`${account.key}-EE-entry-${width}`, { geometry });
      if (width === 390) await ee.keyboard.press("Escape");
    }
    // A second authenticated route must use the same shell and have no old content entry.
    await ee.setViewport({ width: 1440, height: 1000 });
    await ee.goto(`http://127.0.0.1:18192/${account.key === "admin" ? "access-control" : "guide"}`, { waitUntil: "domcontentloaded" });
    await ee.waitForSelector(".app-header a.global-pc-entry");
    if (account.key === "admin") await ee.waitForSelector(".account-table", { timeout: 45000 });
    assert.equal(await ee.$$(".app-main .pc-entry, .app-main a.global-pc-entry").then((items) => items.length), 0);
    if (account.key === "admin") assert.equal(await ee.$$eval('.app-main a[href="http://127.0.0.1:18091/"]', (els) => els.length), 0);
    check(`${account.key}-global-shell-and-old-entry-removed`);
    // rel=noopener intentionally hides the opener; identify the isolated context instead.
    if (account.key === "admin") {
      await ee.setViewport({ width: 390, height: 844 });
      await ee.waitForSelector(".mobile-pc-menu-item");
      await ee.click(".account-trigger");
      await ee.waitForSelector(".mobile-pc-menu-item a.global-pc-entry", { visible: true });
    }
    const targetPromise = browser.waitForTarget((t) => t.browserContext() === context && t.url().startsWith("http://127.0.0.1:18191"));
    await ee.focus("a.global-pc-entry"); await ee.keyboard.press("Enter");
    const pc = await (await targetPromise).page(); active = pc;
    pc.on("pageerror", (error) => errors.push(error.message));
    await pc.setViewport({ width: 1440, height: 1000 });
    await pc.waitForSelector('.personal-home[aria-busy="false"]', { timeout: 90000 });
    assert.equal(await pc.$$(".home-error, .home-warning").then((items) => items.length), 0);
    const realIdentity = (await api(pc, "/ee-auth/me")).data;
    const expectedRole = realIdentity.is_system_admin ? "系统管理员" : [...new Set(realIdentity.roles.map((r) => r.name.trim()).filter(Boolean))].join(" / ") || "未分配平台角色";
    await pc.waitForFunction((text) => document.querySelector('[data-test="account-role"]')?.textContent === text, {}, expectedRole);
    const me = await api(pc, "/v1/identity/me");
    assert.equal(me.account.id, identity.account.id);
    const projects = (await api(pc, "/v1/workbench/projects")).items;
    const tasks = (await api(pc, "/v1/ssts-tasks")).tasks;
    check(`${account.key}-ordinary-link-keyboard-SSO-real-role`, { role: expectedRole, project_codes: projects.map((p) => p.project_code), task_count: tasks.length });
    for (const width of [1440, 1100, 390]) {
      await pc.setViewport({ width, height: width === 390 ? 844 : 1000 });
      await fit(pc, [".account-summary"]);
      await pc.click(".account-summary"); await pc.waitForSelector(".account-dialog[open]");
      assert((await pc.$eval(".account-dialog", (el) => el.textContent)).includes(expectedRole));
      await fit(pc, [".account-dialog[open]", '[title="关闭账号设置"]']);
      await screenshot(pc, `${account.key}-account-${width}`);
      await pc.click('[title="关闭账号设置"]');
      await screenshot(pc, `${account.key}-home-${width}`);
      check(`${account.key}-PC-personal-and-account-${width}`);
    }
    await pc.setViewport({ width: 1440, height: 1000 });
    if (account.key === "admin") {
      assert.equal(projects.length, 0, "admin must not inherit project access");
      await pc.click('.nav-rail > button[title="项目总览"]');
      await pc.waitForSelector(".project-scope-empty");
      assert((await pc.$eval(".project-scope-empty", (el) => el.textContent)).includes("暂无授权项目"));
      check("admin-can-enter-PC-without-project-membership");
    } else {
      assert(projects.some((p) => p.project_code === "EP37"));
      await pc.click('.home-project[data-project="EP37"]');
      await pc.waitForSelector(".desktop-content");
      await pc.waitForFunction(() => !document.querySelector(".project-loading"), { timeout: 60000 });
      assert.equal(await pc.$(".workbench-alert"), null);
      assert((await pc.$eval(".current-scope", (el) => el.textContent)).includes("项目范围"));
      const projectTask = tasks.find((t) => t.project_code === "EP37" && !t.conversation_mode) || tasks.find((t) => t.project_code === "EP37");
      assert(projectTask, "existing authorized project history required");
      const data = await api(pc, `/v1/workbench/tasks/${projectTask.workspace_id}/project-data`);
      const keys = Object.keys(data.results);
      const catalog = await api(pc, "/v1/workbench/catalog?project_code=EP37");
      const readNames = ["ee.get_project_context", "ee.list_requirements", "ee.list_functions", "ee.list_ssts", "ee.get_function_ssts_matrix", "ee.get_traceability_stats"];
      const expectedReads = readNames.filter((name) => catalog.tools.some((tool) => tool.tool_definition_id === name));
      assert.deepEqual(keys.slice().sort(), expectedReads.sort(), "real MCP reads match current role intersection");
      if (account.key === "engineer") assert.equal(keys.length, 6, "engineer six real MCP reads");
      for (const result of Object.values(data.results)) assert.equal(result.isError ?? false, false);
      check(`${account.key}-project-overview-and-real-MCP`, { tools: keys });
      for (const width of [1440, 1100, 390]) {
        await pc.setViewport({ width, height: width === 390 ? 844 : 1000 });
        await fit(pc, [".account-summary", 'select[aria-label="当前项目"]']);
        await screenshot(pc, `${account.key}-project-${width}`);
      }
      await pc.setViewport({ width: 1440, height: 1000 });
      // Exercise retained project conversation, not merely a scope selector.
      await pc.click('.nav-rail > button[title="首页"]');
      await pc.waitForSelector('.personal-home[aria-busy="false"]', { timeout: 90000 });
      const projectChat = await pc.evaluateHandle(() => [...document.querySelectorAll(".home-chat-row")].find((el) => el.querySelector("small")?.textContent.includes("项目范围 · EP37")));
      assert(projectChat.asElement(), "existing project conversation required");
      await projectChat.asElement().click();
      await pc.waitForFunction(() => document.querySelector('[data-test="workspace-scope"]')?.textContent.includes("项目范围 · EP37"), { timeout: 60000 });
      await pc.waitForFunction(() => document.querySelector('.chat-transcript')?.getAttribute("aria-busy") === "false", { timeout: 60000 });
      assert.equal(await pc.$(".chat-error"), null);
      assert(await pc.$(".chat-message.assistant .chat-markdown"));
      for (const width of [1440, 1100, 390]) {
        await pc.setViewport({ width, height: width === 390 ? 844 : 1000 });
        await fit(pc, [".turn-composer textarea", '.turn-composer button[type="submit"]']);
        await screenshot(pc, `${account.key}-project-conversation-${width}`);
      }
      check(`${account.key}-retained-project-conversation-three-widths`);
    }
    // Open retained conversation via UI only; never submit a prompt or create data.
    await pc.click('.nav-rail > button[title="首页"]');
    await pc.waitForSelector('.personal-home[aria-busy="false"]', { timeout: 90000 });
    const existingChat = await pc.$(".home-chat-row");
    assert(existingChat, "retained conversation needed for demo core path");
    await existingChat.click();
    await pc.waitForSelector(".turn-composer textarea", { timeout: 60000 });
    await pc.waitForFunction(() => document.querySelector('.chat-transcript')?.getAttribute("aria-busy") === "false", { timeout: 60000 });
    assert.equal(await pc.$(".chat-error"), null);
    assert(await pc.$(".chat-message.assistant .chat-markdown"), "real retained assistant Markdown");
    for (const width of [1440, 1100, 390]) {
      await pc.setViewport({ width, height: width === 390 ? 844 : 1000 });
      const geometry = await fit(pc, [".account-summary", ".turn-composer textarea", '.turn-composer button[type="submit"]', 'select[aria-label="对话范围"]']);
      await pc.select('select[aria-label="对话范围"]', "");
      assert((await pc.$eval('[data-test="workspace-scope"]', (el) => el.textContent)).includes("范围"));
      await pc.type(".turn-composer textarea", "前端输入区可用性检查（不发送）");
      await pc.$eval(".turn-composer textarea", (el) => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
      await screenshot(pc, `${account.key}-conversation-${width}`);
      check(`${account.key}-retained-conversation-and-composer-${width}`, { geometry });
    }
    assert.deepEqual(errors, [], "browser uncaught errors");
    check(`${account.key}-no-uncaught-page-errors`);
    await context.close(); active = undefined;
  }
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL"; report.errors.push(error.message); report.failure_stack = error.stack;
  if (active && !active.isClosed()) {
    await screenshot(active, "failure").catch(() => {});
    await save("failure-diagnostics.json", { url: active.url(), text: await active.evaluate(() => document.body.innerText.slice(0, 14000)).catch(() => "unavailable") });
  }
} finally {
  if (browser) await browser.close();
  const after = dataSnapshot(); await save("data-after.json", after);
  if (JSON.stringify(before) !== JSON.stringify(after)) { report.status = "FAIL"; report.errors.push("Candidate business data or authority changed"); }
  else check("candidate-business-data-and-authority-unchanged");
  await save("result.json", report);
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, errors: report.errors, evidence: output }));
}
process.exitCode = report.status === "PASS" ? 0 : 1;
