# DEV-09 Minimum Delivery: T0-T7 Execution Handoff

Date: 2026-11-12, Asia/Shanghai. Run: `20261112-t0-t7-01`.

This is a developer/test-operator result. T8, T9 and T10 are **NOT_RUN** and require a separate independent verifier. The system is a candidate for independent verification; it has not met the complete minimum-delivery exit criteria yet.

## Scope and Baseline

- Product: `C:/Users/29557/.hermes-web-ui/.ekko/workspace/default/mw1g1vskatd2r8/product`, branch `main`, HEAD `8e3134951ef478c5fb500457f8eda32d136e60c3`.
- EE: `E:/shanzi_workspace/feishu-ee-agents-dev09a`, branch `dev09a-ee-mcp`, HEAD `494db4ca9ba1dc91436aed7379d54e389776fbc0`.
- Approved plan: entry workspace `migration/DEV-09-MINIMUM-DELIVERY-TEST-PLAN.md`.
- Evidence: `reports/dev09-minimum-delivery/20261112-t0-t7-01/`. This directory is intentionally Git-ignored; retain it on this machine with the source checkout.
- Both repositories had pre-existing uncommitted/untracked files. They remain intact. No commit, push, merge or remote deployment was performed.
- No EE source, DSH Core, schema, `.env`, shared database or remote environment change was made in this test run.

## Results

`test-results.json` maps all 83 T0-T7 cases to evidence. This is a case-by-case interpretation of the underlying scripts, not a new independent test suite or 83 isolated browser runs.

| Area | Result and Primary Evidence |
| --- | --- |
| Product gate | `product-check-final.log`: 169 passed / 7 conditional PostgreSQL skips; contracts, architecture, lint, typecheck and builds pass |
| Conditional cases | `postgres-tests-executed.log`: all seven skipped cases activated against isolated PostgreSQL; 10 passed including three host-covered cases |
| EE gate | `ee-tests.log`: 16 passed against isolated real MySQL; exact test names retained |
| Real identity persistence | `postgres-real-ee-login.json`: three groups pass, including 12 simultaneous first logins across two service instances |
| Unified login | `auth-final/result.json`, `auth-extra-MIN01.json`: account mapping, wrong/unknown login, switch/logout, source revocation, password reset, disable and new identity boundaries |
| Permission intersection | `permissions-AUTHORITY_FINAL.json`, `permission-cache-CACHE_FINAL.json`: direct saved routes, resource concealment, membership removal, restore and restart/refresh/relogin |
| MCP | `mcp-MIN02.json`: all eight published read tools succeed through real EE/MySQL with trace refs, reject unauthorized callers and invalid arguments |
| Provider faults | `mcp-real-faults.json`: five actual backend calls through a test-only response transformer; missing/stale/secret/timeout results rejected |
| Three T5 rounds | `chat-fixed-round-{1,2,3}/result.json`, their `runtime-boundaries.json`, `chat-extra-FIXED_R{1,2,3}.json` and `chat-completion-FINAL_COMPLETE_R{1,2,3}.json` |
| Existing behavior | `regression-REG_RETEST.json`, `markdown/result.json`: six original tasks, one Draft digest, 21 original messages, six reads, navigation, capabilities and 1440/1100/390 layouts |
| Recovery | Successful entries in `recovery-FINAL.json`, `recovery-REC_FINAL.json`, `recovery-REC_ADAPTER_FINAL.json`; membership cache follow-up in `permission-cache-CACHE_FINAL.json` |
| Seed repeat | `seed-idempotency.json`: all 13 EE and 5 PC business table hashes identical before/after actual repeat seeds |
| End state | `baseline-comparison.json`, `permission-after.json`, `environment-after.json`, `service-health-after.json`, `sensitive-scan.json` |

The seven host skips all require `PC_TEST_POSTGRES_URL`: PostgreSQL event projection, gateway, identity/profile, resource, Runtime registry, SSTS Draft, and external-login concurrency. Their isolated Linux execution is complete; they are not untested exceptions.

Three T5 rounds cover four real accounts and models, separate user Runtimes, concurrent users and same-user sessions, duplicate request conflicts, cancellation, revocation during generation, browser restoration, API/Runtime restart, and manager/filesystem/Assignment isolation. Supplemental rounds cover Engineer project generation and logout/account-switch/relogin with exact own-history comparison.

The Markdown injection fixture only replaces rendering input in the browser. Provider fault tests transform responses after successful real EE/MySQL calls. Neither fixture substitutes a fake business backend for the real end-to-end chain.

