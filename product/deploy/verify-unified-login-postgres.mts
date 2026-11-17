import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { IdentityAuthorizationService } from "../packages/application/src/index.js";
import { PostgresIdentityAuthorizationRepository } from "../packages/persistence/src/index.js";
import { buildApiServer } from "../apps/api/src/server.js";
import { EeLogin } from "../apps/api/src/ee-login.js";

const db = "postgres://pc_demo:local-pc-demo-only@pc-postgres:5432/pc_unified_login_test";
const issuer = "http://ee-api:5000", tenant = `test-${randomUUID()}`;
const secret = process.env.EECLAW_ADAPTER_SECRET!;
const repositories = [0, 1].map(() => new PostgresIdentityAuthorizationRepository(db));
const services = repositories.map(r => new IdentityAuthorizationService(r, "real-postgres-login-test-signing-key-000000000"));
const checks: string[] = [];
let eeCookies = "", csrf = "";
async function ee(path: string, body: unknown) {
  const response = await fetch(`${issuer}/api/v1/auth/${path}`, { method: "POST", headers: {
    "content-type": "application/json", cookie: eeCookies, "x-csrf-token": csrf }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  if (response.headers.getSetCookie().length) eeCookies = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  return (await response.json()).data;
}
const service = services[0]!;
const login = new EeLogin(service, issuer, secret, tenant);
const server = buildApiServer({ identityAuthorization: service, eeLogin: login, eeIdentitySecret: secret });
try {
  await service.initialize();
  const eeAccount = await ee("login", { username: "demo.engineer", password: "LocalAcceptanceSecret123" });
  csrf = eeAccount.csrf_token;
  const old = await service.provisionPilotAccount({ tenant_id: tenant, account_key: "old.engineer", secret: "OldLocalSecret123" });
  await service.linkVerifiedIdentity({ principal_id: old.principal.principal_id, identity_provider_ref: "eeclaw", issuer,
    external_subject: String(eeAccount.account.id), tenant_or_org_ref: tenant, verification_level: "admin_reauthentication",
    expected_identity_revision: old.principal.identity_revision });
  service.registerSessionValidator(async (session, principal) => { await login.validate(session, principal); });
  const verifier = randomBytes(32).toString("base64url");
  const launch = await ee("process-copilot/launch", { audience: "process-copilot", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const input = { ticket: launch.ticket, code_verifier: verifier };
  assert.equal((await server.inject({ method: "POST", url: "/v1/auth/ee/exchange", headers: { origin: "https://foreign.example" }, payload: input })).statusCode, 401);
  assert.equal((await server.inject({ method: "POST", url: "/v1/auth/ee/exchange", payload: {} })).statusCode, 401);
  const exchanged = await server.inject({ method: "POST", url: "/v1/auth/ee/exchange", payload: input });
  assert.equal(exchanged.statusCode, 200);
  const session = exchanged.json();
  assert.equal(session.principal.principal_id, old.principal.principal_id);
  assert.equal((await server.inject({ method: "POST", url: "/v1/auth/ee/exchange", payload: input })).statusCode, 401);
  assert.equal((await server.inject({ method: "POST", url: "/v1/pilot/sign-in", payload: {} })).statusCode, 401);
  assert.equal((await server.inject({ method: "GET", url: "/v1/internal/identity/ee-bindings" })).statusCode, 401);
  const mappings = await server.inject({ method: "GET", url: "/v1/internal/identity/ee-bindings", headers: { "x-pc-adapter-secret": secret } });
  assert.equal(mappings.statusCode, 200);
  assert.deepEqual(mappings.json().items[0].legacy_account_keys, ["old.engineer"]);
  checks.push("real EE/MySQL ticket through API preserves PostgreSQL Principal; replay, bad origin, malformed input, Pilot and wrong-service denied");
  const headers = { authorization: `Bearer ${session.access_token}` };
  assert.equal((await server.inject({ method: "GET", url: "/v1/identity/me", headers })).statusCode, 200);
  const outage = new EeLogin(service, "http://127.0.0.1:9", secret, tenant);
  await assert.rejects(() => outage.exchange(randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")), { code: "PC_EE_LOGIN_UNAVAILABLE" });
  await ee("logout", {});
  assert.equal((await server.inject({ method: "GET", url: "/v1/identity/me", headers })).statusCode, 401);
  checks.push("EE unavailable fails closed; real EE logout rejects the persisted PC token");
  const key = { identity_provider_ref: "eeclaw", issuer, external_subject: randomUUID(), tenant_or_org_ref: tenant };
  const expires = new Date(Date.now() + 60_000).toISOString();
  const enrolled = await Promise.all(Array.from({ length: 12 }, (_, i) => services[i % 2]!.signInExternal(key, randomUUID(), expires)));
  assert.equal(new Set(enrolled.map(s => s.principal.principal_id)).size, 1);
  const principalId = enrolled[0]!.principal.principal_id;
  assert.deepEqual(await repositories[1]!.listAuthorizationGrants(principalId), []);
  assert.deepEqual((await login.bindings()).items.find(b => b.principal_id === principalId)!.legacy_account_keys, []);
  assert.equal((await services[1]!.authenticate(enrolled[0]!.access_token)).principal.principal_id, principalId);
  await services[1]!.signOut(enrolled[0]!.access_token);
  await assert.rejects(() => services[1]!.authenticate(enrolled[0]!.access_token), { code: "PC_AUTHENTICATION_REQUIRED" });
  checks.push("12 concurrent first logins across two PostgreSQL service instances create one identity; no Pilot/grants; cross-instance session persistence/revocation");
  const result = { status: "PASS", checks, database: "pc_unified_login_test", production_schema_changes: false };
  await writeFile("/tmp/unified-postgres-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await server.close(); await Promise.all(services.map(s => s.close())); }
