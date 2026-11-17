import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const names = ["postgres-event-projection", "postgres-gateway", "postgres-identity-profile", "postgres-resource",
  "postgres-runtime-registry", "postgres-ssts-draft", "external-login"];
for (const name of names) await build({
  entryPoints: [`packages/persistence/tests/${name}.test.ts`], outfile: `${output}/${name}.test.mjs`,
  bundle: true, platform: "node", target: "node22", format: "esm", external: ["vitest"],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
for (const name of ["verify-unified-login-postgres", "verify-minimum-mcp-faults"]) await build({
  entryPoints: [`deploy/${name}.mts`], outfile: `${output}/${name}.mjs`,
  bundle: true, platform: "node", target: "node22", format: "esm",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
