import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  IdentityAuthorizationService, ProfileCapabilityService,
  RuntimeRegistryService, HttpRuntimeCommandDispatcher
} from "../packages/application/src/index.js";
import {
  PostgresGatewayRepository, PostgresIdentityAuthorizationRepository,
  PostgresProfileCapabilityRepository, PostgresRuntimeRegistryRepository,
  PostgresEventProjectionRepository, PostgresResourceRepository
} from "../packages/persistence/src/index.js";
import { EventProjectionService } from "../packages/event-projection/src/index.js";
import { EeMcpGatewayProvider, mcpDigest, type ToolExecutionEnvelope } from "../packages/gateway/src/index.js";
import type { RuntimeCapabilityManifest, ToolRelease } from "../packages/domain/src/index.js";
import { ResourceWorkspaceService, LocalImmutableBlobStore, LocalWorkspaceMaterializer } from "../packages/resource/src/index.js";

const database = process.env.DATABASE_URL!;
assert(database.includes("@postgres:5432/pc_dev09a3"));
const mode = process.argv[2];
assert(["setup", "recover", "revoked"].includes(mode!));
const tenant = process.env.PC_PILOT_TENANT_ID!;
const endpoint = process.env.EE_MCP_ADAPTER_URL!;
const secret = process.env.EE_MCP_ADAPTER_SECRET!;
const provider = new EeMcpGatewayProvider(endpoint);
const identity = new IdentityAuthorizationService(new PostgresIdentityAuthorizationRepository(database),
  process.env.PC_ENVELOPE_SIGNING_KEY!);
const profiles = new ProfileCapabilityService(new PostgresProfileCapabilityRepository(database));
const registryRepository = new PostgresRuntimeRegistryRepository(database);
const registry = new RuntimeRegistryService(registryRepository, new HttpRuntimeCommandDispatcher());
const gateway = new PostgresGatewayRepository(database);
const eventRepository = new PostgresEventProjectionRepository(database);
const events = new EventProjectionService(eventRepository);
const resources = new ResourceWorkspaceService(new PostgresResourceRepository(database),
  new LocalImmutableBlobStore(process.env.PC_BLOB_ROOT!), new LocalWorkspaceMaterializer(process.env.PC_MATERIALIZATION_ROOT!));
let token = "";

