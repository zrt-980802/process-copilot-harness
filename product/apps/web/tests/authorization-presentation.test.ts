import { describe, expect, it } from "vitest";
import { authorizationSources, safeAuthorizationReason, setAuthorizationPresentationGeneration, authorizationPresentationGeneration } from "../src/authorization-presentation";

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
});
