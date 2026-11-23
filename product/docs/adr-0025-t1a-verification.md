# ADR-0025 T1A Session/source validation verification

Status: **T1A COMPLETE / T1B NOT STARTED / RCI-02 FIXED_PENDING_REAL_RETEST**

Date: 2026-11-23 (Asia/Shanghai).
Task authority: `governance/ADR-0025-T1A-PC-SESSION-SOURCE-VALIDATION-SPLIT-TASK.md`.

## Baseline and scope

- Repository: `E:/shanzi_workspace/process-copilot-harness`, branch `main`.
- Starting HEAD: `3f006592e37db018b07ac953bfbe05f177243fef` (the authorized task-book commit).
- Business/T0 baseline and local `origin/main`: `e594699d67f3f3e24c06fb688a2322ae70730dda`.
- Remote: `git@github.com:zrt-980802/process-copilot-harness.git`; no fetch/push/deploy.
- Starting worktree was clean; the initial red test was the first task change.
- Scope: PC Session local checks, explicit source-validation wiring, unambiguous repository lookup, tests and this report.
- No schema/migration, EE, DSH Core, Runtime protocol, frontend, environment, dependency-version or port configuration changes.

## T1A-0: reproduced RCI-02 before implementation

`apps/api/tests/session-source-split.test.ts` uses the real Identity Authorization,
Profile, Resource, SSTS, Event Projection, Runtime Registry, RuntimeWorkbench and
Fastify server implementations with memory repositories and temporary local files.
It creates an EE-backed PC Session through the existing external sign-in service.
The initial fixture registered the production-equivalent global Session validator
against a non-executable EeProviderBundle. No identity or workbench method was
replaced to bypass the failing boundary.

Before implementation: **4 failed / 0 passed**. GET requests to:

- `/v1/identity/me`
- `/v1/ssts-tasks?scope=personal`
- `/v1/ssts-tasks/:taskId` (stored personal task)
- `/v1/workbench/tasks/:workspaceId/conversation` (personal workspace)

All expected HTTP 200 but returned HTTP 503 with `PC_PROVIDER_UNAVAILABLE`,
`EE provider bundle is not executable`, `retryable: true`. Each hit the global
source-validation hook before its PC handler completed. The fixture retains
source-validation and Provider Port counters; after splitting, all four return
200 and every source counter remains zero. Initial failures are summarized here;
no large red-run log is committed.

## Bearer API classification

All paths below are relative to `/v1`. Classification concerns authority and
network dispatch, not a new IAM model. Existing ownership, tenant, PC policy,
profile, scope, revision and execution guards remain in their respective services.
Before T1A, every route using `authenticate()` indirectly called EE for EE-backed
Sessions; `identity/me` also called the identity Provider a second time.

| Class | Bearer routes | Retained boundary |
| --- | --- | --- |
| PC_ONLY | GET `identity/me`; POST `auth/logout` | Local Session/Principal/link; logout revokes locally. |
| PC_ONLY | POST `profile-assignments`, `profile-resolutions`; GET `effective-profile-snapshots/:id` | PC profile configuration/resolution, no source fetch. |
| PC_ONLY | POST `resources/uploads`, `resources/:id/versions`, `resources/:id/lifecycle`, `resource-bindings`, `workspace-view-snapshots`, `materializations`, `materializations/cleanup`; GET `resources/:id`, `workspace-view-snapshots/:id` | PC resource ownership/view/materialization guards. |
| PC_ONLY | POST/GET `business-tasks`; GET `business-tasks/:id`; POST suffixes `state`, `operations`, `rebuild`; GET `business-operations/:id`; POST suffix `verify` | PC task/ledger metadata and local projection, not dispatch permission. |
| PC_ONLY | POST/GET `recovery-cases`; GET `recovery-cases/:id`; POST suffixes `reconcile`, `migrate` | Existing local Runtime recovery coordination; external Gateway reconciliation has a separate guarded route. |
| PC_ONLY | POST `connectors`, `connectors/:id/state`, `external-account-bindings`, `external-account-bindings/:id/rotate`, `external-account-bindings/:id/revoke` | Existing PC connector/binding management; configuration is not source Allow. |
| PC_ONLY | GET `approvals/:id`, `operations/:id`, `operations/:id/audit`, `mcp-session-bindings/:id` | Owned PC approval/receipt/audit metadata; no external business read or write. |
| PC_ONLY | GET `workbench/capability-availability` | Local health/availability observation, never an authorization decision. |
| Dynamic | POST `authorization/snapshots` | Exact existing AuthorityRouter classifies each action and scope. PC_ONLY uses no source; PC_AND_PROVIDER validates source Session then intersects current source authorization. Unknown/ambiguous routes Deny. |
| PC_ONLY evidence | POST `principal-envelopes` | Locally signs a valid, current PC snapshot bounded by fixed Session expiry. Envelope is execution evidence, not reusable Provider Allow; Gateway still authorizes each execution. |
| Dynamic | POST `workbench/tasks`; GET `ssts-tasks` | Personal creation/list has no source calls. Project creation/mixed listing uses current Provider Ports. Explicit `?scope=personal` always bypasses project lookup. |
| Dynamic | GET `ssts-tasks/:taskId`; POST suffixes `inputs`, `check-inputs`, `messages`, `drafts/generate`, `drafts/:draftId/review`, `archive`; GET `drafts/:draftId/download` | Pre-handler loads the owned stored workspace. Stored `project_code`, not caller assertions, selects current project/policy checks. Personal draft generation does not gain project/tool authority. |
| Dynamic | GET `workbench/tasks/:id/execution`, `conversation`; POST suffixes `turns`, `cancel` | Personal workspace: local ownership/profile/policy only. Project workspace: source Session, directory and current tool authorization through `owned()`/`prepare()`/`reauthorize()`. |
| PC_AND_PROVIDER | GET `workbench/projects`, `workbench/catalog`, `workbench/capability-chain`, `workbench/approvals`; POST `workbench/approvals/:id/decision` | Explicit source Session validation, executable generation, current directory/policy/authorization. Standalone project discovery still returns empty without Provider assembly. |
| PC_AND_PROVIDER | GET `workbench/tasks/:id/project-data`; POST suffixes `tools`, `write-requests`, `approvals/:approvalId/execute`, `operations/:operationId/reconcile` | Stored project, tool set, exact route, current source authorization, active external binding and Gateway guards. A personal workspace cannot acquire external tools via these paths. |
| PC_AND_PROVIDER | POST `approvals`, `approvals/:id/decision`, `gateway/execute`, `operations/:id/reconcile` | Explicit source Session guard; existing approval scope/exact arguments and Gateway request-time authorization/binding guards remain. No new approval action mapping is introduced. |
| DENY_UNKNOWN | Missing/ambiguous authority route; unknown action; invalid scope/binding; non-executable Provider | No PC_ONLY fallback and no historical Allow reuse. |

