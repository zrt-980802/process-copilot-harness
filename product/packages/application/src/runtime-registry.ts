import { randomUUID } from "node:crypto";
import type {
  AssignmentGuardDecision,
  AssignmentGuardInput,
  AssignmentAuthorityState,
  RuntimeCapabilityManifest,
  RuntimeHealthReport,
  RuntimeRecord,
  RuntimeRegistryState,
  SessionAssignment
} from "@pc/domain";
import {
  ProfileCapabilityError,
  RuntimeRegistryError,
  evaluateAssignmentGuard
} from "@pc/domain";
import type { EffectiveProfileAdmissionPort } from "./profile-capability.js";
import type { WorkspaceAdmissionPort } from "@pc/resource";
import { ResourceError } from "@pc/resource";
import type {
  RuntimeCommand,
  RuntimeCommandResult
} from "@pc/runtime-adapter";

export interface RegisterRuntimeInput {
  runtime_id: string;
  runtime_epoch: number;
  tenant_id: string;
  owner_user_id: string;
  worker_pool_id: string;
  state?: RuntimeRegistryState;
  profile_bundle_digest: string;
  endpoint_url: string;
  capacity?: Record<string, unknown>;
  health_summary?: Record<string, unknown>;
  capability_manifest: RuntimeCapabilityManifest;
  expected_current_version?: number;
}

export interface CreateAssignmentInput {
  tenant_id: string;
  user_id: string;
  pc_session_id: string;
  runtime_id: string;
  runtime_epoch: number;
  lease_duration_ms: number;
  effective_profile_snapshot_id: string;
  workspace_view_snapshot_id: string;
  authorization_revision: number;
}

export interface RenewAssignmentInput {
  pc_session_id: string;
  runtime_id: string;
  runtime_epoch: number;
  assignment_generation: number;
  fencing_token: string;
  expected_version: number;
  lease_duration_ms: number;
}

export interface TransitionAssignmentInput {
  assignment_id: string;
  expected_version: number;
  expected_states: AssignmentAuthorityState[];
  state: AssignmentAuthorityState;
  changed_at: string;
  rejection_code?: string;
}

export interface RuntimeRegistryRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  registerRuntime(
    input: RegisterRuntimeInput,
    now: string
  ): Promise<{ runtime: RuntimeRecord; manifest: RuntimeCapabilityManifest }>;
  getCurrentRuntime(runtimeId: string): Promise<RuntimeRecord | undefined>;
  getRuntime(runtimeId: string, runtimeEpoch: number): Promise<RuntimeRecord | undefined>;
  getCapabilityManifest(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<RuntimeCapabilityManifest | undefined>;
  updateRuntimeState(input: {
    runtime_id: string;
    runtime_epoch: number;
    expected_version: number;
    state: RuntimeRegistryState;
    changed_at: string;
    drain_reason?: string;
    cleanup_report?: Record<string, unknown>;
  }): Promise<RuntimeRecord>;
  recordHeartbeat(
    report: RuntimeHealthReport,
    expectedVersion: number
  ): Promise<RuntimeRecord>;
  createPendingAssignment(
    input: CreateAssignmentInput,
    now: string,
    leaseExpiresAt: string
  ): Promise<SessionAssignment>;
  getCurrentAssignment(pcSessionId: string): Promise<SessionAssignment | undefined>;
  getAssignment(assignmentId: string): Promise<SessionAssignment | undefined>;
  listRuntimeAssignments(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<SessionAssignment[]>;
  transitionAssignment(input: TransitionAssignmentInput): Promise<SessionAssignment>;
  renewAssignment(
    input: RenewAssignmentInput,
    renewedAt: string,
    leaseExpiresAt: string
  ): Promise<SessionAssignment>;
  expireLeases(now: string): Promise<SessionAssignment[]>;
}

export interface RuntimeCommandDispatcher {
  execute(runtime: RuntimeRecord, command: RuntimeCommand): Promise<RuntimeCommandResult>;
}

function positiveDuration(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RuntimeRegistryError(
      "PC_RUNTIME_REGISTRY_INVALID_ARGUMENT",
      `${field} must be a positive integer`,
      false,
      { field }
    );
  }
  return value;
}

