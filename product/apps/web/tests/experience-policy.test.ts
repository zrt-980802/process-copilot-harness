import { describe, expect, it } from "vitest";
import { experiencePolicy, visibleTasks, type ExperienceSnapshot } from "../src/experience-policy";

const now = Date.parse("2026-11-20T00:00:00Z");
const expires = new Date(now + 30_000).toISOString();
function ready(names: string[] = ["project.read"]): ExperienceSnapshot {
  return { generation: 1, phase: "ready", principalId: "owner", tenantId: "tenant", expiresAt: now + 30_000,
    health: { provider_mode: "ee-connected", capabilities: { core: "configured", personal_workbench: "available", ee_provider: "healthy", project_workbench: "available" } },
    availability: { provider_registration_id: "provider:eeclaw", principal_id: "owner", tenant_id: "tenant", catalog_revision: "catalog-1", expires_at: expires,
      evidence_refs: ["provider-bundle:epoch.1"], capabilities: names.map(name => ({ tool_release_id: name, availability_state: "AVAILABLE" })) },
    projects: [{ project_code: "P1", project_name: "Current project" }], selectedProject: "P1",
    catalog: { connector: { capability_digest: "catalog-1" }, tools: names.map(name => ({ tool_release_id: name, tool_definition_id: name,
      compatibility: {}, risk_manifest: { action_class: "READ" } })) } };
}

describe("FPI frozen experience matrix", () => {
  it.each(["standalone", "unconfigured", "unavailable", "disabled", "loading"])("keeps %s personal and ignores cached external arrays", phase => {
    const snapshot = { ...ready(["ee.list_ssts"]), phase } as ExperienceSnapshot;
    const policy = experiencePolicy(snapshot, now);
    expect(policy.showProjectSurface).toBe(false);
    expect(policy.showSstsExperience).toBe(false);
    expect(policy.showProviderIdentityDetails).toBe(false);
    expect(policy.visibleNavigationItems).toEqual(["home", "conversation"]);
    expect(policy.allowedProjectRequests).toEqual([]);
  });
  it("distinguishes READY zero projects from outage without revealing Catalog/scenario", () => {
    const snapshot = { ...ready(["ee.list_ssts"]), projects: [], catalog: undefined };
    const policy = experiencePolicy(snapshot, now);
    expect(policy.state).toBe("zero-projects");
    expect(policy.showProviderStatus).toBe(false);
    expect(policy.showProjectSurface).toBe(false);
    expect(policy.allowedProjectRequests).toEqual([]);
  });
  it("supports a generic project without engineering or SSTS assumptions", () => {
    const policy = experiencePolicy(ready(), now);
    expect(policy.showProjectSurface).toBe(true);
    expect(policy.visibleNavigationItems).toContain("overview");
    expect(policy.showSstsExperience).toBe(false);
    expect(policy.showEngineeringExperience).toBe(false);
    expect(policy.visibleNavigationItems).not.toContain("workspace");
  });
  it("assembles the existing engineering/SSTS scene only from current available tools", () => {
    const snapshot = ready(["ee.list_requirements", "ee.list_functions", "ee.list_ssts", "ee.get_ssts", "ee.get_function_ssts_matrix"]);
    expect(experiencePolicy(snapshot, now)).toMatchObject({ showEngineeringExperience: true, showSstsExperience: true, projectSelectionValid: true });
    snapshot.availability!.capabilities = [];
    expect(experiencePolicy(snapshot, now).showSstsExperience).toBe(false);
  });
  it.each(["expired", "catalog-replaced", "principal-replaced", "project-revoked"])("rejects %s evidence and removes project tasks", reason => {
    const snapshot = ready(["ee.list_ssts"]);
    if (reason === "expired") snapshot.expiresAt = now;
    if (reason === "catalog-replaced") snapshot.catalog!.connector.capability_digest = "other";
    if (reason === "principal-replaced") snapshot.availability!.principal_id = "other";
    if (reason === "project-revoked") snapshot.projects = [{ project_code: "P2", project_name: "Other" }];
    const policy = experiencePolicy(snapshot, now);
    expect(policy.showProjectSurface).toBe(false);
    expect(policy.clearExternalStateReason).toBeTruthy();
    const personal = { workspace_id: "personal", profile_release_id: "profile:conversation:personal:1" };
    const stale = { workspace_id: "old", project_code: "P1", profile_release_id: "profile:ee-ssts:1" };
    expect(visibleTasks([personal, stale] as never, snapshot, now).map(task => task.workspace_id)).toEqual(["personal"]);
  });
  it("does not revive a removed SSTS scene from historical task metadata", () => {
    const snapshot = ready();
    expect(visibleTasks([{ workspace_id: "old", project_code: "P1", profile_release_id: "profile:ee-ssts:1" }] as never, snapshot, now)).toEqual([]);
    expect(experiencePolicy(snapshot, now).showSstsExperience).toBe(false);
  });
});
