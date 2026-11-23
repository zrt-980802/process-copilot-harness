import { describe, expect, it } from "vitest";
import type { PCPrincipal } from "@pc/domain";
import {
  AuthorityRouter,
  ProviderHealthRegistry,
  type AuthorityRouteDefinition,
  type EnterpriseAuthorizationPort
} from "../src/index.js";

const principal = {
  principal_id: "principal-1",
  tenant_id: "tenant-1",
  lifecycle_status: "active",
  identity_revision: 1,
  authorization_revision: 1
} as PCPrincipal;

function request(action: string, scopes: string[] = ["project:EP37"]) {
  return {
    principal,
    action,
    resource_scope_refs: scopes,
    tool_release_ids: [],
    observed_at: "2026-11-17T00:00:00.000Z"
  };
}

function provider(
  id: string,
  evaluate: EnterpriseAuthorizationPort["evaluate"]
): EnterpriseAuthorizationPort {
  return {
    provider_registration_id: id,
    resource_authority: id.replace(/^provider:/u, ""),
    evaluate
  };
}

describe("D3 Authority Router", () => {
  it("keeps PC-only actions off every Provider port", async () => {
    let calls = 0;
    const router = new AuthorityRouter();
    router.registerProvider(provider("provider:eeclaw", async () => {
      calls += 1;
      return { decision: "DENY", reason_codes: ["unexpected"], evidence_refs: [] };
    }));

    expect(router.authorizationMode(request("conversation.run", [`user:${principal.principal_id}`]))).toBe("PC_ONLY");
    await expect(router.evaluate(request(
      "conversation.run",
      [`user:${principal.principal_id}`]
    ))).resolves.toMatchObject({
      decision: "ALLOW",
      route_id: "authority-route:conversation-personal"
    });
    expect(calls).toBe(0);
  });

  it("calls only the selected Provider and intersects its decision", async () => {
    let eeCalls = 0;
    let otherCalls = 0;
    const router = new AuthorityRouter();
    router.registerProvider(provider("provider:eeclaw", async () => {
      eeCalls += 1;
      return { decision: "ALLOW", reason_codes: ["ee_allow"], evidence_refs: ["ee:C41:1"] };
    }));
    router.registerProvider(provider("provider:other", async () => {
      otherCalls += 1;
      return { decision: "ALLOW", reason_codes: ["other_allow"], evidence_refs: [] };
    }));

    await expect(router.evaluate(request("draft.generate"))).resolves.toMatchObject({
      decision: "ALLOW",
      provider_registration_id: "provider:eeclaw",
      reason_codes: expect.arrayContaining(["ee_allow"])
    });
    expect(eeCalls).toBe(1);
    expect(otherCalls).toBe(0);
  });

  it("fails closed for missing, unknown and ambiguous routes", async () => {
    const missing = new AuthorityRouter();
    expect(missing.authorizationMode(request("draft.generate"))).toBe("PC_AND_PROVIDER");
    expect(missing.authorizationMode(request("unknown.execute"))).toBe("DENY_UNKNOWN");
    await expect(missing.evaluate(request("draft.generate"))).resolves.toMatchObject({
      decision: "DENY",
      reason_codes: ["authority_provider_missing:provider:eeclaw"]
    });
    await expect(missing.evaluate(request("unknown.execute"))).resolves.toMatchObject({
      decision: "DENY",
      reason_codes: ["authority_route_missing:unknown.execute"]
    });

    const routes: AuthorityRouteDefinition[] = [
      { route_id: "authority-route:a", action_pattern: "resource.*", resource_scope_pattern: "*",
        resource_authority: "pc", authorization_mode: "PC_ONLY" },
      { route_id: "authority-route:b", action_pattern: "resource.read", resource_scope_pattern: "*",
        resource_authority: "pc", authorization_mode: "PC_ONLY" }
    ];
    const ambiguous = new AuthorityRouter(routes);
    expect(ambiguous.authorizationMode(request("resource.read", ["resource:1"]))).toBe("DENY_UNKNOWN");
    await expect(ambiguous.evaluate(request("resource.read", ["resource:1"]))).resolves.toMatchObject({
      decision: "DENY",
      reason_codes: ["authority_route_ambiguous:resource.read"]
    });
  });

  it("does not mark a business Deny as Provider failure", async () => {
    const router = new AuthorityRouter();
    router.registerProvider(provider("provider:eeclaw", async () => ({
      decision: "DENY",
      reason_codes: ["ee_business_deny"],
      evidence_refs: ["ee:C41:deny"]
    })));

    await expect(router.evaluate(request("draft.read"))).resolves.toMatchObject({
      decision: "DENY",
      reason_codes: expect.arrayContaining(["ee_business_deny"])
    });
    expect(router.health.observation("provider:eeclaw").provider_state).toBe("HEALTHY");
  });

  it("turns transport failure into a distinct unavailable denial", async () => {
    const router = new AuthorityRouter();
    router.registerProvider(provider("provider:eeclaw", async () => {
      throw new TypeError("fetch failed");
    }));

    await expect(router.evaluate(request("draft.generate"))).resolves.toMatchObject({
      decision: "DENY",
      reason_codes: expect.arrayContaining([
        "authority_provider_unavailable:provider:eeclaw",
        "provider_authorization_unavailable"
      ])
    });
    expect(router.health.observation("provider:eeclaw").provider_state).toBe("UNAVAILABLE");
  });
});

describe("D3 Provider Health", () => {
  it("backs off failures, bounds recovery probes and requires stable recovery", () => {
    let now = new Date("2026-11-17T00:00:00.000Z");
    const health = new ProviderHealthRegistry(() => now, 30_000, 1_000, 4_000);
    health.register("provider:eeclaw", ["enterprise_authorization"]);
    const initial = health.beginAttempt("provider:eeclaw", "enterprise_authorization");
    expect(initial.allowed).toBe(true);
    initial.failure("TIMEOUT", "provider_timeout");
    expect(health.observation("provider:eeclaw").provider_state).toBe("UNAVAILABLE");
    expect(health.beginAttempt("provider:eeclaw", "enterprise_authorization").allowed).toBe(false);

    now = new Date(now.getTime() + 1_000);
    const probe = health.beginAttempt("provider:eeclaw", "enterprise_authorization");
    expect(probe).toMatchObject({ allowed: true, probe: true });
    expect(health.beginAttempt("provider:eeclaw", "enterprise_authorization").allowed).toBe(false);
    probe.success("provider_probe_succeeded");
    expect(health.observation("provider:eeclaw").provider_state).toBe("DEGRADED");

    const confirmation = health.beginAttempt("provider:eeclaw", "enterprise_authorization");
    confirmation.success("provider_recovery_confirmed");
    expect(health.observation("provider:eeclaw").provider_state).toBe("HEALTHY");
  });

  it("treats an expired observation as unavailable without granting authority", () => {
    let now = new Date("2026-11-17T00:00:00.000Z");
    const health = new ProviderHealthRegistry(() => now, 1_000);
    health.register("provider:eeclaw", ["enterprise_authorization"]);
    health.markCompatible("provider:eeclaw");
    expect(health.isUsable("provider:eeclaw")).toBe(true);

    now = new Date(now.getTime() + 1_000);
    expect(health.isUsable("provider:eeclaw")).toBe(false);
    expect(health.observation("provider:eeclaw")).toMatchObject({
      provider_state: "UNAVAILABLE",
      reason_codes: ["provider_health_observation_expired"]
    });
  });
});