function runtimeCommand(
  runtime: RuntimeRecord,
  assignment: SessionAssignment,
  commandType: RuntimeCommand["command_type"],
  commandId: string,
  payload: Record<string, unknown>,
  deadlineMs = 30_000
): RuntimeCommand {
  return {
    contract_name: "pc.runtime-command/1",
    contract_version: 1,
    command_id: commandId,
    command_type: commandType,
    deadline: new Date(Date.now() + deadlineMs).toISOString(),
    runtime_id: runtime.runtime_id,
    runtime_epoch: runtime.runtime_epoch,
    pc_session_id: assignment.pc_session_id,
    assignment_generation: assignment.assignment_generation,
    fencing_token: assignment.fencing_token,
    expected_state_version: String(assignment.version),
    payload
  };
}

function assignmentPayload(
  assignment: SessionAssignment,
  workspaceAdmission?: Awaited<
    ReturnType<WorkspaceAdmissionPort["assertWorkspaceAdmission"]>
  >
): Record<string, unknown> {
  return {
    assignment_id: assignment.assignment_id,
    tenant_id: assignment.tenant_id,
    user_id: assignment.user_id,
    lease_id: assignment.lease_id,
    lease_expires_at: assignment.lease_expires_at,
    assignment_state: assignment.state,
    effective_profile_snapshot_id: assignment.effective_profile_snapshot_id,
    workspace_view_snapshot_id: assignment.workspace_view_snapshot_id,
    authorization_revision: assignment.authorization_revision,
    authority_version: assignment.version,
    ...(workspaceAdmission === undefined
      ? {}
      : {
          workspace_materialization_id:
            workspaceAdmission.materialization_id,
          workspace_mount_ref: workspaceAdmission.mount_ref,
          workspace_materialization_expires_at:
            workspaceAdmission.expires_at
        })
  };
}

export class RuntimeRegistryService {
  constructor(
    private readonly repository: RuntimeRegistryRepository,
    private readonly dispatcher: RuntimeCommandDispatcher,
    private readonly now: () => Date = () => new Date(),
    private readonly profileAdmission?: EffectiveProfileAdmissionPort,
    private readonly workspaceAdmission?: WorkspaceAdmissionPort
  ) {}

  initialize(): Promise<void> {
    return this.repository.initialize();
  }

  close(): Promise<void> {
    return this.repository.close();
  }

