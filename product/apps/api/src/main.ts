import {
  HttpRuntimeCommandDispatcher,
  HttpEeClawAuthorizationAdapter,
  IdentityAuthorizationService,
  ProfileCapabilityService,
  RuntimeRegistryService
} from "@pc/application";
import {
  MemoryIdentityAuthorizationRepository,
  MemoryEventProjectionRepository,
  MemoryGatewayRepository,
  MemoryProfileCapabilityRepository,
  MemoryRuntimeRegistryRepository,
  PostgresIdentityAuthorizationRepository,
  PostgresEventProjectionRepository,
  PostgresGatewayRepository,
  PostgresProfileCapabilityRepository,
  PostgresRuntimeRegistryRepository,
  MemoryResourceRepository,
  PostgresResourceRepository,
  MemorySstsDraftRepository,
  PostgresSstsDraftRepository
} from "@pc/persistence";
import { EventProjectionService } from "@pc/event-projection";
import {
  ControlledExecutionGatewayService,
  EeMcpGatewayProvider,
  EeMcpCredentialIssuer,
  synchronizeEeMcpCatalog
} from "@pc/gateway";
import { IdentityAuthorizationError } from "@pc/domain";
import {
  LocalImmutableBlobStore,
  LocalWorkspaceMaterializer,
  ResourceWorkspaceService
} from "@pc/resource";
import { SstsDraftService } from "@pc/ssts-draft";
import { RuntimeWorkbench, RuntimeSstsDraftEngine } from "./workbench.js";
import { mcpDigest } from "@pc/gateway";
import { buildApiServer } from "./server.js";
import { EeLogin } from "./ee-login.js";
import {
  EeClawProjectDirectoryAdapter,
  EeClawWorkbenchProjectionAdapter
} from "./ee-provider.js";
import { UserRuntimeResolver } from "./user-runtime.js";
import { LocalIdentityProvider } from "./local-identity-provider.js";
import { classifyProviderConfiguration } from "./provider-bootstrap.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const storeKind = process.env.PC_RUNTIME_REGISTRY_STORE ?? "disabled";
const databaseUrl = process.env.DATABASE_URL;
const identityStoreKind = process.env.PC_IDENTITY_STORE ?? "disabled";
const profileStoreKind = process.env.PC_PROFILE_STORE ?? "disabled";
const resourceStoreKind = process.env.PC_RESOURCE_STORE ?? "disabled";
const gatewayStoreKind = process.env.PC_GATEWAY_STORE ?? "disabled";
const eventStoreKind = process.env.PC_EVENT_STORE ?? "disabled";
const sstsStoreKind = process.env.PC_SSTS_STORE ?? "disabled";
const providerConfiguration = classifyProviderConfiguration(process.env);

let registry: RuntimeRegistryService | undefined;
let identityAuthorization: IdentityAuthorizationService | undefined;
let profileCapability: ProfileCapabilityService | undefined;
let resourceWorkspace: ResourceWorkspaceService | undefined;
let controlledGateway: ControlledExecutionGatewayService | undefined;
let eventProjection: EventProjectionService | undefined;
let sstsDraft: SstsDraftService | undefined;
let pilotPrincipalId: string | undefined;
let workbench: RuntimeWorkbench | undefined;
let fixedProfileReleaseId: string | undefined;

