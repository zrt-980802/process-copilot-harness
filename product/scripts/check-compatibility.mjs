import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const matrix = await readFile(
  path.resolve(root, "..", "architecture", "compatibility-matrix-v1.md"),
  "utf8"
);
const requiredStatements = [
  "| DSH | `0.2.1-rc.3` | Supported |",
  "1f81c047fc48fa190a683e469daa699857e9afe8",
  "未知 major",
  "fail closed",
  "EE Claw V1 Contract",
  "BASELINE_PAGE_KEYS_V1",
  "ADR-0015",
  "ADR-0016",
  "ADR-0017",
  "ADR-0025",
  "C67", "C68", "C69",
  "T1 NOT STARTED",
  "no sliding",
  "logical_request_id"
];
const missing = requiredStatements.filter((statement) => !matrix.includes(statement));

if (missing.length > 0) {
  console.error(`Compatibility matrix is missing: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Compatibility baseline assertions passed.");
await import("./check-adr0025-t0.mjs");
