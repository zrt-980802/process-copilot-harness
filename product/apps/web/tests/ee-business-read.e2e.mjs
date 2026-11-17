/* global document */
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const output = path.resolve("reports/ee-business-read", `browser-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await fs.mkdir(output, { recursive: true });
const report = { classification: "DEVELOPMENT PREVIEW / developer self verification", checks: [], responses: [], errors: [] };
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
let page;
async function navigate(route, endpoints) {
  const received = endpoints.map((endpoint) => page.waitForResponse((r) => new URL(r.url()).pathname === endpoint, { timeout: 30000 }));
  await page.goto(`http://127.0.0.1:18092${route}`, { waitUntil: "domcontentloaded" });
  const responses = await Promise.all(received);
  for (const response of responses) assert.equal(response.status(), 200, response.url());
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".el-loading-mask"));
  assert.equal(await page.$(".el-message--error"), null, route);
  return Promise.all(responses.map((r) => r.json()));
}
try {
  for (const [role, password] of [["engineer", "LocalAcceptanceSecret123"], ["reviewer", "LocalReviewerSecret123"], ["admin", "LocalDemoAdminSecret123"]]) {
    const context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on("response", (r) => {
      const url = new URL(r.url());
      if (url.pathname.startsWith("/api/")) report.responses.push({ role, path: url.pathname + url.search, status: r.status() });
    });
    page.on("pageerror", (e) => report.errors.push({ role, error: e.message }));
    await page.goto("http://127.0.0.1:18092/login?redirect=/projects", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[autocomplete="username"]');
    await page.type('[autocomplete="username"]', `demo.${role}`);
    await page.type('[autocomplete="current-password"]', process.env[`WEB_READ_${role.toUpperCase()}_PASSWORD`] || password);
    const first = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/projects");
    await page.click(".submit-button");
    assert.equal((await first).status(), 200);
    await page.waitForSelector(".account-trigger");
    const [projects] = await navigate("/projects", ["/api/projects"]);
    assert.equal(projects.total, role === "admin" ? 0 : 2);
    if (role !== "admin") {
      assert.deepEqual(projects.items.map((r) => r.code).sort(), ["EP37", "EP38"]);
      assert(await page.$eval(".app-main", (e) => e.innerText.includes("EP37") && e.innerText.includes("EP38")));
      const search = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/projects" && new URL(r.url()).searchParams.get("keyword") === "EP37");
      await page.type('input[placeholder="按编码/名称搜索"]', "EP37");
      await page.keyboard.press("Enter");
      assert.equal((await (await search).json()).total, 1);
      await page.waitForFunction(() => document.querySelectorAll(".el-table__body-wrapper .el-table__row").length === 1);
    }
    await page.screenshot({ path: path.join(output, `${role}-projects.png`) });
    const [, functions] = await navigate("/functions", ["/api/projects", "/api/v1/functions"]);
    assert.equal(functions.total, role === "admin" ? 0 : 9);
    if (role !== "admin") assert(await page.$eval(".app-main", (e) => e.innerText.includes("FN-EP37-") && e.innerText.includes("FN-EP38-")));
    await page.screenshot({ path: path.join(output, `${role}-functions.png`) });
    const [cts] = await navigate("/cts", ["/api/v1/cts"]);
    assert.equal(cts.total, 0);
    assert(await page.$eval(".app-main", (e) => e.innerText.includes("暂无 CTS 文档")));
    await page.screenshot({ path: path.join(output, `${role}-cts.png`) });
    report.checks.push({ role, projects: projects.total, functions: functions.total, cts: cts.total });
    if (role === "engineer") {
      await navigate("/architecture", ["/api/projects"]);
      assert(await page.$eval(".app-main", (e) => e.innerText.includes("EP37") && e.innerText.includes("EP38")));
      await page.screenshot({ path: path.join(output, "engineer-architecture.png") });
      const [options] = await navigate("/requirements", ["/api/projects"]);
      assert.deepEqual(options.items.map((r) => r.code).sort(), ["EP37", "EP38"]);
      await page.waitForSelector(".intake-page textarea");
      await page.screenshot({ path: path.join(output, "engineer-requirement-intake.png") });
      report.checks.push("Engineer five reported menu pages, real project search and requirement options");
      const boundary = await page.evaluate(async () => {
        const results = [];
        for (const endpoint of ["/api/projects", "/api/v1/functions", "/api/v1/cts"]) {
          const response = await fetch(endpoint + "?project_code=NO_SUCH_PROJECT", { headers: { "X-EE-Account-Id": "1" } });
          results.push(response.status);
        }
        return results;
      });
      assert.deepEqual(boundary, [403, 403, 403]);
      report.checks.push("Actual deployed cross-project requests denied, forged account header ignored");
      const target = browser.waitForTarget((t) => t.url().startsWith("http://127.0.0.1:18091/"), { timeout: 45000 });
      await page.click("a.global-pc-entry");
      const pc = await (await target).page();
      await pc.waitForSelector('.personal-home[aria-busy="false"]', { timeout: 90000 });
      assert.equal(await pc.$(".home-error"), null);
      await pc.screenshot({ path: path.join(output, "engineer-pc-sso.png") });
      report.checks.push("Engineer unchanged EE-to-PC SSO and existing personal home");
    }
    await context.close();
  }
  const anonymous = await browser.newPage();
  for (const endpoint of ["/api/projects", "/api/v1/functions", "/api/v1/cts"]) {
    const response = await anonymous.goto("http://127.0.0.1:18092" + endpoint);
    assert.equal(response.status(), 401);
  }
  report.checks.push("Actual deployed anonymous list access denied");
  assert.deepEqual(report.errors, []);
  assert(!report.responses.some((r) => r.status >= 500 || r.status === 404));
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error.stack;
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2), { flag: "wx" });
}
console.log(JSON.stringify({ status: report.status, evidence: output, error: report.error }));
process.exitCode = report.status === "PASS" ? 0 : 1;