if (identityStoreKind !== "disabled") {
  const signingKey = process.env.PC_ENVELOPE_SIGNING_KEY;
  if (signingKey === undefined || signingKey.length < 32) {
    throw new Error(
      "PC_ENVELOPE_SIGNING_KEY with at least 32 characters is required"
    );
  }
  if (identityStoreKind === "memory") {
    identityAuthorization = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      signingKey
    );
  } else if (identityStoreKind === "postgres") {
    if (databaseUrl === undefined || databaseUrl.trim() === "") {
      throw new Error("DATABASE_URL is required for PC_IDENTITY_STORE=postgres");
    }
    identityAuthorization = new IdentityAuthorizationService(
      new PostgresIdentityAuthorizationRepository(databaseUrl),
      signingKey
    );
  } else {
    throw new Error(`Unsupported PC_IDENTITY_STORE: ${identityStoreKind}`);
  }
  await identityAuthorization.initialize();

  const pilotAccountKey = process.env.PC_PILOT_ACCOUNT_KEY;
  const pilotAccountSecret = process.env.PC_PILOT_ACCOUNT_SECRET;
  const pilotTenantId = process.env.PC_PILOT_TENANT_ID;
  if (
    pilotAccountKey !== undefined
    && pilotAccountSecret !== undefined
    && pilotTenantId !== undefined
  ) {
    try {
      const provisioned = await identityAuthorization.provisionPilotAccount({
        tenant_id: pilotTenantId,
        account_key: pilotAccountKey,
        secret: pilotAccountSecret
      });
      pilotPrincipalId = provisioned.principal.principal_id;
    } catch (error) {
      if (
        !(error instanceof IdentityAuthorizationError)
        || error.code !== "PC_PILOT_ACCOUNT_EXISTS"
      ) {
        throw error;
      }
      pilotPrincipalId = (
        await identityAuthorization.getPilotPrincipal(
          pilotTenantId,
          pilotAccountKey
        )
      )?.principal_id;
    }
  }
}

const eeClawAdapterUrl = providerConfiguration.ee.authorization_url;
const eeClawAdapterSecret = providerConfiguration.ee.authorization_secret;
if (
  identityAuthorization !== undefined
  && eeClawAdapterUrl !== undefined
  && eeClawAdapterSecret !== undefined
) {
  const eeClawAccountId = process.env.PC_PILOT_EECLAW_ACCOUNT_ID;
  const pilotTenantId = process.env.PC_PILOT_TENANT_ID;
  if (
    pilotPrincipalId !== undefined
    && eeClawAccountId !== undefined
    && pilotTenantId !== undefined
    && await identityAuthorization.resolveExternalSubject(
      pilotPrincipalId,
      "eeclaw"
    ) === undefined
  ) {
    const principal = await identityAuthorization.getPilotPrincipal(
      pilotTenantId,
      process.env.PC_PILOT_ACCOUNT_KEY ?? ""
    );
    if (principal !== undefined) {
      await identityAuthorization.linkVerifiedIdentity({
        principal_id: principal.principal_id,
        identity_provider_ref: "eeclaw",
        issuer: eeClawAdapterUrl,
        external_subject: eeClawAccountId,
        tenant_or_org_ref: pilotTenantId,
        verification_level: "admin_reauthentication",
        expected_identity_revision: principal.identity_revision
      });
    }
  }
  const eeClawAdapter = new HttpEeClawAuthorizationAdapter({
    baseUrl: eeClawAdapterUrl,
    sharedSecret: eeClawAdapterSecret,
    resolveAccountId: (principal) =>
      identityAuthorization?.resolveExternalSubject(
        principal.principal_id,
        "eeclaw"
      ) ?? Promise.resolve(undefined),
    resolvePermissionKey: (action) => action.startsWith("page:") ? action : ({
      "draft.generate": "page:architecture",
      "draft.read": "page:architecture"
      , "ee.ssts.review.request": "page:architecture", "approval.decide": "page:architecture"
    })[action],
    resolveProjectOperation: (action) => action.startsWith("page:")
      || action === "draft.generate" || action === "draft.read" ? "read"
        : action === "ee.ssts.review.request" ? "edit" : action === "approval.decide" ? "review" : undefined
  });
  await eeClawAdapter.fetchCompatibility();
  identityAuthorization.registerExternalAuthorizationPort(eeClawAdapter);
}

