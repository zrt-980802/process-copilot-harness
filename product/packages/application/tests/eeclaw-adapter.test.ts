import { describe, expect, it } from "vitest";
import { HttpEeClawAuthorizationAdapter } from "../src/eeclaw-adapter.js";
import type { PCPrincipal } from "@pc/domain";

const principal: PCPrincipal = {
  principal_id: "principal-1",
  principal_type: "human",
  tenant_id: "tenant-1",
  lifecycle_status: "active",
  primary_identity_ref: "identity-1",
  identity_revision: 1,
  authorization_revision: 2,
  created_at: "2026-11-10T09:00:00.000Z",
  updated_at: "2026-11-10T09:00:00.000Z"
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("EE Claw read-only authorization adapter", () => {
  it("sends the project read operation and rejects mismatched or malformed authority", async () => {
    let calls = 0;
    let mode = "ok";
    const adapter = new HttpEeClawAuthorizationAdapter({
      baseUrl: "http://eeclaw.internal", sharedSecret: "adapter-secret",
      resolveAccountId: () => Promise.resolve("42"), resolvePermissionKey: () => "page:functions",
      resolveProjectOperation: () => "read",
      fetchImpl: (_url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        expect(body.operation).toBe("read");
        if (mode === "json") return Promise.resolve(new Response("invalid-json"));
        if (mode === "null") return Promise.resolve(jsonResponse(null));
        return Promise.resolve(jsonResponse({ ok: true, data: {
          contract_name: "eeclaw.authorization-decision/1", contract_version: 1,
          subject_account_id: "42", permission_key: "page:functions",
          scope: mode === "project" ? { type: "project", id: "EP38" } : body.scope,
          operation: mode === "operation" ? "edit" : "read", decision: "ALLOW",
          authorization_version_digest: "a".repeat(64), reason_codes: ["project_role_allow"],
          policy_artifact_release_refs: [], expires_at: "2026-11-10T09:00:30.000Z"
        } }));
      }
    });
    expect(adapter.provider_registration_id).toBe("provider:eeclaw");
    expect(adapter.resource_authority).toBe("eeclaw");
    const input = { principal, action: "page:functions", resource_scope_refs: ["project:EP37"],
      observed_at: "2026-11-10T09:00:00.000Z" };
    await expect(adapter.evaluate(input)).resolves.toMatchObject({ decision: "ALLOW" });
    for (mode of ["project", "operation", "json", "null"]) {
      await expect(adapter.evaluate(input)).resolves.toMatchObject({ decision: "DENY", reason_codes: ["eeclaw_adapter_contract_invalid"] });
    }
    await expect(adapter.evaluate({ ...input, resource_scope_refs: ["project:EP37", "project:EP38"] }))
      .resolves.toMatchObject({ decision: "DENY", reason_codes: ["eeclaw_project_scope_invalid"] });
    expect(calls).toBe(5);
  });

  it("translates C41 decisions and keeps project scope fail closed", async () => {
    const adapter = new HttpEeClawAuthorizationAdapter({
      baseUrl: "http://eeclaw.internal",
      sharedSecret: "adapter-secret",
      resolveAccountId: () => Promise.resolve("42"),
      resolvePermissionKey: (action) =>
        action === "draft.generate" ? "page:architecture" : undefined,
      fetchImpl: (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          scope: Record<string, unknown>;
        };
        return Promise.resolve(jsonResponse({
          ok: true,
          data: {
            contract_name: "eeclaw.authorization-decision/1",
            contract_version: 1,
            subject_account_id: "42",
            actor_service_id: "process-copilot",
            permission_key: "page:architecture",
            scope: body.scope,
            decision: body.scope.type === "project" ? "DENY" : "ALLOW",
            reason_codes: body.scope.type === "project"
              ? ["project_scope_authority_unavailable"]
              : ["baseline_page_allow"],
            source: body.scope.type === "project" ? "deny" : "baseline",
            role_refs: ["eeclaw-role:default_user"],
            authorization_version_digest: "a".repeat(64),
            policy_model_revision: 1,
            policy_artifact_release_refs: [],
            decided_at: "2026-11-10T09:00:00.000Z",
            observed_at: "2026-11-10T09:00:00.000Z",
            expires_at: "2026-11-10T09:00:30.000Z"
          }
        }));
      }
    });

    await expect(adapter.evaluate({
      principal,
      action: "draft.generate",
      resource_scope_refs: [],
      observed_at: "2026-11-10T09:00:00.000Z"
    })).resolves.toMatchObject({
      decision: "ALLOW",
      reason_codes: ["baseline_page_allow"]
    });
    await expect(adapter.evaluate({
      principal,
      action: "draft.generate",
      resource_scope_refs: ["project:EP37"],
      observed_at: "2026-11-10T09:00:00.000Z"
    })).resolves.toMatchObject({
      decision: "DENY",
      reason_codes: ["project_scope_authority_unavailable"]
    });
  });

  it("denies missing links, mappings, transport and malformed contracts", async () => {
    const missingLink = new HttpEeClawAuthorizationAdapter({
      baseUrl: "http://eeclaw.internal",
      sharedSecret: "adapter-secret",
      resolveAccountId: () => Promise.resolve(undefined),
      resolvePermissionKey: () => "page:architecture"
    });
    await expect(missingLink.evaluate({
      principal,
      action: "draft.generate",
      resource_scope_refs: [],
      observed_at: "2026-11-10T09:00:00.000Z"
    })).resolves.toMatchObject({
      decision: "DENY",
      reason_codes: ["eeclaw_identity_link_missing"]
    });

    const malformed = new HttpEeClawAuthorizationAdapter({
      baseUrl: "http://eeclaw.internal",
      sharedSecret: "adapter-secret",
      resolveAccountId: () => Promise.resolve("42"),
      resolvePermissionKey: () => "page:architecture",
      fetchImpl: () => Promise.resolve(jsonResponse({ ok: true, data: {} }))
    });
    await expect(malformed.evaluate({
      principal,
      action: "draft.generate",
      resource_scope_refs: [],
      observed_at: "2026-11-10T09:00:00.000Z"
    })).resolves.toMatchObject({
      decision: "DENY",
      reason_codes: ["eeclaw_adapter_contract_invalid"]
    });
  });

  it("accepts only the pinned C42 zero-migration declaration", async () => {
    const adapter = new HttpEeClawAuthorizationAdapter({
      baseUrl: "http://eeclaw.internal",
      sharedSecret: "adapter-secret",
      resolveAccountId: () => Promise.resolve("42"),
      resolvePermissionKey: () => "page:architecture",
      fetchImpl: () => Promise.resolve(jsonResponse({
        ok: true,
        data: {
          contract_name: "eeclaw.legacy-auth-compatibility/1",
          contract_version: 1,
          source_commit: "cefa7432f966e17b41c1638e128de652b934fd20",
          schema_fingerprint: "b".repeat(64),
          api_fingerprint: "c".repeat(64),
          auth_me_fingerprint: "d".repeat(64),
          audit_fingerprint: "e".repeat(64),
          baseline_page_keys_version: "BASELINE_PAGE_KEYS_V1",
          baseline_page_keys_digest: "f".repeat(64),
          revocation_mode: "request_time",
          data_migration_required: false,
          declared_at: "2026-11-10T09:00:00.000Z"
        }
      }))
    });
    await expect(adapter.fetchCompatibility()).resolves.toMatchObject({
      source_commit: "cefa7432f966e17b41c1638e128de652b934fd20",
      data_migration_required: false
    });
  });
});
