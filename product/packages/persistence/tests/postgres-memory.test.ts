import { describe, expect, it } from "vitest";
import {
  MemoryAuthorityService,
  memoryDigest,
  type MemoryAuthorizationPort,
  type MemoryRequestContext
} from "@pc/memory";
import { PostgresMemoryAuthorityRepository } from "../src/index.js";

const databaseUrl = process.env.PC_TEST_POSTGRES_URL;
const now = new Date("2026-11-17T02:00:00.000Z");
const authorization: MemoryAuthorizationPort = {
  authorize: (input) => Promise.resolve({
    decision: "ALLOW",
    authorization_revision: input.context.authorization_revision,
    reason_codes: ["postgres-test-owner"],
    evidence_refs: [`authorization:${input.context.authorization_revision}`]
  })
};

function evidence(suffix: string) {
  return [{
    source_kind: "CONVERSATION_MESSAGE" as const,
    source_authority: "process-copilot",
    source_object_id: `message-${suffix}`,
    source_version_id: `message-version-${suffix}`,
    sensitivity: "INTERNAL" as const,
    displayability: "DISPLAYABLE" as const,
    evidence_digest: memoryDigest({ suffix }),
    access_revalidation_policy: "OWNER_ONLY" as const,
    observed_at: now.toISOString()
  }];
}

