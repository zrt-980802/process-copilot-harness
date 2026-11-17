import { readFile, writeFile } from "node:fs/promises";

const apiBase = process.env.PC_VERIFY_API_BASE ?? "http://api:3000";
const statePath = process.env.PC_VERIFY_STATE
  ?? "/var/lib/process-copilot/verification/dev09-state.json";
const mode = process.argv[2] ?? "setup";

async function request(path, options = {}, expected = [200]) {
  const response = await fetch(`${apiBase}${path}`, options);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!expected.includes(response.status)) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${response.status}: `
      + `${JSON.stringify(body)}`
    );
  }
  return { status: response.status, body, headers: response.headers };
}

async function signIn() {
  return (await request("/v1/pilot/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_id: "tenant_dev09",
      account_key: "pilot.dev09",
      secret: "LocalDev09Secret123"
    })
  })).body;
}

function authenticated(token, body, method = "POST") {
  return {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

async function upload(token, displayName, content) {
  return (await request("/v1/resources/uploads", authenticated(token, {
    kind: "UPLOAD",
    display_name: displayName,
    classification: "INTERNAL",
    owner_scope: {
      scope_type: "USER_ROOT",
      scope_id: (await request(
        "/v1/identity/me",
        authenticated(token, undefined, "GET")
      )).body.principal.principal_id
    },
    media_type: "text/markdown",
    content_base64: Buffer.from(content).toString("base64"),
    provenance: {
      source_system: "dev09-verifier",
      acquisition_operation: `upload-${displayName}`
    }
  }), [201])).body;
}

async function setup() {
  const signedIn = await signIn();
  const token = signedIn.access_token;
  const [prd, architecture] = await Promise.all([
    upload(token, "prd.md", "# PRD\nDEV-09 local product closure."),
    upload(
      token,
      "architecture.md",
      "# Architecture\nPostgreSQL is the product authority."
    )
  ]);
  const workspace = (await request("/v1/ssts-tasks", authenticated(token, {
    title: "DEV-09 Local SSTS"
  }), [201])).body;
  for (const input of [
    {
      slot: "PRD",
      resource_id: prd.resource.resource_id,
      resource_version_id: prd.version.resource_version_id
    },
    {
      slot: "ARCHITECTURE",
      resource_id: architecture.resource.resource_id,
      resource_version_id: architecture.version.resource_version_id
    }
  ]) {
    await request(
      `/v1/ssts-tasks/${workspace.workspace_id}/inputs`,
      authenticated(token, input),
      [201]
    );
  }
  await request(
    `/v1/ssts-tasks/${workspace.workspace_id}/messages`,
    authenticated(token, {
      content: "Keep recovery and human review explicit."
    }),
    [201]
  );
  const first = (await request(
    `/v1/ssts-tasks/${workspace.workspace_id}/drafts/generate`,
    authenticated(token, { idempotency_key: "dev09-local-generation-1" }),
    [201]
  )).body;
  const replay = (await request(
    `/v1/ssts-tasks/${workspace.workspace_id}/drafts/generate`,
    authenticated(token, { idempotency_key: "dev09-local-generation-1" }),
    [201]
  )).body;
  if (replay.draft.draft_id !== first.draft.draft_id) {
    throw new Error("Idempotent generation created a duplicate Draft");
  }
  await request(
    `/v1/ssts-tasks/${workspace.workspace_id}/drafts/${first.draft.draft_id}/review`,
    authenticated(token, {
      decision: "REJECTED",
      comment: "Generate a second immutable revision."
    })
  );
  const second = (await request(
    `/v1/ssts-tasks/${workspace.workspace_id}/drafts/generate`,
    authenticated(token, { idempotency_key: "dev09-local-generation-2" }),
    [201]
  )).body;
  if (second.draft.revision !== 2) {
    throw new Error("Rejected Draft did not produce revision 2");
  }
  await request(
    `/v1/ssts-tasks/${workspace.workspace_id}/drafts/${second.draft.draft_id}/review`,
    authenticated(token, { decision: "ACCEPTED" })
  );
  const acceptedProjection = (await request(
    `/v1/ssts-tasks/${workspace.workspace_id}`,
    authenticated(token, undefined, "GET")
  )).body;
  const download = await request(
    `/v1/ssts-tasks/${workspace.workspace_id}/drafts/${second.draft.draft_id}/download`,
    authenticated(token, undefined, "GET")
  );
  if (!download.body.includes("# AI DRAFT - SSTS")) {
    throw new Error("Downloaded artifact is not the generated SSTS Draft");
  }
  const state = {
    workspace_id: workspace.workspace_id,
    draft_id: second.draft.draft_id,
    artifact_resource_version_id:
      second.draft.artifact_ref.resource_version_id,
    content_digest: second.draft.content_digest
  };
  await writeFile(statePath, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({
    mode,
    workspace_state: acceptedProjection.workspace.state,
    draft_revision: second.draft.revision,
    validation_status: second.draft.validation.status,
    citation_count: second.draft.citations.length,
    idempotent_replay: true,
    accepted: true,
    downloaded: true
  }, null, 2));
}

async function recover() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const signedIn = await signIn();
  const token = signedIn.access_token;
  const projection = (await request(
    `/v1/ssts-tasks/${state.workspace_id}`,
    authenticated(token, undefined, "GET")
  )).body;
  const draft = projection.drafts.find(
    (candidate) => candidate.draft_id === state.draft_id
  );
  const review = projection.reviews.find(
    (candidate) => candidate.draft_id === state.draft_id
  );
  if (
    projection.workspace.state !== "ACCEPTED"
    || draft?.artifact_ref.resource_version_id
      !== state.artifact_resource_version_id
    || draft?.content_digest !== state.content_digest
    || review?.decision !== "ACCEPTED"
    || projection.messages.length !== 1
  ) {
    throw new Error("Recovered SSTS projection does not match durable state");
  }
  const download = await request(
    `/v1/ssts-tasks/${state.workspace_id}/drafts/${state.draft_id}/download`,
    authenticated(token, undefined, "GET")
  );
  if (!download.body.includes("# AI DRAFT - SSTS")) {
    throw new Error("Recovered Draft artifact download failed");
  }
  console.log(JSON.stringify({
    mode,
    workspace_state: projection.workspace.state,
    inputs: projection.inputs.length,
    messages: projection.messages.length,
    drafts: projection.drafts.length,
    reviews: projection.reviews.length,
    recovered_download: true
  }, null, 2));
}

if (mode === "setup") {
  await setup();
} else if (mode === "recover") {
  await recover();
} else {
  throw new Error(`Unsupported verification mode: ${mode}`);
}
