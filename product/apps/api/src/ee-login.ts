import type {
  IdentityAuthorizationService,
  IdentityProviderAccount,
  IdentityProviderPort
} from "@pc/application";
import type { PCPrincipal, PilotSession } from "@pc/domain";
import { IdentityAuthorizationError } from "@pc/domain";

interface EeSessionIdentity {
  account: IdentityProviderAccount;
  session_id: string; session_expires_at: number;
}

export class EeLogin implements IdentityProviderPort {
  readonly provider_registration_id = "provider:eeclaw";
  readonly identity_provider_ref = "eeclaw";
  constructor(private readonly identity: IdentityAuthorizationService,
    readonly issuer: string, private readonly serviceSecret: string, readonly tenant: string) {}

  private async call(path: string, input: Record<string, unknown>): Promise<EeSessionIdentity> {
    let response: Response;
    try {
      response = await fetch(`${this.issuer}/api/internal/process-copilot/v1/login/${path}`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
        headers: { "content-type": "application/json", "x-pc-adapter-secret": this.serviceSecret }, body: JSON.stringify(input)
      });
    } catch { throw new IdentityAuthorizationError("PC_EE_LOGIN_UNAVAILABLE", "EE 登录服务暂时不可用", true); }
    if (response.status === 401 || response.status === 403) {
      throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "EE 登录已失效，请重新登录");
    }
    if (!response.ok) throw new IdentityAuthorizationError("PC_EE_LOGIN_UNAVAILABLE", "EE 登录服务暂时不可用", true);
    const payload = await response.json() as { ok?: boolean; data?: EeSessionIdentity };
    const value = payload.data;
    if (!payload.ok || !value || !Number.isSafeInteger(value.account?.id) || value.account.id < 1
      || value.account.status !== "active" || typeof value.account.username !== "string"
      || !/^[0-9a-f-]{36}$/u.test(value.session_id) || !Number.isFinite(value.session_expires_at)
      || value.session_expires_at * 1000 <= Date.now()) {
      throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "EE 登录证明无效");
    }
    return value;
  }

  async exchange(ticket: unknown, codeVerifier: unknown) {
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(ticket)
      || typeof codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/u.test(codeVerifier)) {
      throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "有效的一次性登录票据和验证串是必需的");
    }
    const proof = await this.call("exchange", { ticket, code_verifier: codeVerifier });
    const session = await this.identity.signInExternal({ identity_provider_ref: "eeclaw", issuer: this.issuer,
      external_subject: String(proof.account.id), tenant_or_org_ref: this.tenant },
    proof.session_id, new Date(proof.session_expires_at * 1000).toISOString());
    return { ...session, account: proof.account };
  }

  authenticate(input: Parameters<IdentityProviderPort["authenticate"]>[0]) {
    if (input.kind !== "ticket_exchange") {
      throw new IdentityAuthorizationError(
        "PC_AUTHENTICATION_REQUIRED",
        "EE ticket exchange is required"
      );
    }
    return this.exchange(input.ticket, input.code_verifier);
  }

  async validate(session: PilotSession, principal: PCPrincipal) {
    const match = /^ee:([0-9a-f-]{36}):[0-9a-f-]{36}$/u.exec(session.authentication_context_id);
    const subject = await this.identity.resolveExternalSubject(principal.principal_id, "eeclaw", { issuer: this.issuer, tenant: this.tenant });
    if (!match || !subject || principal.tenant_id !== this.tenant) {
      throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "请使用 EE 统一账号登录");
    }
    const data = await this.call("validate", { session_id: match[1], account_id: subject });
    if (data.session_id !== match[1] || String(data.account.id) !== subject) {
      throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "EE 登录身份不匹配");
    }
    return data.account;
  }

  async bindings() {
    const bindings = await this.identity.listExternalBindings("eeclaw", this.issuer, this.tenant);
    return { items: bindings.map(({ principal, identity_link: link, legacy_account_keys }) => ({
      ee_account_id: link.external_subject, principal_id: principal.principal_id, tenant_id: principal.tenant_id,
      status: link.status === "verified" && principal.lifecycle_status === "active" ? "active" : "inactive",
      legacy_account_keys, login_provider: "eeclaw" })) };
  }
}
