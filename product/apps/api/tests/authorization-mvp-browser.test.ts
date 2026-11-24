import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { EE_V1_MAPPING_RELEASES } from "@pc/application";
import { evidenceDigest } from "@pc/domain";
import { authorizationMvpBrowserFixture, closeAuthorizationBrowserServers } from "./support/authorization-mvp-browser-fixture.js";

const enabled = process.env.PC_AUTH_MVP_BROWSER_TEST === "1";
const root = fileURLToPath(new URL("../../../", import.meta.url));
async function click(page: Page, selector: string, text: string) {
  for (const handle of await page.$$(selector)) {
    if ((await handle.evaluate(node => node.textContent ?? "")).trim().includes(text)) { await handle.click(); return; }
  }
  throw new Error(`Visible control missing: ${text}`);
}
async function fit(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const overlap = await page.evaluate(() => {
    const fields = [...document.querySelectorAll(".authority-status-fields > div")].map(node => node.getBoundingClientRect());
    return fields.some((a, i) => fields.some((b, j) => j > i && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
  });
  expect(overlap).toBe(false);
}

describe.skipIf(!enabled).sequential("MVP production frontend and real PC API (synthetic external Ports)", () => {
  it.each([1440, 390])("checks authorization workflow at %ipx", async width => {
    const output = join(root, "reports/pc-authorization-mvp-01", `browser-${width}-${randomUUID()}`); await mkdir(output, { recursive: true });
    let browser: Browser | undefined;
    let f: Awaited<ReturnType<typeof authorizationMvpBrowserFixture>> | undefined;
    const errors: string[] = [], checks: string[] = [];
    let readEvidence: Record<string, unknown> | undefined;
    try {
      f = await authorizationMvpBrowserFixture(root, output);
      f.state.ready = false;
      browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
      const page = await browser.newPage(); await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
      page.on("pageerror", error => errors.push(String(error)));
      await page.evaluateOnNewDocument(token => { if (!sessionStorage.getItem("pc.minimum-test.token")) sessionStorage.setItem("pc.minimum-test.token", token); }, f.login.access_token);
      await page.goto(f.url, { waitUntil: "networkidle0" });
      await page.waitForSelector("[data-test=authority-status]");
      expect(await page.$eval("[data-test=authority-status]", node => node.textContent)).toContain("个人范围");
      expect(f.source).not.toHaveBeenCalled(); expect(f.directoryCalls()).toBe(0);
      await click(page, ".nav-rail button", "对话");
      await page.waitForSelector("[data-test=new-conversation]");
      await page.click('[aria-label="对话名称"]', { clickCount: 3 }); await page.type('[aria-label="对话名称"]', "MVP 个人权限检查");
      await page.click("[data-test=new-conversation]");
      await page.waitForSelector(".turn-composer textarea");
      await page.waitForNetworkIdle({ idleTime: 200 });
      await page.locator(".turn-composer textarea").fill("请确认个人任务可用。");
      await page.locator("form.turn-composer button[type=submit]").click();
      await page.waitForFunction(() => document.body.innerText.includes("合成 Runtime Port 响应"));
      expect(f.source).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
      await fit(page); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(output, "A-personal.png"), fullPage: true }); checks.push("A: PC-only task/turn, zero Provider authorization/MCP; synthetic Runtime Port explicitly labelled");

      f.state.ready = true;
      await page.click(".refresh-experience");
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="对话范围"] option')].some(node => (node as HTMLOptionElement).value === "MVP-A"));
      await click(page, ".nav-rail button", "对话");
      await page.select('[aria-label="对话范围"]', "MVP-A");
      await page.click('[aria-label="对话名称"]', { clickCount: 3 }); await page.type('[aria-label="对话名称"]', "MVP 项目权限检查");
      await page.click("[data-test=new-conversation]");
      await page.waitForFunction(() => document.querySelector(".chat-context")?.textContent?.includes("MVP-A"));
      await page.waitForNetworkIdle({ idleTime: 200 });
      await page.locator(".turn-composer textarea").fill("请准备当前授权项目的读取会话。");
      await page.locator("form.turn-composer button[type=submit]").click();
      await page.waitForFunction(() => [...document.querySelectorAll("button[role=tab]")].some(node => node.textContent?.includes("工具")));
      await click(page, "button[role=tab]", "工具");
      await click(page, ".tool-roster button", "查询项目功能"); await page.click(".tool-form button[type=submit]");
      await page.waitForFunction(() => [...document.querySelectorAll("button[role=tab]")].some(node => node.textContent?.includes("证据与追溯")));
      await click(page, "button[role=tab]", "证据与追溯");
      await page.waitForFunction(() => [...document.querySelectorAll(".evidence-row > span")].some(node => node.textContent === "SUCCEEDED"));
      expect(f.dispatch).toHaveBeenCalledTimes(1); expect(f.source.mock.calls.length).toBeGreaterThan(0);
      expect(await page.$eval(".evidence-list", node => node.textContent)).toContain("PC · 本地绑定 · 数据源");
      await click(page, ".evidence-row details > summary", "授权记录");
      const decision = (await f.identity.recentAuthorityDecisions(f.login.access_token)).filter(item => item.tool_call_id && item.provider_decision_ref).at(-1)!;
      const operation = await f.repository.getOperation(decision.tool_call_id!);
      readEvidence = { operation_id: decision.tool_call_id, business_state: (await f.events.getOperation(decision.tool_call_id!))?.state,
        pc_session_id: decision.pc_session_id, decision_id: decision.decision_id, logical_request_id: decision.logical_request_id,
        mapping_release_id: decision.provider_mapping_release_id, provider_decision_ref: decision.provider_decision_ref,
        provider_generation: decision.provider_bundle_generation, trace_refs: operation?.result?.external_evidence_refs };
      expect(readEvidence.business_state).toBe("SUCCEEDED");
      const record = await page.$eval(".operation-authority-record", node => node.textContent);
      expect(record).toContain(String(readEvidence.mapping_release_id));
      expect(record).toContain(String(readEvidence.provider_decision_ref));
      await fit(page); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(output, "B-read-succeeded.png"), fullPage: true }); checks.push("B: real PC Gateway/READ projection/audit succeeded using a synthetic Provider");
      await (await page.$(".operation-authority-record dd:last-child"))!.scrollIntoView();
      await page.screenshot({ path: join(output, "B-authorization-record.png"), fullPage: true });

      const sourceAllow = f.source.getMockImplementation()!;
      f.source.mockImplementation(async () => ({ decision: "DENY", reason_codes: ["synthetic-revoked"], evidence_refs: ["synthetic:C41:deny"],
        source: { decision_ref: "synthetic:C41:deny", observed_at: new Date().toISOString() } }));
      await click(page, "button[role=tab]", "工具"); await click(page, ".tool-roster button", "查询项目功能"); await page.click(".tool-form button[type=submit]");
      await page.waitForFunction(() => document.body.innerText.includes("暂不可用") || document.body.innerText.includes("未允许"));
      expect(f.dispatch).toHaveBeenCalledTimes(1);
      await page.screenshot({ path: join(output, "D-source-denied.png"), fullPage: true }); checks.push("D: source Deny clears project data and does not dispatch another MCP operation");
      f.source.mockImplementation(sourceAllow);

      const release = { ...EE_V1_MAPPING_RELEASES.find(item => item.pc_action_pattern === "page:projects")!,
        mapping_release_id: "mapping:synthetic:ambiguous-projects" };
      release.artifact_digest = evidenceDigest(release, "artifact_digest");
      f.mappings.register(release);
      const callsBeforeMapping = f.dispatch.mock.calls.length;
      await page.click(".refresh-experience");
      await page.waitForFunction(() => document.querySelector(".authority-denial")?.textContent?.includes("此项能力暂不可用"));
      expect(f.dispatch).toHaveBeenCalledTimes(callsBeforeMapping);
      expect((await f.identity.recentAuthorityDecisions(f.login.access_token)).some(item => item.decision_mode === "DENY_UNKNOWN"
        && item.reason_codes.includes("compatibility_mapping_unavailable"))).toBe(true);
      await fit(page); await page.screenshot({ path: join(output, "E-mapping-denied.png"), fullPage: true });
      checks.push("E: conflicting immutable Mapping release fails closed; actual UI refresh shows a safe unavailable reason, zero MCP dispatches");

      await f.identity.replaceAuthorizationGrants({ principal_id: f.principal.principal_id, expected_authorization_revision: 2,
        grants: [{ action: "page:functions", scope_type: "project", scope_id: "MVP-A", effect: "deny", evidence_ref: "pc:removed" }] });
      const fresh = await f.identity.signInExternal(f.key, randomUUID(), new Date(Date.now() + 3600_000).toISOString());
      await page.evaluate(token => { sessionStorage.clear(); sessionStorage.setItem("pc.minimum-test.token", token); }, fresh.access_token);
      f.source.mockClear(); await page.reload({ waitUntil: "networkidle0" });
      await page.waitForSelector("[data-test=authority-status]");
      expect(f.source).not.toHaveBeenCalled(); expect(f.dispatch).toHaveBeenCalledTimes(1);
      expect(await page.$$(".tool-roster button")).toHaveLength(0);
      await fit(page); await page.screenshot({ path: join(output, "C-pc-denied.png"), fullPage: true }); checks.push("C: reauthenticated PC policy Deny removes Tool availability, zero source authorizations or MCP dispatches");

      const other = await f.identity.signInExternal({ ...f.key, external_subject: "other" }, randomUUID(), new Date(Date.now() + 3600_000).toISOString());
      await page.evaluate(token => { sessionStorage.clear(); sessionStorage.setItem("pc.minimum-test.token", token); }, other.access_token);
      await page.reload({ waitUntil: "networkidle0" });
      expect(await page.$eval("[data-test=authority-status]", node => node.textContent)).toContain("个人范围");
      expect(await page.$eval("body", node => node.innerText)).not.toContain("合成授权工程 A");
      await fit(page); await page.screenshot({ path: join(output, "account-isolation.png"), fullPage: true }); checks.push("Different account has no previous project, task, Tool or identity presentation");
      expect(errors).toEqual([]);
      await writeFile(join(output, "results.json"), JSON.stringify({ width, checks, read_evidence: readEvidence, page_errors: errors, requests: f.requests,
        actual: "production PC frontend and real API/domain services", synthetic: ["Provider registration, authorization and MCP Ports", "Runtime transport/answer"],
        not_executed: ["real EE", "real Runtime/model acceptance"] }, null, 2), { flag: "wx" });
    } catch (error) {
      if (browser) { const pages = await browser.pages(); await pages.at(-1)?.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => undefined); }
      await writeFile(join(output, "failure.json"), JSON.stringify({ checks, page_errors: errors, message: error instanceof Error ? error.message : "Browser failure", requests: f?.requests }, null, 2), { flag: "wx" });
      throw error;
    } finally { await browser?.close(); await f?.close(); await closeAuthorizationBrowserServers(); }
  }, 120_000);
});
