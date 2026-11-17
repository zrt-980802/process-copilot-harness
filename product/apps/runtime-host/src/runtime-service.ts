import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  DshBridgeControlError,
  normalizeDshEvent,
  projectConversation,
  type DshSessionEvent,
  type DshAssignmentGuardSnapshot,
  type DshGuardDecision,
  type DshRuntimePort,
  type PcEventEnvelope
} from "@pc/dsh-bridge";
import {
  RuntimeCommandError,
  assertAssignmentFence,
  assertP1B2Supported,
  assertRuntimeCommand,
  assignmentCoordinates,
  knownFailureResult,
  rejectedResult,
  successResult,
  unknownOutcomeResult,
  type AdapterError,
  type CleanupReport,
  type FinalizerResult,
  type PersistedRuntimeState,
  type RuntimeAssignment,
  type RuntimeCommand,
  type RuntimeCommandResult
} from "@pc/runtime-adapter";
import type { RuntimeHostConfig } from "./config.js";
import {
  EventSequenceConflictError,
  type RuntimeStateStore
} from "./state-store.js";
import type { RuntimeEventExporter } from "./event-exporter.js";

const MAX_COMPLETED_COMMANDS = 1_000;
const DEFAULT_FINALIZER_TIMEOUT_MS = 5_000;
const MAX_FINALIZER_TIMEOUT_MS = 60_000;

const ACTIVE_ASSIGNMENT_STATES = new Set([
  "ASSIGNED",
  "RUNNING",
  "IDLE",
  "NEEDS_RESUME",
  "FAILED"
]);

class FinalizerTimeoutError extends Error {
  constructor(readonly finalizerName: string, readonly timeoutMs: number) {
    super(`${finalizerName} timed out after ${timeoutMs}ms`);
    this.name = "FinalizerTimeoutError";
  }
}

function adapterError(
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>
): AdapterError {
  return {
    code,
    message,
    retryable,
    ...(details === undefined ? {} : { details })
  };
}

function dshSessionId(pcSessionId: string): string {
  return `session-${createHash("sha256").update(pcSessionId).digest("hex").slice(0, 32)}`;
}

function promptFrom(command: RuntimeCommand): string {
  const prompt = command.payload.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      "START_TURN payload.prompt must be a non-empty string"
    );
  }
  return prompt;
}

function integerPayload(
  command: RuntimeCommand,
  field: string,
  fallback: number,
  minimum: number
): number {
  const value = command.payload[field] ?? fallback;
  if (!Number.isInteger(value) || Number(value) < minimum) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      `${field} must be an integer >= ${minimum}`,
      false,
      { field }
    );
  }
  return Number(value);
}

function datePayload(
  command: RuntimeCommand,
  field: string,
  fallback: string
): string {
  const value = command.payload[field] ?? fallback;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      `${field} must be an ISO date-time`,
      false,
      { field }
    );
  }
  return value;
}

function stringPayload(
  command: RuntimeCommand,
  field: string,
  fallback: string
): string {
  const value = command.payload[field] ?? fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      `${field} must be a non-empty string`,
      false,
      { field }
    );
  }
  return value;
}

function optionalStringPayload(
  command: RuntimeCommand,
  field: string,
  fallback?: string
): string | undefined {
  const value = command.payload[field] ?? fallback;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      `${field} must be a non-empty string`,
      false,
      { field }
    );
  }
  return value;
}

function optionalDatePayload(
  command: RuntimeCommand,
  field: string,
  fallback?: string
): string | undefined {
  const value = optionalStringPayload(command, field, fallback);
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      `${field} must be an ISO date-time`,
      false,
      { field }
    );
  }
  return value;
}

function activeAssignment(assignment: RuntimeAssignment): boolean {
  return ACTIVE_ASSIGNMENT_STATES.has(assignment.status);
}

function assignmentAuthorityState(
  assignment: RuntimeAssignment
): DshAssignmentGuardSnapshot["state"] {
  if (assignment.authorityState !== undefined) return assignment.authorityState;
  if (assignment.status === "RELEASED") return "RELEASED";
  if (assignment.status === "EXPIRED") return "EXPIRED";
  if (assignment.status === "REVOKING") return "REVOKING";
  return "ACTIVE";
}

function authorityStatePayload(
  command: RuntimeCommand,
  fallback: DshAssignmentGuardSnapshot["state"]
): DshAssignmentGuardSnapshot["state"] {
  const value = command.payload.assignment_state ?? fallback;
  if (
    value !== "PENDING"
    && value !== "ACTIVE"
    && value !== "REVOKING"
    && value !== "RELEASED"
    && value !== "EXPIRED"
    && value !== "REJECTED"
  ) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      "assignment_state is not supported"
    );
  }
  return value;
}

function closingAssignment(assignment: RuntimeAssignment): boolean {
  return assignment.status === "REVOKING" || assignment.status === "RELEASED";
}

function bridgeError(error: DshBridgeControlError): AdapterError {
  return adapterError(`PC_DSH_${error.code}`, error.message, error.retryable);
}

export class RuntimeHostService {
  private readonly releasedSdkSessions = new Set<string>();
  private sdkRecycle: Promise<void> | undefined;

  private async prepareSdkResume(dshSessionId: string): Promise<void> {
    if (this.sdkRecycle) await this.sdkRecycle;
    if (!this.releasedSdkSessions.has(dshSessionId) || !this.dsh.recycle) return;
    if (this.runningSessions.size) {
      throw new RuntimeCommandError("PC_RUNTIME_RECYCLE_WAITING_FOR_IDLE", "Session restoration waits for other active turns to complete", true);
    }
    // The pinned SDK retains disposed Session records. Recycle only at quiescence,
    // then restore authority and require every surviving Session to resume explicitly.
    this.sdkRecycle = (async () => {
      await this.dsh.recycle!();
      this.liveSessions.clear();
      const state = this.requireState();
      for (const assignment of Object.values(state.assignments)) {
        if (!activeAssignment(assignment)) continue;
        if (assignment.turnCount > 0) assignment.status = "NEEDS_RESUME";
        await this.syncAssignmentGuard(assignment);
      }
      this.releasedSdkSessions.clear();
      await this.store.save(state);
    })();
    try { await this.sdkRecycle; } finally { this.sdkRecycle = undefined; }
  }
  private state: PersistedRuntimeState | undefined;
  private readonly liveSessions = new Set<string>();
  private readonly runningSessions = new Set<string>();
  private readonly revocationOperations = new Map<string, Promise<RuntimeCommandResult>>();
  private commandQueue: Promise<void> = Promise.resolve();
  private drainRequested = false;
  private drainOperation: Promise<RuntimeCommandResult> | undefined;
  private lastEventExportSuccessAt: string | undefined;
  private lastEventExportError: AdapterError | undefined;

