import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityAuthorizationService } from "@pc/application";
import type { PCPrincipal, PilotSession } from "@pc/domain";
import { EeLogin } from "../src/ee-login.js";

afterEach(() => vi.unstubAllGlobals());

const principal: PCPrincipal = {
  principal_id: "principal-1",
  principal_type: "human",
  tenant_id: "tenant-1",
  lifecycle_status: "active",
  primary_identity_ref: "identity-1",
  identity_revision: 1,
  authorization_revision: 2,
  created_at: "2026-11-17T00:00:00.000Z",
  updated_at: "2026-11-17T00:00:00.000Z"
};

describe("D1 EE identity provider golden behavior", () => {
  it("preserves exchange, validation and binding projections", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const expiresAt = Math.floor((Date.now() + 60_000) / 1000);
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(url), body });
      return new Response(JSON.stringify({
        ok: true,
        data: {
          account: {
            id: 42,
            username: "demo.engineer",
            display_name: "Demo Engineer",
            status: "active"
          },
          session_id: sessionId,
          session_expires_at: expiresAt
        }
      }));
    }));
    const signInExternal = vi.fn(async () => ({
      access_token: "pc-access-token",
      token_type: "Bearer" as const,
      expires_at: new Date(expiresAt * 1000).toISOString(),
      authentication_context_id: `ee:${sessionId}:context`,
      principal
    }));
    const identity = {
      signInExternal,
      resolveExternalSubject: vi.fn(async () => "42"),
      listExternalBindings: vi.fn(async () => [{
        principal,
        identity_link: { external_subject: "42", status: "verified" },
        legacy_account_keys: ["demo.engineer"]
      }])
    } as unknown as IdentityAuthorizationService;
    const provider = new EeLogin(
      identity,
      "http://eeclaw.internal",
      "service-secret",
      "tenant-1"
    );

    const exchange = await provider.authenticate({
      kind: "ticket_exchange",
      ticket: "a".repeat(43),
      code_verifier: "b".repeat(43)
    });
    expect(provider.provider_registration_id).toBe("provider:eeclaw");
    expect(provider.identity_provider_ref).toBe("eeclaw");
    expect(exchange).toMatchObject({
      access_token: "pc-access-token",
      account: { id: 42, username: "demo.engineer" }
    });
    expect(signInExternal).toHaveBeenCalledWith({
      identity_provider_ref: "eeclaw",
      issuer: "http://eeclaw.internal",
      external_subject: "42",
      tenant_or_org_ref: "tenant-1"
    }, sessionId, new Date(expiresAt * 1000).toISOString());

    const session: PilotSession = {
      authentication_context_id: `ee:${sessionId}:22222222-2222-4222-8222-222222222222`,
      principal_id: principal.principal_id,
      token_digest: "digest",
      issued_at: "2026-11-17T00:00:00.000Z",
      expires_at: new Date(expiresAt * 1000).toISOString()
    };
    await expect(provider.validate(session, principal)).resolves.toMatchObject({
      id: 42,
      status: "active"
    });
    await expect(provider.bindings()).resolves.toEqual({
      items: [{
        ee_account_id: "42",
        principal_id: "principal-1",
        tenant_id: "tenant-1",
        status: "active",
        legacy_account_keys: ["demo.engineer"],
        login_provider: "eeclaw"
      }]
    });
    expect(calls).toEqual([
      {
        url: "http://eeclaw.internal/api/internal/process-copilot/v1/login/exchange",
        body: { ticket: "a".repeat(43), code_verifier: "b".repeat(43) }
      },
      {
        url: "http://eeclaw.internal/api/internal/process-copilot/v1/login/validate",
        body: { session_id: sessionId, account_id: "42" }
      }
    ]);
  });
});
