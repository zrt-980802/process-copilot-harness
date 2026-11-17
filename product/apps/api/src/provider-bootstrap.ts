export type ProviderMode = "standalone" | "ee-connected";

export interface ProviderConfiguration {
  readonly mode: ProviderMode;
  readonly ee: {
    readonly configured: boolean;
    readonly authorization_url?: string;
    readonly authorization_secret?: string;
    readonly mcp_url?: string;
    readonly mcp_secret?: string;
  };
}

type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

function configured(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

export function classifyProviderConfiguration(
  environment: ProviderEnvironment
): ProviderConfiguration {
  const gatewayEnabled = (environment.PC_GATEWAY_STORE ?? "disabled") !== "disabled";
  const values = {
    login: environment.PC_LOGIN_MODE === "ee",
    authorizationUrl: configured(environment.EECLAW_ADAPTER_URL),
    authorizationSecret: configured(environment.EECLAW_ADAPTER_SECRET),
    mcpUrl: configured(environment.EE_MCP_ADAPTER_URL),
    mcpSecret: configured(environment.EE_MCP_ADAPTER_SECRET),
    gateway: gatewayEnabled
  };
  const configuredCount = Object.values(values).filter(Boolean).length;

  if (configuredCount === 0) {
    if (environment.PC_LOGIN_MODE !== undefined
      && !["", "local"].includes(environment.PC_LOGIN_MODE.trim())) {
      throw new Error("Unsupported PC_LOGIN_MODE for Standalone mode");
    }
    return {
      mode: "standalone",
      ee: { configured: false }
    };
  }

  if (configuredCount !== Object.keys(values).length) {
    const missing = Object.entries(values)
      .filter(([, present]) => !present)
      .map(([name]) => name)
      .join(", ");
    throw new Error(`Incomplete EE provider configuration: ${missing}`);
  }

  return {
    mode: "ee-connected",
    ee: {
      configured: true,
      authorization_url: environment.EECLAW_ADAPTER_URL!.trim(),
      authorization_secret: environment.EECLAW_ADAPTER_SECRET!,
      mcp_url: environment.EE_MCP_ADAPTER_URL!.trim(),
      mcp_secret: environment.EE_MCP_ADAPTER_SECRET!
    }
  };
}
