import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { C67Contract, C68Contract, C69Contract } from "../src/generated/contracts.js";
import { canonical, decisionOutcome, legacyOutcome, mappingOutcome, seal, sessionOutcome,
  type DecisionContext, type SessionContext } from "./support/adr0025-oracle.js";

const root = "packages/contracts/";
const json = async (file: string) => JSON.parse(await readFile(root + file, "utf8"));
const session = await json("fixtures/valid/C67.valid.json") as C67Contract;
const decision = await json("fixtures/valid/C68.valid.json") as C68Contract;
const mapping = await json("fixtures/valid/C69.valid.json") as C69Contract;
const golden = await json("fixtures/adr0025-golden-matrix.json") as {
  baseline_page_keys_v1: string[];
  session: Array<{name: string; patch: Partial<C67Contract>; context: Partial<SessionContext>; expected: string}>;
  decision: Array<{name: string; patch: Partial<C68Contract>; remove?: string[]; context: Partial<DecisionContext>; expected: string}>;
  legacy: Array<{name: string; page: string; effects: Record<string, string>;
    member?: boolean; objectAllow?: boolean; toolAllow?: boolean; expected: {decision: string; source: string}}>;
};
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
const schemas = await Promise.all([
  "C67.pc.session-assurance-1", "C68.pc.authority-decision-1", "C69.pc.provider-compatibility-mapping-1"
].map((file) => json(`schemas/${file}.schema.json`)));
const [validSession, validDecision, validMapping] = schemas.map((schema) => ajv.compile(schema));
const sessionContext: SessionContext = {
  now: "2026-11-21T00:00:10.000Z", event: "ISSUE", providerAvailable: true,
  identityRevision: 1, authorizationRevision: 1, pcMaxLifetimeMsAtIssue: 7_200_000
};
const binding: DecisionContext["binding"] = {
  logical_request_id: decision.logical_request_id, turn_id: decision.turn_id, tool_call_id: decision.tool_call_id,
  principal_id: decision.principal_id, tenant_id: decision.tenant_id, pc_session_id: decision.pc_session_id,
  action: decision.action, resource_ref: decision.resource_ref, resource_authority: decision.resource_authority
};
function context(): DecisionContext {
  return structuredClone({
    now: sessionContext.now, requestStartedAt: decision.observed_at, session,
    pcPolicyRevision: 1, binding, generation: "epoch.1", providerId: "provider:eeclaw",
    compatibilityVersion: "ee-v1", providerAvailable: true, providerCallCount: 1,
    source: { ref: decision.provider_decision_ref!, decision: "ALLOW", observedAt: decision.provider_decision_observed_at!,
      expiresAt: decision.expires_at, revoked: false, generation: "epoch.1",
      mappingReleaseId: mapping.mapping_release_id, binding: structuredClone(binding) }, mappings: [mapping]
  });
}
function checkSession(value: C67Contract, input = sessionContext) {
  return validSession!(value) ? sessionOutcome(value, input) : "DENY";
}
function checkDecision(value: C68Contract, input = context()) {
  return validDecision!(value) && input.mappings.every((item) => validMapping!(item))
    ? decisionOutcome(value, input) : "DENY";
}

it("T0 inventory exposes C67-C69 and all 69 generated contracts", async () => {
  const manifest = JSON.parse(await readFile("packages/contracts/contract-manifest.json", "utf8"));
  expect(manifest.contracts).toHaveLength(69);
  for (const [id, name] of [
    ["C67", "pc.session-assurance/1"],
    ["C68", "pc.authority-decision/1"],
    ["C69", "pc.provider-compatibility-mapping/1"]
  ]) {
    expect(manifest.contracts.find((entry: { id: string }) => entry.id === id)?.contract_name).toBe(name);
  }
});