if (profileStoreKind !== "disabled") {
  if (profileStoreKind === "memory") {
    profileCapability = new ProfileCapabilityService(
      new MemoryProfileCapabilityRepository()
    );
  } else if (profileStoreKind === "postgres") {
    if (databaseUrl === undefined || databaseUrl.trim() === "") {
      throw new Error("DATABASE_URL is required for PC_PROFILE_STORE=postgres");
    }
    profileCapability = new ProfileCapabilityService(
      new PostgresProfileCapabilityRepository(databaseUrl)
    );
  } else {
    throw new Error(`Unsupported PC_PROFILE_STORE: ${profileStoreKind}`);
  }
  await profileCapability.initialize();
  fixedProfileReleaseId = (
    await profileCapability.seedFixedFoRelease()
  ).profile.profile_release_id;
}

if (resourceStoreKind !== "disabled") {
  const blobRoot = process.env.PC_BLOB_ROOT ?? "/var/lib/process-copilot/blobs";
  const materializationRoot = process.env.PC_MATERIALIZATION_ROOT
    ?? "/var/lib/process-copilot/materializations";
  if (resourceStoreKind === "memory") {
    resourceWorkspace = new ResourceWorkspaceService(
      new MemoryResourceRepository(),
      new LocalImmutableBlobStore(blobRoot),
      new LocalWorkspaceMaterializer(materializationRoot)
    );
  } else if (resourceStoreKind === "postgres") {
    if (databaseUrl === undefined || databaseUrl.trim() === "") {
      throw new Error("DATABASE_URL is required for PC_RESOURCE_STORE=postgres");
    }
    resourceWorkspace = new ResourceWorkspaceService(
      new PostgresResourceRepository(databaseUrl),
      new LocalImmutableBlobStore(blobRoot),
      new LocalWorkspaceMaterializer(materializationRoot)
    );
  } else {
    throw new Error(`Unsupported PC_RESOURCE_STORE: ${resourceStoreKind}`);
  }
  await resourceWorkspace.initialize();
}

if (storeKind === "memory") {
  registry = new RuntimeRegistryService(
    new MemoryRuntimeRegistryRepository(),
    new HttpRuntimeCommandDispatcher(process.env.PC_RUNTIME_SERVICE_SECRET),
    () => new Date(),
    profileCapability,
    resourceWorkspace
  );
  await registry.initialize();
} else if (storeKind === "postgres") {
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required for PC_RUNTIME_REGISTRY_STORE=postgres");
  }
  registry = new RuntimeRegistryService(
    new PostgresRuntimeRegistryRepository(databaseUrl),
    new HttpRuntimeCommandDispatcher(process.env.PC_RUNTIME_SERVICE_SECRET),
    () => new Date(),
    profileCapability,
    resourceWorkspace
  );
  await registry.initialize();
}

