# EE / PC unified local login

2026-11-12. Local Docker integration. No commit, push, remote deployment,
shared database, schema, .env or DSH Core changes.

## Current entry and accounts

PC: <http://127.0.0.1:18091/>. EE administration:
<http://127.0.0.1:18092/access-control>. Use the same EE account on both:

| Account | Password | Existing PC identity |
| --- | --- | --- |
| demo.engineer | LocalAcceptanceSecret123 | Original pilot.acceptance Principal, five retained workspaces |
| demo.reviewer | LocalReviewerSecret123 | Original reviewer.acceptance Principal |
| demo.admin | LocalDemoAdminSecret123 | Account administrator, no EP37/EP38 membership |

The old Pilot names are historical aliases displayed beside the actual EE account
in the admin table. They are no longer browser login names. A fresh EE account
receives a PC Principal on first login, without a Pilot password, PC grants or EE
project membership. Local browser acceptance accounts remain disabled for audit;
their randomly generated passwords are not recorded.

## Identity and session boundary

ADR-0010 and integration research section 5.3 remain authoritative. EE owns the
password and live source session; PC keeps its independent stable Principal and
task ownership. Browser passwords go only through the narrowly scoped EE auth
proxy. PC exchanges an EE-issued 60-second single-use ticket using PKCE S256 and
an internal service secret. Tickets/verifiers remain in POST bodies, never URLs.
No browser receives the service secret. Token and proof responses use no-store.

Identity enrollment matches the exact issuer, subject and tenant. Existing links
reuse the same Principal and revisions. New enrollment is serialized by a
PostgreSQL advisory transaction lock and the existing unique identity key.
Existing persistence tables are reused without schema changes. PC session expiry
is bounded by the source EE session and the existing eight-hour PC limit.

Every PC authenticate checks the real source EE session/account through the
service-authenticated internal endpoint. Logout, revoke-all, password reset and
account disable invalidate access on the next request. EE dependency failure
fails closed. PC logout also logs out the current EE browser session. A rejected
PC request clears local PC state without logging out an unrelated EE session.
An active EE browser session can open PC without another password. A request
already in flight is not cancelled by a later account change.

The account mapping endpoint requires EE account-management permission, then
uses a server-to-server secret to read safe PC bindings. Browser nginx denies
internal identity endpoints and the legacy Pilot route. EE page/action grants
and explicit project membership still determine effective tool access.

## Validation

- `pnpm check`: generated inventory, 17 ADRs / 42 contracts, lint, typecheck,
  build; **149 passed / 7 conditional skipped**. One additional skipped test
  requires a PostgreSQL URL; equivalent real concurrent coverage ran below.
- Real isolated MySQL suite: **16 passed** via Docker pytest, including ticket
  replay, wrong verifier, service rejection, CSRF denial, real 61-second expiry,
  session logout, account disable and non-admin mapping denial.
- `deploy/verify-unified-login-postgres.mts`: actual EE/MySQL plus separate
  `pc_unified_login_test` database in the local PostgreSQL container. Real API
  exchange/denial, source logout, dependency failure, 12 concurrent first logins
  across two service instances, persistence and revocation passed. This test DB
  is retained; it does not replace or reset pc_demo.
- `node deploy/verify-unified-login.mjs`: actual Chrome password login and
  EE-to-PC entry, both account views, five original task IDs across refresh,
  other-owner denial, engineer nine/reviewer four capabilities, immediate role
  permission removal and restoration, administrator without project membership,
  new-account empty home, revoke/reset/disable, logout and switch passed.
  Desktop widths 1440/1100 and browser page errors checked.
- `node deploy/verify-unified-login-workflow.mjs`: six real MCP reads with EE
  trace evidence passed under unified login, 21 retained messages, actual
  Markdown heading/table rendering and the original SSTS workbench passed.
- Evidence: `reports/unified-login/{result.json,postgres-result.json,
  product-check.log,ee-mysql-tests.log}` and screenshots.

Earlier browser scripts that submit Pilot credentials document historical
acceptance stages. Use the unified-login scripts above for the current demo.

The verifier script exercises existing real services. Its isolated test account
and temporary permission mutation are explicit acceptance inputs; permissions
are restored in finally and the test account is disabled.

## Local deployment and limitations

`deploy/start-workbench-demo.py up -d` includes both frontends. Backend bundles
come from `node deploy/build-workbench-demo.mjs`; build PC web with
`pnpm --filter @pc/web build`, then use the launcher `build ee-api web ee-admin-web`.
The launcher inherits the existing model configuration in memory. No model
credential is printed or saved by this login implementation.

Only the isolated eight-service demo is deployed. EE MySQL ee_pc_demo and PC
PostgreSQL pc_demo remain separate. EE account/permission/audit APIs and MCP Owner
dependencies are present; the other EE menu entries do not imply full EE services.
The launch-ticket store is process-local and assumes the single local EE worker;
restart loses unredeemed tickets safely. Multi-worker/distributed SSO, production
OIDC, HTTPS domains and remote enterprise deployment are outside this local task.
Existing model, Runtime, Harness and conversation workflows are retained; this
login acceptance does not claim a new model-generation or enterprise-publish test.

Independent EE verification is recorded in
`docs/tasks/verifications/DEV-09C-UNIFIED-LOGIN.md` in the EE worktree.
The independent review passed and DEV-09C is auto_done. It separately reran
two real MySQL cases and current browser checks; it reviewed the full-suite
evidence without claiming an independent full-suite rerun.