  constructor(
    private readonly config: RuntimeHostConfig,
    private readonly dsh: DshRuntimePort,
    private readonly store: RuntimeStateStore,
    private readonly eventExporter?: RuntimeEventExporter
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.config.workspace, { recursive: true });
    await mkdir(this.config.dshHome, { recursive: true });
    this.state = await this.store.load(this.config);
    if (this.state.runtimeState === "TERMINATED") {
      this.drainRequested = true;
      this.state.bridgeState = "CLOSED";
      this.state.updatedAt = new Date().toISOString();
      await this.store.save(this.state);
      return;
    }
    this.state.runtimeState = "STARTING";
    this.state.bridgeState = "STARTING";
    this.state.updatedAt = new Date().toISOString();
    await this.store.save(this.state);
    try {
      await this.dsh.start();
      for (const assignment of Object.values(this.state.assignments)) {
        if (activeAssignment(assignment)) {
          await this.syncAssignmentGuard(assignment);
        }
      }
      this.state.bridgeState = "READY";
      this.state.runtimeState = Object.values(this.state.assignments).some(activeAssignment)
        ? "ASSIGNED"
        : "READY";
      this.state.lastBridgeSuccessAt = new Date().toISOString();
      delete this.state.lastBridgeError;
    } catch (error) {
      this.state.bridgeState = "FAILED";
      this.state.runtimeState = "DEGRADED";
      this.state.lastBridgeError = adapterError(
        "PC_DSH_INITIALIZE_FAILED",
        error instanceof Error ? error.message : String(error),
        true
      );
    }
    this.state.updatedAt = new Date().toISOString();
    await this.store.save(this.state);
  }

  execute(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    if (this.sdkRecycle) return this.sdkRecycle.then(() => this.execute(command));
    if (command.command_type === "DRAIN_RUNTIME") {
      if (this.drainOperation !== undefined) {
        return Promise.resolve(rejectedResult(
          command.command_id,
          adapterError(
            "PC_RUNTIME_DRAIN_IN_PROGRESS",
            "Runtime drain is already in progress",
            true
          ),
          this.health()
        ));
      }
      this.drainRequested = true;
      const operation = this.executeInternal(command);
      this.drainOperation = operation;
      void operation.then(
        () => this.finishDrainOperation(),
        () => this.finishDrainOperation()
      );
      return operation;
    }
    if (command.command_type === "REVOKE_SESSION") {
      const pcSessionId = command.pc_session_id;
      if (
        typeof pcSessionId === "string"
        && this.revocationOperations.has(pcSessionId)
      ) {
        return Promise.resolve(rejectedResult(
          command.command_id,
          adapterError(
            "PC_SESSION_REVOKE_IN_PROGRESS",
            "Session revoke is already in progress",
            true,
            { pc_session_id: pcSessionId }
          ),
          this.health()
        ));
      }
      const operation = this.executeInternal(command);
      if (typeof pcSessionId === "string" && pcSessionId !== "") {
        this.revocationOperations.set(pcSessionId, operation);
        void operation.then(
          () => this.revocationOperations.delete(pcSessionId),
          () => this.revocationOperations.delete(pcSessionId)
        );
      }
      return operation;
    }
    if (command.command_type === "CANCEL_TURN") {
      return this.executeInternal(command);
    }
    const operation = this.commandQueue.then(() => this.executeInternal(command));
    this.commandQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async executeInternal(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    const state = this.requireState();
    const completed = state.completedCommands[command.command_id];
    if (completed !== undefined) return completed;

    let result: RuntimeCommandResult;
    try {
      assertRuntimeCommand(command, this.config);
      assertP1B2Supported(command);
      this.assertRuntimeAdmission(command);
      result = await this.dispatch(command);
    } catch (error) {
      if (error instanceof RuntimeCommandError) {
        result = rejectedResult(command.command_id || "invalid-command", error.toAdapterError());
      } else if (error instanceof DshBridgeControlError) {
        const failure = bridgeError(error);
        result = command.command_type === "FLUSH_SESSION"
          || command.command_type === "CANCEL_TURN"
          || command.command_type === "REVOKE_SESSION"
          || command.command_type === "DRAIN_RUNTIME"
          ? unknownOutcomeResult(command.command_id, failure, this.health())
          : rejectedResult(command.command_id, failure, this.health());
      } else if (error instanceof EventSequenceConflictError) {
        result = knownFailureResult(
          command.command_id,
          adapterError(
            "PC_SESSION_EVENT_SEQUENCE_CONFLICT",
            error.message,
            false,
            {
              pc_session_id: error.pcSessionId,
              dsh_session_seq: error.dshSessionSequence
            }
          ),
          this.health()
        );
      } else {
        const failure = adapterError(
          "PC_DSH_SDK_FAILURE",
          error instanceof Error ? error.message : String(error),
          true
        );
        result = command.command_type === "START_TURN"
          ? unknownOutcomeResult(command.command_id, failure, this.health())
          : rejectedResult(command.command_id, failure, this.health());
      }
    }
    await this.recordResult(result);
    return result;
  }

  private async dispatch(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    switch (command.command_type) {
      case "QUERY_HEALTH":
        return successResult(command.command_id, this.health());
      case "QUERY_CAPABILITIES":
        return successResult(command.command_id, this.capabilities());
      case "ASSIGN_SESSION":
        return this.assign(command);
      case "REVOKE_SESSION":
        return this.revokeSession(command);
      case "START_TURN":
        return this.startTurn(command);
      case "CANCEL_TURN":
        return this.cancelTurn(command);
      case "RESUME_SESSION":
        return this.resume(command);
      case "FLUSH_SESSION":
        return this.flushSession(command);
      case "CATCH_UP_EVENTS":
        return this.catchUpEvents(command);
      case "DRAIN_RUNTIME":
        return this.drainRuntime(command);
      case "TERMINATE_RUNTIME":
        return this.terminate(command);
      default:
        throw new RuntimeCommandError(
          "PC_RUNTIME_COMMAND_UNSUPPORTED_P1A",
          `${command.command_type} requires the P1-B bridge`
        );
    }
  }

  private async assign(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    const state = this.requireState();
    if ((this.config.ownerUserId && command.payload.user_id !== this.config.ownerUserId)
      || (this.config.tenantId && command.payload.tenant_id !== this.config.tenantId)) {
      throw new RuntimeCommandError("PC_RUNTIME_OWNER_SCOPE_DENIED", "Assignment owner does not match the Runtime owner");
    }
    const coordinates = assignmentCoordinates(command);
    const leaseExpiresAt = datePayload(command, "lease_expires_at", command.deadline);
    if (Date.parse(leaseExpiresAt) <= Date.now()) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_LEASE_EXPIRED",
        "assignment lease must expire in the future"
      );
    }
    const existing = state.assignments[coordinates.pcSessionId];
    if (existing !== undefined) {
      if (
        existing.assignmentGeneration === coordinates.assignmentGeneration
        && existing.fencingToken === coordinates.fencingToken
      ) {
        if (!activeAssignment(existing)) {
          throw new RuntimeCommandError(
            "PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE",
            "inactive assignment cannot be renewed"
          );
        }
        const requestedAuthorityVersion = integerPayload(
          command,
          "authority_version",
          existing.authorityVersion ?? 1,
          0
        );
        if (requestedAuthorityVersion < (existing.authorityVersion ?? 1)) {
          throw new RuntimeCommandError(
            "PC_RUNTIME_AUTHORITY_VERSION_STALE",
            "Assignment authority version is stale"
          );
        }
        const currentLease = existing.leaseExpiresAt === undefined
          ? Number.NEGATIVE_INFINITY
          : Date.parse(existing.leaseExpiresAt);
        const requestedLease = Date.parse(leaseExpiresAt);
        const leaseRefreshed = requestedLease > currentLease;
        const requestedAuthorityState = authorityStatePayload(
          command,
          assignmentAuthorityState(existing)
        );
        const now = new Date().toISOString();
        const workspaceMaterializationId = optionalStringPayload(
          command,
          "workspace_materialization_id",
          existing.workspaceMaterializationId
        );
        const workspaceMountRef = optionalStringPayload(
          command,
          "workspace_mount_ref",
          existing.workspaceMountRef
        );
        const workspaceMaterializationExpiresAt = optionalDatePayload(
          command,
          "workspace_materialization_expires_at",
          existing.workspaceMaterializationExpiresAt
        );
        const updated: RuntimeAssignment = {
          ...existing,
          assignmentId: stringPayload(
            command,
            "assignment_id",
            existing.assignmentId ?? `local:${existing.pcSessionId}:${existing.assignmentGeneration}`
          ),
          tenantId: stringPayload(command, "tenant_id", existing.tenantId ?? "local-tenant"),
          userId: stringPayload(command, "user_id", existing.userId ?? "local-user"),
          ...(optionalStringPayload(
            command,
            "business_task_id",
            existing.businessTaskId
          ) === undefined
            ? {}
            : {
                businessTaskId: optionalStringPayload(
                  command,
                  "business_task_id",
                  existing.businessTaskId
                ) as string
              }),
          leaseId: stringPayload(
            command,
            "lease_id",
            existing.leaseId ?? `local-lease:${existing.pcSessionId}:${existing.assignmentGeneration}`
          ),
          authorityState: requestedAuthorityState,
          authorityVersion: requestedAuthorityVersion,
          authorizationRevision: integerPayload(
            command,
            "authorization_revision",
            existing.authorizationRevision ?? 1,
            0
          ),
          effectiveProfileSnapshotId: stringPayload(
            command,
            "effective_profile_snapshot_id",
            existing.effectiveProfileSnapshotId ?? "local-profile-snapshot"
          ),
          workspaceViewSnapshotId: stringPayload(
            command,
            "workspace_view_snapshot_id",
            existing.workspaceViewSnapshotId ?? "local-workspace-view"
          ),
          ...(workspaceMaterializationId === undefined
            ? {}
            : { workspaceMaterializationId }),
          ...(workspaceMountRef === undefined
            ? {}
            : { workspaceMountRef }),
          ...(workspaceMaterializationExpiresAt === undefined
            ? {}
            : { workspaceMaterializationExpiresAt }),
          leaseExpiresAt: leaseRefreshed
            ? leaseExpiresAt
            : existing.leaseExpiresAt ?? leaseExpiresAt,
          ...(leaseRefreshed ? { lastRenewedAt: now } : {}),
          updatedAt: now
        };
        const authorityChanged = requestedAuthorityState !== assignmentAuthorityState(existing)
          || requestedAuthorityVersion !== (existing.authorityVersion ?? 1)
          || updated.authorizationRevision !== existing.authorizationRevision;
        await this.assertWorkspaceMaterialization(updated);
        await this.syncAssignmentGuard(updated);
        state.assignments[coordinates.pcSessionId] = updated;
        state.updatedAt = now;
        await this.store.save(state);
        return successResult(command.command_id, {
          assignment: { ...updated },
          idempotent: !leaseRefreshed && !authorityChanged,
          lease_refreshed: leaseRefreshed,
          guard_synced: true
        });
      }
      if (coordinates.assignmentGeneration <= existing.assignmentGeneration) {
        throw new RuntimeCommandError(
          "PC_RUNTIME_ASSIGNMENT_GENERATION_STALE",
          "new assignment generation must be greater than the current generation"
        );
      }
      if (existing.status !== "RELEASED" && existing.status !== "EXPIRED") {
        throw new RuntimeCommandError(
          "PC_RUNTIME_ASSIGNMENT_CONFLICT",
          "current assignment must be released or expired before a higher generation is accepted"
        );
      }
    }
    const now = new Date().toISOString();
    const requestedDshId = command.payload.dsh_session_id;
    const authorityState = authorityStatePayload(command, "ACTIVE");
    const workspaceMaterializationId = optionalStringPayload(
      command,
      "workspace_materialization_id"
    );
    const workspaceMountRef = optionalStringPayload(
      command,
      "workspace_mount_ref"
    );
    const workspaceMaterializationExpiresAt = optionalDatePayload(
      command,
      "workspace_materialization_expires_at"
    );
    const assignment: RuntimeAssignment = {
      assignmentId: stringPayload(
        command,
        "assignment_id",
        `local:${coordinates.pcSessionId}:${coordinates.assignmentGeneration}`
      ),
      pcSessionId: coordinates.pcSessionId,
      dshSessionId: typeof requestedDshId === "string" && requestedDshId !== ""
        ? requestedDshId
        : dshSessionId(coordinates.pcSessionId),
      tenantId: stringPayload(command, "tenant_id", "local-tenant"),
      userId: stringPayload(command, "user_id", "local-user"),
      ...(optionalStringPayload(command, "business_task_id") === undefined
        ? {}
        : {
            businessTaskId: optionalStringPayload(
              command,
              "business_task_id"
            ) as string
          }),
      assignmentGeneration: coordinates.assignmentGeneration,
      fencingToken: coordinates.fencingToken,
      leaseId: stringPayload(
        command,
        "lease_id",
        `local-lease:${coordinates.pcSessionId}:${coordinates.assignmentGeneration}`
      ),
      authorityState,
      authorityVersion: integerPayload(command, "authority_version", 1, 0),
      authorizationRevision: integerPayload(
        command,
        "authorization_revision",
        1,
        0
      ),
      effectiveProfileSnapshotId: stringPayload(
        command,
        "effective_profile_snapshot_id",
        "local-profile-snapshot"
      ),
      workspaceViewSnapshotId: stringPayload(
        command,
        "workspace_view_snapshot_id",
        "local-workspace-view"
      ),
      ...(workspaceMaterializationId === undefined
        ? {}
        : { workspaceMaterializationId }),
      ...(workspaceMountRef === undefined
        ? {}
        : { workspaceMountRef }),
      ...(workspaceMaterializationExpiresAt === undefined
        ? {}
        : { workspaceMaterializationExpiresAt }),
      status: "ASSIGNED",
      turnCount: existing?.turnCount ?? 0,
      lastDshSequence: existing?.lastDshSequence ?? -1,
      lastRuntimeEventSequence: existing?.lastRuntimeEventSequence ?? -1,
      assignedAt: now,
      updatedAt: now,
      leaseExpiresAt,
      lastRenewedAt: now
    };
    await this.assertWorkspaceMaterialization(assignment);
    await this.syncAssignmentGuard(assignment);
    state.assignments[assignment.pcSessionId] = assignment;
    state.runtimeState = "ASSIGNED";
    state.updatedAt = now;
    await this.store.save(state);
    return successResult(command.command_id, {
      assignment: { ...assignment },
      guard_synced: true
    });
  }

  private async startTurn(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    if (this.sdkRecycle) await this.sdkRecycle;
    const state = this.requireState();
    const coordinates = assignmentCoordinates(command);
    const assignment = state.assignments[coordinates.pcSessionId];
    if (assignment === undefined) {
      throw new RuntimeCommandError("PC_RUNTIME_ASSIGNMENT_NOT_FOUND", "session is not assigned");
    }
    assertAssignmentFence(command, assignment);
    await this.assertAssignmentActive(assignment);
    await this.assertWorkspaceMaterialization(assignment);
    if (assignment.turnCount > 0 && !this.liveSessions.has(assignment.pcSessionId)) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_SESSION_RESUME_REQUIRED",
        "persisted session must be resumed before a new turn"
      );
    }
    assignment.status = "RUNNING";
    this.runningSessions.add(assignment.pcSessionId);
    assignment.updatedAt = new Date().toISOString();
    state.updatedAt = assignment.updatedAt;
    await this.store.save(state);

    try {
      const toolContext = command.payload.pc_tool_context;
      if (toolContext !== undefined) {
        if (this.dsh.configureTools === undefined || toolContext === null
          || typeof toolContext !== "object" || Array.isArray(toolContext)) {
          throw new RuntimeCommandError("PC_RUNTIME_TOOL_CONTEXT_INVALID", "Runtime Tool Provider is unavailable or context is invalid");
        }
        await this.dsh.configureTools(assignment.dshSessionId, toolContext as Record<string, unknown>);
      }
      const run = await this.dsh.run(assignment.dshSessionId, promptFrom(command));
      const operationId = optionalStringPayload(command, "operation_id");
      const businessTaskId = optionalStringPayload(
        command,
        "business_task_id",
        assignment.businessTaskId
      );
      const normalized: PcEventEnvelope[] = run.events.map((event) => {
        const runtimeEventSequence = state.nextRuntimeEventSequence++;
        return normalizeDshEvent(event, {
          runtimeId: state.runtimeId,
          runtimeEpoch: state.runtimeEpoch,
          pcSessionId: assignment.pcSessionId,
          dshSessionId: assignment.dshSessionId,
          ...(assignment.tenantId === undefined
            ? {}
            : { tenantId: assignment.tenantId }),
          ...(assignment.userId === undefined
            ? {}
            : { principalId: assignment.userId }),
          ...(businessTaskId === undefined
            ? {}
            : { businessTaskId }),
          ...(operationId === undefined
            ? {}
            : { operationId }),
          assignmentGeneration: assignment.assignmentGeneration,
          fencingToken: assignment.fencingToken,
          runtimeEventSequence
        });
      });
      await this.store.appendEvents(normalized);
      await this.exportSessionEvents(assignment.pcSessionId);
      this.liveSessions.add(assignment.pcSessionId);
      if (!closingAssignment(assignment)) {
        assignment.status = "IDLE";
      }
      assignment.turnCount += 1;
      assignment.lastFinalResponse = run.finalResponse;
      assignment.lastDshSequence = normalized.at(-1)?.dsh_session_seq ?? assignment.lastDshSequence;
      assignment.lastRuntimeEventSequence =
        normalized.at(-1)?.runtime_event_seq ?? assignment.lastRuntimeEventSequence;
      assignment.updatedAt = new Date().toISOString();
      this.updateBridgeHealth(state);
      state.updatedAt = assignment.updatedAt;
      await this.store.save(state);
      const eventCursor = `${assignment.dshSessionId}:${assignment.lastDshSequence}:${assignment.lastRuntimeEventSequence}`;
      const observation = {
        pc_session_id: assignment.pcSessionId,
        dsh_session_id: assignment.dshSessionId,
        turn_count: assignment.turnCount,
        final_response: run.finalResponse,
        event_count: normalized.length,
        notification_count: run.notificationCount
      };
      if (run.finishReason === "error") {
        return knownFailureResult(
          command.command_id,
          adapterError(
            `PC_DSH_${run.turnError?.code ?? "TURN_FAILED"}`,
            run.turnError?.message ?? "DSH turn failed",
            true
          ),
          observation,
          eventCursor
        );
      }
      if (run.finishReason === "aborted") {
        return knownFailureResult(
          command.command_id,
          adapterError(
            "PC_DSH_CANCELLED",
            "DSH turn was cancelled before completion",
            true
          ),
          observation,
          eventCursor
        );
      }
      if (run.finishReason !== undefined && run.finishReason !== "completed") {
        return knownFailureResult(
          command.command_id,
          adapterError(
            "PC_DSH_TURN_INCOMPLETE",
            `DSH turn ended with reason ${run.finishReason}`,
            true
          ),
          observation,
          eventCursor
        );
      }
      return successResult(command.command_id, {
        ...observation
      }, eventCursor);
    } catch (error) {
      if (!closingAssignment(assignment)) {
        assignment.status = "FAILED";
      }
      assignment.updatedAt = new Date().toISOString();
      if (state.runtimeState !== "DRAINING" && state.runtimeState !== "TERMINATED") {
        state.runtimeState = "DEGRADED";
      }
      state.updatedAt = assignment.updatedAt;
      await this.store.save(state);
      throw error;
    } finally {
      this.runningSessions.delete(assignment.pcSessionId);
    }
  }

  private async assertWorkspaceMaterialization(
    assignment: RuntimeAssignment
  ): Promise<void> {
    const materializationId = assignment.workspaceMaterializationId;
    const mountRef = assignment.workspaceMountRef;
    const expiresAt = assignment.workspaceMaterializationExpiresAt;
    if (
      materializationId === undefined
      && mountRef === undefined
      && expiresAt === undefined
    ) return;
    if (
      materializationId === undefined
      || mountRef !== `materialization:${materializationId}`
      || expiresAt === undefined
    ) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_WORKSPACE_MATERIALIZATION_INVALID",
        "Workspace Materialization coordinates are incomplete"
      );
    }
    if (Date.parse(expiresAt) <= Date.now()) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_WORKSPACE_MATERIALIZATION_EXPIRED",
        "Workspace Materialization has expired"
      );
    }
    if (this.config.materializationRoot === undefined) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_WORKSPACE_MATERIALIZATION_UNAVAILABLE",
        "Runtime Host has no configured Materialization root"
      );
    }
    const components = [
      assignment.tenantId,
      assignment.userId,
      assignment.pcSessionId,
      `${this.config.runtimeId}-${this.config.runtimeEpoch}`,
      materializationId
    ];
    if (
      components.some((component) =>
        component === undefined || !/^[a-zA-Z0-9_-]+$/u.test(component)
      )
    ) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_WORKSPACE_PATH_INVALID",
        "Workspace Materialization contains an invalid typed path component"
      );
    }
    const configuredRoot = resolve(this.config.materializationRoot);
    const rootStat = await lstat(configuredRoot);
    if (rootStat.isSymbolicLink()) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_WORKSPACE_SYMLINK_REJECTED",
        "Workspace Materialization root cannot be a symbolic link"
      );
    }
    const canonicalRoot = await realpath(configuredRoot);
    const target = resolve(canonicalRoot, ...(components as string[]));
    const targetRelative = relative(canonicalRoot, target);
    if (
      targetRelative === ".."
      || targetRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
      || isAbsolute(targetRelative)
    ) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_WORKSPACE_PATH_ESCAPE",
        "Workspace Materialization escapes the configured root"
      );
    }
    const targetStat = await lstat(target);
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_WORKSPACE_MATERIALIZATION_INVALID",
        "Workspace Materialization target is not a safe directory"
      );
    }
  }

  private async cancelTurn(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    const state = this.requireState();
    const coordinates = assignmentCoordinates(command);
    const assignment = state.assignments[coordinates.pcSessionId];
    if (assignment === undefined) {
      throw new RuntimeCommandError("PC_RUNTIME_ASSIGNMENT_NOT_FOUND", "session is not assigned");
    }
    assertAssignmentFence(command, assignment);
    await this.assertAssignmentActive(assignment);
    if (assignment.turnCount > 0 && !this.liveSessions.has(assignment.pcSessionId)) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_SESSION_RESUME_REQUIRED",
        "persisted session must be resumed before cancellation"
      );
    }
    const cancellation = await this.dsh.cancel(assignment.dshSessionId);
    this.updateBridgeHealth(state);
    state.updatedAt = new Date().toISOString();
    await this.store.save(state);
    return successResult(command.command_id, {
      pc_session_id: assignment.pcSessionId,
      dsh_session_id: assignment.dshSessionId,
      cancel_requested: cancellation.requested,
      was_running: cancellation.wasRunning
    });
  }

  private async flushSession(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    const state = this.requireState();
    const coordinates = assignmentCoordinates(command);
    const assignment = state.assignments[coordinates.pcSessionId];
    if (assignment === undefined) {
      throw new RuntimeCommandError("PC_RUNTIME_ASSIGNMENT_NOT_FOUND", "session is not assigned");
    }
    assertAssignmentFence(command, assignment);
    await this.assertAssignmentActive(assignment);
    if (assignment.turnCount === 0) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_SESSION_NOT_PERSISTED",
        "session has no completed turn to flush"
      );
    }
    if (!this.liveSessions.has(assignment.pcSessionId)) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_SESSION_RESUME_REQUIRED",
        "persisted session must be resumed before flush"
      );
    }
    const flushed = await this.dsh.flush(assignment.dshSessionId);
    if (!flushed.durable) {
      throw new RuntimeCommandError(
        "PC_DSH_FLUSH_NOT_DURABLE",
        "DSH did not confirm a durable Session prefix",
        true
      );
    }
    this.updateBridgeHealth(state);
    state.updatedAt = new Date().toISOString();
    await this.store.save(state);
    return successResult(
      command.command_id,
      {
        pc_session_id: assignment.pcSessionId,
        dsh_session_id: assignment.dshSessionId,
        durability: "DURABLE_DSH",
        durable_through_dsh_sequence: flushed.throughSequence
      },
      `${assignment.dshSessionId}:${flushed.throughSequence}:${assignment.lastRuntimeEventSequence}`
    );
  }

  private async catchUpEvents(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    const state = this.requireState();
    const coordinates = assignmentCoordinates(command);
    const assignment = state.assignments[coordinates.pcSessionId];
    if (assignment === undefined) {
      throw new RuntimeCommandError("PC_RUNTIME_ASSIGNMENT_NOT_FOUND", "session is not assigned");
    }
    assertAssignmentFence(command, assignment);
    await this.assertAssignmentActive(assignment);
    if (assignment.turnCount === 0) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_SESSION_NOT_PERSISTED",
        "session has no event history"
      );
    }
    if (!this.liveSessions.has(assignment.pcSessionId)) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_SESSION_RESUME_REQUIRED",
        "persisted session must be resumed before event catch-up"
      );
    }
    const afterSequence = integerPayload(command, "after_dsh_session_seq", -1, -1);
    const limit = integerPayload(command, "limit", 250, 1);
    if (limit > 1000) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_COMMAND_INVALID",
        "limit must be <= 1000",
        false,
        { field: "limit" }
      );
    }
    const history = await this.dsh.events(
      assignment.dshSessionId,
      afterSequence,
      limit
    );
    let previousSequence = afterSequence;
    for (const event of history.events) {
      if (!Number.isInteger(event.seq) || event.seq <= previousSequence) {
        throw new RuntimeCommandError(
          "PC_SESSION_EVENT_HISTORY_INVALID",
          "DSH catch-up history is not strictly ordered"
        );
      }
      previousSequence = event.seq;
    }
    const normalized = history.events.map((event) => normalizeDshEvent(event, {
      runtimeId: state.runtimeId,
      runtimeEpoch: state.runtimeEpoch,
      pcSessionId: assignment.pcSessionId,
      dshSessionId: assignment.dshSessionId,
      ...(assignment.tenantId === undefined
        ? {}
        : { tenantId: assignment.tenantId }),
      ...(assignment.userId === undefined
        ? {}
        : { principalId: assignment.userId }),
      ...(assignment.businessTaskId === undefined
        ? {}
        : { businessTaskId: assignment.businessTaskId }),
      assignmentGeneration: assignment.assignmentGeneration,
      fencingToken: assignment.fencingToken,
      runtimeEventSequence: state.nextRuntimeEventSequence++,
      durability: "DURABLE_DSH"
    }));
    const appended = await this.store.appendEvents(normalized);
    await this.exportSessionEvents(assignment.pcSessionId);
    if (normalized.length > 0) {
      assignment.lastDshSequence = Math.max(
        assignment.lastDshSequence,
        normalized.at(-1)?.dsh_session_seq ?? assignment.lastDshSequence
      );
      assignment.lastRuntimeEventSequence =
        normalized.at(-1)?.runtime_event_seq ?? assignment.lastRuntimeEventSequence;
    }
    assignment.updatedAt = new Date().toISOString();
    this.updateBridgeHealth(state);
    state.updatedAt = assignment.updatedAt;
    await this.store.save(state);
    const throughSequence = normalized.at(-1)?.dsh_session_seq ?? history.throughSequence;
    const cursor = `${assignment.dshSessionId}:${throughSequence}:${assignment.lastRuntimeEventSequence}`;
    return successResult(
      command.command_id,
      {
        pc_session_id: assignment.pcSessionId,
        dsh_session_id: assignment.dshSessionId,
        after_dsh_session_seq: afterSequence,
        through_dsh_session_seq: throughSequence,
        durability: "DURABLE_DSH",
        events: normalized,
        event_count: normalized.length,
        accepted_count: appended.accepted,
        duplicate_count: appended.duplicates,
        has_more: history.hasMore
      },
      cursor
    );
  }

  private async revokeSession(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    const state = this.requireState();
    const coordinates = assignmentCoordinates(command);
    const assignment = state.assignments[coordinates.pcSessionId];
    if (assignment === undefined) {
      throw new RuntimeCommandError("PC_RUNTIME_ASSIGNMENT_NOT_FOUND", "session is not assigned");
    }
    assertAssignmentFence(command, assignment);
    if (assignment.status === "RELEASED") {
      return successResult(command.command_id, {
        pc_session_id: assignment.pcSessionId,
        dsh_session_id: assignment.dshSessionId,
        released: true,
        idempotent: true,
        cleanup_report: assignment.cleanupReport
      });
    }
    if (assignment.status === "EXPIRED") {
      throw new RuntimeCommandError(
        "PC_RUNTIME_ASSIGNMENT_EXPIRED",
        "expired assignment cannot be revoked"
      );
    }
    if (assignment.status === "REVOKING") {
      throw new RuntimeCommandError(
        "PC_SESSION_REVOKE_IN_PROGRESS",
        "Session revoke is already in progress",
        true
      );
    }

    const reason = stringPayload(command, "reason", "CONTROL_PLANE_REVOKE");
    const timeoutMs = this.finalizerTimeoutMs(command);
    const wasRunning = this.runningSessions.has(assignment.pcSessionId);
    const now = new Date().toISOString();
    assignment.status = "REVOKING";
    assignment.authorityState = authorityStatePayload(command, "REVOKING");
    assignment.authorityVersion = integerPayload(
      command,
      "authority_version",
      (assignment.authorityVersion ?? 1) + 1,
      0
    );
    assignment.revokedAt = now;
    assignment.updatedAt = now;
    state.updatedAt = now;
    await this.syncAssignmentGuard(assignment);
    await this.store.save(state);

    const report = await this.cleanupSession(
      assignment,
      reason,
      timeoutMs,
      wasRunning
    );
    assignment.cleanupReport = report;
    state.runtimeState = Object.values(state.assignments).some(activeAssignment)
      ? "ASSIGNED"
      : "READY";
    state.updatedAt = report.completed_at;
    await this.store.save(state);

    const observation = {
      pc_session_id: assignment.pcSessionId,
      dsh_session_id: assignment.dshSessionId,
      released: true,
      cleanup_report: report
    };
    if (report.cleanup_state === "PARTIAL_FAILURE") {
      return knownFailureResult(
        command.command_id,
        adapterError(
          "PC_SESSION_RELEASE_INCOMPLETE",
          "Session execution authority was released with cleanup failures",
          true,
          { cleanup_report_id: report.report_id }
        ),
        observation
      );
    }
    return successResult(command.command_id, observation);
  }

  private async drainRuntime(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    const state = this.requireState();
    if (state.runtimeState === "TERMINATED" && state.cleanupReport !== undefined) {
      return successResult(command.command_id, {
        terminated: true,
        idempotent: true,
        cleanup_report: state.cleanupReport
      });
    }
    const reason = stringPayload(command, "reason", "CONTROL_PLANE_DRAIN");
    const timeoutMs = this.finalizerTimeoutMs(command);
    const startedAt = new Date().toISOString();
    state.runtimeState = "DRAINING";
    state.drainReason = reason;
    state.updatedAt = startedAt;
    await this.store.save(state);
    await Promise.allSettled(this.revocationOperations.values());

    const finalizers: FinalizerResult[] = [];
    const sessionIds: string[] = [];
    const assignments = Object.values(state.assignments)
      .filter((assignment) => assignment.status !== "RELEASED" && assignment.status !== "EXPIRED");
    for (const assignment of assignments) {
      sessionIds.push(assignment.pcSessionId);
      const wasRunning = this.runningSessions.has(assignment.pcSessionId);
      const revokedAt = new Date().toISOString();
      assignment.status = "REVOKING";
      assignment.authorityState = "REVOKING";
      assignment.authorityVersion = (assignment.authorityVersion ?? 1) + 1;
      assignment.revokedAt = revokedAt;
      assignment.updatedAt = revokedAt;
      await this.syncAssignmentGuard(assignment);
      const report = await this.cleanupSession(
        assignment,
        reason,
        timeoutMs,
        wasRunning
      );
      assignment.cleanupReport = report;
      finalizers.push(...report.finalizers);
    }

    finalizers.push(await this.runFinalizer(
      "runtime.executors.close",
      state.runtimeId,
      true,
      true,
      timeoutMs,
      async () => {
        await this.dsh.close();
        state.bridgeState = "CLOSED";
        return { bridge_state: state.bridgeState };
      }
    ));
    finalizers.push(await this.runFinalizer(
      "runtime.metrics-audit.flush",
      state.runtimeId,
      true,
      true,
      timeoutMs,
      async () => {
        state.updatedAt = new Date().toISOString();
        await this.store.save(state);
        return { persisted: true };
      }
    ));

    const completedAt = new Date().toISOString();
    const partialFailure = finalizers.some((result) =>
      result.status === "FAILED" || result.status === "TIMED_OUT"
    );
    const report: CleanupReport = {
      report_id: randomUUID(),
      runtime_id: state.runtimeId,
      runtime_epoch: state.runtimeEpoch,
      reason,
      cleanup_state: partialFailure ? "PARTIAL_FAILURE" : "CLEAN",
      resource_leak: partialFailure,
      final_event_sequence: state.nextRuntimeEventSequence - 1,
      session_ids: sessionIds,
      finalizers,
      started_at: startedAt,
      completed_at: completedAt
    };
    state.cleanupReport = report;
    state.runtimeState = "TERMINATED";
    state.bridgeState = "CLOSED";
    state.terminatedAt = completedAt;
    state.updatedAt = completedAt;
    await this.store.save(state);

    const observation = {
      terminated: true,
      cleanup_report: report
    };
    if (partialFailure) {
      return knownFailureResult(
        command.command_id,
        adapterError(
          "PC_RUNTIME_DRAIN_INCOMPLETE",
          "Runtime terminated with cleanup failures",
          true,
          { cleanup_report_id: report.report_id }
        ),
        observation
      );
    }
    return successResult(command.command_id, observation);
  }

  private async cleanupSession(
    assignment: RuntimeAssignment,
    reason: string,
    timeoutMs: number,
    wasRunning: boolean
  ): Promise<CleanupReport> {
    const state = this.requireState();
    const startedAt = new Date().toISOString();
    const finalizers: FinalizerResult[] = [];

    finalizers.push(await this.runFinalizer(
      "session.cancel",
      assignment.pcSessionId,
      false,
      true,
      timeoutMs,
      wasRunning
        ? async () => {
            const cancellation = await this.dsh.cancel(assignment.dshSessionId);
            return {
              requested: cancellation.requested,
              was_running: cancellation.wasRunning
            };
          }
        : undefined
    ));
    finalizers.push(await this.runFinalizer(
      "session.quiescence",
      assignment.pcSessionId,
      true,
      true,
      timeoutMs,
      wasRunning
        ? async () => {
            await this.waitForSessionQuiescence(assignment.pcSessionId, timeoutMs);
            return { quiescent: true };
          }
        : undefined
    ));

    const live = this.liveSessions.has(assignment.pcSessionId);
    finalizers.push(await this.runFinalizer(
      "session.flush",
      assignment.pcSessionId,
      true,
      true,
      timeoutMs,
      assignment.turnCount > 0 && live
        ? async () => {
            const flushed = await this.dsh.flush(assignment.dshSessionId);
            if (!flushed.durable) {
              throw new RuntimeCommandError(
                "PC_DSH_FLUSH_NOT_DURABLE",
                "DSH did not confirm a durable Session prefix",
                true
              );
            }
            return {
              durability: "DURABLE_DSH",
              durable_through_dsh_sequence: flushed.throughSequence
            };
          }
        : undefined
    ));
    finalizers.push(await this.runFinalizer(
      "session.release",
      assignment.pcSessionId,
      true,
      true,
      timeoutMs,
      live
        ? async () => {
            const released = await this.dsh.release(assignment.dshSessionId);
            if (!released.released || !released.durable) {
              throw new RuntimeCommandError(
                "PC_DSH_SESSION_RELEASE_INCOMPLETE",
                "DSH did not confirm a durable Session release",
                true
              );
            }
            this.liveSessions.delete(assignment.pcSessionId);
            this.releasedSdkSessions.add(assignment.dshSessionId);
            return {
              released: released.released,
              durable: released.durable,
              transport: "PC_BRIDGE_SESSION_RELEASE"
            };
          }
        : undefined
    ));
    finalizers.push(await this.runFinalizer(
      "assignment.release",
      assignment.pcSessionId,
      true,
      true,
      timeoutMs,
      async () => {
        const releasedAt = new Date().toISOString();
        assignment.status = "RELEASED";
        assignment.authorityState = "RELEASED";
        assignment.authorityVersion = (assignment.authorityVersion ?? 1) + 1;
        assignment.releasedAt = releasedAt;
        assignment.updatedAt = releasedAt;
        await this.syncAssignmentGuard(assignment);
        this.runningSessions.delete(assignment.pcSessionId);
        this.liveSessions.delete(assignment.pcSessionId);
        return {
          assignment_generation: assignment.assignmentGeneration,
          released_at: releasedAt
        };
      }
    ));

    const completedAt = new Date().toISOString();
    const partialFailure = finalizers.some((result) =>
      result.status === "FAILED" || result.status === "TIMED_OUT"
    );
    return {
      report_id: randomUUID(),
      runtime_id: state.runtimeId,
      runtime_epoch: state.runtimeEpoch,
      reason,
      cleanup_state: partialFailure ? "PARTIAL_FAILURE" : "CLEAN",
      resource_leak: partialFailure,
      final_event_sequence: state.nextRuntimeEventSequence - 1,
      session_ids: [assignment.pcSessionId],
      finalizers,
      started_at: startedAt,
      completed_at: completedAt
    };
  }

  private async runFinalizer(
    name: string,
    scope: string,
    critical: boolean,
    idempotent: boolean,
    timeoutMs: number,
    operation?: () => Promise<Record<string, unknown>>
  ): Promise<FinalizerResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    if (operation === undefined) {
      return {
        name,
        scope,
        critical,
        idempotent,
        status: "SKIPPED",
        started_at: startedAt,
        completed_at: startedAt,
        duration_ms: 0
      };
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const details = await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new FinalizerTimeoutError(name, timeoutMs)),
            timeoutMs
          );
        })
      ]);
      const completed = Date.now();
      return {
        name,
        scope,
        critical,
        idempotent,
        status: "SUCCEEDED",
        started_at: startedAt,
        completed_at: new Date(completed).toISOString(),
        duration_ms: completed - started,
        details
      };
    } catch (error) {
      const completed = Date.now();
      const timedOut = error instanceof FinalizerTimeoutError;
      return {
        name,
        scope,
        critical,
        idempotent,
        status: timedOut ? "TIMED_OUT" : "FAILED",
        started_at: startedAt,
        completed_at: new Date(completed).toISOString(),
        duration_ms: completed - started,
        error: error instanceof RuntimeCommandError
          ? error.toAdapterError()
          : adapterError(
              timedOut ? "PC_FINALIZER_TIMEOUT" : "PC_FINALIZER_FAILED",
              error instanceof Error ? error.message : String(error),
              true,
              { finalizer: name, scope }
            )
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async waitForSessionQuiescence(
    pcSessionId: string,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.runningSessions.has(pcSessionId)) {
      if (Date.now() >= deadline) {
        throw new FinalizerTimeoutError("session.quiescence", timeoutMs);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private finalizerTimeoutMs(command: RuntimeCommand): number {
    const requested = integerPayload(
      command,
      "finalizer_timeout_ms",
      DEFAULT_FINALIZER_TIMEOUT_MS,
      1
    );
    if (requested > MAX_FINALIZER_TIMEOUT_MS) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_COMMAND_INVALID",
        `finalizer_timeout_ms must be <= ${MAX_FINALIZER_TIMEOUT_MS}`,
        false,
        { field: "finalizer_timeout_ms" }
      );
    }
    return Math.max(1, Math.min(requested, Date.parse(command.deadline) - Date.now()));
  }

  private async resume(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    const state = this.requireState();
    const coordinates = assignmentCoordinates(command);
    const assignment = state.assignments[coordinates.pcSessionId];
    if (assignment === undefined) {
      throw new RuntimeCommandError("PC_RUNTIME_ASSIGNMENT_NOT_FOUND", "session is not assigned");
    }
    assertAssignmentFence(command, assignment);
    await this.assertAssignmentActive(assignment);
    if (assignment.turnCount === 0) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_SESSION_NOT_PERSISTED",
        "session has no completed turn to resume"
      );
    }
    await this.prepareSdkResume(assignment.dshSessionId);
    await this.assertAssignmentActive(assignment);
    if (assignment.status !== "RUNNING" && command.payload.pc_tool_context !== undefined && this.dsh.configureTools !== undefined) {
      await this.dsh.configureTools(assignment.dshSessionId,
        command.payload.pc_tool_context as Record<string, unknown>);
    }
    if (!this.liveSessions.has(assignment.pcSessionId)) await this.dsh.resume(assignment.dshSessionId);
    // Revocation runs outside the normal command queue so it can interrupt an
    // in-flight SDK call. Its terminal state must survive a late resume result.
    await this.assertAssignmentActive(assignment);
    this.liveSessions.add(assignment.pcSessionId);
    if (assignment.status !== "RUNNING") assignment.status = "IDLE";
    assignment.updatedAt = new Date().toISOString();
    this.updateBridgeHealth(state);
    state.updatedAt = assignment.updatedAt;
    await this.store.save(state);
    return successResult(command.command_id, {
      pc_session_id: assignment.pcSessionId,
      dsh_session_id: assignment.dshSessionId,
      resumed: true,
      turn_count: assignment.turnCount
    });
  }

  private async terminate(command: RuntimeCommand): Promise<RuntimeCommandResult> {
    const state = this.requireState();
    if (state.runtimeState === "TERMINATED") {
      return successResult(command.command_id, {
        terminated: true,
        idempotent: true,
        cleanup_report: state.cleanupReport
      });
    }
    await this.dsh.close();
    state.bridgeState = "CLOSED";
    state.runtimeState = "TERMINATED";
    state.terminatedAt = new Date().toISOString();
    state.updatedAt = state.terminatedAt;
    await this.store.save(state);
    return successResult(command.command_id, { terminated: true });
  }

  health(): Record<string, unknown> {
    const state = this.requireState();
    const bridge = this.dsh.health();
    return {
      service: "process-copilot-runtime-host",
      status: state.runtimeState === "TERMINATED"
        ? "terminated"
        : state.runtimeState === "DRAINING"
          ? "draining"
          : state.bridgeState === "READY" ? "ok" : "degraded",
      runtime_id: state.runtimeId,
      runtime_epoch: state.runtimeEpoch,
      runtime_state: state.runtimeState,
      bridge_state: state.bridgeState,
      active_sessions: Object.values(state.assignments)
        .filter((assignment) => assignment.status === "RUNNING").length,
      assigned_sessions: Object.values(state.assignments)
        .filter(activeAssignment).length,
      revoking_sessions: Object.values(state.assignments)
        .filter((assignment) => assignment.status === "REVOKING").length,
      released_sessions: Object.values(state.assignments)
        .filter((assignment) => assignment.status === "RELEASED").length,
      needs_resume: Object.values(state.assignments)
        .filter((assignment) => assignment.status === "NEEDS_RESUME").length,
      next_runtime_event_seq: state.nextRuntimeEventSequence,
      event_export: {
        configured: this.eventExporter !== undefined,
        state: this.eventExporter === undefined
          ? "NOT_CONFIGURED"
          : this.lastEventExportError === undefined
            ? "READY"
            : "DEGRADED",
        ...(this.lastEventExportSuccessAt === undefined
          ? {}
          : { last_success_at: this.lastEventExportSuccessAt }),
        ...(this.lastEventExportError === undefined
          ? {}
          : { last_error: this.lastEventExportError })
      },
      dsh: bridge,
      ...(state.cleanupReport === undefined ? {} : { cleanup_report: state.cleanupReport }),
      ...(state.lastBridgeError === undefined ? {} : { last_bridge_error: state.lastBridgeError })
    };
  }

  capabilities(): Record<string, unknown> {
    const state = this.requireState();
    return {
      runtime_id: state.runtimeId,
      runtime_epoch: state.runtimeEpoch,
      capability_manifest: {
        contract_name: "pc.runtime-capability-manifest/1", contract_version: 1,
        runtime_id: state.runtimeId, runtime_epoch: state.runtimeEpoch,
        dsh_version: "0.2.1-rc.3", bridge_protocol_versions: ["1.0"],
        profile_digest: this.config.profileDigest ?? "process-copilot-runtime-dev04",
        bundle_lock_digest: this.config.bundleLockDigest ?? "process-copilot-runtime-dev04",
        plugin_releases: ["pc-runtime-bridge:1", "pc-tool-provider:1"],
        agent_presets: ["effective-profile-scoped"], tool_provider_capabilities: ["pc-controlled-gateway"],
        persistence_capabilities: ["jsonl", "flush", "resume"],
        event_export_capabilities: ["pc.event-envelope/1", "catch-up"],
        approval_capabilities: ["durable-gateway-approval"], resource_capabilities: ["materialization"],
        limits: {}, generated_at: state.startedAt,
        manifest_digest: this.config.bundleLockDigest ?? "process-copilot-runtime-dev04"
      },
      stage: "DEV-08",
      dsh_version: "0.2.1-rc.3",
      bridge_protocol_version: "1.0",
      profile: this.config.profile,
      supported_commands: [
        "QUERY_HEALTH",
        "QUERY_CAPABILITIES",
        "ASSIGN_SESSION",
        "REVOKE_SESSION",
        "START_TURN",
        "CANCEL_TURN",
        "RESUME_SESSION",
        "FLUSH_SESSION",
        "CATCH_UP_EVENTS",
        "DRAIN_RUNTIME",
        "TERMINATE_RUNTIME"
      ],
      session_release: {
        supported: true,
        transport: "PC_BRIDGE_SESSION_RELEASE",
        durable: true
      },
      cleanup: {
        finalizer_aggregation: true,
        cleanup_report: true,
        idempotent_release: true
      },
      assignment_guard: {
        authority_cache: true,
        step_guard: true,
        monotonic_tool_guard: true,
        fail_closed: true
      },
      resource_workspace: {
        workspace_view_snapshot: true,
        opaque_materialization_handle: true,
        typed_path_resolution: true,
        ttl_guard: true
      },
      event_export: {
        contract: "pc.event-envelope/1",
        live_durability: "OBSERVED",
        catch_up_durability: "DURABLE_DSH",
        history_catch_up: true,
        deduplication_key: "event_id",
        push_ingestion: this.eventExporter !== undefined,
        retry_mode: "session_prefix_replay"
      }
    };
  }

  events(pcSessionId: string): Promise<PcEventEnvelope[]> {
    return this.store.readEvents(pcSessionId);
  }

  async conversation(pcSessionId: string) {
    const assignment = this.requireState().assignments[pcSessionId];
    if (!assignment || assignment.turnCount === 0) return { messages: [] };
    await this.assertAssignmentActive(assignment);
    if (!this.liveSessions.has(pcSessionId)) {
      throw new RuntimeCommandError("PC_RUNTIME_RESUME_REQUIRED", "Resume the assigned session before reading conversation");
    }
    const events: DshSessionEvent[] = [];
    let sequence = -1;
    for (;;) {
      const page = await this.dsh.events(assignment.dshSessionId, sequence, 1000);
      events.push(...page.events);
      if (!page.hasMore) break;
      if (page.throughSequence <= sequence) throw new Error("Conversation history cursor did not advance");
      sequence = page.throughSequence;
    }
    return { messages: projectConversation(events) };
  }

  private async exportSessionEvents(pcSessionId: string): Promise<void> {
    if (this.eventExporter === undefined) return;
    try {
      await this.eventExporter.export(await this.store.readEvents(pcSessionId));
      this.lastEventExportSuccessAt = new Date().toISOString();
      this.lastEventExportError = undefined;
    } catch (error) {
      this.lastEventExportError = adapterError(
        "PC_EVENT_EXPORT_FAILED",
        error instanceof Error ? error.message : String(error),
        true,
        { pc_session_id: pcSessionId }
      );
    }
  }

  assignmentGuard(
    pcSessionId: string,
    kind: "step" | "tool"
  ): Promise<DshGuardDecision> {
    const assignment = this.requireState().assignments[pcSessionId];
    if (assignment === undefined) {
      throw new RuntimeCommandError(
        "PC_RUNTIME_ASSIGNMENT_NOT_FOUND",
        "session is not assigned"
      );
    }
    return this.dsh.assignmentGuard(assignment.dshSessionId, kind);
  }

  async close(): Promise<void> {
    await this.dsh.close();
    if (this.state !== undefined) {
      this.state.bridgeState = "CLOSED";
      this.state.updatedAt = new Date().toISOString();
      await this.store.save(this.state);
    }
  }

  private updateBridgeHealth(state: PersistedRuntimeState): void {
    const health = this.dsh.health();
    state.bridgeState = health.state === "READY" ? "READY" : state.bridgeState;
    if (health.lastSuccessAt !== undefined) state.lastBridgeSuccessAt = health.lastSuccessAt;
    delete state.lastBridgeError;
    if (state.runtimeState !== "DRAINING" && state.runtimeState !== "TERMINATED") {
      state.runtimeState = Object.values(state.assignments).some(activeAssignment)
        ? "ASSIGNED"
        : "READY";
    }
  }

  private assertRuntimeAdmission(command: RuntimeCommand): void {
    const state = this.requireState();
    if (
      command.command_type === "QUERY_HEALTH"
      || command.command_type === "QUERY_CAPABILITIES"
      || command.command_type === "DRAIN_RUNTIME"
      || command.command_type === "TERMINATE_RUNTIME"
      || command.command_type === "CANCEL_TURN"
    ) {
      return;
    }
    if (state.runtimeState === "TERMINATED") {
      throw new RuntimeCommandError(
        "PC_RUNTIME_TERMINATED",
        "Runtime is terminated"
      );
    }
    if (this.drainRequested || state.runtimeState === "DRAINING") {
      throw new RuntimeCommandError(
        "PC_RUNTIME_DRAINING",
        "Runtime is draining and rejects new Session work"
      );
    }
  }

  private finishDrainOperation(): void {
    this.drainOperation = undefined;
    if (
      this.state?.runtimeState !== "DRAINING"
      && this.state?.runtimeState !== "TERMINATED"
    ) {
      this.drainRequested = false;
    }
  }

  private syncAssignmentGuard(
    assignment: RuntimeAssignment
  ): Promise<void> {
    return this.dsh.upsertAssignmentGuard({
      pcSessionId: assignment.pcSessionId,
      dshSessionId: assignment.dshSessionId,
      runtimeId: this.config.runtimeId,
      runtimeEpoch: this.config.runtimeEpoch,
      assignmentGeneration: assignment.assignmentGeneration,
      fencingToken: assignment.fencingToken,
      leaseExpiresAt: assignment.leaseExpiresAt ?? new Date(0).toISOString(),
      state: assignmentAuthorityState(assignment),
      authorizationRevision: assignment.authorizationRevision ?? 1,
      authorityVersion: assignment.authorityVersion ?? 1
    });
  }

  private async assertAssignmentActive(assignment: RuntimeAssignment): Promise<void> {
    const authorityState = assignmentAuthorityState(assignment);
    if (authorityState !== "ACTIVE") {
      throw new RuntimeCommandError(
        authorityState === "EXPIRED"
          ? "PC_RUNTIME_ASSIGNMENT_EXPIRED"
          : "PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE",
        `Assignment authority is not active: ${authorityState}`
      );
    }
    if (!activeAssignment(assignment)) {
      throw new RuntimeCommandError(
        assignment.status === "EXPIRED"
          ? "PC_RUNTIME_ASSIGNMENT_EXPIRED"
          : "PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE",
        `assignment is not active: ${assignment.status}`
      );
    }
    if (
      assignment.leaseExpiresAt !== undefined
      && Date.parse(assignment.leaseExpiresAt) <= Date.now()
    ) {
      const expiredAt = new Date().toISOString();
      assignment.status = "EXPIRED";
      assignment.authorityState = "EXPIRED";
      assignment.authorityVersion = (assignment.authorityVersion ?? 1) + 1;
      assignment.expiredAt = expiredAt;
      assignment.updatedAt = expiredAt;
      await this.syncAssignmentGuard(assignment);
      const state = this.requireState();
      state.updatedAt = expiredAt;
      await this.store.save(state);
      throw new RuntimeCommandError(
        "PC_RUNTIME_LEASE_EXPIRED",
        "assignment lease has expired"
      );
    }
  }

  private async recordResult(result: RuntimeCommandResult): Promise<void> {
    const state = this.requireState();
    state.completedCommands[result.command_id] = result;
    const commandIds = Object.keys(state.completedCommands);
    for (const commandId of commandIds.slice(0, Math.max(0, commandIds.length - MAX_COMPLETED_COMMANDS))) {
      delete state.completedCommands[commandId];
    }
    state.updatedAt = new Date().toISOString();
    await this.store.save(state);
  }

  private requireState(): PersistedRuntimeState {
    if (this.state === undefined) throw new Error("runtime service is not initialized");
    return this.state;
  }
}
