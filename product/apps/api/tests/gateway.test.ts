import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IdentityAuthorizationService } from "@pc/application";
import type {
  EffectiveProfileSnapshot,
  ToolRelease
} from "@pc/domain";
import {
  ControlledExecutionGatewayService,
  DeterministicGatewayProvider,
  EphemeralCredentialIssuer,
  type GatewayProfilePort,
  type GatewayRuntimePort,
  type GatewayWorkspacePort
} from "@pc/gateway";
import {
  MemoryGatewayRepository,
  MemoryIdentityAuthorizationRepository
} from "@pc/persistence";
import { buildApiServer } from "../src/server.js";

const TOOL: ToolRelease = {
  contract_name: "pc.tool-release/1",
  contract_version: 1,
  tool_release_id: "tool:api-write:1",
  tool_definition_id: "tool:api-write",
  version: 1,
  provider_kind: "test-provider",
  input_schema: { type: "object" },
  output_schema: { type: "object" },
  schema_digest: createHash("sha256").update("api-write").digest("hex"),
  risk_manifest: {
    action_class: "EXTERNAL_SIDE_EFFECT",
    external_side_effect: true,
    sensitivity: "HIGH",
    requires_readback: false
  },
  required_permissions: ["records.write"],
  approval_policy: "ALWAYS",
  idempotency_class: "IDEMPOTENT",
  recovery_class: "RECONCILE_BEFORE_RETRY",
  compatibility: { contract: "1" },
  status: "PUBLISHED",
  artifact_refs: ["artifact:api-write:1"],
  release_digest: createHash("sha256").update("api-write-release").digest("hex")
};

const profiles: GatewayProfilePort = {
  getToolRelease: (toolReleaseId) =>
    Promise.resolve(toolReleaseId === TOOL.tool_release_id ? TOOL : undefined),
  getEffectiveProfileSnapshot: (): Promise<
    EffectiveProfileSnapshot | undefined
  > =>
    Promise.resolve(undefined)
};

const runtime: GatewayRuntimePort = {
  getSessionProjection: () => Promise.reject(new Error("unused")),
  evaluateToolGuard: () => Promise.reject(new Error("unused"))
};

const workspace: GatewayWorkspacePort = {
  getWorkspaceView: () => Promise.resolve(undefined)
};

describe("DEV-07 Gateway API authentication and isolation", () => {
  it("injects tenant/principal authority and never exposes secret_ref", async () => {
    const identity = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      "dev07-api-signing-key-00000000000000000000",
      [],
      () => new Date("2026-11-10T12:00:00.000Z")
    );
    await identity.initialize();
    const first = await identity.provisionPilotAccount({
      tenant_id: "tenant-api",
      account_key: "first",
      secret: "FirstSecret123"
    });
    const second = await identity.provisionPilotAccount({
      tenant_id: "tenant-api",
      account_key: "second",
      secret: "SecondSecret123"
    });
    const firstSignIn = await identity.signInPilot(
      "tenant-api",
      "first",
      "FirstSecret123"
    );
    const secondSignIn = await identity.signInPilot(
      "tenant-api",
      "second",
      "SecondSecret123"
    );
    const gateway = new ControlledExecutionGatewayService(
      new MemoryGatewayRepository(),
      identity,
      profiles,
      runtime,
      workspace,
      new EphemeralCredentialIssuer(),
      new DeterministicGatewayProvider(),
      () => new Date("2026-11-10T12:00:00.000Z")
    );
    await gateway.initialize();
    const server = buildApiServer({
      identityAuthorization: identity,
      controlledGateway: gateway
    });
    await server.ready();
    try {
      const connectorResponse = await server.inject({
        method: "POST",
        url: "/v1/connectors",
        headers: {
          authorization: `Bearer ${firstSignIn.access_token}`
        },
        payload: {
          mcp_server_id: "mcp:api",
          endpoint_ref: "internal://api-provider",
          provider_key: "test-provider",
          auth_mode: "delegated",
          audience: "test-provider",
          allowed_scopes: ["records.write"],
          tool_release_ids: [TOOL.tool_release_id],
          capability_digest: `sha256:${"a".repeat(64)}`
        }
      });
      expect(connectorResponse.statusCode).toBe(201);
      const connector = connectorResponse.json<{
        connector_id: string;
        tenant_id: string;
      }>();
      expect(connector.tenant_id).toBe("tenant-api");

      const bindingResponse = await server.inject({
        method: "POST",
        url: "/v1/external-account-bindings",
        headers: {
          authorization: `Bearer ${firstSignIn.access_token}`
        },
        payload: {
          connector_id: connector.connector_id,
          external_account_id: "external-first",
          credential_subject: "subject-first",
          secret_ref: "vault:secret-first"
        }
      });
      expect(bindingResponse.statusCode).toBe(201);
      expect(bindingResponse.body).not.toContain("vault:secret-first");
      expect(bindingResponse.json()).not.toHaveProperty("secret_ref");
      const binding = bindingResponse.json<{
        external_account_binding_id: string;
      }>();

      const crossUserRotate = await server.inject({
        method: "POST",
        url:
          `/v1/external-account-bindings/${binding.external_account_binding_id}/rotate`,
        headers: {
          authorization: `Bearer ${secondSignIn.access_token}`
        },
        payload: {
          expected_generation: 1,
          secret_ref: "vault:attacker"
        }
      });
      expect(crossUserRotate.statusCode).toBe(409);
      expect(crossUserRotate.body).not.toContain("vault:");

      const approvalResponse = await server.inject({
        method: "POST",
        url: "/v1/approvals",
        headers: {
          authorization: `Bearer ${firstSignIn.access_token}`
        },
        payload: {
          operation_id: "operation-api",
          tool_release_id: TOOL.tool_release_id,
          arguments: { record_id: "record-1" },
          resource_scope_refs: ["project:project-1"],
          authorization_revision: first.principal.authorization_revision
        }
      });
      expect(approvalResponse.statusCode).toBe(201);
      const approval = approvalResponse.json<{
        approval_id: string;
        approval_version: number;
        subject_principal_id: string;
      }>();
      expect(approval.subject_principal_id).toBe(first.principal.principal_id);

      const deniedProjection = await server.inject({
        method: "GET",
        url: `/v1/approvals/${approval.approval_id}`,
        headers: {
          authorization: `Bearer ${secondSignIn.access_token}`
        }
      });
      expect(deniedProjection.statusCode).toBe(403);

      const decision = await server.inject({
        method: "POST",
        url: `/v1/approvals/${approval.approval_id}/decision`,
        headers: {
          authorization: `Bearer ${secondSignIn.access_token}`
        },
        payload: {
          expected_version: approval.approval_version,
          decision: "APPROVE",
          reason_codes: ["business_owner_approved"],
          evidence_refs: ["ticket:api-1"]
        }
      });
      expect(decision.statusCode).toBe(200);
      expect(decision.json()).toMatchObject({
        status: "APPROVED",
        decision: { decided_by: second.principal.principal_id }
      });

      const ownerProjection = await server.inject({
        method: "GET",
        url: `/v1/approvals/${approval.approval_id}`,
        headers: {
          authorization: `Bearer ${firstSignIn.access_token}`
        }
      });
      expect(ownerProjection.statusCode).toBe(200);
    } finally {
      await server.close();
      await gateway.close();
      await identity.close();
    }
  });
});