describe("C67 fixed assurance golden matrix", () => {
  it.each(golden.session)("$name", ({ patch, context: override, expected }) => {
    expect(checkSession({ ...session, ...patch }, { ...sessionContext, ...override })).toBe(expected);
  });

  it.each(["LOCAL", "STANDALONE"] as const)("%s cannot fake an external link or evidence", (method) => {
    const local = { ...session, authentication_method: method, identity_provider_ref: method.toLowerCase(),
      assurance_level: "LOCAL_VERIFIED" as const };
    delete local.identity_link_id;
    delete local.authentication_evidence_expires_at;
    expect(checkSession(local, { ...sessionContext, providerAvailable: false })).toBe("ALLOW");
    expect(checkSession({ ...local, identity_link_id: "identity-link:fake" })).toBe("DENY");
    expect(checkSession({ ...local, authentication_evidence_expires_at: session.absolute_expires_at })).toBe("DENY");
  });

  it.each(["provider_session_id", "cookie", "access_token", "secret"])("forbids %s", (field) => {
    expect(validSession!({ ...session, [field]: "forbidden-fixture-value" })).toBe(false);
  });

  it.each(["OBSERVE", "IDLE_RENEW"] as const)("%s cannot slide absolute expiry or its issue-time bounds", (event) => {
    const input = { ...sessionContext, event, previous: session };
    expect(checkSession({ ...session, idle_expires_at: "2026-11-21T00:45:00.000Z" }, input)).toBe("ALLOW");
    for (const patch of [
      { absolute_expires_at: "2026-11-21T00:59:00.000Z" },
      { absolute_expires_at: "2026-11-21T01:30:00.000Z", authentication_evidence_expires_at: "2026-11-21T03:00:00.000Z" },
      { pc_absolute_limit_at: "2026-11-21T03:00:00.000Z" },
      { issued_at: "2026-11-21T00:00:05.000Z" }
    ]) expect(checkSession({ ...session, ...patch }, input)).toBe("DENY");
  });

  it("reauthentication requires a new ID and live source, never mutates existing assurance", () => {
    const input = { ...sessionContext, event: "REAUTHENTICATE" as const, previous: session };
    expect(checkSession(session, input)).toBe("DENY");
    const renewed = { ...session, pc_session_id: "pc-session:new" };
    expect(checkSession(renewed, input)).toBe("ALLOW");
    expect(checkSession(renewed, { ...input, providerAvailable: false })).toBe("DENY");
  });

  it("cannot renew an already idle-expired assurance", () => {
    expect(checkSession({ ...session, idle_expires_at: session.absolute_expires_at }, {
      ...sessionContext, now: "2026-11-21T00:30:00.000Z", event: "IDLE_RENEW", previous: session
    })).toBe("DENY");
  });

  it("cannot forge a higher PC cap alongside later external evidence", () => {
    expect(checkSession({ ...session, absolute_expires_at: "2026-11-21T03:00:00.000Z",
      pc_absolute_limit_at: "2026-11-21T04:00:00.000Z",
      authentication_evidence_expires_at: "2026-11-21T04:00:00.000Z" })).toBe("DENY");
  });
});

