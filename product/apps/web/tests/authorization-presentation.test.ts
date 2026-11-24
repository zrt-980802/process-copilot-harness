import { describe, expect, it } from "vitest";
import { authorizationSources, safeAuthorizationReason, setAuthorizationPresentationGeneration, authorizationPresentationGeneration,
  invalidatesExternalExperience } from "../src/authorization-presentation";

describe("Provider-neutral authorization presentation", () => {
  it.each(["current_binding_unavailable", "compatibility_mapping_unavailable", "source_policy_denied", "pc_policy_denied", "session_authority_changed",
    "PC_PROVIDER_UNAVAILABLE", "PC_GATEWAY_RESULT_DELIVERY_DENIED", "EE provider bundle is not executable"])('normalizes %s without rendering internal errors', code => {
      const message = safeAuthorizationReason([code]);
      expect(message).not.toMatch(/EE|Bundle|bundle|Connector|connector|secret|Token|PC_GATEWAY|PC_PROVIDER/u);
      expect(message.length).toBeGreaterThan(4);
    });
  it("names distinct authorization sources and fences observation generations", () => {
    expect(authorizationSources("PC_ONLY")).toBe("PC");
    expect(authorizationSources("PC_AND_PROVIDER")).toBe("PC · 本地绑定 · 数据源");
    expect(authorizationSources("DENY_UNKNOWN")).toBe("未确认");
    setAuthorizationPresentationGeneration(17); expect(authorizationPresentationGeneration()).toBe(17);
  });
  it.each(["PC_PROVIDER_UNAVAILABLE", "PC_EE_LOGIN_UNAVAILABLE", "PC_SESSION_ASSURANCE_DENIED",
    "PC_AUTHORIZATION_REVISION_STALE", "PC_AUTHORITY_BINDING_DENIED", "PC_WORKBENCH_PROJECT_DENIED",
    "PC_WORKBENCH_AUTHORIZATION_DENIED"])('invalidates external experience for %s', code => {
      expect(invalidatesExternalExperience({ status: 403, code })).toBe(true);
    });
  it.each(["PC_GATEWAY_RESULT_DELIVERY_DENIED", "PC_GATEWAY_OPERATION_SCOPE_DENIED", "PC_POLICY_DENIED",
    "PC_WORKBENCH_OPERATION_SCOPE_DENIED", "PC_EXPERIENCE_SCOPE_UNAVAILABLE"])('keeps current experience for request-local %s', code => {
      expect(invalidatesExternalExperience({ status: 403, code })).toBe(false);
    });
});
