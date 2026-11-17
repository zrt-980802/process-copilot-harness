import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type {
  CreateAssignmentInput,
  IdentityProviderPort,
  IdentityAuthorizationService,
  ProfileCapabilityService,
  RegisterRuntimeInput,
  RenewAssignmentInput,
  RuntimeRegistryService
} from "@pc/application";
import type {
  AssignmentGuardInput,
  RuntimeHealthReport,
  RuntimeRegistryState
} from "@pc/domain";
import { RuntimeRegistryError } from "@pc/domain";
import {
  IdentityAuthorizationError,
  ProfileCapabilityError
} from "@pc/domain";
import type { RuntimeCommand } from "@pc/runtime-adapter";
import type { ResourceWorkspaceService } from "@pc/resource";
import { ResourceError } from "@pc/resource";
import type {
  EventEnvelope,
  EventProjectionService
} from "@pc/event-projection";
import { EventProjectionError } from "@pc/event-projection";
import type {
  ControlledExecutionGatewayService,
  ExternalAccountBinding,
  ToolExecutionEnvelope
} from "@pc/gateway";
import { ControlledGatewayError } from "@pc/gateway";
import type {
  SstsDraftService,
  SstsInputSlot
} from "@pc/ssts-draft";
import { SstsDraftError } from "@pc/ssts-draft";
import type { RuntimeWorkbench, RuntimeToolContext } from "./workbench.js";

export interface ApiServerDependencies {
  identityProvider?: IdentityProviderPort;
  eeIdentitySecret?: string;
  workbench?: RuntimeWorkbench;
  runtimeRegistry?: RuntimeRegistryService;
  identityAuthorization?: IdentityAuthorizationService;
  profileCapability?: ProfileCapabilityService;
  resourceWorkspace?: ResourceWorkspaceService;
  controlledGateway?: ControlledExecutionGatewayService;
  eventProjection?: EventProjectionService;
  sstsDraft?: SstsDraftService;
  eventIngestSecret?: string;
  databaseConfigured?: boolean;
}

function registryFrom(dependencies: ApiServerDependencies): RuntimeRegistryService {
  if (dependencies.runtimeRegistry === undefined) {
    throw new RuntimeRegistryError(
      "PC_RUNTIME_REGISTRY_UNAVAILABLE",
      "Runtime Registry is not configured",
      true
    );
  }
  return dependencies.runtimeRegistry;
}

function statusFor(error: RuntimeRegistryError): number {
  if (error.code.endsWith("_NOT_FOUND")) return 404;
  if (
    error.code.startsWith("PC_RESOURCE_")
    && (
      error.code.includes("DENIED")
      || error.code.includes("MISMATCH")
      || error.code.includes("REQUIRED")
      || error.code.includes("EXPIRED")
      || error.code.includes("STALE")
    )
  ) return 403;
  if (
    error.code.includes("CONFLICT")
    || error.code.includes("STALE")
    || error.code.includes("CAS")
    || error.code.includes("EPOCH")
  ) return 409;
  if (error.retryable) return 503;
  return 400;
}

function identityFrom(dependencies: ApiServerDependencies): IdentityAuthorizationService {
  if (dependencies.identityAuthorization === undefined) {
    throw new IdentityAuthorizationError(
      "PC_IDENTITY_UNAVAILABLE",
      "Identity and Authorization service is not configured",
      true
    );
  }
  return dependencies.identityAuthorization;
}

function profilesFrom(dependencies: ApiServerDependencies): ProfileCapabilityService {
  if (dependencies.profileCapability === undefined) {
    throw new ProfileCapabilityError(
      "PC_PROFILE_UNAVAILABLE",
      "Profile and Capability service is not configured",
      true
    );
  }
  return dependencies.profileCapability;
}

function resourcesFrom(dependencies: ApiServerDependencies): ResourceWorkspaceService {
  if (dependencies.resourceWorkspace === undefined) {
    throw new ResourceError(
      "PC_RESOURCE_UNAVAILABLE",
      "Resource and Workspace service is not configured",
      true
    );
  }
  return dependencies.resourceWorkspace;
}

function gatewayFrom(
  dependencies: ApiServerDependencies
): ControlledExecutionGatewayService {
  if (dependencies.controlledGateway === undefined) {
    throw new ControlledGatewayError(
      "PC_GATEWAY_UNAVAILABLE",
      "Controlled Gateway is not configured",
      true
    );
  }
  return dependencies.controlledGateway;
}

function eventsFrom(
  dependencies: ApiServerDependencies
): EventProjectionService {
  if (dependencies.eventProjection === undefined) {
    throw new EventProjectionError(
      "PC_EVENT_PROJECTION_UNAVAILABLE",
      "Event Projection service is not configured",
      true
    );
  }
  return dependencies.eventProjection;
}

function sstsFrom(dependencies: ApiServerDependencies): SstsDraftService {
  if (dependencies.sstsDraft === undefined) {
    throw new SstsDraftError(
      "PC_SSTS_UNAVAILABLE",
      "SSTS Draft service is not configured",
      true
    );
  }
  return dependencies.sstsDraft;
}

function identityStatus(error: IdentityAuthorizationError): number {
  if (
    error.code === "PC_AUTHENTICATION_REQUIRED"
    || error.code === "PC_PILOT_AUTHENTICATION_FAILED"
  ) return 401;
  if (
    error.code.includes("REVISION_CONFLICT")
    || error.code === "PC_WORKBENCH_TURN_CONFLICT" || error.code === "PC_WORKBENCH_REQUEST_CONFLICT"
    || error.code.endsWith("_EXISTS")
  ) return 409;
  if (
    error.code.includes("DENIED")
    || error.code.includes("INACTIVE")
    || error.code.includes("UNVERIFIED")
  ) return 403;
  if (error.retryable) return 503;
  return 400;
}

function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (match?.[1] === undefined || match[1].trim() === "") {
    throw new IdentityAuthorizationError(
      "PC_AUTHENTICATION_REQUIRED",
      "Bearer access token is required"
    );
  }
  return match[1].trim();
}

function profileStatus(error: ProfileCapabilityError): number {
  if (error.code.endsWith("_NOT_FOUND")) return 404;
  if (error.code.includes("CONFLICT")) return 409;
  if (
    error.code.includes("REVOKED")
    || error.code.includes("UNAVAILABLE")
    || error.code.includes("INCOMPATIBLE")
  ) return 403;
  if (error.retryable) return 503;
  return 400;
}

