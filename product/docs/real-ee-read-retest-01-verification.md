# REAL-EE-READ-RETEST-01: real integration retest

## Current Result

Status: **FAIL**; the complete real integration retest is not closed. The
isolated EE candidate was created after the historical preflight below. Real
EE READ projection and several authorization boundaries passed, while the
required real personal conversation failed both with EE offline and online.
The online control had the same `PC_DSH_AUTH` response. A task-owned persisted
DSH turn-end event records model-provider HTTP 401 and an invalid API key. This
does not establish a successful model conversation.

## Short remediation after independent review

Status: **CODE REMEDIATION COMPLETE / REAL RETEST STILL FAIL**.

- Request-local authorization failures no longer invalidate the complete
  external experience. In particular, an expected
  `PC_GATEWAY_RESULT_DELIVERY_DENIED` for an old generation leaves the current
  project directory and Catalog available. Provider, source identity,
  authority binding, stale authorization evidence and current Workbench
  revocation errors still invalidate the external generation and clear data.
- The shared invalidation classifier is covered by 12 positive/negative cases
  in the authorization presentation test; that file now has 21 passing tests.
  Web typecheck, lint and production build passed. Production browser checks
  passed for D4A at 1440/390 pixels (2 checks) and the Provider-neutral
  experience (46 checks). The complete `pnpm check` gate also passed with 57
  test files passing, 10 conditional suites skipped, 640 tests passing and 17
  tests skipped; ADR/contract traceability, generated checks, compatibility,
  lint, typecheck and all builds passed.
- The real fixture now asserts both the online control turn and the offline
  turn, checks visibility rather than mere DOM retention when clearing detail
  UI, and explicitly refreshes short-lived Provider evidence before long
  project operations. Exchange failures include only their normalized error
  object and never record a successful access token.
- Model credentials now come only from an explicit `DEEPSEEK_API_KEY` process
  variable or the dedicated `refs.DEEPSEEK_API_KEY` entry. The unrelated DSH
  browser-session credential is no longer injected into a model Runtime. The
  current dedicated local key independently returned HTTP 401, so no successful
  model-backed RCI-02 retest was claimed.
- A retained-candidate rerun passed the personal, zero-capability and
  administrator browser stages and continued past the old-result denial into
  the engineer workflow. It later stopped at a fixture navigation/form step;
  this partial run is not a real integration pass and is not counted as RCI-02
  or full RCI-03 closure.

The current candidate uses Compose project `pc-real-ee-read-retest-01`,
loopback ports 18890-18893, task-owned PostgreSQL/MySQL/Runtime volumes and a
read-only mount of the pre-existing dev09a EE source. Existing schema
initializers ran only on the new isolated databases; no schema source, shared
database, `.env`, EE code or DSH Core was changed. The model key was present in
the runtime environment but was rejected by the model provider; no credential
value is recorded here.

### Real results

- Real EE MySQL, API and MCP and the current PC API/Gateway were used; the EE
  authorization and business responses were not replaced with mocks. The
  browser run `browser-2026-11-24T02-49-16-177Z` reached real project data,
  MCP and a visible SUCCEEDED operation before a later revoke UI assertion.
- Independent PostgreSQL readback found 28 `READ` operations `SUCCEEDED`, each
  paired with Gateway `COMPLETED/KNOWN_SUCCESS`. One sample:
  `tool_00d503f395b075f73d710d9ec4703ac103fdabd800727f92aeef6d3acef58537`,
  EE Trace `abecb422-1a70-48d9-ac4a-fab404fe2f67`, verifier
  `pc-read-operation:1.0.0`. This is targeted evidence, not a complete RCI-03
  adversarial acceptance. Eight other operations were `OUTCOME_UNKNOWN` and
  `EXTERNAL_SIDE_EFFECT`, associated with failed personal Runtime turns; they
  are not counted as successful reads or reconciled.
- `outage-fb138ba9-cf1e-4e2c-b4c8-f38f56ba8a33/result.json` records direct
  EE project access 200 for a new synthetic account while PC project task
  creation was 403; unauthenticated project access was 401; a forged ordinary
  user provider-management request and an EE membership denial were 403.
- The engineer's personal workspace was 403 to a reviewer. An old-generation
  persisted result was 403 to its owner and 403 to another principal; Gateway
  operation count stayed 28 before and after these result requests. This did
  not exercise every binding, Trace or result tampering case with real EE.
