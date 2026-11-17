import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PCPrincipal } from "@pc/domain";
import { UserRuntimeResolver } from "../src/user-runtime.js";

const secret = "test-runtime-secret-000000000000";
const principal = { tenant_id: "tenant", principal_id: "00000000-0000-0000-0000-000000000001" } as PCPrincipal;
const runtimeId = `pc-workbench-user-${createHash("sha256").update(`tenant:${principal.principal_id}`).digest("hex").slice(0, 24)}`;
afterEach(() => vi.unstubAllGlobals());
describe("Local user Runtime resolver", () => {
  it("sends only the authenticated owner and validates the exact assigned endpoint", async () => {
    const fetcher = vi.fn(async () => Response.json({ ...principal, runtime_id: runtimeId, endpoint_url: `http://${runtimeId}:3100` }));
    vi.stubGlobal("fetch", fetcher);
    expect(await new UserRuntimeResolver("http://user-runtime-manager:3200", secret).resolve(principal)).toBe(`http://${runtimeId}:3100`);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body)).toEqual(principal);
    expect(fetcher.mock.calls[0]![1]!.headers["x-pc-runtime-secret"]).toBe(secret);
  });
  it.each([
    { principal_id: "someone-else" }, { tenant_id: "another-tenant" },
    { runtime_id: "someone-else-runtime" }, { endpoint_url: "http://untrusted:3100" }
  ])("rejects a mismatched owner or endpoint: %j", async changed => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...principal, runtime_id: runtimeId, endpoint_url: `http://${runtimeId}:3100`, ...changed })));
    await expect(new UserRuntimeResolver("http://user-runtime-manager:3200", secret).resolve(principal)).rejects.toMatchObject({ code: "PC_USER_RUNTIME_OWNER_DENIED" });
  });
  it("fails closed when provisioning is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(new UserRuntimeResolver("http://user-runtime-manager:3200", secret).resolve(principal)).rejects.toMatchObject({ code: "PC_USER_RUNTIME_UNAVAILABLE", retryable: true });
    expect(() => new UserRuntimeResolver("http://caller-supplied-host", secret)).toThrow();
  });
});
