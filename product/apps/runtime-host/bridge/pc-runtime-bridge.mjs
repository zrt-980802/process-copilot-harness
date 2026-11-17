import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { rm, writeFile } from "node:fs/promises";
import { bindingIdentity, composeToolProvider, presetId, registerToolPresets, validateToolContext } from "./pc-tool-provider.mjs";

export const name = "pc-runtime-bridge";
export const inject = ["agents", "sessions", "tools", "agentPresets"];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stableError(code, message, retryable = false) {
  return { code, message, retryable };
}

function secureEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw stableError("REQUEST_TOO_LARGE", "bridge request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function integer(value, field, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw stableError("INVALID_ARGUMENT", `${field} must be an integer >= ${minimum}`);
  }
  return value;
}

function sessionId(params) {
  if (typeof params.session_id !== "string" || params.session_id.trim() === "") {
    throw stableError("INVALID_ARGUMENT", "session_id must be a non-empty string");
  }
  return params.session_id;
}

function guardSnapshot(params) {
  const snapshot = {
    pcSessionId: String(params.pc_session_id ?? ""),
    dshSessionId: sessionId(params),
    runtimeId: String(params.runtime_id ?? ""),
    runtimeEpoch: integer(params.runtime_epoch, "runtime_epoch", 0),
    assignmentGeneration: integer(
      params.assignment_generation,
      "assignment_generation",
      0
    ),
    fencingToken: String(params.fencing_token ?? ""),
    leaseExpiresAt: String(params.lease_expires_at ?? ""),
    state: String(params.state ?? ""),
    authorizationRevision: integer(
      params.authorization_revision,
      "authorization_revision",
      0
    ),
    authorityVersion: integer(params.authority_version, "authority_version", 0)
  };
  if (snapshot.pcSessionId.trim() === "") {
    throw stableError("INVALID_ARGUMENT", "pc_session_id must be a non-empty string");
  }
  if (snapshot.runtimeId.trim() === "") {
    throw stableError("INVALID_ARGUMENT", "runtime_id must be a non-empty string");
  }
  if (snapshot.fencingToken.trim() === "") {
    throw stableError("INVALID_ARGUMENT", "fencing_token must be a non-empty string");
  }
  if (!Number.isFinite(Date.parse(snapshot.leaseExpiresAt))) {
    throw stableError("INVALID_ARGUMENT", "lease_expires_at must be an ISO date-time");
  }
  if (!["PENDING", "ACTIVE", "REVOKING", "RELEASED", "EXPIRED", "REJECTED"]
    .includes(snapshot.state)) {
    throw stableError("INVALID_ARGUMENT", "state is not a supported Assignment state");
  }
  return snapshot;
}

function numericFence(value) {
  return /^\d+$/u.test(value) ? BigInt(value) : undefined;
}

function sameSnapshot(left, right) {
  return left.pcSessionId === right.pcSessionId
    && left.dshSessionId === right.dshSessionId
    && left.runtimeId === right.runtimeId
    && left.runtimeEpoch === right.runtimeEpoch
    && left.assignmentGeneration === right.assignmentGeneration
    && left.fencingToken === right.fencingToken
    && left.leaseExpiresAt === right.leaseExpiresAt
    && left.state === right.state
    && left.authorizationRevision === right.authorizationRevision
    && left.authorityVersion === right.authorityVersion;
}

export function upsertAssignmentGuardSnapshot(assignments, snapshot) {
  const existing = assignments.get(snapshot.dshSessionId);
  if (existing === undefined) {
    assignments.set(snapshot.dshSessionId, snapshot);
    return { updated: true, idempotent: false };
  }
  if (snapshot.assignmentGeneration < existing.assignmentGeneration) {
    throw stableError("GUARD_GENERATION_STALE", "assignment_generation is stale");
  }
  if (
    snapshot.assignmentGeneration === existing.assignmentGeneration
    && snapshot.fencingToken !== existing.fencingToken
  ) {
    throw stableError(
      "GUARD_FENCE_CONFLICT",
      "same Assignment generation carries a different fencing token"
    );
  }
  const currentFence = numericFence(existing.fencingToken);
  const requestedFence = numericFence(snapshot.fencingToken);
  if (
    currentFence !== undefined
    && requestedFence !== undefined
    && requestedFence < currentFence
  ) {
    throw stableError("GUARD_FENCE_STALE", "fencing_token is stale");
  }
  // Authority versions are local to one Assignment, whose generation and fence advance on replacement.
  if (snapshot.assignmentGeneration === existing.assignmentGeneration) {
    if (snapshot.authorityVersion < existing.authorityVersion) {
      throw stableError("GUARD_SNAPSHOT_STALE", "authority_version is stale");
    }
    if (snapshot.authorityVersion === existing.authorityVersion) {
      if (!sameSnapshot(existing, snapshot)) {
        throw stableError("GUARD_SNAPSHOT_CONFLICT", "same authority_version carries different Assignment authority");
      }
      return { updated: false, idempotent: true };
    }
  }
  assignments.set(snapshot.dshSessionId, snapshot);
  return { updated: true, idempotent: false };
}

