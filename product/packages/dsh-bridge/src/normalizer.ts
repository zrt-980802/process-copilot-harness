import { createHash } from "node:crypto";
import type {
  DshSessionEvent,
  EventNormalizationContext,
  PcEventEnvelope
} from "./types.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textContent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
  });
}

export function normalizeEventPayload(event: DshSessionEvent): Record<string, unknown> {
  const data = record(event.data);
  switch (event.type) {
    case "agent/inbox/spliced": {
      const inserted = Array.isArray(data.inserted)
        ? data.inserted.map((entry) => {
            const message = record(entry);
            return {
              id: typeof message.id === "string" ? message.id : "",
              role: typeof message.role === "string" ? message.role : "unknown"
            };
          })
        : [];
      return {
        target: typeof data.target === "string" ? data.target : "unknown",
        start: typeof data.start === "number" ? data.start : 0,
        inserted
      };
    }
    case "turn/start":
      return { turn: typeof data.turn === "number" ? data.turn : -1 };
    case "assistant/message": {
      const message = record(data.message);
      const source = record(message.source);
      return {
        turn: typeof data.turn === "number" ? data.turn : -1,
        step: typeof data.step === "number" ? data.step : -1,
        message_id: typeof message.id === "string" ? message.id : "",
        text: textContent(message.content),
        provider: typeof source.provider === "string" ? source.provider : "unknown",
        model: typeof source.model === "string" ? source.model : "unknown",
        interrupted: data.interrupted === true
      };
    }
    case "turn/end":
      return {
        turn: typeof data.turn === "number" ? data.turn : -1,
        reason: stableValue(data.reason) ?? null
      };
    default:
      return {
        dsh_event_type: event.type,
        diagnostic_only: true,
        ignorable: event.ignorable === true
      };
  }
}

function eventTime(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function normalizeDshEvent(
  event: DshSessionEvent,
  context: EventNormalizationContext
): PcEventEnvelope {
  const payload = normalizeEventPayload(event);
  const payloadDigest = digest(payload);
  const eventId = digest({
    runtime_id: context.runtimeId,
    runtime_epoch: context.runtimeEpoch,
    dsh_session_id: context.dshSessionId,
    dsh_session_seq: event.seq,
    payload_digest: payloadDigest
  });
  return {
    contract_name: "pc.event-envelope/1",
    contract_version: 1,
    event_id: eventId,
    event_type: `dsh.${event.type}`,
    event_schema_version: 1,
    producer: "pc-runtime-bridge",
    producer_version: "1.0.0",
    tenant_id: context.tenantId ?? "local-tenant",
    principal_id: context.principalId ?? "local-user",
    stream_kind: "SESSION",
    stream_id: context.pcSessionId,
    stream_sequence: event.seq + 1,
    ...(context.businessTaskId === undefined
      ? {}
      : { business_task_id: context.businessTaskId }),
    ...(context.operationId === undefined
      ? {}
      : { operation_id: context.operationId }),
    runtime_id: context.runtimeId,
    runtime_epoch: context.runtimeEpoch,
    pc_session_id: context.pcSessionId,
    dsh_session_id: context.dshSessionId,
    dsh_session_seq: event.seq,
    runtime_event_seq: context.runtimeEventSequence,
    assignment_generation: context.assignmentGeneration,
    fencing_token: context.fencingToken,
    durability: context.durability ?? "OBSERVED",
    occurred_at: eventTime(event.time),
    observed_at: eventTime(event.time),
    payload,
    payload_digest: payloadDigest
  };
}
