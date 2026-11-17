import {
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";

const apiBase = process.env.PC_VERIFY_API_BASE ?? "http://127.0.0.1:3000";
const runtimeBase = process.env.PC_VERIFY_RUNTIME_BASE ?? "http://runtime-host:3100";
const statePath = process.env.PC_VERIFY_STATE
  ?? "/var/lib/process-copilot/verification/dev06-state.json";
const mode = process.argv[2] ?? "setup";

async function request(path, options = {}, expected = [200]) {
  const response = await fetch(`${apiBase}${path}`, options);
  const body = await response.json();
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return { status: response.status, body };
}

async function runtime(path) {
  const response = await fetch(`${runtimeBase}${path}`);
  if (!response.ok) throw new Error(`Runtime ${path} returned ${response.status}`);
  return response.json();
}

async function signIn() {
  return (await request("/v1/pilot/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "tenant_dev06",
      account_key: "pilot.dev06",
      secret: "LocalDev06Secret123"
    })
  })).body;
}

function authenticated(token, body) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

async function registerRuntime(principalId, epoch) {
  const capabilities = await runtime("/capabilities");
  return request("/v1/runtimes/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtime_id: "pc-runtime-dev06-local",
      runtime_epoch: epoch,
      tenant_id: "tenant_dev06",
      owner_user_id: principalId,
      worker_pool_id: "dev06-local",
      state: "READY",
      profile_bundle_digest: "process-copilot-runtime-dev04",
      endpoint_url: "http://runtime-host:3100",
      capability_manifest: {
        contract_name: "pc.runtime-capability-manifest/1",
        contract_version: 1,
        runtime_id: "pc-runtime-dev06-local",
        runtime_epoch: epoch,
        dsh_version: capabilities.dsh_version,
        bridge_protocol_versions: [capabilities.bridge_protocol_version],
        profile_digest: "process-copilot-runtime-dev04",
        bundle_lock_digest: "dev06-local",
        plugin_releases: ["pc-runtime-bridge"],
        agent_presets: [],
        tool_provider_capabilities: [],
        persistence_capabilities: ["session-jsonl"],
        event_export_capabilities: ["catch-up"],
        approval_capabilities: [],
        resource_capabilities: ["workspace-view-v1", "materialization-v1"],
        limits: {},
        generated_at: new Date().toISOString(),
        manifest_digest: `dev06-local-${epoch}`
      }
    })
  }, [201]);
}

async function createView(token, principal, bindingId, sessionId) {
  return (await request(
    "/v1/workspace-view-snapshots",
    authenticated(token, {
      pc_session_id: sessionId,
      authorization_revision: principal.authorization_revision,
      binding_ids: [bindingId],
      allowed_actions: ["READ"],
      ttl_seconds: 3600
    }),
    [201]
  )).body;
}

async function materialize(token, view, resourceRef, sessionId, epoch, ttlSeconds) {
  return (await request(
    "/v1/materializations",
    authenticated(token, {
      workspace_view_snapshot_id: view.workspace_view_snapshot_id,
      resource_refs: [resourceRef],
      purpose: "RUNTIME_INPUT",
      target_runtime_id: "pc-runtime-dev06-local",
      target_runtime_epoch: epoch,
      pc_session_id: sessionId,
      ttl_seconds: ttlSeconds,
      allowed_actions: ["READ"]
    }),
    [201]
  )).body;
}

async function assign(principal, view, sessionId, epoch, expected = [201]) {
  return request("/v1/session-assignments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "tenant_dev06",
      user_id: principal.principal_id,
      pc_session_id: sessionId,
      runtime_id: "pc-runtime-dev06-local",
      runtime_epoch: epoch,
      lease_duration_ms: 120000,
      effective_profile_snapshot_id: "profile-dev06-local",
      workspace_view_snapshot_id: view.workspace_view_snapshot_id,
      authorization_revision: principal.authorization_revision
    })
  }, expected);
}

async function setup() {
  const signedIn = await signIn();
  const token = signedIn.access_token;
  const principal = signedIn.principal;
  await registerRuntime(principal.principal_id, 1);
  const sessionId = "session_dev06_setup";
  const uploaded = (await request(
    "/v1/resources/uploads",
    authenticated(token, {
      pc_session_id: sessionId,
      kind: "UPLOAD",
      display_name: "dev06-input.txt",
      classification: "INTERNAL",
      owner_scope: { scope_type: "SESSION", scope_id: sessionId },
      media_type: "text/plain",
      content_base64: Buffer.from("immutable dev06 content").toString("base64"),
      provenance: {
        source_system: "dev06-local-verification",
        acquisition_operation: "upload"
      }
    }),
    [201]
  )).body;
  const binding = (await request(
    "/v1/resource-bindings",
    authenticated(token, {
      pc_session_id: sessionId,
      resource_id: uploaded.resource.resource_id,
      scope: { scope_type: "SESSION", scope_id: sessionId },
      allowed_actions: ["READ"]
    }),
    [201]
  )).body;
  const view = await createView(token, principal, binding.binding_id, sessionId);
  const denied = await assign(principal, view, sessionId, 1, [403]);
  if (denied.body.error?.code !== "PC_RESOURCE_MATERIALIZATION_REQUIRED") {
    throw new Error(`Unexpected pre-materialization decision: ${JSON.stringify(denied.body)}`);
  }
  const resourceRef = {
    resource_id: uploaded.resource.resource_id,
    resource_version_id: uploaded.version.resource_version_id
  };
  const materialization = await materialize(
    token,
    view,
    resourceRef,
    sessionId,
    1,
    600
  );
  const assigned = await assign(principal, view, sessionId, 1);
  const shortLived = await materialize(
    token,
    view,
    resourceRef,
    sessionId,
    1,
    1
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const cleanup = (await request(
    "/v1/materializations/cleanup",
    authenticated(token, {})
  )).body;
  if (!cleanup.cleaned.some((entry) =>
    entry.materialization_id === shortLived.materialization_id
    && entry.cleanup_state === "CLEANED"
  )) {
    throw new Error("Short-lived Materialization was not cleaned");
  }
  const state = {
    principal_id: principal.principal_id,
    authorization_revision: principal.authorization_revision,
    resource_ref: resourceRef,
    content_digest: uploaded.version.content_digest,
    binding_id: binding.binding_id,
    first_workspace_view_snapshot_id: view.workspace_view_snapshot_id,
    first_materialization_id: materialization.materialization_id,
    first_assignment_id: assigned.body.assignment.assignment_id
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ mode, ...state }));
}

