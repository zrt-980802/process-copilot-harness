import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceRoots = ["apps", "packages"];
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (/\.(?:ts|tsx|vue|mjs)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

for (const sourceRoot of sourceRoots) {
  const files = await walk(path.join(root, sourceRoot));
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const rules = [
      {
        when: relative.startsWith("apps/web/"),
        pattern: /@pc\/(?:memory|persistence|dsh-bridge|runtime-adapter)/,
        message: "Web must not import Memory authority, persistence or runtime integration packages"
      },
      {
        when:
          relative.startsWith("apps/api/") ||
          /packages\/(?:domain|application|authorization|memory|persistence|resource)\//.test(relative),
        pattern: /(?:deep-search-hands|deepsearchhands|@dsh\/|reference-repos\/dsh)/i,
        message: "Control Plane must not import DSH internals"
      },
      {
        when: relative.startsWith("packages/dsh-bridge/"),
        pattern: /@pc\/(?:memory|persistence)|(?:pg|postgres|prisma|drizzle)/,
        message: "DSH Bridge must not access the control-plane database"
      },
      {
        when: relative.startsWith("packages/memory/"),
        pattern: /@pc\/(?:persistence|dsh-bridge|runtime-adapter)|(?:pg|postgres|prisma|drizzle)/,
        message: "Memory Domain must depend on stable Ports, not persistence or Runtime internals"
      },
      {
        when: relative.startsWith("apps/web/"),
        pattern: /@pc\/dsh-bridge|runtime-host/,
        message: "UI must not call Runtime or DSH integration directly"
      }
    ];
    for (const rule of rules) {
      if (rule.when && rule.pattern.test(text)) {
        violations.push(`${relative}: ${rule.message}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Architecture dependency boundaries passed.");
