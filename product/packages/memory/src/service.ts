import { createHash, randomUUID } from "node:crypto";
import type {
  CaptureMemoryInput,
  MemoryAggregate,
  MemoryAuthorityAction,
  MemoryAuthorityEvent,
  MemoryAuthorityRepository,
  MemoryAuthorizationPort,
  MemoryCommandRecord,
  MemoryMutationResult,
  MemoryObject,
  MemoryObjectState,
  MemoryPolicyDecision,
  MemoryRequestContext,
  MemoryRevision,
  MemorySourceEvidence,
  MemorySourceEvidenceInput,
  RevokeMemoryResult,
  RevokeMemoryInput,
  ReviseMemoryInput
} from "./types.js";
import { MemoryError } from "./types.js";

const PERSONAL_KINDS = new Set([
  "EXPLICIT_PREFERENCE",
  "CONFIRMED_FACT",
  "ONGOING_GOAL",
  "DECISION_HISTORY"
]);
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu,
  /\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\b["']?\s*[:=]\s*["']?\S+/iu,
  /\b(?:sk|ghp|glpat)-[A-Za-z0-9_-]{16,}\b/u
];

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MemoryError("MEMORY_INVALID_CONTENT", "Memory content must be JSON-compatible");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new MemoryError("MEMORY_INVALID_CONTENT", "Memory content must be JSON-compatible");
}

export function memoryDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new MemoryError("MEMORY_INVALID_ARGUMENT", `${field} is required`, false, { field });
  return normalized;
}

function instant(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new MemoryError("MEMORY_INVALID_ARGUMENT", `${field} must be a valid instant`, false, { field });
  return new Date(parsed).toISOString();
}

function assertDeadline(deadline: string, now: Date): void {
  if (Date.parse(deadline) <= now.getTime()) throw new MemoryError("MEMORY_DEADLINE_EXCEEDED", "Memory command deadline has expired");
}

function assertContext(context: MemoryRequestContext): void {
  required(context.tenant_id, "tenant_id");
  required(context.principal_id, "principal_id");
  required(context.actor_principal_id, "actor_principal_id");
  required(context.request_context_ref, "request_context_ref");
  if (!Number.isInteger(context.authorization_revision) || context.authorization_revision < 0) {
    throw new MemoryError("MEMORY_STALE_AUTHORIZATION", "Authorization revision is invalid");
  }
  if (!Number.isInteger(context.policy_revision) || context.policy_revision < 1) {
    throw new MemoryError("MEMORY_INVALID_ARGUMENT", "Policy revision is invalid");
  }
}

