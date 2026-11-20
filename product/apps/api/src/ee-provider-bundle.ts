import { randomUUID } from "node:crypto";
import {
  ProviderHealthRegistry,
  type EnterpriseAuthorizationPort,
  type IdentityProviderPort,
  type ProjectDirectoryPort,
  type ProviderCompatibilityStatus,
  type ProviderHealthObservation,
  type WorkbenchProjectionPort
} from "@pc/application";
import { IdentityAuthorizationError, type ToolRelease } from "@pc/domain";
import {
  mcpDigest, GatewayProviderError,
  type BusinessCapabilityProviderPort, type ConnectorRegistration, type CredentialIssuerPort
} from "@pc/gateway";
import { classifyProviderConfiguration, type ProviderConfiguration } from "./provider-bootstrap.js";
import { RuntimeWorkbench } from "./workbench.js";

type Environment = Readonly<Record<string, string | undefined>>;
type BundleState = "UNCONFIGURED" | "STARTING" | "READY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED";
type Failure = "CONFIGURATION" | "COMPATIBILITY" | "AUTHENTICATION" | "TRANSPORT" | "TIMEOUT" | "PROTOCOL" | "AUTHORITY_CHANGED";
export interface EeBundleConfiguration {
  authorization_url: string;
  authorization_secret: string;
  mcp_url: string;
  mcp_secret: string;
  tenant: string;
}
export interface EeBundleCandidate {
  identity: IdentityProviderPort;
  authorization: EnterpriseAuthorizationPort;
  directory: ProjectDirectoryPort;
  capability: BusinessCapabilityProviderPort;
  projection: WorkbenchProjectionPort;
  credentialIssuer: CredentialIssuerPort;
  catalog: { connector: ConnectorRegistration; tools: ToolRelease[] };
  profileReleaseId: string;
  reviewProfileReleaseId: string;
  workbench?: RuntimeWorkbench;
}
export interface EeBundleDescriptor {
  contract_name: "pc.provider-bundle/1";
  contract_version: 1;
  provider_id: "provider:eeclaw";
  bundle_version: "1.0.0";
  registration_revision: number;
  compatibility_status: ProviderCompatibilityStatus;
  catalog_revision: string;
  configuration_digest: string;
  bundle_generation: string;
  bundle_state: BundleState;
  reason_codes: string[];
  observed_at: string;
  expires_at: string;
}

function safeEndpoint(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.origin + url.pathname.replace(/\/+$/u, ""); }
  catch { return "invalid-endpoint"; }
}

export function configurationDigest(environment: Environment): string {
  return mcpDigest({
    authorization: safeEndpoint(environment.EECLAW_ADAPTER_URL),
    mcp: safeEndpoint(environment.EE_MCP_ADAPTER_URL),
    tenant: environment.PC_PILOT_TENANT_ID ?? null,
    login: environment.PC_LOGIN_MODE ?? null,
    gateway: environment.PC_GATEWAY_STORE ?? "disabled",
    disabled: environment.PC_EE_PROVIDER_DISABLED === "true"
  });
}

export function inspectEeConfiguration(environment: Environment): ProviderConfiguration {
  try { return classifyProviderConfiguration(environment); }
  catch { return { mode: "ee-connected", ee: { configured: false } }; }
}

