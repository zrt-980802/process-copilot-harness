import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityAuthorizationService } from "@pc/application";
import { PostgresIdentityAuthorizationRepository } from "@pc/persistence";
import { evidenceDigest, sealSessionAssurance } from "@pc/domain";

const enabled = process.env.PC_AUTH_MVP_POSTGRES_TEST === "1";
const execute = promisify(execFile);
const run = `pc-auth-mvp-${randomUUID()}`;
const volume = `${run}-data`, network = `${run}-network`, label = "pc.authorization.mvp.run";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = join(root, "reports", "pc-authorization-mvp-01", run);
const password = randomBytes(32).toString("hex");
const signing = randomBytes(32).toString("hex");
const services: IdentityAuthorizationService[] = [];
const pools: Pool[] = [];
const processes = new Set<ChildProcess>();
const logs = new Map<ChildProcess, { stdout: string; stderr: string }>();
let baseline: string[] = [], databaseUrl = "", created = false;
const results: Record<string, unknown> = {};

async function docker(...args: string[]) {
  try { return (await execute("docker", args, { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim(); }
  catch { throw new Error(`Task-owned Docker action failed: ${args[0]}`); }
}
async function save(name: string, value: unknown) {
  await writeFile(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
async function own() {
  expect(await docker("inspect", "--format", `{{index .Config.Labels "${label}"}}`, run)).toBe(run);
  expect(await docker("inspect", "--format", "{{range .Mounts}}{{.Name}}{{end}}", run)).toBe(volume);
}
async function existing() {
  const ids = (await docker("ps", "-aq")).split(/\s+/u).filter(Boolean);
  return ids.length ? (await docker("inspect", "--format", "{{.Id}}|{{.Name}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}", ...ids))
    .split("\n").filter(line => !line.includes(`|/${run}|`)).sort() : [];
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      await own();
      if (!(await docker("exec", run, "pg_isready", "-h", "127.0.0.1", "-U", "mvp", "-d", "mvp")).includes("accepting connections")) throw new Error("Starting");
      const endpoint = JSON.parse(await docker("inspect", "--format", '{{json (index .NetworkSettings.Ports "5432/tcp")}}', run));
      expect(endpoint).toHaveLength(1); expect(endpoint[0].HostIp).toBe("127.0.0.1");
      const url = new URL("postgresql://127.0.0.1/mvp"); url.username = "mvp"; url.password = password; url.port = endpoint[0].HostPort;
      const probe = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 1000 });
      try { await probe.query("SELECT 1"); } finally { await probe.end(); }
      databaseUrl = url.toString(); return Number(endpoint[0].HostPort);
    } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw new Error("Isolated authorization PostgreSQL not ready");
}
function service() {
  const instance = new IdentityAuthorizationService(new PostgresIdentityAuthorizationRepository(databaseUrl), signing);
  services.push(instance); return instance;
}
function pool() { const p = new Pool({ connectionString: databaseUrl }); pools.push(p); return p; }
async function closeConnections() {
  await Promise.all(services.splice(0).map(service => service.close()));
  await Promise.all(pools.splice(0).map(pool => pool.end()));
}
async function databaseIdentity() {
  return JSON.parse(await docker("exec", run, "psql", "-U", "mvp", "-d", "mvp", "-At", "-c",
    "SELECT json_build_object('system_identifier',(SELECT system_identifier::text FROM pg_control_system()),'postmaster_started',pg_postmaster_start_time())"));
}
async function startApi() {
  const child = spawn(process.execPath, [join(evidence, "api", "session-api.mjs")], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: databaseUrl, PC_ENVELOPE_SIGNING_KEY: signing } });
  processes.add(child);
  const log = { stdout: "", stderr: "" }; logs.set(child, log);
  child.stdout!.on("data", data => { log.stdout += data.toString(); });
  child.stderr!.on("data", data => { log.stderr += data.toString(); });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const line = log.stdout.split("\n").find(line => line.includes('"authorization_mvp_api_port"'));
    if (line) return { child, port: JSON.parse(line).authorization_mvp_api_port as number };
    if (child.exitCode !== null) throw new Error("Isolated API startup failed");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Isolated API startup timeout; sanitized logs retained at teardown");
}
async function stopApi(child: ChildProcess) {
  if (child.exitCode === null) {
    const ended = new Promise<void>(resolve => child.once("exit", () => resolve()));
    child.kill(); await ended;
  }
  processes.delete(child);
  const log = logs.get(child);
  if (log) {
    const safe = `${log.stdout}\n${log.stderr}`.replaceAll(password, "[REDACTED]").replaceAll(signing, "[REDACTED]")
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gu, "[DATABASE_URL]");
    await writeFile(join(evidence, `api-${child.pid}.log`), safe, { flag: "wx" }); logs.delete(child);
  }
}

