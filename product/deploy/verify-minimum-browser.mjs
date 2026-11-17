import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const root = process.cwd();
const reportRoot = path.resolve(root, "reports", "minimum-acceptance");
const expectedRoot = `${path.resolve(root)}${path.sep}`;
if (!reportRoot.startsWith(expectedRoot)) {
  throw new Error(`Refusing to use report path outside workspace: ${reportRoot}`);
}
await rm(reportRoot, { recursive: true, force: true });
await mkdir(reportRoot, { recursive: true });

const executablePath = process.env.PC_CHROME_PATH
  ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseUrl = process.env.PC_ACCEPTANCE_URL ?? "http://127.0.0.1:18090";
const consoleErrors = [];
const pageErrors = [];

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"]
});

async function waitText(page, selector, text) {
  await page.waitForFunction(
    (targetSelector, targetText) =>
      [...document.querySelectorAll(targetSelector)]
        .some((element) => element.textContent?.includes(targetText)),
    { timeout: 15_000 },
    selector,
    text
  );
}

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: reportRoot,
    eventsEnabled: true
  });

  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  await page.screenshot({
    path: path.join(reportRoot, "01-login-desktop.png"),
    fullPage: true
  });

  await page.click('[data-test="login"]');
  await page.waitForSelector(".app-shell", { timeout: 15_000 });
  await page.click('[data-test="create-task"]');
  await page.waitForSelector(".workbench", { timeout: 15_000 });

  await page.click('[data-test="sample-PRD"]');
  await waitText(page, '[data-slot="PRD"]', "sample-payment-prd.md");
  await page.click('[data-test="sample-ARCHITECTURE"]');
  await waitText(
    page,
    '[data-slot="ARCHITECTURE"]',
    "sample-payment-architecture.md"
  );
  await page.click('[data-test="check-inputs"]');
  await waitText(page, '[data-test="workspace-state"]', "可生成");

  await page.click('[data-test="send-message"]');
  await waitText(page, ".message-list", "#1");

  await page.click('[data-test="generate-draft"]');
  await waitText(page, '[data-test="draft-revision"]', "Revision 1");
  await waitText(page, ".draft-content", "# AI DRAFT - SSTS");
  await waitText(page, ".validation-badge", "PASSED");

  const firstEvidence = await page.evaluate(() => ({
    checks: document.querySelectorAll(".check-row").length,
    citations: document.querySelectorAll(".citation-list article").length
  }));
  if (firstEvidence.checks !== 4 || firstEvidence.citations < 2) {
    throw new Error(
      `Unexpected evidence counts: ${JSON.stringify(firstEvidence)}`
    );
  }

  await page.click('[data-test="reject-draft"]');
  await waitText(page, '[data-test="workspace-state"]', "已驳回");
  await page.click('[data-test="generate-draft"]');
  await waitText(page, '[data-test="draft-revision"]', "Revision 2");
  await page.click('[data-test="accept-draft"]');
  await waitText(page, '[data-test="workspace-state"]', "已接受");

  await page.click('[data-test="download-draft"]');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const downloaded = (await readdir(reportRoot))
    .filter((file) => file.endsWith(".md"));
  if (downloaded.length !== 1) {
    throw new Error(`Expected one downloaded Markdown file, found ${downloaded}`);
  }

  await page.reload({ waitUntil: "networkidle0" });
  await waitText(page, '[data-test="workspace-state"]', "已接受");
  await waitText(page, '[data-test="draft-revision"]', "Revision 2");
  await page.screenshot({
    path: path.join(reportRoot, "02-accepted-desktop.png"),
    fullPage: true
  });

  const desktop = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    state: document.querySelector('[data-test="workspace-state"]')?.textContent?.trim(),
    revision: document.querySelector('[data-test="draft-revision"]')?.textContent?.trim()
  }));

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: "networkidle0" });
  await waitText(page, '[data-test="workspace-state"]', "已接受");
  const mobile = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  await page.screenshot({
    path: path.join(reportRoot, "03-accepted-mobile.png"),
    fullPage: true
  });

  if (desktop.scrollWidth !== desktop.width) {
    throw new Error(`Desktop overflow: ${JSON.stringify(desktop)}`);
  }
  if (mobile.scrollWidth !== mobile.width) {
    throw new Error(`Mobile overflow: ${JSON.stringify(mobile)}`);
  }
  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(JSON.stringify({ consoleErrors, pageErrors }));
  }

  console.log(JSON.stringify({
    accepted: true,
    refreshed: true,
    downloaded,
    firstEvidence,
    desktop,
    mobile,
    screenshots: [
      path.join(reportRoot, "01-login-desktop.png"),
      path.join(reportRoot, "02-accepted-desktop.png"),
      path.join(reportRoot, "03-accepted-mobile.png")
    ],
    consoleErrors,
    pageErrors
  }, null, 2));
} finally {
  await browser.close();
}
