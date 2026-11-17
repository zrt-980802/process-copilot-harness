import { describe, expect, it } from "vitest";
import { classifyProviderConfiguration } from "../src/provider-bootstrap.js";

describe("D2 provider bootstrap", () => {
  it("classifies a fully absent EE configuration as Standalone", () => {
    expect(classifyProviderConfiguration({})).toEqual({
      mode: "standalone",
      ee: { configured: false }
    });
    expect(classifyProviderConfiguration({ PC_LOGIN_MODE: "local" }).mode)
      .toBe("standalone");
  });

  it("accepts only the complete EE-connected configuration", () => {
    const configuration = classifyProviderConfiguration({
      PC_LOGIN_MODE: "ee",
      PC_GATEWAY_STORE: "postgres",
      EECLAW_ADAPTER_URL: "http://ee-api:5000",
      EECLAW_ADAPTER_SECRET: "authorization-secret",
      EE_MCP_ADAPTER_URL: "http://ee-mcp:5011/mcp",
      EE_MCP_ADAPTER_SECRET: "mcp-secret"
    });
    expect(configuration).toMatchObject({
      mode: "ee-connected",
      ee: {
        configured: true,
        authorization_url: "http://ee-api:5000",
        mcp_url: "http://ee-mcp:5011/mcp"
      }
    });
  });

  it("fails closed for every partial EE configuration", () => {
    expect(() => classifyProviderConfiguration({
      EECLAW_ADAPTER_URL: "http://ee-api:5000"
    })).toThrow("Incomplete EE provider configuration");
    expect(() => classifyProviderConfiguration({
      PC_LOGIN_MODE: "ee",
      PC_GATEWAY_STORE: "postgres",
      EECLAW_ADAPTER_URL: "http://ee-api:5000",
      EECLAW_ADAPTER_SECRET: "authorization-secret"
    })).toThrow("Incomplete EE provider configuration");
  });
});
