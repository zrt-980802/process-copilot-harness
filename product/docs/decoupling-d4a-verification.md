# DECOUPLING D4A Provider Bundle Verification

Date: 2026-11-20 (Asia/Shanghai).
Result: **D4A COMPLETE / D4B NOT STARTED**.
Classification: local developer verification, not independent acceptance or production qualification.
Task authority: `../../governance/DECOUPLING-D4A-EE-PROVIDER-BUNDLE-LIFECYCLE-TASK.md`.

## Baseline And Sequence

- Implementation repository: `E:/shanzi_workspace/process-copilot-harness`, branch `main`.
- Starting HEAD: `0dd7580fcb8afc1940436a525e63ab70fbe24921`. Its known task-document commit follows D3 `f9d0f26917df990bb6a657b52ab4208dfbac0b76`.
- Read-only remote check returned `f9d0f26917df990bb6a657b52ab4208dfbac0b76` for GitHub main; no push or remote mutation.
- W0 updated the desktop workspace HANDOFF and appended Harness paths. Historical Product/EE paths still exist and are historical only.
- Historical `migration/source-snapshot.json` was not rewritten. SHA256: `EADB79BD45ABF78C5D5C3F9B4862D2E623852FC727D5A53E9BCDF807AFF80F06`.
- D4A-0 froze the contract/fault matrix and wrote contract/lifecycle tests before implementation. Initial lifecycle tests failed because the module did not yet exist.
- D4A-1/2 implemented and passed targeted tests, actual API startup smoke and browser compatibility; the full gate passed before D4A-3 updated completion state.

## Implementation Boundary

`apps/api/src/ee-provider-bundle.ts` owns all five EE ports, immutable Catalog/Connector descriptions, profile references, generation Workbench and aggregate lifecycle. A candidate is invisible until compatibility, MCP discovery, Tool/Profile publication and Connector assembly finish. A single synchronous swap publishes it. Concurrent reloads join one promise; a new reload is needed for configuration changes arriving during an in-flight build.

Reload immediately closes the old executable generation. Failure keeps only diagnostic catalog revision/tool IDs. Credential issue, dispatch and reconcile check the current Connector; retained ports, late responses and whole project Workbench results are fenced. Connector keys include process epoch/generation. Old router attempts update detached Health records. No automatic write replay was added.

`main.ts` now registers Bundle facades and assembles a fresh Workbench per generation, without mutating live options. Personal execution selects one persistent Core Workbench across EE reloads. `server.ts` exposes C66 in health/retry; C65 carries generation/revision in existing evidence fields. `workbench.ts` supports diagnostic catalog revision when execution is unavailable. The frontend reuses the existing unavailable banner globally and distinguishes outage from no project permission; no page redesign was performed.

Application changes expose the existing Health registry, detach its records on configuration revision changes, and classify compatibility HTTP/auth/protocol failures. Gateway catalog synchronization accepts a generation-specific registration key. Contracts add strict C66 and update generated inventory to 66; C61/C62/C63/C65 semantics are unchanged.

## Lifecycle And Recovery

- UNCONFIGURED: no complete EE configuration, zero EE construction/network calls.
- STARTING: no executable generation while assembling.
- READY: one complete compatible snapshot; C62 remains HEALTHY.
- DEGRADED: reserved aggregate diagnostic state, no executable EE port in D4A.
- UNAVAILABLE: partial configuration, compatibility, authentication, transport, timeout, protocol or expired Health; execution closed.
- DISABLED: configured disable or explicit authority-change/revocation signal; execution closed.
- Only transport/timeout permit bounded recovery, with 1-30 second exponential backoff and single-flight. Manual retry also honors backoff. There is no background probe scheduler.
- Configuration/authentication/compatibility/protocol/authority failures require explicit intervention and retry. Business requests never recover a failed Bundle.
- Ordinary EE business DENY remains a request-time denial, not a Bundle outage. PC Policy and current EE decision still intersect. Health/Availability never grants access.
- EE session validation remains required for EE-authenticated sessions during an outage. No fallback authenticates them as local PC sessions.
- `approval.decide` remains denied without a trusted Operation Authority Resolver.

Detailed fault matrix: `../../architecture/external-provider-decoupling-d4a-provider-bundle-v1.md`.

## Directed Matrix (TS-DECOUPLING-006)

