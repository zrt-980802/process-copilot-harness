import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IdentityAuthorizationService } from "@pc/application";
import {
  EventProjectionService,
  type EventEnvelope
} from "@pc/event-projection";
import {
  MemoryEventProjectionRepository,
  MemoryIdentityAuthorizationRepository
} from "@pc/persistence";
import { buildApiServer } from "../src/server.js";

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

describe("DEV-08 Event and Recovery API", () => {
  it("isolates Task projections and authenticates internal event ingestion", async () => {
    const now = () => new Date("2026-11-10T14:00:00.000Z");
    const identity = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      "dev08-api-signing-key-00000000000000000000",
      [],
      now
    );
    await identity.initialize();
    const first = await identity.provisionPilotAccount({
      tenant_id: "tenant-api",
      account_key: "first",
      secret: "FirstSecret123"
    });
    await identity.provisionPilotAccount({
      tenant_id: "tenant-api",
      account_key: "second",
      secret: "SecondSecret123"
    });
    const firstSignIn = await identity.signInPilot(
      "tenant-api",
      "first",
      "FirstSecret123"
    );
    const secondSignIn = await identity.signInPilot(
      "tenant-api",
      "second",
      "SecondSecret123"
    );
    const events = new EventProjectionService(
      new MemoryEventProjectionRepository(),
      undefined,
      undefined,
      undefined,
      undefined,
      now
    );
    await events.initialize();
    const server = buildApiServer({
      identityAuthorization: identity,
      eventProjection: events,
      eventIngestSecret: "dev08-event-ingest-secret-000000"
    });
    await server.ready();
    try {
      expect((await server.inject({ method: "POST", url: "/v1/internal/events/ingest", payload: { events: [] } })).statusCode).toBe(403);
      expect((await server.inject({ method: "POST", url: "/v1/internal/events/ingest",
        headers: { "x-pc-event-secret": "dev08-event-ingest-secret-000000" }, payload: { events: [] } })).statusCode).toBe(202);
      const firstHeaders = {
        authorization: `Bearer ${firstSignIn.access_token}`,
        "content-type": "application/json"
      };
      const createdResponse = await server.inject({
        method: "POST",
        url: "/v1/business-tasks",
        headers: firstHeaders,
        payload: {
          profile_release_id: "profile-1",
          source_session_ids: ["session-1"]
        }
      });
      expect(createdResponse.statusCode).toBe(201);
      const task = createdResponse.json<{ business_task_id: string }>();

      const crossUser = await server.inject({
        method: "GET",
        url: `/v1/business-tasks/${task.business_task_id}`,
        headers: {
          authorization: `Bearer ${secondSignIn.access_token}`
        }
      });
      expect(crossUser.statusCode).toBe(403);

      const payload = { state: "READY" };
      const readyEvent: EventEnvelope = {
        contract_name: "pc.event-envelope/1",
        contract_version: 1,
        event_id: "event-api-ready",
        event_type: "pc.task.ready",
        event_schema_version: 1,
        producer: "pc-control-plane",
        producer_version: "1.0.0",
        tenant_id: "tenant-api",
        principal_id: first.principal.principal_id,
        stream_kind: "TASK",
        stream_id: task.business_task_id,
        stream_sequence: 2,
        aggregate_revision: 2,
        business_task_id: task.business_task_id,
        durability: "DURABLE_PC",
        occurred_at: now().toISOString(),
        observed_at: now().toISOString(),
        payload,
        payload_digest: digest(payload)
      };
      const deniedIngest = await server.inject({
        method: "POST",
        url: "/v1/events/ingest",
        payload: { events: [readyEvent] }
      });
      expect(deniedIngest.statusCode).toBe(403);

      const accepted = await server.inject({
        method: "POST",
        url: "/v1/events/ingest",
        headers: {
          "x-pc-event-secret": "dev08-event-ingest-secret-000000"
        },
        payload: { events: [readyEvent] }
      });
      expect(accepted.statusCode).toBe(202);
      expect(accepted.json()).toMatchObject({
        results: [{ event_id: "event-api-ready", status: "APPLIED" }]
      });

      const projection = await server.inject({
        method: "GET",
        url: `/v1/business-tasks/${task.business_task_id}`,
        headers: firstHeaders
      });
      expect(projection.statusCode).toBe(200);
      expect(projection.json()).toMatchObject({
        task: { state: "READY", version: 2 }
      });

      const operation = await server.inject({
        method: "POST",
        url: `/v1/business-tasks/${task.business_task_id}/operations`,
        headers: firstHeaders,
        payload: {
          operation_id: "operation-api-1",
          operation_kind: "READ",
          recovery_class: "REPLAY_SAFE",
          input_digest: `sha256:${"1".repeat(64)}`
        }
      });
      expect(operation.statusCode).toBe(201);

      const rebuilt = await server.inject({
        method: "POST",
        url: `/v1/business-tasks/${task.business_task_id}/rebuild`,
        headers: {
          authorization: `Bearer ${firstSignIn.access_token}`
        }
      });
      expect(rebuilt.statusCode).toBe(200);
      expect(rebuilt.json()).toMatchObject({
        digest_matches: true,
        task: { state: "READY" },
        operations: [{ operation_id: "operation-api-1" }]
      });
    } finally {
      await server.close();
      await events.close();
      await identity.close();
    }
  });
});