function category(error: unknown): Failure {
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  if (/CONFIGURATION/u.test(code)) return "CONFIGURATION";
  if (/AUTHORITY_CHANGED|REVOKED/u.test(code)) return "AUTHORITY_CHANGED";
  if (/AUTHENTICATION|HTTP_DENIED/u.test(code)) return "AUTHENTICATION";
  if (/INCOMPATIBLE|COMPATIBILITY/u.test(code)) return "COMPATIBILITY";
  if (/TIMEOUT/u.test(code) || (error instanceof Error && error.name === "TimeoutError")) return "TIMEOUT";
  if (/UNAVAILABLE|TRANSPORT|HTTP_FAILED/u.test(code) || error instanceof TypeError) return "TRANSPORT";
  return "PROTOCOL";
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export class EeProviderBundle {
  private readonly epoch = randomUUID();
  private sequence = 0;
  private state: BundleState = "UNCONFIGURED";
  private current: (EeBundleCandidate & { readonly generation: string }) | undefined;
  private previous: Readonly<{ catalog_revision: string; tool_release_ids: readonly string[] }> | undefined;
  private inFlight: Promise<void> | undefined;
  private failure: Failure | undefined;
  private failures = 0;
  private nextProbeAt = 0;
  private reasons = ["bundle_unconfigured"];
  private digest: string;
  private checkedAt: number;
  private compatibility: ProviderCompatibilityStatus = "UNKNOWN";
  readonly health: ProviderHealthRegistry;
  private readonly now: () => number;

  constructor(private readonly options: {
    environment: () => Environment;
    build: (configuration: EeBundleConfiguration, generation: string) => Promise<EeBundleCandidate>;
    health?: ProviderHealthRegistry;
    now?: () => number;
  }) {
    this.now = options.now ?? Date.now;
    this.health = options.health ?? new ProviderHealthRegistry(() => new Date(this.now()));
    this.health.register("provider:eeclaw", ["identity", "enterprise_authorization", "project_directory", "business_capability", "workbench_projection"]);
    this.digest = configurationDigest(options.environment());
    this.checkedAt = this.now();
  }

  descriptor(): EeBundleDescriptor {
    const health = this.health.observation("provider:eeclaw");
    const expired = this.state === "READY" && !this.health.isUsable("provider:eeclaw");
    const degraded = this.state === "READY" && health.provider_state === "DEGRADED";
    return {
      contract_name: "pc.provider-bundle/1", contract_version: 1, provider_id: "provider:eeclaw", bundle_version: "1.0.0",
      registration_revision: Math.max(1, this.sequence), compatibility_status: this.compatibility,
      catalog_revision: this.current?.catalog.connector.capability_digest ?? this.previous?.catalog_revision ?? "catalog-unavailable",
      configuration_digest: this.digest, bundle_generation: `${this.epoch}.${this.sequence}`,
      bundle_state: degraded ? "DEGRADED" : expired ? "UNAVAILABLE" : this.state,
      reason_codes: degraded ? ["bundle_degraded_execution_closed", ...health.reason_codes]
        : expired ? ["bundle_failure:health_expired", ...health.reason_codes] : [...this.reasons],
      observed_at: new Date(this.checkedAt).toISOString(),
      expires_at: this.state === "READY" ? health.expires_at : new Date(this.checkedAt + 30_000).toISOString()
    };
  }

  observation(): ProviderHealthObservation {
    const descriptor = this.descriptor();
    const state = descriptor.bundle_state === "READY" ? "HEALTHY" : descriptor.bundle_state;
    return {
      contract_name: "pc.provider-health/1", contract_version: 1,
      health_observation_id: "provider-health:eeclaw", provider_registration_id: "provider:eeclaw",
      configuration_revision: descriptor.registration_revision, provider_state: state,
      compatibility_status: descriptor.compatibility_status,
      port_health: { identity: state, enterprise_authorization: state, project_directory: state, business_capability: state, workbench_projection: state },
      reason_codes: descriptor.reason_codes,
      evidence_refs: [`provider-bundle:${descriptor.bundle_generation}`, `provider-registration:${descriptor.registration_revision}`],
      checked_at: descriptor.observed_at, expires_at: descriptor.expires_at
    };
  }

  metadata() { return this.previous; }
  automaticRecoveryAllowed(): boolean {
    return this.failure === undefined || ["TRANSPORT", "TIMEOUT"].includes(this.failure);
  }
  active() {
    return this.descriptor().bundle_state === "READY" ? this.current : undefined;
  }
  requireActive() {
    const active = this.active();
    if (!active) throw new IdentityAuthorizationError("PC_PROVIDER_UNAVAILABLE", "EE provider bundle is not executable", true);
    return active;
  }
  assertGeneration(generation: string): void {
    if (this.active()?.generation !== generation) {
      throw new IdentityAuthorizationError("PC_PROVIDER_GENERATION_STALE", "EE provider generation is no longer executable", true);
    }
  }

  async invoke<T>(generation: string, run: () => Promise<T>): Promise<T> {
    this.assertGeneration(generation);
    try {
      const result = await run();
      this.assertGeneration(generation);
      return result;
    } catch (error) {
      // A late result must not invalidate or revive a later candidate/generation.
      if (this.current?.generation === generation && this.state === "READY") {
        const code = error instanceof Error && "code" in error ? String(error.code) : "";
        if (!/GENERATION_STALE|BUSINESS_DENY|PROJECT_DENIED|EXTERNAL_ACCOUNT_DENIED|AUTHENTICATION_REQUIRED|TOOL_REJECTED|SCOPE_DENIED/u.test(code)) {
          const failure = category(error);
          this.recordFailure(failure);
          if (!(error instanceof IdentityAuthorizationError) && !(error instanceof GatewayProviderError)) {
            throw new IdentityAuthorizationError(`PC_PROVIDER_BUNDLE_${failure}`, "EE provider request failed", true);
          }
        }
      }
      throw error;
    }
  }

  reload(options: { manual?: boolean } = {}): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if ((!options.manual && !this.automaticRecoveryAllowed()) || this.now() < this.nextProbeAt) {
      return Promise.reject(new IdentityAuthorizationError("PC_PROVIDER_RETRY_BLOCKED", "EE bundle retry requires intervention or bounded backoff", true));
    }
    // Close execution before any await; only diagnostics from the previous generation survive.
    this.retainMetadata();
    this.current = undefined;
    this.state = "STARTING";
    this.reasons = ["bundle_starting"];
    this.checkedAt = this.now();
    this.sequence++;
    // Old router attempts update only their detached health record.
    this.health.register("provider:eeclaw", ["identity", "enterprise_authorization", "project_directory", "business_capability", "workbench_projection"], this.sequence + 1);
    const generation = `${this.epoch}.${this.sequence}`;
    const task = this.build(generation).finally(() => { if (this.inFlight === task) this.inFlight = undefined; });
    this.inFlight = task;
    return task;
  }

  private async build(generation: string): Promise<void> {
    const environment = this.options.environment();
    this.digest = configurationDigest(environment);
    if (environment.PC_EE_PROVIDER_DISABLED === "true") {
      this.state = "DISABLED"; this.reasons = ["bundle_disabled"]; return;
    }
    let configuration: ProviderConfiguration;
    try { configuration = classifyProviderConfiguration(environment); }
    catch { this.recordFailure("CONFIGURATION"); return; }
    if (!configuration.ee.configured) {
      this.state = "UNCONFIGURED"; this.compatibility = "NOT_APPLICABLE"; this.reasons = ["bundle_unconfigured"]; return;
    }
    const { authorization_url, authorization_secret, mcp_url, mcp_secret } = configuration.ee;
    const tenant = environment.PC_PILOT_TENANT_ID;
    const validUrl = (value: string) => {
      try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }
      catch { return false; }
    };
    if (!tenant?.trim() || !validUrl(authorization_url!) || !validUrl(mcp_url!)) {
      this.recordFailure("CONFIGURATION"); return;
    }
    try {
      const candidate = await this.options.build({ authorization_url: authorization_url!, authorization_secret: authorization_secret!, mcp_url: mcp_url!, mcp_secret: mcp_secret!, tenant }, generation);
      const ports = [candidate.identity, candidate.authorization, candidate.directory, candidate.capability, candidate.projection];
      if (ports.some(port => port?.provider_registration_id !== "provider:eeclaw")
        || !candidate.catalog?.connector?.connector_id || !candidate.catalog.connector.capability_digest
        || !candidate.credentialIssuer?.issue || !candidate.catalog.tools.length || !candidate.profileReleaseId || !candidate.reviewProfileReleaseId
        || candidate.catalog.tools.some(tool => !candidate.catalog.connector.tool_release_ids.includes(tool.tool_release_id))) {
        throw new Error("Incomplete EE provider bundle");
      }
      this.health.markCompatible("provider:eeclaw", `provider-bundle:${generation}`);
      this.health.beginAttempt("provider:eeclaw", "business_capability").success("provider_catalog_validated", `catalog:${candidate.catalog.connector.capability_digest}`);
      // One publication point: no consumer observes candidate construction mutations.
      const catalog = immutable(structuredClone(candidate.catalog));
      const directory = this.pinDirectory(candidate.directory, generation);
      const projection = this.pinProjection(candidate.projection, generation);
      this.current = Object.freeze({ ...candidate, catalog, directory, projection, generation,
        identity: Object.freeze<IdentityProviderPort>({ provider_registration_id: "provider:eeclaw", identity_provider_ref: "eeclaw",
          authenticate: input => this.invoke(generation, () => candidate.identity.authenticate(input)),
          validate: (session, principal) => this.invoke(generation, () => candidate.identity.validate(session, principal)),
          bindings: () => this.invoke(generation, () => candidate.identity.bindings()) }) as IdentityProviderPort,
        authorization: Object.freeze<EnterpriseAuthorizationPort>({ provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw",
          evaluate: input => this.invoke(generation, () => candidate.authorization.evaluate(input)) }) as EnterpriseAuthorizationPort,
        credentialIssuer: Object.freeze<CredentialIssuerPort>({ issue: input => {
          this.forConnector(input.connector);
          return this.invoke(generation, () => candidate.credentialIssuer.issue(input));
        } }),
        capability: Object.freeze<BusinessCapabilityProviderPort>({ provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw",
          discover: token => this.invoke(generation, () => candidate.capability.discover(token)),
          dispatch: input => { this.forConnector(input.connector); return this.dispatchGeneration(generation, () => candidate.capability.dispatch(input)); },
          reconcile: input => { this.forConnector(input.connector); return this.invoke(generation, () => candidate.capability.reconcile(input)); } }),
        ...(candidate.workbench ? { workbench: generationWorkbench(this, generation, new RuntimeWorkbench(Object.freeze({ ...candidate.workbench.options,
          connector: catalog.connector, tools: catalog.tools, projectDirectory: directory, workbenchProjection: projection,
          profileReleaseId: candidate.profileReleaseId, reviewProfileReleaseId: candidate.reviewProfileReleaseId,
          providerAvailability: { isUsable: () => this.active()?.generation === generation, observation: () => this.observation() }
        }))) } : {}) });
      this.state = "READY";
      this.compatibility = "COMPATIBLE";
      this.reasons = ["bundle_ready"];
      this.failure = undefined;
      this.failures = 0;
      this.nextProbeAt = 0;
      this.checkedAt = this.now();
      this.retainMetadata();
    } catch (error) {
      const failure = category(error);
      this.recordFailure(failure);
      throw new IdentityAuthorizationError(`PC_PROVIDER_BUNDLE_${failure}`, "EE provider bundle assembly failed", ["TRANSPORT", "TIMEOUT"].includes(failure));
    }
  }

  private retainMetadata(): void {
    if (this.current) this.previous = Object.freeze({ catalog_revision: this.current.catalog.connector.capability_digest,
      tool_release_ids: Object.freeze(this.current.catalog.tools.map(tool => tool.tool_release_id)) });
  }
  private recordFailure(failure: Failure): void {
    this.retainMetadata(); this.current = undefined;
    this.failure = failure; this.failures++;
    this.state = failure === "AUTHORITY_CHANGED" ? "DISABLED" : "UNAVAILABLE";
    this.compatibility = ["COMPATIBILITY", "PROTOCOL"].includes(failure) ? "INCOMPATIBLE" : "UNKNOWN";
    this.checkedAt = this.now();
    this.reasons = [`bundle_failure:${failure.toLowerCase()}`];
    this.nextProbeAt = ["TRANSPORT", "TIMEOUT"].includes(failure)
      ? this.checkedAt + Math.min(30_000, 1000 * 2 ** Math.min(5, this.failures - 1)) : 0;
    this.health.markFailure("provider:eeclaw", this.compatibility === "INCOMPATIBLE" ? "INCOMPATIBLE" : failure === "AUTHENTICATION" ? "AUTHENTICATION" : "UNAVAILABLE", this.reasons[0]!);
  }

  readonly authorization: EnterpriseAuthorizationPort = {
    provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw",
    evaluate: input => { const active = this.requireActive(); return this.invoke(active.generation, () => active.authorization.evaluate(input)); }
  };
  readonly identity: IdentityProviderPort = {
    provider_registration_id: "provider:eeclaw", identity_provider_ref: "eeclaw",
    authenticate: input => { const active = this.requireActive(); return this.invoke(active.generation, () => active.identity.authenticate(input)); },
    validate: (session, principal) => { const active = this.requireActive(); return this.invoke(active.generation, () => active.identity.validate(session, principal)); },
    bindings: () => { const active = this.requireActive(); return this.invoke(active.generation, () => active.identity.bindings()); }
  };
  readonly directory: ProjectDirectoryPort = {
    provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw",
    listProjects: input => { const active = this.requireActive(); return this.invoke(active.generation, () => active.directory.listProjects(input)); }
  };
  readonly credentialIssuer: CredentialIssuerPort = {
    issue: input => { const active = this.forConnector(input.connector); return this.invoke(active.generation, () => active.credentialIssuer.issue(input)); }
  };
  readonly capability: BusinessCapabilityProviderPort = {
    provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw",
    discover: token => { const active = this.requireActive(); return this.invoke(active.generation, () => active.capability.discover(token)); },
    dispatch: async input => {
      const active = this.forConnector(input.connector);
      try {
        return await this.invoke(active.generation, () => active.capability.dispatch(input));
      } catch (error) {
        // A dispatched write with a changed generation is unknown, never automatically retried.
        if (error instanceof IdentityAuthorizationError && error.code === "PC_PROVIDER_GENERATION_STALE") {
          throw new GatewayProviderError("PC_PROVIDER_GENERATION_STALE", "EE generation changed during dispatch", true);
        }
        throw error;
      }
    },
    reconcile: input => { const active = this.forConnector(input.connector); return this.invoke(active.generation, () => active.capability.reconcile(input)); }
  };
  private async dispatchGeneration<T>(generation: string, run: () => Promise<T>): Promise<T> {
    this.assertGeneration(generation);
    try { return await this.invoke(generation, run); }
    catch (error) {
      if (error instanceof IdentityAuthorizationError && error.code === "PC_PROVIDER_GENERATION_STALE") {
        throw new GatewayProviderError("PC_PROVIDER_GENERATION_STALE", "EE generation changed during dispatch", true);
      }
      throw error;
    }
  }
  private pinDirectory(port: ProjectDirectoryPort, generation: string): ProjectDirectoryPort {
    return Object.freeze({ provider_registration_id: port.provider_registration_id, resource_authority: port.resource_authority,
      listProjects: (input: Parameters<ProjectDirectoryPort["listProjects"]>[0]) => this.invoke(generation, () => port.listProjects(input)) });
  }
  private pinProjection(port: WorkbenchProjectionPort, generation: string): WorkbenchProjectionPort {
    return Object.freeze({ provider_registration_id: port.provider_registration_id, resource_authority: port.resource_authority,
      project: (input: Parameters<WorkbenchProjectionPort["project"]>[0]) => {
        this.assertGeneration(generation);
        return port.project(input);
      } });
  }
  private forConnector(connector: ConnectorRegistration) {
    const active = this.requireActive();
    if (active.catalog.connector.connector_id !== connector.connector_id
      || active.catalog.connector.capability_digest !== connector.capability_digest) {
      throw new GatewayProviderError("PC_PROVIDER_GENERATION_STALE", "Connector belongs to an inactive EE generation", false);
    }
    return active;
  }
}

