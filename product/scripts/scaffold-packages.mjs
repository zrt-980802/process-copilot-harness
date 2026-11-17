import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const packages = [
  "domain",
  "application",
  "persistence",
  "authorization",
  "resource",
  "runtime-adapter",
  "dsh-bridge",
  "event-projection",
  "observability",
  "testing"
];

const root = process.cwd();

for (const name of packages) {
  const directory = path.join(root, "packages", name);
  await mkdir(path.join(directory, "src"), { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: `@pc/${name}`,
        version: "0.1.0",
        private: true,
        type: "module",
        exports: "./src/index.ts",
        scripts: {
          typecheck: "tsc -p tsconfig.json --noEmit",
          build: "tsc -p tsconfig.json"
        }
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(directory, "tsconfig.json"),
    `${JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          rootDir: "src",
          outDir: "dist"
        },
        include: ["src/**/*.ts"]
      },
      null,
      2
    )}\n`
  );
  const symbol = name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  await writeFile(
    path.join(directory, "src", "index.ts"),
    `export const ${symbol}Package = "@pc/${name}" as const;\n`
  );
}