Not Bearer Session APIs: `/health`, `/ready`, pilot sign-in, EE ticket exchange,
Provider retry, internal EE bindings, internal Runtime tool execution/event ingest,
Runtime registration/state/heartbeat/projection, Session Assignment/lease and
Runtime guard/command APIs. Their existing credentials/protocols are unchanged.
Runtime Assignment lease renewal is not PC login Session renewal. Internal tool
execution still verifies the signed Principal Envelope and invokes Gateway's
current PC/source intersection and external binding checks for each call.

## T1A-1/T1A-2: resulting call boundary

```text
PC-owned Bearer request
  -> authenticate(token)
  -> local token digest / fixed expires_at / revoked_at
  -> active PC Principal
  -> one verified local EE Identity Link for EE-backed Session
  -> existing PC ownership / scope / policy
  -> PC action (no Provider network)

Provider-owned request
  -> authenticateForProvider(token)
  -> authenticate(token), then explicit current source Session validation
  -> existing exact authority route + PC Allow + current Provider Authorization
  -> active execution binding / profile / approval / Gateway guards as applicable
  -> source operation
```

The global `registerSessionValidator` hook is replaced by the explicitly named
`registerProviderSessionValidator`. Source failures are propagated at external
boundaries, not caught and ignored. EE-backed Provider access without a wired
source validator is denied. Memory and PostgreSQL verified-link queries now
return a link only when exactly one verified link exists; PostgreSQL reads at most
two matching rows, without schema changes. Local authentication checks provider,
principal, tenant, verified status and nonempty issuer/subject.

`identity/me` reports the local Principal, `login_provider: eeclaw`, existing
authentication context and fixed expiry for external Sessions. It omits external
`account` details instead of validating EE for display. Local identity behavior is
retained. No EE Session is converted to a Local/Standalone Session.

Snapshot classification and evaluation share the same exact route matcher;
unknown/ambiguous routes cannot select a guessed authority. Current Provider
Allow is never saved by this change. Repeated requests call current source
authorization again. Existing Gateway tool calls continue current authorization
even for idempotent execution results; known-result reconciliation is a receipt,
not permission for a new source write.

## T1A-3: lifecycle and fail-closed evidence

The new boundary suite contains **31 tests**. Port doubles are solely fault
injection/counters and a synthetic Runtime command/query response; they are not
real EE/Runtime/model integration acceptance.

- Identity, personal task list/read, personal task creation, personal Turn and
  persisted-session conversation admission run through real PC services.
  No source validation, identity, directory, authorization, discovery, credential,
  dispatch or reconciliation Port is called. Runtime query spy only accepts the
  synthetic Runtime URL. The Turn reaches real PC command dispatch with START_TURN.
- Multiple identity requests preserve the exact original `expires_at` and context.
  Expiry at the boundary denies. Source proof is also capped at the existing PC
  eight-hour maximum. No rolling expiry or external reissue was added.
