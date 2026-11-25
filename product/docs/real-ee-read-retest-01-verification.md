# REAL-EE-READ-RETEST-01: Harness Provider-backed real integration

The current real Provider under test is EE. The task name describes the
company-level Harness acceptance goal rather than making EE the product
boundary. The retained fixture and evidence directory keep their historical
`real-ee-read-retest-01` names for traceability.

## Current Result

Status: **DEVELOPER HARDENED REAL RERUN PASS / A1 DATA ISOLATION AND DENIAL
AUDIT PASS / REMAINING ADVERSARIAL MATRIX PENDING**.
The isolated Provider-backed candidate passed the hardened 19-check browser run
`browser-2026-11-25T04-46-11-416Z`: real EE projection, authorization, account
isolation, MCP READ execution, revocation and the EE-outage personal model turn
all passed at the required viewports. The final turn returned HTTP 200 and the
exact assistant result `42`; the durable conversation grew from zero to exactly
one user and one assistant message with visible sequences 1 and 2, and the same
assistant message ID, role and content appeared once in the DOM while both EE
API and MCP were confirmed stopped. This is developer evidence, not independent
acceptance, production readiness or complete RCI-03 adversarial acceptance.

The first bounded adversarial scenario, A1 current-generation cross-Principal
result access, subsequently passed at developer level. It proved data isolation
and no Provider redispatch, but found that this API-level scope denial is not
recorded as a Gateway `RESULT_DELIVERY_DENIED` audit. That denial-audit gap is
preserved in the first A1 report. A short remediation moved the scope check into
Gateway, retained the same safe 403 and added one minimal denial audit. The
second real A1 run passed; A1 is still not full adversarial or independent
acceptance.

## Short remediation after independent review

Status: **FIXTURE AND CONVERSATION PROJECTION REMEDIATION COMPLETE / HARDENED REAL RERUN PASS**.

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
- The real fixture now confirms EE API/MCP are stopped and binds the offline
  model turn to one successful `POST /turns`, one new durable assistant message
  and the same role-specific DOM message. The prompt no longer contains the
  expected answer. It checks visibility rather than mere DOM retention when
  clearing detail UI and refreshes short-lived Provider evidence before long
  project operations. No online model control turn is claimed.
- The hardened rerun exposed an internal DSH Runtime-context snapshot projected
  as a visible user message. PC now excludes structured
  `data.source.kind=runtime-context` events only in the conversation read
  projection and assigns dense visible message sequence numbers. Immutable DSH
  events, event cursors and Runtime authority remain unchanged. The focused DSH
  bridge and Runtime tests passed 21/21 before the real rerun.
- Model credentials now come only from an explicit `DEEPSEEK_API_KEY` process
  variable or the dedicated `refs.DEEPSEEK_API_KEY` entry. The unrelated DSH
  browser-session credential is no longer injected into a model Runtime. The
  earlier dedicated local key returned HTTP 401 and remains recorded as a
  historical failure. A process-only compatible endpoint and
  `deepseek-v4.1-flash-1017` configuration passed direct connectivity and the
  historical model-backed outage run; no credential value was written to source,
  `.env`, reports or DSH configuration. The runner now removes every validated
  task-owned dynamic Runtime container without deleting its state volume and
  recreates both stopped Runtime templates with placeholders. Postconditions
  verify template state/configuration and retained volume fingerprints without
  logging credential values.
- The navigation/form failure was a fixture defect. The fixture refreshed the
  Provider after creating a task, making that task old-generation, then selected
  tabs by position and silently continued when the intended Tool was absent. It
  now creates the MCP task under the current generation, selects tabs and
  `ee.list_functions` semantically, and requires an enabled submit action. The
  result-delivery authorization policy was not loosened.
- The historical rerun `browser-2026-11-25T01-16-23-010Z` reported all 19 checks
  passing:
  personal-only, zero-capability, administrator, generic Provider, engineer and
  reviewer stages at 1440 and 390 pixels; current project projection;
  revocation; real `ee.list_functions` dispatch; a SUCCEEDED Business Operation
  and EE Trace; and an existing personal conversation completing while EE was
  offline. Its model assertion is not sufficient automated evidence after the
  independent review, so this run is retained as historical evidence and does
  not close the hardened rerun. The fixture waits for EE API/MCP health during
  recovery so a successful business run is not misclassified by cleanup timing.
- The current hardened rerun `browser-2026-11-25T04-46-11-416Z` recorded
  `PASS`, 19 checks, zero page errors and all four model assertions:
  `turn_known_success`, `new_assistant_projection`, `dom_role_bound` and
  `no_ui_error`. Earlier TTL, form timing and conversation-projection failures
  remain preserved under the same reports directory.

The current candidate uses Compose project `pc-real-ee-read-retest-01`,
loopback ports 18890-18893, task-owned PostgreSQL/MySQL/Runtime volumes and a
read-only mount of the pre-existing dev09a EE source. Existing schema
initializers ran only on the new isolated databases; no schema source, shared
database, `.env`, EE code or DSH Core was changed. The successful model
credential was process-only and is not recorded here.

