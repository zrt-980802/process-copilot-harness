import { describe, expect, it, vi } from "vitest";
import { ExperienceSession } from "../src/experience-session";
import { experiencePolicy } from "../src/experience-policy";

const principal = { principal_id: "owner", tenant_id: "tenant", authorization_revision: 1 };
const health = { capabilities: { core: "configured", personal_workbench: "available", project_workbench: "available" } };
const availability = { principal_id: "owner", tenant_id: "tenant", expires_at: new Date(Date.now() + 60_000).toISOString(),
  catalog_revision: "c1", capabilities: [{ tool_release_id: "t1", availability_state: "AVAILABLE" }] };
const catalog = { connector: { capability_digest: "c1" }, tools: [{ tool_release_id: "t1", tool_definition_id: "project.read", compatibility: {}, risk_manifest: { action_class: "READ" } }] };

describe("FPI request ownership and stale response fencing", () => {
  it.each(["UNCONFIGURED", "UNAVAILABLE", "DISABLED"])("does not query hidden business paths in %s", async state => {
    const query = vi.fn(async () => ({ provider_bundle: { bundle_state: state }, ...health }));
    const session = new ExperienceSession(query as never, () => {});
    await session.refresh("token", principal);
    expect(query.mock.calls).toHaveLength(1);
    expect(experiencePolicy(session.snapshot).showProjectSurface).toBe(false);
  });
  it("stops at the directory for zero projects", async () => {
    const paths: string[] = [];
    const session = new ExperienceSession((async (path: string) => {
      paths.push(path); return path === "/health" ? health : path.endsWith("availability") ? availability : { items: [] };
    }) as never, () => {});
    await session.refresh("token", principal);
    expect(paths).toEqual(["/health", "/v1/workbench/capability-availability", "/v1/workbench/projects"]);
    expect(experiencePolicy(session.snapshot).state).toBe("zero-projects");
  });
  it("distinguishes current capability absence from outage and zero projects, without directory calls", async () => {
    const paths: string[] = [];
    const session = new ExperienceSession((async (path: string) => {
      paths.push(path); return path === "/health" ? health : { ...availability, capabilities: [] };
    }) as never, () => {});
    await session.refresh("token", principal);
    expect(experiencePolicy(session.snapshot).state).toBe("no-capabilities");
    expect(paths).toEqual(["/health", "/v1/workbench/capability-availability"]);
  });
  it("discards a late Catalog even if the transport ignores abort", async () => {
    let complete: ((value: unknown) => void) | undefined;
    const query = vi.fn(async (path: string) => path === "/health" ? health : path.endsWith("availability") ? availability
      : path.endsWith("projects") ? { items: [{ project_code: "OLD", project_name: "Old project" }] }
        : new Promise(resolve => { complete = resolve; }));
    const publish = vi.fn();
    const session = new ExperienceSession(query as never, publish);
    const first = session.refresh("token", principal);
    await vi.waitFor(() => expect(complete).toBeDefined());
    session.invalidate("unavailable");
    const invalid = session.snapshot;
    complete!(catalog); await first;
    expect(session.snapshot).toBe(invalid);
    expect(publish.mock.calls.at(-1)?.[0].projects).toEqual([]);
  });
  it("does not request Catalog for a revoked selection or use stale principal evidence", async () => {
    const paths: string[] = [];
    const session = new ExperienceSession((async (path: string) => {
      paths.push(path); return path === "/health" ? health : path.endsWith("availability") ? availability
        : { items: [{ project_code: "NEW", project_name: "Current project" }] };
    }) as never, () => {});
    await session.refresh("token", principal, "OLD");
    expect(session.snapshot.selectedProject).toBe("");
    expect(paths.some(path => path.includes("/catalog"))).toBe(false);
    paths.length = 0;
    await session.refresh("other-token", { ...principal, principal_id: "other" });
    expect(paths).toEqual(["/health", "/v1/workbench/capability-availability"]);
    expect(session.snapshot.phase).toBe("unavailable");
  });
});
