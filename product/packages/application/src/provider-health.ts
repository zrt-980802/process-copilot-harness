export type ProviderState =
  | "UNCONFIGURED"
  | "STARTING"
  | "HEALTHY"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "DISABLED";

export type ProviderCompatibilityStatus =
  | "COMPATIBLE"
  | "INCOMPATIBLE"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

export type ProviderPortKind =
  | "identity"
  | "enterprise_authorization"
  | "project_directory"
  | "business_capability"
  | "workbench_projection";

export type ProviderFailureKind =
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "AUTHENTICATION"
  | "INCOMPATIBLE";

export interface ProviderHealthObservation {
  readonly contract_name: "pc.provider-health/1";
  readonly contract_version: 1;
  readonly health_observation_id: string;
  readonly provider_registration_id: string;
  readonly configuration_revision: number;
  readonly provider_state: ProviderState;
  readonly compatibility_status: ProviderCompatibilityStatus;
  readonly port_health: Readonly<Partial<Record<ProviderPortKind, ProviderState>>>;
  readonly reason_codes: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly checked_at: string;
  readonly expires_at: string;
}

interface ProviderHealthRecord {
  readonly providerRegistrationId: string;
  readonly configurationRevision: number;
  readonly ports: Set<ProviderPortKind>;
  state: ProviderState;
  compatibilityStatus: ProviderCompatibilityStatus;
  reasonCodes: string[];
  evidenceRefs: string[];
  checkedAt: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  nextProbeAt: number;
  probeInFlight: boolean;
}

export interface ProviderAttempt {
  readonly allowed: boolean;
  readonly probe: boolean;
  success(reasonCode?: string, evidenceRef?: string): void;
  failure(kind: ProviderFailureKind, reasonCode: string, evidenceRef?: string): void;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))];
}

