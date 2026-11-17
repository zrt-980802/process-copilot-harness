/* global document, location */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const evidence = "reports/personal-capabilities-ee-admin";
await mkdir(evidence, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
const errors = [];
const result = { capabilities: [], ee: {} };
let page;
async function clickText(selector, text) {
  await page.$$eval(selector, (nodes, text) => {
    const node = nodes.find((item) => item.textContent.trim() === text);
    if (!node) throw new Error(`Missing ${selector}: ${text}`);
    node.click();
  }, text);
}
async function eeApi(path) {
  return page.evaluate(async (path) => {
    const response = await fetch(`/api/v1${path}`);
    return { status: response.status, body: await response.json() };
  }, path);
}
try {
  for (const account of ["pilot.acceptance", "reviewer.acceptance"]) {
    const context = await browser.createBrowserContext();
    page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    const signIn = await fetch("http://127.0.0.1:18091/api/v1/pilot/sign-in", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_id: "tenant_acceptance", account_key: account,
        secret: account === "pilot.acceptance" ? "LocalAcceptanceSecret123" : "LocalReviewerSecret123" }) });
    assert.equal(signIn.status, 200);
    const { access_token: token } = await signIn.json();
    const pcApi = async (path) => {
      const response = await fetch(`http://127.0.0.1:18091/api${path}`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200); return response.json();
    };
    const projects = (await pcApi("/v1/workbench/projects")).items;
    const catalogs = await Promise.all(projects.map(async project => ({ project: project.project_code,
      tools: (await pcApi(`/v1/workbench/catalog?project_code=${project.project_code}`)).tools })));
    await page.goto("http://127.0.0.1:18091", { waitUntil: "networkidle0" });
    await page.evaluate(token => sessionStorage.setItem("pc.minimum-test.token", token), token);
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector('.personal-home[aria-busy="false"]');
    assert(!(await page.$$eval(".nav-rail > button", nodes => nodes.map(node => node.textContent.trim()))).includes("能力"));
    const requests = [];
    page.on("request", request => requests.push(request.url()));
    await clickText(".home-tabs button", "我的能力");
    await page.waitForSelector('.personal-capabilities[aria-busy="false"]');
    assert.equal(await page.$(".personal-capabilities .home-warning"), null);
    const unique = [...new Set(catalogs.flatMap(catalog => catalog.tools.map(tool => tool.tool_release_id)))];
    assert.equal((await page.$$(".capability-item")).length, unique.length);
    await page.click(".capability-item"); await page.waitForSelector('[aria-label="能力详情"]');
    assert((await page.$eval('[aria-label="能力详情"]', node => node.textContent)).includes("审批策略"));
    await page.click('[title="关闭能力详情"]');
    for (const catalog of catalogs) {
      await page.select('[aria-label="筛选首页项目"]', catalog.project);
      assert.equal((await page.$$(".capability-item")).length, catalog.tools.length);
      assert((await page.$$eval(".capability-projects", nodes => nodes.map(node => node.textContent))).every(text => text.trim() === catalog.project));
    }
    await page.select('[aria-label="筛选首页项目"]', "");
    await page.type('[aria-label="搜索个人工作"]', "not-a-real-tool");
    assert.equal((await page.$$(".capability-item")).length, 0);
    await page.$eval('[aria-label="搜索个人工作"]', node => { node.value = ""; node.dispatchEvent(new Event("input", { bubbles: true })); });
    for (const width of [1440, 1100]) {
      await page.setViewport({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      await page.screenshot({ path: `${evidence}/${account}-${width}.png`, fullPage: true });
    }
    assert(!requests.some(url => /\/(conversation|project-data|turns)$/.test(url)), "Capabilities must not prepare Runtime or invoke tools");
    if (account === "pilot.acceptance") {
      await clickText(".nav-rail > button", "工作");
      await page.waitForFunction(() => document.querySelector(".quick-workflows button:last-child span")?.textContent.includes("9"));
      await page.click(".quick-workflows button:last-child");
      await page.waitForSelector('.personal-capabilities[aria-busy="false"]');
      assert.equal(await page.$eval('[aria-label="筛选首页项目"]', node => node.value), projects[0].project_code);
    }
    result.capabilities.push({ account, uniqueTools: unique.length,
      projects: catalogs.map(catalog => ({ project: catalog.project, tools: catalog.tools.length })), filter: true, search: true, noRuntimeCalls: true });
    await context.close();
  }
  const context = await browser.createBrowserContext();
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.setViewport({ width: 1500, height: 1050 });
  await page.goto("http://127.0.0.1:18092/access-control", { waitUntil: "networkidle0" });
  await page.type('[name="username"]', "demo.admin");
  await page.type('[name="password"]', "LocalDemoAdminSecret123");
  await page.click(".submit-button");
  await page.waitForSelector(".access-page .account-table .el-table__body tbody tr");
  const accounts = await eeApi("/access/accounts"); assert.equal(accounts.status, 200);
  const roles = await eeApi("/access/roles"); assert.equal(roles.status, 200);
  const permissions = await eeApi("/access/permissions"); assert.equal(permissions.status, 200);
  assert(accounts.body.data.items.some(account => account.username === "demo.admin"));
  assert(accounts.body.data.items.some(account => account.username === "demo.engineer"));
  assert(roles.body.data.items.some(role => role.role_key === "pc_demo_engineer"));
  await page.screenshot({ path: `${evidence}/ee-accounts.png`, fullPage: true });
  await page.$$eval(".account-table .el-table__body tbody tr", nodes => {
    const row = nodes.find(node => node.textContent.includes("demo.engineer"));
    row.querySelectorAll(".row-actions button")[1].click();
  });
  await page.waitForSelector(".role-options");
  await page.screenshot({ path: `${evidence}/ee-assign-roles.png`, fullPage: true });
  await clickText(".el-dialog__footer button", "取消");
  await clickText('.access-tabs [role="tab"]', "角色权限");
  await page.waitForSelector(".role-row");
  await page.$$eval(".role-row", nodes => nodes.find(node => node.textContent.includes("pc_demo_engineer")).click());
  await page.waitForFunction(() => document.querySelector(".permission-header")?.textContent.includes("演示工程师"));
  await page.screenshot({ path: `${evidence}/ee-role-permissions.png`, fullPage: true });
  await clickText('.access-tabs [role="tab"]', "访问记录");
  await page.waitForSelector(".logs-panel .el-table__body tbody tr");
  await page.screenshot({ path: `${evidence}/ee-access-logs.png`, fullPage: true });
  const audit = await eeApi("/access/logs"); assert.equal(audit.status, 200);
  assert.equal(await page.$(".access-page .el-alert--error"), null);
  result.ee = { accountNames: accounts.body.data.items.map(account => account.username),
    roles: roles.body.data.items, permissions: permissions.body.data.items.length,
    roleAssignmentDialog: true, rolePermissionsPage: true, auditPage: true };
  await context.close();
  const deniedContext = await browser.createBrowserContext();
  page = await deniedContext.newPage();
  await page.goto("http://127.0.0.1:18092/login", { waitUntil: "networkidle0" });
  const denied = await page.evaluate(async () => {
    const login = await fetch("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo.engineer", password: "LocalAcceptanceSecret123" }) });
    const accounts = await fetch("/api/v1/access/accounts");
    const internal = await fetch("/api/internal/process-copilot/projects");
    return { login: login.status, accounts: accounts.status, internal: internal.status };
  });
  assert.deepEqual(denied, { login: 200, accounts: 403, internal: 403 });
  result.ee.engineerDeniedAdmin = denied;
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/result.json`, JSON.stringify({ status: "pass", ...result, pageErrors: errors }, null, 2));
  console.log("Personal capabilities and actual EE accounts / roles / audit UI PASS; engineer administration denied");
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
    console.error(await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(-1800) })));
  }
  throw error;
} finally { await browser.close(); }
