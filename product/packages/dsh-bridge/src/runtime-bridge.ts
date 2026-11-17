import type {
  DshAssignmentGuardSnapshot,
  DshBridgeHandshake,
  DshCancelResult,
  DshEventsResult,
  DshFlushResult,
  DshGuardDecision,
  DshReleaseResult,
  DshSessionEvent
} from "./types.js";

interface BridgeResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function integer(value: unknown, fallback = -1): number {
  return Number.isInteger(value) ? Number(value) : fallback;
}

export class DshBridgeControlError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "DshBridgeControlError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class PcRuntimeBridgeClient {
  private nextRequestId = 1;

  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly requestTimeoutMs = 10_000
  ) {}

  async handshake(): Promise<DshBridgeHandshake> {
    const result = record(await this.request("pc.bridge/handshake", {}));
    const capabilities = record(result.capabilities);
    return {
      protocolVersion: String(result.protocol_version) as "1.0",
      bridgeBuild: String(result.bridge_build ?? "unknown"),
      runtimeId: String(result.runtime_id ?? ""),
      runtimeEpoch: integer(result.runtime_epoch, -1),
      dshVersion: String(result.dsh_version ?? ""),
      profileId: String(result.profile_id ?? ""),
      profileDigest: String(result.profile_digest ?? ""),
      processId: integer(result.process_id, -1),
      capabilities: {
        sessionFlush: capabilities.session_flush === true,
        sessionCancel: capabilities.session_cancel === true,
        sessionEvents: capabilities.session_events === true,
        sessionRelease: capabilities.session_release === true,
        stepGuard: capabilities.step_guard === true,
        toolGuard: capabilities.tool_guard === true
      }
    };
  }

  async flush(sessionId: string): Promise<DshFlushResult> {
    const result = record(await this.request("pc.bridge/session.flush", {
      session_id: sessionId
    }));
    return {
      durable: result.durable === true,
      throughSequence: integer(result.through_sequence)
    };
  }

  async configureTools(sessionId: string, context: Record<string, unknown>): Promise<void> {
    await this.request("pc.bridge/tools.configure", { session_id: sessionId, context });
  }

  async cancel(sessionId: string): Promise<DshCancelResult> {
    const result = record(await this.request("pc.bridge/session.cancel", {
      session_id: sessionId
    }));
    return {
      requested: result.requested === true,
      wasRunning: result.was_running === true
    };
  }

  async events(
    sessionId: string,
    afterSequence: number,
    limit: number
  ): Promise<DshEventsResult> {
    const result = record(await this.request("pc.bridge/session.events", {
      session_id: sessionId,
      after_sequence: afterSequence,
      limit
    }));
    return {
      events: Array.isArray(result.events) ? result.events as DshSessionEvent[] : [],
      throughSequence: integer(result.through_sequence, afterSequence),
      hasMore: result.has_more === true
    };
  }

  async release(sessionId: string): Promise<DshReleaseResult> {
    const result = record(await this.request("pc.bridge/session.release", {
      session_id: sessionId
    }));
    return {
      released: result.released === true,
      durable: result.durable === true
    };
  }

  async upsertAssignmentGuard(snapshot: DshAssignmentGuardSnapshot): Promise<void> {
    await this.request("pc.bridge/assignment.upsert", {
      pc_session_id: snapshot.pcSessionId,
      session_id: snapshot.dshSessionId,
      runtime_id: snapshot.runtimeId,
      runtime_epoch: snapshot.runtimeEpoch,
      assignment_generation: snapshot.assignmentGeneration,
      fencing_token: snapshot.fencingToken,
      lease_expires_at: snapshot.leaseExpiresAt,
      state: snapshot.state,
      authorization_revision: snapshot.authorizationRevision,
      authority_version: snapshot.authorityVersion
    });
  }

  async assignmentGuard(
    sessionId: string,
    kind: "step" | "tool"
  ): Promise<DshGuardDecision> {
    const result = record(await this.request("pc.bridge/guard.evaluate", {
      session_id: sessionId,
      kind
    }));
    return {
      allowed: result.allowed === true,
      code: String(result.code ?? "PC_RUNTIME_GUARD_DENIED"),
      reason: String(result.reason ?? "Assignment guard denied execution"),
      state: String(result.state ?? "UNKNOWN"),
      leaseExpiresAt: String(result.lease_expires_at ?? ""),
      authorityVersion: integer(result.authority_version, -1)
    };
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId++;
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/rpc`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pc-bridge-secret": this.secret
        },
        body: JSON.stringify({ id, method, params }),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
    } catch (error) {
      throw new DshBridgeControlError(
        "BRIDGE_TRANSPORT",
        error instanceof Error ? error.message : String(error),
        true
      );
    }
    let body: BridgeResponse;
    try {
      body = await response.json() as BridgeResponse;
    } catch (error) {
      throw new DshBridgeControlError(
        "BRIDGE_PROTOCOL",
        `bridge returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (body.id !== id) {
      throw new DshBridgeControlError("BRIDGE_PROTOCOL", "bridge response id mismatch");
    }
    if (!response.ok || !body.ok) {
      throw new DshBridgeControlError(
        String(body.error?.code ?? "BRIDGE_FAILURE"),
        String(body.error?.message ?? `bridge request failed with HTTP ${response.status}`),
        body.error?.retryable === true
      );
    }
    return body.result;
  }
}