| Scenario | Evidence | Result |
| --- | --- | --- |
| Absent/partial configuration | Bundle unit tests + actual `main.ts` startup | UNCONFIGURED/UNAVAILABLE, no partial publication; Core healthy |
| Complete compatible generation | Bundle unit tests | Five ports + Catalog/Profile/Connector published together |
| HTTP401, malformed JSON, unknown compatibility | Real loopback HTTP compatibility boundary | Stable AUTHENTICATION/PROTOCOL/COMPATIBILITY; no business recovery |
| Transport/timeout | Unit faults + actual unreachable-port startup | EE unavailable, Core/ready HTTP200; bounded retry |
| Business DENY | Bundle + D3 authorization tests | Denied request, READY retained |
| Catalog/config generation switch | Immutable catalog and Workbench tests | New snapshot selected atomically; raw candidate mutation cannot change published catalog |
| Mid-reload failure | Bundle tests | Old executable references closed; readonly diagnostic metadata retained |
| Concurrent reload / old late completion | Single-flight, retained ports, whole Workbench and late Health tests | One build, stale results rejected, new generation not poisoned |
| Credential/dispatch/reconcile fencing | Old Connector + late dispatch tests | Old generation rejected; already-dispatched unknown result never replayed |
| PC-only after reload/failure | Actual IdentityAuthorizationService with memory repository + persistent Workbench selection | Zero EE evaluation calls; personal policy remains available |
| EE after reload | Actual PC policy service + deterministic EE decision spy | PC missing Allow prevents EE call; current EE ALLOW/DENY intersects PC policy |
| API restart | Two actual API subprocess starts + Bundle epoch tests | Different generation, old Connector cannot become current |
| Runtime malformed response / aggregate DEGRADED | Port unit tests | Stable provider error; raw diagnostic not exported as generic HTTP500; DEGRADED closes all EE ports |
| Frontend unavailable/recovery | Headless Chrome, actual built Vue frontend with synthetic local API fixture | Global outage shown, not empty authorization state; personal entry retained; retry refreshes projects |

Deterministic fake/spy tests prove lifecycle and fencing. Local HTTP tests use real network boundaries with synthetic responses; they are **not real EE business acceptance**. No real model or shared business service was used.

## Commands And Results

Working directory: `E:/shanzi_workspace/process-copilot-harness/product`.

```text
pnpm generate:contracts
pnpm exec vitest run packages/contracts/tests/contracts.test.ts packages/contracts/tests/provider-bundle.test.ts
  2 files, 71 tests passed
pnpm exec vitest run apps/api/tests/ee-provider-bundle.test.ts apps/api/tests/ee-provider-bundle-startup.test.ts apps/api/tests/ee-provider.test.ts
  targeted PASS; final aggregate DEGRADED case also passed in the final full gate
pnpm check
  generated inventory PASS
  dependency boundaries / traceability / compatibility PASS (24 ADR, 66 contracts)
  ESLint PASS
  TypeScript / Vue typecheck PASS
  41 files passed, 7 conditional suites skipped
  260 tests passed, 8 conditional tests skipped (268 total)
  all workspace builds PASS
pnpm exec node apps/web/tests/decoupling-d4a.e2e.mjs
  4 browser compatibility checks PASS, no browser page errors
git diff --check
  PASS
```

Conditional skips require isolated PostgreSQL test variables; no shared/demo database was substituted. Existing D1-D3, Gateway, Runtime, SSTS and MEMORY-01A suites passed. Reports are ignored local evidence, not committed artifacts containing runtime state.

Actual startup smoke: four short-lived actual `main.ts` processes (two unreachable EE starts to check restart epoch, one partial configuration, one standalone), all stores in memory, temporary task-owned blob/materialization directories, loopback-only random API ports. EE and Runtime targets use a dynamically allocated then closed loopback port; the test explicitly verifies ECONNREFUSED rather than using fetch's forbidden-port list. No business endpoint or shared DB was contacted. Every process returned `/health` and `/ready` HTTP200 with Core configured and personal Workbench available; EE remained unavailable/unconfigured. The unreachable retry returned a stable non-500 provider error. All child processes and local HTTP fixtures were stopped in `finally`; no Docker container was started.

Final full-gate log: `reports/decoupling-d4a/final-check-20261120-closed-loopback.log` (17:11:55 test start, exit 0). Directed real closed-port smoke: `reports/decoupling-d4a/closed-loopback-startup-20261120.log` (6 passed). Earlier gate logs remain historical evidence before the final aggregate guard/closed-port smoke refinement.
Final browser evidence: `reports/decoupling-d4a/2026-11-20T08-01-53-013Z/`:
`result.json`, `unavailable-home.png`, `unavailable-project.png`, `personal-entry.png`.
Screenshots were visually inspected. Earlier runs remain as historical task evidence; the final paths identify the passing source.

Final source hygiene: `git diff --check` passed; 35 task files were scanned for high-confidence API-token/private-key patterns with zero findings, and credential-looking literals were reviewed as synthetic test/negative fixtures. This is a scoped source scan, not a claim of a production security audit. W0 JSON parsed and all seven path-valued entries existed; the historical snapshot digest matched the starting value. Remote main was rechecked read-only and remained at the D3 baseline.

## Limits And Stop

- Single API process, aggregate lifecycle only. No persisted Health, cross-instance coordination or port-level independent degradation.
- Failed assembly may leave inactive immutable Tool/Profile/Connector records. No cleanup or schema migration was added.
- No trusted mixed Operation Resolver, revocation fan-out, full administrative retry operation/UI or independent fault acceptance.
- No production IAM, second business Provider, MEMORY-01B, EE/DSH/schema/production configuration changes.
- No Docker/demo-stack action, existing-port change, database connection, push or deployment.
- A local implementation commit is authorized after validation. Its hash is reported by Git and the workspace HANDOFF, avoiding a self-referential hash in this committed document.
- D4B (D4-2 through D4-6) remains NOT STARTED and requires a new explicit task. No automatic continuation.