if (eventStoreKind !== "disabled") {
  if (registry === undefined || identityAuthorization === undefined) {
    throw new Error(
      "Runtime Registry and Identity services are required for Event Projection"
    );
  }
  const repository = eventStoreKind === "memory"
    ? new MemoryEventProjectionRepository()
    : eventStoreKind === "postgres"
      ? databaseUrl === undefined || databaseUrl.trim() === ""
        ? undefined
        : new PostgresEventProjectionRepository(databaseUrl)
      : undefined;
  if (repository === undefined) {
    throw new Error(
      eventStoreKind === "postgres"
        ? "DATABASE_URL is required for PC_EVENT_STORE=postgres"
        : `Unsupported PC_EVENT_STORE: ${eventStoreKind}`
    );
  }
  eventProjection = new EventProjectionService(
    repository,
    {
      evaluate: async (envelope) => {
        if (
          envelope.pc_session_id === undefined
          || envelope.runtime_id === undefined
          || envelope.runtime_epoch === undefined
          || envelope.assignment_generation === undefined
          || envelope.fencing_token === undefined
        ) {
          return {
            allowed: true,
            code: "PC_EVENT_AUTHORITY_NOT_APPLICABLE",
            reason: "Event has no Runtime Assignment coordinates"
          };
        }
        const decision = await registry.evaluateGuard({
          kind: "STEP",
          runtime_id: envelope.runtime_id,
          runtime_epoch: envelope.runtime_epoch,
          pc_session_id: envelope.pc_session_id,
          assignment_generation: envelope.assignment_generation,
          fencing_token: envelope.fencing_token
        });
        return {
          allowed: decision.allowed,
          code: decision.code,
          reason: decision.reason
        };
      }
    },
    {
      evaluate: (input) =>
        identityAuthorization.evaluatePrincipalAuthorization(input)
    }
  );
  eventProjection.registerRecoveryRuntime({
    migrate: async (input) => {
      const current = await registry.getSessionProjection(
        input.pc_session_id
      ).catch(() => undefined);
      if (
        current !== undefined
        && !["RELEASED", "EXPIRED", "REJECTED"].includes(
          current.assignment.state
        )
      ) {
        await registry.revokeAssignment({
          pc_session_id: input.pc_session_id,
          expected_version: current.assignment.version,
          reason: `recovery:${input.recovery_case_id}`
        });
      }
      const assigned = await registry.assignSession({
        tenant_id: input.tenant_id,
        user_id: input.principal_id,
        pc_session_id: input.pc_session_id,
        runtime_id: input.target_runtime_id,
        runtime_epoch: input.target_runtime_epoch,
        lease_duration_ms: input.lease_duration_ms,
        effective_profile_snapshot_id:
          input.effective_profile_snapshot_id,
        workspace_view_snapshot_id: input.workspace_view_snapshot_id,
        authorization_revision: input.authorization_revision
      });
      return {
        assignment_id: assigned.assignment.assignment_id,
        runtime_id: assigned.assignment.runtime_id,
        runtime_epoch: assigned.assignment.runtime_epoch,
        assignment_generation:
          assigned.assignment.assignment_generation,
        fencing_token: assigned.assignment.fencing_token
      };
    }
  });
  await eventProjection.initialize();
}

