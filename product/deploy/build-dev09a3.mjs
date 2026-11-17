import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir(".docker/dev09a3/dist", { recursive: true });
for (const [entry, outfile] of [
  ["apps/api/src/main.ts", "main.mjs"],
  ["deploy/verify-dev09a3-local.mts", "verify.mjs"]
]) {
  await build({ entryPoints: [entry], outfile: `.docker/dev09a3/dist/${outfile}`,
    bundle: true, platform: "node", target: "node22", format: "esm",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }
  });
}
await writeFile(".docker/dev09a3/dist/package.json", JSON.stringify({ type: "module" }));