export class ProviderHealthRegistry {
  private readonly records = new Map<string, ProviderHealthRecord>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
    private readonly maxBackoffMs = DEFAULT_MAX_BACKOFF_MS
  ) {}

  register(
    providerRegistrationId: string,
    ports: readonly ProviderPortKind[],
    configurationRevision = 1
  ): void {
    const existing = this.records.get(providerRegistrationId);
    if (existing !== undefined && existing.configurationRevision === configurationRevision) {
      ports.forEach((port) => existing.ports.add(port));
      return;
    }
    const checkedAt = this.now().getTime();
    this.records.set(providerRegistrationId, {
      providerRegistrationId,
      configurationRevision,
      ports: new Set(ports),
      state: "STARTING",
      compatibilityStatus: "UNKNOWN",
      reasonCodes: ["provider_starting"],
      evidenceRefs: [],
      checkedAt,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      nextProbeAt: checkedAt,
      probeInFlight: false
    });
  }

  disable(providerRegistrationId: string, reasonCode = "provider_disabled"): void {
    const record = this.require(providerRegistrationId);
    record.state = "DISABLED";
    record.reasonCodes = [reasonCode];
    record.checkedAt = this.now().getTime();
    record.probeInFlight = false;
  }

  markCompatible(providerRegistrationId: string, evidenceRef?: string): void {
    const record = this.require(providerRegistrationId);
    record.compatibilityStatus = "COMPATIBLE";
    this.recordSuccess(record, "provider_compatible", evidenceRef);
  }

  markFailure(
    providerRegistrationId: string,
    kind: ProviderFailureKind,
    reasonCode: string,
    evidenceRef?: string
  ): void {
    this.recordFailure(this.require(providerRegistrationId), kind, reasonCode, evidenceRef);
  }

  beginAttempt(
    providerRegistrationId: string,
    port: ProviderPortKind
  ): ProviderAttempt {
    const record = this.records.get(providerRegistrationId);
    if (record === undefined || !record.ports.has(port)) {
      return this.blockedAttempt();
    }
    const now = this.now().getTime();
    if (record.state === "DISABLED"
      || record.compatibilityStatus === "INCOMPATIBLE") {
      return this.blockedAttempt();
    }
    const recovering = record.state === "UNAVAILABLE";
    if (recovering && (now < record.nextProbeAt || record.probeInFlight)) {
      return this.blockedAttempt();
    }
    if (recovering) record.probeInFlight = true;
    let completed = false;
    return {
      allowed: true,
      probe: recovering,
      success: (reasonCode = "provider_request_succeeded", evidenceRef?: string) => {
        if (completed) return;
        completed = true;
        record.probeInFlight = false;
        this.recordSuccess(record, reasonCode, evidenceRef);
      },
      failure: (kind, reasonCode, evidenceRef) => {
        if (completed) return;
        completed = true;
        record.probeInFlight = false;
        this.recordFailure(record, kind, reasonCode, evidenceRef);
      }
    };
  }

  isUsable(providerRegistrationId: string, port?: ProviderPortKind): boolean {
    const record = this.records.get(providerRegistrationId);
    if (record === undefined || !["HEALTHY", "DEGRADED"].includes(record.state)) {
      return false;
    }
    if (this.now().getTime() >= record.checkedAt + this.ttlMs) return false;
    return port === undefined || record.ports.has(port);
  }

  observation(providerRegistrationId: string): ProviderHealthObservation {
    const record = this.records.get(providerRegistrationId);
    if (record === undefined) {
      const checkedAt = this.now();
      return {
        contract_name: "pc.provider-health/1",
        contract_version: 1,
        health_observation_id: `provider-health:${providerRegistrationId.replace(/^provider:/u, "")}`,
        provider_registration_id: providerRegistrationId,
        configuration_revision: 1,
        provider_state: "UNCONFIGURED",
        compatibility_status: "UNKNOWN",
        port_health: { enterprise_authorization: "UNCONFIGURED" },
        reason_codes: ["provider_unconfigured"],
        evidence_refs: [],
        checked_at: checkedAt.toISOString(),
        expires_at: new Date(checkedAt.getTime() + this.ttlMs).toISOString()
      };
    }
    const expired = this.now().getTime() >= record.checkedAt + this.ttlMs;
    const effectiveState = expired
      && ["HEALTHY", "DEGRADED"].includes(record.state)
      ? "UNAVAILABLE"
      : record.state;
    const portHealth = Object.fromEntries(
      [...record.ports].sort().map((port) => [port, effectiveState])
    ) as Partial<Record<ProviderPortKind, ProviderState>>;
    return {
      contract_name: "pc.provider-health/1",
      contract_version: 1,
      health_observation_id: `provider-health:${providerRegistrationId.replace(/^provider:/u, "")}`,
      provider_registration_id: providerRegistrationId,
      configuration_revision: record.configurationRevision,
      provider_state: effectiveState,
      compatibility_status: record.compatibilityStatus,
      port_health: portHealth,
      reason_codes: expired
        ? ["provider_health_observation_expired"]
        : unique(record.reasonCodes),
      evidence_refs: unique(record.evidenceRefs),
      checked_at: new Date(record.checkedAt).toISOString(),
      expires_at: new Date(record.checkedAt + this.ttlMs).toISOString()
    };
  }

  private recordSuccess(
    record: ProviderHealthRecord,
    reasonCode: string,
    evidenceRef?: string
  ): void {
    record.checkedAt = this.now().getTime();
    record.consecutiveFailures = 0;
    record.consecutiveSuccesses += 1;
    record.nextProbeAt = record.checkedAt;
    record.state = record.state === "UNAVAILABLE" && record.consecutiveSuccesses < 2
      ? "DEGRADED"
      : "HEALTHY";
    record.reasonCodes = [reasonCode];
    record.evidenceRefs = evidenceRef === undefined ? [] : [evidenceRef];
  }

  private recordFailure(
    record: ProviderHealthRecord,
    kind: ProviderFailureKind,
    reasonCode: string,
    evidenceRef?: string
  ): void {
    record.checkedAt = this.now().getTime();
    record.consecutiveFailures += 1;
    record.consecutiveSuccesses = 0;
    record.state = "UNAVAILABLE";
    if (kind === "INCOMPATIBLE") record.compatibilityStatus = "INCOMPATIBLE";
    const backoff = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * (2 ** Math.max(0, record.consecutiveFailures - 1))
    );
    record.nextProbeAt = kind === "INCOMPATIBLE"
      ? Number.POSITIVE_INFINITY
      : record.checkedAt + backoff;
    record.reasonCodes = [reasonCode, `provider_failure:${kind.toLowerCase()}`];
    record.evidenceRefs = evidenceRef === undefined ? [] : [evidenceRef];
  }

  private require(providerRegistrationId: string): ProviderHealthRecord {
    const record = this.records.get(providerRegistrationId);
    if (record === undefined) {
      throw new Error(`Provider is not registered: ${providerRegistrationId}`);
    }
    return record;
  }

  private blockedAttempt(): ProviderAttempt {
    return {
      allowed: false,
      probe: false,
      success: () => undefined,
      failure: () => undefined
    };
  }
}