if (gatewayStoreKind !== "disabled") {
  if (
    identityAuthorization === undefined
    || profileCapability === undefined
    || registry === undefined
    || resourceWorkspace === undefined
  ) {
    throw new Error(
      "Identity, Profile, Runtime Registry and Resource services are required for Gateway"
    );
  }
  const repository = gatewayStoreKind === "memory"
    ? new MemoryGatewayRepository()
    : gatewayStoreKind === "postgres"
      ? databaseUrl === undefined || databaseUrl.trim() === ""
        ? undefined
        : new PostgresGatewayRepository(databaseUrl)
      : undefined;
  if (repository === undefined) {
    throw new Error(
      gatewayStoreKind === "postgres"
        ? "DATABASE_URL is required for PC_GATEWAY_STORE=postgres"
        : `Unsupported PC_GATEWAY_STORE: ${gatewayStoreKind}`
    );
  }
  const providerKind = process.env.PC_GATEWAY_PROVIDER ?? "ee_mcp";
  if (providerKind !== "ee_mcp") {
    throw new Error(`Unsupported PC_GATEWAY_PROVIDER: ${providerKind}`);
  }
  const mcpEndpoint = process.env.EE_MCP_ADAPTER_URL;
  const mcpSecret = process.env.EE_MCP_ADAPTER_SECRET;
  const mcpTenant = process.env.PC_PILOT_TENANT_ID;
  if (!mcpEndpoint || !mcpSecret || !mcpTenant || !eeClawAdapterUrl || !eeClawAdapterSecret) {
    throw new Error("EE MCP URL/Secret, pilot tenant and EE authorization adapter are required");
  }
  const mcpProvider = new EeMcpGatewayProvider(mcpEndpoint);
  const projectDirectory = new EeClawProjectDirectoryAdapter({
    identity: identityAuthorization,
    baseUrl: eeClawAdapterUrl,
    sharedSecret: eeClawAdapterSecret
  });
  const workbenchProjection = new EeClawWorkbenchProjectionAdapter();
  controlledGateway = new ControlledExecutionGatewayService(
    repository,
    identityAuthorization,
    profileCapability,
    registry,
    resourceWorkspace,
    new EeMcpCredentialIssuer(new URL(mcpEndpoint).href, mcpSecret),
    mcpProvider,
    () => new Date(),
    eventProjection === undefined
      ? undefined
      : {
          approvalState: async (input) => {
            const operation = await eventProjection?.getOperation(
              input.operation_id
            );
            if (operation === undefined || operation.state === input.state) {
              return;
            }
            await eventProjection?.transitionOperation({
              operation_id: input.operation_id,
              tenant_id: input.tenant_id,
              principal_id: input.principal_id,
              state: input.state,
              evidence_refs: input.evidence_refs,
              producer: "pc-gateway"
            });
          },
          operationState: async (input) => {
            const operation = await eventProjection?.getOperation(
              input.operation_id
            );
            if (operation === undefined || operation.state === input.state) {
              return;
            }
            await eventProjection?.transitionOperation({
              operation_id: input.operation_id,
              tenant_id: input.tenant_id,
              principal_id: input.principal_id,
              state: input.state,
              external_operation_record_id:
                input.external_operation_record_id,
              ...(input.result_digest === undefined
                ? {}
                : { result_digest: input.result_digest }),
              evidence_refs: input.evidence_refs,
              producer: "pc-gateway"
            });
          }
        }
  );
  await controlledGateway.initialize();
  const catalog = await synchronizeEeMcpCatalog({ provider: mcpProvider,
    access_token: mcpSecret, tenant_id: mcpTenant, endpoint: mcpEndpoint,
    profiles: profileCapability, gateway: controlledGateway });
  const runtimeUrl = process.env.PC_WORKBENCH_RUNTIME_URL;
  if (runtimeUrl !== undefined) {
    const readTools = catalog.tools.filter((tool) => tool.risk_manifest.action_class === "READ");
    const profileId = `profile:ee-ssts:${mcpDigest(readTools.map((tool) => tool.release_digest)).slice(7)}`;
    await profileCapability.publishExpertProfile({ profile_release_id: profileId,
      profile_definition_id: "profile:ee-ssts", release_version: 1,
      instructions_ref: "profiles/process-copilot-runtime/cordis.patch.yml",
      rules_ref: "architecture/ee-agent-mcp-full-chain-integration-research-v1.md",
      tool_requirements: readTools.map((tool) => tool.tool_release_id), plugin_requirements: [],
      model_policy: { mode: "configured-runtime-model" }, knowledge_policy: { exact_versions: true },
      output_contract: { kind: "AI_DRAFT", enterprise_write: false },
      completion_contract: { requires_source_refs: true, requires_ee_trace: true },
      dependency_lock_digest: mcpDigest(readTools.map((tool) => tool.release_digest)),
      published_at: "2026-11-11T00:00:00.000Z" });
    const readProfile = await profileCapability.getProfileRelease(profileId);
    const reviewProfileId = `profile:ee-review:v2:${mcpDigest(catalog.tools.map((tool) => tool.release_digest)).slice(7)}`;
    if (!readProfile) throw new Error("EE read profile was not published");
    await profileCapability.publishExpertProfile({ ...readProfile,
      profile_release_id: reviewProfileId, profile_definition_id: "profile:ee-review",
      tool_requirements: catalog.tools.map((tool) => tool.tool_release_id),
      output_contract: { kind: "AI_DRAFT", enterprise_write: false, controlled_command: "explicit-approved-review-only" },
      dependency_lock_digest: mcpDigest(catalog.tools.map((tool) => tool.release_digest)) });
    const identity = identityAuthorization;
    const conversationProfile = await profileCapability.publishExpertProfile({ ...readProfile,
      profile_release_id: "profile:conversation:personal:1", profile_definition_id: "profile:conversation:personal",
      tool_requirements: [], knowledge_policy: { source: "session-materialized-only", enterprise_access: false },
      output_contract: { kind: "AI_CONVERSATION", enterprise_write: false }, completion_contract: { requires_ee_trace: false },
      dependency_lock_digest: mcpDigest([]) });
    const runtimeResolver = process.env.PC_USER_RUNTIME_MANAGER_URL
      ? new UserRuntimeResolver(process.env.PC_USER_RUNTIME_MANAGER_URL, process.env.PC_RUNTIME_SERVICE_SECRET ?? "") : undefined;
    workbench = new RuntimeWorkbench({ identity, profiles: profileCapability, registry,
      resources: resourceWorkspace, gateway: controlledGateway, gatewayRepository: repository,
      events: eventProjection!, connector: catalog.connector, tools: catalog.tools,
      runtimeUrl: new URL(runtimeUrl).origin, profileReleaseId: profileId,
      reviewProfileReleaseId: reviewProfileId,
      conversationProfileReleaseId: conversationProfile.profile_release_id,
      projectDirectory,
      workbenchProjection,
      ...(runtimeResolver ? { resolveRuntime: async (principal) => {
        if (principal.principal_id === pilotPrincipalId) return new URL(runtimeUrl).origin;
        return runtimeResolver.resolve(principal);
      } } : {}),
      ensureExternalAccount: async (principal) => {
        const externalId = await identity.resolveExternalSubject(principal.principal_id, "eeclaw", { issuer: eeClawAdapterUrl!, tenant: principal.tenant_id });
        if (!externalId) throw new IdentityAuthorizationError("PC_WORKBENCH_EXTERNAL_ACCOUNT_DENIED", "Verified EE identity required");
        let binding = await repository.findExternalAccountBinding(principal.tenant_id, catalog.connector.connector_id, principal.principal_id, true);
        if (!binding) {
          try { binding = await controlledGateway!.bindExternalAccount({ tenant_id: principal.tenant_id,
            connector_id: catalog.connector.connector_id, principal_id: principal.principal_id, external_account_id: externalId,
            credential_subject: "service:ee-mcp-adapter", secret_ref: "config:EE_MCP_ADAPTER_SECRET" }); }
          catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "PC_GATEWAY_EXTERNAL_ACCOUNT_CONFLICT") throw error;
            binding = await repository.findExternalAccountBinding(principal.tenant_id, catalog.connector.connector_id, principal.principal_id);
          }
        }
        if (!binding || binding.status !== "ACTIVE" || binding.external_account_id !== externalId) {
          throw new IdentityAuthorizationError("PC_WORKBENCH_EXTERNAL_ACCOUNT_DENIED", "EE execution binding is unavailable");
        }
        return binding;
      },
      workspace: async (workspace_id, tenant_id, principal_id) => (await sstsDraft!.getWorkspace({ workspace_id, tenant_id, principal_id })).workspace,
      ...(process.env.PC_RUNTIME_SERVICE_SECRET ? { runtimeSecret: process.env.PC_RUNTIME_SERVICE_SECRET } : {}) });
  }
  if (pilotPrincipalId !== undefined) {
    const externalAccountId = await identityAuthorization.resolveExternalSubject(pilotPrincipalId, "eeclaw");
    if (externalAccountId === undefined) throw new Error("Verified pilot EE identity is required");
    const existing = await repository.findExternalAccountBinding(mcpTenant, catalog.connector.connector_id, pilotPrincipalId, true);
    if (existing === undefined) {
      await controlledGateway.bindExternalAccount({ tenant_id: mcpTenant,
        connector_id: catalog.connector.connector_id, principal_id: pilotPrincipalId,
        external_account_id: externalAccountId, credential_subject: "service:ee-mcp-adapter",
        secret_ref: "config:EE_MCP_ADAPTER_SECRET" });
    }
  }
  if (eventProjection !== undefined) {
    eventProjection.registerRecoveryGateway({
      getOperation: async (operationId) => {
        const operation = await controlledGateway?.getOperation(operationId);
        if (operation === undefined) return undefined;
        return {
          operation_id: operation.operation_id,
          outcome_state: operation.outcome_state,
          recovery_class: operation.recovery_class,
          ...(operation.provider_operation_id === undefined
            ? {}
            : {
                provider_operation_id:
                  operation.provider_operation_id
              })
        };
      },
      reconcile: async (operationId) => {
        const result = await controlledGateway?.reconcile(operationId);
        if (result === undefined) {
          throw new Error("Controlled Gateway is unavailable");
        }
        return {
          outcome_state: result.outcome_state,
          ...(result.provider_operation_id === undefined
            ? {}
            : { provider_operation_id: result.provider_operation_id }),
          external_evidence_refs: [...result.external_evidence_refs]
        };
      }
    });
  }
}