describe.skipIf(!enabled).sequential("Authorization MVP task-owned real PostgreSQL and API process restarts", () => {
  beforeAll(async () => {
    await mkdir(join(evidence, "api"), { recursive: true });
    baseline = await existing(); await save("existing-containers-before.json", baseline);
    const image = await docker("image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}");
    await docker("volume", "create", "--label", `${label}=${run}`, volume);
    await docker("network", "create", "--label", `${label}=${run}`, network);
    await docker("run", "-d", "--pull=never", "--name", run, "--label", `${label}=${run}`, "--network", network,
      "--mount", `type=volume,source=${volume},target=/var/lib/postgresql/data`, "--publish", "127.0.0.1::5432", "--memory", "512m", "--cpus", "1",
      "--env", "POSTGRES_USER=mvp", "--env", "POSTGRES_DB=mvp", "--env", `POSTGRES_PASSWORD=${password}`, image);
    created = true;
    const port = await ready(); await save("environment.json", { run, volume, network, image, host: "127.0.0.1", port, database: "mvp", credentials: "generated, omitted" });
    await build({ entryPoints: [join(root, "integration/authorization-mvp/session-api.mts")], outfile: join(evidence, "api", "session-api.mjs"),
      bundle: true, platform: "node", target: "node22", format: "esm", banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
    await mkdir(join(evidence, "migrations", "identity"), { recursive: true });
    await copyFile(join(root, "packages/persistence/migrations/identity/0001_session_assurance.sql"), join(evidence, "migrations", "identity", "0001_session_assurance.sql"));
  }, 60_000);

  afterAll(async () => {
    for (const child of processes) await stopApi(child);
    await closeConnections();
    if (created) { await own(); await docker("stop", "--time", "10", run); }
    await save("results.json", results);
    await save("resources-final.json", { run, volume, network, state: created ? await docker("inspect", "--format", "{{.State.Status}}", run) : "not-created", deletion: "NONE" });
    const after = await existing(); await save("existing-containers-after.json", after); expect(after).toEqual(baseline);
  }, 40_000);

  it("applies and rechecks the exact additive schema, rejecting an unrecognized partial schema", async () => {
    const identity = service(); await identity.initialize(); await identity.initialize();
    const p = pool();
    const columns = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='pc_session_assurance' ORDER BY ordinal_position");
    expect(columns.rows).toHaveLength(23);
    const markers = await p.query("SELECT migration_name,migration_digest FROM pc_schema_migration WHERE component='session-assurance' ORDER BY version");
    expect(markers.rows).toHaveLength(2);
    await p.query("CREATE DATABASE mvp_incompatible");
    const malformedUrl = new URL(databaseUrl); malformedUrl.pathname = "/mvp_incompatible";
    const malformed = new Pool({ connectionString: malformedUrl.toString() });
    try {
      await malformed.query("CREATE TABLE pc_session_assurance (unrecognized TEXT)");
      const repository = new PostgresIdentityAuthorizationRepository(malformed);
      await expect(repository.initialize()).rejects.toMatchObject({ code: "PC_SESSION_SCHEMA_DENIED" });
      expect((await malformed.query("SELECT column_name FROM information_schema.columns WHERE table_name='pc_session_assurance'")).rows).toEqual([{ column_name: "unrecognized" }]);
    } finally { await malformed.end(); }
    results.schema = { columns: columns.rows.map(row => row.column_name), migrations: markers.rows, partial_schema: "DENIED, retained" };
  });

  it("restarts a real API process with the same C67 and audit store", async () => {
    const identity = service(); await identity.initialize();
    await identity.provisionPilotAccount({ tenant_id: "mvp", account_key: "api-restart", secret: "SyntheticMvpSecret123" });
    const login = await identity.signInPilot("mvp", "api-restart", "SyntheticMvpSecret123");
    const provider = await identity.signInExternal({ identity_provider_ref: "eeclaw", issuer: "synthetic-issuer",
      external_subject: "api-provider", tenant_or_org_ref: "mvp" }, randomUUID(), new Date(Date.now() + 900_000).toISOString());
    const first = await startApi();
    const response = await fetch(`http://127.0.0.1:${first.port}/v1/identity/me`, { headers: { authorization: `Bearer ${login.access_token}` } });
    expect(response.status).toBe(200);
    const before = await response.json();
    const sourceBefore = await fetch(`http://127.0.0.1:${first.port}/v1/identity/me`, { headers: { authorization: `Bearer ${provider.access_token}` } });
    expect(sourceBefore.status).toBe(200); const providerBefore = await sourceBefore.json();
    await stopApi(first.child);
    const second = await startApi();
    const restored = await fetch(`http://127.0.0.1:${second.port}/v1/identity/me`, { headers: { authorization: `Bearer ${login.access_token}` } });
    expect(restored.status).toBe(200); const after = await restored.json();
    expect(after.session_assurance).toEqual(before.session_assurance);
    expect(after.session_assurance.assurance_digest).toBe(evidenceDigest(after.session_assurance, "assurance_digest"));
    const sourceAfter = await fetch(`http://127.0.0.1:${second.port}/v1/identity/me`, { headers: { authorization: `Bearer ${provider.access_token}` } });
    expect(sourceAfter.status).toBe(200); const providerAfter = await sourceAfter.json();
    expect(providerAfter.session_assurance).toEqual(providerBefore.session_assurance);
    expect(providerAfter.session_assurance.absolute_expires_at).toBe(provider.expires_at);
    const audit = await fetch(`http://127.0.0.1:${second.port}/v1/authorization/decisions`, { headers: { authorization: `Bearer ${login.access_token}` } });
    expect((await audit.json()).items.length).toBeGreaterThanOrEqual(2);
    await stopApi(second.child);
    results.api_restart = { first_pid: first.child.pid, second_pid: second.child.pid, distinct_processes: first.child.pid !== second.child.pid,
      pc_session_id: before.session_assurance.pc_session_id, assurance_digest: before.session_assurance.assurance_digest, expiry: before.expires_at,
      provider_session: { pc_session_id: providerAfter.session_assurance.pc_session_id, assurance_digest: providerAfter.session_assurance.assurance_digest,
        fixed_expiry: providerAfter.session_assurance.absolute_expires_at, source: "synthetic issuance evidence; no Provider call" }, audit_restored: true };
  }, 40_000);

  it("survives actual PostgreSQL restart with valid, revoked, stale revision, disabled and legacy Sessions", async () => {
    const identity = service(); await identity.initialize(); const p = pool();
    const tokens: Array<{ name: string; token: string; expected: boolean }> = [];
    for (const name of ["valid", "revoked", "revision", "identity", "disabled"]) {
      await identity.provisionPilotAccount({ tenant_id: "mvp", account_key: name, secret: "SyntheticMvpSecret123" });
      const login = await identity.signInPilot("mvp", name, "SyntheticMvpSecret123");
      tokens.push({ name, token: login.access_token, expected: name === "valid" });
      if (name === "revoked") await identity.signOut(login.access_token);
      if (name === "revision") await identity.replaceAuthorizationGrants({ principal_id: login.principal.principal_id, expected_authorization_revision: 1,
        grants: [{ action: "task.read", scope_type: "global", scope_id: "*", effect: "allow", evidence_ref: "pc:revision" }] });
      if (name === "identity") await identity.linkVerifiedIdentity({ principal_id: login.principal.principal_id, expected_identity_revision: 1,
        identity_provider_ref: "test", issuer: "synthetic", external_subject: "identity", tenant_or_org_ref: "mvp", verification_level: "admin_reauthentication" });
      if (name === "disabled") await p.query("UPDATE pc_pilot_account SET status='disabled' WHERE principal_id=$1", [login.principal.principal_id]);
    }
    const valid = await identity.authenticate(tokens[0]!.token);
    for (const name of ["provider-valid", "provider-link-revision"]) {
      const login = await identity.signInExternal({ identity_provider_ref: "eeclaw", issuer: "synthetic-issuer",
        external_subject: name, tenant_or_org_ref: "mvp" }, randomUUID(), new Date(Date.now() + 900_000).toISOString());
      tokens.push({ name, token: login.access_token, expected: name === "provider-valid" });
      if (name === "provider-link-revision") await p.query("UPDATE pc_external_identity_link SET identity_link_revision=identity_link_revision+1 WHERE identity_link_id=$1", [login.session_assurance!.identity_link_id]);
    }
    const providerBefore = await identity.authenticate(tokens.find(item => item.name === "provider-valid")!.token);
    const legacyToken = randomBytes(32).toString("hex");
    const repository = new PostgresIdentityAuthorizationRepository(p);
    await repository.createPilotSession({ authentication_context_id: randomUUID(), principal_id: valid.principal.principal_id,
      token_digest: createHash("sha256").update(legacyToken).digest("hex"), issued_at: new Date().toISOString(), expires_at: valid.session.expires_at });
    tokens.push({ name: "legacy", token: legacyToken, expected: false });
    const before = await databaseIdentity(); await closeConnections(); await own();
    await docker("restart", "--time", "10", run); const port = await ready(); const after = await databaseIdentity();
    expect(after.system_identifier).toBe(before.system_identifier); expect(Date.parse(after.postmaster_started)).toBeGreaterThan(Date.parse(before.postmaster_started));
    const restarted = service(); await restarted.initialize(); const outcomes = [];
    for (const item of tokens) {
      const accepted = await restarted.authenticate(item.token).then(() => true, () => false);
      expect(accepted, item.name).toBe(item.expected); outcomes.push({ scenario: item.name, accepted });
    }
    expect((await restarted.authenticate(tokens[0]!.token)).assurance).toEqual(valid.assurance);
    expect((await restarted.authenticate(tokens.find(item => item.name === "provider-valid")!.token)).assurance).toEqual(providerBefore.assurance);
    results.postgres_restart = { before, after, port, outcomes, original_digest: valid.assurance.assurance_digest, original_expiry: valid.assurance.absolute_expires_at,
      provider_original_digest: providerBefore.assurance.assurance_digest, provider_original_expiry: providerBefore.assurance.absolute_expires_at };
  }, 40_000);

  it("rolls back invalid issuance and preserves concurrent revocation without losing the fixed bound", async () => {
    const identity = service(); await identity.initialize();
    const login = await identity.signInPilot("mvp", "valid", "SyntheticMvpSecret123");
    const p = pool(), repository = new PostgresIdentityAuthorizationRepository(p);
    const current = await identity.authenticate(login.access_token);
    const record = (await repository.getSessionAssurance(login.authentication_context_id))!;
    const invalid = { ...current.session, token_digest: createHash("sha256").update(randomBytes(32)).digest("hex"), authentication_context_id: randomUUID() };
    const bad = { ...record, authentication_context_id: invalid.authentication_context_id,
      assurance: sealSessionAssurance({ ...record.assurance, pc_session_id: `pc-session:${randomUUID()}`, session_assurance_id: `assurance:${randomUUID()}`, authorization_revision: 999 }) };
    await expect(repository.createPilotSession(invalid, bad)).rejects.toMatchObject({ code: "PC_SESSION_ASSURANCE_DENIED" });
    expect((await p.query("SELECT 1 FROM pc_pilot_session WHERE authentication_context_id=$1", [invalid.authentication_context_id])).rowCount).toBe(0);
    await Promise.all(Array.from({ length: 8 }, () => identity.signOut(login.access_token)));
    const revoked = (await repository.getSessionAssurance(login.authentication_context_id))!;
    expect(revoked.record_version).toBe(2); expect(revoked.assurance.absolute_expires_at).toBe(login.expires_at);
    expect(revoked.assurance.session_state).toBe("REVOKED");
    results.atomicity = { invalid_issuance_rows: 0, concurrent_revokes: 8, final_version: revoked.record_version, fixed_expiry: revoked.assurance.absolute_expires_at };
    await save("migration-source-digest.json", { sha256: createHash("sha256").update(await readFile(join(root, "packages/persistence/migrations/identity/0001_session_assurance.sql"))).digest("hex") });
  });
});
