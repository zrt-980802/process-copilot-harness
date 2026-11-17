import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const evidence = path.resolve(process.env.PC_BROWSER_EVIDENCE ?? "reports/dev09a-complete");
await mkdir(evidence, { recursive: true });
const state = JSON.parse(await readFile(process.env.PC_ACCEPTANCE_STATE, "utf8"));
const browser = await puppeteer.launch({ executablePath: process.env.PC_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
const errors = [];
let page;
async function waitText(page, selector, text, timeout = 650_000) {
  await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].some((node) => node.textContent.includes(text)), { timeout }, selector, text);
}
try {
  page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push({ text: message.text(), url: message.location().url }); });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((id) => sessionStorage.setItem("pc.minimum-test.task", id), state.workspace.workspace_id);
  await page.goto("http://127.0.0.1:18090", { waitUntil: "networkidle0" });
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: evidence });
  await page.click('[data-test="login"]');
  await page.waitForSelector(".execution-tabs", { timeout: 20_000 });
  await waitText(page, ".tool-roster", "ee.submit_ssts_review", 20_000);
  assert.equal(await page.$$eval(".tool-roster button", (nodes) => nodes.length), 9);
  await page.$$eval(".tool-roster button", (nodes) => nodes.find((node) => node.textContent.includes("ee.list_requirements")).click());
  await page.waitForSelector('.tool-form input[type="number"]');
  await page.type('.tool-form input[type="number"]', "1");
  await page.waitForSelector('.tool-form button[type="submit"]:not([disabled])');
  await page.click('.tool-form button[type="submit"]');
  await waitText(page, ".tool-result pre", '"isError": false', 20_000);
  await waitText(page, ".tool-result pre", "REQ-000001", 20_000);
  await page.screenshot({ path: path.join(evidence, "01-tools-desktop.png"), fullPage: true });
  await page.$$eval(".execution-tabs button", (nodes) => nodes.find((node) => node.textContent.includes("运行")).click());
  await waitText(page, ".runtime-facts", "epoch 2", 20_000);
  await page.screenshot({ path: path.join(evidence, "02-runtime-desktop.png"), fullPage: true });
  await page.type('.turn-composer textarea', "Read ee.list_requirements and explain each requirement in substantial detail, including at least twenty verification cases. Do not write anything to EE.");
  await page.waitForSelector('.turn-composer button[type="submit"]:not([disabled])');
  const turnResponse = page.waitForResponse((response) => response.url().endsWith("/turns") && response.request().method() === "POST", { timeout: 90_000 }).catch((error) => ({ failed: error.message }));
  await page.click('.turn-composer button[type="submit"]');
  let cancellation;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const response = page.waitForResponse((entry) => entry.url().endsWith("/cancel") && entry.request().method() === "POST");
    await page.click('.turn-composer button[type="button"]');
    cancellation = await (await response).json();
    if (cancellation.runtime_observation?.was_running) break;
  }
  assert.equal(cancellation.runtime_observation?.was_running, true, JSON.stringify(cancellation));
  assert.equal(cancellation.runtime_observation?.cancel_requested, true);
  const completedResponse = await turnResponse;
  assert(!completedResponse.failed, JSON.stringify(completedResponse));
  const cancelledTurn = await completedResponse.json();
  assert.equal(cancelledTurn.error?.code, "PC_DSH_CANCELLED");
  const cancellationHttpStatus = completedResponse.status();
  for (let index = errors.length - 1; index >= 0; index -= 1) {
    if (errors[index].url?.endsWith("/turns") && errors[index].text.includes(`status of ${cancellationHttpStatus}`)) errors.splice(index, 1);
  }
  await writeFile(path.join(evidence, "cancelled-turn.json"), JSON.stringify({ cancellation, cancelledTurn }, null, 2));
  await page.$$eval(".execution-tabs button", (nodes) => nodes.find((node) => node.textContent.includes("证据")).click());
  await page.waitForSelector(".evidence-row a");
  await page.click(".evidence-row a");
  await waitText(page, ".owner-resource", "EP37", 20_000);
  await waitText(page, ".owner-resource pre", '"isError": false', 20_000);
  await page.screenshot({ path: path.join(evidence, "03-owner-evidence.png"), fullPage: true });
  await page.click('[title="关闭 Owner 资源"]');
  if (!(await page.$eval('[data-test="workspace-state"]', (node) => node.textContent.includes("已接受")))) {
  await page.click('[data-test="reject-draft"]');
  await waitText(page, '[data-test="workspace-state"]', "已驳回", 20_000);
  await page.click('[data-test="generate-draft"]');
  await waitText(page, '[data-test="draft-revision"]', "Revision 2");
  await waitText(page, ".draft-content", "eea://traces/");
  await page.click('[data-test="accept-draft"]');
  await waitText(page, '[data-test="workspace-state"]', "已接受", 20_000);
  }
  await page.click('[data-test="download-draft"]');
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((node) => node.disabled && node.dataset.test === "download-draft"));
  const deadline = Date.now() + 15_000;
  let downloads = [];
  const displayedDraft = await page.$eval(".draft-content", (node) => node.textContent.trim());
  let draft = "";
  while (Date.now() < deadline) {
    downloads = (await readdir(evidence)).filter((name) => name.endsWith(".md"));
    for (const name of downloads) {
      const value = await readFile(path.join(evidence, name), "utf8");
      if (value.trim() === displayedDraft) { draft = value; break; }
    }
    if (draft) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(draft, "Downloaded Markdown must equal the exact displayed revision");
  assert(draft.includes("AI DRAFT") && draft.includes("FN-EP37-001") && draft.includes("eea://traces/") && draft.includes("100"));
  await page.reload({ waitUntil: "networkidle0" });
  await waitText(page, '[data-test="workspace-state"]', "已接受", 20_000);
  await waitText(page, '[data-test="draft-revision"]', "Revision 2", 20_000);
  const layouts = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1100, height: 850 }, { width: 390, height: 844 }]) {
    await page.setViewport(viewport);
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll("main button, main input, main h1, main h2, main h3")].filter((node) => !node.closest(".task-list") && node.getBoundingClientRect().right > innerWidth + 1).map((node) => node.textContent.slice(0, 70)) }));
    layouts.push(layout);
    assert.equal(layout.scrollWidth, layout.width, JSON.stringify(layout));
    assert.equal(layout.overflow.length, 0, JSON.stringify(layout));
    await page.screenshot({ path: path.join(evidence, `04-accepted-${viewport.width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  const report = { status: "PASS", real_model_revision: 2, downloads, layouts, errors,
    owner_resource_navigation: true, schema_form_real_tool: true, running_turn_cancelled: true, cancellation_http_status: cancellationHttpStatus,
    runtime_replacement_visible: true, rejected_rerun_accepted_refreshed: true };
  await writeFile(path.join(evidence, "browser-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(evidence, "failure.png"), fullPage: true });
    await writeFile(path.join(evidence, "failure.txt"), await page.$eval("body", (node) => node.innerText));
  }
  throw error;
} finally { await browser.close(); }
