import { randomUUID } from "node:crypto";
import type {
  CreateAssignmentInput,
  RegisterRuntimeInput,
  RenewAssignmentInput,
  RuntimeRegistryRepository,
  TransitionAssignmentInput
} from "@pc/application";
import type {
  RuntimeCapabilityManifest,
  RuntimeHealthReport,
  RuntimeRecord,
  RuntimeRegistryState,
  SessionAssignment
} from "@pc/domain";
import { RuntimeRegistryError } from "@pc/domain";

const TERMINAL_ASSIGNMENT_STATES = new Set([
  "RELEASED",
  "EXPIRED",
  "REJECTED"
]);

const RUNTIME_TRANSITIONS: Record<RuntimeRegistryState, RuntimeRegistryState[]> = {
  PROVISIONING: ["STARTING", "FAILED", "TERMINATED"],
  STARTING: ["READY", "FAILED", "TERMINATED"],
  READY: ["IDLE", "ACTIVE", "DRAINING", "FAILED", "LOST", "TERMINATED"],
  IDLE: ["READY", "ACTIVE", "DRAINING", "FAILED", "LOST", "TERMINATED"],
  ACTIVE: ["READY", "IDLE", "DRAINING", "FAILED", "LOST", "TERMINATED"],
  DRAINING: ["TERMINATED", "FAILED", "LOST"],
  TERMINATED: [],
  FAILED: ["TERMINATED"],
  LOST: ["TERMINATED"]
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertVersion(actual: number, expected: number, subject: string): void {
  if (actual !== expected) {
    throw new RuntimeRegistryError(
      "PC_RUNTIME_CAS_CONFLICT",
      `${subject} version changed`,
      true,
      { expected, actual }
    );
  }
}

export class MemoryRuntimeRegistryRepository implements RuntimeRegistryRepository {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly manifests = new Map<string, RuntimeCapabilityManifest>();
  private readonly assignments = new Map<string, SessionAssignment>();
  private fencingSequence = 0n;

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  registerRuntime(
    input: RegisterRuntimeInput,
    now: string
  ): Promise<{ runtime: RuntimeRecord; manifest: RuntimeCapabilityManifest }> {
    const current = this.currentRuntime(input.runtime_id);
    if (current !== undefined && input.runtime_epoch < current.runtime_epoch) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_EPOCH_STALE",
        "Cannot register an older Runtime epoch"
      );
    }
    if (
      current !== undefined
      && input.expected_current_version !== undefined
    ) {
      assertVersion(
        current.version,
        input.expected_current_version,
        "RuntimeRecord"
      );
    }
    if (current !== undefined && input.runtime_epoch === current.runtime_epoch) {
      const updated: RuntimeRecord = {
        ...current,
        worker_pool_id: input.worker_pool_id,
        state: input.state ?? current.state,
        profile_bundle_digest: input.profile_bundle_digest,
        capability_manifest_digest: input.capability_manifest.manifest_digest,
        endpoint_url: input.endpoint_url,
        capacity: clone(input.capacity ?? current.capacity),
        health_summary: clone(input.health_summary ?? current.health_summary),
        last_heartbeat_at: now,
        version: current.version + 1
      };
      this.runtimes.set(this.runtimeKey(updated.runtime_id, updated.runtime_epoch), updated);
      this.manifests.set(
        this.runtimeKey(updated.runtime_id, updated.runtime_epoch),
        clone(input.capability_manifest)
      );
      return Promise.resolve({
        runtime: clone(updated),
        manifest: clone(input.capability_manifest)
      });
    }
    if (current !== undefined) {
      this.runtimes.set(
        this.runtimeKey(current.runtime_id, current.runtime_epoch),
        { ...current, current: false }
      );
    }
    const runtime: RuntimeRecord = {
      contract_name: "pc.runtime-record/1",
      contract_version: 1,
      runtime_id: input.runtime_id,
      runtime_epoch: input.runtime_epoch,
      tenant_id: input.tenant_id,
      owner_user_id: input.owner_user_id,
      worker_pool_id: input.worker_pool_id,
      state: input.state ?? "STARTING",
      profile_bundle_digest: input.profile_bundle_digest,
      capability_manifest_digest: input.capability_manifest.manifest_digest,
      endpoint_url: input.endpoint_url,
      capacity: clone(input.capacity ?? {}),
      health_summary: clone(input.health_summary ?? {}),
      created_at: now,
      last_heartbeat_at: now,
      version: 1,
      last_report_seq: -1,
      current: true
    };
    this.runtimes.set(this.runtimeKey(runtime.runtime_id, runtime.runtime_epoch), runtime);
    this.manifests.set(
      this.runtimeKey(runtime.runtime_id, runtime.runtime_epoch),
      clone(input.capability_manifest)
    );
    return Promise.resolve({
      runtime: clone(runtime),
      manifest: clone(input.capability_manifest)
    });
  }

  getCurrentRuntime(runtimeId: string): Promise<RuntimeRecord | undefined> {
    const runtime = this.currentRuntime(runtimeId);
    return Promise.resolve(runtime === undefined ? undefined : clone(runtime));
  }

  getRuntime(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<RuntimeRecord | undefined> {
    const runtime = this.runtimes.get(this.runtimeKey(runtimeId, runtimeEpoch));
    return Promise.resolve(runtime === undefined ? undefined : clone(runtime));
  }

  getCapabilityManifest(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<RuntimeCapabilityManifest | undefined> {
    const manifest = this.manifests.get(this.runtimeKey(runtimeId, runtimeEpoch));
    return Promise.resolve(manifest === undefined ? undefined : clone(manifest));
  }

  updateRuntimeState(input: {
    runtime_id: string;
    runtime_epoch: number;
    expected_version: number;
    state: RuntimeRegistryState;
    changed_at: string;
    drain_reason?: string;
    cleanup_report?: Record<string, unknown>;
  }): Promise<RuntimeRecord> {
    const runtime = this.requireRuntime(input.runtime_id, input.runtime_epoch);
    if (!runtime.current) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_EPOCH_STALE",
        "Cannot mutate a non-current Runtime epoch"
      );
    }
    assertVersion(runtime.version, input.expected_version, "RuntimeRecord");
    if (!RUNTIME_TRANSITIONS[runtime.state].includes(input.state)) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_STATE_TRANSITION_INVALID",
        `Runtime cannot transition from ${runtime.state} to ${input.state}`
      );
    }
    const updated: RuntimeRecord = {
      ...runtime,
      state: input.state,
      version: runtime.version + 1,
      ...(input.drain_reason === undefined
        ? {}
        : { drain_reason: input.drain_reason }),
      ...(input.cleanup_report === undefined
        ? {}
        : { cleanup_report: clone(input.cleanup_report) }),
      ...(input.state === "TERMINATED"
        ? { terminated_at: input.changed_at }
        : {})
    };
    this.runtimes.set(this.runtimeKey(runtime.runtime_id, runtime.runtime_epoch), updated);
    return Promise.resolve(clone(updated));
  }

  recordHeartbeat(
    report: RuntimeHealthReport,
    expectedVersion: number
  ): Promise<RuntimeRecord> {
    const runtime = this.requireRuntime(report.runtime_id, report.runtime_epoch);
    if (!runtime.current) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_EPOCH_STALE",
        "Heartbeat targets a non-current Runtime epoch"
      );
    }
    if (runtime.state === "TERMINATED") {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_TERMINATED",
        "Heartbeat cannot revive a terminated Runtime"
      );
    }
    assertVersion(runtime.version, expectedVersion, "RuntimeRecord");
    if (report.report_seq <= runtime.last_report_seq) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_HEARTBEAT_STALE",
        "Heartbeat sequence is stale"
      );
    }
    const updated: RuntimeRecord = {
      ...runtime,
      health_summary: clone(report) as unknown as Record<string, unknown>,
      last_heartbeat_at: report.observed_at,
      last_report_seq: report.report_seq,
      version: runtime.version + 1
    };
    this.runtimes.set(this.runtimeKey(runtime.runtime_id, runtime.runtime_epoch), updated);
    return Promise.resolve(clone(updated));
  }

  createPendingAssignment(
    input: CreateAssignmentInput,
    now: string,
    leaseExpiresAt: string
  ): Promise<SessionAssignment> {
    const current = this.currentAssignment(input.pc_session_id);
    if (current !== undefined && !TERMINAL_ASSIGNMENT_STATES.has(current.state)) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_ASSIGNMENT_CONFLICT",
        "Session already has a current non-terminal Assignment",
        true
      );
    }
    if (current !== undefined) {
      this.assignments.set(current.assignment_id, { ...current, current: false });
    }
    const generation = Math.max(
      0,
      ...[...this.assignments.values()]
        .filter((assignment) => assignment.pc_session_id === input.pc_session_id)
        .map((assignment) => assignment.assignment_generation)
    ) + 1;
    this.fencingSequence += 1n;
    const assignment: SessionAssignment = {
      contract_name: "pc.session-assignment-snapshot/1",
      contract_version: 1,
      assignment_id: randomUUID(),
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      pc_session_id: input.pc_session_id,
      runtime_id: input.runtime_id,
      runtime_epoch: input.runtime_epoch,
      assignment_generation: generation,
      fencing_token: this.fencingSequence.toString(),
      lease_id: randomUUID(),
      lease_expires_at: leaseExpiresAt,
      state: "PENDING",
      effective_profile_snapshot_id: input.effective_profile_snapshot_id,
      workspace_view_snapshot_id: input.workspace_view_snapshot_id,
      authorization_revision: input.authorization_revision,
      version: 1,
      current: true,
      assigned_at: now
    };
    this.assignments.set(assignment.assignment_id, assignment);
    return Promise.resolve(clone(assignment));
  }

  getCurrentAssignment(
    pcSessionId: string
  ): Promise<SessionAssignment | undefined> {
    const assignment = this.currentAssignment(pcSessionId);
    return Promise.resolve(assignment === undefined ? undefined : clone(assignment));
  }

  getAssignment(assignmentId: string): Promise<SessionAssignment | undefined> {
    const assignment = this.assignments.get(assignmentId);
    return Promise.resolve(assignment === undefined ? undefined : clone(assignment));
  }

  listRuntimeAssignments(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<SessionAssignment[]> {
    return Promise.resolve(
      [...this.assignments.values()]
        .filter((assignment) =>
          assignment.runtime_id === runtimeId
          && assignment.runtime_epoch === runtimeEpoch
        )
        .sort((left, right) => left.assigned_at.localeCompare(right.assigned_at))
        .map(clone)
    );
  }

  transitionAssignment(
    input: TransitionAssignmentInput
  ): Promise<SessionAssignment> {
    const assignment = this.requireAssignment(input.assignment_id);
    assertVersion(assignment.version, input.expected_version, "SessionAssignment");
    if (!input.expected_states.includes(assignment.state)) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_ASSIGNMENT_STATE_CONFLICT",
        `Assignment state is ${assignment.state}`
      );
    }
    const updated: SessionAssignment = {
      ...assignment,
      state: input.state,
      version: assignment.version + 1,
      ...(input.state === "ACTIVE" ? { accepted_at: input.changed_at } : {}),
      ...(input.state === "REVOKING" ? { revoked_at: input.changed_at } : {}),
      ...(input.state === "RELEASED" ? { released_at: input.changed_at } : {}),
      ...(input.state === "EXPIRED" ? { expired_at: input.changed_at } : {}),
      ...(input.state === "REJECTED"
        ? {
            rejected_at: input.changed_at,
            ...(input.rejection_code === undefined
              ? {}
              : { rejection_code: input.rejection_code })
          }
        : {})
    };
    this.assignments.set(updated.assignment_id, updated);
    return Promise.resolve(clone(updated));
  }

  renewAssignment(
    input: RenewAssignmentInput,
    renewedAt: string,
    leaseExpiresAt: string
  ): Promise<SessionAssignment> {
    const assignment = this.currentAssignment(input.pc_session_id);
    if (assignment === undefined) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_ASSIGNMENT_NOT_FOUND",
        "Session has no current Assignment"
      );
    }
    assertVersion(assignment.version, input.expected_version, "SessionAssignment");
    if (assignment.state !== "ACTIVE") {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE",
        `Assignment is not active: ${assignment.state}`
      );
    }
    if (
      assignment.runtime_id !== input.runtime_id
      || assignment.runtime_epoch !== input.runtime_epoch
      || assignment.assignment_generation !== input.assignment_generation
      || assignment.fencing_token !== input.fencing_token
    ) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_ASSIGNMENT_STALE",
        "Lease renewal coordinates are stale"
      );
    }
    if (Date.parse(leaseExpiresAt) <= Date.parse(assignment.lease_expires_at)) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_LEASE_NOT_EXTENDED",
        "Lease renewal must extend the current expiry"
      );
    }
    const updated: SessionAssignment = {
      ...assignment,
      lease_expires_at: leaseExpiresAt,
      last_renewed_at: renewedAt,
      version: assignment.version + 1
    };
    this.assignments.set(updated.assignment_id, updated);
    return Promise.resolve(clone(updated));
  }

  expireLeases(now: string): Promise<SessionAssignment[]> {
    const expired: SessionAssignment[] = [];
    for (const assignment of this.assignments.values()) {
      if (
        assignment.current
        && (assignment.state === "ACTIVE" || assignment.state === "REVOKING")
        && Date.parse(assignment.lease_expires_at) <= Date.parse(now)
      ) {
        const updated: SessionAssignment = {
          ...assignment,
          state: "EXPIRED",
          expired_at: now,
          version: assignment.version + 1
        };
        this.assignments.set(updated.assignment_id, updated);
        expired.push(clone(updated));
      }
    }
    return Promise.resolve(expired);
  }

  private runtimeKey(runtimeId: string, runtimeEpoch: number): string {
    return `${runtimeId}:${runtimeEpoch}`;
  }

  private currentRuntime(runtimeId: string): RuntimeRecord | undefined {
    return [...this.runtimes.values()].find((runtime) =>
      runtime.runtime_id === runtimeId && runtime.current
    );
  }

  private currentAssignment(pcSessionId: string): SessionAssignment | undefined {
    return [...this.assignments.values()].find((assignment) =>
      assignment.pc_session_id === pcSessionId && assignment.current
    );
  }

  private requireRuntime(runtimeId: string, runtimeEpoch: number): RuntimeRecord {
    const runtime = this.runtimes.get(this.runtimeKey(runtimeId, runtimeEpoch));
    if (runtime === undefined) {
      throw new RuntimeRegistryError("PC_RUNTIME_NOT_FOUND", "Runtime is not registered");
    }
    return runtime;
  }

  private requireAssignment(assignmentId: string): SessionAssignment {
    const assignment = this.assignments.get(assignmentId);
    if (assignment === undefined) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_ASSIGNMENT_NOT_FOUND",
        "Assignment is not registered"
      );
    }
    return assignment;
  }
}
