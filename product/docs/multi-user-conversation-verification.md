# Multi-user conversation repair and verification

Date: 2026-11-12. Local Docker demo at http://127.0.0.1:18091/.
EE account administration remains at http://127.0.0.1:18092/access-control.

## Result and cause

Engineer, reviewer, administrator and a newly enrolled EE account completed real
model conversations. The previous implementation had only an engineer-owned
Runtime and engineer MCP binding; every conversation also required an engineering
SSTS profile. Login-only acceptance did not exercise those other execution paths.

The conversation page now creates personal conversations or authorized project
conversations. Personal conversations use an explicit active-Principal policy,
restricted to that Principal's user scope and zero tools. They grant no project
membership or enterprise permission. Project conversations publish an immutable
profile containing the user's allowed READ tools. Existing SSTS profiles retain
their full dependency requirements; reviewer access does not imply engineering
draft-generation permission.

The legacy engineer Runtime, Principal and history are retained. Other Principals
receive a separate on-demand container and durable state volume. Each new Runtime
mounts only its owner's materialization subtree, read-only. A restricted internal
local provisioner derives its configuration from the fixed demo Runtime; API and
Runtime containers have no Docker socket. User execution obtains the verified EE
binding; a previously revoked binding is not recreated. Returned model/history
responses recheck the EE source session and current authorization.

Additional regressions found and repaired during acceptance:

- A personal conversation's enterprise-tool request now returns explicit scope denial.
- Mobile conversation creation no longer causes horizontal overflow or clips the composer.
- Personal conversations do not display SSTS input/generation controls.
- Runtime event ingestion uses the actual API route. An authenticated compatibility
  alias supports already-created local containers during rollout.
- An offline/replaced user container yields an unavailable execution projection,
  preserving the registered session without allocating a new Runtime or returning 500.
- Navigating from home preserves the restored project task instead of selecting
  an unrelated personal conversation.

## Verified coverage

| Verification | Result |
| --- | --- |
| `pnpm check`: contracts, 17 ADR boundaries, lint, typecheck, tests, builds | 165 passed, 7 conditional PostgreSQL tests skipped |
| Real EE MCP/Owner/MySQL pytest suite | 16 passed; 5 existing dependency deprecation warnings |
| Multi-user browser/API/real-model suite | 11 scenario groups passed |
| Provisioner and actual Runtime boundary suite | 401/400/400/400 negative requests; 3 isolated Runtime volumes and owner denials passed |
| Real PostgreSQL identity/API suite in `pc_unified_login_test` | 3 groups passed, including 12 simultaneous first logins across 2 service instances |
| Existing unified-login browser suite | 10 groups passed, no browser exceptions |
| Retained original engineering workflow | 6 real MCP reads, 21 historical messages, Markdown and original workbench passed |
| Final web build/typecheck and lint after navigation correction | Passed |

The seven conditional unit-suite cases are not reported as executed. Separate
PostgreSQL acceptance and the real demo use actual database persistence. The
MySQL results are executor-run verification, not a new independent EE review.

The multi-user suite checks four simultaneous real model turns, separate user
histories, two concurrent sessions of one reviewer, correct Runtime reuse, actual
reviewer MCP execution, denied Function access, denied tools in personal chat,
foreign task/history/execution/cancel/tool requests, actual role-permission
removal and restoration, browser-created conversations and Markdown rendering,
1440/1100/390 layouts, visible composers, API/Runtime restart and remembered
context, successful event export from four Runtimes, and session revocation while
a model turn is running. The revoked caller receives 401 instead of generated
output. Synthetic accounts are disabled after acceptance; real demo roles are
restored.

The boundary suite checks actual container filesystems: each new Runtime sees
only its owner directory, cannot access `/data/blobs` or the Docker socket, requires
the service secret and rejects another user's Assignment before session execution.
These tighter filesystem mounts apply to the new user Runtimes; the legacy
engineer Runtime retains its existing volume configuration and ownership checks.

Evidence: `reports/multi-user-conversation/result.json`, `runtime-boundaries.json`,
`postgres-result.json`, `reviewer-chat-{1440,1100,390}.png`, plus
`reports/unified-login/result.json` and `retained-workflow.json`.

## Repeat and operate

From the Product directory, with the local demo running:

```powershell
pnpm check
node deploy/verify-multi-user-conversation.mjs
node deploy/verify-user-runtime-boundaries.mjs
node deploy/verify-unified-login.mjs
node deploy/verify-unified-login-workflow.mjs
```

The model suite consumes actual configured model requests. It uses the reserved
synthetic `conversation.acceptance` account, re-enables it for reruns, and disables
it after successful verification. It creates retained acceptance conversations,
temporarily removes/restores the reviewer's architecture permission, and restarts
the local API/reviewer Runtime. Run it when no one is using the demo.

Build backend bundles with `node deploy/build-workbench-demo.mjs`, build the web
with `pnpm --filter @pc/web build`, and use `deploy/start-workbench-demo.py` for
Compose builds/startup. The launcher inherits local model credentials in memory.

User Runtimes deliberately reject an unplanned image replacement. For an explicit
local image rollout, first quiesce/stop `pc-workbench-demo-pc-api-1`, then pass only
the exact inspected user-container names to `deploy/rollout-user-runtimes.py`.
It refuses active turns/revocations, stops and removes only those containers,
and preserves state volumes. Update/start the template, manager and API with the
launcher. The next authenticated execution recreates each user Runtime with the
same state volume. This procedure was exercised with all three new user Runtimes;
the subsequent real-model suite passed with the retained histories.

## Scope

Local demo only; provisioner capacity is 16 user containers. This is not a
production scheduler, multi-worker deployment or sustained load/soak test.
There is no new enterprise publication or regenerated SSTS draft claim in this
repair. Original Harness/SSTS flows remain available and were regressed through
their retained task/history/read paths. No DSH Core, EE source, schema, `.env`,
remote/shared database, ports, commits or pushes were changed by this repair.
