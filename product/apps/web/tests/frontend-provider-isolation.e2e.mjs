/* global document, window, history, location */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

// Production Vue/DOM compatibility fixtures only, never real EE business acceptance.
const root = path.resolve(import.meta.dirname, "../../..");
const dist = path.join(root, "apps/web/dist");
const output = path.join(root, "reports/frontend-provider-isolation-01", new Date().toISOString().replace(/[:.]/gu, "-"));
await mkdir(output, { recursive: true });
const d4aOnly = process.argv.includes("--d4a");
const calls = [], checks = [], errors = [], unexpected = [];
let mode = "standalone", epoch = 1, retryFailure, delayPath = "", delayMs = 0, personal, denyPath = "";
const principal = { principal_id: "pc-user", tenant_id: "synthetic", authorization_revision: 1,
  ee_account: { id: 7, username: "hidden-ee-account", display_name: "Hidden EE" } };
const fullNames = ["ee.get_project_context", "ee.list_requirements", "ee.list_functions", "ee.list_ssts", "ee.get_ssts", "ee.get_function_ssts_matrix", "ee.submit_ssts_review"];
const tools = () => (mode === "no-capabilities" ? [] : mode === "full" || mode === "expiring" ? fullNames : mode === "engineering" ? fullNames.slice(0, 3) : ["project.read"]).map(name => ({
  tool_release_id: name, tool_definition_id: name, schema_digest: "synthetic", compatibility: { display_name: name, domain: "functions" },
  risk_manifest: { action_class: name.includes("submit") ? "WRITE" : "READ" },
  approval_policy: "EXACT_PARAMETERS", recovery_class: "RECONCILE_BEFORE_RETRY", input_schema: { type: "object", properties: { ssts_code: { type: "string" } } }
}));
const ready = () => ["no-capabilities", "zero", "generic", "engineering", "full", "expiring", "other"].includes(mode);
const expiry = () => new Date(Date.now() + (mode === "expiring" ? 1600 : 180_000)).toISOString();
const projects = () => !ready() || mode === "zero" || mode === "no-capabilities" ? [] : mode === "other" ? [{ project_code: "B", project_name: "Beta project" }]
  : [{ project_code: "A", project_name: "Alpha project" }, { project_code: "B", project_name: "Beta project" }];
const health = () => ({ provider_mode: mode === "standalone" ? "standalone" : "ee-connected",
  provider_bundle: { bundle_state: ready() ? "READY" : mode === "standalone" || mode === "unconfigured" ? "UNCONFIGURED" : "UNAVAILABLE",
    bundle_generation: `epoch.${epoch}`, catalog_revision: `c${epoch}`, expires_at: expiry(), registration_revision: epoch },
  capabilities: { core: "configured", personal_workbench: "available", ee_provider: ready() ? "healthy" : "unavailable", project_workbench: ready() ? "available" : "unavailable" } });
const task = (project = "A") => ({ workspace_id: `task-${project}`, business_task_id: `business-${project}`, project_code: project,
  function_code: "F1", tenant_id: principal.tenant_id, owner_principal_id: principal.principal_id, title: `Current ${project} task`,
  profile_release_id: mode === "full" || mode === "expiring" ? "profile:ee-ssts:1" : "profile:conversation:project:1",
  profile_release_digest: "synthetic", state: "READY", version: epoch, created_at: "2026-11-20T00:00:00Z", updated_at: "2026-11-20T00:00:00Z" });
const rows = () => [...(personal ? [personal] : []), ...(ready() && mode !== "zero" ? projects().map(project => task(project.project_code)) : []),
  // Stale metadata is intentionally returned; the experience must not render it.
  ...(mode === "generic" ? [{ ...task(), workspace_id: "old-ssts", title: "Stale SSTS task", profile_release_id: "profile:ee-ssts:old" }] : [])];
const projection = id => ({ workspace: id === "personal" ? personal : rows().find(row => row.workspace_id === id) ?? task(id.slice(-1)),
  inputs: [], messages: [], drafts: [] });
let approval = { approval_id: "exact-approval", approval_version: 1, status: "PENDING", requested_by: "other-reviewer",
  requested_at: "2026-11-20T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", tool_release_id: "ee.submit_ssts_review",
  arguments: { ssts_code: "S1", expected_revision: 1, snapshot_digest: "synthetic-digest" }, resource_scope_refs: ["project:A"],
  command_context: { workspace_id: "task-A", call_id: "synthetic-call" } };
