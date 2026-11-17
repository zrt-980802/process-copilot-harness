import { randomUUID } from "node:crypto";
import type { ProfileCapabilityRepository } from "@pc/application";
import type {
  EffectiveProfileSnapshot,
  ExpertProfileRelease,
  PluginRelease,
  ProfileAssignment,
  ProfileResolutionReport,
  ReleaseStatus,
  ToolRelease
} from "@pc/domain";
import { ProfileCapabilityError } from "@pc/domain";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameRelease<T extends { release_digest: string }>(
  current: T | undefined,
  incoming: T,
  subject: string
): T | undefined {
  if (current === undefined) return undefined;
  if (current.release_digest !== incoming.release_digest) {
    throw new ProfileCapabilityError(
      "PC_PROFILE_RELEASE_CONFLICT",
      `${subject} ID already contains different immutable content`
    );
  }
  return current;
}

export class MemoryProfileCapabilityRepository
implements ProfileCapabilityRepository {
  private readonly profiles = new Map<string, ExpertProfileRelease>();
  private readonly tools = new Map<string, ToolRelease>();
  private readonly plugins = new Map<string, PluginRelease>();
  private readonly assignments = new Map<string, ProfileAssignment>();
  private readonly reports = new Map<string, ProfileResolutionReport>();
  private readonly snapshots = new Map<string, EffectiveProfileSnapshot>();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  putProfileRelease(
    release: ExpertProfileRelease
  ): Promise<ExpertProfileRelease> {
    const current = sameRelease(
      this.profiles.get(release.profile_release_id),
      release,
      "Profile Release"
    );
    if (current !== undefined) return Promise.resolve(clone(current));
    this.profiles.set(release.profile_release_id, clone(release));
    return Promise.resolve(clone(release));
  }

  getProfileRelease(
    profileReleaseId: string
  ): Promise<ExpertProfileRelease | undefined> {
    const release = this.profiles.get(profileReleaseId);
    return Promise.resolve(release === undefined ? undefined : clone(release));
  }

  transitionProfileRelease(
    profileReleaseId: string,
    expectedStatus: ReleaseStatus,
    status: ReleaseStatus
  ): Promise<ExpertProfileRelease> {
    const release = this.profiles.get(profileReleaseId);
    if (release === undefined || release.status !== expectedStatus) {
      throw new ProfileCapabilityError(
        "PC_PROFILE_RELEASE_STATE_CONFLICT",
        "Profile Release status changed",
        true
      );
    }
    const updated = { ...release, status };
    this.profiles.set(profileReleaseId, updated);
    return Promise.resolve(clone(updated));
  }

  putToolRelease(release: ToolRelease): Promise<ToolRelease> {
    const current = sameRelease(
      this.tools.get(release.tool_release_id),
      release,
      "Tool Release"
    );
    if (current !== undefined) return Promise.resolve(clone(current));
    this.tools.set(release.tool_release_id, clone(release));
    return Promise.resolve(clone(release));
  }

  getToolRelease(toolReleaseId: string): Promise<ToolRelease | undefined> {
    const release = this.tools.get(toolReleaseId);
    return Promise.resolve(release === undefined ? undefined : clone(release));
  }

  putPluginRelease(release: PluginRelease): Promise<PluginRelease> {
    const current = sameRelease(
      this.plugins.get(release.plugin_release_id),
      release,
      "Plugin Release"
    );
    if (current !== undefined) return Promise.resolve(clone(current));
    this.plugins.set(release.plugin_release_id, clone(release));
    return Promise.resolve(clone(release));
  }

  getPluginRelease(
    pluginReleaseId: string
  ): Promise<PluginRelease | undefined> {
    const release = this.plugins.get(pluginReleaseId);
    return Promise.resolve(release === undefined ? undefined : clone(release));
  }

  assignProfile(
    principalId: string,
    profileReleaseId: string,
    now: string
  ): Promise<ProfileAssignment> {
    const current = [...this.assignments.values()].find((assignment) =>
      assignment.principal_id === principalId
      && assignment.profile_release_id === profileReleaseId
      && assignment.status === "active"
    );
    if (current !== undefined) return Promise.resolve(clone(current));
    const assignment: ProfileAssignment = {
      profile_assignment_id: randomUUID(),
      principal_id: principalId,
      profile_release_id: profileReleaseId,
      status: "active",
      revision: 1,
      assigned_at: now
    };
    this.assignments.set(assignment.profile_assignment_id, assignment);
    return Promise.resolve(clone(assignment));
  }

  getActiveProfileAssignment(
    principalId: string,
    profileReleaseId: string
  ): Promise<ProfileAssignment | undefined> {
    const assignment = [...this.assignments.values()].find((candidate) =>
      candidate.principal_id === principalId
      && candidate.profile_release_id === profileReleaseId
      && candidate.status === "active"
    );
    return Promise.resolve(
      assignment === undefined ? undefined : clone(assignment)
    );
  }

  saveResolution(
    report: ProfileResolutionReport,
    snapshot?: EffectiveProfileSnapshot
  ): Promise<void> {
    this.reports.set(report.resolution_report_id, clone(report));
    if (snapshot !== undefined) {
      this.snapshots.set(
        snapshot.effective_profile_snapshot_id,
        clone(snapshot)
      );
    }
    return Promise.resolve();
  }

  getEffectiveProfileSnapshot(
    snapshotId: string
  ): Promise<EffectiveProfileSnapshot | undefined> {
    const snapshot = this.snapshots.get(snapshotId);
    return Promise.resolve(snapshot === undefined ? undefined : clone(snapshot));
  }

  listSessionSnapshots(pcSessionId: string): Promise<EffectiveProfileSnapshot[]> {
    return Promise.resolve([...this.snapshots.values()].filter((snapshot) => snapshot.pc_session_id === pcSessionId).map(clone));
  }
}