## Corrected Defects

Detailed reproduction, impact, cause and retest evidence are in `defects.json`. All five are `fixed_verified`; no known open P0/P1 remains in the executed scope.

1. MIN-001, P1: NUL/lone-surrogate strings could reach JSONB persistence and produce 500. Recursive validation now rejects unsupported string keys/values and request identifiers before admission.
2. MIN-002, P1: duplicate simultaneous workspace submissions executed twice. A workspace turn guard rejects overlap; optional durable `request_id` reservations reject replay, changed payload and replay after API restart. The browser supplies UUIDs. A conflict remains a conflict; it does not return a cached model response.
3. MIN-003, P1: owned project history and saved projections omitted current membership checks. Current authority is now required on saved workbench/SSTS routes and project task lists.
4. MIN-004, P1: rebuilding a mutable Runtime image tag could make the running template's old image ID unavailable for replacements. The launcher retains an immutable image tag before builds; rollout checks image availability before removing any named user container. Real state-preserving replacement and post-rollout conversations pass.
5. MIN-005, P2: the internal generic resource getter distinguished foreign IDs from absent IDs. Both now return 404. The public generic route remains uniformly fenced with 403; authorized business routes serve resources.

## Data and Service State

Eight original EE business table hashes match T0 exactly. Original task/Draft projections match after excluding **only** newly appended `SSTS_DRAFT_DOWNLOADED` audit entries, enumerated in `read-audit-additions.json`. Those audit entries remain stored.

Permission mutations were restored semantically, preserving revision/audit history. Therefore raw membership/permission hashes intentionally differ. Pre-existing account names, statuses and roles match the baseline. Named test accounts remain disabled; synthetic conversations and audit records remain identifiable and retained.

User Runtime replacement retained state volumes. Recovery observed zero owner mismatches, invalid/infinite leases, active turns and revoking sessions. Finite expired assignment rows are retained historical projections and are checked at admission; they are not proof of running sessions. The later supplemental turns are also checked for terminal idle state in `service-health-after.json`.

Only the temporary `pc-minimum-postgres-runner` container was stopped and removed, with no volume deletion. The isolated test database and test build directory are retained. Demo services, images, seed records, state volumes and the pre-existing exited seed container remain. No global prune was run.

Bounded service logs and this run's text evidence were scanned against active configured secrets and common token/key/credential-URL patterns. Counts and scope are recorded without copying secrets into evidence. This is not a substitute for T8 independent security exploration.

## Independent Verification Handoff

1. Freeze edits to the Product/EE implementation. Use `frozen-source.json` to detect source or image drift before verification. It contains hashes, not source bodies or secrets.
2. Open clean browser contexts at `http://127.0.0.1:18091/` and `http://127.0.0.1:18092/access-control`. Account credentials remain in the existing local demo documentation; do not paste model credentials into chat or reports.
3. Create a fresh independent evidence directory. Follow the approved plan's T8-T10 requirements, choose independent negative requests and ordering, and preserve failures. Developer reports are background evidence only.
4. `conversation.acceptance` is disabled at rest. A verifier who uses it must save its original state, explicitly activate it through the isolated EE admin service, and restore that state in teardown. A new EE login creates identity without implicitly granting project membership.
5. Keep MySQL and PostgreSQL independent. Use only the local `pc-workbench-demo` stack. Do not touch `192.168.31.95`, the original EE worktree, shared EE data, ports or versions.
6. Temporary permission mutations must restore the saved role/member semantics and be verified afterward. Keep original tasks, messages, Drafts, audit history and volumes.
7. Output independent `PASS`, `CONDITIONAL PASS` or `FAIL` with case evidence and any Owner decisions. T8-T10 must not inherit PASS from this report.

Useful replay entry points: `deploy/verify-minimum-delivery.mjs` phases `baseline`, `auth-extra`, `permissions`, `permission-cache`, `mcp`, `chat-extra`, `chat-completion`, `regression`, `recovery`, `final-state`; existing unified-login and multi-user scripts accept `PC_TEST_EVIDENCE_DIR`. Use distinct directories and `PC_TEST_RUN_TAG` values; baseline capture must precede mutations. Recovery phases intentionally restart local services. Real-model scenarios incur actual provider calls.

Current limitations remain: partial EE auth/admin/MCP service, read-only MCP scope, no full EE editor, no enterprise publication, no remote deployment, no capacity or disaster-recovery certification. T9 repetition/stability and T10 independent final acceptance remain outstanding.
