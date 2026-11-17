import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const apiBase = process.env.PC_VERIFY_API_BASE ?? "http://api:3000";
const runtimeBase =
  process.env.PC_VERIFY_RUNTIME_BASE ?? "http://runtime-host:3100";
const ingestSecret = process.env.PC_EVENT_INGEST_SECRET;
const statePath = process.env.PC_VERIFY_STATE
  ?? "/var/lib/process-copilot/verification/dev08-state.json";
const mode = process.argv[2] ?? "setup";

if (ingestSecret === undefined || ingestSecret.length < 24) {
  throw new Error("PC_EVENT_INGEST_SECRET is required");
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

async function request(path, options = {}, expected = [200]) {
  const response = await fetch(`${apiBase}${path}`, options);
  const text = await response.text();
  const body = text === "" ? {} : JSON.parse(text);
  if (!expected.includes(response.status)) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${response.status}: ${text}`
    );
  }
  return { status: response.status, body };
}

async function runtime(path) {
  const response = await fetch(`${runtimeBase}${path}`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Runtime ${path} returned ${response.status}`);
  }
  return body;
}

async function signIn() {
  return (await request("/v1/pilot/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "tenant_dev08",
      account_key: "pilot.dev08",
      secret: "LocalDev08Secret123"
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

function event(input) {
  const payload = input.payload ?? {};
  return {
    contract_name: "pc.event-envelope/1",
    contract_version: 1,
    event_id: input.event_id,
    event_type: input.event_type,
    event_schema_version: 1,
    producer: input.producer ?? "pc-control-plane",
    producer_version: "1.0.0",
    tenant_id: "tenant_dev08",
    principal_id: input.principal_id,
    stream_kind: input.stream_kind,
    stream_id: input.stream_id,
    stream_sequence: input.stream_sequence,
    ...(input.aggregate_revision === undefined
      ? {}
      : { aggregate_revision: input.aggregate_revision }),
    ...(input.business_task_id === undefined
      ? {}
      : { business_task_id: input.business_task_id }),
    ...(input.operation_id === undefined
      ? {}
      : { operation_id: input.operation_id }),
    durability: "DURABLE_PC",
    occurred_at: "2026-11-10T16:00:00.000Z",
    observed_at: "2026-11-10T16:00:00.000Z",
    payload,
    payload_digest: digest(payload)
  };
}

async function ingest(events, secret = ingestSecret, expected = [202]) {
  return request("/v1/events/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pc-event-secret": secret
    },
    body: JSON.stringify({ events })
  }, expected);
}

async function createTask(token, profileReleaseId) {
  return (await request(
    "/v1/business-tasks",
    authenticated(token, {
      profile_release_id: profileReleaseId,
      source_session_ids: []
    }),
    [201]
  )).body;
}

async function setup() {
  const runtimeCapabilities = await runtime("/capabilities");
  const runtimeHealth = await runtime("/health");
  if (
    runtimeCapabilities.stage !== "DEV-08"
    || runtimeCapabilities.event_export?.push_ingestion !== true
    || runtimeHealth.event_export?.configured !== true
  ) {
    throw new Error("Runtime Event Exporter is not configured for DEV-08");
  }

  const signedIn = await signIn();
  const token = signedIn.access_token;
  const principalId = signedIn.principal.principal_id;
  const denied = await ingest([], "wrong-secret", [403]);
  if (denied.body.error?.code !== "PC_EVENT_INGEST_DENIED") {
    throw new Error("Event ingestion did not fail closed");
  }

  const task = await createTask(token, "profile-dev08-main");
  await request(
    `/v1/business-tasks/${task.business_task_id}/state`,
    authenticated(token, { state: "READY" })
  );
  await request(
    `/v1/business-tasks/${task.business_task_id}/state`,
    authenticated(token, { state: "RUNNING" })
  );

  const runtimeEvents = [
    event({
      event_id: "dev08-runtime-event-1",
      event_type: "dsh.turn/start",
      producer: "pc-runtime-bridge",
      principal_id: principalId,
      stream_kind: "SESSION",
      stream_id: "session-dev08-runtime",
      stream_sequence: 1,
      business_task_id: task.business_task_id,
      payload: { turn: 0 }
    }),
    event({
      event_id: "dev08-runtime-event-2",
      event_type: "dsh.turn/end",
      producer: "pc-runtime-bridge",
      principal_id: principalId,
      stream_kind: "SESSION",
      stream_id: "session-dev08-runtime",
      stream_sequence: 2,
      business_task_id: task.business_task_id,
      payload: { turn: 0, reason: { kind: "completed" } }
    })
  ];
  const runtimeAccepted = await ingest(runtimeEvents);
  if (!runtimeAccepted.body.results.every((result) => result.status === "APPLIED")) {
    throw new Error("Runtime technical events were not applied");
  }

  const gapTask = await createTask(token, "profile-dev08-gap");
  const future = event({
    event_id: "dev08-gap-started",
    event_type: "pc.task.started",
    principal_id: principalId,
    stream_kind: "TASK",
    stream_id: gapTask.business_task_id,
    stream_sequence: 3,
    aggregate_revision: 3,
    business_task_id: gapTask.business_task_id
  });
  const pending = await ingest([future]);
  if (pending.body.results[0]?.status !== "PENDING") {
    throw new Error("Out-of-order event did not remain pending");
  }
  const incomplete = (await request(
    `/v1/business-tasks/${gapTask.business_task_id}`,
    { headers: { authorization: `Bearer ${token}` } }
  )).body.task;
  if (incomplete.projection_complete !== false) {
    throw new Error("Gap did not mark the projection incomplete");
  }
  const ready = event({
    event_id: "dev08-gap-ready",
    event_type: "pc.task.ready",
    principal_id: principalId,
    stream_kind: "TASK",
    stream_id: gapTask.business_task_id,
    stream_sequence: 2,
    aggregate_revision: 2,
    business_task_id: gapTask.business_task_id
  });
  await ingest([ready]);
  const duplicate = await ingest([ready]);
  if (duplicate.body.results[0]?.status !== "DUPLICATE") {
    throw new Error("Duplicate event did not converge");
  }
  const conflict = event({
    ...ready,
    event_id: "dev08-gap-ready-conflict",
    payload: { conflict: true }
  });
  const quarantined = await ingest([conflict]);
  if (quarantined.body.results[0]?.status !== "QUARANTINED") {
    throw new Error("Sequence conflict was not quarantined");
  }
  const repaired = (await request(
    `/v1/business-tasks/${gapTask.business_task_id}`,
    { headers: { authorization: `Bearer ${token}` } }
  )).body.task;
  if (repaired.state !== "RUNNING" || repaired.projection_complete !== true) {
    throw new Error("Gap repair did not drain the pending event");
  }

  const operation = (await request(
    `/v1/business-tasks/${task.business_task_id}/operations`,
    authenticated(token, {
      operation_id: "dev08-operation-unknown",
      operation_kind: "WRITE",
      recovery_class: "RECONCILE_BEFORE_RETRY",
      input_digest: digest({ operation: "dev08-operation-unknown" })
    }),
    [201]
  )).body;
  await ingest([
    event({
      event_id: "dev08-operation-dispatching",
      event_type: "pc.operation.dispatching",
      principal_id: principalId,
      stream_kind: "OPERATION",
      stream_id: operation.operation_id,
      stream_sequence: 2,
      aggregate_revision: 2,
      business_task_id: task.business_task_id,
      operation_id: operation.operation_id
    }),
    event({
      event_id: "dev08-operation-unknown",
      event_type: "pc.operation.outcome_unknown",
      principal_id: principalId,
      stream_kind: "OPERATION",
      stream_id: operation.operation_id,
      stream_sequence: 3,
      aggregate_revision: 3,
      business_task_id: task.business_task_id,
      operation_id: operation.operation_id
    })
  ]);
  const recovery = (await request(
    "/v1/recovery-cases",
    authenticated(token, {
      business_task_id: task.business_task_id,
      trigger: "OUTCOME_UNKNOWN",
      affected_operation_ids: [operation.operation_id],
      affected_runtime_id: "runtime-dev08-old",
      affected_session_id: "session-dev08-runtime"
    }),
    [201]
  )).body;
  const rebuilt = (await request(
    `/v1/business-tasks/${task.business_task_id}/rebuild`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    }
  )).body;
  if (!rebuilt.digest_matches || rebuilt.checkpoint.source_event_count < 8) {
    throw new Error("Projection rebuild did not include durable source events");
  }

  const state = {
    task_id: task.business_task_id,
    gap_task_id: gapTask.business_task_id,
    operation_id: operation.operation_id,
    recovery_case_id: recovery.recovery_case_id,
    runtime_events: runtimeEvents
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    mode,
    event_ingest_denied: true,
    runtime_event_count: runtimeEvents.length,
    gap_repaired: true,
    duplicate_converged: true,
    sequence_conflict_quarantined: true,
    projection_source_event_count: rebuilt.checkpoint.source_event_count,
    recovery_state: recovery.state,
    ...state
  }));
}