function resourceStatus(error: ResourceError): number {
  if (error.code.endsWith("_NOT_FOUND")) return 404;
  if (error.code.includes("CONFLICT") || error.code.includes("STALE")) return 409;
  if (
    error.code.includes("DENIED")
    || error.code.includes("MISMATCH")
    || error.code.includes("NOT_IN_WORKSPACE_VIEW")
    || error.code.includes("MATERIALIZATION_REQUIRED")
  ) return 403;
  if (error.retryable) return 503;
  return 400;
}

function gatewayStatus(error: ControlledGatewayError): number {
  if (error.code.endsWith("_NOT_FOUND")) return 404;
  if (
    error.code.includes("CONFLICT")
    || error.code.includes("CAS")
    || error.code.includes("STALE")
    || error.code.includes("IN_PROGRESS")
  ) return 409;
  if (
    error.code.includes("DENIED")
    || error.code.includes("MISMATCH")
    || error.code.includes("REQUIRED")
    || error.code.includes("UNAVAILABLE")
  ) return 403;
  if (error.retryable) return 503;
  return 400;
}

function eventStatus(error: EventProjectionError): number {
  if (error.code.endsWith("_NOT_FOUND")) return 404;
  if (
    error.code.includes("CONFLICT")
    || error.code.includes("CAS")
    || error.code.includes("GAP")
    || error.code.includes("TRANSITION")
  ) return 409;
  if (
    error.code.includes("DENIED")
    || error.code.includes("STALE")
    || error.code.includes("MISMATCH")
  ) return 403;
  if (error.retryable) return 503;
  return 400;
}

function sstsStatus(error: SstsDraftError): number {
  if (error.code.endsWith("_NOT_FOUND")) return 404;
  if (
    error.code.includes("CONFLICT")
    || error.code.includes("IN_PROGRESS")
    || error.code.includes("INCOMPLETE")
    || error.code.includes("IMMUTABLE")
    || error.code.includes("PREVIOUSLY_FAILED")
  ) return 409;
  if (
    error.code.includes("DENIED")
    || error.code.includes("MISMATCH")
    || error.code.includes("UNAVAILABLE")
  ) return 403;
  if (error.retryable) return 503;
  return 400;
}

function requireEventIngestSecret(
  provided: string | string[] | undefined,
  configured: string | undefined
): void {
  if (configured === undefined || configured.length < 24) {
    throw new EventProjectionError(
      "PC_EVENT_INGEST_UNAVAILABLE",
      "Event ingestion secret is not configured",
      true
    );
  }
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (value === undefined) {
    throw new EventProjectionError(
      "PC_EVENT_INGEST_DENIED",
      "Event ingestion authentication failed"
    );
  }
  const actual = Buffer.from(value);
  const expected = Buffer.from(configured);
  if (
    actual.length !== expected.length
    || !timingSafeEqual(actual, expected)
  ) {
    throw new EventProjectionError(
      "PC_EVENT_INGEST_DENIED",
      "Event ingestion authentication failed"
    );
  }
}

function publicAccount(
  binding: ExternalAccountBinding
): Omit<ExternalAccountBinding, "secret_ref"> {
  return Object.fromEntries(
    Object.entries(binding).filter(([key]) => key !== "secret_ref")
  ) as Omit<ExternalAccountBinding, "secret_ref">;
}