- Local sign-out/revoke, inactive Principal, missing/revoked/mismatched link and
  multiple verified links deny without source calls.
- PC_ONLY Snapshot/Envelope issuance stays local. A PC authorization revision
  change invalidates old snapshots/envelopes and appears in new snapshots.
- Eleven external API cases reject during outage, including project list/data,
  catalog, Tool, write request, approved execution, reconciliation and raw Gateway
  and approval routes. Nothing reaches Runtime command or MCP dispatch.
- Existing core-only catalog denial is HTTP 400
  `PC_WORKBENCH_PROJECT_PROVIDER_UNAVAILABLE`; active Bundle/source outages return
  HTTP 503 `PC_PROVIDER_UNAVAILABLE`. Both remain explicit fail-closed errors.
- New ticket exchange and repeated reauthentication attempts return 503 during
  outage. The old local Session remains unchanged; no refresh API exists (404).
- After synthetic source recovery, two requests produce two fresh authorizations;
  the next source Deny is honored. PC Deny still prevents source authorization.
  Explicit source Session validation also runs anew at each external request.
- Standalone credential and personal authorization behavior is unchanged, with
  zero source-validation calls. D3 exact routing and D4A generation/backoff/
  single-flight tests remain green. Existing Gateway scope, binding, credential,
  approval, tool and current authorization tests remain green.

## T1A-4: validation and isolation

Commands executed from `product/`:

| Check | Final result |
| --- | --- |
| 11-file Identity/Application/API/Workbench/Gateway targeted suite | 122 passed, 1 skipped |
| `vitest run packages/contracts/tests/adr0025-t0.test.ts` | 140 passed, 0 skipped |
| `vitest run packages/contracts/tests` | 214 passed, 0 skipped (includes the 140 above) |
| `vitest run apps/api/tests/ee-provider-bundle-startup.test.ts` | 6 passed, 0 skipped |
| `node scripts/check-adr0025-t0.mjs` | 220 protected files, 207 unchanged schema/fixture artifacts, 69 contracts; runtime_imports=0; t0_compatibility_drift=0; sensitive_findings=0 |
| `pnpm check` | 478 passed, 8 skipped; generated/architecture/lint/typecheck/test/build passed |
| `git diff --check`, scope/no-touch audit | Passed; no forbidden files changed |

Counts overlap; do not add the rows. The eight existing PostgreSQL conditional
skips are not passes. No task-specific PostgreSQL Compose was started or safely
available for reuse; persistence/restart integration is not claimed.

The real `main.ts` startup smoke uses memory stores, temporary directories,
`HOST=127.0.0.1`, `PORT=0`, and dynamically allocated refused loopback source ports.
It proves ECONNREFUSED (not the fetch forbidden-port list), HTTP 200 health/ready,
PC Core availability, unavailable project Provider, standalone/partial-config
behavior and fresh restart generation. Child processes and temporary directories
are closed in finally blocks. No real EE, Runtime, model or Docker service was
started. No shared/demo database or forbidden remote address was contacted.

Two existing D4A synthetic URL-credential literals were rewritten with URL API
construction so the sensitive scanner can inspect the now-touched test file;
the URL rejection/digest test intent and scanner rules are unchanged. An initial
full check stopped at this scanner before implementation lint/tests; the final
check passes. One new test initially assumed every unavailable core catalog was
503; it now asserts the existing specific HTTP 400 denial without changing API
semantics. The original four red RCI-02 tests are separate from these corrections.

Local untracked/ignored evidence lives under
`product/reports/adr-0025-t1a/2026-11-23-session-source-split/` (targeted, contracts,
T0, loopback, full-check logs and final no-touch/process audit). Evidence is not
committed. Existing evidence is not overwritten.

## T1A-5: limits and handoff

- RCI-02: fixed at the deterministic PC/source boundary; **pending real EE retest**.
- T1B: **not started**. Complete C67 persistence, Session-bound identity/link and
  authorization revisions, idle expiry and old Session migration are not provided.
- RCI-03 Operation projection and RCI-04 UI copy: **not fixed**.
- T2/C68-C69 runtime authority integration: **not completed**. Existing PC/source
  intersection remains; this is not a new Authority Binding/IAM implementation.
- Cross-instance immediate revocation and final real EE acceptance are not claimed.
- No D4B, MEMORY-01B, second Provider or follow-on task was started.
- No database/schema/data, EE, DSH Core, Runtime protocol, `.env`, production
  settings, existing ports or historical candidate changes. No Docker operations.
- Task test/startup processes are stopped. Only this authorized local commit is
  created; no push, merge or deployment. The final delivery reports its hash and
  confirms a clean worktree; a commit cannot include its own hash in this file.

**T1A COMPLETE / T1B NOT STARTED / RCI-02 FIXED_PENDING_REAL_RETEST**
