import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const baseline = "9fe2e6beb92cbfd98628e73c236b7f0f3687825b";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const allowed = new Set([
  "README.md",
  "governance/PC-AUTHORIZATION-MVP-01-SCHEMA-PROPOSAL.md",
  "product/apps/api/src/authorization-mvp.ts",
  "product/apps/api/src/local-identity-provider.ts",
  "product/apps/api/src/main.ts",
  "product/apps/api/src/server.ts",
  "product/apps/api/src/workbench.ts",
  "product/apps/api/tests/authorization-mvp-browser.test.ts",
  "product/apps/api/tests/authorization-mvp.test.ts",
  "product/apps/api/tests/session-source-split.test.ts",
  "product/apps/api/tests/support/authorization-mvp-browser-fixture.ts",
  "product/apps/api/tests/support/authorization-mvp-fixture.ts",
  "product/apps/api/tests/workbench.test.ts",
  "product/apps/web/src/App.vue",
  "product/apps/web/src/AuthorityStatus.vue",
  "product/apps/web/src/ExecutionWorkbench.vue",
  "product/apps/web/src/WorkbenchShell.vue",
  "product/apps/web/src/api.ts",
  "product/apps/web/src/authorization-presentation.ts",
  "product/apps/web/tests/authorization-presentation.test.ts",
  "product/apps/web/tests/frontend-provider-isolation.e2e.mjs",
  "product/docs/pc-authorization-mvp-01-verification.md",
  "product/eslint.config.mjs",
  "product/integration/authorization-mvp/audit-closure.mjs",
  "product/integration/authorization-mvp/session-api.mts",
  "product/packages/application/fixtures/ee-v1-mapping-release.json",
  "product/packages/application/scripts/generate-ee-authorization-mapping.mjs",
  "product/packages/application/src/authority-binding.ts",
  "product/packages/application/src/authority-decision.ts",
  "product/packages/application/src/authority-router.ts",
  "product/packages/application/src/authorization-context.ts",
  "product/packages/application/src/compatibility-mapping.ts",
  "product/packages/application/src/ee-v1-mappings.generated.ts",
  "product/packages/application/src/eeclaw-adapter.ts",
  "product/packages/application/src/identity-authorization.ts",
  "product/packages/application/src/index.ts",
  "product/packages/application/src/provider-intersection.ts",
  "product/packages/domain/src/index.ts",
  "product/packages/domain/src/session-assurance.ts",
  "product/packages/gateway/src/service.ts",
  "product/packages/gateway/src/types.ts",
  "product/packages/persistence/migrations/identity/0001_session_assurance.sql",
  "product/packages/persistence/src/gateway-memory.ts",
  "product/packages/persistence/src/gateway-postgres.ts",
  "product/packages/persistence/src/identity-authorization-memory.ts",
  "product/packages/persistence/src/identity-authorization-postgres.ts",
  "product/packages/persistence/tests/authority-binding-mvp.test.ts",
  "product/packages/persistence/tests/authority-mvp.test.ts",
  "product/packages/persistence/tests/authorization-mvp-postgres.test.ts",
  "product/packages/persistence/tests/compatibility-mapping-mvp.test.ts",
  "product/packages/persistence/tests/identity-authorization.test.ts",
  "product/packages/persistence/tests/session-assurance.test.ts"
]);
const changed = [...new Set([
  ...git("diff", "--name-only", baseline).split("\n"),
  ...git("ls-files", "--others", "--exclude-standard").split("\n")
].filter(Boolean))].sort();
assert.deepEqual(changed.filter(file => !allowed.has(file)), [], "Changes outside the approved MVP scope");
const files = [];
for (const file of changed) {
  const text = (await readFile(resolve(root, file), "utf8")).replaceAll("\r\n", "\n");
  assert(!/(?:\bsk-[a-zA-Z0-9_-]{20,}|\bghp_[a-zA-Z0-9]{30,}|\bgithub_pat_[a-zA-Z0-9_]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|https?:\/\/[^\s/:]+:[^\s/@]+@)/u.test(text), `Sensitive material: ${file}`);
  if (file.includes("/src/") && !file.includes("/tests/")) assert(!/adr0025-oracle|contracts\/tests/u.test(text), `Runtime imports test evidence: ${file}`);
  files.push({ file, sha256_lf: createHash("sha256").update(text).digest("hex") });
}
console.log(JSON.stringify({ task: "PC-AUTHORIZATION-MVP-01", baseline, head: git("rev-parse", "HEAD"),
  origin_main: git("rev-parse", "origin/main"), branch: git("branch", "--show-current"), files,
  out_of_scope_changes: 0, runtime_oracle_imports: 0, sensitive_findings: 0,
  scope: "Read-only source audit; real EE/network/database behavior is not inferred" }, null, 2));