let messages = [];
function execution() { return { events: [], ledger: [{ operation: { operation_id: "synthetic-operation", state: "SUCCEEDED" },
  external: { tool_release_id: "ee.get_project_context", outcome_state: "KNOWN_SUCCESS", result: { external_evidence_refs: ["eea://traces/synthetic-trace"],
    result: { document: { ssts_code: "S1" } } } } }], runtime_available: true, tool_release_ids: tools().map(tool => tool.tool_release_id) }; }
function data() { return { fetched_at: new Date().toISOString(), results: {
  "ee.list_requirements": { items: [{ code: "R1", title: "Current requirement", description: "Input version 1" }] },
  "ee.list_functions": { functions: [{ code: "F1", title: "Current function", status: "active", source_requirement_code: "R1" }] },
  "ee.list_ssts": { items: mode === "full" || mode === "expiring" ? [{ ssts_code: "S1", ssts_title: "Current specification", status: "draft" }] : [] },
  "ee.get_function_ssts_matrix": { matrix: [{ function_code: "F1", ssts_links: [{ ssts_code: "S1", status: "confirmed" }] }] }
} }; }
const http = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      calls.push({ mode, method: request.method, path: url.pathname + url.search, body });
      let payload;
      const route = url.pathname;
      if (denyPath && route.includes(denyPath)) {
        response.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: "PC_WORKBENCH_PROJECT_DENIED", message: "当前项目不可访问", retryable: false } })); return;
      }
      if (route === "/api/health") payload = health();
      else if (route === "/api/v1/identity/me") payload = { principal };
      else if (route === "/api/v1/identity/capabilities") payload = { principal_id: principal.principal_id, account_name: "Synthetic PC account",
        session: { state: "ACTIVE", pc_session_id: "pc-session:synthetic-browser", expires_at: new Date(Date.now() + 3600_000).toISOString() },
        capability_groups: [{ key: "personal", capabilities: [{ action: "conversation.run", available: true }] }] };
      else if (route === "/api/v1/workbench/capability-availability") payload = { principal_id: principal.principal_id, tenant_id: principal.tenant_id,
        provider_registration_id: "provider:eeclaw", catalog_revision: `c${epoch}`, evidence_refs: [`provider-bundle:epoch.${epoch}`],
        expires_at: expiry(), capabilities: tools().map(tool => ({ tool_release_id: tool.tool_release_id, availability_state: "AVAILABLE" })) };
      else if (route === "/api/v1/workbench/projects") payload = { items: projects() };
      else if (route === "/api/v1/workbench/catalog") payload = { connector: { capability_digest: `c${epoch}` }, tools: tools() };
      else if (route === "/api/v1/ssts-tasks") payload = { tasks: url.searchParams.get("scope") === "personal" ? rows().filter(row => !row.project_code) : rows() };
      else if (/^\/api\/v1\/ssts-tasks\/[^/]+$/u.test(route)) payload = projection(route.split("/").at(-1));
      else if (route.endsWith("/project-data")) payload = data();
      else if (route.endsWith("/execution")) payload = execution();
      else if (route.endsWith("/conversation")) payload = { messages };
      else if (route.endsWith("/turns")) { messages = [{ message_id: "reply", role: "assistant", content: "**Personal reply**", occurred_at: new Date().toISOString() }]; payload = { content: "Personal reply" }; }
      else if (route === "/api/v1/workbench/tasks" && request.method === "POST") {
        personal = { ...task(), workspace_id: "personal", project_code: undefined, title: body.title, profile_release_id: "profile:conversation:personal:1" };
        payload = personal;
      } else if (route === "/api/v1/workbench/approvals") payload = { items: [approval] };
      else if (route.endsWith("/decision")) { approval = { ...approval, status: body.decision === "APPROVE" ? "APPROVED" : "REJECTED" }; payload = approval; }
      else if (route.endsWith("/execute")) { approval = { ...approval, status: "CONSUMED" }; payload = { state: "SUCCEEDED" }; }
      else if (route.endsWith("/tools")) payload = { structuredContent: { document: { ssts_code: "S1", status: "draft" }, sections: [{ section_number: 1, section_title: "Current detail", content: "Versioned specification content" }] } };
      else if (route === "/api/ee-auth/me") payload = { data: { account: principal.ee_account, roles: [] } };
      else if (route === "/api/v1/providers/eeclaw/retry") {
        if (request.headers.authorization !== "Bearer synthetic-ui-token") {
          response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: "PC_AUTHENTICATION_REQUIRED" } })); return;
        }
        if (retryFailure) {
          response.writeHead(retryFailure.status, { "content-type": "application/json" }).end(JSON.stringify({ error: { ...retryFailure, message: "当前能力不可用" } })); return;
        }
        mode = "zero"; epoch++; payload = {};
      } else { unexpected.push(route); response.writeHead(404).end(); return; }
      if (delayPath && route.includes(delayPath)) await new Promise(resolve => setTimeout(resolve, delayMs));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload)); return;
    }
    const route = url.pathname;
    if (route === "/favicon.ico") { response.writeHead(204).end(); return; }
    const file = path.resolve(dist, `.${route === "/" ? "/index.html" : route}`);
    if (!file.startsWith(dist + path.sep)) { response.writeHead(404).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" }).end(body);
  })().catch(error => { errors.push(error.message); if (!response.headersSent) response.writeHead(500).end(); });
});
http.listen(0, "127.0.0.1"); await once(http, "listening");
let browser;
const settle = page => page.waitForNetworkIdle({ idleTime: 140, timeout: 12_000 });
const nav = async page => page.$$eval(".nav-rail > button", nodes => nodes.map(node => node.title));
const clickNav = (page, name) => page.click(`.nav-rail > button[title="${name}"]`);
async function noExternal(page) {
  assert.deepEqual(await nav(page), ["首页", "对话"]);
  const text = await page.$eval("body", node => node.textContent);
  assert(!/EE|SSTS|Alpha|Beta|task-A|task-B|hidden-ee-account|ee\./u.test(text), `Hidden external content: ${text}`);
  assert.equal(await page.$('.detail-drawer, .account-identifiers, img[src*="project-car"], .project-summary'), null);
  const client = await page.createCDPSession();
  const tree = await client.send("Accessibility.getFullAXTree"); await client.detach();
  assert(!/EE|SSTS|Alpha|Beta|hidden-ee-account|ee\./u.test(JSON.stringify(tree.nodes.filter(node => !node.ignored).map(node => node.name?.value))));
}
async function geometry(page) {
  const layout = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll(".desktop-topbar button")].filter(node => node.getBoundingClientRect().width > 0)
      .map(node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }) }));
  assert(layout.scroll <= layout.width + 1, `Horizontal overflow ${JSON.stringify(layout)}`);
  for (let i = 0; i < layout.buttons.length; i++) for (let j = i + 1; j < layout.buttons.length; j++) {
    const a = layout.buttons[i], b = layout.buttons[j];
    assert(!(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1), "Overlapping header controls");
  }
}
async function open(page, state, width) {
  await page.goto("about:blank");
  mode = state; epoch++; personal = undefined; messages = []; retryFailure = undefined; delayPath = ""; denyPath = "";
  await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
  const start = calls.length;
  await page.goto(`http://127.0.0.1:${http.address().port}/#owner=eea%3A%2F%2Fprojects%2FOLD`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".personal-home"); await settle(page);
  assert.equal(await page.evaluate(() => location.hash), "");
  return start;
}
async function refresh(page) { await page.click(".refresh-experience"); await settle(page); }
async function screenshot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, name), fullPage: true });
}
async function retryMatrix(page, width) {
  await open(page, "unavailable", width); await noExternal(page);
  assert.match(await page.$eval(".provider-unavailable", node => node.textContent), /企业项目能力暂不可用/u);
  for (const failure of [{ status: 400, code: "PC_PROVIDER_BUNDLE_CONFIGURATION", retryable: false }, { status: 503, code: "PC_PROVIDER_BUNDLE_TRANSPORT", retryable: true }]) {
    retryFailure = failure; const start = calls.length;
    const pending = page.waitForResponse(response => response.url().endsWith("/api/v1/providers/eeclaw/retry"));
    await page.click(".provider-unavailable button");
    const rejected = await pending;
    assert.equal(rejected.status(), failure.status);
    assert.equal((await rejected.json()).error.code, failure.code);
    await settle(page);
    assert(await page.$(".provider-unavailable")); assert.equal(await page.$(".global-notice"), null);
    const message = await page.$eval('.global-error[role="alert"]', node => node.textContent);
    assert.match(message, /当前能力.*不可用/u);
    assert(!/Connector|Bundle|PC_PROVIDER_|secret|Token/u.test(message));
    assert.deepEqual(calls.slice(start).map(call => call.path), ["/api/v1/providers/eeclaw/retry"]);
  }
  retryFailure = undefined; await page.click(".provider-unavailable button"); await settle(page);
  await noExternal(page); assert.equal(await page.$(".provider-unavailable"), null);
  assert(!calls.slice(-5).some(call => call.path.includes("catalog")));
  checks.push(`retry configuration/transport failure and success-zero ${width}`);
}
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  page.on("pageerror", error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    if (location.protocol !== "http:") return;
    sessionStorage.setItem("pc.minimum-test.token", "synthetic-ui-token");
    const original = fetch;
    window.fetch = (url, init) => original(url, window.__ignoreAbort && String(url).includes(window.__ignoreAbort) ? { ...init, signal: undefined } : init);
  });
  for (const width of [1440, 390]) {
    if (!d4aOnly) {
      for (const state of ["standalone", "unconfigured", "unavailable", "zero", "no-capabilities", "generic", "engineering", "full"]) {
        const start = await open(page, state, width);
        const initial = calls.slice(start).map(call => call.path).filter(route => route !== "/api/v1/identity/capabilities");
        assert.equal(calls.slice(start).filter(call => call.path === "/api/v1/identity/capabilities").length, 1);
        const discovery = ["/api/health", "/api/v1/identity/me", "/api/health"];
        if (ready()) discovery.push("/api/v1/workbench/capability-availability");
        if (ready() && state !== "no-capabilities") discovery.push("/api/v1/workbench/projects");
        if (ready() && state !== "zero" && state !== "no-capabilities") discovery.push("/api/v1/workbench/catalog?project_code=A");
        if (!ready() || state === "zero" || state === "no-capabilities") { discovery.push("/api/v1/ssts-tasks?scope=personal"); assert.deepEqual(initial, discovery); await noExternal(page); }
        else {
          discovery.push("/api/v1/ssts-tasks");
          assert.deepEqual(initial.slice(0, discovery.length), discovery);
          assert(initial.slice(discovery.length).every(route => /^\/api\/v1\/(ssts-tasks\/task-A|workbench\/tasks\/task-A\/execution)$/u.test(route)));
          await clickNav(page, "项目总览"); await settle(page);
          assert.match(await page.$eval(".desktop-content", node => node.textContent), /Alpha project/u);
          if (state === "generic") { assert(!/SSTS|技术规范|Stale/u.test(await page.$eval("body", node => node.textContent))); assert(!(await nav(page)).includes("工程")); }
          if (state === "engineering") { await clickNav(page, "工程"); await settle(page); assert.match(await page.$eval("body", node => node.textContent), /Current function/u); assert(!/SSTS|技术规范/u.test(await page.$eval("body", node => node.textContent))); }
          if (state === "full") {
            await clickNav(page, "成果"); await settle(page);
            assert.match(await page.$eval("body", node => node.textContent), /EE 技术规范/u);
            await page.click(".data-table tbody tr"); await settle(page);
            assert.match(await page.$eval(".detail-drawer", node => node.textContent), /Versioned specification content/u);
            await page.click('[title="关闭详情"]');
          }
          await page.click('.account-summary'); await settle(page);
          assert(!calls.slice(start).some(call => call.path.startsWith("/api/ee-auth")), "No automatic provider identity request");
          assert(!await page.$(".account-identifiers dl"));
          if (state === "full") { await page.click(".account-identifiers summary"); await settle(page); assert.match(await page.$eval(".account-identifiers", node => node.textContent), /hidden-ee-account/u); }
          await page.click('[title="关闭账号设置"]');
        }
        await geometry(page);
        await screenshot(page, `${state}-${width}.png`);
        checks.push(`initial matrix/network/DOM/accessibility/layout ${state} ${width}`);
      }
      // A personal turn remains independent, including while project capability is unavailable.
      await open(page, "unavailable", width); await clickNav(page, "对话");
      await page.click('[data-test="new-conversation"]'); await settle(page);
      await page.waitForSelector('.workbench [aria-label="运行消息"]');
      await page.type('.workbench [aria-label="运行消息"]', "Personal question");
      await page.click(".workbench .turn-composer button[type=submit]"); await settle(page);
      assert.match(await page.$eval(".chat-transcript", node => node.textContent), /Personal reply/u);
      assert(!calls.some(call => call.mode === "unavailable" && /catalog|project-data|approvals|ee-auth|workbench\/projects/u.test(call.path)));
      checks.push(`personal create/open/turn ${width}`);

      // Current scene controls: precise approval and actual evidence UI remain mounted.
      await open(page, "full", width); await clickNav(page, "工作台"); await settle(page);
      await page.click('.execution-tabs button:nth-child(2)'); await settle(page);
      await page.click('.tool-roster button'); assert(await page.$(".tool-form input"));
      await page.click('.execution-tabs button:nth-child(4)'); await settle(page);
      assert.match(await page.$eval(".approval-list", node => node.textContent), /expected_revision/u);
      await page.click(".approval-actions button"); await settle(page);
      await page.click(".approval-row > button"); await settle(page);
      assert.match(await page.$eval(".evidence-list", node => node.textContent), /SUCCEEDED.*synthetic-trace/su);
      await screenshot(page, `full-evidence-${width}.png`);
      approval = { ...approval, status: "PENDING" };
      checks.push(`preserved tools/precise approval/Operation/Trace ${width}`);

      // Clear open detail and explicit provider identity, not merely the navigation.
      await clickNav(page, "成果"); await settle(page); await page.click(".data-table tbody tr"); await settle(page);
      mode = "unavailable"; epoch++; await refresh(page); await noExternal(page);
      const boundary = calls.length; await new Promise(resolve => setTimeout(resolve, 5200));
      assert.equal(calls.length, boundary, "No hidden polling");
      await page.evaluate(() => { history.pushState(null, "", "#owner=eea://projects/A/ssts/S1"); history.back(); }); await settle(page); await noExternal(page);
      await page.reload({ waitUntil: "networkidle0" }); await noExternal(page);
      checks.push(`outage/details/history/refresh/no-polling ${width}`);

      for (const next of ["zero", "other", "generic"]) {
        await open(page, "full", width); await clickNav(page, "成果"); await settle(page);
        mode = next; epoch++; await refresh(page);
        assert.equal(await page.$(".detail-drawer"), null);
        assert.equal(await page.$(".nav-rail [title='成果']"), null);
        assert(!/Current specification|SSTS|hidden-ee-account/u.test(await page.$eval("body", node => node.textContent)));
        if (next === "zero") await noExternal(page);
        if (next === "other") assert(!/Alpha|task-A/u.test(await page.$eval("body", node => node.textContent)));
        checks.push(`revocation/catalog-removal ${next} ${width}`);
      }
      await open(page, "full", width); await clickNav(page, "项目总览"); await settle(page);
      await page.select('[aria-label="当前项目"]', "B"); await settle(page);
      assert.match(await page.$eval(".desktop-content", node => node.textContent), /Beta project/u);
      assert(!/Alpha|Current A task/u.test(await page.$eval(".desktop-content", node => node.textContent)));
      checks.push(`project switch A to B ${width}`);
      await open(page, "standalone", width);
      mode = "full"; epoch++; await refresh(page);
      assert((await nav(page)).includes("成果"));
      assert.equal(await page.$(".provider-unavailable"), null);
      checks.push(`standalone to current READY ${width}`);
      await open(page, "full", width); denyPath = "/project-data";
      await clickNav(page, "项目总览"); await settle(page); await noExternal(page);
      assert(await page.$(".provider-unavailable"));
      checks.push(`request-time denial clears external state ${width}`);

      // Deliberately ignore AbortSignal: old in-flight responses must still be fenced.
      for (const pending of ["/catalog", "/project-data", "/tools", "/ssts-tasks/task-A"]) {
        await open(page, "full", width);
        await page.evaluate(pattern => { window.__ignoreAbort = pattern; }, pending);
        delayPath = pending; delayMs = 850;
        const start = calls.length;
        if (pending === "/catalog") { void page.click(".refresh-experience"); }
        else if (pending === "/project-data") { void clickNav(page, "项目总览"); }
        else if (pending === "/tools") {
          delayPath = ""; await clickNav(page, "成果"); await settle(page); delayPath = pending; void page.click(".data-table tbody tr");
        } else { void clickNav(page, "工作台"); }
        const deadline = Date.now() + 3000;
        while (!calls.slice(start).some(call => call.path.includes(pending))) {
          assert(Date.now() < deadline, `Missing in-flight request: ${pending}`);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        mode = "unavailable"; epoch++; delayPath = ""; await refresh(page);
        await new Promise(resolve => setTimeout(resolve, 950)); await noExternal(page);
        checks.push(`ignored-abort late response ${pending} ${width}`);
      }
      await open(page, "expiring", width); await new Promise(resolve => setTimeout(resolve, 1800)); await noExternal(page);
      checks.push(`TTL expiry ${width}`);
    }
    await retryMatrix(page, width);
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ status: "PASS", classification: "synthetic-production-browser-compatibility", checks, calls, errors, unexpected }, null, 2));
  console.log(`${d4aOnly ? "D4A" : "FPI"} production browser PASS (${checks.length} checks): ${output}`);
} catch (error) {
  await writeFile(path.join(output, "failure.json"), JSON.stringify({ error: error.stack, checks, calls, errors, unexpected }, null, 2));
  const pages = await browser?.pages(); await pages?.at(-1)?.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser?.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
}
