import { describe, expect, it, vi } from "vitest";
import { AuthorityRouter, IdentityAuthorizationService, type AuthorityRouteDefinition } from "@pc/application";
import { MemoryIdentityAuthorizationRepository } from "@pc/persistence";
import { RuntimeWorkbench, type WorkbenchOptions } from "../src/workbench.js";

describe("RCI-03 W0 exact post-turn authority classification", () => {
  it.each(["personal", "project", "unknown", "ambiguous", "pc action on project scope"])("routes %s without a scope-prefix shortcut", async scenario => {
    const routes: AuthorityRouteDefinition[] | undefined = scenario === "ambiguous" ? [0, 1].map(i => ({
      route_id: `duplicate:${i}`, action_pattern: "conversation.run", resource_scope_pattern: "*",
      resource_authority: "pc", authorization_mode: "PC_ONLY" })) : undefined;
    const identity = new IdentityAuthorizationService(new MemoryIdentityAuthorizationRepository(),
      "route-classification-test-signing-key-000000", [], undefined, new AuthorityRouter(routes));
    await identity.provisionPilotAccount({ tenant_id: "route-test", account_key: "owner", secret: "SyntheticRouteTest123" });
    const login = await identity.signInPilot("route-test", "owner", "SyntheticRouteTest123");
    const provider = vi.spyOn(identity, "authenticateForProvider");
    const evaluate = vi.spyOn(identity, "evaluatePrincipalAuthorization").mockResolvedValue({ decision: "ALLOW" } as never);
    const action = scenario === "project" ? "ee.read" : scenario === "unknown" ? "unknown.action"
      : scenario === "pc action on project scope" ? "task.read" : "conversation.run";
    const context = { tools: [], principal_envelope: { subject_principal_id: login.principal.principal_id,
      tenant_id: login.principal.tenant_id, authorization_revision: login.principal.authorization_revision,
      allowed_actions: [action], resource_scope_refs: [scenario === "project" || scenario === "pc action on project scope"
        ? "project:one" : `user:${login.principal.principal_id}`] } };
    const workbench = new RuntimeWorkbench({ identity } as WorkbenchOptions);
    const reauthorize = (workbench as unknown as { reauthorize(token: string, context: unknown): Promise<void> }).reauthorize.bind(workbench);
    if (["unknown", "ambiguous"].includes(scenario)) {
      await expect(reauthorize(login.access_token, context)).rejects.toMatchObject({ code: "PC_WORKBENCH_AUTHORITY_ROUTE_DENIED" });
      expect(evaluate).not.toHaveBeenCalled();
    } else await reauthorize(login.access_token, context);
    expect(provider).toHaveBeenCalledTimes(scenario === "project" ? 1 : 0);
  });
});
