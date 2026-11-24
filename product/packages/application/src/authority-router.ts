import type { PCPrincipal } from "@pc/domain";
import type {
  EnterpriseAuthorizationPort
} from "./external-provider.js";
import type {
  ExternalAuthorizationDecision,
  ExternalAuthorizationPort
} from "./identity-authorization.js";
import type { ProviderCompatibilityMapping } from "./compatibility-mapping.js";
import {
  ProviderHealthRegistry,
  type ProviderFailureKind
} from "./provider-health.js";

export interface AuthorityRouteDefinition {
  readonly route_id: string;
  readonly action_pattern: string;
  readonly resource_scope_pattern: string;
  readonly resource_authority: string;
  readonly authorization_mode: "PC_ONLY" | "PC_AND_PROVIDER";
  readonly provider_registration_id?: string;
  readonly route_state?: "ACTIVE" | "DISABLED" | "SUPERSEDED";
}

export interface AuthorityRouteInput {
  readonly principal: PCPrincipal;
  readonly action: string;
  readonly resource_scope_refs: readonly string[];
  readonly tool_release_ids: readonly string[];
  readonly observed_at: string;
  readonly trusted_resource_authority?: string;
  readonly compatibility_mapping?: ProviderCompatibilityMapping;
}

export interface AuthorityRouteDecision extends ExternalAuthorizationDecision {
  readonly route_id?: string;
  readonly provider_registration_id?: string;
}

const DEFAULT_ROUTES: readonly AuthorityRouteDefinition[] = [
  { route_id: "authority-route:provider-manage", action_pattern: "provider.manage",
    resource_scope_pattern: "global:*", resource_authority: "pc", authorization_mode: "PC_ONLY" },
  { route_id: "authority-route:conversation-personal", action_pattern: "conversation.run",
    resource_scope_pattern: "user:self", resource_authority: "pc", authorization_mode: "PC_ONLY" },
  ...["personal_task.read", "personal_task.write", "identity.read", "capability.read"].map(action => ({
    route_id: `authority-route:${action}`, action_pattern: action, resource_scope_pattern: "user:self",
    resource_authority: "pc", authorization_mode: "PC_ONLY" as const })),
  ...["memory", "task", "runtime", "resource", "profile", "plugin", "tool"].map((namespace) => ({
    route_id: `authority-route:pc-${namespace}`,
    action_pattern: `${namespace}.*`,
    resource_scope_pattern: "*",
    resource_authority: "pc",
    authorization_mode: "PC_ONLY" as const
  })),
  { route_id: "authority-route:ee-page", action_pattern: "page:*", resource_scope_pattern: "project:*",
    resource_authority: "eeclaw", authorization_mode: "PC_AND_PROVIDER", provider_registration_id: "provider:eeclaw" },
  { route_id: "authority-route:ee-draft-generate", action_pattern: "draft.generate", resource_scope_pattern: "project:*",
    resource_authority: "eeclaw", authorization_mode: "PC_AND_PROVIDER", provider_registration_id: "provider:eeclaw" },
  { route_id: "authority-route:ee-draft-read", action_pattern: "draft.read", resource_scope_pattern: "project:*",
    resource_authority: "eeclaw", authorization_mode: "PC_AND_PROVIDER", provider_registration_id: "provider:eeclaw" },
  { route_id: "authority-route:ee-actions", action_pattern: "ee.*", resource_scope_pattern: "project:*",
    resource_authority: "eeclaw", authorization_mode: "PC_AND_PROVIDER", provider_registration_id: "provider:eeclaw" },
  ...["project.read", "requirement.read", "function.read", "ssts.read", "ssts.generate", "ssts.review.request", "ssts.review.decide", "tool.execute", "approval.decide"].map(action => ({
    route_id: `authority-route:source-${action}`, action_pattern: action, resource_scope_pattern: "project:*",
    resource_authority: "eeclaw", authorization_mode: "PC_AND_PROVIDER" as const, provider_registration_id: "provider:eeclaw" }))
];

function patternMatches(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

function scopesMatch(
  pattern: string,
  input: AuthorityRouteInput
): boolean {
  if (pattern === "*") return input.resource_scope_refs.length > 0;
  if (pattern === "user:self") {
    return input.resource_scope_refs.length === 1
      && input.resource_scope_refs[0] === `user:${input.principal.principal_id}`
      && input.tool_release_ids.length === 0;
  }
  return input.resource_scope_refs.length > 0
    && input.resource_scope_refs.every((scope) => patternMatches(pattern, scope));
}

function providerFailure(error: unknown): {
  kind: ProviderFailureKind;
  reasonCode: string;
} {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { kind: "TIMEOUT", reasonCode: "provider_authorization_timeout" };
  }
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string"
      ? error.code
      : "";
    if (code.includes("AUTHENTICATION") || code.includes("LOGIN")) {
      return { kind: "AUTHENTICATION", reasonCode: "provider_authentication_failed" };
    }
    if (code.includes("CONTRACT") || code.includes("INCOMPATIBLE")) {
      return { kind: "INCOMPATIBLE", reasonCode: "provider_contract_incompatible" };
    }
  }
  return { kind: "UNAVAILABLE", reasonCode: "provider_authorization_unavailable" };
}

