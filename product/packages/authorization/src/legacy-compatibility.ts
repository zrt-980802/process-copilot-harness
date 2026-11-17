export const EE_CLAW_V1_SOURCE_COMMIT =
  "cefa7432f966e17b41c1638e128de652b934fd20";

export const BASELINE_PAGE_KEYS_V1 = Object.freeze([
  "page:architecture-configuration",
  "page:vehicle-platform",
  "page:requirements",
  "page:project-management",
  "page:projects",
  "page:dictionaries",
  "page:functions",
  "page:regulations",
  "page:architecture",
  "page:safety",
  "page:ota",
  "page:knowledge",
  "page:wiring-principle",
  "page:guide",
  "page:management-tools",
  "page:unmapped"
] as const);

export type LegacyDecisionSource =
  | "baseline"
  | "role"
  | "deny"
  | "system_admin";

export interface LegacyAuthorizationDecision {
  readonly decision: "ALLOW" | "DENY";
  readonly source: LegacyDecisionSource;
}

export interface LegacyCompatibilityDeclaration {
  readonly sourceCommit: string;
  readonly baselinePageKeysVersion: string;
  readonly revocationMode: string;
  readonly dataMigrationRequired: boolean;
}

export function decideLegacyPageAccess(input: {
  readonly pageKey: string;
  readonly effects: Readonly<Record<string, "allow" | "deny" | undefined>>;
  readonly isSystemAdmin?: boolean;
}): LegacyAuthorizationDecision {
  if (input.isSystemAdmin === true) {
    return { decision: "ALLOW", source: "system_admin" };
  }
  if (
    input.effects[input.pageKey] === "deny" ||
    input.effects["page:*"] === "deny"
  ) {
    return { decision: "DENY", source: "deny" };
  }
  if (input.effects[input.pageKey] === "allow") {
    return { decision: "ALLOW", source: "role" };
  }
  if (
    input.effects["page:*"] === "allow" &&
    (BASELINE_PAGE_KEYS_V1 as readonly string[]).includes(input.pageKey)
  ) {
    return { decision: "ALLOW", source: "baseline" };
  }
  return { decision: "DENY", source: "deny" };
}

export function defaultPermissionsForRoleEntry(
  entry: "legacy-v1" | "enterprise-role"
): readonly string[] {
  return entry === "legacy-v1" ? ["page:*"] : [];
}

export function assertLegacyCompatibility(
  declaration: LegacyCompatibilityDeclaration
): void {
  if (declaration.sourceCommit !== EE_CLAW_V1_SOURCE_COMMIT) {
    throw new Error("LEGACY_SOURCE_COMMIT_MISMATCH");
  }
  if (declaration.baselinePageKeysVersion !== "BASELINE_PAGE_KEYS_V1") {
    throw new Error("LEGACY_BASELINE_VERSION_UNSUPPORTED");
  }
  if (declaration.revocationMode !== "request_time") {
    throw new Error("LEGACY_REVOCATION_MUST_BE_REQUEST_TIME");
  }
  if (declaration.dataMigrationRequired) {
    throw new Error("LEGACY_DATA_MIGRATION_FORBIDDEN");
  }
}
