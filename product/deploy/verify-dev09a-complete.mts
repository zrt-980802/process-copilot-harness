import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { IdentityAuthorizationService } from "../packages/application/src/index.js";
import { PostgresIdentityAuthorizationRepository } from "../packages/persistence/src/index.js";

const mode = process.argv[2];
const identity = new IdentityAuthorizationService(new PostgresIdentityAuthorizationRepository(process.env.DATABASE_URL!), process.env.PC_ENVELOPE_SIGNING_KEY!);
const tenant = process.env.PC_PILOT_TENANT_ID!;
let token = "";
async function request(path: string, body?: unknown, expected = 200) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(650_000) });
  const payload = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(payload)}`);
  return payload;
}
async function login(account = "pilot.acceptance", secret = "LocalAcceptanceSecret123") {
  token = (await request("/v1/pilot/sign-in", { tenant_id: tenant, account_key: account, secret })).access_token;
  return (await request("/v1/identity/me")).principal;
}
try {
  await identity.initialize();
  let principal = await login();
  if (mode === "setup") {
    const catalog = await request("/v1/workbench/catalog?project_code=EP37");
    if (principal.authorization_revision === 1) assert.equal(catalog.tools.length, 0, "Unprovisioned project grants must deny Catalog");
    await identity.replaceAuthorizationGrants({ principal_id: principal.principal_id,
      expected_authorization_revision: principal.authorization_revision,
      grants: ["page:projects", "page:requirements", "page:functions", "page:architecture", "ee.ssts.review.request"].map((action) =>
        ({ action, scope_type: "project" as const, scope_id: "EP37", effect: "allow" as const, evidence_ref: "isolated-local:explicit-editor" })) });
    const reviewer = await identity.getPilotPrincipal(tenant, "reviewer.acceptance")
      ?? (await identity.provisionPilotAccount({ tenant_id: tenant, account_key: "reviewer.acceptance", secret: "LocalReviewerSecret123" })).principal;
    if (!await identity.resolveExternalSubject(reviewer.principal_id, "eeclaw")) await identity.linkVerifiedIdentity({ principal_id: reviewer.principal_id, identity_provider_ref: "eeclaw",
      issuer: process.env.EECLAW_ADAPTER_URL!, external_subject: process.env.PC_REVIEWER_EE_ACCOUNT_ID!,
      tenant_or_org_ref: tenant, verification_level: "admin_reauthentication", expected_identity_revision: reviewer.identity_revision });
    const linked = await identity.getPilotPrincipal(tenant, "reviewer.acceptance");
    assert(linked);
    await identity.replaceAuthorizationGrants({ principal_id: linked.principal_id,
      expected_authorization_revision: linked.authorization_revision,
      grants: ["approval.decide", "page:projects", "page:architecture"].map((action) =>
        ({ action, scope_type: "project" as const, scope_id: "EP37", effect: "allow" as const, evidence_ref: "isolated-local:explicit-reviewer" })) });
    principal = await login();
    const projects = await request("/v1/workbench/projects");
    assert.deepEqual(projects.items.map((item: { project_code: string }) => item.project_code), ["EP37"]);
    const visible = await request("/v1/workbench/catalog?project_code=EP37");
    assert.equal(visible.tools.length, 9, JSON.stringify(visible.tools.map((tool: { tool_definition_id: string }) => tool.tool_definition_id)));
    const workspace = await request("/v1/workbench/tasks", { title: "EP37 power monitoring SSTS", project_code: "EP37", function_code: "FN-EP37-001", mode: "REVIEW" }, 201);
    for (const [slot, content] of [["PRD", "# Power monitoring PRD\nFN-EP37-001 shall detect invalid power voltage within 100ms and preserve transition logs. Requirement REQ-000001."],
      ["ARCHITECTURE", "# Power monitoring architecture\nThe power control ECU publishes voltage and transition status over CAN. Diagnose stale signals, debounce noise, and expose explicit recovery criteria."]]) {
      const uploaded = await request("/v1/resources/uploads", { kind: "UPLOAD", display_name: `${slot}.md`, classification: "INTERNAL",
        owner_scope: { scope_type: "USER_ROOT", scope_id: principal.principal_id }, media_type: "text/markdown",
        content_base64: Buffer.from(content!).toString("base64"), provenance: { source_system: "local-acceptance", acquisition_operation: "upload" } }, 201);
      await request(`/v1/ssts-tasks/${workspace.workspace_id}/inputs`, { slot, resource_id: uploaded.resource.resource_id, resource_version_id: uploaded.version.resource_version_id }, 201);
    }
    const generated = await request(`/v1/ssts-tasks/${workspace.workspace_id}/drafts/generate`, { idempotency_key: "real-model-first" }, 201);
    assert.equal(generated.draft.validation.status, "PASSED");
    assert(generated.draft.source_refs.length >= 6, "Exact EE and uploaded versions required");
    const execution = await request(`/v1/workbench/tasks/${workspace.workspace_id}/execution`);
    assert(execution.events.length > 0 && execution.ledger.filter((item: { external?: { outcome_state: string } }) => item.external?.outcome_state === "KNOWN_SUCCESS").length >= 4);
    await writeFile("/evidence/state.json", JSON.stringify({ workspace, draft: generated.draft }));
    await writeFile("/evidence/execution.json", JSON.stringify(execution, null, 2));
    console.log("Real DSH + EE tools + exact-source SSTS generated", generated.draft.content_digest);
  } else {
    const state = JSON.parse(await readFile("/evidence/state.json", "utf8"));
    const id = state.workspace.workspace_id;
    const recovered = await request(`/v1/ssts-tasks/${id}`);
    assert.equal(recovered.drafts[0].content_digest, state.draft.content_digest);
    if (mode === "recover") {
      const catalog = await request("/v1/workbench/catalog?project_code=EP37");
      const tool = catalog.tools.find((item: { tool_definition_id: string }) => item.tool_definition_id === "ee.get_ssts");
      const read = await request(`/v1/workbench/tasks/${id}/tools`, { tool_release_id: tool.tool_release_id, arguments: { ssts_code: "SSTS-EP37-001" }, call_id: "read-for-review" });
      assert.equal(read.isError, false);
      const snapshot = read.structuredContent.result.data.result;
      const writeTool = catalog.tools.find((item: { tool_definition_id: string }) => item.tool_definition_id === "ee.submit_ssts_review");
      const command = { tool_release_id: writeTool.tool_release_id, arguments: { ssts_code: "SSTS-EP37-001", expected_digest: snapshot.snapshot_digest, reviewer_account_ids: [process.env.PC_REVIEWER_EE_ACCOUNT_ID!] }, call_id: "submit-review-exact-version" };
      const approval = await request(`/v1/workbench/tasks/${id}/write-requests`, command);
      const denied = await request(`/v1/workbench/tasks/${id}/tools`, command, 403);
      assert(denied.error);
      await writeFile("/evidence/pending-command.json", JSON.stringify({ approval, command }));
      console.log("Exact write denied without approval; durable pending command saved for API replacement");
    } else if (mode === "approve") {
      const { approval, command } = JSON.parse(await readFile("/evidence/pending-command.json", "utf8"));
      await login("reviewer.acceptance", "LocalReviewerSecret123");
      const inbox = await request("/v1/workbench/approvals");
      assert(inbox.items.some((item: { approval_id: string }) => item.approval_id === approval.approval_id));
      await request(`/v1/workbench/approvals/${approval.approval_id}/decision`, { expected_version: approval.approval_version, decision: "APPROVE" });
      await login();
      await writeFile("/evidence/drop-write-once", "drop response after real Owner dispatch");
      const result = await request(`/v1/workbench/tasks/${id}/approvals/${approval.approval_id}/execute`, {});
      assert.equal(result.structuredContent.outcome_state, "OUTCOME_UNKNOWN");
      const duplicate = await request(`/v1/workbench/tasks/${id}/tools`, { ...command, approval_id: approval.approval_id });
      assert.equal(duplicate.structuredContent.result_digest, result.structuredContent.result_digest);
      await writeFile("/evidence/approval-write.json", JSON.stringify({ approval, result, duplicate }, null, 2));
      console.log("Pending approval survived API replacement; lost real write response is UNKNOWN and duplicate does not replay");
    } else if (mode === "reconcile") {
      const { approval } = JSON.parse(await readFile("/evidence/pending-command.json", "utf8"));
      const result = await request(`/v1/workbench/tasks/${id}/operations/${approval.operation_id}/reconcile`, {});
      assert.equal(result.outcome_state, "KNOWN_SUCCESS");
      assert.equal(result.result.readback.data.result.document.status, "in_review");
      assert(result.external_evidence_refs.length >= 2);
      await writeFile("/evidence/reconciled-write.json", JSON.stringify(result, null, 2));
      console.log("Unknown write survived API replacement and reconciled from actual EE receipt plus independent Owner readback");
    } else if (mode === "resume") {
      const result = await request(`/v1/workbench/tasks/${id}/turns`, { prompt: "Read ee.list_functions in this turn. Then summarize the selected Function and the previous SSTS draft in two sentences. Do not perform a write." });
      assert(result.content.length > 30);
      await writeFile("/evidence/resumed-turn.json", JSON.stringify(result));
      console.log("Real DSH persisted session resumed after Runtime process replacement");
    }
  }
} finally { await identity.close(); }
