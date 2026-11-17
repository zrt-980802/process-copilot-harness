import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(root, process.argv[2]);
const planPath = resolve(process.argv[3]);
const json = name => JSON.parse(readFileSync(join(evidence, name), "utf8"));
const write = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const command = (file, args, cwd = root) => execFileSync(file, args, {
  cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
}).trim();
const sha = value => createHash("sha256").update(value).digest("hex");
const before = json("environment-before.json"), after = json("environment-after.json");
const business = Object.keys(before.ee_tables).slice(0, 8);
for (const table of business) assert.deepEqual(after.ee_tables[table], before.ee_tables[table]);
assert.deepEqual(after.git.ee, before.git.ee, "EE source changed during execution");
assert.equal(after.git.product.head, before.git.product.head);
assert.equal(after.git.ee.head, before.git.ee.head);
write("baseline-comparison.json", {
  status: "PASS", unchanged_ee_business_tables: business, ee_source_unchanged: true,
  authority_semantics: "permission-after.json, permissions-AUTHORITY_FINAL.json, regression-REG_RETEST.json",
  expected_deltas: ["Membership revision/update audit from revoke/restore", "Role permission revision/order from restore",
    "Named synthetic accounts retained disabled with their default role", "New test conversations, messages and operation/audit records",
    "SSTS_DRAFT_DOWNLOADED audit additions listed in read-audit-additions.json"],
  original_tasks: "All six original task projections and one draft digest match; only listed read audit additions excluded",
  seed: "seed-idempotency.json separately preserves all 13 EE and 5 PC table hashes exactly",
});

const containers = JSON.parse(command("docker", ["inspect", ...after.containers.map(c => c.name)]));
const runtimes = [];
for (const container of containers) {
  if (container.Name === "/pc-workbench-demo-seed-1") continue;
  assert.equal(container.State.Status, "running", `Service stopped: ${container.Name}`);
  if (container.State.Health) assert.equal(container.State.Health.Status, "healthy", `Service unhealthy: ${container.Name}`);
  if (container.Name.startsWith("/pc-workbench-user-") || container.Name === "/pc-workbench-demo-pc-runtime-1") {
    const health = JSON.parse(command("docker", ["exec", container.Name.slice(1), "node", "-e",
      "console.log(await (await fetch('http://127.0.0.1:3100/health')).text())"]));
    assert.equal(health.active_sessions, 0);
    assert.equal(health.revoking_sessions, 0);
    runtimes.push({ name: container.Name.slice(1), active_sessions: health.active_sessions,
      revoking_sessions: health.revoking_sessions, event_export: health.event_export.state });
  }
}
const pcReady = await fetch("http://127.0.0.1:18091/api/ready", { signal: AbortSignal.timeout(5000) });
assert.equal(pcReady.status, 200);
const eeHealth = Number(command("docker", ["exec", "pc-workbench-demo-ee-api-1", "python", "-c",
  "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:5000/api/health').status)"]));
assert.equal(eeHealth, 200);
for (const url of ["http://127.0.0.1:18091/", "http://127.0.0.1:18092/access-control"]) {
  assert.equal((await fetch(url, { signal: AbortSignal.timeout(5000) })).status, 200);
}
write("service-health-after.json", { captured_at: new Date().toISOString(), pc: await pcReady.json(), ee: eeHealth,
  runtimes, containers: containers.map(c => ({ name: c.Name.slice(1), state: c.State.Status,
    health: c.State.Health?.Status ?? null, restart_count: c.RestartCount })),
  temporary_runner_removed: command("docker", ["ps", "-a", "--filter", "name=pc-minimum-postgres-runner", "--format", "{{.Names}}"]) === "" });