describe("C68 intersection and request-bound evidence golden matrix", () => {
  it.each(golden.decision)("$name", ({ patch, remove, context: override, expected }) => {
    const value = { ...decision, ...patch };
    for (const field of remove ?? []) delete value[field];
    expect(checkDecision(value, { ...context(), ...override })).toBe(expected);
  });

  it.each(["logical_request_id", "turn_id", "tool_call_id", "principal_id", "tenant_id", "pc_session_id",
    "action", "resource_ref", "resource_authority"] as const)("cannot reuse across %s", (field) => {
    const current = context();
    current.binding[field] = "changed-boundary";
    const receipt = { ...decision, [field]: "changed-boundary" };
    expect(checkDecision(receipt, current)).toBe("DENY");
  });

  it.each(["turn_id", "tool_call_id"] as const)("missing/new %s is also a changed boundary", (field) => {
    const current = context();
    delete current.binding[field];
    const receipt = { ...decision };
    delete receipt[field];
    expect(checkDecision(receipt, current)).toBe("DENY");
  });

  it("same request reuse is repeatable without making another source call", () => {
    const current = context();
    expect(checkDecision(decision, current)).toBe("ALLOW");
    expect(checkDecision(decision, current)).toBe("ALLOW");
    expect(current.providerCallCount).toBe(1);
  });

  it.each(["observedAt", "expiresAt"] as const)("missing source %s cannot produce Allow", (field) => {
    const current = context();
    current.source[field] = "";
    expect(checkDecision(decision, current)).toBe("DENY");
  });

  it.each(["revoked", "expired", "staleObservation", "futureObservation", "sourceDeny", "generationMismatch", "mappingMismatch"])(
    "rejects source %s", (state) => {
      const current = context();
      if (state === "revoked") current.source.revoked = true;
      if (state === "expired") current.source.expiresAt = current.now;
      if (state === "staleObservation") current.source.observedAt = "2026-11-20T23:59:59.000Z";
      if (state === "futureObservation") current.source.observedAt = "2026-11-21T00:00:11.000Z";
      if (state === "sourceDeny") current.source.decision = "DENY";
      if (state === "generationMismatch") current.source.generation = "epoch.0";
      if (state === "mappingMismatch") current.source.mappingReleaseId = "mapping:old";
      expect(checkDecision(decision, current)).toBe("DENY");
    }
  );

  it.each(["revoked", "expired", "idle", "identity"])("rejects %s PC session", (state) => {
    const current = context();
    if (state === "revoked") current.session.session_state = "REVOKED";
    if (state === "expired") current.session.absolute_expires_at = current.now;
    if (state === "idle") current.session.idle_expires_at = current.now;
    if (state === "identity") current.session.identity_revision = 2;
    expect(checkDecision(decision, current)).toBe("DENY");
  });

  function personal() {
    const receipt: C68Contract = { ...decision, decision_mode: "PC_ONLY", action: "conversation.run",
      resource_authority: "pc", resource_ref: "pc:personal:contract", evidence_refs: ["pc:policy:1"] };
    for (const key of Object.keys(receipt)) if (key.startsWith("provider_")) delete receipt[key];
    const current = context();
    current.binding = { ...current.binding, action: receipt.action, resource_authority: "pc", resource_ref: receipt.resource_ref };
    current.providerAvailable = false;
    current.mappings = [];
    current.providerCallCount = 0;
    return { receipt, current };
  }

  it("Standalone PC_ONLY uses no EE mapping, decision or calls during outage", () => {
    const { receipt, current } = personal();
    expect(checkDecision(receipt, current)).toBe("ALLOW");
    expect(current.mappings).toEqual([]);
    expect(current.providerCallCount).toBe(0);
    expect(Object.keys(receipt).some((key) => key.startsWith("provider_"))).toBe(false);
  });

  it.each(["provider_decision_ref", "provider_registration_id", "provider_bundle_generation", "provider_mapping_release_id"])(
    "PC_ONLY forbids %s", (field) => {
      const { receipt, current } = personal();
      expect(checkDecision({ ...receipt, [field]: decision[field] }, current)).toBe("DENY");
    }
  );

  it("PC_ONLY forbids Provider call evidence, including an unreferenced call", () => {
    const { receipt, current } = personal();
    expect(checkDecision({ ...receipt, evidence_refs: ["provider-call:request:1"] }, current)).toBe("DENY");
    expect(checkDecision(receipt, { ...current, providerCallCount: 1 })).toBe("DENY");
  });

  it("unknown PC actions cannot acquire an Allow by declaring PC_ONLY", () => {
    const { receipt, current } = personal();
    current.binding.action = "unknown.action";
    expect(checkDecision({ ...receipt, action: "unknown.action" }, current)).toBe("DENY");
  });

  it("DENY_UNKNOWN is a valid denial receipt with no guessed source Allow", () => {
    const { receipt } = personal();
    const denied = { ...receipt, decision_mode: "DENY_UNKNOWN", decision: "DENY", reason_codes: ["authority_missing"] };
    expect(validDecision!(denied)).toBe(true);
    expect(validDecision!({ ...denied, decision: "ALLOW" })).toBe(false);
    expect(validDecision!({ ...denied, provider_decision: "ALLOW" })).toBe(false);
    expect(validDecision!({ ...decision, decision: "DENY", provider_decision_ref: undefined })).toBe(true);
  });
});

