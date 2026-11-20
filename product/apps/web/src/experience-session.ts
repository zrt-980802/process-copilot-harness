import type { Principal, SystemCapabilities } from "./types";
import { emptyExperience, experiencePolicy, type CapabilityAvailability, type ExperienceSnapshot } from "./experience-policy";
import { providerState, type Project, type ProjectCatalog } from "./provider-view-adapter";

type Query = <T>(path: string, token: string, signal: AbortSignal) => Promise<T>;

export class ExperienceSession {
  snapshot = emptyExperience();
  private controller = new AbortController();
  constructor(private readonly query: Query, private readonly publish: (snapshot: ExperienceSnapshot) => void,
    private readonly now: () => number = Date.now) {}

  invalidate(phase: ExperienceSnapshot["phase"] = "loading", errorCode?: string) {
    this.controller.abort();
    this.controller = new AbortController();
    this.snapshot = { ...emptyExperience(this.snapshot.generation + 1, phase), errorCode };
    this.publish(this.snapshot);
  }
  get signal() { return this.controller.signal; }
  isCurrent(generation: number) { return generation === this.snapshot.generation && !this.signal.aborted; }

  async refresh(token: string, principal: Principal, selectedProject = "") {
    this.invalidate();
    const { generation } = this.snapshot;
    const signal = this.signal;
    const query = <T>(path: string) => this.query<T>(path, token, signal);
    const commit = (value: Partial<ExperienceSnapshot>) => {
      if (!this.isCurrent(generation)) return false;
      this.snapshot = { ...this.snapshot, ...value }; this.publish(this.snapshot); return true;
    };
    try {
      const health = await query<SystemCapabilities>("/health");
      if (!this.isCurrent(generation)) return;
      const state = providerState(health);
      if (state !== "READY") {
        commit({ health, phase: state === "UNCONFIGURED" ? "unconfigured" : state === "DISABLED" ? "disabled" : "unavailable" }); return;
      }
      const availability = await query<CapabilityAvailability>("/v1/workbench/capability-availability");
      if (!this.isCurrent(generation)) return;
      const expiresAt = Math.min(Date.parse(availability.expires_at), health.provider_bundle ? Date.parse(health.provider_bundle.expires_at) : Infinity);
      if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || availability.principal_id !== principal.principal_id
        || availability.tenant_id !== principal.tenant_id
        || health.provider_bundle && (availability.catalog_revision !== health.provider_bundle.catalog_revision
          || !availability.evidence_refs.includes(`provider-bundle:${health.provider_bundle.bundle_generation}`))) {
        commit({ health, phase: "unavailable", errorCode: "PC_EXPERIENCE_EVIDENCE_STALE" }); return;
      }
      if (!availability.capabilities.some(item => item.availability_state === "AVAILABLE")) {
        commit({ health, availability, expiresAt, phase: "ready", principalId: principal.principal_id, tenantId: principal.tenant_id }); return;
      }
      const directory = await query<{ items: Project[] }>("/v1/workbench/projects");
      if (!this.isCurrent(generation)) return;
      if (!Array.isArray(directory.items) || directory.items.some(item => !item.project_code || !item.project_name)
        || new Set(directory.items.map(item => item.project_code)).size !== directory.items.length) throw new Error("PC_EXPERIENCE_DIRECTORY_INVALID");
      const project = selectedProject && !directory.items.some(item => item.project_code === selectedProject)
        ? "" : selectedProject || directory.items[0]?.project_code || "";
      const catalog = project ? await query<ProjectCatalog>(`/v1/workbench/catalog?project_code=${encodeURIComponent(project)}`) : undefined;
      if (!this.isCurrent(generation)) return;
      const next: ExperienceSnapshot = { generation, phase: "ready", principalId: principal.principal_id, tenantId: principal.tenant_id,
        health, availability, expiresAt, projects: directory.items, selectedProject: project, catalog };
      if (expiresAt <= this.now() || catalog && !experiencePolicy(next, this.now()).showProjectSurface) {
        commit({ phase: "unavailable", health, errorCode: "PC_EXPERIENCE_CATALOG_STALE" }); return;
      }
      commit(next);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      const code = error instanceof Error && "code" in error ? String(error.code) : "PC_EXPERIENCE_UNAVAILABLE";
      const denied = code.includes("DENIED") || error instanceof Error && "status" in error && error.status === 403;
      commit({ phase: denied ? "denied" : "unavailable", errorCode: code });
    }
  }
}