async function recover() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const signedIn = await signIn();
  const token = signedIn.access_token;
  const task = (await request(`/v1/business-tasks/${state.task_id}`, {
    headers: { authorization: `Bearer ${token}` }
  })).body;
  const gapTask = (await request(`/v1/business-tasks/${state.gap_task_id}`, {
    headers: { authorization: `Bearer ${token}` }
  })).body.task;
  const recovery = (await request(
    `/v1/recovery-cases/${state.recovery_case_id}`,
    { headers: { authorization: `Bearer ${token}` } }
  )).body;
  const duplicate = await ingest(state.runtime_events);
  const rebuilt = (await request(
    `/v1/business-tasks/${state.task_id}/rebuild`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    }
  )).body;
  if (
    task.operations[0]?.state !== "OUTCOME_UNKNOWN"
    || gapTask.state !== "RUNNING"
    || recovery.state !== "RECOVERY_PENDING"
    || !duplicate.body.results.every((result) => result.status === "DUPLICATE")
    || !rebuilt.digest_matches
  ) {
    throw new Error("DEV-08 restart recovery verification failed");
  }
  console.log(JSON.stringify({
    mode,
    task_state: task.task.state,
    operation_state: task.operations[0].state,
    gap_task_state: gapTask.state,
    recovery_state: recovery.state,
    duplicate_runtime_events: duplicate.body.results.length,
    rebuild_digest_matches: rebuilt.digest_matches
  }));
}

if (mode === "setup") await setup();
else if (mode === "recover") await recover();
else throw new Error(`Unsupported verification mode: ${mode}`);