const standaloneRuntimeUrl = process.env.PC_WORKBENCH_RUNTIME_URL;
if (
  providerConfiguration.mode === "standalone"
  && standaloneRuntimeUrl !== undefined
  && sstsStoreKind !== "disabled"
  && identityAuthorization !== undefined
  && profileCapability !== undefined
  && registry !== undefined
  && resourceWorkspace !== undefined
  && eventProjection !== undefined
  && fixedProfileReleaseId !== undefined
) {
  const baseProfile = await profileCapability.getProfileRelease(
    fixedProfileReleaseId
  );
  if (baseProfile === undefined) {
    throw new Error("Fixed Core profile was not published");
  }
  const conversationProfile = await profileCapability.publishExpertProfile({
    ...baseProfile,
    profile_release_id: "profile:conversation:personal:1",
    profile_definition_id: "profile:conversation:personal",
    tool_requirements: [],
    knowledge_policy: {
      source: "session-materialized-only",
      enterprise_access: false
    },
    output_contract: {
      kind: "AI_CONVERSATION",
      enterprise_write: false
    },
    completion_contract: { requires_ee_trace: false },
    dependency_lock_digest: mcpDigest([])
  });
  const runtimeResolver = process.env.PC_USER_RUNTIME_MANAGER_URL
    ? new UserRuntimeResolver(
        process.env.PC_USER_RUNTIME_MANAGER_URL,
        process.env.PC_RUNTIME_SERVICE_SECRET ?? ""
      )
    : undefined;
  workbench = new RuntimeWorkbench({
    identity: identityAuthorization,
    profiles: profileCapability,
    registry,
    resources: resourceWorkspace,
    events: eventProjection,
    tools: [],
    runtimeUrl: new URL(standaloneRuntimeUrl).origin,
    conversationProfileReleaseId: conversationProfile.profile_release_id,
    ...(runtimeResolver === undefined
      ? {}
      : { resolveRuntime: (principal) => runtimeResolver.resolve(principal) }),
    workspace: async (workspaceId, tenantId, principalId) => (
      await sstsDraft!.getWorkspace({
        workspace_id: workspaceId,
        tenant_id: tenantId,
        principal_id: principalId
      })
    ).workspace,
    ...(process.env.PC_RUNTIME_SERVICE_SECRET === undefined
      ? {}
      : { runtimeSecret: process.env.PC_RUNTIME_SERVICE_SECRET })
  });
}

