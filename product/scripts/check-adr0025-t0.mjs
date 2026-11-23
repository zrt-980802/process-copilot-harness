import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");
// T0 is now a compatibility baseline for later phases. Protect its frozen
// contracts and semantic evidence without permanently freezing all runtime code.
const baseline = "e594699d67f3f3e24c06fb688a2322ae70730dda";
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const baselineManifest = JSON.parse(git("show", `${baseline}:product/packages/contracts/contract-manifest.json`));
const legacyFiles = baselineManifest.contracts.flatMap((contract) => [contract.schema, contract.valid_fixture, contract.invalid_fixture])
  .map((file) => `product/packages/contracts/${file}`);
const protectedT0Files = [
  ...legacyFiles,
  "architecture/ADR-0025-thin-session-authorization-legacy-provider-compatibility.md",
  "architecture/adr-0025-t0-contract-and-compatibility-v1.md",
  "governance/ADR-0025-T0-CONTRACT-AND-COMPATIBILITY-FIXTURE-TASK.md",
  "product/docs/adr-0025-t0-verification.md",
  "product/packages/contracts/contract-manifest.json",
  "product/packages/contracts/fixtures/adr0025-golden-matrix.json",
  "product/packages/contracts/scripts/check-generated.mjs",
  "product/packages/contracts/scripts/generate-contracts.mjs",
  "product/packages/contracts/scripts/session-authority-contract-definitions.mjs",
  "product/packages/contracts/src/generated/contracts.ts",
  "product/packages/contracts/tests/adr0025-t0.test.ts",
  "product/packages/contracts/tests/contracts.test.ts",
  "product/packages/contracts/tests/support/adr0025-oracle.ts"
];
const fingerprints = [];
const rawFingerprints = [];
const normalize = (bytes) => bytes.toString("utf8").replaceAll("\r\n", "\n");
for (const file of [...new Set(protectedT0Files)]) {
  const oldBytes = git("show", `${baseline}:${file}`);
  const currentBytes = await readFile(path.join(root, file));
  const old = sha(normalize(oldBytes));
  const current = sha(normalize(currentBytes));
  if (old !== current) throw new Error(`T0 compatibility baseline drift: ${file}`);
  fingerprints.push([file, current]);
  rawFingerprints.push([file, sha(currentBytes)]);
}
const changed = git("diff", "--name-only", baseline).toString("utf8").trim().split("\n").filter(Boolean);
const untracked = git("ls-files", "--others", "--exclude-standard").toString("utf8").trim().split("\n").filter(Boolean);
const changedFiles = [...new Set([...changed, ...untracked])];
for (const file of changedFiles) {
  const content = await readFile(path.join(root, file), "utf8");
  if (/(?:\bsk-[a-zA-Z0-9_-]{20,}|\bghp_[a-zA-Z0-9]{30,}|\bgithub_pat_[a-zA-Z0-9_]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|https?:\/\/[^\s/:]+:[^\s/@]+@)/.test(content)) {
    throw new Error(`T0 sensitive information scan failed: ${file}`);
  }
  if (file.endsWith(".json")) JSON.parse(content);
}
for (const file of ["product/packages/contracts/tests/adr0025-t0.test.ts",
  "product/packages/contracts/tests/support/adr0025-oracle.ts"]) {
  const content = await readFile(path.join(root, file), "utf8");
  for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (!match[1].startsWith("node:") && !["ajv/dist/2020.js", "ajv-formats", "vitest"].includes(match[1])
      && !["../src/generated/contracts.js", "../../src/generated/contracts.js", "./support/adr0025-oracle.js"].includes(match[1])) {
      throw new Error(`T0 test imports runtime: ${file}: ${match[1]}`);
    }
  }
}
const generated = JSON.parse(await readFile(path.join(root, "product/packages/contracts/contract-manifest.json"), "utf8"));
if (generated.contracts.length !== 69) throw new Error("T0 requires exactly 69 contracts");
let parsedJson = 1;
for (const contract of generated.contracts) {
  for (const file of [contract.schema, contract.valid_fixture, contract.invalid_fixture]) {
    JSON.parse(await readFile(path.join(root, "product/packages/contracts", file), "utf8"));
    parsedJson++;
  }
}
JSON.parse(await readFile(path.join(root, "product/packages/contracts/fixtures/adr0025-golden-matrix.json"), "utf8"));
parsedJson++;
console.log(JSON.stringify({ audit: "ADR-0025 T0 compatibility baseline", baseline,
  protected_t0_files: new Set(protectedT0Files).size, unchanged_contract_artifacts: legacyFiles.length,
  baseline_sha256: sha(JSON.stringify(fingerprints)), current_sha256: sha(JSON.stringify(fingerprints)),
  raw_worktree_sha256: sha(JSON.stringify(rawFingerprints)), comparison: "UTF-8 LF-normalized; raw checkout digest also recorded",
  runtime_imports: 0, t0_compatibility_drift: 0, contracts: generated.contracts.length,
  parsed_contract_json: parsedJson, sensitive_scan_files: changedFiles.length, sensitive_findings: 0 }, null, 2));