async function request(path: string, body?: unknown, expected = 200) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json();
  assert(!JSON.stringify(payload).includes(secret), "Service secret in API response");
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(payload)}`);
  return payload;
}

interface State {
  envelope: ToolExecutionEnvelope;
  tool: ToolRelease;
  connector_id: string;
  account_binding_id: string;
  task_id: string;
}

try {
  await Promise.all([identity.initialize(), profiles.initialize(), registry.initialize(), gateway.initialize(), events.initialize(), resources.initialize()]);
  const signIn = await request("/v1/pilot/sign-in", { tenant_id: tenant,
    account_key: process.env.PC_PILOT_ACCOUNT_KEY, secret: process.env.PC_PILOT_ACCOUNT_SECRET });
  token = signIn.access_token;
  const { principal } = await request("/v1/identity/me");
  let state: State;
  if (mode === "setup") {
    const catalog = await provider.discover(secret);
    assert.equal(catalog.tools.length, 5);
    const discovered = catalog.tools.find((tool) => tool.tool_definition_id === "ee.list_functions")!;
    const tool = await profiles.getToolRelease(discovered.tool_release_id);
    assert(tool);
    const connector = await gateway.findConnectorForTool(tenant, tool.tool_release_id);
    assert(connector?.provider_key === "ee_mcp");
    const binding = await gateway.findExternalAccountBinding(tenant, connector.connector_id, principal.principal_id);
    assert.equal(binding?.external_account_id, process.env.PC_PILOT_EECLAW_ACCOUNT_ID);
    assert(binding);
    const revised = await identity.replaceAuthorizationGrants({ principal_id: principal.principal_id,
      expected_authorization_revision: principal.authorization_revision,
      grants: [{ action: "page:functions", scope_type: "project", scope_id: "EP37",
        effect: "allow", evidence_ref: "local-test:explicit-EP37-grant" }] });
    const suffix = randomUUID();
    const session = `pc-session-${suffix}`;
    const profile = await profiles.publishExpertProfile({ profile_release_id: `profile:ee-read:${suffix}`,
      profile_definition_id: "profile:ee-read", release_version: 1,
      instructions_ref: "test:read-instructions", rules_ref: "test:read-rules",
      tool_requirements: [tool.tool_release_id], plugin_requirements: [],
      model_policy: {}, knowledge_policy: {}, output_contract: {}, completion_contract: {},
      dependency_lock_digest: mcpDigest(catalog) });
    await profiles.assignProfile(principal.principal_id, profile.profile_release_id);
    const manifest: RuntimeCapabilityManifest = {
      contract_name: "pc.runtime-capability-manifest/1", contract_version: 1,
      runtime_id: `runtime-fixture-${suffix}`, runtime_epoch: 1, dsh_version: "0.2.1-rc.3",
      bridge_protocol_versions: ["1.0"], profile_digest: profile.release_digest,
      bundle_lock_digest: profile.dependency_lock_digest, plugin_releases: [], agent_presets: [],
      tool_provider_capabilities: [], persistence_capabilities: [], event_export_capabilities: [],
      approval_capabilities: [], resource_capabilities: [], limits: {}, generated_at: new Date().toISOString(),
      manifest_digest: mcpDigest({ suffix })
    };
    const resolved = await profiles.resolveEffectiveProfile({ principal_id: principal.principal_id,
      pc_session_id: session, requested_profile_release_id: profile.profile_release_id,
      authorization_revision: revised.authorization_revision, model_selection: {}, knowledge_view_refs: [],
      dsh_preset_ref: "registry-fixture-only", runtime_manifest: manifest });
    assert(resolved.snapshot);
    await registry.registerRuntime({ runtime_id: manifest.runtime_id, runtime_epoch: 1, tenant_id: tenant,
      owner_user_id: principal.principal_id, worker_pool_id: "local-fixture", state: "READY",
      profile_bundle_digest: manifest.profile_digest, endpoint_url: "http://127.0.0.1:1/no-runtime-started",
      capability_manifest: manifest });
    const uploaded = await resources.uploadResource({ tenant_id: tenant, principal_id: principal.principal_id,
      kind: "UPLOAD", display_name: "local-test-context.txt", classification: "INTERNAL",
      owner_scope: { scope_type: "USER_ROOT", scope_id: principal.principal_id }, media_type: "text/plain",
      content: new TextEncoder().encode("Local phase 3 verification context."),
      provenance: { source_system: "local-test", acquisition_operation: "upload" } });
    const resourceBinding = await resources.createBinding({ tenant_id: tenant, principal_id: principal.principal_id,
      resource_id: uploaded.resource.resource_id, scope: { scope_type: "USER_ROOT", scope_id: principal.principal_id },
      allowed_actions: ["READ"] });
    const workspace = await resources.createWorkspaceView({ tenant_id: tenant, principal_id: principal.principal_id,
      pc_session_id: session, authorization_revision: revised.authorization_revision,
      binding_ids: [resourceBinding.binding_id], allowed_actions: ["READ"], ttl_seconds: 300 });
    await resources.materialize({ tenant_id: tenant, principal_id: principal.principal_id,
      workspace_view_snapshot_id: workspace.workspace_view_snapshot_id,
      resource_refs: [{ resource_id: uploaded.resource.resource_id, resource_version_id: uploaded.version.resource_version_id }],
      purpose: "TOOL_INPUT", target_runtime_id: manifest.runtime_id, target_runtime_epoch: 1,
      pc_session_id: session, ttl_seconds: 300, allowed_actions: ["READ"] });
    // Phase 3 seeds Registry authority directly; no fake Runtime command or DSH success is used.
    const pending = await registryRepository.createPendingAssignment({ tenant_id: tenant,
      user_id: principal.principal_id, pc_session_id: session, runtime_id: manifest.runtime_id, runtime_epoch: 1,
      lease_duration_ms: 300_000, effective_profile_snapshot_id: resolved.snapshot.effective_profile_snapshot_id,
      workspace_view_snapshot_id: workspace.workspace_view_snapshot_id, authorization_revision: revised.authorization_revision
    }, new Date().toISOString(), new Date(Date.now() + 300_000).toISOString());
    const assignment = await registryRepository.transitionAssignment({ assignment_id: pending.assignment_id,
      expected_version: pending.version, expected_states: ["PENDING"], state: "ACTIVE", changed_at: new Date().toISOString() });
    const task = await events.createTask({ tenant_id: tenant, owner_principal_id: principal.principal_id,
      profile_release_id: profile.profile_release_id, project_id: "EP37", source_session_ids: [session] });
    const operation = await events.planOperation({ business_task_id: task.business_task_id, tenant_id: tenant,
      principal_id: principal.principal_id, operation_kind: "READ", recovery_class: "REPLAY_SAFE", input_digest: mcpDigest({}) });
    const authorization = await request("/v1/authorization/snapshots", { actions: ["page:functions"],
      resource_scope_refs: ["project:EP37"], tool_release_ids: [tool.tool_release_id], policy_model_revision: 1,
      profile_release_id: profile.profile_release_id, ttl_ms: 300_000 });
    assert.equal(authorization.decision, "ALLOW");
    const principalEnvelope = await request("/v1/principal-envelopes", { snapshot: authorization,
      audience: `gateway:${connector.connector_id}`, pc_session_id: session, business_task_id: task.business_task_id,
      runtime_id: assignment.runtime_id, runtime_epoch: 1, assignment_generation: assignment.assignment_generation,
      fencing_token: assignment.fencing_token, credential_generation: binding.credential_generation,
      resource_scope_refs: ["project:EP37"], ttl_ms: 300_000 });
    const envelope: ToolExecutionEnvelope = {
      contract_name: "pc.tool-execution-envelope/1", contract_version: 1,
      operation_id: operation.operation_id, idempotency_key: `key:${suffix}`, tool_release_id: tool.tool_release_id,
      schema_digest: tool.schema_digest, arguments: {}, argument_digest: mcpDigest({}),
      principal_envelope: principalEnvelope, assignment_snapshot_ref: assignment.assignment_id,
      workspace_view_snapshot_ref: workspace.workspace_view_snapshot_id,
      deadline: new Date(Date.now() + 300_000).toISOString(), recovery_class: "REPLAY_SAFE"
    };
    const result = await request("/v1/gateway/execute", envelope);
    assert.equal(result.status, "SUCCEEDED");
    assert.deepEqual(result.result.data.functions.map((row: { code: string }) => row.code), ["FN-EP37-001"]);
    assert(result.external_evidence_refs.length >= 2);
    assert(!JSON.stringify(result).includes("FN-EP38-001"));
    state = { envelope, tool, connector_id: connector.connector_id,
      account_binding_id: binding.external_account_binding_id, task_id: task.business_task_id };
    await writeFile("/evidence/state.json", JSON.stringify(state));

    const signedWrongSession = await request("/v1/principal-envelopes", { snapshot: authorization,
      audience: `gateway:${connector.connector_id}`, pc_session_id: session, runtime_id: assignment.runtime_id,
      runtime_epoch: 1, assignment_generation: assignment.assignment_generation + 1,
      fencing_token: assignment.fencing_token, credential_generation: binding.credential_generation,
      resource_scope_refs: ["project:EP37"] });
    const wrong = await request("/v1/gateway/execute", { ...envelope, operation_id: `wrong-${suffix}`,
      idempotency_key: `wrong-${suffix}`, principal_envelope: signedWrongSession }, 409);
    assert.equal(wrong.error.code, "PC_GATEWAY_ASSIGNMENT_STALE");
    const tampered = await request("/v1/gateway/execute", { ...envelope, principal_envelope: {
      ...envelope.principal_envelope, subject_principal_id: "another-principal" } }, 403);
    assert.equal(tampered.error.code, "PC_GATEWAY_PRINCIPAL_SCOPE_DENIED");
    await gateway.revokeExternalAccountBinding({ binding_id: binding.external_account_binding_id,
      tenant_id: tenant, principal_id: principal.principal_id, expected_generation: 1,
      revoked_at: new Date().toISOString() });
    const wrongBinding = { ...binding, external_account_binding_id: `wrong-binding-${suffix}`,
      external_account_id: "999999" };
    await gateway.putExternalAccountBinding(wrongBinding);
    try {
      const mismatch = await request("/v1/gateway/execute", { ...envelope, operation_id: `account-${suffix}`,
        idempotency_key: `account-${suffix}` }, 403);
      assert.equal(mismatch.error.code, "PC_GATEWAY_EXTERNAL_IDENTITY_MISMATCH");
    } finally {
      await gateway.revokeExternalAccountBinding({ binding_id: wrongBinding.external_account_binding_id,
        tenant_id: tenant, principal_id: principal.principal_id, expected_generation: 1,
        revoked_at: new Date().toISOString() });
      await gateway.putExternalAccountBinding({ ...binding, external_account_binding_id: `restored-binding-${suffix}` });
    }
  } else {
    state = JSON.parse(await readFile("/evidence/state.json", "utf8"));
    const catalog = await provider.discover(secret);
    const registered = await gateway.findConnectorForTool(tenant, state.tool.tool_release_id);
    assert.equal(registered?.connector_id, state.connector_id, "Restart duplicated Connector");
    assert(catalog.tools.some((tool) => tool.tool_release_id === state.tool.tool_release_id));
    if (mode === "recover") {
      const replay = await request("/v1/gateway/execute", state.envelope);
      assert.equal(replay.status, "SUCCEEDED");
    } else {
      const denied = await request("/v1/gateway/execute", { ...state.envelope,
        operation_id: `revoked-${randomUUID()}`, idempotency_key: `revoked-${randomUUID()}` }, 403);
      assert.equal(denied.error.code, "PC_GATEWAY_AUTHORIZATION_DENIED");
      const connector = await gateway.getConnector(state.connector_id);
      const operation = await gateway.getOperation(state.envelope.operation_id);
      assert(connector && operation?.mcp_binding_id);
      const mcp = await gateway.getMcpSessionBinding(operation.mcp_binding_id);
      assert(mcp);
      await assert.rejects(provider.dispatch({ connector, operation_id: `revoked-direct-${randomUUID()}`,
        idempotency_key: `revoked-direct-${randomUUID()}`,
        tool: state.tool, arguments: {}, access_token: secret, deadline: new Date(Date.now() + 30_000).toISOString(),
        mcp_binding: mcp, external_account_id: process.env.PC_PILOT_EECLAW_ACCOUNT_ID!,
        principal_id: principal.principal_id, pc_session_id: state.envelope.principal_envelope.pc_session_id,
        resource_scope_refs: ["project:EP37"], authorization_revision: mcp.authorization_revision
      }), { code: "PC_MCP_TOOL_REJECTED", outcome_unknown: false });
    }
  }
  const ledger = await gateway.getOperation(state.envelope.operation_id);
  const projection = await events.getOperation(state.envelope.operation_id);
  const audit = await gateway.listAudit(state.envelope.operation_id);
  const taskEvents = await eventRepository.listTaskEvents(state.task_id);
  assert.equal(ledger?.outcome_state, "KNOWN_SUCCESS");
  assert.equal(projection?.state, "VERIFYING");
  assert.equal(projection.external_operation_record_id, ledger.operation_id);
  assert(taskEvents.length > 0 && audit.length > 0);
  const evidence = { mode, ledger, projection, audit, task_events: taskEvents };
  assert(!JSON.stringify(evidence).includes(secret));
  assert(!JSON.stringify(evidence).includes(process.env.EECLAW_ADAPTER_SECRET!));
  await writeFile(`/evidence/${mode}.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ mode, status: "PASS", tool: state.tool.tool_definition_id,
    ledger: ledger.outcome_state, projection: projection.state, trace_refs: ledger.evidence_refs,
    audit_entries: audit.length, persisted_task_events: taskEvents.length }));
} finally {
  await Promise.all([identity.close(), profiles.close(), registry.close(), gateway.close(), events.close(), resources.close()]);
}
