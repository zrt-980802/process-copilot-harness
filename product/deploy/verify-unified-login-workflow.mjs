import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const evidence = process.env.PC_TEST_EVIDENCE_DIR ?? "reports/unified-login";
await mkdir(evidence, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:18091/", { waitUntil: "networkidle0" });
  await page.type('[autocomplete="username"]', "demo.engineer");
  await page.type('[autocomplete="current-password"]', "LocalAcceptanceSecret123");
  await page.click('[data-test="login"]');
  await page.waitForSelector('.personal-home[aria-busy="false"]');
  async function api(path) {
    return page.evaluate(async path => {
      const token = sessionStorage.getItem("pc.minimum-test.token");
      const response = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(`${path}: ${response.status}: ${JSON.stringify(body)}`);
      return body;
    }, path);
  }
  const tasks = (await api("/v1/ssts-tasks")).tasks;
  const task = tasks.find(t => t.function_code === "FN-EP37-001");
  assert(task);
  await page.evaluate(id => sessionStorage.setItem("pc.minimum-test.task", id), task.workspace_id);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('.personal-home[aria-busy="false"]');
  const facts = await api(`/v1/workbench/tasks/${task.workspace_id}/project-data`);
  assert.equal(Object.keys(facts.results).length, 6);
  for (const [name, value] of Object.entries(facts.results)) {
    assert.equal(value.status, "SUCCEEDED", name);
    assert.equal(value.result?.data?.ok, true, name);
    assert(value.external_evidence_refs.some(ref => ref.startsWith("eea://traces/")), name);
  }
  const history = await api(`/v1/workbench/tasks/${task.workspace_id}/conversation`);
  assert(history.messages.some(m => m.role === "assistant"));
  await page.$$eval(".nav-rail > button", nodes => nodes.find(n => n.textContent.trim() === "对话").click());
  await page.waitForSelector(".chat-message.assistant .chat-markdown");
  assert.equal(await page.$eval(".workspace-header h1", node => node.textContent.trim()), task.title);
  assert(await page.$(".chat-markdown table"));
  assert(await page.$(".chat-markdown h2"));
  await page.screenshot({ path: `${evidence}/retained-conversation.png`, fullPage: true });
  await page.$$eval(".nav-rail > button", nodes => nodes.find(n => n.textContent.trim() === "工作台").click());
  await page.waitForSelector(".workspace-header");
  await page.screenshot({ path: `${evidence}/retained-original-workbench.png`, fullPage: true });
  assert.deepEqual(errors, []);
  const result = { status: "PASS", workspace_id: task.workspace_id, real_mcp_reads: Object.keys(facts.results),
    retained_messages: history.messages.length, markdown_table: true, markdown_heading: true,
    original_workbench: true, console_errors: errors, model_generation: false };
  await writeFile(`${evidence}/retained-workflow.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
