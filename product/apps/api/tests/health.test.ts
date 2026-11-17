import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApiServer } from "../src/server.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("API health", () => {
  it("reports the contract baseline", async () => {
    const server = buildApiServer();
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "process-copilot-api",
      status: "ok",
      contract_baseline: "v1"
    });
  });
});
