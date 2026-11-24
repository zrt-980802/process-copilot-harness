import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { IdentityAuthorizationService, type ExternalAuthorizationDecision, type EnterpriseAuthorizationPort } from "@pc/application";
import type { SessionAssignment, ToolRelease, EffectiveProfileSnapshot } from "@pc/domain";
import { ControlledExecutionGatewayService, EphemeralCredentialIssuer, mcpDigest, type ToolExecutionEnvelope, type GatewayRepository } from "@pc/gateway";
import { EventProjectionService } from "@pc/event-projection";
import { MemoryGatewayRepository, MemoryIdentityAuthorizationRepository, MemoryEventProjectionRepository } from "@pc/persistence";
import { gatewayEventPublisher } from "../../src/gateway-event-publisher.js";
import { installAuthorizationMvp } from "../../src/authorization-mvp.js";
import { buildApiServer } from "../../src/server.js";
import type { EeProviderBundle } from "../../src/ee-provider-bundle.js";

/** Synthetic Provider/Runtime Ports, real PC Session, policy, Gateway and ledger. */
export async function authorizationMvpFixture(autoVerify = true, stores?: { audit: GatewayRepository }, options?: { now?: () => Date }) {
  const now = options?.now ?? (() => new Date("2026-11-23T08:00:00.000Z"));
  const identityRepository = new MemoryIdentityAuthorizationRepository();
  const identity = new IdentityAuthorizationService(identityRepository, "mvp-fixture-signing-key-synthetic-00000", [], now);
  const key = { identity_provider_ref: "eeclaw", issuer: "synthetic-issuer", external_subject: "42", tenant_or_org_ref: "mvp" };
  const initial = await identity.signInExternal(key, randomUUID(), new Date(now().getTime() + 3600_000).toISOString());
  await identity.replaceAuthorizationGrants({ principal_id: initial.principal.principal_id, expected_authorization_revision: 1,
    grants: ["page:functions", "page:projects", "tool.execute", "ee.unregistered"].map(action => ({ action, scope_type: "project", scope_id: "MVP-A", effect: "allow", evidence_ref: "pc:fixture-policy" })) });
  const login = await identity.signInExternal(key, randomUUID(), initial.expires_at);
  const principal = login.principal;
  const source = vi.fn(async (): Promise<ExternalAuthorizationDecision> => ({ decision: "ALLOW", reason_codes: ["synthetic-source-current"],
    evidence_refs: ["synthetic:C41:current"], source: { decision_ref: "synthetic:C41:current", observed_at: now().toISOString() } }));
  identity.registerExternalAuthorizationPort({ provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw", evaluate: source } as EnterpriseAuthorizationPort);
  identity.registerProviderSessionValidator(async () => undefined);
  const repository = stores?.audit ?? new MemoryGatewayRepository(); await repository.initialize();
  const projectionRepository = new MemoryEventProjectionRepository();
  const events = new EventProjectionService(projectionRepository, undefined, undefined, undefined, undefined, now);
  const task = await events.createTask({ tenant_id: principal.tenant_id, owner_principal_id: principal.principal_id,
    profile_release_id: "profile:mvp", project_id: "MVP-A" });
  const tool: ToolRelease = { contract_name: "pc.tool-release/1", contract_version: 1, tool_release_id: "tool:mvp:read:1",
    tool_definition_id: "ee.list_functions", version: 1, provider_kind: "ee_mcp", input_schema: {}, output_schema: {}, schema_digest: "1".repeat(64),
    risk_manifest: { action_class: "READ", sensitivity: "LOW", requires_readback: false }, required_permissions: ["page:functions"],
    approval_policy: "NONE", idempotency_class: "IDEMPOTENT", recovery_class: "REPLAY_SAFE", compatibility: {}, status: "PUBLISHED",
    artifact_refs: ["synthetic:tool"], release_digest: "2".repeat(64) };
  const assignment = { assignment_id: "assignment:mvp", tenant_id: principal.tenant_id, user_id: principal.principal_id, pc_session_id: "runtime-session:mvp",
    runtime_id: "runtime:mvp", runtime_epoch: 1, assignment_generation: 1, authorization_revision: principal.authorization_revision,
    fencing_token: "fence:mvp", effective_profile_snapshot_id: "snapshot:mvp" } as SessionAssignment;
  const profile = { effective_profile_snapshot_id: "snapshot:mvp", pc_session_id: assignment.pc_session_id, profile_release_id: "profile:mvp",
    authorization_revision: principal.authorization_revision, tool_release_ids: [tool.tool_release_id],
    model_selection: { pc_login_session_id: login.session_assurance!.pc_session_id } } as unknown as EffectiveProfileSnapshot;
  const profiles = { getToolRelease: async () => tool, getEffectiveProfileSnapshot: async () => profile };
  const registry = { getSessionProjection: async () => ({ assignment, guard: { allowed: true, code: "ALLOW", reason: "allowed", retryable: false } }),
    evaluateToolGuard: async () => ({ allowed: true, code: "ALLOW", reason: "allowed", retryable: false }) };
  const dispatch = vi.fn(async () => ({ provider_operation_id: "mvp-read-trace", result: { text: "synthetic confidential project data" },
    external_evidence_refs: ["eea://traces/mvp-read-trace"] }));
  const publisher = gatewayEventPublisher(events, repository);
  if (!autoVerify) delete publisher.verifyReadOperation;
  const gateway = new ControlledExecutionGatewayService(repository, identity, profiles, registry, { getWorkspaceView: async () => undefined },
    new EphemeralCredentialIssuer(), { dispatch, reconcile: async () => { throw new Error("No WRITE reconciliation in this fixture"); } }, now, publisher);
  const connector = await gateway.registerConnector({ tenant_id: principal.tenant_id, mcp_server_id: "mvp:synthetic", endpoint_ref: "internal://synthetic-mvp",
    provider_key: "ee_mcp", auth_mode: "delegated", audience: "mvp", allowed_scopes: tool.required_permissions.slice(),
    tool_release_ids: [tool.tool_release_id], capability_digest: mcpDigest([tool.tool_release_id]) });
  const binding = await gateway.bindExternalAccount({ tenant_id: principal.tenant_id, connector_id: connector.connector_id, principal_id: principal.principal_id,
    external_account_id: "42", credential_subject: "synthetic:42", secret_ref: "synthetic:secret-ref" });
  const state = { generation: "epoch.1", ready: true, connector };
  const bundle = { active: () => state.ready ? { generation: state.generation, catalog: { connector: state.connector, tools: [tool] } } : undefined,
    descriptor: () => ({ bundle_state: state.ready ? "READY" : "UNAVAILABLE", registration_revision: 1 }) } as unknown as EeProviderBundle;
  const mvp = installAuthorizationMvp({ identity, audit: repository, bundle, profiles: profiles as never, registry: registry as never, issuer: key.issuer, now });
  const args = { query: "current functions" }, operationId = `mvp-read-${randomUUID()}`;
  await events.planOperation({ operation_id: operationId, business_task_id: task.business_task_id, tenant_id: principal.tenant_id,
    principal_id: principal.principal_id, operation_kind: "READ", recovery_class: "REPLAY_SAFE", input_digest: mcpDigest(args) });
  const snapshot = await identity.issueAuthorizationSnapshot(login.access_token, { actions: ["page:functions"], resource_scope_refs: ["project:MVP-A"],
    tool_release_ids: [tool.tool_release_id], policy_model_revision: 1 });
  const principalEnvelope = await identity.issuePrincipalEnvelope(login.access_token, { snapshot, audience: `gateway:${connector.connector_id}`,
    pc_session_id: assignment.pc_session_id, business_task_id: task.business_task_id, runtime_id: assignment.runtime_id, runtime_epoch: 1,
    assignment_generation: 1, fencing_token: assignment.fencing_token, credential_generation: binding.credential_generation,
    resource_scope_refs: ["project:MVP-A"] });
  const envelope: ToolExecutionEnvelope = { contract_name: "pc.tool-execution-envelope/1", contract_version: 1, operation_id: operationId,
    idempotency_key: operationId, tool_release_id: tool.tool_release_id, schema_digest: tool.schema_digest, arguments: args, argument_digest: mcpDigest(args),
    assignment_snapshot_ref: assignment.assignment_id, principal_envelope: principalEnvelope, deadline: new Date(now().getTime() + 60_000).toISOString(), recovery_class: "REPLAY_SAFE" };
  const server = buildApiServer({ identityAuthorization: identity, controlledGateway: gateway, eventProjection: events });
  source.mockClear();
  return { ...mvp, identity, identityRepository, source, repository, events, projectionRepository, dispatch, publisher, gateway,
    connector, binding, principal, login, envelope, task, tool, state, now, key, server };
}
