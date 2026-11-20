# FRONTEND-PROVIDER-ISOLATION-01 Verification

- Status: FRONTEND-PROVIDER-ISOLATION-01 DEVELOPER VERIFIED
- Date: 2026-11-20 (Asia/Shanghai)
- Repository: `E:/shanzi_workspace/process-copilot-harness`, branch `main`.
- Starting HEAD: `57160da3871a5853551071e522f1015a9624c79a`; clean worktree.
- Business baseline: `efadcd3990d87bc32e666d7c1533cef897dd9517`. The later task-book governance commit was preserved.
- Remote: `git@github.com:zrt-980802/process-copilot-harness.git`; no push/deploy.

## Ordered Work Packages

| Package | Result / owning evidence |
| --- | --- |
| FPI-0 | Whole-repository inventory before implementation, manually reviewed disposition groups in `frontend-provider-isolation-inventory.md`; repeatable per-match classified scan |
| FPI-1 | Frozen policy and controller tests before Vue changes; one Experience Projection over current C65/directory/Catalog/principal/expiry |
| FPI-2 | Neutral personal shell, projected navigation, explicit-only identity diagnostics, no demo asset/default sample |
| FPI-3 | Generic, requirements, engineering and SSTS views composed independently; EE parsing/source URIs isolated in adapter |
| FPI-4 | Abort + generation/selection fencing; external state/bookmarks/hash cleared on observed revocation/fault/expiry; current personal records remain |
| FPI-5 | No Catalog fan-out, automatic provider-account fetch or unconditional polling; retry errors have no success refresh path |
| FPI-6 | Architecture, compatibility, traceability, this verification and repeatable production browser entry |

Architecture: `../../architecture/frontend-provider-neutral-experience-v1.md`.
Full inventory: `frontend-provider-isolation-inventory.md`. Internal EE protocols,
historical documentation and fixtures remain; removing branding is not the policy.

## Experience And Request Matrix

All rows begin with Core health and the existing PC session identity. Health is
read once before session restoration and once for the new discovery generation.
No health observation grants access. Personal data uses authenticated local scope.

| State | Navigation | Additional initial requests | Prohibited background requests |
| --- | --- | --- | --- |
| Standalone / UNCONFIGURED | Home, conversation | Personal task list | Directory, Catalog, project-data, approvals, provider details |
| UNAVAILABLE / disabled / denied / expired | Personal + neutral status | Personal task list | Same; no timer retry |
| READY, no capabilities | Personal | C65, personal task list | Directory and all project business reads |
| READY, zero projects | Personal | C65, directory, personal task list | Catalog, project-data, approvals, provider details |
| Generic project | Personal, overview | C65, directory, selected Catalog, owned visible tasks/projections/execution | SSTS/project-data without the scene; implicit provider identity |
| Engineering without specifications | Supported project/engineering/requirements | Current visible project's supported data | Empty specification board/metrics/headers; unsupported tools |
| Full current EE/SSTS | Existing supported vertical scene | Current task/scene reads; approvals only in opened approvals view | Other-project Catalog fan-out, hidden approvals/polling |

Business data is filtered to the selected project and current available Tool IDs.
Old SSTS task metadata cannot re-enable a removed scene. Source labels are
attached only to actual capability-filtered business rows. The default account
dialog uses PC principal/login presentation. An explicitly expanded diagnostic
can fetch the current Provider identity; invalidation closes it and discards
late results.

The additive `GET /v1/ssts-tasks?scope=personal` is necessary to avoid the default
mixed listing's indirect source-directory call. It authenticates and narrows the
owner's local results before touching Workbench. The original mixed endpoint
still checks current source projects. C61-C66, schemas, backend policy/source
authorization, approvals, Gateway and Runtime contracts are unchanged.

## Tests And Reproduction

From `E:/shanzi_workspace/process-copilot-harness/product`:

```powershell
pnpm exec vitest run apps/web/tests/experience-policy.test.ts apps/web/tests/experience-session.test.ts apps/web/tests/provider-view-adapter.test.ts apps/api/tests/personal-task-list.test.ts
pnpm check
node apps/web/tests/frontend-provider-isolation.e2e.mjs
node apps/web/tests/decoupling-d4a.e2e.mjs
node scripts/inventory-frontend-provider.mjs
git diff --check
```

