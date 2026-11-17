import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PcRuntimeBridgeClient } from "../src/index.js";
import type { DshBridgeControlError } from "../src/index.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    })
  ));
});

async function endpoint(): Promise<string> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id: number;
      method: string;
      params: Record<string, unknown>;
    };
    response.setHeader("content-type", "application/json");
    if (request.headers["x-pc-bridge-secret"] !== "test-secret") {
      response.statusCode = 401;
      response.end(`${JSON.stringify({
        id: body.id,
        ok: false,
        error: { code: "UNAUTHORIZED", message: "denied", retryable: false }
      })}\n`);
      return;
    }
    const results: Record<string, unknown> = {
      "pc.bridge/handshake": {
        protocol_version: "1.0",
        bridge_build: "test",
        runtime_id: "runtime-1",
        runtime_epoch: 2,
        dsh_version: "0.2.1-rc.3",
        profile_id: "sdk-minimal",
        profile_digest: "digest-1",
        process_id: 123,
        capabilities: {
          session_flush: true,
          session_cancel: true,
          session_events: true,
          session_release: true,
          step_guard: true,
          tool_guard: true
        }
      },
      "pc.bridge/session.flush": {
        durable: true,
        through_sequence: 7
      },
      "pc.bridge/session.cancel": {
        requested: true,
        was_running: true
      },
      "pc.bridge/session.events": {
        events: [{
          type: "turn/end",
          seq: 7,
          time: 1_700_000_000_000,
          data: { turn: 1, reason: { kind: "completed" } }
        }],
        through_sequence: 7,
        has_more: false
      },
      "pc.bridge/session.release": {
        released: true,
        durable: true
      },
      "pc.bridge/assignment.upsert": {
        updated: true
      },
      "pc.bridge/guard.evaluate": {
        allowed: false,
        code: "PC_RUNTIME_LEASE_EXPIRED",
        reason: "Tool Guard Assignment Lease has expired",
        state: "ACTIVE",
        lease_expires_at: "2026-11-10T00:00:00.000Z",
        authority_version: 3
      }
    };
    response.end(`${JSON.stringify({ id: body.id, ok: true, result: results[body.method] })}\n`);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("PcRuntimeBridgeClient", () => {
  it("maps handshake and Session control responses", async () => {
    const client = new PcRuntimeBridgeClient(await endpoint(), "test-secret");

    await expect(client.handshake()).resolves.toMatchObject({
      protocolVersion: "1.0",
      runtimeId: "runtime-1",
      runtimeEpoch: 2,
      capabilities: {
        sessionFlush: true,
        sessionCancel: true,
        sessionEvents: true,
        sessionRelease: true,
        stepGuard: true,
        toolGuard: true
      }
    });
    await expect(client.flush("session-1")).resolves.toEqual({
      durable: true,
      throughSequence: 7
    });
    await expect(client.cancel("session-1")).resolves.toEqual({
      requested: true,
      wasRunning: true
    });
    await expect(client.events("session-1", 6, 10)).resolves.toMatchObject({
      throughSequence: 7,
      hasMore: false,
      events: [{ type: "turn/end", seq: 7 }]
    });
    await expect(client.release("session-1")).resolves.toEqual({
      released: true,
      durable: true
    });
    await expect(client.upsertAssignmentGuard({
      pcSessionId: "pc-session-1",
      dshSessionId: "session-1",
      runtimeId: "runtime-1",
      runtimeEpoch: 2,
      assignmentGeneration: 1,
      fencingToken: "11",
      leaseExpiresAt: "2026-11-10T00:00:00.000Z",
      state: "ACTIVE",
      authorizationRevision: 1,
      authorityVersion: 3
    })).resolves.toBeUndefined();
    await expect(client.assignmentGuard("session-1", "tool")).resolves.toEqual({
      allowed: false,
      code: "PC_RUNTIME_LEASE_EXPIRED",
      reason: "Tool Guard Assignment Lease has expired",
      state: "ACTIVE",
      leaseExpiresAt: "2026-11-10T00:00:00.000Z",
      authorityVersion: 3
    });
  });

  it("preserves stable bridge error codes", async () => {
    const client = new PcRuntimeBridgeClient(await endpoint(), "wrong-secret");

    await expect(client.handshake()).rejects.toMatchObject<DshBridgeControlError>({
      code: "UNAUTHORIZED",
      retryable: false
    });
  });
});
