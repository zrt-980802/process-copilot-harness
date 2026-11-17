import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const architectureRoot = path.resolve(root, "..", "architecture");
const baseManifest = JSON.parse(
  await readFile(path.join(architectureRoot, "traceability-manifest-v1.json"), "utf8")
);
const memoryManifest = JSON.parse(
  await readFile(path.join(architectureRoot, "memory-traceability-manifest-v1.json"), "utf8")
);
const entries = [...baseManifest.entries, ...memoryManifest.entries];
const schemaFiles = await readdir(path.join(root, "packages", "contracts", "schemas"));
const schemaIds = new Set(schemaFiles.map((file) => file.slice(0, 3)));
const expectedAdrs = Array.from({ length: 23 }, (_, index) =>
  `ADR-${String(index + 1).padStart(4, "0")}`
);
const requirementIds = new Set(
  entries.map((entry) => entry.requirement_id)
);
const errors = [];

for (const adr of expectedAdrs) {
  if (!requirementIds.has(adr)) errors.push(`Traceability is missing ${adr}`);
  const matches = await readdir(architectureRoot);
  if (!matches.some((file) => file.startsWith(`${adr}-`))) {
    errors.push(`ADR document is missing for ${adr}`);
  }
}

for (const entry of entries) {
  for (const contractId of entry.contracts ?? entry.contract_ids ?? []) {
    if (!schemaIds.has(contractId)) {
      errors.push(`${entry.requirement_id} references missing ${contractId}`);
    }
  }
  for (const evidence of entry.evidence ?? entry.evidence_refs ?? []) {
    if (typeof evidence === "string" && evidence.startsWith("architecture/")) {
      try {
        await access(path.resolve(root, "..", evidence));
      } catch {
        errors.push(`${entry.requirement_id} references missing evidence ${evidence}`);
      }
    }
  }
}

for (const contractId of Array.from({ length: 60 }, (_, index) =>
  `C${String(index + 1).padStart(2, "0")}`
)) {
  if (!schemaIds.has(contractId)) errors.push(`Generated schema is missing ${contractId}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Traceability passed for ${expectedAdrs.length} ADRs and ${schemaIds.size} contracts.`);