export function evaluateAssignmentGuardSnapshot(snapshot, kind, now = Date.now()) {
  if (snapshot === undefined) {
    return {
      allowed: false,
      code: "PC_RUNTIME_ASSIGNMENT_NOT_FOUND",
      reason: `${kind} Guard has no Assignment authority snapshot`,
      state: "MISSING",
      lease_expires_at: "",
      authority_version: -1
    };
  }
  if (snapshot.runtimeId !== required("PC_RUNTIME_ID")) {
    return {
      allowed: false,
      code: "PC_RUNTIME_ID_MISMATCH",
      reason: `${kind} Guard Runtime ID is stale`,
      state: snapshot.state,
      lease_expires_at: snapshot.leaseExpiresAt,
      authority_version: snapshot.authorityVersion
    };
  }
  if (snapshot.runtimeEpoch !== Number(required("PC_RUNTIME_EPOCH"))) {
    return {
      allowed: false,
      code: "PC_RUNTIME_EPOCH_STALE",
      reason: `${kind} Guard Runtime epoch is stale`,
      state: snapshot.state,
      lease_expires_at: snapshot.leaseExpiresAt,
      authority_version: snapshot.authorityVersion
    };
  }
  if (snapshot.state !== "ACTIVE") {
    return {
      allowed: false,
      code: snapshot.state === "EXPIRED"
        ? "PC_RUNTIME_ASSIGNMENT_EXPIRED"
        : "PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE",
      reason: `${kind} Guard Assignment is not active: ${snapshot.state}`,
      state: snapshot.state,
      lease_expires_at: snapshot.leaseExpiresAt,
      authority_version: snapshot.authorityVersion
    };
  }
  if (Date.parse(snapshot.leaseExpiresAt) <= now) {
    return {
      allowed: false,
      code: "PC_RUNTIME_LEASE_EXPIRED",
      reason: `${kind} Guard Assignment Lease has expired`,
      state: snapshot.state,
      lease_expires_at: snapshot.leaseExpiresAt,
      authority_version: snapshot.authorityVersion
    };
  }
  return {
    allowed: true,
    code: "PC_RUNTIME_GUARD_ALLOWED",
    reason: `${kind} Guard Assignment authority is current`,
    state: snapshot.state,
    lease_expires_at: snapshot.leaseExpiresAt,
    authority_version: snapshot.authorityVersion
  };
}

function requireAgent(ctx, id) {
  const agent = ctx.agents.get(id);
  if (agent === undefined) throw stableError("SESSION_NOT_FOUND", "DSH session is not active");
  return agent;
}

async function dispatch(ctx, handles, assignments, toolContexts, method, params) {
  if (method === "pc.bridge/handshake") {
    return {
      protocol_version: required("PC_BRIDGE_PROTOCOL_VERSION"),
      bridge_build: required("PC_BRIDGE_BUILD"),
      runtime_id: required("PC_RUNTIME_ID"),
      runtime_epoch: Number(required("PC_RUNTIME_EPOCH")),
      dsh_version: required("PC_DSH_VERSION"),
      profile_id: required("PC_RUNTIME_PROFILE_ID"),
      profile_digest: required("PC_RUNTIME_PROFILE_DIGEST"),
      process_id: process.pid,
      capabilities: {
        session_flush: true,
        session_cancel: true,
        session_events: true,
        session_release: true,
        step_guard: true,
        tool_guard: true
      }
    };
  }

  if (method === "pc.bridge/assignment.upsert") {
    const snapshot = guardSnapshot(params);
    const result = upsertAssignmentGuardSnapshot(assignments, snapshot);
    return {
      ...result,
      session_id: snapshot.dshSessionId,
      authority_version: snapshot.authorityVersion
    };
  }

  if (method === "pc.bridge/tools.configure") {
    const id = sessionId(params);
    const context = params.context;
    validateToolContext(context, assignments.get(id));
    const previous = toolContexts.get(id);
    if (previous && bindingIdentity(previous) !== bindingIdentity(context)) {
      throw stableError("PC_RUNTIME_PROFILE_LOCKED", "Session tool composition is immutable");
    }
    await registerToolPresets(ctx.agentPresets, [presetId(context), ...(context.compatible_session_presets ?? [])], ctx);
    toolContexts.set(id, structuredClone(context));
    return { configured: true, tool_count: context.tools.length };
  }

  if (method === "pc.bridge/guard.evaluate") {
    const id = sessionId(params);
    const kind = params.kind === "tool" ? "Tool" : "Step";
    return evaluateAssignmentGuardSnapshot(assignments.get(id), kind);
  }

  const id = sessionId(params);
  const agent = requireAgent(ctx, id);

  if (method === "pc.bridge/session.flush") {
    if (agent.status !== "idle") {
      throw stableError("SESSION_BUSY", "cannot flush a running DSH session", true);
    }
    const durable = await ctx.sessions.flush(agent.session);
    return {
      durable: durable === true,
      through_sequence: agent.session.snapshotEvents().at(-1)?.seq ?? -1
    };
  }

  if (method === "pc.bridge/session.cancel") {
    const wasRunning = agent.status !== "idle";
    agent.cancel({ kind: "user" });
    return {
      requested: true,
      was_running: wasRunning
    };
  }

  if (method === "pc.bridge/session.events") {
    const afterSequence = integer(params.after_sequence, "after_sequence", -1);
    const limit = integer(params.limit, "limit", 1);
    if (limit > 1000) throw stableError("INVALID_ARGUMENT", "limit must be <= 1000");
    const available = agent.session
      .snapshotEvents()
      .filter((event) => event.seq > afterSequence);
    const events = available.slice(0, limit);
    return {
      events,
      through_sequence: events.at(-1)?.seq ?? afterSequence,
      has_more: available.length > events.length
    };
  }

  if (method === "pc.bridge/session.release") {
    const handle = handles.get(id);
    if (handle === undefined) {
      if (ctx.agents.get(id) === undefined) {
        return {
          released: true,
          durable: true,
          idempotent: true
        };
      }
      throw stableError(
        "SESSION_RELEASE_UNAVAILABLE",
        "DSH session is active but its Agent handle is unavailable",
        true
      );
    }
    await handle.dispose();
    handles.delete(id);
    return {
      released: true,
      durable: true,
      idempotent: false
    };
  }

  throw stableError("METHOD_NOT_FOUND", `unsupported PC bridge method: ${method}`);
}

