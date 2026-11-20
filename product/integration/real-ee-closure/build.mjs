import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir(".docker/real-ee-closure", { recursive: true });
for (const [entry, name] of [["apps/api/src/main.ts", "main"], ["apps/runtime-host/src/main.ts", "runtime"], ["integration/real-ee-closure/pc-fixture.mts", "pc-fixture"]]) {
  await build({ entryPoints: [entry], outfile: `.docker/real-ee-closure/${name}.mjs`, bundle: true, platform: "node",
    target: "node22", format: "esm", banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
}
