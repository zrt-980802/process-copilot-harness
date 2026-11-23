import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { createConnection } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EventProjectionService } from "@pc/event-projection";
import { PostgresEventProjectionRepository, PostgresGatewayRepository } from "@pc/persistence";
import { ReadOperationVerifier } from "../src/read-operation-verifier.js";
import { readOperationFixture } from "./support/read-operation-fixture.js";

const execute = promisify(execFile);
const enabled = process.env.PC_RCI03_POSTGRES_TEST === "1";
const runId = `rci03-pg-${randomUUID()}`;
const container = runId;
const volume = `${runId}-data`;
const network = `${runId}-network`;
const label = "pc.rci03.pg.run";
const productRoot = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = join(productRoot, "reports", "rci-03-postgres", runId);
const openConnections = new Set<{ close(): Promise<void> }>();
let url = "";
let password = "";
let created = false;
let baseline: string[] = [];
const results: Record<string, unknown> = {};

async function docker(...args: string[]) {
  try {
    return (await execute("docker", args, { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
  } catch {
    // Never propagate child-process arguments: container creation includes a
    // generated task-only database credential.
    throw new Error(`Task Docker command failed: ${args[0]}`);
  }
}

async function existingContainers() {
  const ids = (await docker("ps", "-aq")).split(/\s+/u).filter(Boolean);
  if (!ids.length) return [];
  return (await docker("inspect", "--format", "{{.Id}}|{{.Name}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}", ...ids))
    .split("\n").filter(line => !line.includes(`|/${container}|`)).sort();
}

async function save(name: string, value: unknown) {
  await writeFile(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function assertOwnContainer() {
  expect(await docker("inspect", "--format", `{{index .Config.Labels "${label}"}}`, container)).toBe(runId);
  expect(await docker("inspect", "--format", "{{range .Mounts}}{{.Name}}{{end}}", container)).toBe(volume);
}

async function ready() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "rci03", "-d", "rci03")).includes("accepting connections")) return;
    } catch { /* The task-owned database may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Task-owned PostgreSQL did not become ready");
}

async function refreshEndpoint() {
  await assertOwnContainer();
  const binding = JSON.parse(await docker("inspect", "--format", '{{json (index .NetworkSettings.Ports "5432/tcp")}}', container));
  expect(binding).toHaveLength(1);
  expect(binding[0].HostIp).toBe("127.0.0.1");
  const port = Number(binding[0].HostPort);
  url = `postgresql://rci03:${password}@127.0.0.1:${port}/rci03`;
  for (let attempt = 0; attempt < 40; attempt++) {
    const connected = await new Promise<boolean>(resolve => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const finish = (success: boolean) => { socket.destroy(); resolve(success); };
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.setTimeout(1_000, () => finish(false));
    });
    if (connected) return { host: "127.0.0.1", port };
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Task PostgreSQL loopback publication did not become ready");
}

async function sql(query: string) {
  await assertOwnContainer();
  return docker("exec", container, "psql", "-U", "rci03", "-d", "rci03", "-At", "-v", "ON_ERROR_STOP=1", "-c", query);
}

async function databaseIdentity() {
  return JSON.parse(await sql("SELECT json_build_object('database',current_database(),'postmaster_started',pg_postmaster_start_time(),'system_identifier',(SELECT system_identifier::text FROM pg_control_system()))"));
}

function stores(suffix: string) {
  if (!created || !url) throw new Error("Task database is not initialized");
  const gateway = new PostgresGatewayRepository(url);
  const projection = new PostgresEventProjectionRepository(url);
  openConnections.add(gateway);
  openConnections.add(projection);
  return { gateway, projection, suffix: `${runId}-${suffix}` };
}

async function closeConnections() {
  const pending = [...openConnections];
  openConnections.clear();
  const closed = await Promise.allSettled(pending.map(connection => connection.close()));
  const failed = closed.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

describe.skipIf(!enabled).sequential("RCI-03 task-owned real PostgreSQL persistence (synthetic Provider Port)", () => {
  beforeAll(async () => {
    await mkdir(evidence, { recursive: true });
    baseline = await existingContainers();
    await save("existing-containers-before.json", baseline);
    const image = await docker("image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}");
    expect(image).toMatch(/^sha256:[0-9a-f]{64}$/u);
    password = randomBytes(32).toString("hex");
    await docker("volume", "create", "--label", `${label}=${runId}`, volume);
    await docker("network", "create", "--label", `${label}=${runId}`, network);
    await docker("run", "-d", "--pull=never", "--name", container, "--label", `${label}=${runId}`,
      "--network", network, "--mount", `type=volume,source=${volume},target=/var/lib/postgresql/data`,
      "--publish", "127.0.0.1::5432", "--memory", "512m", "--cpus", "1",
      "--env", "POSTGRES_USER=rci03", "--env", "POSTGRES_DB=rci03", "--env", `POSTGRES_PASSWORD=${password}`, image);
    created = true;
    await assertOwnContainer();
    await ready();
    const endpoint = await refreshEndpoint();
    await save("environment.json", { run_id: runId, container, volume, network, image_id: image,
      ...endpoint, database: "rci03", evidence, credential: "generated at runtime; omitted" });
    console.log(`RCI03_POSTGRES_EVIDENCE=${evidence}`);
  }, 60_000);

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    try {
      await closeConnections();
    } finally {
      if (created) {
        await assertOwnContainer();
        const logs = await execute("docker", ["logs", "--tail", "250", container], { windowsHide: true, timeout: 15_000 });
        await writeFile(join(evidence, "postgres.log"), `${logs.stdout}\n${logs.stderr}`.replaceAll(password, "[REDACTED]"), { flag: "wx" });
        await docker("stop", "--time", "10", container);
        await save("resources-final.json", { container, volume, network, state: await docker("inspect", "--format", "{{.State.Status}}", container),
          policy: "Task container stopped; container, volume, network and evidence retained. No historical resources modified." });
      }
      const after = await existingContainers();
      await save("existing-containers-after.json", after);
      await save("results.json", results);
      expect(after).toEqual(baseline);
    }
  }, 45_000);

  it("persists first success and repairs a Gateway idempotency hit without another dispatch", async () => {
    const first = await readOperationFixture(true, "READ", stores("first"));
    const result = await first.gateway.execute(first.envelope);
    expect((await first.events.getOperation(first.input.operation_id))?.state).toBe("SUCCEEDED");
    const replay = await readOperationFixture(false, "READ", stores("replay"));
    await replay.gateway.execute(replay.envelope);
    expect((await replay.events.getOperation(replay.input.operation_id))?.state).toBe("VERIFYING");
    replay.publisher.verifyReadOperation = async input => { await replay.verifier.verify(input); };
    await replay.gateway.execute(replay.envelope);
    expect((await replay.events.getOperation(replay.input.operation_id))?.state).toBe("SUCCEEDED");
    expect(first.dispatch).toHaveBeenCalledTimes(1);
    expect(replay.dispatch).toHaveBeenCalledTimes(1);
    results.first_and_replay = { operation_ids: [first.input.operation_id, replay.input.operation_id],
      first_digest: result.result_digest, dispatches: [first.dispatch.mock.calls.length, replay.dispatch.mock.calls.length] };
    await closeConnections();
  });

  it("restarts actual PostgreSQL and recovers DISPATCHED, VERIFYING and durable pending verified events", async () => {
    const cases: Awaited<ReturnType<typeof readOperationFixture>>[] = [];
    for (const stage of ["dispatched", "verifying", "pending-event"]) {
      const f = await readOperationFixture(stage === "pending-event", "READ", stores(stage));
      if (stage === "dispatched") {
        const publish = f.publisher.operationState;
        vi.spyOn(f.publisher, "operationState").mockImplementation(async input => {
          if (input.state === "VERIFYING") throw new Error("synthetic API interruption");
          return publish(input);
        });
      }
      if (stage === "pending-event") {
        const commit = f.projectionRepository.commitAppliedEvent.bind(f.projectionRepository);
        vi.spyOn(f.projectionRepository, "commitAppliedEvent").mockImplementation(async input => {
          if (input.producer === "pc-read-verifier") throw new Error("synthetic API interruption");
          return commit(input);
        });
      }
      if (stage === "verifying") await f.gateway.execute(f.envelope);
      else await expect(f.gateway.execute(f.envelope)).rejects.toThrow("synthetic API interruption");
      expect(await f.repository.getOperation(f.input.operation_id)).toMatchObject({ dispatch_state: "COMPLETED", outcome_state: "KNOWN_SUCCESS" });
      expect((await f.events.getOperation(f.input.operation_id))?.state).toBe(stage === "dispatched" ? "DISPATCHED" : "VERIFYING");
      cases.push(f);
    }
    const before = await databaseIdentity();
    const endpointBefore = await refreshEndpoint();
    const beforeRows = await sql("SELECT json_build_object('gateway_success',(SELECT count(*) FROM pc_gateway_operation WHERE payload->>'outcome_state'='KNOWN_SUCCESS'),'pending_verified',(SELECT count(*) FROM pc_event_inbox WHERE status='PENDING' AND payload->>'event_type'='pc.operation.verified'))");
    await save("before-restart.json", { identity: before, rows: JSON.parse(beforeRows), operation_ids: cases.map(f => f.input.operation_id) });
    await closeConnections();
    await assertOwnContainer();
    await docker("restart", "--time", "10", container);
    await ready();
    const endpointAfter = await refreshEndpoint();
    const after = await databaseIdentity();
    expect(after.system_identifier).toBe(before.system_identifier);
    expect(Date.parse(after.postmaster_started)).toBeGreaterThan(Date.parse(before.postmaster_started));
    const recovered = [];
    for (const f of cases) {
      const fresh = stores(`reopened-${f.input.operation_id}`);
      const events = new EventProjectionService(fresh.projection);
      const verifier = new ReadOperationVerifier(events, fresh.gateway);
      expect(await verifier.verify(f.input)).toMatchObject({ after_state: "SUCCEEDED" });
      const external = (await fresh.gateway.getOperation(f.input.operation_id))!;
      const business = (await events.getOperation(f.input.operation_id))!;
      expect(business.result_digest).toBe(external.result!.result_digest);
      const rebuilt = await events.rebuildTask(f.task.business_task_id);
      expect(rebuilt.digest_matches).toBe(true);
      expect(rebuilt.operations[0]).toMatchObject({ state: "SUCCEEDED", result_digest: business.result_digest });
      await verifier.verify(f.input);
      const verified = (await fresh.projection.listTaskEvents(f.task.business_task_id)).filter(record => record.envelope.event_type === "pc.operation.verified");
      expect(verified).toHaveLength(1);
      expect(verified[0].status).toBe("APPLIED");
      expect(f.dispatch).toHaveBeenCalledTimes(1);
      recovered.push({ operation_id: business.operation_id, state: business.state, digest: business.result_digest,
        verified_event_id: verified[0].envelope.event_id, provider_dispatches: f.dispatch.mock.calls.length });
    }
    results.actual_restart = { before, after, endpoint_before: endpointBefore, endpoint_after: endpointAfter, recovered };
    await save("after-restart.json", results.actual_restart);
    await closeConnections();
  }, 60_000);

  it("uses independent PostgreSQL pools for eight concurrent verifiers and keeps one rebuildable terminal event", async () => {
    const f = await readOperationFixture(false, "READ", stores("concurrent"));
    await f.gateway.execute(f.envelope);
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => {
      const fresh = stores(randomUUID());
      return new ReadOperationVerifier(new EventProjectionService(fresh.projection), fresh.gateway).verify(f.input);
    }));
    const failures = outcomes.filter(outcome => outcome.status === "rejected");
    await save("concurrent-outcomes.json", outcomes.map(outcome => outcome.status === "fulfilled"
      ? { status: outcome.status, result: outcome.value }
      : { status: outcome.status, code: outcome.reason?.code, message: outcome.reason?.message }));
    expect(failures).toHaveLength(0);
    const events = await f.projectionRepository.listTaskEvents(f.task.business_task_id);
    expect(events.filter(record => record.envelope.event_type === "pc.operation.verified")).toHaveLength(1);
    expect(events.every(record => record.status === "APPLIED")).toBe(true);
    const rebuilt = await f.events.rebuildTask(f.task.business_task_id);
    expect(rebuilt.digest_matches).toBe(true);
    expect(rebuilt.operations[0].state).toBe("SUCCEEDED");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    results.concurrent = { instances: outcomes.length, fulfilled: outcomes.length - failures.length,
      operation_id: f.input.operation_id, terminal: rebuilt.operations[0], provider_dispatches: f.dispatch.mock.calls.length };
    await closeConnections();
  }, 30_000);
});