if (sstsStoreKind !== "disabled") {
  if (
    profileCapability === undefined
    || resourceWorkspace === undefined
    || eventProjection === undefined
  ) {
    throw new Error(
      "Profile, Resource and Event Projection services are required for SSTS Draft"
    );
  }
  const repository = sstsStoreKind === "memory"
    ? new MemorySstsDraftRepository()
    : sstsStoreKind === "postgres"
      ? databaseUrl === undefined || databaseUrl.trim() === ""
        ? undefined
        : new PostgresSstsDraftRepository(databaseUrl)
      : undefined;
  if (repository === undefined) {
    throw new Error(
      sstsStoreKind === "postgres"
        ? "DATABASE_URL is required for PC_SSTS_STORE=postgres"
        : `Unsupported PC_SSTS_STORE: ${sstsStoreKind}`
    );
  }
  sstsDraft = new SstsDraftService(
    repository,
    profileCapability,
    resourceWorkspace,
    eventProjection,
    { generate: (input, context) => {
      if (!workbench) throw new Error("PC_WORKBENCH_RUNTIME_URL is required for Runtime-backed SSTS");
      return new RuntimeSstsDraftEngine(workbench).generate(input, context);
    } }
  );
  await sstsDraft.initialize();
}

let localIdentityProvider: LocalIdentityProvider | undefined;
let eeIdentityProvider: EeLogin | undefined;
if (providerConfiguration.mode === "standalone" && identityAuthorization) {
  const tenant = process.env.PC_PILOT_TENANT_ID;
  if (!tenant) {
    throw new Error(
      "PC_PILOT_TENANT_ID is required for Standalone local identity"
    );
  }
  localIdentityProvider = new LocalIdentityProvider(
    identityAuthorization,
    tenant
  );
}
if (providerConfiguration.mode === "ee-connected") {
  const tenant = process.env.PC_PILOT_TENANT_ID;
  if (!identityAuthorization || !eeClawAdapterUrl || !eeClawAdapterSecret || !tenant) {
    throw new Error("EE login requires Identity, EE issuer, service secret and tenant configuration");
  }
  eeIdentityProvider = new EeLogin(
    identityAuthorization,
    eeClawAdapterUrl,
    eeClawAdapterSecret,
    tenant
  );
  const login = eeIdentityProvider;
  identityAuthorization.registerSessionValidator(async (session, principal) => {
    if (session.authentication_context_id.startsWith("ee:")) {
      await login.validate(session, principal);
    }
  });
}

