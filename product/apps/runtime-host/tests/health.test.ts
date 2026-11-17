import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RuntimeHostConfig } from "../src/config.js";
import { RuntimeHostService } from "../src/runtime-service.js";
import { buildRuntimeHostServer } from "../src/server.js";
import { FileRuntimeStateStore } from "../src/state-store.js";
import { FakeDshRuntime } from "./helpers.js";

const servers: FastifyInstance[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Runtime Host health", () => {
  it("reports DEV-06 assignment and Resource Workspace guard readiness", async () => {
    const root = await mkdtemp(join(tmpdir(), "pc-runtime-health-"));
    roots.push(root);
    const config: RuntimeHostConfig = {
      runtimeId: "runtime-health",
      runtimeEpoch: 1,
      stateRoot: join(root, "state"),
      dshHome: join(root, "dsh-home"),
      workspace: join(root, "workspace"),
      profile: "sdk-minimal",
      profilePatch: join(root, "profile.patch.yml"),
      provider: "fake",
      model: "fake",
      initializeTimeoutMs: 5_000,
      childEnvironment: {}
    };
    const service = new RuntimeHostService(
      config,
      new FakeDshRuntime(),
      new FileRuntimeStateStore(config.stateRoot)
    );
    await service.initialize();
    const server = buildRuntimeHostServer(service);
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "process-copilot-runtime-host",
      runtime_state: "READY",
      bridge_state: "READY",
      assigned_sessions: 0,
      dsh: {
        controlBridge: {
          state: "READY",
          protocolVersion: "1.0"
        }
      }
    });
    const capabilities = await server.inject({ method: "GET", url: "/capabilities" });
    expect(capabilities.json()).toMatchObject({
      stage: "DEV-08",
      bridge_protocol_version: "1.0",
      event_export: {
        history_catch_up: true,
        catch_up_durability: "DURABLE_DSH"
      }
    });
    expect(capabilities.json().supported_commands).toEqual(
      expect.arrayContaining([
        "CANCEL_TURN",
        "FLUSH_SESSION",
        "CATCH_UP_EVENTS",
        "REVOKE_SESSION",
        "DRAIN_RUNTIME"
      ])
    );
    expect(capabilities.json()).toMatchObject({
      session_release: {
        supported: true,
        transport: "PC_BRIDGE_SESSION_RELEASE",
        durable: true
      },
      cleanup: {
        finalizer_aggregation: true,
        cleanup_report: true
      },
      assignment_guard: {
        authority_cache: true,
        step_guard: true,
        monotonic_tool_guard: true,
        fail_closed: true
      },
      resource_workspace: {
        workspace_view_snapshot: true,
        opaque_materialization_handle: true,
        typed_path_resolution: true,
        ttl_guard: true
      }
    });
  });
});