- With EE API/MCP stopped, an existing EE-linked PC Session and personal task
  list returned 200, while EE project discovery returned 503. After EE health
  recovered and an explicitly granted administrator retried the Provider,
  current authorized project discovery returned 200. The real personal turn
  returned `PC_DSH_AUTH`/503 both offline and after recovery. The associated
  DSH turn-end event reports model-provider HTTP 401 and an invalid key; full
  RCI-02 is therefore NOT VERIFIED.
- A separate user-visible issue was observed after Provider regeneration:
  loading an old task's execution returns `PC_GATEWAY_RESULT_DELIVERY_DENIED`
  and the home page invalidates the shared project experience even though
  current project discovery succeeded. Evidence:
  `browser-2026-11-24T03-02-20-138Z/failure.json`. The denial of the old
  result itself is expected; the broader UI consequence needs focused review
  and a safe fix that also clears data on real source revocation. No product
  behavior was changed in this retest.

### Verification and remaining work

`product/pnpm check` passed after the fixture changes, including architecture,
generated-contract, lint, typecheck, tests and builds; its conditional skips
remain skips. `pnpm lint` separately passed. The earlier preflight run reported
628 passed / 17 conditional skips. Real model success, binding-invalid/unknown
faults, all Trace/result tampering cases, and the full multi-account matrix
remain open. Test-only browser results and all failed attempts are retained
under `product/reports/real-ee-read-retest-01/`; none is independent acceptance.

The source worktree contains the roadmap correction, this report and a new
isolated test fixture. No product implementation change or local commit was
made; no push or deployment occurred. Test resources are stopped at closure,
with task-owned volumes, databases and evidence retained.

## Historical Preflight

Date: 2026-11-24 (Asia/Shanghai). Historical status: **EXTERNAL_BLOCKED at W0**.
The real EE retest was not executed; this is not integration acceptance or a
production readiness claim. The missing prerequisite is a ready, isolated test
candidate compatible with the current Harness, not a demonstrated EE outage.
Building and verifying a new isolated candidate remains possible and is required
to continue; this report does not establish that the task is infeasible.

## Baseline and preflight

- Harness/Product/Architecture: `E:/shanzi_workspace/process-copilot-harness`,
  `main`, HEAD `d2912f450d2b7ec8574e07c98c5b23db33e5eac6`; clean at entry,
  six commits ahead and zero behind the locally recorded `origin/main`.
- EE: `E:/shanzi_workspace/feishu-ee-agents-dev09a`, branch `dev09a-ee-mcp`,
  HEAD `494db4ca9ba1dc91436aed7379d54e389776fbc0`; existing tracked and
  untracked changes preserved. No EE edit was made.
- Docker is available. The existing `pc-real-ee-closure-01` EE API, MCP,
  MySQL, PC API and PostgreSQL containers are stopped. Their named volumes and
  historical evidence remain in place. Ports 18790-18793 had no listener at
  preflight. The separate running vertical demo was not used.
- The old fixture's README explicitly forbids rerunning `start` or `resume`
  over the retained candidate. Its runtime manager hardcodes that candidate's
  template and labels. Its browser and `seed-pc` retry calls predate the
  authenticated `provider.manage` requirement. They are not a ready retest
  of the current implementation.
- The current PostgreSQL identity initialization loads the C67 migration at
  runtime. The old candidate image and its earlier database were not verified
  as a compatible current baseline. A new isolated candidate needs to package
  this existing migration, provision explicitly authorized test principals,
  and use its own runtime manager, ports and data before it can be exercised.

## Execution matrix

| Scope | Status | Evidence and boundary |
| --- | --- | --- |
| W0 environment and repository inventory | Partial | Read-only checks above; no new candidate initialized |
| W1 roadmap correction | Done | T1B completed status no longer appears under unapproved work |
| W2 RCI-02 | NOT RUN | No current real EE outage, recovery or source authorization calls |
| W3 RCI-03 | NOT RUN | No new real MCP operation, Trace or terminal projection evidence |
| W4 authorization and account isolation | NOT RUN | No new real EE account or policy matrix exercised |
| W5 product repair | NOT RUN | No real retest defect established |
| W6 full gate | PASS with skips | `pnpm check`: 628 passed, 17 conditional skips; generated, architecture, lint, typecheck and build passed |

The gate includes synthetic/unit test boundaries and does not prove real EE,
Runtime or model behavior. No new Docker resource was created or started; no
existing container, volume, database, environment file, remote or schema was
modified. No local commit, push or deployment was made. Continue with a fresh,
task-owned isolated candidate and verify its ownership and configuration before
executing the full W2-W4 matrix; preserve all existing fixture data and evidence.