export async function apply(ctx) {
  const secret = required("PC_BRIDGE_SECRET");
  const endpointFile = required("PC_BRIDGE_ENDPOINT_FILE");
  const handles = new Map();
  const assignments = new Map();
  const toolContexts = new Map();
  const originalCreate = ctx.agents.create.bind(ctx.agents);
  const originalResume = ctx.agents.resume.bind(ctx.agents);
  const create = async (options) => {
    const id = String(options.sessionId);
    const context = toolContexts.get(id);
    const handle = await originalCreate(context ? { ...options,
      meta: { ...options.meta, agentPreset: presetId(context) },
      setup: async (agentCtx, agent) => {
        await options.setup?.(agentCtx, agent);
        await composeToolProvider(ctx, agent, context, () => toolContexts.get(id));
      }
    } : options);
    handles.set(String(handle.agent.id), handle);
    return handle;
  };
  const resume = async (options) => {
    const id = String(options.resumeSessionId);
    const context = toolContexts.get(id);
    const handle = await originalResume(context ? { ...options,
      setup: async (agentCtx, agent) => {
        await options.setup?.(agentCtx, agent);
        await composeToolProvider(ctx, agent, context, () => toolContexts.get(id));
      }
    } : options);
    handles.set(String(handle.agent.id), handle);
    return handle;
  };
  ctx.agents.create = create;
  ctx.agents.resume = resume;
  ctx.on("agent/pre-step", ({ agent }, next) => {
    const decision = evaluateAssignmentGuardSnapshot(
      assignments.get(String(agent.id)),
      "Step"
    );
    return decision.allowed ? next() : { kind: "reject" };
  }, { prepend: true });
  ctx.tools.guard((exec) => {
    const id = exec.agent?.id;
    if (id === undefined) return "PC_RUNTIME_ASSIGNMENT_NOT_FOUND: Tool has no Agent";
    const decision = evaluateAssignmentGuardSnapshot(
      assignments.get(String(id)),
      "Tool"
    );
    return decision.allowed
      ? undefined
      : `${decision.code}: ${decision.reason}`;
  });
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/rpc") {
      json(response, 404, { id: 0, ok: false, error: stableError("NOT_FOUND", "not found") });
      return;
    }
    if (!secureEqual(String(request.headers["x-pc-bridge-secret"] ?? ""), secret)) {
      json(response, 401, {
        id: 0,
        ok: false,
        error: stableError("UNAUTHORIZED", "bridge authentication failed")
      });
      return;
    }
    let requestBody = {};
    try {
      requestBody = await body(request);
      const id = Number(requestBody.id ?? 0);
      const method = String(requestBody.method ?? "");
      const params = requestBody.params !== null
        && typeof requestBody.params === "object"
        && !Array.isArray(requestBody.params)
        ? requestBody.params
        : {};
      const result = await dispatch(ctx, handles, assignments, toolContexts, method, params);
      json(response, 200, { id, ok: true, result });
    } catch (error) {
      const stable = error !== null
        && typeof error === "object"
        && typeof error.code === "string"
        ? error
        : stableError("BRIDGE_INTERNAL", "PC Runtime Bridge operation failed", true);
      json(response, stable.code === "BRIDGE_INTERNAL" ? 500 : 400, {
        id: Number(requestBody.id ?? 0),
        ok: false,
        error: stable
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("PC Runtime Bridge did not bind a TCP endpoint");
  }
  await writeFile(
    endpointFile,
    `${JSON.stringify({ host: "127.0.0.1", port: address.port, process_id: process.pid })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );

  ctx.effect(() => async () => {
    if (ctx.agents.create === create) ctx.agents.create = originalCreate;
    if (ctx.agents.resume === resume) ctx.agents.resume = originalResume;
    await new Promise((resolve) => server.close(resolve));
    await rm(endpointFile, { force: true });
  });
}