function assertNoSecret(value: unknown): void {
  const serialized = canonical(value);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new MemoryError("MEMORY_SENSITIVE_CONTENT_REJECTED", "Secret-like content cannot be stored as Memory");
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryAuthorityService {
  constructor(
    private readonly repository: MemoryAuthorityRepository,
    private readonly authorization: MemoryAuthorizationPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  initialize(): Promise<void> {
    return this.repository.initialize();
  }

  close(): Promise<void> {
    return this.repository.close();
  }

  async capture(input: CaptureMemoryInput): Promise<MemoryMutationResult> {
    assertContext(input.context);
    const authorization = await this.assertAuthorized(input.context, "memory.capture");
    const now = this.now();
    assertDeadline(input.deadline, now);
    this.assertPersonalOwner(input.context, input.owner_principal_id, input.scope_request.scope_type, input.scope_request.scope_id);
    if (!PERSONAL_KINDS.has(input.memory_kind)) {
      throw new MemoryError("MEMORY_INVALID_STATE", "Memory kind is not enabled for Personal Memory MVP");
    }
    if (input.source_evidence_inputs.length === 0) {
      throw new MemoryError("MEMORY_EVIDENCE_REQUIRED", "Memory requires SourceEvidence");
    }
    assertNoSecret(input.content);
    required(input.retrieval_summary, "retrieval_summary");
    assertNoSecret(input.retrieval_summary);
    const explicit = input.capture_mode === "EXPLICIT_USER_SAVE";
    const objectState: MemoryObjectState = explicit ? "CONFIRMED" : "CANDIDATE";
    if (input.expected_result_state !== objectState) {
      throw new MemoryError("MEMORY_INVALID_STATE", "Capture mode cannot produce the requested state");
    }
    if (!explicit && !input.capture_mode.endsWith("CANDIDATE")) {
      throw new MemoryError("MEMORY_INVALID_STATE", "Automatic capture can only create Candidate Memory");
    }
    const payloadDigest = memoryDigest(this.capturePayload(input));
    const replay = await this.repository.replayCommand({
      tenant_id: input.context.tenant_id,
      principal_id: input.context.principal_id,
      idempotency_key: required(input.idempotency_key, "idempotency_key"),
      command_kind: "CAPTURE",
      payload_digest: payloadDigest
    });
    if (replay !== undefined) return replay;
    const createdAt = now.toISOString();
    const validFrom = instant(input.valid_from, "valid_from");
    const validTo = input.valid_to === undefined ? undefined : instant(input.valid_to, "valid_to");
    if (validTo !== undefined && validTo <= validFrom) {
      throw new MemoryError("MEMORY_INVALID_ARGUMENT", "valid_to must be later than valid_from");
    }
    const memoryId = `mem_${randomUUID()}`;
    const revisionId = `mrev_${randomUUID()}`;
    const evidence = input.source_evidence_inputs.map((source) =>
      this.evidence(input.context, source, createdAt)
    );
    const revision: MemoryRevision = {
      revision_id: revisionId,
      memory_id: memoryId,
      revision_no: 1,
      revision_state: "CURRENT",
      structured_content: clone(input.content),
      retrieval_summary: input.retrieval_summary.trim(),
      source_evidence_ids: evidence.map((item) => item.source_evidence_id),
      confidence: explicit ? 1 : 0.5,
      valid_from: validFrom,
      ...(validTo === undefined ? {} : { valid_to: validTo }),
      recorded_at: createdAt,
      created_by_principal_id: input.context.principal_id,
      creation_reason: input.capture_mode,
      content_digest: memoryDigest(input.content),
      schema_revision: 1
    };
    const object: MemoryObject = {
      memory_id: memoryId,
      tenant_id: input.context.tenant_id,
      owner_principal_id: input.context.principal_id,
      subject_principal_id: input.context.principal_id,
      scope_type: "PERSONAL" as const,
      scope_id: input.context.principal_id,
      memory_kind: input.memory_kind,
      sensitivity: input.sensitivity,
      object_state: objectState,
      current_revision_id: revisionId,
      policy_revision: input.context.policy_revision,
      created_at: createdAt,
      updated_at: createdAt,
      version: 1
    };
    const command = this.command(input.context, input.command_id, input.idempotency_key, "CAPTURE", payloadDigest, {
      memory_id: memoryId, revision_id: revisionId, object_version: 1, object
    }, createdAt);
    const decision = this.decision(input.context, "CAPTURE", object.memory_id, revisionId, [...evidence.map((item) => item.source_evidence_id), ...authorization.evidence_refs], createdAt, [explicit ? "explicit_owner_save" : "candidate_only", ...authorization.reason_codes]);
    const event = this.event(object, revision, command.command_id, objectState === "CONFIRMED" ? "CONFIRMED" : "CREATED", createdAt);
    return this.repository.capture({ command, object, revision, source_evidence: evidence, policy_decision: decision, authority_event: event });
  }

  async revise(input: ReviseMemoryInput): Promise<MemoryMutationResult> {
    assertContext(input.context);
    const authorization = await this.assertAuthorized(input.context, "memory.revise");
    const now = this.now();
    assertDeadline(input.deadline, now);
    required(input.memory_id, "memory_id");
    if (input.new_source_evidence_inputs.length === 0) throw new MemoryError("MEMORY_EVIDENCE_REQUIRED", "Revision requires SourceEvidence");
    assertNoSecret(input.new_content);
    required(input.retrieval_summary, "retrieval_summary");
    assertNoSecret(input.retrieval_summary);
    const changedAt = now.toISOString();
    const validFrom = instant(input.valid_from, "valid_from");
    const validTo = input.valid_to === undefined ? undefined : instant(input.valid_to, "valid_to");
    if (validTo !== undefined && validTo <= validFrom) throw new MemoryError("MEMORY_INVALID_ARGUMENT", "valid_to must be later than valid_from");
    const payloadDigest = memoryDigest(this.revisePayload(input));
    const replay = await this.repository.replayCommand({
      tenant_id: input.context.tenant_id,
      principal_id: input.context.principal_id,
      idempotency_key: required(input.idempotency_key, "idempotency_key"),
      command_kind: "REVISE",
      payload_digest: payloadDigest
    });
    if (replay !== undefined) return replay;
    const aggregate = await this.requireOwned(input.memory_id, input.context);
    if (!["CONFIRMED", "PUBLISHED"].includes(aggregate.object.object_state)) {
      throw new MemoryError("MEMORY_INVALID_STATE", "Only active confirmed or published Memory can be revised");
    }
    const revisionId = `mrev_${randomUUID()}`;
    const evidence = input.new_source_evidence_inputs.map((source) => this.evidence(input.context, source, changedAt));
    const previousRevision: MemoryRevision = { ...aggregate.current_revision, revision_state: "SUPERSEDED" };
    const revision: MemoryRevision = {
      revision_id: revisionId,
      memory_id: aggregate.object.memory_id,
      revision_no: aggregate.current_revision.revision_no + 1,
      revision_state: "CURRENT",
      structured_content: clone(input.new_content),
      retrieval_summary: required(input.retrieval_summary, "retrieval_summary"),
      source_evidence_ids: evidence.map((item) => item.source_evidence_id),
      confidence: 1,
      valid_from: validFrom,
      ...(validTo === undefined ? {} : { valid_to: validTo }),
      recorded_at: changedAt,
      created_by_principal_id: input.context.principal_id,
      creation_reason: input.revision_reason,
      supersedes_revision_id: aggregate.current_revision.revision_id,
      content_digest: memoryDigest(input.new_content),
      schema_revision: 1
    };
    const object = {
      ...aggregate.object,
      ...(input.sensitivity === undefined ? {} : { sensitivity: input.sensitivity }),
      current_revision_id: revisionId,
      policy_revision: input.context.policy_revision,
      updated_at: changedAt,
      version: aggregate.object.version + 1
    };
    const command = this.command(input.context, input.command_id, input.idempotency_key, "REVISE", payloadDigest, {
      memory_id: object.memory_id, revision_id: revisionId, object_version: object.version, object
    }, changedAt);
    const decision = this.decision(input.context, "REVISE", object.memory_id, revisionId, [...evidence.map((item) => item.source_evidence_id), ...authorization.evidence_refs], changedAt, [input.revision_reason.toLowerCase(), ...authorization.reason_codes]);
    return this.repository.revise({
      command,
      expected_object_version: input.expected_object_version,
      expected_current_revision_id: input.expected_current_revision_id,
      object,
      previous_revision: previousRevision,
      revision,
      source_evidence: evidence,
      policy_decision: decision,
      authority_event: this.event(object, revision, command.command_id, "REVISED", changedAt)
    });
  }

  async revoke(input: RevokeMemoryInput): Promise<RevokeMemoryResult> {
    assertContext(input.context);
    const authorization = await this.assertAuthorized(input.context, "memory.revoke");
    const now = this.now();
    assertDeadline(input.deadline, now);
    required(input.memory_id, "memory_id");
    required(input.revoke_reason, "revoke_reason");
    const payloadDigest = memoryDigest(this.revokePayload(input));
    const replay = await this.repository.replayCommand({
      tenant_id: input.context.tenant_id,
      principal_id: input.context.principal_id,
      idempotency_key: required(input.idempotency_key, "idempotency_key"),
      command_kind: "REVOKE",
      payload_digest: payloadDigest
    });
    if (replay !== undefined) {
      return {
        object: clone(replay.aggregate.object),
        revoked_revision_id: replay.aggregate.current_revision.revision_id,
        replayed: true
      };
    }
    const aggregate = await this.requireOwned(input.memory_id, input.context);
    if (["REVOKED", "EXPIRED", "REJECTED"].includes(aggregate.object.object_state)) {
      throw new MemoryError("MEMORY_INVALID_STATE", "Memory is already inactive");
    }
    const revokedAt = now.toISOString();
    const revision: MemoryRevision = { ...aggregate.current_revision, revision_state: "WITHDRAWN" };
    const object = {
      ...aggregate.object,
      object_state: "REVOKED" as const,
      policy_revision: input.context.policy_revision,
      updated_at: revokedAt,
      version: aggregate.object.version + 1
    };
    const command = this.command(input.context, input.command_id, input.idempotency_key, "REVOKE", payloadDigest, {
      memory_id: object.memory_id, revision_id: revision.revision_id, object_version: object.version, object
    }, revokedAt);
    const decision = this.decision(input.context, "REVOKE", object.memory_id, revision.revision_id, [...revision.source_evidence_ids, ...authorization.evidence_refs], revokedAt, [required(input.revoke_reason, "revoke_reason"), ...authorization.reason_codes]);
    const result = await this.repository.revoke({
      command,
      expected_object_version: input.expected_object_version,
      expected_current_revision_id: input.expected_current_revision_id,
      object,
      withdrawn_revision: revision,
      policy_decision: decision,
      authority_event: this.event(object, revision, command.command_id, "REVOKED", revokedAt)
    });
    return {
      object: clone(result.aggregate.object),
      revoked_revision_id: result.aggregate.current_revision.revision_id,
      replayed: result.replayed
    };
  }

  async getOwnMemory(context: MemoryRequestContext, memoryId: string): Promise<MemoryAggregate> {
    assertContext(context);
    await this.assertAuthorized(context, "memory.read-own");
    const aggregate = await this.requireOwned(memoryId, context);
    if (!["CANDIDATE", "CONFIRMED", "PUBLISHED"].includes(aggregate.object.object_state)
      || aggregate.current_revision.revision_state === "WITHDRAWN") {
      throw new MemoryError("MEMORY_NOT_FOUND", "Memory was not found");
    }
    return clone(aggregate);
  }

  private async assertAuthorized(context: MemoryRequestContext, action: MemoryAuthorityAction) {
    const decision = await this.authorization.authorize({
      context,
      action,
      scope_type: "PERSONAL",
      scope_id: context.principal_id
    });
    if (decision.authorization_revision !== context.authorization_revision) {
      throw new MemoryError("MEMORY_STALE_AUTHORIZATION", "Memory authorization revision is stale");
    }
    if (decision.decision !== "ALLOW") {
      throw new MemoryError("MEMORY_SCOPE_DENIED", "Memory action is not authorized");
    }
    return decision;
  }

  private async requireOwned(memoryId: string, context: MemoryRequestContext): Promise<MemoryAggregate> {
    const aggregate = await this.repository.getOwnedAggregate({ memory_id: required(memoryId, "memory_id"), tenant_id: context.tenant_id, owner_principal_id: context.principal_id });
    if (aggregate === undefined) throw new MemoryError("MEMORY_NOT_FOUND", "Memory was not found");
    return aggregate;
  }

  private assertPersonalOwner(context: MemoryRequestContext, owner: string, scope: string, scopeId?: string): void {
    if (owner !== context.principal_id || scope !== "PERSONAL" || (scopeId !== undefined && scopeId !== context.principal_id)) {
      throw new MemoryError("MEMORY_SCOPE_DENIED", "Personal Memory owner and scope are server-derived");
    }
  }

  private evidence(context: MemoryRequestContext, input: MemorySourceEvidenceInput, capturedAt: string): MemorySourceEvidence {
    required(input.source_authority, "source_authority");
    required(input.source_object_id, "source_object_id");
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.evidence_digest)) throw new MemoryError("MEMORY_INVALID_ARGUMENT", "Evidence digest is invalid");
    return { ...clone(input), source_evidence_id: `mev_${randomUUID()}`, tenant_id: context.tenant_id, captured_by_principal_id: context.principal_id, captured_at: capturedAt, observed_at: instant(input.observed_at, "observed_at") };
  }

  private command(context: MemoryRequestContext, commandId: string, key: string, kind: MemoryCommandRecord["command_kind"], payloadDigest: string, result: Record<string, unknown>, at: string): MemoryCommandRecord {
    return { command_id: required(commandId, "command_id"), tenant_id: context.tenant_id, principal_id: context.principal_id, idempotency_key: required(key, "idempotency_key"), command_kind: kind, payload_digest: payloadDigest, result, created_at: at, completed_at: at };
  }

  private decision(context: MemoryRequestContext, kind: MemoryPolicyDecision["decision_kind"], memoryId: string, revisionId: string, evidence: readonly string[], at: string, reasons: readonly string[]): MemoryPolicyDecision {
    const unsigned = { decision_kind: kind, tenant_id: context.tenant_id, principal_id: context.principal_id, memory_id: memoryId, revision_id: revisionId, authorization_revision: context.authorization_revision, policy_revision: context.policy_revision, decision: "ALLOW" as const, reason_codes: [...reasons], evidence_refs: [...evidence], decided_at: at };
    return { decision_id: `mdecision_${randomUUID()}`, ...unsigned, decision_digest: memoryDigest(unsigned) };
  }

  private event(object: MemoryAggregate["object"], revision: MemoryRevision, commandId: string, kind: MemoryAuthorityEvent["change_kind"], at: string): MemoryAuthorityEvent {
    return { event_id: `mevent_${randomUUID()}`, tenant_id: object.tenant_id, memory_id: object.memory_id, revision_id: revision.revision_id, object_version: object.version, change_kind: kind, object_state: object.object_state, revision_state: revision.revision_state, scope_digest: memoryDigest({ tenant_id: object.tenant_id, scope_type: object.scope_type, scope_id: object.scope_id, owner_principal_id: object.owner_principal_id }), sensitivity: object.sensitivity, policy_revision: object.policy_revision, occurred_at: at, producer_sequence: object.version, causation_command_id: commandId };
  }

  private capturePayload(input: CaptureMemoryInput): unknown {
    const { context, ...command } = input;
    return { context: { tenant_id: context.tenant_id, principal_id: context.principal_id, authorization_revision: context.authorization_revision, policy_revision: context.policy_revision }, command };
  }

  private revisePayload(input: ReviseMemoryInput): unknown {
    const { context, ...command } = input;
    return { context: { tenant_id: context.tenant_id, principal_id: context.principal_id, authorization_revision: context.authorization_revision, policy_revision: context.policy_revision }, command };
  }

  private revokePayload(input: RevokeMemoryInput): unknown {
    const { context, ...command } = input;
    return { context: { tenant_id: context.tenant_id, principal_id: context.principal_id, authorization_revision: context.authorization_revision, policy_revision: context.policy_revision }, command };
  }
}