describe.skipIf(databaseUrl === undefined)("Postgres Memory Authority", () => {
  it("persists idempotent capture, serializes competing revisions, emits Outbox and survives restart", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const context: MemoryRequestContext = {
      tenant_id: `tenant-memory-${suffix}`,
      principal_id: `principal-memory-${suffix}`,
      actor_principal_id: `principal-memory-${suffix}`,
      authorization_revision: 1,
      policy_revision: 1,
      request_context_ref: `request-memory-${suffix}`
    };
    const createService = () => new MemoryAuthorityService(
      new PostgresMemoryAuthorityRepository(databaseUrl as string),
      authorization,
      () => now
    );
    const capture = {
      context,
      command_id: `capture-${suffix}`,
      idempotency_key: `capture-${suffix}`,
      capture_mode: "EXPLICIT_USER_SAVE" as const,
      owner_principal_id: context.principal_id,
      scope_request: { scope_type: "PERSONAL" as const },
      memory_kind: "EXPLICIT_PREFERENCE" as const,
      content: { preference: "conclusion first" },
      retrieval_summary: "answer structure preference",
      source_evidence_inputs: evidence(`capture-${suffix}`),
      valid_from: now.toISOString(),
      sensitivity: "INTERNAL" as const,
      expected_result_state: "CONFIRMED" as const,
      issued_at: now.toISOString(),
      deadline: "2026-11-17T02:05:00.000Z"
    };
    let winningRevisionInput: Parameters<MemoryAuthorityService["revise"]>[0] | undefined;

    const first = createService();
    await first.initialize();
    let memoryId = "";
    let firstRevision = "";
    try {
      const created = await first.capture(capture);
      memoryId = created.aggregate.object.memory_id;
      firstRevision = created.aggregate.current_revision.revision_id;
      const replay = await first.capture(capture);
      expect(replay).toMatchObject({ replayed: true, aggregate: { object: { memory_id: memoryId } } });
      await expect(first.capture({
        ...capture,
        content: { preference: "different payload under the same key" }
      })).rejects.toMatchObject({ code: "MEMORY_VERSION_CONFLICT" });

      const base = {
        context,
        memory_id: memoryId,
        expected_object_version: 1,
        expected_current_revision_id: firstRevision,
        revision_reason: "CORRECTION" as const,
        retrieval_summary: "corrected structure preference",
        new_source_evidence_inputs: evidence(`revise-${suffix}`),
        valid_from: now.toISOString(),
        issued_at: now.toISOString(),
        deadline: "2026-11-17T02:05:00.000Z"
      };
      const revisionInputs = [
        { ...base, command_id: `revise-a-${suffix}`, idempotency_key: `revise-a-${suffix}`, new_content: { preference: "evidence first" } },
        { ...base, command_id: `revise-b-${suffix}`, idempotency_key: `revise-b-${suffix}`, new_content: { preference: "summary first" } }
      ];
      const revisions = await Promise.allSettled(revisionInputs.map((input) => first.revise(input)));
      expect(revisions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(revisions.find((result) => result.status === "rejected")).toMatchObject({
        status: "rejected", reason: { code: "MEMORY_REVISION_CONFLICT" }
      });
      winningRevisionInput = revisionInputs[revisions.findIndex((result) => result.status === "fulfilled")];
    } finally {
      await first.close();
    }

    const second = createService();
    await second.initialize();
    try {
      const recovered = await second.getOwnMemory(context, memoryId);
      expect(recovered.object.version).toBe(2);
      expect(recovered.current_revision).toMatchObject({ revision_no: 2, revision_state: "CURRENT" });
      const captureReplay = await second.capture(capture);
      expect(captureReplay).toMatchObject({
        replayed: true,
        aggregate: { object: { version: 1 }, current_revision: { revision_id: firstRevision } }
      });
      expect(winningRevisionInput).toBeDefined();
      const revisionReplay = await second.revise(winningRevisionInput as Parameters<MemoryAuthorityService["revise"]>[0]);
      expect(revisionReplay).toMatchObject({
        replayed: true,
        aggregate: { object: { version: 2 }, current_revision: { revision_id: recovered.current_revision.revision_id } }
      });
      await expect(second.getOwnMemory({ ...context, principal_id: `other-${suffix}`, actor_principal_id: `other-${suffix}` }, memoryId)).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
      const revoked = await second.revoke({
        context,
        command_id: `revoke-${suffix}`,
        idempotency_key: `revoke-${suffix}`,
        memory_id: memoryId,
        expected_object_version: recovered.object.version,
        expected_current_revision_id: recovered.current_revision.revision_id,
        revoke_reason: "OWNER_REQUEST",
        issued_at: now.toISOString(),
        deadline: "2026-11-17T02:05:00.000Z"
      });
      expect(revoked).toMatchObject({ object: { object_state: "REVOKED", version: 3 } });
      expect(revoked).not.toHaveProperty("aggregate.current_revision.structured_content");
      const revokeReplay = await second.revoke({
        context,
        command_id: `revoke-${suffix}`,
        idempotency_key: `revoke-${suffix}`,
        memory_id: memoryId,
        expected_object_version: recovered.object.version,
        expected_current_revision_id: recovered.current_revision.revision_id,
        revoke_reason: "OWNER_REQUEST",
        issued_at: now.toISOString(),
        deadline: "2026-11-17T02:05:00.000Z"
      });
      expect(revokeReplay).toMatchObject({ replayed: true, object: { object_state: "REVOKED", version: 3 } });
      await expect(second.getOwnMemory(context, memoryId)).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
    } finally {
      await second.close();
    }

    const thirdRepository = new PostgresMemoryAuthorityRepository(databaseUrl as string);
    const third = new MemoryAuthorityService(thirdRepository, authorization, () => now);
    await third.initialize();
    try {
      const recovered = await thirdRepository.getOwnedAggregate({
        memory_id: memoryId,
        tenant_id: context.tenant_id,
        owner_principal_id: context.principal_id
      });
      expect(recovered?.object.object_state).toBe("REVOKED");
      expect(recovered?.current_revision.revision_state).toBe("WITHDRAWN");
      await expect(third.getOwnMemory(context, memoryId)).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
      const events = await thirdRepository.listAuthorityEvents({ tenant_id: context.tenant_id, memory_id: memoryId });
      expect(events.map((event) => event.change_kind)).toEqual([
        "CONFIRMED", "REVISED", "REVOKED"
      ]);
      expect(events.map((event) => event.producer_sequence)).toEqual([1, 2, 3]);
    } finally {
      await third.close();
    }
  });
});
