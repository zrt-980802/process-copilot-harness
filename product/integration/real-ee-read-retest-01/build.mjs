import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir(".docker/real-ee-read-retest-01", { recursive: true });
for (const [entry, name] of [["apps/api/src/main.ts", "main"], ["apps/runtime-host/src/main.ts", "runtime"], ["integration/real-ee-read-retest-01/pc-fixture.mts", "pc-fixture"]]) {
  await build({ entryPoints: [entry], outfile: `.docker/real-ee-read-retest-01/${name}.mjs`, bundle: true, platform: "node",
    target: "node22", format: "esm", banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
}
