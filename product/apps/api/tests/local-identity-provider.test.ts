import { describe, expect, it } from "vitest";
import { IdentityAuthorizationService } from "@pc/application";
import { MemoryIdentityAuthorizationRepository } from "@pc/persistence";
import { LocalIdentityProvider } from "../src/local-identity-provider.js";

describe("D2 local identity provider", () => {
  it("authenticates only controlled local credentials", async () => {
    const identity = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      "local-provider-test-signing-key-0000000000"
    );
    await identity.initialize();
    await identity.provisionPilotAccount({
      tenant_id: "tenant-local",
      account_key: "local.engineer",
      secret: "LocalIdentitySecret123"
    });
    const provider = new LocalIdentityProvider(identity, "tenant-local");

    const result = await provider.authenticate({
      kind: "local_credentials",
      tenant_id: undefined,
      account_key: "local.engineer",
      secret: "LocalIdentitySecret123"
    });
    expect(result.principal.tenant_id).toBe("tenant-local");
    expect(result.authentication_context_id).not.toMatch(/^ee:/u);
    await expect(provider.authenticate({
      kind: "ticket_exchange",
      ticket: "ticket",
      code_verifier: "verifier"
    })).rejects.toMatchObject({ code: "PC_AUTHENTICATION_REQUIRED" });
  });
});
