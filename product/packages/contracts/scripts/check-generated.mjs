import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageRoot = path.join(root, "packages", "contracts");
const manifestPath = path.join(packageRoot, "contract-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.contracts.length !== 69) {
  throw new Error(`Expected 69 generated contracts, found ${manifest.contracts.length}`);
}

const schemas = await readdir(path.join(packageRoot, "schemas"));
const valid = await readdir(path.join(packageRoot, "fixtures", "valid"));
const invalid = await readdir(path.join(packageRoot, "fixtures", "invalid"));
if (schemas.length !== 69 || valid.length !== 69 || invalid.length !== 69) {
  throw new Error(
    `Generated counts differ: schemas=${schemas.length}, valid=${valid.length}, invalid=${invalid.length}`
  );
}

const generatedFiles = ["contract-manifest.json", "src/generated/contracts.ts",
  ...schemas.map((file) => `schemas/${file}`),
  ...valid.map((file) => `fixtures/valid/${file}`),
  ...invalid.map((file) => `fixtures/invalid/${file}`)];
const before = await Promise.all(generatedFiles.map((file) => readFile(path.join(packageRoot, file))));
  execFileSync(
    process.execPath,
    [path.join(packageRoot, "scripts", "generate-contracts.mjs")],
    {
      cwd: root,
      env: { ...process.env, PC_GENERATION_CHECK: "1" },
      stdio: "pipe"
    }
  );
for (const [index, file] of generatedFiles.entries()) {
  if (!before[index].equals(await readFile(path.join(packageRoot, file)))) {
    throw new Error(`Generated output drift: ${file}`);
  }
}

console.log("Generated contract inventory is complete.");
