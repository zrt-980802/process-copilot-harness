import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../../..");
const baselinePath = process.env.FE_DEMO_BASELINE || "C:/Users/29557/Documents/ChatGPT/山子- PC/migration/demo-rc-01/20261113T061810Z-24a9c3/snapshot.json";
const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
const evidence = path.join(root, "reports/fe-demo-01", `audit-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await fs.mkdir(evidence, { recursive: false });
const hash = async (file) => createHash("sha256").update(await fs.readFile(file)).digest("hex");
const productAllowed = /^(apps\/web\/(src\/(App\.vue|ExecutionWorkbench\.vue|PersonalHome\.vue|WorkbenchShell\.vue|api\.ts|workbench\.css|account-presentation\.ts)|tests\/(account-presentation\.test\.ts|fe-demo-01[^/]*))|docs\/fe-demo-01\.md)$/;
const eeAllowed = /^(frontend\/(src\/(App\.vue|components\/access-control\/AccountsPanel\.vue|process-copilot\.js)|tests\/fe-demo-01[^/]*)|docs\/tasks\/(task-files\/FE-DEMO-01\.md|integration-requests\/INT-FE-DEMO-01\.md))$/;
const report = { baseline: baselinePath, repositories: {} };
for (const [name, previous] of Object.entries(baseline.source)) {
  const dir = previous.path;
  const git = (...args) => execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd: dir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
  const files = {};
  for (const file of git("ls-files", "-z", "-c", "-o", "--exclude-standard").split("\0").filter(Boolean)) {
    const target = path.join(dir, file);
    if ((await fs.stat(target).catch(() => null))?.isFile()) files[file] = await hash(target);
  }
  const changed = [...new Set([...Object.keys(previous.files), ...Object.keys(files)])].filter((f) => previous.files[f] !== files[f]).sort();
  const unchanged = Object.fromEntries(["head", "branch", "index"].map((key) => [key, previous[key] === (key === "head" ? git("rev-parse", "HEAD") : key === "branch" ? git("branch", "--show-current") : git("ls-files", "--stage"))]));
  const env = Object.fromEntries(await Promise.all((await fs.readdir(dir)).filter((f) => f.startsWith(".env")).map(async (f) => [f, await hash(path.join(dir, f))])));
  unchanged.root_env_files = JSON.stringify(env) === JSON.stringify(previous.ignored_env_hashes);
  report.repositories[name] = { path: dir, changed, unexpected: changed.filter((f) => !(name === "product" ? productAllowed : eeAllowed).test(f)), unchanged, sha256: Object.fromEntries(changed.map((f) => [f, files[f] || null])) };
}
report.status = Object.values(report.repositories).every((r) => !r.unexpected.length && Object.values(r.unchanged).every(Boolean)) ? "PASS" : "REVIEW_REQUIRED";
await fs.writeFile(path.join(evidence, "source-audit.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ ...report, evidence }, null, 2));
process.exitCode = report.status === "PASS" ? 0 : 1;
