import type { SystemCapabilities, Workspace } from "./types";
import { sceneCapabilities, taskScene, type Project, type ProjectCatalog } from "./provider-view-adapter";

export interface CapabilityAvailability {
  provider_registration_id: string; principal_id?: string; tenant_id: string;
  catalog_revision: string; expires_at: string; evidence_refs: string[];
  capabilities: Array<{ tool_release_id?: string; availability_state: string }>;
}
export interface ExperienceSnapshot {
  generation: number;
  phase: "loading" | "standalone" | "unconfigured" | "unavailable" | "disabled" | "ready" | "denied" | "expired";
  principalId: string; tenantId: string; expiresAt: number;
  health?: SystemCapabilities | undefined; availability?: CapabilityAvailability | undefined;
  projects: Project[]; selectedProject: string; catalog?: ProjectCatalog | undefined; errorCode?: string | undefined;
}
export function emptyExperience(generation = 0, phase: ExperienceSnapshot["phase"] = "loading"): ExperienceSnapshot {
  return { generation, phase, principalId: "", tenantId: "", expiresAt: 0, projects: [], selectedProject: "" };
}

export function experiencePolicy(snapshot: ExperienceSnapshot, now = Date.now()) {
  const availability = snapshot.availability;
  const current = snapshot.phase === "ready" && snapshot.expiresAt > now && availability !== undefined
    && Date.parse(availability.expires_at) > now && availability.tenant_id === snapshot.tenantId
    && availability.principal_id === snapshot.principalId;
  const hasAvailability = current && availability.capabilities.some(item => item.availability_state === "AVAILABLE");
  const projectSelectionValid = !snapshot.selectedProject || snapshot.projects.some(project => project.project_code === snapshot.selectedProject);
  const catalogCurrent = !snapshot.catalog || snapshot.catalog.connector.capability_digest === availability?.catalog_revision;
  const showProjectSurface = !!hasAvailability && snapshot.projects.length > 0 && projectSelectionValid && catalogCurrent;
  const ids = new Set(availability?.capabilities.filter(item => item.availability_state === "AVAILABLE").map(item => item.tool_release_id));
  const tools = showProjectSurface && snapshot.catalog
    ? snapshot.catalog.tools.filter(tool => ids.has(tool.tool_release_id)) : [];
  const scene = sceneCapabilities(tools);
  const active = showProjectSurface && !!snapshot.selectedProject && !!snapshot.catalog;
  const visibleNavigationItems = ["home", "conversation"];
  if (showProjectSurface) visibleNavigationItems.push("overview");
  if (active && scene.engineering) visibleNavigationItems.push("engineering");
  if (active && scene.requirements) visibleNavigationItems.push("requirements");
  if (active && scene.ssts) visibleNavigationItems.push("workspace", "resources", "artifacts", "tasks");
  const state = snapshot.phase !== "ready" ? snapshot.phase : !current ? "expired"
    : !hasAvailability || !catalogCurrent ? "no-capabilities" : !snapshot.projects.length ? "zero-projects"
      : !projectSelectionValid ? "project-revoked" : "project";
  const allowedProjectRequests: string[] = [];
  if (showProjectSurface) allowedProjectRequests.push("catalog");
  if (active) allowedProjectRequests.push("task", "execution", "conversation", "chain", "tools");
  if (active && scene.projectData) allowedProjectRequests.push("project-data");
  if (active && scene.approvals) allowedProjectRequests.push("approvals");
  return { state, showProjectSurface, visibleNavigationItems, tools,
    showProviderStatus: ["unavailable", "disabled", "denied", "expired"].includes(state),
    showEngineeringExperience: active && scene.engineering, showSstsExperience: active && scene.ssts,
    showRequirements: active && scene.requirements, showApprovals: active && scene.approvals,
    showProviderIdentityDetails: active && tools.length > 0,
    projectSelectionValid, clearExternalStateReason: showProjectSurface ? undefined : state,
    allowedProjectRequests };
}
export type ExperienceProjection = ReturnType<typeof experiencePolicy>;

export function visibleTasks(tasks: readonly Workspace[], snapshot: ExperienceSnapshot, now = Date.now()): Workspace[] {
  const policy = experiencePolicy(snapshot, now);
  return tasks.filter(task => (taskScene(task.profile_release_id) !== "ssts" || policy.showSstsExperience)
    && (!task.project_code || policy.showProjectSurface && task.project_code === snapshot.selectedProject));
}