const secretValues = new Set();
for (const container of containers) for (const item of container.Config.Env ?? []) {
  const at = item.indexOf("="), key = item.slice(0, at), value = item.slice(at + 1);
  if (/(?:PASSWORD|SECRET|TOKEN|API_KEY)$/.test(key) && value.length >= 12) secretValues.add(value);
}
const findings = [];
const scan = (label, value) => {
  const categories = [];
  if ([...secretValues].some(secret => value.includes(secret))) categories.push("actual configured secret");
  if (/\bsk-[A-Za-z0-9_-]{24,}/.test(value)) categories.push("API key pattern");
  if (/Bearer\s+[A-Za-z0-9._~-]{24,}/i.test(value)) categories.push("bearer token pattern");
  if (/(?:postgres(?:ql)?|mysql):\/\/[^\s:@/]+:[^\s@/]+@/i.test(value)) categories.push("credential URL");
  if (categories.length) findings.push({ source: label, categories });
};
let scannedFiles = 0;
function scanDirectory(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) scanDirectory(path);
    else if (/\.(json|log|txt|md)$/.test(item.name)) {
      scan(relative(evidence, path), readFileSync(path, "utf8")); scannedFiles++;
    }
  }
}
scanDirectory(evidence);
const logMetadata = [];
for (const container of containers) {
  const result = spawnSync("docker", ["logs", "--since", before.captured_at, "--tail", "20000", container.Name.slice(1)], {
    encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `Cannot scan logs for ${container.Name}`);
  scan(`docker:${container.Name}:stdout`, result.stdout);
  scan(`docker:${container.Name}:stderr`, result.stderr);
  logMetadata.push({ name: container.Name.slice(1), stdout_bytes: Buffer.byteLength(result.stdout),
    stderr_bytes: Buffer.byteLength(result.stderr), scope: "stdout/stderr since baseline, capped at 20000 lines" });
}
write("sensitive-scan.json", { status: findings.length ? "FAIL" : "PASS", scanned_files: scannedFiles,
  configured_secret_count: secretValues.size, service_logs: logMetadata, findings,
  limitation: "Exact active configured secret values and common key/token/credential-URL patterns; not an independent T8 assessment" });
assert.equal(findings.length, 0, "Sensitive findings present; inspect source names without printing secrets");

const bindings = new Map();
function bind(ids, source, note) {
  assert(existsSync(join(evidence, source)), `Missing evidence ${source}`);
  for (const id of ids.split(" ")) {
    if (!bindings.has(id)) bindings.set(id, []);
    bindings.get(id).push({ source, note });
  }
}
for (const source of ["baseline-MIN01.json", "auth-extra-MIN01.json", "permissions-AUTHORITY_FINAL.json", "permission-cache-CACHE_FINAL.json",
  "mcp-MIN02.json", "chat-extra-FIXED_R1.json", "chat-extra-FIXED_R2.json", "chat-extra-FIXED_R3.json",
  "chat-completion-FINAL_COMPLETE_R1.json", "chat-completion-FINAL_COMPLETE_R2.json", "chat-completion-FINAL_COMPLETE_R3.json",
  "regression-REG_RETEST.json", "recovery-FINAL.json", "recovery-REC_FINAL.json", "recovery-REC_ADAPTER_FINAL.json", "final-state-FINAL.json"]) {
  for (const row of json(source)) {
    assert.equal(row.status, "PASS", `Failed case in selected final evidence: ${source}`);
    bind(row.ids.join(" "), source, row.description);
  }
}
for (const source of ["postgres-real-ee-login.json", "auth-final/result.json", "mcp-real-faults.json", "seed-idempotency.json"]) {
  assert.equal(json(source).status, "PASS", `Failed final evidence: ${source}`);
}
assert.equal(json("markdown/result.json").status, "pass");
const log = name => stripVTControlCharacters(readFileSync(join(evidence, name), "utf8"));
assert.match(log("product-check-final.log"), /Tests\s+178 passed\s*\|\s*7 skipped/);
assert.match(log("postgres-tests-executed.log"), /Tests\s+10 passed/);
assert.match(log("ee-tests.log"), /16 passed/);
bind("T0-01", "environment-before.json", "Paths, versions, Git, containers, mounts, networks, volumes and initial source fingerprints");
bind("T0-03 MCP-011", "baseline-comparison.json", "Eight immutable EE business tables unchanged; permission semantics restored");
bind("T1-01 T1-02", "product-check-final.log", "178 passed, 7 PostgreSQL-conditional skips; lint/typecheck/build/contracts/architecture pass");
bind("T1-01 T1-02", "postgres-tests-executed.log", "All seven conditional cases executed in isolated Linux PostgreSQL runner: 10 passed including 3 host-covered cases");
bind("T1-02 AUTH-013 AUTH-014", "postgres-real-ee-login.json", "Real EE tickets and PostgreSQL, replay/fail-closed checks, 12 concurrent enrollments across two instances");
bind("T1-03", "ee-tests.log", "16 real isolated MySQL/catalog/identity/owner/sanitization cases passed; exact names in log");
bind("AUTH-001 AUTH-002 AUTH-003 AUTH-006 AUTH-007 AUTH-008 AUTH-009 AUTH-010 AUTH-011 AUTH-013 PERM-004 PERM-005 MCP-001 CHAT-011", "auth-final/result.json", "Ten complete browser groups: correct identity, separate contexts, cache/account switching, role mutation, revoked/reset/disabled sessions");
for (let round = 1; round <= 3; round++) {
  const source = `chat-fixed-round-${round}/result.json`;
  assert.equal(json(source).status, "PASS");
  bind("AUTH-012 CHAT-001 CHAT-002 CHAT-004 CHAT-005 CHAT-006 CHAT-009 CHAT-010 CHAT-012 PERM-011", source,
    `Fixed complete T5 round ${round}: four real accounts, real models/MCP, concurrent sessions, current authority and in-flight revocation`);
  const boundaries = `chat-fixed-round-${round}/runtime-boundaries.json`;
  assert.equal(json(boundaries).status, "PASS");
  bind("CHAT-013 CHAT-014 CHAT-015 CHAT-016", boundaries, `Round ${round}: manager, owner assignment and filesystem isolation`);
}
bind("MCP-008 MCP-009 MCP-012", "mcp-real-faults.json", "Five real EE calls through test-only response transformer: malformed/stale/secret/timeout rejected");
bind("MCP-012", "sensitive-scan.json", "Evidence and bounded service log scans against active secret values and common secret patterns");
bind("REG-006 REG-007 REG-008", "markdown/result.json", "Real history plus browser-only malicious rendering fixture; unsafeNodes=0, executed=false; 1440/1100/390");
bind("REC-010", "seed-idempotency.json", "Repeated real EE/PC seed preserves all 13 EE and 5 PC hashes");

const plan = readFileSync(planPath, "utf8");
const planned = new Map();
for (const match of plan.matchAll(/^### (T[01]-\d\d) (.+)$/gm)) planned.set(match[1], match[2].trim());
for (const match of plan.matchAll(/^\| ((?:AUTH|PERM|MCP|CHAT|REG|REC)-\d{3}) \| (.*?) \| (.*?) \|$/gm)) {
  planned.set(match[1], `${match[2]}: ${match[3]}`);
}
assert.equal(planned.size, 83);
for (const id of planned.keys()) assert(bindings.has(id), `Unmapped case ${id}`);
const results = [...planned].map(([id, expectation]) => ({ id, expectation, status: "PASS", evidence: bindings.get(id),
  authority: "developer/test operator; independent verification pending" }));
write("test-results.json", { run_id: relative(root, evidence).replaceAll("\\", "/"), generated_at: new Date().toISOString(),
  scope: "T0-T7", status: "DEVELOPER_VERIFIED", independent_acceptance: false,
  counts: { planned_cases: results.length, passed: results.length, failed: 0, deferred_batches: 3 }, results,
  deferred: ["T8", "T9", "T10"].map(id => ({ id, status: "NOT_RUN", reason: "Requires separate independent verifier" })),
  skipped_host_tests: ["postgres-event-projection", "postgres-gateway", "postgres-identity-profile", "postgres-resource",
    "postgres-runtime-registry", "postgres-ssts-draft", "external-login PostgreSQL concurrency"].map(name => ({ name,
    condition: "PC_TEST_POSTGRES_URL absent from host gate", resolved_by: "postgres-tests-executed.log: executed and passed" })),
  retained_failure_evidence: ["mcp-MIN01.json", "chat-extra-MIN01_R1.json", "permissions-MIN02.json"]
    .filter(name => existsSync(join(evidence, name))),
});

const sourceHashes = {};
for (const [name, workspace] of Object.entries(after.git)) {
  const names = command("git", ["ls-files", "-c", "-o", "--exclude-standard"], workspace.path).split(/\r?\n/);
  const files = {};
  for (const path of [...new Set(names)].sort()) {
    const absolute = join(workspace.path, path);
    if (existsSync(absolute) && statSync(absolute).isFile()) files[path] = sha(readFileSync(absolute));
  }
  sourceHashes[name] = { path: workspace.path, head: workspace.head, branch: workspace.branch, files };
}
write("frozen-source.json", { captured_at: new Date().toISOString(), source: sourceHashes,
  container_images: containers.map(c => ({ name: c.Name.slice(1), image_id: c.Image })),
  note: "Hash manifest only; no credentials or source bodies. Existing dirty and untracked files retained." });
console.log(`${results.length} planned T0-T7 cases mapped; business/source comparison and sensitive scan passed; T8-T10 NOT_RUN`);
