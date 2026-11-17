import { describe, expect, it } from "vitest";
import {
  MemoryAuthorityService,
  MemoryError,
  memoryDigest,
  type CaptureMutation,
  type MemoryAggregate,
  type MemoryAuthorityEvent,
  type MemoryAuthorityRepository,
  type MemoryAuthorizationPort,
  type MemoryCommandReplayLookup,
  type MemoryCommandRecord,
  type MemoryMutationResult,
  type RevokeMutation,
  type ReviseMutation
} from "../src/index.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

class TestRepository implements MemoryAuthorityRepository {
  private readonly aggregates = new Map<string, MemoryAggregate>();
  private readonly commands = new Map<string, { command: MemoryCommandRecord; aggregate: MemoryAggregate }>();
  private readonly events: MemoryAuthorityEvent[] = [];

  initialize(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }

  replayCommand(input: MemoryCommandReplayLookup): Promise<MemoryMutationResult | undefined> {
    return Promise.resolve(this.replay(input));
  }

  capture(input: CaptureMutation): Promise<MemoryMutationResult> {
    const replay = this.replay(input.command);
    if (replay) return Promise.resolve(replay);
    if (this.aggregates.has(input.object.memory_id)) throw new MemoryError("MEMORY_VERSION_CONFLICT", "Memory already exists");
    const aggregate = { object: clone(input.object), current_revision: clone(input.revision), source_evidence: clone(input.source_evidence) };
    this.save(input.command, aggregate, input.authority_event);
    return Promise.resolve({ aggregate: clone(aggregate), replayed: false });
  }

  revise(input: ReviseMutation): Promise<MemoryMutationResult> {
    const replay = this.replay(input.command);
    if (replay) return Promise.resolve(replay);
    const current = this.aggregates.get(input.object.memory_id);
    if (!current || current.object.version !== input.expected_object_version || current.current_revision.revision_id !== input.expected_current_revision_id) {
      throw new MemoryError("MEMORY_REVISION_CONFLICT", "Memory revision changed");
    }
    const aggregate = { object: clone(input.object), current_revision: clone(input.revision), source_evidence: clone(input.source_evidence) };
    this.save(input.command, aggregate, input.authority_event);
    return Promise.resolve({ aggregate: clone(aggregate), replayed: false });
  }

  revoke(input: RevokeMutation): Promise<MemoryMutationResult> {
    const replay = this.replay(input.command);
    if (replay) return Promise.resolve(replay);
    const current = this.aggregates.get(input.object.memory_id);
    if (!current || current.object.version !== input.expected_object_version || current.current_revision.revision_id !== input.expected_current_revision_id) {
      throw new MemoryError("MEMORY_REVISION_CONFLICT", "Memory revision changed");
    }
    const aggregate = { object: clone(input.object), current_revision: clone(input.withdrawn_revision), source_evidence: clone(current.source_evidence) };
    this.save(input.command, aggregate, input.authority_event);
    return Promise.resolve({ aggregate: clone(aggregate), replayed: false });
  }

  getOwnedAggregate(input: { memory_id: string; tenant_id: string; owner_principal_id: string }): Promise<MemoryAggregate | undefined> {
    const aggregate = this.aggregates.get(input.memory_id);
    if (!aggregate || aggregate.object.tenant_id !== input.tenant_id || aggregate.object.owner_principal_id !== input.owner_principal_id) return Promise.resolve(undefined);
    return Promise.resolve(clone(aggregate));
  }

  listAuthorityEvents(input: { tenant_id: string; memory_id?: string; after_sequence?: number }): Promise<MemoryAuthorityEvent[]> {
    return Promise.resolve(clone(this.events.filter((event) => event.tenant_id === input.tenant_id
      && (input.memory_id === undefined || event.memory_id === input.memory_id)
      && event.producer_sequence > (input.after_sequence ?? 0))));
  }

  private key(command: MemoryCommandReplayLookup): string {
    return `${command.tenant_id}:${command.principal_id}:${command.idempotency_key}`;
  }

  private replay(command: MemoryCommandReplayLookup): MemoryMutationResult | undefined {
    const stored = this.commands.get(this.key(command));
    if (!stored) return undefined;
    if (stored.command.payload_digest !== command.payload_digest || stored.command.command_kind !== command.command_kind) {
      throw new MemoryError("MEMORY_VERSION_CONFLICT", "Idempotency key was reused with another payload");
    }
    return { aggregate: clone(stored.aggregate), replayed: true };
  }

  private save(command: MemoryCommandRecord, aggregate: MemoryAggregate, event: MemoryAuthorityEvent): void {
    this.aggregates.set(aggregate.object.memory_id, clone(aggregate));
    this.commands.set(this.key(command), { command: clone(command), aggregate: clone(aggregate) });
    this.events.push(clone(event));
  }
}

class TestAuthorization implements MemoryAuthorizationPort {
  constructor(private readonly mode: "ALLOW" | "DENY" | "STALE" = "ALLOW") {}

