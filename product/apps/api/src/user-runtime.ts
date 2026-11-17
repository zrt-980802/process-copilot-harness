import { createHash } from "node:crypto";
import type { PCPrincipal } from "@pc/domain";
import { IdentityAuthorizationError } from "@pc/domain";

export class UserRuntimeResolver {
  constructor(private readonly managerUrl: string, private readonly secret: string) {
    if (managerUrl !== "http://user-runtime-manager:3200" || secret.length < 24) throw new Error("Explicit local Runtime manager configuration required");
  }

  async resolve(principal: PCPrincipal): Promise<string> {
    const owner = { tenant_id: principal.tenant_id, principal_id: principal.principal_id };
    const suffix = createHash("sha256").update(`${owner.tenant_id}:${owner.principal_id}`).digest("hex").slice(0, 24);
    const runtimeId = `pc-workbench-user-${suffix}`;
    let response: Response;
    try {
      response = await fetch(`${this.managerUrl}/v1/user-runtimes/ensure`, { method: "POST", redirect: "error",
        headers: { "content-type": "application/json", "x-pc-runtime-secret": this.secret },
        body: JSON.stringify(owner), signal: AbortSignal.timeout(60_000) });
    } catch { throw new IdentityAuthorizationError("PC_USER_RUNTIME_UNAVAILABLE", "个人执行环境暂时无法启动，请重试", true); }
    if (!response.ok) throw new IdentityAuthorizationError("PC_USER_RUNTIME_UNAVAILABLE", "个人执行环境暂时无法启动，请重试", true);
    const value = await response.json() as Record<string, unknown>;
    if (value.principal_id !== owner.principal_id || value.tenant_id !== owner.tenant_id
      || value.runtime_id !== runtimeId || value.endpoint_url !== `http://${runtimeId}:3100`) {
      throw new IdentityAuthorizationError("PC_USER_RUNTIME_OWNER_DENIED", "执行环境身份校验失败");
    }
    return String(value.endpoint_url);
  }
}