### Real results

- Real EE MySQL, API and MCP and the current PC API/Gateway were used; the EE
  authorization and business responses were not replaced with mocks. The
  hardened browser run `browser-2026-11-25T04-46-11-416Z` recorded `PASS`,
  19 checks and no page errors. The expected EE project-discovery 503 while EE
  was intentionally stopped was retained.
- Task-owned direct PostgreSQL readback found 28 `READ` operations `SUCCEEDED`, each
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
- `reports/rci-03-real-ee-adversarial-01/a1-2026-11-25T05-24-34-142Z/result.json`
  records a new current-generation real `ee.list_functions` READ. Its owner
  received 200; the reviewer received 403
  `PC_GATEWAY_OPERATION_SCOPE_DENIED` with no business-result field. C24 stayed
  `COMPLETED/KNOWN_SUCCESS`, C28 stayed `SUCCEEDED`, exactly one verified event
  existed, the generation did not change and Gateway operation count stayed
  692 across both result reads. The denial left the operation's Gateway audit
  count at 6 and produced zero `RESULT_DELIVERY_DENIED` entries. Therefore A1
  data isolation passed while exposing the denial-audit defect.
- `reports/rci-03-real-ee-adversarial-01/a1-2026-11-25T06-03-51-250Z/result.json`
  is the final post-remediation real rerun. Owner/cross-Principal statuses remained
  200/403, C24 and C28 remained terminal, the verified-event count remained one,
  and result reads did not increase the Provider operation count of 694. The
  denial audit count increased exactly from 6 to 7, with one
  `RESULT_DELIVERY_DENIED`; the denied response still contained no business
  result or audit-backend state. Its boundary is
  `DATA_ISOLATION_PASS_WITH_DENIAL_AUDIT`.
- With EE API/MCP stopped, an existing EE-linked PC Session and personal task
  list returned 200, while EE project discovery returned 503. After EE health
  recovered and an explicitly granted administrator retried the Provider,
  current authorized project discovery returned 200. In the hardened rerun, the
  existing personal conversation produced exactly one durable assistant `42`
  while EE API/MCP were stopped, and the Provider recovered afterward. The
  request, outage and recovery evidence closes the developer hardened RCI-02
  model path. Earlier HTTP 401 and fixture failures remain historical evidence.
- The earlier post-regeneration failure in
  `browser-2026-11-24T03-02-20-138Z/failure.json` was reproduced as a fixture
  sequencing defect, not a demonstrated product defect. Old-generation result
  delivery remains correctly denied. A fresh current-generation task retained
  its Tool surface and completed the real MCP operation in the corrected rerun;
  no product authorization behavior was changed.

### Verification and remaining work

The hardened fixture passed `node --check`, Python compilation, targeted ESLint,
`git diff --check` and the complete post-remediation `product/pnpm check`: 57
test files and 640 tests passed, 10 conditional suites and 17 tests remained
skipped, and architecture, 25 ADR / 69 contract traceability, generated
artifacts, compatibility, lint, typecheck and all builds passed. The updated
`stop` path also ran successfully: zero dynamic Runtime containers remained,
both templates were recreated stopped with placeholder model configuration,
eight Compose volumes and three task-labelled Runtime state volumes remained,
and credential scans found zero exact file/container matches and zero key-shaped
matches in the changed, generated and final result files. The
protected vertical-demo project continued running. The browser run adds
Provider outage, account, project, MCP and Trace evidence; the hardened model
turn is now closed at developer level. Binding-invalid/unknown faults,
in-flight reload and the remaining Trace/result tampering cases remain open.
The current-generation cross-Principal data-isolation and API denial-audit check
are complete. Test-only browser results and all
failed attempts are retained under
`product/reports/real-ee-read-retest-01/`; none is independent acceptance.

The source worktree contains the accumulated hardened rerun, A1 fixture,
short-remediation implementation, tests and status-document changes. No local commit was
made; no push or deployment occurred. Test resources are stopped at closure,
with task-owned volumes, databases and evidence retained. Container metadata
scrubbing does not claim that retained Runtime state volumes contain no secret;
no state volume is deleted by this fixture.

After the A1 denial-audit short remediation, the complete gate passed again with
57 test files and 641 tests passing, 10 conditional suites and 17 tests skipped;
lint, typecheck, builds, generated artifacts and architecture checks passed.

### Current bounded status

```text
RCI-02 REAL OUTAGE PATH: DEVELOPER HARDENED REAL RERUN PASS
RCI-03 REAL READ PROJECTION: DEVELOPER TARGETED PASS
RCI-03 A1 CURRENT-GENERATION CROSS-PRINCIPAL: DATA ISOLATION AND DENIAL AUDIT PASS
FULL ADVERSARIAL MATRIX: INCOMPLETE
INDEPENDENT ACCEPTANCE: NOT RUN
T3 / D4B: NOT STARTED
NO PRODUCTION READINESS CLAIM
```

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
