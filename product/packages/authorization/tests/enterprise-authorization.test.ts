import { describe, expect, it } from "vitest";
import {
  BASELINE_PAGE_KEYS_V1,
  EE_CLAW_V1_SOURCE_COMMIT,
  approvePolicyArtifactRelease,
  assertLegacyCompatibility,
  assertPersonalConfigurationWrite,
  authorizationEffect,
  canCreateAccessRequest,
  createPolicyArtifactRelease,
  decideLegacyPageAccess,
  defaultPermissionsForRoleEntry,
  projectWorkbenchCapabilities,
  publishPolicyArtifactRelease,
  relationFromMatrixSymbol,
  responsibilityAuthorizationEffect,
  type PolicyRegistry
} from "../src/index.js";

const registry: PolicyRegistry = {
  artifactKinds: new Set(["workbench_projection", "role_configuration_defaults"]),
  keys: new Set(["module.navigation", "configuration.security"]),
  components: new Set(["ModuleNavigation"]),
  codeRegistryRevision: "registry-1"
};

describe("ADR-0015 enterprise role boundaries", () => {
  it("keeps primary and secondary focus authorization-equivalent", () => {
    const primary = relationFromMatrixSymbol("fo", "architecture", "●");
    const secondary = relationFromMatrixSymbol("fo", "architecture", "◐");

    expect([...authorizationEffect(primary)]).toEqual(["read", "edit"]);
    expect([...authorizationEffect(secondary)]).toEqual(["read", "edit"]);
    expect(primary.focus).toBe("primary");
    expect(secondary.focus).toBe("secondary");
    expect(primary.capabilities).not.toContain("approve");
    expect(primary.capabilities).not.toContain("publish");
  });

  it("does not derive authorization from responsibility or requestability", () => {
    expect(
      responsibilityAuthorizationEffect({
        accountId: "account-1",
        responsibilityKey: "fo",
        scopeType: "project",
        scopeId: "project-1",
        status: "active"
      }).size
    ).toBe(0);
    const hidden = relationFromMatrixSymbol("fo", "future-module", "—");
    expect(canCreateAccessRequest(hidden)).toBe(true);
    expect([...authorizationEffect(hidden)]).toEqual([]);
  });

  it("intersects workbench projection with current authorization", () => {
    const relation = relationFromMatrixSymbol("fo", "architecture", "●");
    expect(projectWorkbenchCapabilities(relation, new Set(["read"]))).toEqual(["read"]);
  });

  it("rejects role-member writes above personal preference", () => {
    expect(() =>
      assertPersonalConfigurationWrite("project_policy", "role_member")
    ).toThrow("CONFIGURATION_LOCK_LEVEL_FORBIDS_WRITE");
  });
});

describe("ADR-0016 immutable policy artifact releases", () => {
  it("requires registered keys and components", () => {
    expect(() =>
      createPolicyArtifactRelease({
        artifactReleaseId: "release-1",
        artifactDefinitionId: "definition-1",
        artifactKind: "workbench_projection",
        releaseVersion: "1",
        schemaVersion: "1",
        payload: {
          entries: [{ key: "unknown", value: true }]
        },
        registry
      })
    ).toThrow("POLICY_KEY_UNREGISTERED");
  });

  it("requires distinct security approval and preserves immutable payload", () => {
    const validated = createPolicyArtifactRelease({
      artifactReleaseId: "release-2",
      artifactDefinitionId: "definition-2",
      artifactKind: "role_configuration_defaults",
      releaseVersion: "1",
      schemaVersion: "1",
      payload: {
        entries: [
          {
            key: "configuration.security",
            value: { enabled: true },
            lockLevel: "security_policy"
          }
        ]
      },
      registry
    });

    expect(() =>
      approvePolicyArtifactRelease(validated, [
        { principalId: "one", role: "security" }
      ])
    ).toThrow("POLICY_SECURITY_REQUIRES_TWO_PERSON_APPROVAL");

    const approved = approvePolicyArtifactRelease(validated, [
      { principalId: "one", role: "security" },
      { principalId: "two", role: "publisher" }
    ]);
    const published = publishPolicyArtifactRelease(approved, "prod");

    expect(published.lifecycleState).toBe("PUBLISHED");
    expect(Object.isFrozen(published.payload)).toBe(true);
    expect(() => {
      (published.payload.entries as Array<unknown>).push({});
    }).toThrow();
  });

  it("rejects secret-shaped payload fields", () => {
    expect(() =>
      createPolicyArtifactRelease({
        artifactReleaseId: "release-3",
        artifactDefinitionId: "definition-3",
        artifactKind: "workbench_projection",
        releaseVersion: "1",
        schemaVersion: "1",
        payload: {
          entries: [
            {
              key: "module.navigation",
              value: { access_token: "must-not-be-stored" },
              component: "ModuleNavigation"
            }
          ]
        },
        registry
      })
    ).toThrow("POLICY_SECRET_FORBIDDEN");
  });
});

describe("ADR-0017 Legacy V1 zero-migration compatibility", () => {
  it("freezes the default-open page set and excludes future pages", () => {
    expect(BASELINE_PAGE_KEYS_V1).toContain("page:unmapped");
    expect(BASELINE_PAGE_KEYS_V1).not.toContain("page:access-control");
    expect(
      decideLegacyPageAccess({
        pageKey: "page:future-module",
        effects: { "page:*": "allow" }
      })
    ).toEqual({ decision: "DENY", source: "deny" });
  });

  it("keeps deny above exact and baseline allow", () => {
    expect(
      decideLegacyPageAccess({
        pageKey: "page:architecture",
        effects: {
          "page:*": "allow",
          "page:architecture": "deny"
        }
      })
    ).toEqual({ decision: "DENY", source: "deny" });
  });

  it("keeps legacy and new role defaults separate", () => {
    expect(defaultPermissionsForRoleEntry("legacy-v1")).toEqual(["page:*"]);
    expect(defaultPermissionsForRoleEntry("enterprise-role")).toEqual([]);
  });

  it("enforces pinned source, request-time revocation, and zero migration", () => {
    expect(() =>
      assertLegacyCompatibility({
        sourceCommit: EE_CLAW_V1_SOURCE_COMMIT,
        baselinePageKeysVersion: "BASELINE_PAGE_KEYS_V1",
        revocationMode: "request_time",
        dataMigrationRequired: false
      })
    ).not.toThrow();
    expect(() =>
      assertLegacyCompatibility({
        sourceCommit: EE_CLAW_V1_SOURCE_COMMIT,
        baselinePageKeysVersion: "BASELINE_PAGE_KEYS_V1",
        revocationMode: "request_time",
        dataMigrationRequired: true
      })
    ).toThrow("LEGACY_DATA_MIGRATION_FORBIDDEN");
  });
});