/** Select once per method call; an in-flight call retains one immutable Workbench. */
export function bundleWorkbench(bundle: EeProviderBundle, core: RuntimeWorkbench): RuntimeWorkbench {
  return new Proxy(core, { get(_target, key) {
    const selected = bundle.active()?.workbench ?? core;
    const value = Reflect.get(selected, key);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      const target = personalWorkbenchCall(key, args) ? core : selected;
      return Reflect.get(target, key).apply(target, args);
    };
  } });
}

function personalWorkbenchCall(key: string | symbol, args: unknown[]): boolean {
  const input = key === "create" ? args[2] : args[0];
  return ["create", "prepare", "run", "conversation", "cancel", "projection", "sessionId"].includes(String(key))
    && input !== null && typeof input === "object" && !("project_code" in input && input.project_code);
}

function generationWorkbench(bundle: EeProviderBundle, generation: string, workbench: RuntimeWorkbench): RuntimeWorkbench {
  return new Proxy(workbench, { get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      const fenced = !["hasProjectProvider", "projectProviderConfigured", "capabilityAvailability", "sessionId"].includes(String(key))
        && !personalWorkbenchCall(key, args);
      if (fenced) bundle.assertGeneration(generation);
      const result = value.apply(target, args);
      return result instanceof Promise && fenced ? result.then(value => {
        // owned() can also return a purely PC-owned workspace.
        if (key !== "owned" || value?.workspace?.project_code) bundle.assertGeneration(generation);
        return value;
      }) : result;
    };
  } });
}
