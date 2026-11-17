import type {
  IdentityAuthorizationService,
  IdentityProviderPort
} from "@pc/application";
import type { PilotSession } from "@pc/domain";
import { IdentityAuthorizationError } from "@pc/domain";

/** Controlled local/development identity. This is not a production IAM. */
export class LocalIdentityProvider implements IdentityProviderPort {
  readonly provider_registration_id = "provider:pc-local";
  readonly identity_provider_ref = "pc-local";

  constructor(
    private readonly identity: IdentityAuthorizationService,
    private readonly tenantId: string
  ) {
    if (!tenantId.trim()) {
      throw new Error("Local Identity Provider requires a tenant");
    }
  }

  async authenticate(input: Parameters<IdentityProviderPort["authenticate"]>[0]) {
    if (input.kind !== "local_credentials") {
      throw new IdentityAuthorizationError(
        "PC_AUTHENTICATION_REQUIRED",
        "Local credentials are required"
      );
    }
    const tenant = typeof input.tenant_id === "string" && input.tenant_id.trim()
      ? input.tenant_id.trim()
      : this.tenantId;
    if (tenant !== this.tenantId
      || typeof input.account_key !== "string"
      || typeof input.secret !== "string") {
      throw new IdentityAuthorizationError(
        "PC_PILOT_AUTHENTICATION_FAILED",
        "Local account authentication failed"
      );
    }
    return this.identity.signInPilot(tenant, input.account_key, input.secret);
  }

  validate(
    session: PilotSession
  ): Promise<undefined> {
    if (session.authentication_context_id.startsWith("ee:")) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(undefined);
  }

  bindings() {
    return Promise.resolve({ items: [] });
  }
}