describe("C69 mapping release golden matrix", () => {
  it.each(["duplicate", "ambiguous", "version", "authority", "registration", "future", "revoked", "superseded", "tampered"])(
    "denies %s mapping", (state) => {
      const current = context();
      if (state === "duplicate") current.mappings.push(structuredClone(mapping));
      if (state === "ambiguous") current.mappings.push(seal({ ...mapping, mapping_release_id: "mapping:other", pc_action_pattern: "ssts.*" }, "artifact_digest"));
      if (state === "version") current.mappings[0]!.compatibility_version = "unknown-v9";
      if (state === "authority") current.mappings[0]!.resource_authority = "other";
      if (state === "registration") current.mappings[0]!.provider_registration_id = "provider:other";
      if (state === "future") current.mappings[0]!.effective_from = "2026-11-22T00:00:00.000Z";
      if (state === "revoked") current.mappings[0]!.status = "REVOKED";
      if (state === "superseded") current.mappings[0]!.status = "SUPERSEDED";
      if (state === "tampered") current.mappings[0]!.provider_tool_mapping = { tool_keys: ["ee.other"] };
      if (["duplicate", "ambiguous"].includes(state)) {
        expect(current.mappings.every((item) => validMapping!(item))).toBe(true);
      }
      expect(checkDecision(decision, current)).toBe("DENY");
    }
  );

  it("ACTIVE content is immutable even when a caller recalculates its digest", () => {
    expect(mappingOutcome(mapping, mapping)).toBe("ALLOW");
    const changed = seal({ ...mapping, provider_tool_mapping: { tool_keys: ["ee.other"] } }, "artifact_digest");
    expect(mappingOutcome(changed, mapping)).toBe("DENY");
    expect(mappingOutcome({ ...changed, mapping_release_id: "mapping:2" }, mapping)).toBe("DENY");
    const next = seal({ ...changed, mapping_release_id: "mapping:2", supersedes_release_id: mapping.mapping_release_id }, "artifact_digest");
    expect(mappingOutcome(next, mapping)).toBe("ALLOW");
  });

  it.each(["grant", "allow_cache", "endpoint", "cookie", "token", "secret", "roles", "members"])(
    "forbids %s in root or mapping payload", (field) => {
      expect(validMapping!({ ...mapping, [field]: "forbidden-fixture-value" })).toBe(false);
      expect(validMapping!({ ...mapping, provider_permission_mapping: { ...mapping.provider_permission_mapping, [field]: "forbidden" } })).toBe(false);
    }
  );

  it("a second-provider fixture uses its own mapping without extending core modes", () => {
    const other = seal({ ...mapping, mapping_release_id: "mapping:fixture-only:1", provider_registration_id: "provider:fixture-only",
      provider_type: "fixture-only", compatibility_version: "fixture-v1", resource_authority: "fixture-only",
      provider_permission_mapping: { permission_keys: ["spec.read"], baseline_page_keys_version: "NOT_APPLICABLE" },
      provider_action_mapping: { action_keys: ["spec.read"] }, provider_tool_mapping: { tool_keys: ["spec.read"] } }, "artifact_digest");
    expect(validMapping!(other)).toBe(true);
    const current = context();
    current.mappings = [other];
    expect(checkDecision(decision, current)).toBe("DENY");
    expect(schemas[1].properties.decision_mode.enum).toEqual(["PC_ONLY", "PC_AND_PROVIDER", "DENY_UNKNOWN"]);
  });
});

describe("C41/C42 EE V1 golden compatibility (pure oracle)", () => {
  it.each(golden.legacy)("$name", (row) => {
    expect(legacyOutcome({ member: true, objectAllow: true, toolAllow: true,
      ...row, baseline: golden.baseline_page_keys_v1 })).toEqual(row.expected);
  });

  it.each(golden.baseline_page_keys_v1)("preserves wildcard baseline %s", (page) => {
    expect(legacyOutcome({ page, effects: { "page:*": "allow" }, baseline: golden.baseline_page_keys_v1,
      member: true, objectAllow: true, toolAllow: true })).toEqual({ decision: "ALLOW", source: "baseline" });
  });

  it("pins baseline to C42 and keeps all eight table/API/audit fingerprints without migration", async () => {
    const compatibility = await json("fixtures/valid/C42.valid.json");
    expect(createHash("sha256").update(JSON.stringify(golden.baseline_page_keys_v1)).digest("hex"))
      .toBe(compatibility.baseline_page_keys_digest);
    expect(compatibility.data_migration_required).toBe(false);
    expect(compatibility.revocation_mode).toBe("request_time");
    expect(compatibility.source_commit).toBe("cefa7432f966e17b41c1638e128de652b934fd20");
    for (const key of ["schema_fingerprint", "api_fingerprint", "auth_me_fingerprint", "audit_fingerprint"]) {
      expect(compatibility[key]).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("request-time role/membership/action revocation cannot reuse previous Allow", () => {
    const initial = { page: "page:architecture", effects: { "page:*": "allow" },
      baseline: golden.baseline_page_keys_v1, member: true, objectAllow: true, toolAllow: true };
    const before = structuredClone(initial);
    expect(legacyOutcome(initial).decision).toBe("ALLOW");
    const revokedInputs: Array<Parameters<typeof legacyOutcome>[0]> = [
      { ...initial, member: false }, { ...initial, effects: {} },
      { ...initial, effects: { "page:*": "allow", "page:architecture": "deny" } },
      { ...initial, objectAllow: false }, { ...initial, toolAllow: false }
    ];
    for (const current of revokedInputs) expect(legacyOutcome(current).decision).toBe("DENY");
    expect(initial).toEqual(before);
    const current = context();
    current.binding.logical_request_id = "request:after-revocation";
    current.source.revoked = true;
    expect(checkDecision({ ...decision, logical_request_id: current.binding.logical_request_id }, current)).toBe("DENY");
  });

  it("all generated T0 fixtures have canonical content digests", () => {
    for (const [value, field] of [[session, "assurance_digest"], [decision, "decision_digest"], [mapping, "artifact_digest"]] as const) {
      expect(seal(value, field)[field]).toBe(value[field]);
    }
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
  });
});
