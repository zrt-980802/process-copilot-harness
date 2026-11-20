import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "product/reports/frontend-provider-isolation-01", `inventory-${new Date().toISOString().replace(/[:.]/gu, "-")}`);
const result = spawnSync("rg", ["--json", "-n", "-i", "EE|ee\\.|eea:|ssts|项目|project|ee_account|provider_mode|providerMode|project-car|合成工程", ".",
  "--glob", "!pnpm-lock.yaml", "--glob", "!inventory-frontend-provider.mjs"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (result.error || result.status > 1) throw result.error ?? new Error(result.stderr);
const matches = result.stdout.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line)).filter(row => row.type === "match");
function classify(file, text) {
  if (/tests\/|fixtures\//u.test(file)) return ["test fixture", /apps\/web\/tests\//u.test(file) ? "ADAPT" : "KEEP_INTERNAL"];
  if (/schemas\/|generated\/|packages\/|apps\/api\/src\/|apps\/runtime-host\//u.test(file)) {
    return ["internal protocol", file.endsWith("apps/api/src/server.ts") && text.includes("scope") ? "ADAPT" : "KEEP_INTERNAL"];
  }
  if (/apps\/web\/src\//u.test(file)) {
    if (/api\.ts|account-presentation\.ts|types\.ts|provider-view-adapter\.ts/u.test(file)) return ["internal protocol or provider identity adapter", "KEEP_INTERNAL"];
    if (/project-car|合成工程/u.test(text)) return ["demo asset", "REMOVE"];
    if (/account|identity|身份|账号/iu.test(text)) return ["provider identity", "GATE"];
    if (/provider_mode|providerMode|experience|capabilit|catalog/iu.test(text)) return ["scenario capability", "ADAPT"];
    if (/nav|project|项目|task/iu.test(text)) return ["navigation or project layout", "GATE"];
    return ["visible brand or scene copy", "GATE"];
  }
  return ["documentation or diagnostics", "KEEP_DIAGNOSTIC"];
}
const rows = matches.map(({ data }) => {
  const file = data.path.text.replaceAll("\\", "/").replace(/^\.\//u, "");
  const [category, disposition] = classify(file, data.lines.text);
  return { file, line: data.line_number, category, disposition, text: data.lines.text.trimEnd() };
});
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "classified-matches.json"), JSON.stringify({ classification: "static-inventory-not-runtime-acceptance", rows }, null, 2));
console.log(JSON.stringify({ output, hits: rows.length, categories: [...new Set(rows.map(row => row.category))],
  dispositions: Object.fromEntries([...new Set(rows.map(row => row.disposition))].map(key => [key, rows.filter(row => row.disposition === key).length])) }, null, 2));
