import { createHash, randomBytes } from "node:crypto";
import { IdentityAuthorizationService } from "../../packages/application/src/index.js";
import { PostgresIdentityAuthorizationRepository } from "../../packages/persistence/src/index.js";

if (!process.env.DATABASE_URL?.includes("@pc-postgres:5432/pc") || process.env.RC_TASK !== "REAL-EE-INTEGRATION-CLOSURE-01") throw new Error("Isolated fixture required");
const identity = new IdentityAuthorizationService(new PostgresIdentityAuthorizationRepository(process.env.DATABASE_URL), process.env.PC_ENVELOPE_SIGNING_KEY!);
await identity.initialize();
try {
  for (const [account, projects] of [["engineer", ["RCI-ENG", "RCI-FULLA"]], ["reviewer", ["RCI-FULLB"]],
    ["generic", ["RCI-GENERIC"]], ["zero", []], ["admin", ["RCI-FULLA"]]] as const) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    async function ee(path: string, body: unknown) {
      const response = await fetch(`http://ee-api:5000/api/v1/auth/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`Real EE authentication failed (${response.status})`);
      if (response.headers.getSetCookie().length) headers.cookie = response.headers.getSetCookie().map(item => item.split(";")[0]).join("; ");
      return (await response.json()).data;
    }
    const login = await ee("login", { username: `rc.${account}`, password: process.env[`RC_${account.toUpperCase()}_PASSWORD`] });
    headers["x-csrf-token"] = login.csrf_token;
    const verifier = randomBytes(32).toString("base64url");
    const launch = await ee("process-copilot/launch", { audience: "process-copilot", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
    const response = await fetch("http://pc-api:3000/v1/auth/ee/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: launch.ticket, code_verifier: verifier }) });
    if (!response.ok) throw new Error(`Real PC enrollment failed (${response.status})`);
    const { principal } = await response.json();
    const actions = ["page:projects", "page:requirements", "page:functions", "page:architecture", "draft.read", "draft.generate", "conversation.run"];
    // PC fixture policy is explicit and independent; it never imports EE Allow decisions.
    if (projects.length) await identity.replaceAuthorizationGrants({ principal_id: principal.principal_id, expected_authorization_revision: principal.authorization_revision,
      grants: projects.flatMap(scope_id => actions.map(action => ({ action, scope_type: "project" as const, scope_id, effect: "allow" as const, evidence_ref: "real-ee-closure:explicit-pc-fixture-policy" }))) });
    console.log(JSON.stringify({ account: `rc.${account}`, principal_id: principal.principal_id, pc_project_grants: projects }));
  }
} finally { await identity.close(); }