  registerRuntime(input: RegisterRuntimeInput): Promise<{
    runtime: RuntimeRecord;
    manifest: RuntimeCapabilityManifest;
  }> {
    if (
      input.capability_manifest.runtime_id !== input.runtime_id
      || input.capability_manifest.runtime_epoch !== input.runtime_epoch
    ) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_CAPABILITY_IDENTITY_MISMATCH",
        "Capability Manifest identity does not match Runtime registration"
      );
    }
    if (input.capability_manifest.manifest_digest !== input.profile_bundle_digest
      && input.capability_manifest.profile_digest !== input.profile_bundle_digest) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_PROFILE_DIGEST_MISMATCH",
        "Runtime profile digest does not match the Capability Manifest"
      );
    }
    return this.repository.registerRuntime(input, this.now().toISOString());
  }

  async setRuntimeState(input: {
    runtime_id: string;
    runtime_epoch: number;
    expected_version: number;
    state: RuntimeRegistryState;
    drain_reason?: string;
    cleanup_report?: Record<string, unknown>;
  }): Promise<RuntimeRecord> {
    return this.repository.updateRuntimeState({
      ...input,
      changed_at: this.now().toISOString()
    });
  }

  recordHeartbeat(
    report: RuntimeHealthReport,
    expectedVersion: number
  ): Promise<RuntimeRecord> {
    return this.repository.recordHeartbeat(report, expectedVersion);
  }

  async assignSession(input: CreateAssignmentInput): Promise<{
    assignment: SessionAssignment;
    runtime_result: RuntimeCommandResult;
  }> {
    positiveDuration(input.lease_duration_ms, "lease_duration_ms");
    const runtime = await this.requireAdmittingRuntime(
      input.runtime_id,
      input.runtime_epoch
    );
    if (runtime.tenant_id !== input.tenant_id || runtime.owner_user_id !== input.user_id) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_OWNER_SCOPE_MISMATCH",
        "Runtime owner scope does not match the Session Assignment"
      );
    }
    if (this.profileAdmission !== undefined) {
      const manifest = await this.repository.getCapabilityManifest(
        runtime.runtime_id,
        runtime.runtime_epoch
      );
      if (manifest === undefined) {
        throw new RuntimeRegistryError(
          "PC_RUNTIME_CAPABILITY_MANIFEST_NOT_FOUND",
          "Runtime Capability Manifest is unavailable"
        );
      }
      try {
        await this.profileAdmission.assertRuntimeAdmission({
          effective_profile_snapshot_id:
            input.effective_profile_snapshot_id,
          runtime_manifest: manifest
        });
      } catch (error) {
        if (error instanceof ProfileCapabilityError) {
          throw new RuntimeRegistryError(
            error.code,
            error.message,
            error.retryable,
            error.details
          );
        }
        throw error;
      }
    }
    const workspaceAdmission = await this.assertWorkspaceAdmission({
      workspace_view_snapshot_id: input.workspace_view_snapshot_id,
      tenant_id: input.tenant_id,
      principal_id: input.user_id,
      pc_session_id: input.pc_session_id,
      authorization_revision: input.authorization_revision,
      runtime_id: input.runtime_id,
      runtime_epoch: input.runtime_epoch
    });
    const now = this.now();
    const pending = await this.repository.createPendingAssignment(
      input,
      now.toISOString(),
      new Date(now.getTime() + input.lease_duration_ms).toISOString()
    );
    const result = await this.dispatcher.execute(
      runtime,
      runtimeCommand(
        runtime,
        pending,
        "ASSIGN_SESSION",
        `assign:${pending.assignment_id}:${pending.version}`,
        assignmentPayload(pending, workspaceAdmission)
      )
    );
    if (!result.accepted || result.outcome_state !== "KNOWN_SUCCESS") {
      const rejected = await this.repository.transitionAssignment({
        assignment_id: pending.assignment_id,
        expected_version: pending.version,
        expected_states: ["PENDING"],
        state: "REJECTED",
        changed_at: this.now().toISOString(),
        rejection_code: result.adapter_error?.code ?? "PC_RUNTIME_ASSIGNMENT_REJECTED"
      });
      return { assignment: rejected, runtime_result: result };
    }
    const active = await this.repository.transitionAssignment({
      assignment_id: pending.assignment_id,
      expected_version: pending.version,
      expected_states: ["PENDING"],
      state: "ACTIVE",
      changed_at: this.now().toISOString()
    });
    const activationResult = await this.dispatcher.execute(
      runtime,
      runtimeCommand(
        runtime,
        active,
        "ASSIGN_SESSION",
        `activate:${active.assignment_id}:${active.version}`,
        assignmentPayload(active, workspaceAdmission)
      )
    );
    if (
      !activationResult.accepted
      || activationResult.outcome_state !== "KNOWN_SUCCESS"
    ) {
      const rejected = await this.repository.transitionAssignment({
        assignment_id: active.assignment_id,
        expected_version: active.version,
        expected_states: ["ACTIVE"],
        state: "REJECTED",
        changed_at: this.now().toISOString(),
        rejection_code:
          activationResult.adapter_error?.code
          ?? "PC_RUNTIME_ASSIGNMENT_ACTIVATION_SYNC_FAILED"
      });
      return { assignment: rejected, runtime_result: activationResult };
    }
    return { assignment: active, runtime_result: activationResult };
  }

  async renewAssignment(input: RenewAssignmentInput): Promise<{
    assignment: SessionAssignment;
    runtime_result: RuntimeCommandResult;
  }> {
    positiveDuration(input.lease_duration_ms, "lease_duration_ms");
    const now = this.now();
    const leaseExpiresAt = new Date(
      now.getTime() + input.lease_duration_ms
    ).toISOString();
    const renewed = await this.repository.renewAssignment(
      input,
      now.toISOString(),
      leaseExpiresAt
    );
    const runtime = await this.requireAdmittingRuntime(
      renewed.runtime_id,
      renewed.runtime_epoch
    );
    const result = await this.dispatcher.execute(
      runtime,
      runtimeCommand(
        runtime,
        renewed,
        "ASSIGN_SESSION",
        `renew:${renewed.assignment_id}:${renewed.version}`,
        assignmentPayload(renewed)
      )
    );
    return { assignment: renewed, runtime_result: result };
  }

  async revokeAssignment(input: {
    pc_session_id: string;
    expected_version: number;
    reason: string;
  }): Promise<{
    assignment: SessionAssignment;
    runtime_result: RuntimeCommandResult;
  }> {
    const current = await this.requireCurrentAssignment(input.pc_session_id);
    const revoking = await this.repository.transitionAssignment({
      assignment_id: current.assignment_id,
      expected_version: input.expected_version,
      expected_states: ["ACTIVE"],
      state: "REVOKING",
      changed_at: this.now().toISOString()
    });
    const runtime = await this.requireRuntime(
      revoking.runtime_id,
      revoking.runtime_epoch
    );
    const result = await this.dispatcher.execute(
      runtime,
      runtimeCommand(
        runtime,
        revoking,
        "REVOKE_SESSION",
        `revoke:${revoking.assignment_id}:${revoking.version}`,
        {
          ...assignmentPayload(revoking),
          reason: input.reason
        }
      )
    );
    if (!result.accepted || result.outcome_state !== "KNOWN_SUCCESS") {
      return { assignment: revoking, runtime_result: result };
    }
    const released = await this.repository.transitionAssignment({
      assignment_id: revoking.assignment_id,
      expected_version: revoking.version,
      expected_states: ["REVOKING"],
      state: "RELEASED",
      changed_at: this.now().toISOString()
    });
    return { assignment: released, runtime_result: result };
  }

  async dispatchSessionCommand(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    if (
      command.pc_session_id === undefined
      || command.assignment_generation === undefined
      || command.fencing_token === undefined
    ) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_ASSIGNMENT_COORDINATES_REQUIRED",
        "Session command requires Assignment coordinates"
      );
    }
    const assignment = await this.requireCurrentAssignment(command.pc_session_id);
    const runtime = await this.requireRuntime(command.runtime_id, command.runtime_epoch);
    const decision = evaluateAssignmentGuard(runtime, assignment, {
      kind: "STEP",
      runtime_id: command.runtime_id,
      runtime_epoch: command.runtime_epoch,
      pc_session_id: command.pc_session_id,
      assignment_generation: command.assignment_generation,
      fencing_token: command.fencing_token,
      ...(typeof command.payload.authorization_revision === "number"
        ? { authorization_revision: command.payload.authorization_revision }
        : {})
    }, this.now());
    if (!decision.allowed) {
      return {
        contract_name: "pc.runtime-command-result/1",
        contract_version: 1,
        command_id: command.command_id,
        accepted: false,
        committed: false,
        outcome_state: "KNOWN_FAILURE",
        runtime_observation: { guard: decision },
        adapter_error: {
          code: decision.code,
          message: decision.reason,
          retryable: decision.retryable
        },
        completed_at: this.now().toISOString()
      };
    }
    await this.assertWorkspaceAdmission({
      workspace_view_snapshot_id: assignment.workspace_view_snapshot_id,
      tenant_id: assignment.tenant_id,
      principal_id: assignment.user_id,
      pc_session_id: assignment.pc_session_id,
      authorization_revision: assignment.authorization_revision,
      runtime_id: assignment.runtime_id,
      runtime_epoch: assignment.runtime_epoch
    });
    return this.dispatcher.execute(runtime, command);
  }

  async evaluateGuard(input: AssignmentGuardInput): Promise<AssignmentGuardDecision> {
    const [runtime, assignment] = await Promise.all([
      this.repository.getCurrentRuntime(input.runtime_id),
      this.repository.getCurrentAssignment(input.pc_session_id)
    ]);
    const decision = evaluateAssignmentGuard(runtime, assignment, input, this.now());
    if (!decision.allowed || assignment === undefined) return decision;
    try {
      await this.assertWorkspaceAdmission({
        workspace_view_snapshot_id: assignment.workspace_view_snapshot_id,
        tenant_id: assignment.tenant_id,
        principal_id: assignment.user_id,
        pc_session_id: assignment.pc_session_id,
        authorization_revision: assignment.authorization_revision,
        runtime_id: assignment.runtime_id,
        runtime_epoch: assignment.runtime_epoch
      });
      return decision;
    } catch (error) {
      if (!(error instanceof RuntimeRegistryError)) throw error;
      return {
        ...decision,
        allowed: false,
        code: error.code,
        reason: error.message,
        retryable: error.retryable
      };
    }
  }

  evaluateToolGuard(
    input: Omit<AssignmentGuardInput, "kind">
  ): Promise<AssignmentGuardDecision> {
    return this.evaluateGuard({ ...input, kind: "TOOL" });
  }

  expireLeases(): Promise<SessionAssignment[]> {
    return this.repository.expireLeases(this.now().toISOString());
  }

  async expireSupersededAssignment(pcSessionId: string): Promise<SessionAssignment> {
    const assignment = await this.requireCurrentAssignment(pcSessionId);
    const runtime = await this.requireCurrentRuntime(assignment.runtime_id);
    if (runtime.runtime_epoch <= assignment.runtime_epoch) {
      throw new RuntimeRegistryError("PC_RUNTIME_EPOCH_NOT_SUPERSEDED", "Assignment Runtime has not been replaced");
    }
    return this.repository.transitionAssignment({ assignment_id: assignment.assignment_id,
      expected_version: assignment.version, expected_states: ["ACTIVE", "REVOKING"], state: "EXPIRED",
      changed_at: this.now().toISOString() });
  }

  async getRuntimeProjection(runtimeId: string): Promise<{
    runtime: RuntimeRecord;
    capability_manifest?: RuntimeCapabilityManifest;
    assignments: SessionAssignment[];
  }> {
    const runtime = await this.requireCurrentRuntime(runtimeId);
    const [capabilityManifest, assignments] = await Promise.all([
      this.repository.getCapabilityManifest(runtime.runtime_id, runtime.runtime_epoch),
      this.repository.listRuntimeAssignments(runtime.runtime_id, runtime.runtime_epoch)
    ]);
    return {
      runtime,
      ...(capabilityManifest === undefined
        ? {}
        : { capability_manifest: capabilityManifest }),
      assignments
    };
  }

  async getSessionProjection(pcSessionId: string): Promise<{
    assignment: SessionAssignment;
    runtime: RuntimeRecord;
    guard: AssignmentGuardDecision;
  }> {
    const assignment = await this.requireCurrentAssignment(pcSessionId);
    const runtime = await this.requireRuntime(
      assignment.runtime_id,
      assignment.runtime_epoch
    );
    return {
      assignment,
      runtime,
      guard: evaluateAssignmentGuard(runtime, assignment, {
        kind: "STEP",
        runtime_id: assignment.runtime_id,
        runtime_epoch: assignment.runtime_epoch,
        pc_session_id: assignment.pc_session_id,
        assignment_generation: assignment.assignment_generation,
        fencing_token: assignment.fencing_token,
        authorization_revision: assignment.authorization_revision
      }, this.now())
    };
  }

  private async requireCurrentRuntime(runtimeId: string): Promise<RuntimeRecord> {
    const runtime = await this.repository.getCurrentRuntime(runtimeId);
    if (runtime === undefined) {
      throw new RuntimeRegistryError("PC_RUNTIME_NOT_FOUND", "Runtime is not registered");
    }
    return runtime;
  }

  private async requireRuntime(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<RuntimeRecord> {
    const runtime = await this.repository.getRuntime(runtimeId, runtimeEpoch);
    if (runtime === undefined) {
      throw new RuntimeRegistryError("PC_RUNTIME_NOT_FOUND", "Runtime epoch is not registered");
    }
    return runtime;
  }

  private async requireAdmittingRuntime(
    runtimeId: string,
    runtimeEpoch: number
  ): Promise<RuntimeRecord> {
    const runtime = await this.requireCurrentRuntime(runtimeId);
    if (runtime.runtime_epoch !== runtimeEpoch) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_EPOCH_STALE",
        "Runtime epoch is not current"
      );
    }
    if (!["READY", "IDLE", "ACTIVE"].includes(runtime.state)) {
      throw new RuntimeRegistryError(
        runtime.state === "DRAINING"
          ? "PC_RUNTIME_DRAINING"
          : "PC_RUNTIME_NOT_READY",
        `Runtime is not admitting Session work: ${runtime.state}`,
        true
      );
    }
    return runtime;
  }

  private async requireCurrentAssignment(pcSessionId: string): Promise<SessionAssignment> {
    const assignment = await this.repository.getCurrentAssignment(pcSessionId);
    if (assignment === undefined) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_ASSIGNMENT_NOT_FOUND",
        "Session has no current Assignment"
      );
    }
    return assignment;
  }

  private async assertWorkspaceAdmission(
    input: Parameters<WorkspaceAdmissionPort["assertWorkspaceAdmission"]>[0]
  ): Promise<
    Awaited<ReturnType<WorkspaceAdmissionPort["assertWorkspaceAdmission"]>>
    | undefined
  > {
    if (this.workspaceAdmission === undefined) return undefined;
    try {
      return await this.workspaceAdmission.assertWorkspaceAdmission(input);
    } catch (error) {
      if (error instanceof ResourceError) {
        throw new RuntimeRegistryError(
          error.code,
          error.message,
          error.retryable,
          error.details
        );
      }
      throw error;
    }
  }
}

export class HttpRuntimeCommandDispatcher implements RuntimeCommandDispatcher {
  constructor(private readonly serviceSecret?: string) {}
  async execute(
    runtime: RuntimeRecord,
    command: RuntimeCommand
  ): Promise<RuntimeCommandResult> {
    let response: Response;
    try {
      response = await fetch(`${runtime.endpoint_url}/v1/runtime/commands`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.serviceSecret ? { "x-pc-runtime-secret": this.serviceSecret } : {}),
          "x-request-id": command.command_id
        },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(
          Math.max(1, Date.parse(command.deadline) - Date.now())
        )
      });
    } catch (error) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_TRANSPORT_LOST",
        "Runtime Host command transport failed",
        true,
        { cause: error instanceof Error ? error.message : String(error) }
      );
    }
    if (!response.ok) {
      throw new RuntimeRegistryError(
        "PC_RUNTIME_TRANSPORT_REJECTED",
        `Runtime Host returned HTTP ${response.status}`,
        response.status >= 500
      );
    }
    return response.json() as Promise<RuntimeCommandResult>;
  }
}

export function assignmentCommandId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}
