import { createHash } from "node:crypto";

export type ArtifactKind =
  | "workbench_projection"
  | "role_configuration_schema"
  | "role_configuration_defaults"
  | "permission_bundle"
  | "capability_policy"
  | "workflow_contribution"
  | "artifact_contract";

export type LockLevel =
  | "personal_preference"
  | "role_default"
  | "project_policy"
  | "organization_policy"
  | "security_policy";

export interface PolicyEntry {
  readonly key: string;
  readonly value: unknown;
  readonly component?: string;
  readonly lockLevel?: LockLevel;
}

export interface PolicyArtifactPayload {
  readonly entries: readonly PolicyEntry[];
}

export interface PolicyRegistry {
  readonly artifactKinds: ReadonlySet<ArtifactKind>;
  readonly keys: ReadonlySet<string>;
  readonly components: ReadonlySet<string>;
  readonly codeRegistryRevision: string;
}

export interface ApprovalEvidence {
  readonly principalId: string;
  readonly role: "publisher" | "business_owner" | "project_governance" | "security";
}

export interface PolicyArtifactRelease {
  readonly artifactReleaseId: string;
  readonly artifactDefinitionId: string;
  readonly artifactKind: ArtifactKind;
  readonly releaseVersion: string;
  readonly schemaVersion: string;
  readonly payload: PolicyArtifactPayload;
  readonly payloadChecksum: string;
  readonly codeRegistryRevision: string;
  readonly lifecycleState:
    | "DRAFT"
    | "VALIDATED"
    | "APPROVED"
    | "PUBLISHED"
    | "SUPERSEDED";
  readonly approvalEvidence: readonly ApprovalEvidence[];
  readonly publishedEnvironment?: "dev" | "test" | "prod";
}

const secretPattern = /(secret|token|password|private[_-]?key|credential)/i;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("POLICY_NON_FINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("POLICY_NON_JSON_VALUE");
}

export function payloadChecksum(payload: PolicyArtifactPayload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function createPolicyArtifactRelease(input: {
  readonly artifactReleaseId: string;
  readonly artifactDefinitionId: string;
  readonly artifactKind: ArtifactKind;
  readonly releaseVersion: string;
  readonly schemaVersion: string;
  readonly payload: PolicyArtifactPayload;
  readonly registry: PolicyRegistry;
}): PolicyArtifactRelease {
  validatePayload(input.artifactKind, input.payload, input.registry);
  return deepFreeze({
    artifactReleaseId: input.artifactReleaseId,
    artifactDefinitionId: input.artifactDefinitionId,
    artifactKind: input.artifactKind,
    releaseVersion: input.releaseVersion,
    schemaVersion: input.schemaVersion,
    payload: input.payload,
    payloadChecksum: payloadChecksum(input.payload),
    codeRegistryRevision: input.registry.codeRegistryRevision,
    lifecycleState: "VALIDATED",
    approvalEvidence: []
  });
}

export function approvePolicyArtifactRelease(
  release: PolicyArtifactRelease,
  approvals: readonly ApprovalEvidence[]
): PolicyArtifactRelease {
  if (release.lifecycleState !== "VALIDATED") {
    throw new Error("POLICY_RELEASE_NOT_VALIDATED");
  }
  assertApprovalPolicy(release.payload, approvals);
  return deepFreeze({
    ...release,
    lifecycleState: "APPROVED" as const,
    approvalEvidence: [...approvals]
  });
}

export function publishPolicyArtifactRelease(
  release: PolicyArtifactRelease,
  environment: "dev" | "test" | "prod"
): PolicyArtifactRelease {
  if (release.lifecycleState !== "APPROVED") {
    throw new Error("POLICY_RELEASE_NOT_APPROVED");
  }
  if (payloadChecksum(release.payload) !== release.payloadChecksum) {
    throw new Error("POLICY_CHECKSUM_MISMATCH");
  }
  assertApprovalPolicy(release.payload, release.approvalEvidence);
  return deepFreeze({
    ...release,
    lifecycleState: "PUBLISHED" as const,
    publishedEnvironment: environment
  });
}

export function assertPersonalConfigurationWrite(
  lockLevel: LockLevel,
  actor: "role_member" | "governance_service"
): void {
  if (actor === "role_member" && lockLevel !== "personal_preference") {
    throw new Error("CONFIGURATION_LOCK_LEVEL_FORBIDS_WRITE");
  }
}

function validatePayload(
  artifactKind: ArtifactKind,
  payload: PolicyArtifactPayload,
  registry: PolicyRegistry
): void {
  if (!registry.artifactKinds.has(artifactKind)) {
    throw new Error("POLICY_ARTIFACT_KIND_UNREGISTERED");
  }
  for (const entry of payload.entries) {
    if (!registry.keys.has(entry.key)) {
      throw new Error(`POLICY_KEY_UNREGISTERED:${entry.key}`);
    }
    if (entry.component !== undefined && !registry.components.has(entry.component)) {
      throw new Error(`POLICY_COMPONENT_UNREGISTERED:${entry.component}`);
    }
    rejectSecrets(entry.value);
  }
}

function rejectSecrets(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (secretPattern.test(key)) throw new Error(`POLICY_SECRET_FORBIDDEN:${path}.${key}`);
    rejectSecrets(child, `${path}.${key}`);
  }
}

function assertApprovalPolicy(
  payload: PolicyArtifactPayload,
  approvals: readonly ApprovalEvidence[]
): void {
  const principals = new Set(approvals.map((approval) => approval.principalId));
  if (principals.size !== approvals.length) {
    throw new Error("POLICY_APPROVAL_PRINCIPALS_MUST_BE_DISTINCT");
  }
  const levels = new Set(payload.entries.map((entry) => entry.lockLevel));
  const has = (role: ApprovalEvidence["role"]): boolean =>
    approvals.some((approval) => approval.role === role);

  if (levels.has("security_policy")) {
    if (approvals.length < 2 || !has("security")) {
      throw new Error("POLICY_SECURITY_REQUIRES_TWO_PERSON_APPROVAL");
    }
    return;
  }
  if (levels.has("organization_policy")) {
    if (approvals.length < 2) {
      throw new Error("POLICY_ORGANIZATION_REQUIRES_TWO_PERSON_APPROVAL");
    }
    return;
  }
  if (levels.has("project_policy") && !has("project_governance")) {
    throw new Error("POLICY_PROJECT_GOVERNANCE_APPROVAL_REQUIRED");
  }
  if (levels.has("role_default") && !(has("business_owner") && has("publisher"))) {
    throw new Error("POLICY_ROLE_DEFAULT_REQUIRES_SEPARATION");
  }
  if (approvals.length === 0) {
    throw new Error("POLICY_APPROVAL_REQUIRED");
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
