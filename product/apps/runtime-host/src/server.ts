import Fastify, { type FastifyInstance } from "fastify";
import type { RuntimeCommand } from "@pc/runtime-adapter";
import type { RuntimeHostService } from "./runtime-service.js";
import { timingSafeEqual } from "node:crypto";

export function buildRuntimeHostServer(service: RuntimeHostService, serviceSecret?: string): FastifyInstance {
  const server = Fastify({ logger: true });
  server.addHook("onRequest", async (request, reply) => {
    if (serviceSecret && request.url !== "/health") {
      const presented = Buffer.from(String(request.headers["x-pc-runtime-secret"] ?? ""));
      const expected = Buffer.from(serviceSecret);
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
        return reply.code(401).send({ error: { code: "PC_RUNTIME_SERVICE_AUTH_REQUIRED" } });
      }
    }
  });

  server.get("/health", async () => service.health());

  server.get("/capabilities", async () => service.capabilities());

  server.post("/v1/runtime/commands", async (request) =>
    service.execute(request.body as RuntimeCommand)
  );

  server.get<{ Params: { pcSessionId: string } }>(
    "/v1/sessions/:pcSessionId/conversation",
    async (request) => service.conversation(request.params.pcSessionId)
  );

  server.get<{ Params: { pcSessionId: string } }>(
    "/v1/sessions/:pcSessionId/events",
    async (request) => ({
      pc_session_id: request.params.pcSessionId,
      events: await service.events(request.params.pcSessionId)
    })
  );

  server.get<{
    Params: { pcSessionId: string };
    Querystring: { kind?: "step" | "tool" };
  }>(
    "/v1/internal/assignments/:pcSessionId/guard",
    async (request) =>
      service.assignmentGuard(
        request.params.pcSessionId,
        request.query.kind === "tool" ? "tool" : "step"
      )
  );

  server.addHook("onClose", async () => {
    await service.close();
  });

  return server;
}
