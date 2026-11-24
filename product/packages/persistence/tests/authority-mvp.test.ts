import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { AuthorityRouter, IdentityAuthorizationService, PcAuthorityDecisionService, runAuthorizationRequest,
  type AuthorityDecision, type AuthorityDecisionInput } from "@pc/application";
import { evidenceDigest } from "@pc/domain";
import { MemoryIdentityAuthorizationRepository } from "../src/index.js";

async function fixture(deny = false, router = new AuthorityRouter()) {
  const repository = new MemoryIdentityAuthorizationRepository();
  const now = () => new Date("2026-11-23T08:00:00.000Z");
  const identity = new IdentityAuthorizationService(repository, "mvp-decision-synthetic-signing-key-00000", [], now, router);
  const account = await identity.provisionPilotAccount({ tenant_id: "mvp", account_key: "engineer", secret: "SyntheticMvpSecret123" });
  if (deny) await identity.replaceAuthorizationGrants({ principal_id: account.principal.principal_id, expected_authorization_revision: 1,
    grants: [{ action: "conversation.run", scope_type: "global", scope_id: "*", effect: "deny", evidence_ref: "pc:deny" }] });
  const login = await identity.signInPilot("mvp", "engineer", "SyntheticMvpSecret123");
  const records: AuthorityDecision[] = [];
  const external = vi.fn(async () => { throw new Error("PC-only must never call an external port"); });
  const decisions = new PcAuthorityDecisionService({ session: input => identity.currentAuthoritySession(input),
    policy: (principal, input) => identity.evaluatePcPolicy(principal, input), router,
    record: async decision => { records.push(decision); }, external, now });
  identity.registerAuthorityDecisions(decisions);
  const input: AuthorityDecisionInput = { principal_id: login.principal.principal_id, pc_session_id: login.session_assurance!.pc_session_id,
    action: "conversation.run", resource_scope_refs: [`user:${login.principal.principal_id}`], tool_release_ids: [] };
  return { repository, identity, account, login, decisions, input, records, external, now };
}

describe("T2A current PC authority decisions (synthetic ports, real PC policy/session)", () => {
  it.each(["conversation.run", "identity.read", "capability.read", "personal_task.read", "personal_task.write"])("keeps %s PC-only with zero external calls", async action => {
    const f = await fixture();
    const result = await f.decisions.decide({ ...f.input, action });
    expect(result).toMatchObject({ decision_mode: "PC_ONLY", decision: "ALLOW", pc_decision: "ALLOW", pc_scope_decision: "ALLOW" });
    expect(Object.keys(result).some(key => key.startsWith("provider_"))).toBe(false);
    expect(result.evidence_refs.every(ref => ref.startsWith("pc:"))).toBe(true);
    expect(result.decision_digest).toBe(evidenceDigest(result, "decision_digest"));
    expect(f.external).not.toHaveBeenCalled();
    expect(f.records).toHaveLength(1);
  });

  it.each(["unknown action", "unknown authority", "wrong owner", "mixed scope"])("denies %s without discovering a Provider", async variant => {
    const f = await fixture();
    const result = await f.decisions.decide({ ...f.input,
      ...(variant === "unknown action" ? { action: "unknown.action" } : {}),
      ...(variant === "unknown authority" ? { resource_authority: "unknown" } : {}),
      ...(variant === "wrong owner" ? { resource_scope_refs: ["user:other"] } : {}),
      ...(variant === "mixed scope" ? { resource_scope_refs: [...f.input.resource_scope_refs, "project:other"] } : {}) });
    expect(result).toMatchObject({ decision_mode: "DENY_UNKNOWN", decision: "DENY" });
    expect(f.external).not.toHaveBeenCalled();
  });

  it("honors PC explicit Deny even if an external provider could allow", async () => {
    const f = await fixture(true);
    expect(await f.decisions.decide(f.input)).toMatchObject({ decision: "DENY", reason_codes: ["pc_policy_denied"] });
    expect(f.external).not.toHaveBeenCalled();
  });

  it("denies ambiguous routes and a mismatched Session owner", async () => {
    const route = { route_id: "pc-test", action_pattern: "conversation.run", resource_scope_pattern: "user:self",
      resource_authority: "pc", authorization_mode: "PC_ONLY" as const };
    const f = await fixture(false, new AuthorityRouter([route, { ...route, route_id: "pc-other" }]));
    expect(await f.decisions.decide(f.input)).toMatchObject({ decision_mode: "DENY_UNKNOWN", decision: "DENY" });
    await expect(f.decisions.decide({ ...f.input, principal_id: "other" })).rejects.toMatchObject({ code: "PC_SESSION_ASSURANCE_DENIED" });
  });

  it("separates logical requests and never reuses a decision receipt", async () => {
    const f = await fixture();
    const first = await runAuthorizationRequest(async () => {
      await f.identity.authenticate(f.login.access_token);
      return f.decisions.decide({ ...f.input, turn_id: "turn:one", tool_call_id: "call:one" });
    });
    const second = await runAuthorizationRequest(async () => {
      await f.identity.authenticate(f.login.access_token);
      return f.decisions.decide({ ...f.input, turn_id: "turn:two", tool_call_id: "call:two" });
    });
    expect(first.logical_request_id).not.toBe(second.logical_request_id);
    expect(first.decision_id).not.toBe(second.decision_id);
    expect(f.records).toHaveLength(2);
  });

  it("denies an authorization receipt that expires during asynchronous policy evaluation", async () => {
    const f = await fixture();
    let instant = f.now();
    const decisions = new PcAuthorityDecisionService({ session: input => f.identity.currentAuthoritySession(input),
      policy: async (principal, input) => { instant = new Date(instant.getTime() + 61_000); return f.identity.evaluatePcPolicy(principal, input); },
      router: f.identity.authorityRouterForDecisions, now: () => instant, record: async receipt => { f.records.push(receipt); }, external: f.external });
    expect(await decisions.decide(f.input)).toMatchObject({ decision: "DENY", pc_decision: "ALLOW", reason_codes: ["decision_expired"] });
    expect(f.external).not.toHaveBeenCalled();
  });

  it("produces unchanged C68-compatible runtime receipts", async () => {
    const f = await fixture();
    const ajv = new Ajv({ strict: true, allErrors: true }); formats(ajv);
    const validate = ajv.compile(JSON.parse(await readFile(new URL("../../contracts/schemas/C68.pc.authority-decision-1.schema.json", import.meta.url), "utf8")));
    for (const result of [await f.decisions.decide(f.input), await f.decisions.decide({ ...f.input, action: "unknown.action" })]) {
      expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
    }
  });
});