async function recover() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const signedIn = await signIn();
  const token = signedIn.access_token;
  const principal = signedIn.principal;
  if (principal.principal_id !== state.principal_id) {
    throw new Error("Principal identity changed after restart");
  }
  const projection = (await request(
    `/v1/resources/${state.resource_ref.resource_id}`,
    { headers: { authorization: `Bearer ${token}` } }
  )).body;
  const exactVersion = projection.versions.find((version) =>
    version.resource_version_id === state.resource_ref.resource_version_id
  );
  if (exactVersion?.content_digest !== state.content_digest) {
    throw new Error("Immutable ResourceVersion was not recovered");
  }
  await registerRuntime(principal.principal_id, 2);
  const sessionId = "session_dev06_recovery";
  const recoveryBinding = (await request(
    "/v1/resource-bindings",
    authenticated(token, {
      resource_id: state.resource_ref.resource_id,
      scope: { scope_type: "USER_ROOT", scope_id: principal.principal_id },
      allowed_actions: ["READ"]
    }),
    [201]
  )).body;
  const view = await createView(
    token,
    principal,
    recoveryBinding.binding_id,
    sessionId
  );
  const rematerialized = await materialize(
    token,
    view,
    state.resource_ref,
    sessionId,
    2,
    600
  );
  const assigned = await assign(principal, view, sessionId, 2);
  console.log(JSON.stringify({
    mode,
    resource_version_id: state.resource_ref.resource_version_id,
    content_digest: exactVersion.content_digest,
    recovery_workspace_view_snapshot_id: view.workspace_view_snapshot_id,
    recovery_materialization_id: rematerialized.materialization_id,
    recovery_assignment_id: assigned.body.assignment.assignment_id,
    runtime_epoch: 2
  }));
}

async function safety() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const signedIn = await signIn();
  const token = signedIn.access_token;
  const principal = signedIn.principal;
  const sessionId = `session_dev06_safety_${Date.now()}`;
  const binding = (await request(
    "/v1/resource-bindings",
    authenticated(token, {
      resource_id: state.resource_ref.resource_id,
      scope: { scope_type: "USER_ROOT", scope_id: principal.principal_id },
      allowed_actions: ["READ"]
    }),
    [201]
  )).body;
  const view = await createView(token, principal, binding.binding_id, sessionId);
  const materialization = await materialize(
    token,
    view,
    state.resource_ref,
    sessionId,
    2,
    1
  );
  const marker = "/var/lib/process-copilot/blobs/symlink-safety-marker";
  await mkdir(marker, { recursive: true });
  await writeFile(`${marker}/outside.txt`, "must survive cleanup\n", "utf8");
  const materializationRoot = [
    "/var/lib/process-copilot/materializations",
    "tenant_dev06",
    principal.principal_id,
    sessionId,
    "pc-runtime-dev06-local-2",
    materialization.materialization_id
  ].join("/");
  await symlink(marker, `${materializationRoot}/escape-link`, "dir");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const cleanup = (await request(
    "/v1/materializations/cleanup",
    authenticated(token, {})
  )).body;
  const cleaned = cleanup.cleaned.find((entry) =>
    entry.materialization_id === materialization.materialization_id
  );
  if (cleaned?.cleanup_state !== "CLEANED") {
    throw new Error("Symlink safety Materialization was not cleaned");
  }
  const markerStat = await stat(`${marker}/outside.txt`);
  let materializationRemoved = false;
  try {
    await stat(materializationRoot);
  } catch (error) {
    materializationRemoved = error?.code === "ENOENT";
  }
  if (!markerStat.isFile() || !materializationRemoved) {
    throw new Error("Cleanup followed a symlink or left the expired root");
  }
  console.log(JSON.stringify({
    mode,
    materialization_id: materialization.materialization_id,
    cleanup_state: cleaned.cleanup_state,
    outside_marker_preserved: true,
    expired_root_removed: true
  }));
}

if (mode === "setup") await setup();
else if (mode === "recover") await recover();
else if (mode === "safety") await safety();
else throw new Error(`Unsupported verification mode: ${mode}`);
