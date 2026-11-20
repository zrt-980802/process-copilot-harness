import { describe, expect, it, vi } from "vitest";
import type { IdentityAuthorizationService } from "@pc/application";
import type { SstsDraftService } from "@pc/ssts-draft";
import { buildApiServer } from "../src/server.js";
import type { RuntimeWorkbench } from "../src/workbench.js";

describe("personal task discovery", () => {
  it("authenticates ownership locally without touching the provider; default mixed listing retains current directory checks", async () => {
    const authenticate = vi.fn(async () => ({ principal: { tenant_id: "T", principal_id: "U" } }));
    const listWorkspaces = vi.fn(async () => [{ workspace_id: "personal" }, { workspace_id: "project", project_code: "P" },
      { workspace_id: "revoked", project_code: "OTHER" }]);
    const hasProjectProvider = vi.fn(() => true);
    const projects = vi.fn(async () => [{ project_code: "P" }]);
    const server = buildApiServer({ identityAuthorization: { authenticate } as unknown as IdentityAuthorizationService,
      sstsDraft: { listWorkspaces } as unknown as SstsDraftService,
      workbench: { hasProjectProvider, projects } as unknown as RuntimeWorkbench });
    try {
      const response = await server.inject({ url: "/v1/ssts-tasks?scope=personal", headers: { authorization: "Bearer local" } });
      expect(response.statusCode).toBe(200);
      expect(response.json().tasks).toEqual([{ workspace_id: "personal" }]);
      expect(authenticate).toHaveBeenCalledWith("local");
      expect(listWorkspaces).toHaveBeenCalledWith("T", "U");
      expect(hasProjectProvider).not.toHaveBeenCalled();
      expect(projects).not.toHaveBeenCalled();
      const mixed = await server.inject({ url: "/v1/ssts-tasks", headers: { authorization: "Bearer local" } });
      expect(mixed.json().tasks.map((row: { workspace_id: string }) => row.workspace_id)).toEqual(["personal", "project"]);
      expect(projects).toHaveBeenCalledWith("local");
    } finally { await server.close(); }
  });
});
