import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir(".docker/workbench-demo", { recursive: true });
for (const [entry, name] of [["apps/api/src/main.ts", "main"],
  ["apps/runtime-host/src/main.ts", "runtime"], ["deploy/seed-workbench-demo.mts", "seed"]]) {
  await build({ entryPoints: [entry], outfile: `.docker/workbench-demo/${name}.mjs`, bundle: true,
    platform: "node", target: "node22", format: "esm",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
}
