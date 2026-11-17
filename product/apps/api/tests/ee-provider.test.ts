import { describe, expect, it, vi } from "vitest";
import type { IdentityAuthorizationService } from "@pc/application";
import type { PCPrincipal, ToolRelease } from "@pc/domain";
import {
  EeClawProjectDirectoryAdapter,
  EeClawWorkbenchProjectionAdapter
} from "../src/ee-provider.js";

const principal = {
  principal_id: "principal-1",
  tenant_id: "tenant-1"
} as PCPrincipal;

describe("D1 EE provider port golden behavior", () => {
  it("preserves the accessible-projects request and response contract", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/projects/accessible");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({
        ok: true,
        data: {
          contract_name: "eeclaw.accessible-projects/1",
          items: [{ project_code: "EP37", project_name: "EP37 Demo" }],
          authorization_version_digest: "a".repeat(64)
        }
      }));
    });
    const identity = {
      resolveExternalSubject: vi.fn(async () => "42")
    } as unknown as IdentityAuthorizationService;
    const adapter = new EeClawProjectDirectoryAdapter({
      identity,
      baseUrl: "http://eeclaw.internal/",
      sharedSecret: "service-secret",
      fetchImpl
    });

    await expect(adapter.listProjects({ principal })).resolves.toEqual([
      { project_code: "EP37", project_name: "EP37 Demo" }
    ]);
    expect(adapter.provider_registration_id).toBe("provider:eeclaw");
    expect(adapter.resource_authority).toBe("eeclaw");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://eeclaw.internal/api/internal/process-copilot/v1/projects/accessible"
    );
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-pc-adapter-secret": "service-secret"
      }
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      account_id: "42",
      permission_key: "page:projects",
      operation: "read"
    });
  });

  it("preserves EE workbench scope, tools and trace projection", () => {
    const adapter = new EeClawWorkbenchProjectionAdapter();
    const tool = {
      tool_release_id: "tool:ee_mcp:read",
      tool_definition_id: "ee.get_project_context",
      provider_kind: "ee_mcp",
      compatibility: { display_name: "Project Context" },
      risk_manifest: { action_class: "READ" },
      status: "PUBLISHED"
    } as ToolRelease;
    expect(adapter.project({
      project_code: "EP37",
      project_record: { project_code: "EP37", project_name: "EP37 Demo" },
      authorization_revision: 3,
      tools: [tool],
      operations: [{
        operation_id: "operation-1",
        operation_kind: "READ",
        state: "SUCCEEDED",
        updated_at: "2026-11-17T00:00:00.000Z",
        tool_release_id: tool.tool_release_id,
        tool_name: tool.tool_definition_id,
        outcome_state: "KNOWN_SUCCESS",
        evidence_refs: ["audit:1", "eea://traces/trace-1", "eea://traces/trace-1"]
      }]
    })).toEqual({
      scope: {
        project_code: "EP37",
        project_name: "EP37 Demo",
        authorization_revision: 3,
        source: "EE accessible project membership and per-tool authorization"
      },
      tool_set: [{
        tool_release_id: "tool:ee_mcp:read",
        tool_definition_id: "ee.get_project_context",
        display_name: "Project Context",
        action_class: "READ",
        provider_kind: "ee_mcp",
        status: "PUBLISHED"
      }],
      recent_operations: [{
        operation_id: "operation-1",
        operation_kind: "READ",
        state: "SUCCEEDED",
        updated_at: "2026-11-17T00:00:00.000Z",
        tool_release_id: "tool:ee_mcp:read",
        tool_name: "ee.get_project_context",
        outcome_state: "KNOWN_SUCCESS",
        trace_refs: ["eea://traces/trace-1"]
      }]
    });
  });
});