  authorize(input: Parameters<MemoryAuthorizationPort["authorize"]>[0]) {
    return Promise.resolve({
      decision: this.mode === "DENY" ? "DENY" as const : "ALLOW" as const,
      authorization_revision: this.mode === "STALE"
        ? input.context.authorization_revision + 1
        : input.context.authorization_revision,
      reason_codes: ["current_personal_owner"],
      evidence_refs: [`authorization:${input.context.authorization_revision}`]
    });
  }
}

const now = new Date("2026-11-17T01:00:00.000Z");
const context = {
  tenant_id: "tenant-a",
  principal_id: "principal-a",
  actor_principal_id: "principal-a",
  authorization_revision: 3,
  policy_revision: 1,
  request_context_ref: "request-context-a"
};
const evidence = [{
  source_kind: "CONVERSATION_MESSAGE" as const,
  source_authority: "process-copilot",
  source_object_id: "message-a",
  sensitivity: "INTERNAL" as const,
  displayability: "DISPLAYABLE" as const,
  evidence_digest: memoryDigest({ message: "a" }),
  access_revalidation_policy: "OWNER_ONLY" as const,
  observed_at: now.toISOString()
}];

function captureInput(overrides: Record<string, unknown> = {}) {
  return {
    context,
    command_id: "command-capture-a",
    idempotency_key: "idem-capture-a",
    capture_mode: "EXPLICIT_USER_SAVE" as const,
    owner_principal_id: "principal-a",
    scope_request: { scope_type: "PERSONAL" as const },
    memory_kind: "EXPLICIT_PREFERENCE" as const,
    content: { preference: "conclusion first" },
    retrieval_summary: "preferred answer structure",
    source_evidence_inputs: evidence,
    valid_from: now.toISOString(),
    sensitivity: "INTERNAL" as const,
    expected_result_state: "CONFIRMED" as const,
    issued_at: now.toISOString(),
    deadline: "2026-11-17T01:05:00.000Z",
    ...overrides
  };
}

