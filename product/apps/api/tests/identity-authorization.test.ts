import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { IdentityAuthorizationService } from "@pc/application";
import { MemoryIdentityAuthorizationRepository } from "@pc/persistence";
import { buildApiServer } from "../src/server.js";
import { LocalIdentityProvider } from "../src/local-identity-provider.js";
import type { RuntimeWorkbench } from "../src/workbench.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Identity and Authorization API", () => {
  it("signs in a controlled Pilot account and issues bounded authority", async () => {
    const service = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      "api-test-signing-key-00000000000000000000",
      [],
      () => new Date("2026-11-10T06:00:00.000Z")
    );
    await service.initialize();
    const provisioned = await service.provisionPilotAccount({
      tenant_id: "tenant-api",
      account_key: "pilot.api",
      secret: "PilotSecret123"
    });
    await service.replaceAuthorizationGrants({
      principal_id: provisioned.principal.principal_id,
      expected_authorization_revision:
        provisioned.principal.authorization_revision,
      grants: [{
        action: "resource.read",
        scope_type: "project",
        scope_id: "project-api",
        effect: "allow",
        evidence_ref: "pilot-grant:project-api"
      }]
    });
    const server = buildApiServer({
      identityAuthorization: service,
      localIdentityProvider: new LocalIdentityProvider(service, "tenant-api"),
      providerMode: "standalone"
    });
    servers.push(server);

    const signIn = await server.inject({
      method: "POST",
      url: "/v1/pilot/sign-in",
      payload: {
        tenant_id: "tenant-api",
        account_key: "pilot.api",
        secret: "PilotSecret123"
      }
    });
    expect(signIn.statusCode).toBe(200);
    const accessToken = signIn.json().access_token as string;

    const identity = await server.inject({
      method: "GET",
      url: "/v1/identity/me",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(identity.statusCode).toBe(200);
    expect(identity.json()).toMatchObject({
      login_provider: "pc-local",
      principal: {
        principal_id: provisioned.principal.principal_id,
        tenant_id: "tenant-api"
      }
    });

    const snapshotResponse = await server.inject({
      method: "POST",
      url: "/v1/authorization/snapshots",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        actions: ["resource.read"],
        resource_scope_refs: ["project:project-api"],
        tool_release_ids: ["tool:ssts-draft:1"],
        policy_model_revision: 1,
        profile_release_id: "profile:fo:1"
      }
    });
    expect(snapshotResponse.statusCode).toBe(200);
    const snapshot = snapshotResponse.json();
    expect(snapshot.decision).toBe("ALLOW");

    const envelope = await server.inject({
      method: "POST",
      url: "/v1/principal-envelopes",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        snapshot,
        audience: "runtime:runtime-api",
        pc_session_id: "session-api",
        runtime_id: "runtime-api",
        runtime_epoch: 1,
        assignment_generation: 1,
        resource_scope_refs: ["project:project-api"]
      }
    });
    expect(envelope.statusCode).toBe(200);
    expect(envelope.json()).toMatchObject({
      subject_principal_id: provisioned.principal.principal_id,
      allowed_actions: ["resource.read"],
      runtime_id: "runtime-api"
    });
  });

  it("rejects missing or invalid bearer sessions", async () => {
    const service = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      "api-test-signing-key-00000000000000000000"
    );
    await service.initialize();
    const server = buildApiServer({ identityAuthorization: service });
    servers.push(server);

    const missing = await server.inject({
      method: "GET",
      url: "/v1/identity/me"
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("PC_AUTHENTICATION_REQUIRED");
  });

  it("reports Provider-local degradation without marking PC Core unhealthy", async () => {
    const service = new IdentityAuthorizationService(
      new MemoryIdentityAuthorizationRepository(),
      "api-test-signing-key-00000000000000000000"
    );
    await service.initialize();
    service.registerExternalAuthorizationPort({
      provider_registration_id: "provider:eeclaw",
      resource_authority: "eeclaw",
      evaluate: async () => ({ decision: "ALLOW", reason_codes: [], evidence_refs: [] })
    });
    service.registerProviderHealthPorts("provider:eeclaw", ["project_directory"]);
    service.markProviderFailure(
      "provider:eeclaw",
      "UNAVAILABLE",
      "provider_test_unavailable"
    );
    const workbench = {
      hasProjectProvider: () => false
    } as unknown as RuntimeWorkbench;
    const server = buildApiServer({
      identityAuthorization: service,
      providerMode: "ee-connected",
      workbench
    });
    servers.push(server);

    const health = await server.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      capabilities: {
        core: "configured",
        personal_workbench: "available",
        ee_provider: "unavailable",
        project_workbench: "unavailable"
      },
      provider_health: {
        provider_registration_id: "provider:eeclaw",
        provider_state: "UNAVAILABLE",
        reason_codes: expect.arrayContaining(["provider_test_unavailable"])
      }
    });
  });
});
