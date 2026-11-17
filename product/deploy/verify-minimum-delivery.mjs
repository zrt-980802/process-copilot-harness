/* global document */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { readAccessAccounts } from "./read-access-accounts.mjs";

const evidence = process.env.PC_TEST_EVIDENCE_DIR;
assert(evidence, "PC_TEST_EVIDENCE_DIR must identify a new run directory");
const phase = process.argv[2] ?? "baseline";
const tag = process.env.PC_TEST_RUN_TAG ?? "MIN01";
await mkdir(evidence, { recursive: true });
const file = name => `${evidence}/${name}`;
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 90_000 }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const errors = [];
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
let failed = false;
async function check(ids, description, run) {
  const started = new Date().toISOString();
  try {
    const detail = await run();
    results.push({ ids: ids.split(" "), description, status: "PASS", started, finished: new Date().toISOString(), detail });
    console.log(`PASS ${ids}: ${description}`);
  } catch (error) {
    failed = true;
    results.push({ ids: ids.split(" "), description, status: "FAIL", started, error: error.message });
    console.log(`FAIL ${ids}: ${error.message}`);
    throw error;
  } finally { await writeFile(file(`${phase}-${tag}.json`), JSON.stringify(results, null, 2)); }
}
async function raw(page, path, method = "GET", body, pc = true) {
  return page.evaluate(async ({ path, method, body, pc }) => {
    const csrf = document.cookie.split("; ").find(p => p.startsWith("eea_csrf="))?.slice(9);
    const token = sessionStorage.getItem("pc.minimum-test.token");
    const response = await fetch(path, { method, headers: { "content-type": "application/json",
      ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}), ...(pc && token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let value; try { value = JSON.parse(text); } catch { value = { error: text.slice(0, 200) }; }
    return { status: response.status, body: value };
  }, { path, method, body, pc });
}
async function pc(actor, path, method = "GET", body, allowError = false) {
  const response = await raw(actor.page, `/api${path}`, method, body);
  if (!allowError) assert(response.status >= 200 && response.status < 300, `${path}: ${response.status} ${JSON.stringify(response.body)}`);
  return allowError ? response : response.body;
}
async function login(username, password) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.bringToFront();
  await page.goto("http://127.0.0.1:18091/", { waitUntil: "networkidle0" });
  await page.type('[autocomplete="username"]', username);
  await page.type('[autocomplete="current-password"]', password);
  await page.click('[data-test="login"]');
  await page.waitForSelector('.personal-home[aria-busy="false"]');
  const actor = { ctx, page, username };
  actor.me = await pc(actor, "/v1/identity/me");
  return actor;
}
const base = workspace => `/v1/workbench/tasks/${workspace.workspace_id}`;
const engineer = await login("demo.engineer", "LocalAcceptanceSecret123");
const reviewer = await login("demo.reviewer", "LocalReviewerSecret123");
const admin = await login("demo.admin", "LocalDemoAdminSecret123");
const adminEe = await admin.ctx.newPage();
await adminEe.goto("http://127.0.0.1:18092/access-control", { waitUntil: "networkidle0" });
const ee = (path, method = "GET", body) => raw(adminEe, `/api/v1/${path}`, method, body, false);
async function allAccounts() {
  const pages = [];
  return readAccessAccounts(ee, async page => {
    pages.push(page);
    await writeFile(file(`account-pages-${phase}-${tag}.json`), JSON.stringify(pages, null, 2));
  });
}
const tasks = async actor => (await pc(actor, "/v1/ssts-tasks")).tasks;
async function create(actor, title, project_code) {
  const namespace = process.env.PC_TEST_TASK_NAMESPACE;
  const named = `Minimum ${namespace ? namespace + " " : ""}${tag}: ${title}`;
  return (await tasks(actor)).find(t => t.title === named) ?? pc(actor, "/v1/workbench/tasks", "POST", { title: named, mode: "CHAT", ...(project_code ? { project_code } : {}) });
}
async function tool(actor, workspace, release, args = {}, callId = randomUUID()) {
  return pc(actor, `${base(workspace)}/tools`, "POST", { tool_release_id: release.tool_release_id, arguments: args, call_id: callId }, true);
}
function rejected(response) {
  assert(response.status >= 400 && response.status < 500 || response.status === 200 && response.body.isError,
    `expected stable rejection: ${JSON.stringify(response)}`);
}
async function nav(page, label) {
  await page.$$eval(".nav-rail > button", (nodes, label) => nodes.find(n => n.textContent.trim() === label).click(), label);
}
async function waitReady() {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch("http://127.0.0.1:18091/api/ready", { signal: AbortSignal.timeout(2000) })).ok
        && (await pc(engineer, "/v1/identity/me", "GET", undefined, true)).status === 200) return;
    } catch { /* Services may still be starting. */ }
    await sleep(1000);
  }
  throw new Error("PC/EE did not recover in 90 seconds");
}
async function waitHealthy(name) {
  for (let i = 0; i < 90; i++) {
    if (docker("inspect", "--format", "{{.State.Health.Status}}", name) === "healthy") return;
    await sleep(1000);
  }
  throw new Error(`${name} did not become healthy`);
}
async function waitActive(runtime) {
  for (let i = 0; i < 50; i++) {
    const health = JSON.parse(docker("exec", runtime, "node", "-e", "console.log(await (await fetch('http://127.0.0.1:3100/health')).text())"));
    if (health.active_sessions > 0) return;
    await sleep(100);
  }
  throw new Error("No real active model turn observed");
}
async function baseline(auditCutoff) {
  const records = {};
  const readAudits = [];
  for (const actor of [engineer, reviewer, admin]) {
    const list = await tasks(actor);
    const originals = list.filter(t => !t.title.startsWith("Minimum ") && !t.title.includes("acceptance") && !t.title.includes("Multi-user"));
    const projections = await Promise.all(originals.map(t => pc(actor, `/v1/ssts-tasks/${t.workspace_id}`)));
    if (auditCutoff) for (const projection of projections) {
      const added = projection.audit.filter(entry => entry.event_type === "SSTS_DRAFT_DOWNLOADED"
        && Date.parse(entry.occurred_at) > Date.parse(auditCutoff));
      readAudits.push(...added);
      projection.audit = projection.audit.filter(entry => !added.includes(entry));
    }
    records[actor.username] = { principal: actor.me.principal.principal_id,
      projects: (await pc(actor, "/v1/workbench/projects")).items,
      catalog: (await pc(actor, "/v1/workbench/catalog?project_code=EP37")).tools.map(t => t.tool_release_id).sort(),
      original_tasks: projections.map(item => ({ workspace_id: item.workspace.workspace_id, sha256: digest(item),
        drafts: item.drafts.map(d => ({ draft_id: d.draft_id, content_digest: d.content_digest })) })) };
  }
  if (auditCutoff) await writeFile(file("read-audit-additions.json"), JSON.stringify(readAudits, null, 2));
  return records;
}
try {
  if (phase === "baseline") {
    await check("T0-02 T0-03", "Capture active identities, authorizations, stable task/draft projections and service health", async () => {
      const value = await baseline();
      await writeFile(file("permission-task-baseline.json"), JSON.stringify(value, null, 2));
      const roles = (await ee("access/roles")).body.data.items;
      const accounts = await allAccounts();
      await writeFile(file("permission-baseline.json"), JSON.stringify({ roles, accounts: accounts.map(a => ({
        id: a.id, username: a.username, status: a.status, roles: a.roles.map(r => r.id) })) }, null, 2));
      await writeFile(file("service-health.json"), JSON.stringify({ pc: await (await fetch("http://127.0.0.1:18091/api/ready")).json(),
        ee: (await raw(adminEe, "/api/v1/auth/me", "GET", undefined, false)).status,
        containers: docker("ps", "--format", "{{.Names}} {{.Status}}").split("\n") }, null, 2));
      return value;
    });
  }
  if (phase === "auth-extra") {
    await check("AUTH-004 AUTH-005", "Wrong password and unknown user cannot create a PC or EE session", async () => {
      const ctx = await browser.createBrowserContext(), page = await ctx.newPage();
      await page.goto("http://127.0.0.1:18092/login");
      for (const username of ["demo.engineer", `missing.${randomUUID()}`]) {
        const response = await raw(page, "/api/v1/auth/login", "POST", { username, password: "DefinitelyWrongSecret123" }, false);
        assert.equal(response.status, 401);
        assert.equal((await raw(page, "/api/v1/auth/me", "GET", undefined, false)).status, 401);
      }
      await page.goto("http://127.0.0.1:18091/");
      assert.equal((await raw(page, "/api/v1/identity/me")).status, 401);
      await ctx.close();
    });
    await check("AUTH-010", "Reset account rejects the original password and disabled account cannot log in", async () => {
      const previous = JSON.parse(await readFile(file(process.env.PC_TEST_AUTH_RESULT ?? "auth-final/result.json"), "utf8"));
      const username = previous.accounts.find(a => a.ee_account_id).username;
      const response = await raw(adminEe, "/api/v1/auth/login", "POST", { username, password: "WrongBeforeReset123" }, false);
      assert.equal(response.status, 401);
      assert.equal((await raw(adminEe, "/api/v1/auth/me", "GET", undefined, false)).body.data.account.username, "demo.admin");
    });
  }
  if (phase === "final-state") {
    await check("T0-03 PERM-005 MCP-011", "Final roles and pre-existing account statuses are restored; retain named test accounts disabled", async () => {
      const before = JSON.parse(await readFile(file("permission-baseline.json"), "utf8"));
      const roles = (await ee("access/roles")).body.data.items;
      const accounts = await allAccounts();
      const normalizedRole = role => ({ id: role.id, role_key: role.role_key, status: role.status,
        permissions: role.permissions.map(p => `${p.permission_key}:${p.effect}`).sort() });
      for (const role of before.roles) assert.deepEqual(normalizedRole(roles.find(r => r.id === role.id)), normalizedRole(role));
      for (const account of before.accounts) {
        const current = accounts.find(a => a.id === account.id);
        assert(current, `Missing baseline account ${account.id} (${account.username}) after complete pagination`);
        assert.equal(current.status, account.status); assert.equal(current.username, account.username);
        assert.deepEqual(current.roles.map(r => r.id).sort(), account.roles.slice().sort());
      }
      const added = accounts.filter(a => !before.accounts.some(old => old.id === a.id));
      for (const account of added) assert.equal(account.status, "disabled");
      const result = { roles: roles.map(normalizedRole), accounts: accounts.map(a => ({ id: a.id, username: a.username, status: a.status,
        roles: a.roles.map(r => r.id) })), added_disabled_accounts: added.map(a => a.username) };
      await writeFile(file("permission-after.json"), JSON.stringify(result, null, 2));
      return { baseline_accounts: before.accounts.length, added_disabled_accounts: added.length, roles: roles.length };
    });
  }
  if (phase === "permissions") {
    const project = await create(reviewer, "membership scope", "EP37");
    await pc(reviewer, `${base(project)}/project-data`);
    // The demo EE application exposes auth/MCP, but not the complete Harness admin UI.
    const member = () => JSON.parse(docker("exec", "pc-workbench-demo-ee-api-1", "python", "-c",
      `import json; from eea.governance.harness_store import HarnessStore; print(json.dumps(HarnessStore().member('EP37', ${reviewer.me.account.id})))`));
    const grant = (role, revision) => JSON.parse(docker("exec", "pc-workbench-demo-ee-api-1", "python", "-c",
      `import json; from eea.governance.harness_store import HarnessStore; print(json.dumps(HarnessStore().grant('EP37', ${reviewer.me.account.id}, ${JSON.stringify(role)}, ${revision}, ${admin.me.account.id})))`));
    const original = member();
    assert(original);
    await check("PERM-009", "Direct foreign resource and absent resource return the same safe response", async () => {
      const originalTask = (await tasks(engineer)).find(t => t.function_code === "FN-EP37-001");
      const projection = await pc(engineer, `/v1/ssts-tasks/${originalTask.workspace_id}`);
      const resourceId = projection.inputs[0].resource_ref.resource_id;
      const foreign = await pc(reviewer, `/v1/resources/${resourceId}`, "GET", undefined, true);
      const absent = await pc(reviewer, `/v1/resources/absent-${randomUUID()}`, "GET", undefined, true);
      assert.equal(foreign.status, 403); assert.deepEqual(foreign, absent);
      async function internal(actor, path) {
        const token = await actor.page.evaluate(() => sessionStorage.getItem("pc.minimum-test.token"));
        return JSON.parse(execFileSync("docker", ["exec", "-i", "pc-workbench-demo-pc-api-1", "node", "--input-type=module", "-e",
          "let value=''; for await(const chunk of process.stdin)value+=chunk; const data=JSON.parse(value); const response=await fetch('http://127.0.0.1:3000'+data.path,{headers:{authorization:'Bearer '+data.token}}); console.log(JSON.stringify({status:response.status,body:await response.json()}));"],
        { input: JSON.stringify({ token, path }), encoding: "utf8", timeout: 30_000 }));
      }
      const hidden = await internal(reviewer, `/v1/resources/${resourceId}`);
      const missing = await internal(reviewer, `/v1/resources/absent-${randomUUID()}`);
      assert.equal(hidden.status, 404); assert.deepEqual(hidden, missing);
      assert.equal((await internal(engineer, `/v1/resources/${resourceId}`)).status, 200);
      return { public_route: "fenced", public_foreign_and_missing: 403, internal_foreign_and_missing: 404, internal_owner: 200 };
    });
    await check("PERM-001 PERM-002 PERM-003", "Explicit project/role intersection and no administrator bypass", async () => {
      assert.equal((await pc(engineer, "/v1/workbench/catalog?project_code=EP37")).tools.length, 9);
      assert.equal((await pc(reviewer, "/v1/workbench/catalog?project_code=EP37")).tools.length, 4);
      assert.deepEqual((await pc(admin, "/v1/workbench/projects")).items, []);
      rejected(await pc(admin, "/v1/workbench/tasks", "POST", { title: "denied", mode: "CHAT", project_code: "EP37" }, true));
    });
    let changed = false;
    try {
      await check("PERM-006 PERM-008 PERM-009 MCP-010", "Membership revoke blocks project, catalog, existing chat, direct resource and tool access", async () => {
        const revoked = grant("revoked", original.revision);
        assert.equal(revoked.role, "revoked"); changed = true;
        assert(!(await pc(reviewer, "/v1/workbench/projects")).items.some(p => p.project_code === "EP37"));
        assert.deepEqual((await pc(reviewer, "/v1/workbench/catalog?project_code=EP37")).tools, []);
        assert(!(await tasks(reviewer)).some(t => t.workspace_id === project.workspace_id));
        for (const suffix of ["/conversation", "/project-data", "/execution"]) rejected(await pc(reviewer, `${base(project)}${suffix}`, "GET", undefined, true));
        rejected(await pc(reviewer, `/v1/ssts-tasks/${project.workspace_id}`, "GET", undefined, true));
        rejected(await pc(reviewer, `${base(project)}/turns`, "POST", { prompt: "must be denied" }, true));
        const catalog = (await pc(engineer, "/v1/workbench/catalog?project_code=EP37")).tools;
        rejected(await tool(reviewer, project, catalog.find(t => t.tool_definition_id === "ee.get_project_context")));
        await reviewer.page.reload({ waitUntil: "networkidle0" });
        assert(!(await pc(reviewer, "/v1/workbench/projects")).items.some(p => p.project_code === "EP37"));
      });
    } finally {
      if (changed) {
        const current = member();
        assert.equal(grant(original.role, current.revision).role, original.role);
      }
    }
    await check("PERM-007 PERM-012", "Membership restores semantic authority, preserving revision audit", async () => {
      assert.equal((await pc(reviewer, "/v1/workbench/catalog?project_code=EP37")).tools.length, 4);
      assert((await pc(reviewer, "/v1/workbench/projects")).items.some(p => p.project_code === "EP37"));
      const value = await pc(reviewer, `${base(project)}/project-data`);
      assert.equal(Object.keys(value.results).length, 2);
      return { mutation_surface: "real HarnessStore in isolated EE container", original, restored: member() };
    });
  }
  if (phase === "mcp") {
    const project = await create(engineer, "all read tools", "EP37");
    const personal = await create(admin, "no enterprise tools");
    const releases = (await pc(engineer, "/v1/workbench/catalog?project_code=EP37")).tools.filter(t => t.risk_manifest.action_class === "READ");
    assert.equal(releases.length, 8);
    await writeFile(file("read-catalog.json"), JSON.stringify(releases, null, 2));
    for (const release of releases) {
      await check("MCP-002 MCP-003 MCP-007 PERM-011", `Real success, unauthorized and invalid input: ${release.tool_definition_id}`, async () => {
        const arguments_ = release.tool_definition_id === "ee.get_ssts" ? { ssts_code: "SSTS-EP37-001" } : {};
        const good = await tool(engineer, project, release, arguments_);
        assert.equal(good.status, 200); assert.equal(good.body.isError, false, JSON.stringify(good.body));
        assert(good.body.structuredContent.external_evidence_refs.some(r => r.startsWith("eea://traces/")));
        rejected(await tool(admin, personal, release, arguments_));
        rejected(await tool(engineer, project, release, { ...arguments_, project_code: "EP38" }));
        rejected(await tool(engineer, project, release, null));
        return { name: release.tool_definition_id, trace: good.body.structuredContent.external_evidence_refs, status: good.body.structuredContent.status };
      });
    }
    const getSsts = releases.find(t => t.tool_definition_id === "ee.get_ssts");
    await check("MCP-004 MCP-005 MCP-006 MCP-007 PERM-010", "Cross-project SSTS, missing, wrong-type, long and Unicode resource arguments fail safely", async () => {
      const records = [];
      for (const args of [{ ssts_code: "SSTS-EP38-001" }, {}, { ssts_code: 42 }, { ssts_code: null },
        { ssts_code: "x".repeat(8192) }, { ssts_code: "../规范\u0000" }]) {
        const response = await tool(engineer, project, getSsts, args);
        rejected(response); records.push({ argument_digest: digest(args), status: response.status, result: response.body.structuredContent?.status });
        assert(!JSON.stringify(response.body).includes("SSTS-EP38-001 specification"));
      }
      return records;
    });
    await check("MCP-013", "Successful and refused calls have authoritative operation audit records", async () => {
      const state = await pc(engineer, `${base(project)}/execution`);
      const completed = state.ledger.filter(e => e.external?.outcome_state === "KNOWN_SUCCESS");
      assert(completed.length >= 8);
      for (const entry of completed) {
        assert(entry.external.principal_id === engineer.me.principal.principal_id);
        assert(entry.external.resource_scope_refs.includes("project:EP37"));
        assert(entry.external.tool_release_id); assert(entry.audit.length > 0);
        assert(entry.external.evidence_refs.some(r => r.startsWith("eea://traces/")));
      }
      return { successes: completed.length, audits: completed.map(e => e.audit) };
    });
  }
  if (phase === "permission-cache") {
    const member = () => JSON.parse(docker("exec", "pc-workbench-demo-ee-api-1", "python", "-c",
      `import json; from eea.governance.harness_store import HarnessStore; print(json.dumps(HarnessStore().member('EP37', ${reviewer.me.account.id})))`));
    const grant = (role, revision) => JSON.parse(docker("exec", "pc-workbench-demo-ee-api-1", "python", "-c",
      `import json; from eea.governance.harness_store import HarnessStore; print(json.dumps(HarnessStore().grant('EP37', ${reviewer.me.account.id}, ${JSON.stringify(role)}, ${revision}, ${admin.me.account.id})))`));
    const original = member();
    await check("PERM-012 REC-011", "Revocation survives API restart, browser refresh and fresh login; restore exact role", async () => {
      try {
        assert.equal(grant("revoked", original.revision).role, "revoked");
        docker("restart", "pc-workbench-demo-pc-api-1"); await waitReady();
        await reviewer.page.reload({ waitUntil: "networkidle0" });
        assert.deepEqual((await pc(reviewer, "/v1/workbench/catalog?project_code=EP37")).tools, []);
        const relogged = await login("demo.reviewer", "LocalReviewerSecret123");
        assert.equal(relogged.me.principal.principal_id, reviewer.me.principal.principal_id);
        assert.deepEqual((await pc(relogged, "/v1/workbench/catalog?project_code=EP37")).tools, []);
        await relogged.ctx.close();
      } finally { assert.equal(grant(original.role, member().revision).role, original.role); }
      assert.equal((await pc(reviewer, "/v1/workbench/catalog?project_code=EP37")).tools.length, 4);
    });
  }
  if (phase === "chat-completion") {
    await check("CHAT-003", "Engineer project conversation uses only its current authorized real MCP tools", async () => {
      const project = await create(engineer, "engineer project model", "EP37");
      const catalog = (await pc(engineer, "/v1/workbench/catalog?project_code=EP37")).tools;
      const response = await pc(engineer, `${base(project)}/turns`, "POST", {
        prompt: "Call ee.get_project_context for the current project. State its real name and cite the returned eea://traces/ reference. Do not guess.",
        request_id: randomUUID(),
      });
      const state = await pc(engineer, `${base(project)}/execution`);
      await writeFile(file(`chat-completion-${tag}-project-evidence.json`), JSON.stringify({ workspace: project,
        response, catalog: catalog.map(tool => ({ name: tool.tool_definition_id, release: tool.tool_release_id })),
        ledger: state.ledger }, null, 2));
      const external = state.ledger.filter(entry => entry.operation.evidence_refs.includes(`turn:${response.turn_id}`)
        && ["VERIFYING", "SUCCEEDED"].includes(entry.operation.state) && entry.external?.outcome_state === "KNOWN_SUCCESS"
        && entry.external.dispatch_state === "COMPLETED"
        && entry.external.result?.status === "SUCCEEDED");
      assert(external.length > 0, "This turn has no successful audited MCP operation; see project-evidence.json");
      const contextTool = catalog.find(tool => tool.tool_definition_id === "ee.get_project_context");
      assert(external.some(entry => entry.external.tool_release_id === contextTool?.tool_release_id), "Current turn must actually read project context");
      for (const entry of external) {
        assert(catalog.some(tool => tool.tool_release_id === entry.external.tool_release_id));
        assert.equal(entry.external.business_task_id, project.business_task_id);
        assert.equal(entry.external.principal_id, engineer.me.principal.principal_id);
        assert.deepEqual(entry.external.resource_scope_refs, ["project:EP37"]);
        assert.equal(entry.operation.result_digest, entry.external.result.result_digest);
        assert(entry.audit.length > 0, "Verified tool execution must retain operation audit");
      }
      const cited = external.flatMap(entry => entry.external.evidence_refs)
        .filter(ref => /^eea:\/\/traces\/[^\s/]+$/u.test(ref) && response.content.includes(ref));
      assert(cited.length > 0, "Model must cite an exact verified trace from this turn, not just the trace URI prefix");
      return { workspace_id: project.workspace_id, authorized_tools: catalog.map(tool => tool.tool_definition_id),
        turn_id: response.turn_id, real_operations: external.map(entry => entry.external.operation_id), cited_traces: cited };
    });
    await check("CHAT-011 AUTH-006", "Logout and account switch in the same browser restore only the returning owner's exact conversation", async () => {
      const own = await create(reviewer, "relogin own history");
      const marker = `RETURNING_REVIEWER_${tag}`;
      await pc(reviewer, `${base(own)}/turns`, "POST", { prompt: `Reply exactly ${marker}.`, request_id: randomUUID() });
      const history = await pc(reviewer, `${base(own)}/conversation`);
      assert(JSON.stringify(history).includes(marker));
      const signInSamePage = async (username, password) => {
        for (const selector of ['[autocomplete="username"]', '[autocomplete="current-password"]']) {
          await reviewer.page.$eval(selector, node => { node.value = ""; node.dispatchEvent(new Event("input", { bubbles: true })); });
        }
        await reviewer.page.type('[autocomplete="username"]', username);
        await reviewer.page.type('[autocomplete="current-password"]', password);
        await reviewer.page.click('[data-test="login"]');
        await reviewer.page.waitForSelector('.personal-home[aria-busy="false"]');
        return pc(reviewer, "/v1/identity/me");
      };
      const signOut = async () => {
        await reviewer.page.click('[title="退出登录"]');
        await reviewer.page.waitForSelector(".login-form");
      };
      await signOut();
      assert.equal((await signInSamePage("demo.engineer", "LocalAcceptanceSecret123")).principal.principal_id, engineer.me.principal.principal_id);
      assert.equal((await pc(reviewer, `${base(own)}/conversation`, "GET", undefined, true)).status, 403);
      assert(!(await tasks(reviewer)).some(task => task.workspace_id === own.workspace_id));
      await signOut();
      assert.equal((await signInSamePage("demo.reviewer", "LocalReviewerSecret123")).principal.principal_id, reviewer.me.principal.principal_id);
      assert.deepEqual((await pc(reviewer, `${base(own)}/conversation`)).messages, history.messages);
      return { workspace_id: own.workspace_id, retained_messages: history.messages.length, same_browser_switches: 2 };
    });
  }
  if (phase === "chat-extra") {
    const a = await create(reviewer, "same workspace concurrency");
    await check("CHAT-006 CHAT-007", "Same workspace simultaneous requests cannot both execute the same turn", async () => {
      const prompt = `Reply exactly CONCURRENT_${tag}`;
      const responses = await Promise.all([0, 1].map(() => pc(reviewer, `${base(a)}/turns`, "POST", { prompt }, true)));
      const ok = responses.filter(r => r.status === 200);
      assert.equal(ok.length, 1, JSON.stringify(responses));
      const refusal = responses.find(r => r.status !== 200);
      assert(refusal.status >= 400 && refusal.status < 500, JSON.stringify(refusal));
      const history = await pc(reviewer, `${base(a)}/conversation`);
      assert.equal(history.messages.filter(m => m.role === "assistant" && m.content.includes(`CONCURRENT_${tag}`)).length, 1);
      return responses.map(r => ({ status: r.status, code: r.body.error?.code ?? r.body.code, turn_id: r.body.turn_id }));
    });
    await check("CHAT-007 AUTH-014", "Persisted request identity rejects retries and changed payloads across API restart", async () => {
      const chat = await create(reviewer, "durable request identity");
      const request_id = `request-${tag}-${randomUUID()}`;
      const prompt = `Reply exactly RETRY_ONCE_${tag}`;
      const first = await pc(reviewer, `${base(chat)}/turns`, "POST", { prompt, request_id });
      assert(first.content.includes(`RETRY_ONCE_${tag}`));
      for (const retryPrompt of [prompt, "This must not create another model execution"]) {
        assert.equal((await pc(reviewer, `${base(chat)}/turns`, "POST", { prompt: retryPrompt, request_id }, true)).status, 409);
      }
      docker("restart", "pc-workbench-demo-pc-api-1"); await waitReady();
      assert.equal((await pc(reviewer, `${base(chat)}/turns`, "POST", { prompt, request_id }, true)).status, 409);
      const history = await pc(reviewer, `${base(chat)}/conversation`);
      assert.equal(history.messages.filter(m => m.role === "assistant" && m.content.includes(`RETRY_ONCE_${tag}`)).length, 1);
      return { request_id, restart_preserved_principal: (await pc(reviewer, "/v1/identity/me")).principal.principal_id };
    });
    const cancel = await create(reviewer, "cancel target");
    const other = await create(engineer, "unaffected by cancel");
    await check("CHAT-008", "Cancellation terminates only the observed target turn; another account succeeds", async () => {
      const pending = pc(reviewer, `${base(cancel)}/turns`, "POST", { prompt: "Write a 2000 word detailed explanation of distributed database architecture." }, true);
      await waitActive("pc-workbench-user-3fa48c6f2484bd3024d91555");
      const unaffected = pc(engineer, `${base(other)}/turns`, "POST", { prompt: `Reply exactly UNAFFECTED_${tag}` });
      const stopped = await pc(reviewer, `${base(cancel)}/cancel`, "POST", {});
      assert.equal(stopped.accepted, true);
      const outcome = await pending;
      assert(outcome.status >= 400 && outcome.status <= 599, JSON.stringify(outcome));
      assert((await unaffected).content.includes(`UNAFFECTED_${tag}`));
      const health = JSON.parse(docker("exec", "pc-workbench-user-3fa48c6f2484bd3024d91555", "node", "-e", "console.log(await (await fetch('http://127.0.0.1:3100/health')).text())"));
      assert.equal(health.active_sessions, 0);
      return { cancellation: stopped, response_status: outcome.status, error: outcome.body, active_sessions: health.active_sessions };
    });
  }
  if (phase === "regression") {
    await check("REG-001 REG-004 REG-005", "Original task IDs, inputs, accepted/rejected/revision state and draft digests survive", async () => {
      const before = JSON.parse(await readFile(file("permission-task-baseline.json"), "utf8"));
      const captured = JSON.parse(await readFile(file("baseline-MIN01.json"), "utf8"))[0].started;
      const after = await baseline(captured);
      for (const records of [before, after]) for (const record of Object.values(records)) {
        for (const project of record.projects) delete project.membership_revision;
      }
      assert.deepEqual(after, before);
      return after;
    });
    const list = await tasks(engineer), original = list.find(t => t.function_code === "FN-EP37-001");
    await engineer.page.evaluate(id => sessionStorage.setItem("pc.minimum-test.task", id), original.workspace_id);
    await engineer.page.reload({ waitUntil: "networkidle0" });
    await engineer.page.waitForSelector('.personal-home[aria-busy="false"]');
    await check("REG-007 REG-009", "Home and capability views render at three sizes without allocating execution", async () => {
      const requests = [];
      engineer.page.on("request", request => requests.push(request.url()));
      for (const width of [1440, 1100, 390]) {
        await engineer.page.setViewport({ width, height: 1000 });
        assert(await engineer.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
        assert(await engineer.page.$$eval(".home-project img", nodes => nodes.every(img => img.complete && img.naturalWidth > 0)));
        await engineer.page.screenshot({ path: file(`home-${width}.png`), fullPage: true });
      }
      await engineer.page.$$eval(".home-tabs button", nodes => nodes.find(n => n.textContent.trim() === "我的能力").click());
      await engineer.page.waitForSelector('.personal-capabilities[aria-busy="false"]');
      assert.equal(await engineer.page.$$(".capability-item").then(nodes => nodes.length), 9);
      for (const width of [1440, 1100, 390]) {
        await engineer.page.setViewport({ width, height: 1000 });
        assert(await engineer.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
        await engineer.page.screenshot({ path: file(`capabilities-${width}.png`), fullPage: true });
      }
      assert(!requests.some(url => /\/(prepare|turns|tools|project-data|conversation)$/.test(url)));
    });
    await check("REG-002 REG-003 REG-010", "Real six-read workflow, saved history and navigation retain the selected task", async () => {
      const facts = await pc(engineer, `${base(original)}/project-data`);
      assert.equal(Object.keys(facts.results).length, 6);
      for (const value of Object.values(facts.results)) assert.equal(value.status, "SUCCEEDED");
      const history = await pc(engineer, `${base(original)}/conversation`);
      assert.equal(history.messages.length, 21);
      await nav(engineer.page, "对话");
      await engineer.page.waitForSelector(".chat-message.assistant .chat-markdown table");
      assert.equal(await engineer.page.$eval(".workspace-header h1", n => n.textContent.trim()), original.title);
      await nav(engineer.page, "工作台");
      await engineer.page.waitForSelector(".execution-tabs");
      await nav(engineer.page, "首页");
      await engineer.page.waitForSelector('.personal-home[aria-busy="false"]');
      return { retained_messages: history.messages.length, tool_names: Object.keys(facts.results) };
    });
    await check("REG-008", "No uncaught browser errors during real navigation", async () => assert.deepEqual(errors, []));
  }
  if (phase === "recovery") {
    const original = (await tasks(engineer)).find(t => t.function_code === "FN-EP37-001");
    const originalHistory = digest((await pc(engineer, `${base(original)}/conversation`)).messages);
    const webId = docker("inspect", "--format", "{{.Id}}", "pc-workbench-demo-web-1");
    for (const [id, name] of process.env.PC_TEST_RECOVERY_TAIL ? [] : [["REC-001", "pc-api"], ["REC-002", "ee-api"], ["REC-003", "ee-mcp-adapter"], ["REC-005", "pc-postgres"], ["REC-006", "ee-mysql"]]) {
      await check(id, `Restart ${name}; revalidate real identity, original history and real MCP`, async () => {
        docker("restart", `pc-workbench-demo-${name}-1`);
        await waitReady();
        for (let retry = 0; ; retry++) {
          try {
            assert.equal(digest((await pc(engineer, `${base(original)}/conversation`)).messages), originalHistory);
            const facts = await pc(engineer, `${base(original)}/project-data`);
            assert.equal(Object.keys(facts.results).length, 6);
            break;
          } catch (error) { if (retry >= 20) throw error; await sleep(1000); }
        }
        assert.equal(docker("inspect", "--format", "{{.Id}}", "pc-workbench-demo-web-1"), webId);
      });
    }
    if (!process.env.PC_TEST_RECOVERY_ADAPTER_ONLY) {
    const runtime = "pc-workbench-user-3fa48c6f2484bd3024d91555";
    const chat = await create(reviewer, "recovery state");
    await pc(reviewer, `${base(chat)}/turns`, "POST", { prompt: "Remember RECOVERY_MARKER_9217. Reply exactly RECOVERY_MARKER_9217." });
    await check("REC-004", "Replace exactly one user Runtime, retain its state volume and conversation", async () => {
      const before = docker("inspect", "--format", "{{.Id}}", runtime);
      const mounts = JSON.parse(docker("inspect", "--format", "{{json .Mounts}}", runtime));
      docker("stop", "pc-workbench-demo-pc-api-1");
      try {
        execFileSync("E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe", ["deploy/rollout-user-runtimes.py", runtime], { encoding: "utf8", timeout: 120_000 });
      } finally { docker("start", "pc-workbench-demo-pc-api-1"); await waitReady(); }
      const response = await pc(reviewer, `${base(chat)}/turns`, "POST", { prompt: "What marker did I give you? Reply only with that marker." });
      assert(response.content.includes("RECOVERY_MARKER_9217"));
      assert.notEqual(docker("inspect", "--format", "{{.Id}}", runtime), before);
      const afterMounts = JSON.parse(docker("inspect", "--format", "{{json .Mounts}}", runtime));
      const byTarget = (a, b) => a.Destination.localeCompare(b.Destination);
      assert.deepEqual(afterMounts.sort(byTarget), mounts.sort(byTarget));
    });
    await check("REC-007", "Stopping Runtime during a real model turn fails clearly and the next turn recovers", async () => {
      const pending = pc(reviewer, `${base(chat)}/turns`, "POST", { prompt: "Write a detailed 2000 word explanation of distributed systems consensus." }, true);
      await waitActive(runtime);
      try {
        docker("stop", "--time", "1", runtime);
        const outcome = await pending;
        assert(outcome.status >= 400, "must not claim success after observed Runtime interruption");
        assert.equal((await pc(reviewer, `${base(chat)}/execution`)).runtime_available, false);
      } finally { docker("start", runtime); }
      await sleep(2000);
      const response = await pc(reviewer, `${base(chat)}/turns`, "POST", { prompt: "Reply exactly RECOVERED_AFTER_FAILURE" });
      assert(response.content.includes("RECOVERED_AFTER_FAILURE"));
    });
    }
    await check("REC-008 MCP-008", "An interrupted real MCP connection fails terminally and recovers after restart", async () => {
      const project = await create(engineer, "adapter interruption", "EP37");
      const release = (await pc(engineer, "/v1/workbench/catalog?project_code=EP37")).tools.find(t => t.tool_definition_id === "ee.get_project_context");
      docker("pause", "pc-workbench-demo-ee-mcp-adapter-1");
      let response;
      try {
        const pending = tool(engineer, project, release);
        await sleep(750);
        docker("stop", "--time", "1", "pc-workbench-demo-ee-mcp-adapter-1");
        response = await pending;
        assert(response.status >= 400 || response.body.isError);
      } finally {
        if (docker("inspect", "--format", "{{.State.Paused}}", "pc-workbench-demo-ee-mcp-adapter-1") === "true") docker("unpause", "pc-workbench-demo-ee-mcp-adapter-1");
        docker("start", "pc-workbench-demo-ee-mcp-adapter-1");
      }
      await waitHealthy("pc-workbench-demo-ee-mcp-adapter-1");
      const good = await tool(engineer, project, release);
      assert.equal(good.body.isError, false, JSON.stringify(good));
      const state = await pc(engineer, `${base(project)}/execution`);
      assert(!state.ledger.some(e => ["PENDING", "RUNNING", "DISPATCHING"].includes(e.external?.status)));
      return { interrupted: response.body.structuredContent?.status, recovered: good.body.structuredContent?.status };
    });
    await check("REC-009", "API starts before EE/MCP; proxy and authorization recover without Web restart", async () => {
      const names = ["pc-workbench-demo-ee-api-1", "pc-workbench-demo-ee-mcp-adapter-1"];
      docker("stop", ...names);
      try {
        docker("restart", "pc-workbench-demo-pc-api-1");
        const denied = await pc(engineer, "/v1/identity/me", "GET", undefined, true);
        assert(denied.status >= 400);
      } finally { docker("start", ...names); }
      await waitReady();
      assert.equal(docker("inspect", "--format", "{{.Id}}", "pc-workbench-demo-web-1"), webId);
      assert.equal(digest((await pc(engineer, `${base(original)}/conversation`)).messages), originalHistory);
    });
    await check("REC-012", "User Runtime owners, active turns and volumes settle after recovery", async () => {
      const names = docker("ps", "--filter", "label=pc.demo.project=pc-workbench-demo", "--format", "{{.Names}}").split("\n").filter(Boolean);
      const states = [];
      for (const name of names) {
        const health = JSON.parse(docker("exec", name, "node", "-e", "console.log(await (await fetch('http://127.0.0.1:3100/health')).text())"));
        assert.equal(health.active_sessions, 0); assert.equal(health.revoking_sessions, 0);
        states.push({ name, active_sessions: health.active_sessions, revoking_sessions: health.revoking_sessions });
      }
      const assignments = JSON.parse(docker("exec", "pc-workbench-demo-pc-postgres-1", "psql", "-U", "pc_demo", "-d", "pc_demo", "-Atc",
        "SELECT json_build_object('current_assignments',count(*),'owner_mismatches',count(*) FILTER (WHERE a.user_id<>r.owner_user_id OR a.tenant_id<>r.tenant_id),'invalid_leases',count(*) FILTER (WHERE NOT isfinite(a.lease_expires_at) OR a.lease_expires_at>a.assigned_at+interval '1 day'),'expired_finite_leases',count(*) FILTER (WHERE a.lease_expires_at<now())) FROM pc_session_assignment a JOIN pc_runtime_record r USING(runtime_id,runtime_epoch) WHERE a.current_assignment"));
      assert.equal(assignments.owner_mismatches, 0); assert.equal(assignments.invalid_leases, 0);
      return { states, assignments, expiry_policy: "finite leases are checked during admission; idle expired rows are historical projections" };
    });
  }
} finally {
  await writeFile(file(`${phase}-${tag}.json`), JSON.stringify(results, null, 2));
  await browser.close();
  if (failed) process.exitCode = 1;
}