- Focused tests: 24 passed (policy 13, controller 7, adapter 3, personal API 1).
- Full gate: 300 passed, 8 conditional tests skipped; 45 files passed and 7 conditional suites skipped. Generated inventory, architecture boundaries, 24 ADR/66 Contract traceability, compatibility, lint, TypeScript/Vue checks and all workspace builds passed.
- PostgreSQL conditional variables were unset. No shared/demo database was substituted. Existing D4A actual closed-loopback startup smoke, generation/backoff/single-flight, PC-only zero-source-call and PC/source intersection suites ran in the full gate.
- Production browser: 46 check groups passed at 1440/390; `reports/frontend-provider-isolation-01/2026-11-20T13-37-18-088Z/result.json` and screenshots in the same directory.
- D4A production browser: 2 viewport groups passed (configuration failure, transport failure and success-zero in each); `reports/frontend-provider-isolation-01/2026-11-20T13-37-18-074Z/result.json`.
- Final full-gate log: `reports/frontend-provider-isolation-01/final-check.log`.
- Source hygiene/process evidence: `reports/frontend-provider-isolation-01/final-hygiene-20261120T2140.json`.
- Classified inventory: `reports/frontend-provider-isolation-01/inventory-2026-11-20T13-39-44-870Z/classified-matches.json` (6,739 lexical hits); pre-implementation scan: `reports/frontend-provider-isolation-01/2026-11-20T13-03-59-056Z/inventory-rg.jsonl`.

The browser suite serves the real Vite production build on a random loopback
port with synthetic API responses. It launches and closes its own Headless
Chrome, asserts initial request lists exactly, checks hidden DOM and the Chrome
accessibility tree, horizontal overflow/header geometry, and writes immutable
timestamped result JSON/screenshots. It does not connect to real EE, Runtime,
models, Docker or existing candidate ports.

At 1440 and 390 pixels it covers all matrix states, personal create/open/send,
current tool/schema form, precise approval parameters/decision/execution and
Operation/Trace rendering, READY->outage, zero/revoked project, Catalog removal,
A->B, standalone->READY, request-time 403, retry configuration/transport failure,
retry success-zero, URL/hash/back/reload, TTL expiry and ignored-abort late
Catalog/data/detail/task responses. A 5.2-second quiet period confirms removal
of the old polling loop. The session unit test also discards a deliberately
late Catalog result independently of browser AbortSignal behavior.

## Screenshots And Review

Final browser evidence contains each of `standalone`, `unconfigured`,
`unavailable`, `zero`, `no-capabilities`, `generic`, `engineering`, `full` at
`-1440.png` and `-390.png`, plus `full-evidence` at both sizes. Five required
states are therefore captured at each width. The developer visually inspected
all ten mandatory state screenshots, the desktop engineering view and both
Operation/Trace views: labels fit, header controls do not overlap, personal
states contain no external branding/assets/navigation, generic projects have
no specification count/board, and current EE rows retain their source label.
Browser geometry assertions also found no horizontal overflow. No full visual
redesign was performed; source/approval/Trace views retain their compact layout.

Earlier failed browser runs remain timestamped evidence. They exposed a test
harness same-document navigation/cache issue and a storage initializer running
on `about:blank`; both harness issues were corrected. They are not recorded as
successful runs. Visual review also removed an unsupported orphan specification
count and made engineering graph columns follow assembled capabilities.

## Limits And Independent Retest

- This is developer verification with synthetic frontend fixtures, not independent EE business acceptance, a real-model run or production qualification.
- Unobserved source changes are detected by source request failure, explicit refresh, focus/history revalidation or short evidence expiry. No cross-instance revocation fan-out or cached Allow was introduced.
- Expired external evidence returns to personal experience until refreshed. A revoked selected project is cleared; another project's Catalog is not silently loaded.
- Provider-neutral generic tools in fixtures test composition only. No second real Provider was implemented.
- The old vehicle asset and historical demo scripts remain as evidence but cannot mount default experience or generate project authority.
- No database, schema, `.env`, EE, DSH Core, old Product/EE tree, protected demo stack or production setting was changed. No push, deployment or Docker action occurred.
- D4B and MEMORY-01B remain outside scope. Both browser runners closed their servers/Chrome in `finally`; the full gate and startup smoke exited. Final process inspection is recorded with source hygiene.

Independent retest should rerun the commands above against the final local
commit, inspect the final screenshots/request logs, and separately arrange any
authorized real-EE business acceptance. The task does not grant access to old
demo environments or shared databases. The local commit hash is reported by Git
at delivery, avoiding a self-reference in its committed verification document.