export function buildApiServer(
  dependencies: ApiServerDependencies = {}
): FastifyInstance {
  const server = Fastify({
    logger: true,
    requestIdHeader: "x-request-id"
  });

  if (dependencies.workbench) server.addHook("preHandler", async request => {
    const { taskId } = request.params as { taskId?: string };
    if (taskId && request.routeOptions.url?.startsWith("/v1/ssts-tasks/")) {
      await dependencies.workbench!.owned(sstsFrom(dependencies), bearerToken(request.headers.authorization), taskId);
    }
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof RuntimeRegistryError) {
      return reply.status(statusFor(error)).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
    }
    if (error instanceof IdentityAuthorizationError) {
      return reply.status(identityStatus(error)).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
    }
    if (error instanceof ProfileCapabilityError) {
      return reply.status(profileStatus(error)).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
    }
    if (error instanceof ResourceError) {
      return reply.status(resourceStatus(error)).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
    }
    if (error instanceof ControlledGatewayError) {
      return reply.status(gatewayStatus(error)).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
    }
    if (error instanceof EventProjectionError) {
      return reply.status(eventStatus(error)).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
    }
    if (error instanceof SstsDraftError) {
      return reply.status(sstsStatus(error)).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
    }
    return reply.send(error);
  });

  server.get("/health", async () => ({
    service: "process-copilot-api",
    status: "ok",
    contract_baseline: "v1",
    runtime_registry: dependencies.runtimeRegistry === undefined
      ? "not-configured"
      : "configured",
    identity_authorization: dependencies.identityAuthorization === undefined
      ? "not-configured"
      : "configured",
    profile_capability: dependencies.profileCapability === undefined
      ? "not-configured"
      : "configured",
    resource_workspace: dependencies.resourceWorkspace === undefined
      ? "not-configured"
      : "configured",
    controlled_gateway: dependencies.controlledGateway === undefined
      ? "not-configured"
      : "configured",
    event_projection: dependencies.eventProjection === undefined
      ? "not-configured"
      : "configured",
    ssts_draft: dependencies.sstsDraft === undefined
      ? "not-configured"
      : "configured"
  }));

  if (dependencies.workbench !== undefined) {
    const workbench = dependencies.workbench;
    server.get("/v1/workbench/projects", async (request) => ({
      items: await workbench.projects(bearerToken(request.headers.authorization))
    }));
    server.get<{ Querystring: { project_code: string } }>("/v1/workbench/catalog", async (request) =>
      workbench.catalog(bearerToken(request.headers.authorization), request.query.project_code));
    server.get<{ Querystring: { project_code: string; workspace_id?: string } }>("/v1/workbench/capability-chain", async (request) => {
      const token = bearerToken(request.headers.authorization);
      const workspace = request.query.workspace_id
        ? (await workbench.owned(sstsFrom(dependencies), token, request.query.workspace_id)).workspace
        : undefined;
      return workbench.capabilityChain(token, request.query.project_code, workspace);
    });
    server.post("/v1/workbench/tasks", async (request, reply) => reply.status(201).send(
      await workbench.create(sstsFrom(dependencies), bearerToken(request.headers.authorization),
        request.body as { title: string; project_code?: string; function_code?: string; mode?: "READ" | "REVIEW" | "CHAT" })));
    server.get("/v1/workbench/approvals", async (request) => ({ items: await workbench.approvals(bearerToken(request.headers.authorization)) }));
    server.post<{ Params: { approvalId: string } }>("/v1/workbench/approvals/:approvalId/decision", async (request) => {
      const body = request.body as { expected_version: number; decision: "APPROVE" | "REJECT" };
      return workbench.decide(bearerToken(request.headers.authorization), request.params.approvalId, body.expected_version, body.decision);
    });
    server.post<{ Params: { workspaceId: string } }>("/v1/workbench/tasks/:workspaceId/cancel", async (request) => {
      const { workspace } = await workbench.owned(sstsFrom(dependencies), bearerToken(request.headers.authorization), request.params.workspaceId);
      return workbench.cancel(workspace);
    });
    server.post<{ Params: { workspaceId: string } }>("/v1/workbench/tasks/:workspaceId/write-requests", async (request) => {
      const token = bearerToken(request.headers.authorization);
      const { workspace, inputs } = await workbench.owned(sstsFrom(dependencies), token, request.params.workspaceId);
      return workbench.requestWrite(workspace, token, request.body as { tool_release_id: string; arguments: Record<string, unknown>; call_id: string }, inputs.map((item) => item.resource_ref));
    });
    server.post<{ Params: { workspaceId: string; approvalId: string } }>("/v1/workbench/tasks/:workspaceId/approvals/:approvalId/execute", async (request) => {
      const token = bearerToken(request.headers.authorization);
      const { workspace, inputs } = await workbench.owned(sstsFrom(dependencies), token, request.params.workspaceId);
      return workbench.executeApproved(workspace, token, request.params.approvalId, inputs.map((input) => input.resource_ref));
    });
    server.post<{ Params: { workspaceId: string; operationId: string } }>("/v1/workbench/tasks/:workspaceId/operations/:operationId/reconcile", async (request) => {
      const { workspace } = await workbench.owned(sstsFrom(dependencies), bearerToken(request.headers.authorization), request.params.workspaceId);
      return workbench.reconcile(workspace, request.params.operationId);
    });
    server.get<{ Params: { workspaceId: string } }>("/v1/workbench/tasks/:workspaceId/execution", async (request) => {
      const { workspace } = await workbench.owned(sstsFrom(dependencies), bearerToken(request.headers.authorization), request.params.workspaceId);
      return workbench.projection(workspace);
    });
    server.get<{ Params: { workspaceId: string } }>("/v1/workbench/tasks/:workspaceId/project-data", async (request) => {
      const token = bearerToken(request.headers.authorization);
      const { workspace, inputs } = await workbench.owned(sstsFrom(dependencies), token, request.params.workspaceId);
      return workbench.projectData(workspace, token, inputs.map((input) => input.resource_ref));
    });
    server.post<{ Params: { workspaceId: string } }>("/v1/workbench/tasks/:workspaceId/tools", async (request) => {
      const token = bearerToken(request.headers.authorization);
      const { workspace, inputs } = await workbench.owned(sstsFrom(dependencies), token, request.params.workspaceId);
      const { context } = await workbench.prepare(workspace, token, inputs.map((input) => input.resource_ref));
      const body = request.body as { tool_release_id: string; arguments: Record<string, unknown>; call_id: string; approval_id?: string };
      return workbench.executeTool({ ...body, context });
    });
    server.get<{ Params: { workspaceId: string } }>("/v1/workbench/tasks/:workspaceId/conversation", async (request) => {
      const token = bearerToken(request.headers.authorization);
      const { workspace, inputs } = await workbench.owned(sstsFrom(dependencies), token, request.params.workspaceId);
      return workbench.conversation(workspace, token, inputs.map((input) => input.resource_ref));
    });
    server.post<{ Params: { workspaceId: string } }>("/v1/workbench/tasks/:workspaceId/turns", async (request) => {
      const token = bearerToken(request.headers.authorization);
      const { workspace, inputs } = await workbench.owned(sstsFrom(dependencies), token, request.params.workspaceId);
      const body = request.body as { prompt: string; request_id?: string };
      return workbench.run(workspace, token, body.prompt, inputs.map((input) => input.resource_ref), undefined, body.request_id);
    });
    server.post("/v1/internal/runtime-tools/execute", async (request, reply) => {
      const abort = new AbortController();
      const disconnected = () => { if (!reply.raw.writableEnded) abort.abort(); };
      reply.raw.on("close", disconnected);
      try {
        return await workbench.executeTool(request.body as { context: RuntimeToolContext;
          tool_release_id: string; call_id: string; arguments: Record<string, unknown> }, abort.signal);
      } finally { reply.raw.off("close", disconnected); }
    });
  }

  server.get("/ready", async () => ({
    service: "process-copilot-api",
    status: dependencies.runtimeRegistry === undefined ? "degraded" : "ready",
    dependencies: {
      database: dependencies.databaseConfigured === true
        ? "configured"
        : "not-configured",
      runtime_registry: dependencies.runtimeRegistry === undefined
        ? "not-configured"
        : "ready",
      identity_authorization: dependencies.identityAuthorization === undefined
        ? "not-configured"
        : "ready",
      profile_capability: dependencies.profileCapability === undefined
        ? "not-configured"
        : "ready",
      resource_workspace: dependencies.resourceWorkspace === undefined
        ? "not-configured"
        : "ready",
      controlled_gateway: dependencies.controlledGateway === undefined
        ? "not-configured"
        : "ready",
      event_projection: dependencies.eventProjection === undefined
        ? "not-configured"
        : "ready",
      ssts_draft: dependencies.sstsDraft === undefined
        ? "not-configured"
        : "ready",
      blob: dependencies.resourceWorkspace === undefined
        ? "not-configured"
        : "configured"
    }
  }));

  server.post("/v1/pilot/sign-in", async (request) => {
    if (dependencies.identityProvider) throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "请使用 EE 统一账号登录");
    const body = request.body as {
      tenant_id: string;
      account_key: string;
      secret: string;
    };
    return identityFrom(dependencies).signInPilot(
      body.tenant_id,
      body.account_key,
      body.secret
    );
  });

  server.post("/v1/auth/ee/exchange", async (request, reply) => {
    if (!dependencies.identityProvider) throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "EE login is not enabled");
    // JSON requests cannot be submitted cross-origin by a form. Reject explicit
    // foreign origins as well; the local reverse proxy preserves the browser host.
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) {
      throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "Same-origin login required");
    }
    const body = request.body as { ticket?: unknown; code_verifier?: unknown } | undefined;
    reply.header("Cache-Control", "no-store");
    return dependencies.identityProvider.authenticate({
      kind: "ticket_exchange",
      ticket: body?.ticket,
      code_verifier: body?.code_verifier
    });
  });

  server.post("/v1/auth/logout", async (request, reply) => {
    await identityFrom(dependencies).signOut(bearerToken(request.headers.authorization));
    reply.header("Cache-Control", "no-store");
    return { logged_out: true };
  });

  server.get("/v1/internal/identity/ee-bindings", async (request, reply) => {
    const expected = Buffer.from(dependencies.eeIdentitySecret ?? "");
    const supplied = Buffer.from(String(request.headers["x-pc-adapter-secret"] ?? ""));
    if (!dependencies.identityProvider || expected.length < 24 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new IdentityAuthorizationError("PC_AUTHENTICATION_REQUIRED", "Service authentication required");
    }
    reply.header("Cache-Control", "no-store");
    return dependencies.identityProvider.bindings();
  });

  server.get("/v1/identity/me", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    reply.header("Cache-Control", "no-store");
    const account = await dependencies.identityProvider?.validate(authenticated.session, authenticated.principal);
    return {
      ...(account ? {
        account,
        login_provider: dependencies.identityProvider?.identity_provider_ref
      } : {}),
      principal: authenticated.principal,
      authentication_context_id:
        authenticated.session.authentication_context_id,
      expires_at: authenticated.session.expires_at
    };
  });

  server.post("/v1/authorization/snapshots", async (request) =>
    identityFrom(dependencies).issueAuthorizationSnapshot(
      bearerToken(request.headers.authorization),
      request.body as Parameters<
        IdentityAuthorizationService["issueAuthorizationSnapshot"]
      >[1]
    )
  );

  server.post("/v1/principal-envelopes", async (request) =>
    identityFrom(dependencies).issuePrincipalEnvelope(
      bearerToken(request.headers.authorization),
      request.body as Parameters<
        IdentityAuthorizationService["issuePrincipalEnvelope"]
      >[1]
    )
  );

  server.post("/v1/profile-assignments", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as { profile_release_id: string };
    const assignment = await profilesFrom(dependencies).assignProfile(
      authenticated.principal.principal_id,
      body.profile_release_id
    );
    return reply.status(201).send(assignment);
  });

  server.post("/v1/profile-resolutions", async (request) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as Omit<
      Parameters<ProfileCapabilityService["resolveEffectiveProfile"]>[0],
      "principal_id"
    >;
    if (
      body.authorization_revision
      !== authenticated.principal.authorization_revision
    ) {
      throw new IdentityAuthorizationError(
        "PC_AUTHORIZATION_REVISION_STALE",
        "Profile resolution requested a stale Authorization Revision"
      );
    }
    return profilesFrom(dependencies).resolveEffectiveProfile({
      ...body,
      principal_id: authenticated.principal.principal_id
    });
  });

  server.get<{ Params: { snapshotId: string } }>(
    "/v1/effective-profile-snapshots/:snapshotId",
    async (request, reply) => {
      await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const snapshot = await profilesFrom(
        dependencies
      ).getEffectiveProfileSnapshot(request.params.snapshotId);
      if (snapshot === undefined) return reply.status(404).send({
        error: {
          code: "PC_PROFILE_SNAPSHOT_NOT_FOUND",
          message: "Effective Profile Snapshot was not found",
          retryable: false
        }
      });
      return snapshot;
    }
  );

  server.post("/v1/resources/uploads", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as {
      pc_session_id?: string;
      kind: Parameters<ResourceWorkspaceService["uploadResource"]>[0]["kind"];
      display_name: string;
      classification: Parameters<
        ResourceWorkspaceService["uploadResource"]
      >[0]["classification"];
      owner_scope: Parameters<
        ResourceWorkspaceService["uploadResource"]
      >[0]["owner_scope"];
      media_type: string;
      content_base64: string;
      provenance: Parameters<
        ResourceWorkspaceService["uploadResource"]
      >[0]["provenance"];
    };
    const result = await resourcesFrom(dependencies).uploadResource({
      tenant_id: authenticated.principal.tenant_id,
      principal_id: authenticated.principal.principal_id,
      ...(body.pc_session_id === undefined
        ? {}
        : { pc_session_id: body.pc_session_id }),
      kind: body.kind,
      display_name: body.display_name,
      classification: body.classification,
      owner_scope: body.owner_scope,
      media_type: body.media_type,
      content: Buffer.from(body.content_base64, "base64"),
      provenance: body.provenance
    });
    return reply.status(201).send(result);
  });

  server.post<{ Params: { resourceId: string } }>(
    "/v1/resources/:resourceId/versions",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as {
        expected_version_id: string;
        media_type: string;
        content_base64: string;
        provenance: Parameters<
          ResourceWorkspaceService["createVersion"]
        >[0]["provenance"];
      };
      const result = await resourcesFrom(dependencies).createVersion({
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id,
        resource_id: request.params.resourceId,
        expected_version_id: body.expected_version_id,
        media_type: body.media_type,
        content: Buffer.from(body.content_base64, "base64"),
        provenance: body.provenance
      });
      return reply.status(201).send(result);
    }
  );

  server.get<{ Params: { resourceId: string } }>(
    "/v1/resources/:resourceId",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const projection = await resourcesFrom(dependencies).getResourceProjection(
        request.params.resourceId
      );
      if (
        projection.resource.tenant_id !== authenticated.principal.tenant_id
        || projection.resource.created_by !== authenticated.principal.principal_id
      ) {
        throw new ResourceError(
          "PC_RESOURCE_NOT_FOUND",
          "Resource was not found"
        );
      }
      return projection;
    }
  );

  server.post("/v1/resource-bindings", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as Omit<
      Parameters<ResourceWorkspaceService["createBinding"]>[0],
      "tenant_id" | "principal_id"
    >;
    const binding = await resourcesFrom(dependencies).createBinding({
      ...body,
      tenant_id: authenticated.principal.tenant_id,
      principal_id: authenticated.principal.principal_id
    });
    return reply.status(201).send(binding);
  });

  server.post("/v1/workspace-view-snapshots", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as Omit<
      Parameters<ResourceWorkspaceService["createWorkspaceView"]>[0],
      "tenant_id" | "principal_id"
    >;
    if (
      body.authorization_revision
      !== authenticated.principal.authorization_revision
    ) {
      throw new ResourceError(
        "PC_RESOURCE_AUTHORIZATION_REVISION_STALE",
        "Workspace View requested a stale Authorization Revision"
      );
    }
    const snapshot = await resourcesFrom(dependencies).createWorkspaceView({
      ...body,
      tenant_id: authenticated.principal.tenant_id,
      principal_id: authenticated.principal.principal_id
    });
    return reply.status(201).send(snapshot);
  });

  server.get<{ Params: { snapshotId: string } }>(
    "/v1/workspace-view-snapshots/:snapshotId",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const snapshot = await resourcesFrom(dependencies).getWorkspaceView(
        request.params.snapshotId
      );
      if (snapshot === undefined) {
        return reply.status(404).send({
          error: {
            code: "PC_RESOURCE_WORKSPACE_VIEW_NOT_FOUND",
            message: "Workspace View Snapshot was not found",
            retryable: false
          }
        });
      }
      if (
        snapshot.tenant_id !== authenticated.principal.tenant_id
        || snapshot.principal_id !== authenticated.principal.principal_id
      ) {
        throw new ResourceError(
          "PC_RESOURCE_WORKSPACE_VIEW_SCOPE_MISMATCH",
          "Workspace View belongs to another Principal"
        );
      }
      return snapshot;
    }
  );

  server.post("/v1/materializations", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as Omit<
      Parameters<ResourceWorkspaceService["materialize"]>[0],
      "tenant_id" | "principal_id"
    >;
    const result = await resourcesFrom(dependencies).materialize({
      ...body,
      tenant_id: authenticated.principal.tenant_id,
      principal_id: authenticated.principal.principal_id
    });
    return reply.status(201).send(result);
  });

  server.post("/v1/materializations/cleanup", async (request) => {
    await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    return {
      cleaned: await resourcesFrom(dependencies).cleanupExpired()
    };
  });

  // Keep existing persisted local Runtime configurations working during rollout.
  for (const path of ["/v1/events/ingest", "/v1/internal/events/ingest"]) server.post(path, async (request, reply) => {
    requireEventIngestSecret(
      request.headers["x-pc-event-secret"],
      dependencies.eventIngestSecret
    );
    const body = request.body as { events: EventEnvelope[] };
    const results = await eventsFrom(dependencies).ingest(body.events);
    return reply.status(202).send({ results });
  });

  server.post("/v1/business-tasks", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as {
      profile_release_id: string;
      project_id?: string;
      source_session_ids?: string[];
    };
    const task = await eventsFrom(dependencies).createTask({
      tenant_id: authenticated.principal.tenant_id,
      owner_principal_id: authenticated.principal.principal_id,
      profile_release_id: body.profile_release_id,
      ...(body.project_id === undefined
        ? {}
        : { project_id: body.project_id }),
      ...(body.source_session_ids === undefined
        ? {}
        : { source_session_ids: body.source_session_ids })
    });
    return reply.status(201).send(task);
  });

  server.get("/v1/business-tasks", async (request) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    return {
      tasks: await eventsFrom(dependencies).listTasks(
        authenticated.principal.tenant_id,
        authenticated.principal.principal_id
      )
    };
  });

  server.get<{ Params: { taskId: string } }>(
    "/v1/business-tasks/:taskId",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const task = await eventsFrom(dependencies).getTask(
        request.params.taskId
      );
      if (task === undefined) return reply.status(404).send({
        error: {
          code: "PC_TASK_NOT_FOUND",
          message: "BusinessTask was not found",
          retryable: false
        }
      });
      if (
        task.tenant_id !== authenticated.principal.tenant_id
        || task.owner_principal_id !== authenticated.principal.principal_id
      ) {
        throw new EventProjectionError(
          "PC_TASK_SCOPE_DENIED",
          "BusinessTask belongs to another Principal"
        );
      }
      return {
        task,
        operations: await eventsFrom(dependencies).listTaskOperations(
          task.business_task_id
        )
      };
    }
  );

  server.post<{ Params: { taskId: string } }>(
    "/v1/business-tasks/:taskId/state",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as {
        state: Parameters<EventProjectionService["transitionTask"]>[0]["state"];
        pc_session_id?: string;
        reason_codes?: string[];
      };
      return eventsFrom(dependencies).transitionTask({
        business_task_id: request.params.taskId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id,
        state: body.state,
        ...(body.pc_session_id === undefined
          ? {}
          : { pc_session_id: body.pc_session_id }),
        ...(body.reason_codes === undefined
          ? {}
          : { reason_codes: body.reason_codes })
      });
    }
  );

  server.post<{ Params: { taskId: string } }>(
    "/v1/business-tasks/:taskId/operations",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as Omit<
        Parameters<EventProjectionService["planOperation"]>[0],
        "business_task_id" | "tenant_id" | "principal_id"
      >;
      const operation = await eventsFrom(dependencies).planOperation({
        ...body,
        business_task_id: request.params.taskId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id
      });
      return reply.status(201).send(operation);
    }
  );

  server.post<{ Params: { taskId: string } }>(
    "/v1/business-tasks/:taskId/rebuild",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const task = await eventsFrom(dependencies).getTask(
        request.params.taskId
      );
      if (
        task === undefined
        || task.tenant_id !== authenticated.principal.tenant_id
        || task.owner_principal_id !== authenticated.principal.principal_id
      ) {
        throw new EventProjectionError(
          "PC_TASK_SCOPE_DENIED",
          "BusinessTask is unavailable to this Principal"
        );
      }
      return eventsFrom(dependencies).rebuildTask(request.params.taskId);
    }
  );

  server.get<{ Params: { operationId: string } }>(
    "/v1/business-operations/:operationId",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const operation = await eventsFrom(dependencies).getOperation(
        request.params.operationId
      );
      if (operation === undefined) return reply.status(404).send({
        error: {
          code: "PC_OPERATION_NOT_FOUND",
          message: "BusinessOperation was not found",
          retryable: false
        }
      });
      if (
        operation.tenant_id !== authenticated.principal.tenant_id
        || operation.owner_principal_id
          !== authenticated.principal.principal_id
      ) {
        throw new EventProjectionError(
          "PC_OPERATION_SCOPE_DENIED",
          "BusinessOperation belongs to another Principal"
        );
      }
      return operation;
    }
  );

  server.post<{ Params: { operationId: string } }>(
    "/v1/business-operations/:operationId/verify",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as {
        evidence_refs: string[];
        result_digest?: string;
      };
      return eventsFrom(dependencies).transitionOperation({
        operation_id: request.params.operationId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id,
        state: "SUCCEEDED",
        evidence_refs: body.evidence_refs,
        ...(body.result_digest === undefined
          ? {}
          : { result_digest: body.result_digest })
      });
    }
  );

  server.post("/v1/recovery-cases", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as Omit<
      Parameters<EventProjectionService["openRecoveryCase"]>[0],
      "tenant_id" | "owner_principal_id"
    >;
    const recoveryCase = await eventsFrom(dependencies).openRecoveryCase({
      ...body,
      tenant_id: authenticated.principal.tenant_id,
      owner_principal_id: authenticated.principal.principal_id
    });
    return reply.status(201).send(recoveryCase);
  });

  server.post("/v1/ssts-tasks", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as {
      title: string;
      source_session_ids?: string[];
    };
    const workspace = await sstsFrom(dependencies).createWorkspace({
      tenant_id: authenticated.principal.tenant_id,
      principal_id: authenticated.principal.principal_id,
      title: body.title,
      ...(body.source_session_ids === undefined
        ? {}
        : { source_session_ids: body.source_session_ids })
    });
    return reply.status(201).send(workspace);
  });

  server.get("/v1/ssts-tasks", async (request) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const tasks = await sstsFrom(dependencies).listWorkspaces(
        authenticated.principal.tenant_id,
        authenticated.principal.principal_id
      );
    if (!dependencies.workbench) return { tasks };
    const projects = new Set((await dependencies.workbench.projects(bearerToken(request.headers.authorization))).map(item => item.project_code));
    return { tasks: tasks.filter(task => !task.project_code || projects.has(task.project_code)) };
  });

  server.get<{ Params: { taskId: string } }>(
    "/v1/ssts-tasks/:taskId",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      return sstsFrom(dependencies).getWorkspace({
        workspace_id: request.params.taskId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id
      });
    }
  );

  server.post<{ Params: { taskId: string } }>(
    "/v1/ssts-tasks/:taskId/inputs",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as {
        slot: SstsInputSlot;
        resource_id: string;
        resource_version_id: string;
      };
      const attached = await sstsFrom(dependencies).attachInput({
        workspace_id: request.params.taskId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id,
        slot: body.slot,
        resource_id: body.resource_id,
        resource_version_id: body.resource_version_id
      });
      return reply.status(201).send(attached);
    }
  );

  server.post<{ Params: { taskId: string } }>(
    "/v1/ssts-tasks/:taskId/check-inputs",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      return sstsFrom(dependencies).checkInputs({
        workspace_id: request.params.taskId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id
      });
    }
  );

  server.post<{ Params: { taskId: string } }>(
    "/v1/ssts-tasks/:taskId/messages",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as { content: string };
      const message = await sstsFrom(dependencies).appendMessage({
        workspace_id: request.params.taskId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id,
        content: body.content
      });
      return reply.status(201).send(message);
    }
  );

  server.post<{ Params: { taskId: string } }>(
    "/v1/ssts-tasks/:taskId/drafts/generate",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as { idempotency_key: string };
      const result = await sstsFrom(dependencies).generateDraft({
        workspace_id: request.params.taskId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id,
        idempotency_key: body.idempotency_key,
        execution: { access_token: bearerToken(request.headers.authorization) }
      });
      return reply.status(201).send(result);
    }
  );

  server.post<{
    Params: { taskId: string; draftId: string };
  }>(
    "/v1/ssts-tasks/:taskId/drafts/:draftId/review",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as {
        decision: "ACCEPTED" | "REJECTED";
        comment?: string;
      };
      return sstsFrom(dependencies).reviewDraft({
        workspace_id: request.params.taskId,
        draft_id: request.params.draftId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id,
        decision: body.decision,
        ...(body.comment === undefined ? {} : { comment: body.comment })
      });
    }
  );

  server.get<{
    Params: { taskId: string; draftId: string };
  }>(
    "/v1/ssts-tasks/:taskId/drafts/:draftId/download",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const download = await sstsFrom(dependencies).downloadDraft({
        workspace_id: request.params.taskId,
        draft_id: request.params.draftId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id
      });
      return reply
        .header("content-type", download.media_type)
        .header("content-disposition", `attachment; filename="${encodeURIComponent(
          download.filename
        )}"`)
        .header("etag", download.content_digest)
        .send(Buffer.from(download.content));
    }
  );

  server.post<{ Params: { taskId: string } }>(
    "/v1/ssts-tasks/:taskId/archive",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      return sstsFrom(dependencies).archiveWorkspace({
        workspace_id: request.params.taskId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id
      });
    }
  );

  server.get("/v1/recovery-cases", async (request) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    return {
      recovery_cases: await eventsFrom(dependencies).listRecoveryCases(
        authenticated.principal.tenant_id,
        authenticated.principal.principal_id
      )
    };
  });

  server.get<{ Params: { recoveryCaseId: string } }>(
    "/v1/recovery-cases/:recoveryCaseId",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const recoveryCase = await eventsFrom(dependencies).getRecoveryCase(
        request.params.recoveryCaseId
      );
      if (recoveryCase === undefined) return reply.status(404).send({
        error: {
          code: "PC_RECOVERY_CASE_NOT_FOUND",
          message: "RecoveryCase was not found",
          retryable: false
        }
      });
      if (
        recoveryCase.tenant_id !== authenticated.principal.tenant_id
        || recoveryCase.owner_principal_id
          !== authenticated.principal.principal_id
      ) {
        throw new EventProjectionError(
          "PC_RECOVERY_SCOPE_DENIED",
          "RecoveryCase belongs to another Principal"
        );
      }
      return recoveryCase;
    }
  );

  server.post<{ Params: { recoveryCaseId: string } }>(
    "/v1/recovery-cases/:recoveryCaseId/reconcile",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as {
        authorization?: Parameters<
          EventProjectionService["reconcileRecoveryCase"]
        >[0]["authorization"];
      };
      return eventsFrom(dependencies).reconcileRecoveryCase({
        recovery_case_id: request.params.recoveryCaseId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id,
        ...(body.authorization === undefined
          ? {}
          : { authorization: body.authorization })
      });
    }
  );

  server.post<{ Params: { recoveryCaseId: string } }>(
    "/v1/recovery-cases/:recoveryCaseId/migrate",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as Omit<
        Parameters<EventProjectionService["migrateRecoveryCase"]>[0],
        "recovery_case_id" | "tenant_id" | "principal_id"
      >;
      return eventsFrom(dependencies).migrateRecoveryCase({
        ...body,
        recovery_case_id: request.params.recoveryCaseId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id
      });
    }
  );

  server.post("/v1/connectors", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as Omit<
      Parameters<ControlledExecutionGatewayService["registerConnector"]>[0],
      "tenant_id"
    >;
    const connector = await gatewayFrom(dependencies).registerConnector({
      ...body,
      tenant_id: authenticated.principal.tenant_id
    });
    return reply.status(201).send(connector);
  });

  server.post<{ Params: { connectorId: string } }>(
    "/v1/connectors/:connectorId/state",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as {
        expected_revision: number;
        state: "ACTIVE" | "DISABLED";
      };
      return gatewayFrom(dependencies).updateConnectorState({
        tenant_id: authenticated.principal.tenant_id,
        connector_id: request.params.connectorId,
        expected_revision: body.expected_revision,
        state: body.state
      });
    }
  );

  server.post("/v1/external-account-bindings", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as {
      connector_id: string;
      external_account_id: string;
      credential_subject: string;
      secret_ref: string;
    };
    const binding = await gatewayFrom(dependencies).bindExternalAccount({
      ...body,
      tenant_id: authenticated.principal.tenant_id,
      principal_id: authenticated.principal.principal_id
    });
    return reply.status(201).send(publicAccount(binding));
  });

  server.post<{ Params: { bindingId: string } }>(
    "/v1/external-account-bindings/:bindingId/rotate",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as {
        expected_generation: number;
        secret_ref: string;
      };
      const binding = await gatewayFrom(dependencies).rotateExternalAccount({
        ...body,
        binding_id: request.params.bindingId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id
      });
      return publicAccount(binding);
    }
  );

  server.post<{ Params: { bindingId: string } }>(
    "/v1/external-account-bindings/:bindingId/revoke",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as { expected_generation: number };
      const binding = await gatewayFrom(dependencies).revokeExternalAccount({
        ...body,
        binding_id: request.params.bindingId,
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id
      });
      return publicAccount(binding);
    }
  );

  server.post("/v1/approvals", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const body = request.body as Omit<
      Parameters<ControlledExecutionGatewayService["requestApproval"]>[0],
      "tenant_id" | "requested_by" | "actor_principal_id"
    >;
    if (
      body.authorization_revision
      !== authenticated.principal.authorization_revision
    ) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_AUTHORIZATION_STALE",
        "Approval requested a stale Authorization Revision"
      );
    }
    const approval = await gatewayFrom(dependencies).requestApproval({
      ...body,
      tenant_id: authenticated.principal.tenant_id,
      requested_by: authenticated.principal.principal_id,
      actor_principal_id: authenticated.principal.principal_id
    });
    return reply.status(201).send(approval);
  });

  server.post<{ Params: { approvalId: string } }>(
    "/v1/approvals/:approvalId/decision",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as Omit<
        Parameters<ControlledExecutionGatewayService["decideApproval"]>[0],
        "tenant_id" | "approval_id" | "approver_principal_id"
      >;
      return gatewayFrom(dependencies).decideApproval({
        ...body,
        tenant_id: authenticated.principal.tenant_id,
        approval_id: request.params.approvalId,
        approver_principal_id: authenticated.principal.principal_id
      });
    }
  );

  server.get<{ Params: { approvalId: string } }>(
    "/v1/approvals/:approvalId",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const approval = await gatewayFrom(dependencies).getApproval(
        request.params.approvalId
      );
      if (approval === undefined) return reply.status(404).send({
        error: {
          code: "PC_GATEWAY_APPROVAL_NOT_FOUND",
          message: "Business Approval was not found",
          retryable: false
        }
      });
      if (
        approval.tenant_id !== authenticated.principal.tenant_id
        || (
          approval.subject_principal_id
            !== authenticated.principal.principal_id
          && approval.decision.decided_by
            !== authenticated.principal.principal_id
        )
      ) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_APPROVAL_SCOPE_DENIED",
          "Approval belongs to another Principal"
        );
      }
      return approval;
    }
  );

  server.post("/v1/gateway/execute", async (request, reply) => {
    const authenticated = await identityFrom(dependencies).authenticate(
      bearerToken(request.headers.authorization)
    );
    const execution = request.body as ToolExecutionEnvelope;
    if (
      execution.principal_envelope.tenant_id
        !== authenticated.principal.tenant_id
      || execution.principal_envelope.subject_principal_id
        !== authenticated.principal.principal_id
    ) {
      throw new ControlledGatewayError(
        "PC_GATEWAY_PRINCIPAL_SCOPE_DENIED",
        "Execution Envelope belongs to another Principal"
      );
    }
    const abort = new AbortController();
    const onClose = () => { if (!reply.raw.writableFinished) abort.abort(); };
    reply.raw.on("close", onClose);
    try {
      return await gatewayFrom(dependencies).execute(execution, { signal: abort.signal });
    } finally {
      reply.raw.off("close", onClose);
    }
  });

  server.get<{ Params: { operationId: string } }>(
    "/v1/operations/:operationId",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const operation = await gatewayFrom(dependencies).getOperation(
        request.params.operationId
      );
      if (operation === undefined) return reply.status(404).send({
        error: {
          code: "PC_GATEWAY_OPERATION_NOT_FOUND",
          message: "External Operation was not found",
          retryable: false
        }
      });
      if (
        operation.tenant_id !== authenticated.principal.tenant_id
        || operation.principal_id !== authenticated.principal.principal_id
      ) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_OPERATION_SCOPE_DENIED",
          "Operation belongs to another Principal"
        );
      }
      return operation;
    }
  );

  server.post<{ Params: { operationId: string } }>(
    "/v1/operations/:operationId/reconcile",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const operation = await gatewayFrom(dependencies).getOperation(
        request.params.operationId
      );
      if (
        operation === undefined
        || operation.tenant_id !== authenticated.principal.tenant_id
        || operation.principal_id !== authenticated.principal.principal_id
      ) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_OPERATION_SCOPE_DENIED",
          "Operation is unavailable to this Principal"
        );
      }
      return gatewayFrom(dependencies).reconcile(request.params.operationId);
    }
  );

  server.get<{ Params: { operationId: string } }>(
    "/v1/operations/:operationId/audit",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const operation = await gatewayFrom(dependencies).getOperation(
        request.params.operationId
      );
      if (
        operation === undefined
        || operation.tenant_id !== authenticated.principal.tenant_id
        || operation.principal_id !== authenticated.principal.principal_id
      ) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_OPERATION_SCOPE_DENIED",
          "Operation is unavailable to this Principal"
        );
      }
      return {
        entries: await gatewayFrom(dependencies).listOperationAudit(
          request.params.operationId
        )
      };
    }
  );

  server.get<{ Params: { bindingId: string } }>(
    "/v1/mcp-session-bindings/:bindingId",
    async (request, reply) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const binding = await gatewayFrom(dependencies).getMcpSessionBinding(
        request.params.bindingId
      );
      if (binding === undefined) return reply.status(404).send({
        error: {
          code: "PC_GATEWAY_MCP_BINDING_NOT_FOUND",
          message: "MCP Session Binding was not found",
          retryable: false
        }
      });
      if (
        binding.tenant_id !== authenticated.principal.tenant_id
        || binding.principal_id !== authenticated.principal.principal_id
      ) {
        throw new ControlledGatewayError(
          "PC_GATEWAY_MCP_BINDING_SCOPE_DENIED",
          "MCP Session Binding belongs to another Principal"
        );
      }
      return binding;
    }
  );

  server.post<{ Params: { resourceId: string } }>(
    "/v1/resources/:resourceId/lifecycle",
    async (request) => {
      const authenticated = await identityFrom(dependencies).authenticate(
        bearerToken(request.headers.authorization)
      );
      const body = request.body as {
        expected_lifecycle: Parameters<
          ResourceWorkspaceService["transitionLifecycle"]
        >[0]["expected_lifecycle"];
        lifecycle: Parameters<
          ResourceWorkspaceService["transitionLifecycle"]
        >[0]["lifecycle"];
      };
      return resourcesFrom(dependencies).transitionLifecycle({
        tenant_id: authenticated.principal.tenant_id,
        principal_id: authenticated.principal.principal_id,
        resource_id: request.params.resourceId,
        expected_lifecycle: body.expected_lifecycle,
        lifecycle: body.lifecycle
      });
    }
  );

  server.post("/v1/runtimes/register", async (request, reply) => {
    const result = await registryFrom(dependencies).registerRuntime(
      request.body as RegisterRuntimeInput
    );
    return reply.status(201).send(result);
  });

  server.post<{ Params: { runtimeId: string } }>(
    "/v1/runtimes/:runtimeId/state",
    async (request) => {
      const body = request.body as {
        runtime_epoch: number;
        expected_version: number;
        state: RuntimeRegistryState;
        drain_reason?: string;
        cleanup_report?: Record<string, unknown>;
      };
      return registryFrom(dependencies).setRuntimeState({
        runtime_id: request.params.runtimeId,
        runtime_epoch: body.runtime_epoch,
        expected_version: body.expected_version,
        state: body.state,
        ...(body.drain_reason === undefined
          ? {}
          : { drain_reason: body.drain_reason }),
        ...(body.cleanup_report === undefined
          ? {}
          : { cleanup_report: body.cleanup_report })
      });
    }
  );

  server.post<{ Params: { runtimeId: string } }>(
    "/v1/runtimes/:runtimeId/heartbeats",
    async (request) => {
      const body = request.body as {
        expected_version: number;
        report: RuntimeHealthReport;
      };
      if (body.report.runtime_id !== request.params.runtimeId) {
        throw new RuntimeRegistryError(
          "PC_RUNTIME_ID_MISMATCH",
          "Heartbeat route and report Runtime IDs differ"
        );
      }
      return registryFrom(dependencies).recordHeartbeat(
        body.report,
        body.expected_version
      );
    }
  );

  server.get<{ Params: { runtimeId: string } }>(
    "/v1/runtimes/:runtimeId",
    async (request) =>
      registryFrom(dependencies).getRuntimeProjection(request.params.runtimeId)
  );

  server.post("/v1/session-assignments", async (request, reply) => {
    const result = await registryFrom(dependencies).assignSession(
      request.body as CreateAssignmentInput
    );
    return reply.status(201).send(result);
  });

  server.post<{ Params: { pcSessionId: string } }>(
    "/v1/session-assignments/:pcSessionId/renew",
    async (request) => {
      const body = request.body as Omit<RenewAssignmentInput, "pc_session_id">;
      return registryFrom(dependencies).renewAssignment({
        ...body,
        pc_session_id: request.params.pcSessionId
      });
    }
  );

  server.post<{ Params: { pcSessionId: string } }>(
    "/v1/session-assignments/:pcSessionId/revoke",
    async (request) => {
      const body = request.body as {
        expected_version: number;
        reason: string;
      };
      return registryFrom(dependencies).revokeAssignment({
        pc_session_id: request.params.pcSessionId,
        expected_version: body.expected_version,
        reason: body.reason
      });
    }
  );

  server.post("/v1/session-assignments/expire", async () => ({
    expired: await registryFrom(dependencies).expireLeases()
  }));

  server.get<{ Params: { pcSessionId: string } }>(
    "/v1/sessions/:pcSessionId/execution",
    async (request) =>
      registryFrom(dependencies).getSessionProjection(request.params.pcSessionId)
  );

  server.post("/v1/runtime-guards/evaluate", async (request) =>
    registryFrom(dependencies).evaluateGuard(
      request.body as AssignmentGuardInput
    )
  );

  server.post("/v1/runtime-commands", async (request) =>
    registryFrom(dependencies).dispatchSessionCommand(
      request.body as RuntimeCommand
    )
  );

  return server;
}
