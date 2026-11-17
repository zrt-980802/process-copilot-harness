/* global document */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import puppeteer from "puppeteer-core";
import { readAccessAccounts } from "./read-access-accounts.mjs";

const evidence = process.env.PC_TEST_EVIDENCE_DIR ?? "reports/unified-login";
await mkdir(evidence, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: ["--no-first-run", "--no-default-browser-check"] });
const errors = [];
const result = { status: "RUNNING", checks: [], accounts: [] };
const check = name => { result.checks.push(name); console.log(name); };
async function context() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  return { ctx, page };
}
async function call(page, path, method = "GET", body, pc = false) {
  return page.evaluate(async ({ path, method, body, pc }) => {
    const csrf = document.cookie.split("; ").find(p => p.startsWith("eea_csrf="))?.slice(9);
    const token = sessionStorage.getItem("pc.minimum-test.token");
    const response = await fetch(path, { method, headers: { "content-type": "application/json",
      ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}), ...(pc && token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : {} };
  }, { path, method, body, pc });
}
async function eeLogin(page, username, password) {
  const response = await call(page, "/api/v1/auth/login", "POST", { username, password });
  assert.equal(response.status, 200, `EE login ${username}: ${response.status}`);
  return response.body.data.account;
}
async function pcLogin(page, username, password) {
  await page.bringToFront();
  await page.goto("http://127.0.0.1:18091/", { waitUntil: "networkidle0" });
  await page.waitForSelector(".login-form");
  await page.type('[autocomplete="username"]', username);
  await page.type('[autocomplete="current-password"]', password);
  await page.click('[data-test="login"]');
  await page.waitForSelector('.personal-home[aria-busy="false"]');
  const me = await call(page, "/api/v1/identity/me", "GET", undefined, true);
  assert.equal(me.status, 200);
  assert.equal(me.body.account.username, username);
  assert.equal(await page.$('[autocomplete="current-password"]'), null);
  return me.body;
}
try {
  const admin = await context();
  await admin.page.goto("http://127.0.0.1:18092/login", { waitUntil: "networkidle0" });
  await eeLogin(admin.page, "demo.admin", "LocalDemoAdminSecret123");
  await admin.page.goto("http://127.0.0.1:18092/access-control", { waitUntil: "networkidle0" });
  await admin.page.waitForSelector(".account-table");
  const mapping = await call(admin.page, "/api/v1/access/accounts/process-copilot-bindings");
  assert.equal(mapping.status, 200);
  const bindings = mapping.body.data.items;
  const historical = bindings.find(b => b.legacy_account_keys.includes("pilot.acceptance"));
  assert(historical);
  await admin.page.type(".keyword input", "demo.engineer");
  await admin.page.keyboard.press("Enter");
  await admin.page.waitForFunction(() => document.querySelector(".account-table")?.textContent.includes("pilot.acceptance"));
  assert((await admin.page.$eval(".account-table", node => node.textContent)).includes("pilot.acceptance"));
  await admin.page.screenshot({ path: `${evidence}/ee-account-bindings.png`, fullPage: true });
  check("EE admin account table shows actual PC Principal and historical aliases");

  const engineer = await context();
  const me = await pcLogin(engineer.page, "demo.engineer", "LocalAcceptanceSecret123");
  assert.equal(me.principal.principal_id, historical.principal_id);
  assert.equal(String(me.account.id), historical.ee_account_id);
  const before = await call(engineer.page, "/api/v1/ssts-tasks", "GET", undefined, true);
  assert(before.body.tasks.length >= 3);
  await engineer.page.click('[title="账号与设置"]');
  assert((await engineer.page.$eval(".account-dialog", node => node.textContent)).includes("demo.engineer"));
  await engineer.page.screenshot({ path: `${evidence}/pc-engineer-account.png`, fullPage: true });
  await engineer.page.click('[title="关闭账号设置"]');
  await engineer.page.reload({ waitUntil: "networkidle0" });
  await engineer.page.waitForSelector('.personal-home[aria-busy="false"]');
  const after = await call(engineer.page, "/api/v1/ssts-tasks", "GET", undefined, true);
  assert.deepEqual(after.body.tasks.map(t => t.workspace_id).sort(), before.body.tasks.map(t => t.workspace_id).sort());
  result.accounts.push({ username: "demo.engineer", principal_id: me.principal.principal_id, tasks: before.body.tasks.length });
  check("PC EE password login preserves Principal and all existing task IDs across refresh");
  const eePage = await engineer.ctx.newPage();
  await eePage.goto("http://127.0.0.1:18092/", { waitUntil: "networkidle0" });
  assert.equal((await call(eePage, "/api/v1/auth/me")).body.data.account.username, "demo.engineer");
  assert.equal((await call(eePage, "/api/v1/access/accounts/process-copilot-bindings")).status, 403);
  check("PC login opens the same EE account; engineer cannot read admin associations");
  const engineerRoles = (await readAccessAccounts(query => call(admin.page, `/api/v1/${query}`))).find(a => a.id === me.account.id).roles;
  const allRoles = (await call(admin.page, "/api/v1/access/roles")).body.data.items;
  const role = allRoles.find(r => engineerRoles.some(assigned => assigned.id === r.id));
  const pageKeys = role.permissions.filter(p => p.effect === "allow" && p.permission_key.startsWith("page:") && p.permission_key !== "page:*").map(p => p.permission_key);
  const actionKeys = role.permissions.filter(p => p.effect === "allow" && p.permission_key.startsWith("action:")).map(p => p.permission_key);
  const catalogPath = "/api/v1/workbench/catalog?project_code=EP37";
  const toolsBefore = (await call(engineer.page, catalogPath, "GET", undefined, true)).body.tools;
  assert.equal(toolsBefore.length, 9);
  try {
    assert.equal((await call(admin.page, `/api/v1/access/roles/${role.id}/permissions`, "PUT", {
      allowed_page_keys: pageKeys.filter(key => key !== "page:functions"), allowed_action_keys: actionKeys })).status, 200);
    const changed = await call(engineer.page, catalogPath, "GET", undefined, true);
    assert.equal(changed.status, 200);
    assert(changed.body.tools.length < toolsBefore.length);
    assert(!changed.body.tools.some(t => t.tool_definition_id === "ee.list_functions"));
  } finally {
    assert.equal((await call(admin.page, `/api/v1/access/roles/${role.id}/permissions`, "PUT", {
      allowed_page_keys: pageKeys, allowed_action_keys: actionKeys })).status, 200);
  }
  assert.equal((await call(engineer.page, catalogPath, "GET", undefined, true)).body.tools.length, 9);
  check("Real EE role permission removal immediately reduces PC Catalog and restoration recovers it");
  assert.equal((await call(engineer.page, "/api/v1/pilot/sign-in", "POST", { account_key: "pilot.acceptance" })).status, 403);
  assert.equal((await call(engineer.page, "/api/v1/internal/identity/ee-bindings")).status, 403);
  assert.equal((await call(engineer.page, "/api/ee-auth/process-copilot/launch", "POST", {})).status, 400);
  check("Browser legacy Pilot and internal identity routes remain closed");

  const reviewer = await context();
  await reviewer.page.goto("http://127.0.0.1:18092/login", { waitUntil: "networkidle0" });
  await eeLogin(reviewer.page, "demo.reviewer", "LocalReviewerSecret123");
  await reviewer.page.goto("http://127.0.0.1:18091/", { waitUntil: "networkidle0" });
  await reviewer.page.waitForSelector('.personal-home[aria-busy="false"]');
  const reviewerMe = await call(reviewer.page, "/api/v1/identity/me", "GET", undefined, true);
  assert.equal(reviewerMe.body.account.username, "demo.reviewer");
  assert.equal((await call(reviewer.page, catalogPath, "GET", undefined, true)).body.tools.length, 4);
  const denied = await call(reviewer.page, `/api/v1/ssts-tasks/${before.body.tasks[0].workspace_id}`, "GET", undefined, true);
  assert.equal(denied.status, 403);
  await reviewer.page.screenshot({ path: `${evidence}/ee-to-pc-reviewer.png`, fullPage: true });
  check("Active EE session enters PC without password; another account cannot read engineer tasks");
  const adminPc = await admin.ctx.newPage();
  await adminPc.goto("http://127.0.0.1:18091/", { waitUntil: "networkidle0" });
  await adminPc.waitForSelector('.personal-home[aria-busy="false"]');
  assert.deepEqual((await call(adminPc, "/api/v1/workbench/projects", "GET", undefined, true)).body.items, []);
  check("EE platform administrator still has no implicit project membership in PC");

  const fresh = await context();
  await fresh.page.goto("http://127.0.0.1:18092/login", { waitUntil: "networkidle0" });
  const username = `unified.test.${Date.now()}`;
  const password = `Test${randomBytes(18).toString("hex")}`;
  const registered = await call(fresh.page, "/api/v1/auth/register", "POST", { username, display_name: "统一登录验收账号", password, password_confirm: password });
  assert.equal(registered.status, 201);
  const freshId = registered.body.data.account.id;
  await fresh.page.goto("http://127.0.0.1:18091/", { waitUntil: "networkidle0" });
  await fresh.page.waitForSelector('.personal-home[aria-busy="false"]');
  const freshMe = await call(fresh.page, "/api/v1/identity/me", "GET", undefined, true);
  assert.equal(freshMe.body.account.username, username);
  assert.deepEqual((await call(fresh.page, "/api/v1/ssts-tasks", "GET", undefined, true)).body.tasks, []);
  assert.deepEqual((await call(fresh.page, "/api/v1/workbench/projects", "GET", undefined, true)).body.items, []);
  assert.equal((await call(fresh.page, "/api/v1/workbench/tasks", "POST", { title: "denied", project_code: "EP37", mode: "READ" }, true)).status, 403);
  await fresh.page.screenshot({ path: `${evidence}/fresh-account-empty-home.png`, fullPage: true });
  const freshBindings = await call(admin.page, "/api/v1/access/accounts/process-copilot-bindings");
  assert.deepEqual(freshBindings.body.data.items.find(b => b.ee_account_id === String(freshId)).legacy_account_keys, []);
  result.accounts.push({ username, ee_account_id: freshId, principal_id: freshMe.body.principal.principal_id, tasks: 0, projects: 0 });
  check("New EE account receives stable PC identity with no Pilot account, tasks or project access");
  assert.equal((await call(admin.page, `/api/v1/access/accounts/${freshId}/revoke-sessions`, "POST", {})).status, 200);
  assert.equal((await call(fresh.page, "/api/v1/ssts-tasks", "GET", undefined, true)).status, 401);
  await fresh.page.reload({ waitUntil: "networkidle0" });
  await fresh.page.waitForSelector(".login-form");
  await pcLogin(fresh.page, username, password);
  const nextPassword = `Reset${randomBytes(18).toString("hex")}`;
  assert.equal((await call(admin.page, `/api/v1/access/accounts/${freshId}/reset-password`, "POST", { password: nextPassword, password_confirm: nextPassword })).status, 200);
  const wrongPasswordContext = await context();
  await wrongPasswordContext.page.goto("http://127.0.0.1:18092/login", { waitUntil: "networkidle0" });
  assert.equal((await call(wrongPasswordContext.page, "/api/v1/auth/login", "POST", { username, password })).status, 401);
  await wrongPasswordContext.ctx.close();
  assert.equal((await call(fresh.page, "/api/v1/identity/me", "GET", undefined, true)).status, 401);
  await fresh.page.reload({ waitUntil: "networkidle0" });
  await pcLogin(fresh.page, username, nextPassword);
  assert.equal((await call(admin.page, `/api/v1/access/accounts/${freshId}`, "PATCH", { display_name: "统一登录验收账号", email: null, status: "disabled" })).status, 200);
  assert.equal((await call(fresh.page, "/api/v1/ssts-tasks", "GET", undefined, true)).status, 401);
  check("EE revoke-all, password reset and disable each block existing PC token on its next request");

  await engineer.page.bringToFront();
  await engineer.page.click('[title="退出登录"]');
  await engineer.page.waitForSelector(".login-form");
  assert.equal((await call(eePage, "/api/v1/auth/me")).status, 401);
  await engineer.page.reload({ waitUntil: "networkidle0" });
  await engineer.page.waitForSelector(".login-form");
  await pcLogin(engineer.page, "demo.reviewer", "LocalReviewerSecret123");
  assert.equal((await call(engineer.page, "/api/v1/identity/me", "GET", undefined, true)).body.principal.principal_id, reviewerMe.body.principal.principal_id);
  check("PC logout revokes EE browser session; switching account resolves the correct Principal");

  for (const width of [1440, 1100]) {
    await engineer.page.setViewport({ width, height: 900 });
    assert(await engineer.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await engineer.page.screenshot({ path: `${evidence}/pc-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  result.status = "PASS";
  result.console_errors = errors;
  await writeFile(`${evidence}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.status = "FAIL";
  result.failure = error.message;
  await writeFile(`${evidence}/result.json`, JSON.stringify(result, null, 2));
  throw error;
} finally { await browser.close(); }
