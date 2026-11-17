import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const packageRoot = path.join(root, "packages", "contracts");
const manifestPath = path.join(packageRoot, "contract-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.contracts.length !== 60) {
  throw new Error(`Expected 60 generated contracts, found ${manifest.contracts.length}`);
}

const schemas = await readdir(path.join(packageRoot, "schemas"));
const valid = await readdir(path.join(packageRoot, "fixtures", "valid"));
const invalid = await readdir(path.join(packageRoot, "fixtures", "invalid"));
if (schemas.length !== 60 || valid.length !== 60 || invalid.length !== 60) {
  throw new Error(
    `Generated counts differ: schemas=${schemas.length}, valid=${valid.length}, invalid=${invalid.length}`
  );
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "pc-contract-check-"));
try {
  execFileSync(
    process.execPath,
    [path.join(packageRoot, "scripts", "generate-contracts.mjs")],
    {
      cwd: root,
      env: { ...process.env, PC_GENERATION_CHECK: "1" },
      stdio: "pipe"
    }
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("Generated contract inventory is complete.");