describe("MemoryAuthorityService", () => {
  it("creates an explicit confirmed Personal Memory with Evidence and one C54 event", async () => {
    const repository = new TestRepository();
    const service = new MemoryAuthorityService(repository, new TestAuthorization(), () => now);
    const result = await service.capture(captureInput());

    expect(result.replayed).toBe(false);
    expect(result.aggregate.object).toMatchObject({
      tenant_id: "tenant-a", owner_principal_id: "principal-a", scope_type: "PERSONAL",
      scope_id: "principal-a", object_state: "CONFIRMED", version: 1
    });
    expect(result.aggregate.current_revision.revision_state).toBe("CURRENT");
    expect(result.aggregate.source_evidence).toHaveLength(1);
    const events = await repository.listAuthorityEvents({ tenant_id: "tenant-a" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ change_kind: "CONFIRMED", producer_sequence: 1 });
  });

  it("allows automatic capture only as Candidate", async () => {
    const repository = new TestRepository();
    const service = new MemoryAuthorityService(repository, new TestAuthorization(), () => now);
    const result = await service.capture(captureInput({
      command_id: "candidate-command", idempotency_key: "candidate-key",
      capture_mode: "AUTOMATIC_CANDIDATE", expected_result_state: "CANDIDATE"
    }));
    expect(result.aggregate.object.object_state).toBe("CANDIDATE");
    await expect(service.capture(captureInput({
      command_id: "bad-candidate-command", idempotency_key: "bad-candidate-key",
      capture_mode: "AUTOMATIC_CANDIDATE", expected_result_state: "CONFIRMED"
    }))).rejects.toMatchObject({ code: "MEMORY_INVALID_STATE" });
  });

  it("rejects forged owner/scope, missing Evidence and secret-like content", async () => {
    const service = new MemoryAuthorityService(new TestRepository(), new TestAuthorization(), () => now);
    await expect(service.capture(captureInput({ owner_principal_id: "principal-b" }))).rejects.toMatchObject({ code: "MEMORY_SCOPE_DENIED" });
    await expect(service.capture(captureInput({ source_evidence_inputs: [] }))).rejects.toMatchObject({ code: "MEMORY_EVIDENCE_REQUIRED" });
    await expect(service.capture(captureInput({ content: { api_key: "sk-12345678901234567890" } }))).rejects.toMatchObject({ code: "MEMORY_SENSITIVE_CONTENT_REJECTED" });
    await expect(service.capture(captureInput({ content: { password: "ordinary-secret-value" } }))).rejects.toMatchObject({ code: "MEMORY_SENSITIVE_CONTENT_REJECTED" });
  });

  it("fails closed for denied or stale current authorization", async () => {
    await expect(new MemoryAuthorityService(
      new TestRepository(), new TestAuthorization("DENY"), () => now
    ).capture(captureInput())).rejects.toMatchObject({ code: "MEMORY_SCOPE_DENIED" });
    await expect(new MemoryAuthorityService(
      new TestRepository(), new TestAuthorization("STALE"), () => now
    ).capture(captureInput())).rejects.toMatchObject({ code: "MEMORY_STALE_AUTHORIZATION" });
  });

  it("replays the same idempotent capture and rejects a different payload", async () => {
    const service = new MemoryAuthorityService(new TestRepository(), new TestAuthorization(), () => now);
    const first = await service.capture(captureInput());
    const replay = await service.capture(captureInput());
    expect(replay.replayed).toBe(true);
    expect(replay.aggregate.object.memory_id).toBe(first.aggregate.object.memory_id);
    await expect(service.capture(captureInput({ content: { preference: "different" } }))).rejects.toMatchObject({ code: "MEMORY_VERSION_CONFLICT" });
  });

  it("creates an immutable successor Revision and supports idempotent replay before CAS", async () => {
    const repository = new TestRepository();
    const service = new MemoryAuthorityService(repository, new TestAuthorization(), () => now);
    const created = await service.capture(captureInput());
    const revise = {
      context, command_id: "command-revise-a", idempotency_key: "idem-revise-a",
      memory_id: created.aggregate.object.memory_id, expected_object_version: 1,
      expected_current_revision_id: created.aggregate.current_revision.revision_id,
      revision_reason: "CORRECTION" as const, new_content: { preference: "evidence then conclusion" },
      retrieval_summary: "corrected answer structure", new_source_evidence_inputs: evidence,
      valid_from: now.toISOString(), issued_at: now.toISOString(), deadline: "2026-11-17T01:05:00.000Z"
    };
    const revised = await service.revise(revise);
    expect(revised.aggregate.object.version).toBe(2);
    expect(revised.aggregate.current_revision).toMatchObject({ revision_no: 2, revision_state: "CURRENT" });
    expect(revised.aggregate.current_revision.supersedes_revision_id).toBe(created.aggregate.current_revision.revision_id);
    const replay = await service.revise(revise);
    expect(replay.replayed).toBe(true);
    expect(replay.aggregate.current_revision.revision_id).toBe(revised.aggregate.current_revision.revision_id);

    const originalCapture = await service.capture(captureInput());
    expect(originalCapture.replayed).toBe(true);
    expect(originalCapture.aggregate.object.version).toBe(1);
    expect(originalCapture.aggregate.current_revision.revision_id).toBe(created.aggregate.current_revision.revision_id);
  });

  it("rejects stale concurrent Revision CAS", async () => {
    const repository = new TestRepository();
    const service = new MemoryAuthorityService(repository, new TestAuthorization(), () => now);
    const created = await service.capture(captureInput());
    const base = {
      context, memory_id: created.aggregate.object.memory_id, expected_object_version: 1,
      expected_current_revision_id: created.aggregate.current_revision.revision_id,
      revision_reason: "CORRECTION" as const, retrieval_summary: "changed",
      new_source_evidence_inputs: evidence, valid_from: now.toISOString(), issued_at: now.toISOString(),
      deadline: "2026-11-17T01:05:00.000Z"
    };
    await service.revise({ ...base, command_id: "revise-one", idempotency_key: "revise-one", new_content: { value: 1 } });
    await expect(service.revise({ ...base, command_id: "revise-two", idempotency_key: "revise-two", new_content: { value: 2 } })).rejects.toMatchObject({ code: "MEMORY_REVISION_CONFLICT" });
  });

  it("revokes Authority immediately and hides direct access from another Principal", async () => {
    const repository = new TestRepository();
    const service = new MemoryAuthorityService(repository, new TestAuthorization(), () => now);
    const created = await service.capture(captureInput());
    await expect(service.getOwnMemory({ ...context, principal_id: "principal-b", actor_principal_id: "principal-b" }, created.aggregate.object.memory_id)).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
    const revoked = await service.revoke({
      context, command_id: "revoke-a", idempotency_key: "revoke-a",
      memory_id: created.aggregate.object.memory_id, expected_object_version: 1,
      expected_current_revision_id: created.aggregate.current_revision.revision_id,
      revoke_reason: "OWNER_REQUEST", issued_at: now.toISOString(), deadline: "2026-11-17T01:05:00.000Z"
    });
    expect(revoked.object.object_state).toBe("REVOKED");
    expect(revoked).not.toHaveProperty("aggregate.current_revision.structured_content");
    const replay = await service.revoke({
      context, command_id: "revoke-a", idempotency_key: "revoke-a",
      memory_id: created.aggregate.object.memory_id, expected_object_version: 1,
      expected_current_revision_id: created.aggregate.current_revision.revision_id,
      revoke_reason: "OWNER_REQUEST", issued_at: now.toISOString(), deadline: "2026-11-17T01:05:00.000Z"
    });
    expect(replay).toMatchObject({ replayed: true, object: { object_state: "REVOKED", version: 2 } });
    expect(replay).not.toHaveProperty("aggregate.current_revision.structured_content");
    await expect(service.getOwnMemory(context, created.aggregate.object.memory_id)).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
    expect((await repository.listAuthorityEvents({ tenant_id: "tenant-a" })).at(-1)?.change_kind).toBe("REVOKED");
  });
});
