import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalRuntimeId = process.env.PC_RUNTIME_ID;
const originalRuntimeEpoch = process.env.PC_RUNTIME_EPOCH;

beforeEach(() => {
  process.env.PC_RUNTIME_ID = "runtime-1";
  process.env.PC_RUNTIME_EPOCH = "2";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalRuntimeId === undefined) delete process.env.PC_RUNTIME_ID;
  else process.env.PC_RUNTIME_ID = originalRuntimeId;
  if (originalRuntimeEpoch === undefined) delete process.env.PC_RUNTIME_EPOCH;
  else process.env.PC_RUNTIME_EPOCH = originalRuntimeEpoch;
});

describe("PC Runtime Bridge Assignment Guard", () => {
  const noArguments = { name: "ee.get_project_context", tool_release_id: "release:context",
    input_schema: { type: "object", properties: {}, additionalProperties: false } };
  it("rejects MCP wrappers and identity overrides with actionable feedback before network dispatch", async () => {
    const provider = await import("../bridge/pc-tool-provider.mjs");
    const context = { effective_profile_snapshot_id: "snapshot", dsh_preset_ref: "preset", tools: [noArguments] };
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    for (const args of [{ name: "ee.get_project_context" }, { arguments: {} }, { project_code: "EP38" }, null, []]) {
      await expect(provider.callGovernedTool({ tool: noArguments, context, current: () => context, endpoint: "http://gateway" },
        args, { callId: "call", signal: new AbortController().signal })).rejects.toThrow("call it with {}");
    }
    expect(send).not.toHaveBeenCalled();
    expect(provider.toolDescription(noArguments)).toContain("no arguments");
  });
  it("forwards corrected empty arguments with the current turn and preserves actual gateway failure", async () => {
    const provider = await import("../bridge/pc-tool-provider.mjs");
    const context = { effective_profile_snapshot_id: "snapshot", dsh_preset_ref: "preset", tools: [noArguments], turn_id: "old" };
    const current = { ...context, turn_id: "current" };
    const failure = { isError: true, structuredContent: { status: "FAILED", external_evidence_refs: [] } };
    const send = vi.fn(async () => new Response(JSON.stringify(failure)));
    vi.stubGlobal("fetch", send);
    expect(await provider.callGovernedTool({ tool: noArguments, context, current: () => current, endpoint: "http://gateway" },
      {}, { callId: "call", signal: new AbortController().signal })).toEqual(failure);
    const body = JSON.parse((send.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ context: current, arguments: {}, tool_release_id: noArguments.tool_release_id, call_id: "call" });
  });
  it("keeps parameterized arguments intact and refuses stale tool authority", async () => {
    const provider = await import("../bridge/pc-tool-provider.mjs");
    const tool = { ...noArguments, name: "ee.get_ssts", input_schema: { type: "object", properties: { ssts_code: { type: "string" } }, additionalProperties: false } };
    const context = { effective_profile_snapshot_id: "snapshot", dsh_preset_ref: "preset", tools: [tool] };
    const send = vi.fn(async () => new Response(JSON.stringify({ isError: false })));
    vi.stubGlobal("fetch", send);
    await provider.callGovernedTool({ tool, context, current: () => context, endpoint: "http://gateway" },
      { ssts_code: "SSTS-001" }, { callId: "call", signal: new AbortController().signal });
    expect(JSON.parse((send.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).arguments).toEqual({ ssts_code: "SSTS-001" });
    expect(provider.toolDescription(tool)).toContain("ssts_code");
    await expect(provider.callGovernedTool({ tool, context, current: () => ({ ...context, dsh_preset_ref: "other" }), endpoint: "http://gateway" },
      {}, { callId: "call", signal: new AbortController().signal })).rejects.toThrow("PC_RUNTIME_TOOL_CONTEXT_STALE");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("restores only an explicitly compatible persisted preset after bundle renewal", async () => {
    const provider = await import("../bridge/pc-tool-provider.mjs");
    const original = { effective_profile_snapshot_id: "old-snapshot", dsh_preset_ref: "same-profile", tools: [] };
    const stored = provider.presetId(original);
    const renewed = { ...original, effective_profile_snapshot_id: "new-snapshot", compatible_session_presets: [stored] };
    expect(provider.sessionPresetId(renewed, stored)).toBe(stored);
    expect(() => provider.sessionPresetId({ ...renewed, compatible_session_presets: [] }, stored)).toThrow("PC_RUNTIME_PRESET_MISMATCH");
    expect(() => provider.sessionPresetId(renewed, provider.presetId({ ...original, dsh_preset_ref: "different-profile" }))).toThrow("PC_RUNTIME_PRESET_MISMATCH");
    expect(provider.bindingIdentity(renewed)).not.toBe(provider.bindingIdentity(original));
    const registrations = new Set<string>();
    const registry = { register: async ({ id }: { id: string }) => {
      if (registrations.has(id)) throw new Error("Duplicate preset");
      registrations.add(id);
    } };
    const owner = {};
    await Promise.all([provider.registerToolPresets({ ...registry }, [stored, stored], owner), provider.registerToolPresets({ ...registry }, [stored], owner)]);
    expect(registrations.size).toBe(1);
  });
  it("accepts a fresh authority version for a higher generation while rejecting superseded fences", async () => {
    const bridge = await import("../bridge/pc-runtime-bridge.mjs");
    const released = { pcSessionId: "pc-session-replaced", dshSessionId: "dsh-session-replaced",
      runtimeId: "runtime-1", runtimeEpoch: 2, assignmentGeneration: 1, fencingToken: "8",
      leaseExpiresAt: "2026-11-10T00:01:00.000Z", state: "RELEASED", authorizationRevision: 1, authorityVersion: 50 };
    const assignments = new Map([[released.dshSessionId, released]]);
    const replacement = { ...released, assignmentGeneration: 2, fencingToken: "9", state: "PENDING", authorityVersion: 1 };
    expect(bridge.upsertAssignmentGuardSnapshot(assignments, replacement)).toEqual({ updated: true, idempotent: false });
    expect(bridge.upsertAssignmentGuardSnapshot(assignments, { ...replacement, state: "ACTIVE", authorityVersion: 2 })).toEqual({ updated: true, idempotent: false });
    expect(() => bridge.upsertAssignmentGuardSnapshot(assignments, { ...released, authorityVersion: 100 })).toThrow("assignment_generation is stale");
    expect(() => bridge.upsertAssignmentGuardSnapshot(assignments, { ...replacement, assignmentGeneration: 3, fencingToken: "7" })).toThrow("fencing_token is stale");
    expect(() => bridge.upsertAssignmentGuardSnapshot(assignments, replacement)).toThrow("authority_version is stale");
  });
  it("fails closed for missing, inactive, expired and stale-epoch authority", async () => {
    const bridge = await import("../bridge/pc-runtime-bridge.mjs");
    expect(bridge.evaluateAssignmentGuardSnapshot(undefined, "Step")).toMatchObject({
      allowed: false,
      code: "PC_RUNTIME_ASSIGNMENT_NOT_FOUND"
    });
    const active = {
      pcSessionId: "pc-session-1",
      dshSessionId: "dsh-session-1",
      runtimeId: "runtime-1",
      runtimeEpoch: 2,
      assignmentGeneration: 1,
      fencingToken: "5",
      leaseExpiresAt: "2026-11-10T00:01:00.000Z",
      state: "ACTIVE",
      authorizationRevision: 1,
      authorityVersion: 2
    };
    expect(bridge.evaluateAssignmentGuardSnapshot(
      active,
      "Step",
      Date.parse("2026-11-10T00:00:00.000Z")
    )).toMatchObject({
      allowed: true,
      code: "PC_RUNTIME_GUARD_ALLOWED"
    });
    expect(bridge.evaluateAssignmentGuardSnapshot(
      { ...active, state: "REVOKING" },
      "Tool",
      Date.parse("2026-11-10T00:00:00.000Z")
    )).toMatchObject({
      allowed: false,
      code: "PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE"
    });
    expect(bridge.evaluateAssignmentGuardSnapshot(
      active,
      "Tool",
      Date.parse("2026-11-10T00:02:00.000Z")
    )).toMatchObject({
      allowed: false,
      code: "PC_RUNTIME_LEASE_EXPIRED"
    });
    expect(bridge.evaluateAssignmentGuardSnapshot(
      { ...active, runtimeEpoch: 1 },
      "Step",
      Date.parse("2026-11-10T00:00:00.000Z")
    )).toMatchObject({
      allowed: false,
      code: "PC_RUNTIME_EPOCH_STALE"
    });
  });

  it("accepts monotonic snapshots and rejects stale or conflicting updates", async () => {
    const bridge = await import("../bridge/pc-runtime-bridge.mjs");
    const assignments = new Map();
    const first = {
      pcSessionId: "pc-session-1",
      dshSessionId: "dsh-session-1",
      runtimeId: "runtime-1",
      runtimeEpoch: 2,
      assignmentGeneration: 1,
      fencingToken: "5",
      leaseExpiresAt: "2026-11-10T00:01:00.000Z",
      state: "PENDING",
      authorizationRevision: 1,
      authorityVersion: 1
    };
    expect(bridge.upsertAssignmentGuardSnapshot(assignments, first)).toEqual({
      updated: true,
      idempotent: false
    });
    expect(bridge.upsertAssignmentGuardSnapshot(assignments, first)).toEqual({
      updated: false,
      idempotent: true
    });
    expect(() => bridge.upsertAssignmentGuardSnapshot(assignments, {
      ...first,
      state: "ACTIVE"
    })).toThrow("same authority_version carries different Assignment authority");
    expect(bridge.upsertAssignmentGuardSnapshot(assignments, {
      ...first,
      state: "ACTIVE",
      authorityVersion: 2
    })).toEqual({
      updated: true,
      idempotent: false
    });
    expect(() => bridge.upsertAssignmentGuardSnapshot(assignments, {
      ...first,
      authorityVersion: 1
    })).toThrow("authority_version is stale");
  });
});
