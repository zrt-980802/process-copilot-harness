/* global document */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

// UI compatibility only: synthetic API fixture, no EE/Runtime business acceptance.
const root = path.resolve(import.meta.dirname, "../../..");
const dist = path.join(root, "apps/web/dist");
const output = path.join(root, "reports/decoupling-d4a", new Date().toISOString().replace(/[:.]/gu, "-"));
await mkdir(output, { recursive: true });
const calls = [];
const errors = [];
let available = false;
const health = () => ({ provider_mode: "ee-connected", capabilities: { core: "configured", personal_workbench: "available",
  ee_provider: available ? "healthy" : "unavailable", project_workbench: available ? "available" : "unavailable" } });
const principal = { principal_id: "d4a-ui", tenant_id: "synthetic", lifecycle_status: "active", identity_revision: 1,
  authorization_revision: 1, ee_account: { id: 1, username: "synthetic.engineer", display_name: "D4A Engineer", status: "active" } };
const http = createServer((request, response) => {
  void (async () => {
    const route = request.url.split("?")[0];
    if (route.startsWith("/api/")) {
      calls.push(route);
      const payload = route === "/api/health" ? health()
        : route === "/api/v1/identity/me" ? { principal }
        : route === "/api/v1/ssts-tasks" ? { tasks: [] }
        : route === "/api/v1/workbench/projects" ? { items: [{ project_code: "SYNTHETIC", project_name: "Synthetic project" }] }
        : route === "/api/v1/providers/eeclaw/retry" ? (available = true, {})
        : route === "/api/ee-auth/me" ? { data: { account: principal.ee_account, roles: [{ role_key: "engineer", name: "Engineer" }] } }
        : { items: [] };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
      return;
    }
    const file = path.resolve(dist, `.${route === "/" ? "/index.html" : route}`);
    if (!file.startsWith(dist + path.sep)) { response.writeHead(404).end(); return; }
    const body = await readFile(file);
    const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
    response.writeHead(200, { "content-type": contentType }).end(body);
  })().catch(() => { response.writeHead(404).end(); });
});
http.listen(0, "127.0.0.1");
await once(http, "listening");
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => { sessionStorage.setItem("pc.minimum-test.token", "synthetic-ui-token"); });
  await page.goto(`http://127.0.0.1:${http.address().port}`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".provider-unavailable");
  assert.match(await page.$eval(".provider-unavailable", element => element.textContent), /EE 项目能力暂不可用/u);
  assert.equal(await page.$eval(".demo-indicator", element => element.textContent), "EE 暂不可用");
  assert(await page.$(".personal-home"), "Personal home remains available");
  assert(!calls.includes("/api/v1/workbench/projects"), "Unavailable state must not query projects as if healthy");
  await page.screenshot({ path: path.join(output, "unavailable-home.png") });
  await page.click('.nav-rail button[title="项目总览"]');
  assert.equal(await page.$eval(".project-scope-empty h1", element => element.textContent), "项目能力暂不可用");
  assert(!(await page.$eval(".project-scope-empty", element => element.textContent)).includes("暂无授权项目"));
  await page.screenshot({ path: path.join(output, "unavailable-project.png") });
  await page.click('.nav-rail button[title="对话"]');
  assert.match(await page.$eval(".current-scope", element => element.textContent), /个人范围/u);
  await page.screenshot({ path: path.join(output, "personal-entry.png") });
  await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/v1/workbench/projects")), page.click(".provider-unavailable button")]);
  await page.waitForFunction(() => !document.querySelector(".provider-unavailable"));
  assert(calls.includes("/api/v1/providers/eeclaw/retry"));
  assert(calls.includes("/api/v1/workbench/projects"), "Recovery refreshes the whole project view");
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ status: "PASS", classification: "synthetic-browser-compatibility",
    checks: ["global-unavailable-banner", "unavailable-not-permission-deny", "personal-entry-preserved", "retry-refresh"], calls, errors }, null, 2));
  console.log(`D4A browser compatibility PASS: ${output}`);
} finally {
  await browser?.close();
  http.closeAllConnections();
  await new Promise(resolve => http.close(() => resolve()));
}