function providerMetadata(port: ExternalAuthorizationPort): {
  providerRegistrationId: string;
  resourceAuthority: string;
} {
  const candidate = port as Partial<EnterpriseAuthorizationPort>;
  return {
    providerRegistrationId: candidate.provider_registration_id ?? "provider:eeclaw",
    resourceAuthority: candidate.resource_authority ?? "eeclaw"
  };
}

export class AuthorityRouter {
  private readonly providers = new Map<string, {
    readonly port: ExternalAuthorizationPort;
    readonly resourceAuthority: string;
  }>();

  constructor(
    private readonly routes: readonly AuthorityRouteDefinition[] = DEFAULT_ROUTES,
    readonly health = new ProviderHealthRegistry()
  ) {}

  registerProvider(port: ExternalAuthorizationPort): void {
    const metadata = providerMetadata(port);
    if (this.providers.has(metadata.providerRegistrationId)) {
      throw new Error(`Provider authorization port already registered: ${metadata.providerRegistrationId}`);
    }
    this.providers.set(metadata.providerRegistrationId, {
      port,
      resourceAuthority: metadata.resourceAuthority
    });
    this.health.register(metadata.providerRegistrationId, ["enterprise_authorization"]);
  }

  private matchingRoutes(input: AuthorityRouteInput) {
    return this.routes.filter((route) => (route.route_state ?? "ACTIVE") === "ACTIVE"
      && patternMatches(route.action_pattern, input.action)
      && scopesMatch(route.resource_scope_pattern, input)
      && (input.trusted_resource_authority === undefined
        || route.resource_authority === input.trusted_resource_authority));
  }

  authorizationMode(input: AuthorityRouteInput): "PC_ONLY" | "PC_AND_PROVIDER" | "DENY_UNKNOWN" {
    const active = this.matchingRoutes(input);
    return active.length === 1 ? active[0]!.authorization_mode : "DENY_UNKNOWN";
  }

  resolveRoute(input: AuthorityRouteInput): AuthorityRouteDefinition | undefined {
    const routes = this.matchingRoutes(input);
    return routes.length === 1 ? structuredClone(routes[0]!) : undefined;
  }

  async evaluate(input: AuthorityRouteInput): Promise<AuthorityRouteDecision> {
    const active = this.matchingRoutes(input);
    if (active.length === 0) {
      return {
        decision: "DENY",
        reason_codes: [`authority_route_missing:${input.action}`],
        evidence_refs: []
      };
    }
    if (active.length !== 1) {
      return {
        decision: "DENY",
        reason_codes: [`authority_route_ambiguous:${input.action}`],
        evidence_refs: active.map((route) => route.route_id).sort()
      };
    }
    const route = active[0]!;
    const routeEvidence = `authority-route:${route.route_id.replace(/^authority-route:/u, "")}`;
    if (route.authorization_mode === "PC_ONLY") {
      return {
        decision: "ALLOW",
        route_id: route.route_id,
        reason_codes: [`authority_route_pc_only:${input.action}`],
        evidence_refs: [routeEvidence]
      };
    }
    const providerId = route.provider_registration_id;
    if (providerId === undefined) {
      return {
        decision: "DENY",
        route_id: route.route_id,
        reason_codes: [`authority_route_provider_missing:${input.action}`],
        evidence_refs: [routeEvidence]
      };
    }
    const provider = this.providers.get(providerId);
    if (provider === undefined || provider.resourceAuthority !== route.resource_authority) {
      return {
        decision: "DENY",
        route_id: route.route_id,
        provider_registration_id: providerId,
        reason_codes: [`authority_provider_missing:${providerId}`],
        evidence_refs: [routeEvidence]
      };
    }
    const attempt = this.health.beginAttempt(providerId, "enterprise_authorization");
    const health = this.health.observation(providerId);
    if (!attempt.allowed) {
      return {
        decision: "DENY",
        route_id: route.route_id,
        provider_registration_id: providerId,
        reason_codes: [`authority_provider_unavailable:${providerId}`, ...health.reason_codes],
        evidence_refs: [routeEvidence, health.health_observation_id, ...health.evidence_refs]
      };
    }
    try {
      const decision = await provider.port.evaluate({
        principal: input.principal,
        action: input.action,
        resource_scope_refs: input.resource_scope_refs,
        observed_at: input.observed_at,
        ...(input.compatibility_mapping ? { compatibility_mapping: input.compatibility_mapping } : {})
      });
      attempt.success("provider_authorization_responded", decision.evidence_refs[0]);
      return {
        ...decision,
        route_id: route.route_id,
        provider_registration_id: providerId,
        reason_codes: [`authority_route_provider:${providerId}`, ...decision.reason_codes],
        evidence_refs: [routeEvidence, ...decision.evidence_refs]
      };
    } catch (error) {
      const failure = providerFailure(error);
      attempt.failure(failure.kind, failure.reasonCode);
      const failedHealth = this.health.observation(providerId);
      return {
        decision: "DENY",
        route_id: route.route_id,
        provider_registration_id: providerId,
        reason_codes: [`authority_provider_unavailable:${providerId}`, ...failedHealth.reason_codes],
        evidence_refs: [routeEvidence, failedHealth.health_observation_id]
      };
    }
  }
}
