import {
  P1B2_SUPPORTED_COMMANDS,
  RUNTIME_COMMAND_TYPES,
  type AdapterError,
  type RuntimeAssignment,
  type RuntimeCommand,
  type RuntimeCommandResult,
  type RuntimeIdentity
} from "./types.js";

const commandTypes = new Set<string>(RUNTIME_COMMAND_TYPES);
const p1b2Commands = new Set<string>(P1B2_SUPPORTED_COMMANDS);

export class RuntimeCommandError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    retryable = false,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RuntimeCommandError";
    this.code = code;
    this.retryable = retryable;
    if (details !== undefined) this.details = details;
  }

  toAdapterError(): AdapterError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: this.details })
    };
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      `${field} must be a non-empty string`,
      false,
      { field }
    );
  }
}

function assertInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      `${field} must be a non-negative integer`,
      false,
      { field }
    );
  }
}

export function assertRuntimeCommand(
  command: RuntimeCommand,
  identity: RuntimeIdentity,
  now = new Date()
): void {
  if (command.contract_name !== "pc.runtime-command/1" || command.contract_version !== 1) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_CONTRACT_UNSUPPORTED",
      "runtime command contract must be pc.runtime-command/1"
    );
  }
  assertNonEmpty(command.command_id, "command_id");
  if (!commandTypes.has(command.command_type)) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_INVALID",
      `unknown runtime command type: ${String(command.command_type)}`
    );
  }
  assertNonEmpty(command.runtime_id, "runtime_id");
  assertInteger(command.runtime_epoch, "runtime_epoch");
  if (command.runtime_id !== identity.runtimeId) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_ID_MISMATCH",
      "command targets a different runtime",
      false,
      { expected: identity.runtimeId, actual: command.runtime_id }
    );
  }
  if (command.runtime_epoch !== identity.runtimeEpoch) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_EPOCH_STALE",
      "command runtime epoch is stale",
      false,
      { expected: identity.runtimeEpoch, actual: command.runtime_epoch }
    );
  }
  const deadline = Date.parse(command.deadline);
  if (!Number.isFinite(deadline)) {
    throw new RuntimeCommandError("PC_RUNTIME_COMMAND_INVALID", "deadline must be an ISO date-time");
  }
  if (deadline <= now.getTime()) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_DEADLINE_EXCEEDED",
      "runtime command deadline has expired"
    );
  }
  if (command.payload === null || typeof command.payload !== "object" || Array.isArray(command.payload)) {
    throw new RuntimeCommandError("PC_RUNTIME_COMMAND_INVALID", "payload must be an object");
  }
}

export function assertP1B2Supported(command: RuntimeCommand): void {
  if (!p1b2Commands.has(command.command_type)) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_COMMAND_UNSUPPORTED_P1B2",
      `${command.command_type} is not supported by the P1-B2 Runtime Host`,
      false,
      { stage: "P1-B2", command_type: command.command_type }
    );
  }
}

export function assignmentCoordinates(command: RuntimeCommand): {
  pcSessionId: string;
  assignmentGeneration: number;
  fencingToken: string;
} {
  assertNonEmpty(command.pc_session_id, "pc_session_id");
  assertInteger(command.assignment_generation, "assignment_generation");
  assertNonEmpty(command.fencing_token, "fencing_token");
  return {
    pcSessionId: command.pc_session_id,
    assignmentGeneration: command.assignment_generation,
    fencingToken: command.fencing_token
  };
}

export function assertAssignmentFence(
  command: RuntimeCommand,
  assignment: RuntimeAssignment
): void {
  const coordinates = assignmentCoordinates(command);
  if (coordinates.pcSessionId !== assignment.pcSessionId) {
    throw new RuntimeCommandError("PC_RUNTIME_ASSIGNMENT_MISMATCH", "assignment session mismatch");
  }
  if (coordinates.assignmentGeneration !== assignment.assignmentGeneration) {
    throw new RuntimeCommandError(
      "PC_RUNTIME_ASSIGNMENT_GENERATION_STALE",
      "assignment generation is stale",
      false,
      {
        expected: assignment.assignmentGeneration,
        actual: coordinates.assignmentGeneration
      }
    );
  }
  if (coordinates.fencingToken !== assignment.fencingToken) {
    throw new RuntimeCommandError("PC_RUNTIME_FENCE_STALE", "fencing token is stale");
  }
}

export function successResult(
  commandId: string,
  observation: Record<string, unknown>,
  eventCursor?: string
): RuntimeCommandResult {
  return {
    contract_name: "pc.runtime-command-result/1",
    contract_version: 1,
    command_id: commandId,
    accepted: true,
    committed: true,
    outcome_state: "KNOWN_SUCCESS",
    runtime_observation: observation,
    ...(eventCursor === undefined ? {} : { event_cursor: eventCursor }),
    completed_at: new Date().toISOString()
  };
}

export function rejectedResult(
  commandId: string,
  error: AdapterError,
  observation: Record<string, unknown> = {}
): RuntimeCommandResult {
  return {
    contract_name: "pc.runtime-command-result/1",
    contract_version: 1,
    command_id: commandId,
    accepted: false,
    committed: false,
    outcome_state: "KNOWN_FAILURE",
    runtime_observation: observation,
    adapter_error: error,
    completed_at: new Date().toISOString()
  };
}

export function knownFailureResult(
  commandId: string,
  error: AdapterError,
  observation: Record<string, unknown> = {},
  eventCursor?: string
): RuntimeCommandResult {
  return {
    contract_name: "pc.runtime-command-result/1",
    contract_version: 1,
    command_id: commandId,
    accepted: true,
    committed: true,
    outcome_state: "KNOWN_FAILURE",
    runtime_observation: observation,
    adapter_error: error,
    ...(eventCursor === undefined ? {} : { event_cursor: eventCursor }),
    completed_at: new Date().toISOString()
  };
}

export function unknownOutcomeResult(
  commandId: string,
  error: AdapterError,
  observation: Record<string, unknown> = {}
): RuntimeCommandResult {
  return {
    contract_name: "pc.runtime-command-result/1",
    contract_version: 1,
    command_id: commandId,
    accepted: true,
    committed: false,
    outcome_state: "OUTCOME_UNKNOWN",
    runtime_observation: observation,
    adapter_error: error,
    completed_at: new Date().toISOString()
  };
}
