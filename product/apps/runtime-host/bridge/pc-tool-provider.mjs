import { createHash } from "node:crypto";

const presetRegistrations = new WeakMap();
export async function registerToolPresets(registry, ids, owner = registry) {
  let registered = presetRegistrations.get(owner);
  if (!registered) { registered = new Map(); presetRegistrations.set(owner, registered); }
  for (const id of new Set(ids)) {
    if (!/^pc-[a-f0-9]{64}$/u.test(id)) throw new Error("PC_RUNTIME_TOOL_CONTEXT_INVALID");
    if (!registered.has(id)) {
      const pending = Promise.resolve().then(() => registry.register({ id, plugins: [] }));
      registered.set(id, pending);
      pending.catch(() => registered.delete(id));
    }
    await registered.get(id);
  }
}

export function publicName(releaseId) {
  return `pc_${createHash("sha256").update(releaseId).digest("hex").slice(0, 24)}`;
}

export function bindingIdentity(context) {
  return JSON.stringify({ snapshot: context.effective_profile_snapshot_id,
    preset: context.dsh_preset_ref, tools: context.tools });
}

export function validateToolContext(context, assignment) {
  const envelope = context?.principal_envelope;
  if (!assignment || !envelope || !Array.isArray(context.tools)
    || !context.effective_profile_snapshot_id || !context.dsh_preset_ref
    || envelope.pc_session_id !== assignment.pcSessionId
    || envelope.runtime_id !== assignment.runtimeId
    || envelope.runtime_epoch !== assignment.runtimeEpoch
    || envelope.assignment_generation !== assignment.assignmentGeneration
    || envelope.fencing_token !== assignment.fencingToken
    || envelope.authorization_revision !== assignment.authorizationRevision
    || Date.parse(envelope.expires_at) <= Date.now()
    || !Number.isFinite(Date.parse(envelope.expires_at))) {
    throw new Error("PC_RUNTIME_TOOL_CONTEXT_STALE");
  }
  const names = new Set();
  for (const tool of context.tools) {
    if (!tool.tool_release_id || !tool.schema_digest || !tool.name
      || !tool.input_schema || names.has(tool.tool_release_id)) {
      throw new Error("PC_RUNTIME_TOOL_CATALOG_INVALID");
    }
    names.add(tool.tool_release_id);
  }
}

export function toolDescription(tool) {
  const fields = Object.keys(tool.input_schema.properties ?? {});
  return `${tool.name}: ${tool.description ?? tool.name} `
    + (fields.length ? `Argument fields: ${fields.join(", ")}. ` : "This tool takes no arguments; call it with {}. ")
    + "Invoke this registered function directly. Do not pass an MCP name/arguments wrapper or a project_code; the server binds identity and project. "
    + "If arguments are rejected, correct them using this schema. Cite only actual successful tool results.";
}

export async function callGovernedTool({ tool, context, current, endpoint }, args, execution) {
  const binding = current();
  if (!binding || bindingIdentity(binding) !== bindingIdentity(context)) {
    throw new Error("PC_RUNTIME_TOOL_CONTEXT_STALE");
  }
  const fields = Object.keys(tool.input_schema.properties ?? {});
  // Reject wrapper/identity keys before dispatch; EE remains the full schema authority.
  if (!args || typeof args !== "object" || Array.isArray(args)
    || tool.input_schema.additionalProperties === false && Object.keys(args).some(key => !fields.includes(key))) {
    throw new Error(`PC_RUNTIME_TOOL_ARGUMENT_INVALID: ${toolDescription(tool)}`);
  }
  const response = await fetch(endpoint, { method: "POST", redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: binding, tool_release_id: tool.tool_release_id,
      call_id: String(execution.callId), arguments: args }),
    signal: AbortSignal.any([execution.signal, AbortSignal.timeout(60_000)]) });
  if (!response.ok) throw new Error(`PC_RUNTIME_TOOL_DENIED_${response.status}`);
  return response.json();
}

export async function composeToolProvider(ctx, agent, context, current) {
  const { createMcpToolDefinition } = await import("/opt/dsh/packages/mcp/mcp-client/src/tools.ts");
  const endpoint = process.env.PC_RUNTIME_TOOL_URL;
  if (!endpoint || !/^https?:\/\//u.test(endpoint)) throw new Error("PC_RUNTIME_TOOL_URL_REQUIRED");
  await ctx.agentPresets.mount(agent.ctx, sessionPresetId(context, agent.session.header.agentPreset));
  const globalTools = ctx.tools.schemas(agent).map((tool) => tool.name);
  if (globalTools.length) agent.ctx.tools.restrict({ deny: globalTools });
  for (const tool of context.tools) {
    agent.ctx.tools.register(createMcpToolDefinition(agent.ctx, {
      name: publicName(tool.tool_release_id), rawName: tool.name,
      description: toolDescription(tool),
      inputSchema: tool.input_schema,
      call: (args, execution) => callGovernedTool({ tool, context, current, endpoint }, args, execution)
    }));
  }
}

export function presetId(context) {
  return `pc-${createHash("sha256").update(bindingIdentity(context)).digest("hex")}`;
}

export function sessionPresetId(context, stored) {
  if (stored === presetId(context)) return stored;
  if (/^pc-[a-f0-9]{64}$/u.test(stored ?? "") && context.compatible_session_presets?.includes(stored)) return stored;
  throw new Error("PC_RUNTIME_PRESET_MISMATCH");
}
