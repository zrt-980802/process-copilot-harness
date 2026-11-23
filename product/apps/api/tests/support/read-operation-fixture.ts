import { vi } from "vitest";
import { IdentityAuthorizationService } from "@pc/application";
import type { ToolRelease, SessionAssignment } from "@pc/domain";
import { EventProjectionService, type EventProjectionRepository } from "@pc/event-projection";
import { ControlledExecutionGatewayService, EphemeralCredentialIssuer, mcpDigest,
  type GatewayIdentityPort, type GatewayProviderPort, type GatewayRepository, type ToolExecutionEnvelope } from "@pc/gateway";
import { MemoryEventProjectionRepository, MemoryGatewayRepository, MemoryIdentityAuthorizationRepository } from "@pc/persistence";
import { gatewayEventPublisher } from "../../src/gateway-event-publisher.js";
import { ReadOperationVerifier } from "../../src/read-operation-verifier.js";

export async function readOperationFixture(autoVerify = true,
  kind: "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL_SIDE_EFFECT" = "READ",
  stores?: { gateway: GatewayRepository; projection: EventProjectionRepository; suffix: string }) {
  const now = () => new Date("2026-11-23T04:00:00.000Z");
  const identity = new IdentityAuthorizationService(new MemoryIdentityAuthorizationRepository(), "rci03-synthetic-signing-key-00000000000", [], now);
  await identity.provisionPilotAccount({ tenant_id: "rci03", account_key: "engineer", secret: "SyntheticRci03Secret123" });
  const login = await identity.signInPilot("rci03", "engineer", "SyntheticRci03Secret123");
  const principal = login.principal;
  const tool: ToolRelease = { contract_name: "pc.tool-release/1", contract_version: 1,
    tool_release_id: "tool:rci03:read:1", tool_definition_id: "ee.read", version: 1,
    provider_kind: "synthetic-port", input_schema: { type: "object" }, output_schema: { type: "object" },
    schema_digest: "1".repeat(64), risk_manifest: { action_class: kind, sensitivity: "LOW", requires_readback: false },
    required_permissions: ["ee.read"], approval_policy: "NONE", idempotency_class: "IDEMPOTENT", recovery_class: "REPLAY_SAFE",
    compatibility: {}, status: "PUBLISHED", artifact_refs: ["artifact:rci03"], release_digest: "2".repeat(64) };
  const projectionRepository = stores?.projection ?? new MemoryEventProjectionRepository();
  const events = new EventProjectionService(projectionRepository, undefined, undefined, undefined, undefined, now);
  await events.initialize();
  const task = await events.createTask({ tenant_id: principal.tenant_id, owner_principal_id: principal.principal_id,
    profile_release_id: "profile:rci03", project_id: "project-rci03" });
  const repository = stores?.gateway ?? new MemoryGatewayRepository();
  await repository.initialize();
  const publisher = gatewayEventPublisher(events, repository);
  if (!autoVerify) delete publisher.verifyReadOperation;
  const dispatch = vi.fn<GatewayProviderPort["dispatch"]>(async () => ({ provider_operation_id: "trace-rci03-read",
    result: { ok: true, trace_id: "trace-rci03-read", data: { document: "Synthetic port response" } },
    external_evidence_refs: ["eea://traces/trace-rci03-read"] }));
  const assignment = { assignment_id: "assignment:rci03", tenant_id: principal.tenant_id, user_id: principal.principal_id,
    pc_session_id: "pc_rci03", runtime_id: "runtime:rci03", runtime_epoch: 1, assignment_generation: 1,
    authorization_revision: 1, fencing_token: "fence:rci03", effective_profile_snapshot_id: "profile-snapshot:rci03" } as SessionAssignment;
  const gatewayIdentity: GatewayIdentityPort = {
    verifyPrincipalEnvelope: vi.fn(async () => principal),
    evaluatePrincipalAuthorization: vi.fn(async input => ({ contract_name: "pc.authorization-snapshot/1", contract_version: 1,
      principal_id: input.principal_id, decision: "ALLOW", authorization_revision: 1, policy_model_revision: input.policy_model_revision,
      allowed_actions: [...input.actions], resource_scope_digest: mcpDigest([...input.resource_scope_refs].sort()),
      tool_set_digest: mcpDigest([...input.tool_release_ids].sort()), reason_codes: ["synthetic-current-allow"],
      issued_at: now().toISOString(), expires_at: new Date(now().getTime() + 60_000).toISOString(), decision_evidence_refs: ["synthetic:current-decision"] })),
    resolveExternalSubject: vi.fn(async () => "42")
  };
  const gateway = new ControlledExecutionGatewayService(repository, gatewayIdentity, { getToolRelease: async () => tool, getEffectiveProfileSnapshot: async () => ({
    pc_session_id: assignment.pc_session_id, profile_release_id: "profile:rci03", authorization_revision: 1,
    tool_release_ids: [tool.tool_release_id] } as never) }, {
    getSessionProjection: async () => ({ assignment, guard: { allowed: true, code: "ALLOW", reason: "allowed", retryable: false } }),
    evaluateToolGuard: async () => ({ allowed: true, code: "ALLOW", reason: "allowed", retryable: false })
  }, { getWorkspaceView: async () => undefined }, new EphemeralCredentialIssuer(), {
    dispatch, reconcile: async () => { throw new Error("READ projection must not reconcile with Provider"); }
  }, now, publisher);
  const connector = await gateway.registerConnector({ tenant_id: principal.tenant_id, mcp_server_id: "synthetic:rci03",
    endpoint_ref: "internal://synthetic-rci03", provider_key: "synthetic-port", auth_mode: "delegated", audience: "synthetic:rci03",
    allowed_scopes: ["ee.read"], tool_release_ids: [tool.tool_release_id], capability_digest: mcpDigest([tool.tool_release_id]) });
  await gateway.bindExternalAccount({ tenant_id: principal.tenant_id, connector_id: connector.connector_id,
    principal_id: principal.principal_id, external_account_id: "42", credential_subject: "synthetic:42", secret_ref: "synthetic-ref:rci03" });
  const operationId = stores ? `rci03-read-${stores.suffix}` : "rci03-read-red-01";
  const args = { query: "read" };
  await events.planOperation({ operation_id: operationId, business_task_id: task.business_task_id,
    tenant_id: principal.tenant_id, principal_id: principal.principal_id, operation_kind: kind, recovery_class: "REPLAY_SAFE",
    input_digest: mcpDigest(args) });
  const envelope: ToolExecutionEnvelope = { contract_name: "pc.tool-execution-envelope/1", contract_version: 1,
    operation_id: operationId, idempotency_key: `rci03-key-${stores?.suffix ?? "01"}`, tool_release_id: tool.tool_release_id,
    schema_digest: tool.schema_digest, arguments: args, argument_digest: mcpDigest(args), assignment_snapshot_ref: assignment.assignment_id,
    deadline: new Date(now().getTime() + 60_000).toISOString(), recovery_class: "REPLAY_SAFE", principal_envelope: {
      contract_name: "pc.principal-envelope/1", contract_version: 1, envelope_id: "envelope:rci03", issuer: "process-copilot",
      audience: `gateway:${connector.connector_id}`, tenant_id: principal.tenant_id, subject_principal_id: principal.principal_id,
      actor_principal_id: principal.principal_id, business_task_id: task.business_task_id, pc_session_id: assignment.pc_session_id,
      runtime_id: assignment.runtime_id, runtime_epoch: 1, assignment_generation: 1, authorization_revision: 1,
      credential_generation: 1, fencing_token: assignment.fencing_token, allowed_actions: ["ee.read"],
      resource_scope_refs: ["project:project-rci03"], issued_at: now().toISOString(), expires_at: new Date(now().getTime() + 60_000).toISOString(),
      nonce: "nonce:rci03", signature: "synthetic-envelope-port" } };
  const verifier = new ReadOperationVerifier(events, repository);
  const input = { operation_id: operationId, tenant_id: principal.tenant_id, principal_id: principal.principal_id };
  return { gateway, gatewayIdentity, repository, events, projectionRepository, dispatch, envelope, publisher, identity, login, principal, task, tool, verifier, input, connector, assignment };
}
