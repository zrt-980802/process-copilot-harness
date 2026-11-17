/* global document, window, getComputedStyle */
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const output = path.resolve("reports/fe-demo-01", `deployment-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await fs.mkdir(output, { recursive: true });
const report = { classification: "LOCAL DEVELOPMENT PREVIEW", checks: [], independent_acceptance: false };
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
let page;
try {
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:18092/login?redirect=/access-control", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[autocomplete="username"]');
  await page.type('[autocomplete="username"]', "demo.admin");
  await page.type('[autocomplete="current-password"]', process.env.FE_ADMIN_PASSWORD || "LocalDemoAdminSecret123");
  await page.click(".submit-button");
  await page.waitForSelector(".account-table", { timeout: 45000 });
  report.checks.push("18092 actual Admin login/account-management");
  assert.equal(await page.$$eval(".app-main a", (els) => els.filter((el) => el.href.startsWith("http://127.0.0.1:18091/")).length), 0);
  report.checks.push("old content PC entry removed");
  for (const width of [1440, 1100, 390]) {
    await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
    await page.waitForFunction((mobile) => !!document.querySelector(".mobile-pc-menu-item") === mobile, {}, width === 390);
    if (width === 390) await page.click(".account-trigger");
    await page.waitForSelector("a.global-pc-entry", { visible: true });
    const result = await page.$eval("a.global-pc-entry", (el) => {
      const r = el.getBoundingClientRect(); const a = document.querySelector(".account-trigger").getBoundingClientRect();
      return { href: el.href, name: el.getAttribute("aria-label"), tooltip: el.title, inMenu: !!el.closest(".el-dropdown-menu"),
        rect: { x: r.x, right: r.right, y: r.y, bottom: r.bottom }, accountX: a.x,
        visible: [...document.querySelectorAll("a.global-pc-entry")].filter((e) => e.getBoundingClientRect().width && getComputedStyle(e).visibility !== "hidden").length,
        viewport: { width: window.innerWidth, height: window.innerHeight } };
    });
    assert.equal(result.href, "http://127.0.0.1:18091/");
    assert.equal(result.visible, 1); assert.equal(result.inMenu, width === 390);
    assert.equal(result.name, "打开 Process Copilot"); assert(result.tooltip);
    assert(result.rect.x >= 0 && result.rect.right <= width + 1 && result.rect.bottom <= result.viewport.height);
    if (width !== 390) assert(result.rect.right <= result.accountX);
    await page.focus("a.global-pc-entry");
    assert(await page.$eval("a.global-pc-entry", (el) => el === document.activeElement));
    await page.screenshot({ path: path.join(output, `ee-${width}.png`) });
    report.checks.push({ width, result });
    if (width === 390) await page.keyboard.press("Escape");
  }
  // Authenticated shell on a second route, then actual keyboard SSO to unchanged PC18091.
  await page.goto("http://127.0.0.1:18092/403", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".account-trigger"); await page.click(".account-trigger");
  await page.waitForSelector("a.global-pc-entry", { visible: true });
  const target = browser.waitForTarget((t) => t.url().startsWith("http://127.0.0.1:18091/"));
  await page.focus("a.global-pc-entry"); await page.keyboard.press("Enter");
  const pc = await (await target).page();
  await pc.waitForSelector('.personal-home[aria-busy="false"]', { timeout: 90000 });
  assert.equal(await pc.$(".home-error"), null);
  await pc.screenshot({ path: path.join(output, "pc-sso.png") });
  report.checks.push("second authenticated EE route and mobile keyboard SSO to PC18091");
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL"; report.error = error.message;
  if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2), { flag: "wx" });
}
console.log(JSON.stringify({ status: report.status, evidence: output, error: report.error }));
process.exitCode = report.status === "PASS" ? 0 : 1;
