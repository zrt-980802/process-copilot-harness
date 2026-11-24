export interface AuthorizationObservation {
  decision_id: string;
  decision_mode: "PC_ONLY" | "PC_AND_PROVIDER" | "DENY_UNKNOWN";
  decision: "ALLOW" | "DENY";
  reason_codes: string[];
  principal_id: string;
  pc_session_id: string;
  resource_ref: string;
  generation: number;
}

let generation = 0;
export function setAuthorizationPresentationGeneration(value: number) { generation = value; }
export function authorizationPresentationGeneration() { return generation; }

export function safeAuthorizationReason(codes: readonly string[]): string {
  const joined = codes.join(" ").toUpperCase();
  if (/SESSION|AUTHENTICATION_REQUIRED/u.test(joined)) return "登录状态已更新，请重新登录。";
  if (/MAPPING|ROUTE_UNKNOWN|DENY_UNKNOWN/u.test(joined)) return "此项能力暂不可用。";
  if (/BINDING|RESULT_DELIVERY|CREDENTIAL_GENERATION/u.test(joined)) return "数据源连接授权已失效，请重新确认当前权限。";
  if (/SOURCE_POLICY_DENIED/u.test(joined)) return "数据源未允许此项操作。";
  if (/PC_POLICY|PC_POLICY_DENIED/u.test(joined)) return "当前账号没有此项能力。";
  if (/PROVIDER|SOURCE_AUTHORITY|EE_/u.test(joined)) return "数据源暂不可用，请稍后重新检查。";
  return "当前范围无法执行此项操作。";
}

export function authorizationSources(mode: string): string {
  return mode === "PC_AND_PROVIDER" ? "PC · 本地绑定 · 数据源" : mode === "PC_ONLY" ? "PC" : "未确认";
}

const experienceInvalidationCodes = [
  /^PC_PROVIDER_/u,
  /^PC_EE_/u,
  /^PC_SESSION_ASSURANCE_/u,
  /^PC_AUTHORIZATION_(?:REVISION_STALE|SNAPSHOT_EXPIRED|SNAPSHOT_STALE)$/u,
  /^PC_AUTHORITY_(?:BINDING_DENIED|MAPPING_DENIED|DECISION_UNAVAILABLE)$/u,
  /^PC_WORKBENCH_(?:PROJECT_PROVIDER_UNAVAILABLE|PROVIDER_UNAVAILABLE|PROJECT_DENIED|PROFILE_REVOKED|TOOL_REVOKED|AUTHORIZATION_DENIED|SESSION_REAUTH_REQUIRED|AUTHORITY_ROUTE_DENIED)$/u
];

export function invalidatesExternalExperience(error: { status: number; code: string }): boolean {
  return experienceInvalidationCodes.some(pattern => pattern.test(error.code));
}

export function publishAuthorizationObservation(header: string | null, requestGeneration: number, errorCode?: string): void {
  if (!header || typeof window === "undefined") return;
  try {
    const value = JSON.parse(decodeURIComponent(header));
    if (!["PC_ONLY", "PC_AND_PROVIDER", "DENY_UNKNOWN"].includes(value.decision_mode)
      || !["ALLOW", "DENY"].includes(value.decision) || typeof value.principal_id !== "string"
      || typeof value.pc_session_id !== "string" || typeof value.resource_ref !== "string" || typeof value.decision_id !== "string"
      || !Array.isArray(value.reason_codes) || value.reason_codes.some((code: unknown) => typeof code !== "string")) return;
    window.dispatchEvent(new CustomEvent<AuthorizationObservation>("pc-authorization-observed", { detail: {
      ...value, generation: requestGeneration, ...(errorCode ? { decision: "DENY", reason_codes: [errorCode] } : {}) } }));
  } catch { /* Incomplete diagnostic headers never establish UI authority. */ }
}