const server = buildApiServer({
  providerMode: providerConfiguration.mode,
  ...(localIdentityProvider === undefined ? {} : {
    localIdentityProvider
  }),
  ...(eeIdentityProvider === undefined ? {} : {
    eeIdentityProvider,
    eeIdentitySecret: eeClawAdapterSecret!
  }),
  ...(workbench === undefined ? {} : { workbench }),
  ...(registry === undefined ? {} : { runtimeRegistry: registry }),
  ...(identityAuthorization === undefined ? {} : { identityAuthorization }),
  ...(profileCapability === undefined ? {} : { profileCapability }),
  ...(resourceWorkspace === undefined ? {} : { resourceWorkspace }),
  ...(controlledGateway === undefined ? {} : { controlledGateway }),
  ...(eventProjection === undefined ? {} : { eventProjection }),
  ...(sstsDraft === undefined ? {} : { sstsDraft }),
  ...(process.env.PC_EVENT_INGEST_SECRET === undefined
    ? {}
    : { eventIngestSecret: process.env.PC_EVENT_INGEST_SECRET }),
  databaseConfigured:
    storeKind === "postgres"
    || identityStoreKind === "postgres"
    || profileStoreKind === "postgres"
    || resourceStoreKind === "postgres"
    || gatewayStoreKind === "postgres"
    || eventStoreKind === "postgres"
    || sstsStoreKind === "postgres"
});

server.addHook("onClose", async () => {
  await Promise.all([
    registry?.close(),
    identityAuthorization?.close(),
    profileCapability?.close(),
    resourceWorkspace?.close(),
    controlledGateway?.close(),
    eventProjection?.close(),
    sstsDraft?.close()
  ]);
});

await server.listen({ host, port });
