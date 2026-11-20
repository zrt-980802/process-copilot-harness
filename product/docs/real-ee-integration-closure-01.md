# REAL-EE-INTEGRATION-CLOSURE-01

- Status: **BLOCKED**. Not DEVELOPER VERIFIED.
- Date: 2026-11-20 (Asia/Shanghai).
- Development stopped at the identity/Bundle contract boundary. No offline EE identity fallback was implemented.
- One PC execution-target defect is repaired and verified locally. Two functional gaps and one error-presentation gap remain recorded below.

## Environment And Baseline

PC starts from clean `main@ffd0114f5f2abaa20f0bca251fcb6e402998976c` in
`E:/shanzi_workspace/process-copilot-harness`. Remote remains
`git@github.com:zrt-980802/process-copilot-harness.git`. The only business-source
edit is `packages/gateway/src/service.ts`; regression tests and the isolated
integration fixture/documentation are in this repository. No frontend business
code or provider/identity contract was changed.

EE is the exact workspace.paths.json dev09a tree:
`E:/shanzi_workspace/feishu-ee-agents-dev09a`, HEAD
`494db4ca9ba1dc91436aed7379d54e389776fbc0`. Its pre-existing tracked/untracked
changes are part of the read-only source fingerprint, not attributed to this
task. The historical expectedEeHead field is not treated as current checkout
truth. Final audit confirms byte-identical EE source and status.

Docker Desktop was initially stopped. Starting the engine automatically resumed
11 existing demo containers; no restart/rebuild/stop/database operation was
issued against those containers. The old PC API was already restarting after
engine startup and was recorded without repair. The new candidate has its own
project, networks, images and volumes; no old container is used as a database
or Runtime template. A retained local image is reused as a pinned dependency
base, then current PC bundles/bridge files are built into task-owned images.

| Candidate | Address / database |
| --- | --- |
| Standalone PC | 127.0.0.1:18790, separate `standalone-postgres/pc` and data/Runtime volumes |
| EE-connected PC | 127.0.0.1:18791, `pc-postgres/pc`, its own data/Runtime volumes |
| Real EE API | 127.0.0.1:18792, `ee-mysql/ee_pc_demo`, user `ee_demo` |
| Real EE MCP | 127.0.0.1:18793/mcp, actual official MCP adapter over the same new EE database |

Compose project: `pc-real-ee-closure-01`. Configuration:
`integration/real-ee-closure/compose.yml`. No database host port is exposed.
Source EE mounts are read-only; dotenv loading/bytecode writes are disabled.
Existing EE schema initializers run only against the new guarded database; no
schema source or migration was modified. Credentials are randomly generated
or inherited from the local model credential store in memory, injected at
runtime, and excluded from source, reports and logs.

## Account And Data Matrix

Passwords are intentionally absent. `run.py browser` retrieves this candidate's
runtime secrets in memory. PC fixture grants below are explicit local platform
policy, never copied from an EE Allow result. Real EE login + PKCE ticket
exchange establishes each linked PC identity.

| Account | EE role/permissions | EE memberships | Independent PC project policy |
| --- | --- | --- | --- |
| rc.personal | Native PC identity, no EE configuration | None | Personal owner scope |
| rc.zero | rc_zero, project/requirements/functions/architecture pages | None | No project grants |
| rc.generic | rc_generic, projects page only | RCI-GENERIC reader | Generic-project read actions; EE still removes unsupported tools |
| rc.engineer | rc_engineer, read pages + architecture edit | RCI-ENG, RCI-FULLA editor | Explicit read/generation/conversation actions on those two projects |
| rc.reviewer | rc_reviewer, read pages | RCI-FULLB reviewer | Explicit read actions on FULLB only |
| rc.admin | rc_admin custom role with account-management permission and read pages | None | Explicit read policy on FULLA, still denied by EE membership |

`rc.admin` is an account-management-capable custom role, not a claim that the
built-in system_admin role was independently tested. Four actual projects,
three Requirements, three Functions and two SSTS documents are persisted.
RCI-GENERIC has no engineering data/scene permissions; RCI-ENG has real input
facts but no specification; FULLA/FULLB have distinct documents and memberships.
Revoke/restore uses the actual HarnessStore with revision and audit updates.

## Defects And Boundary

### RCI-01: Wrong Connector After Reload, Repaired

Reproduction: real engineer creates/opens a project task after one or more
Provider retries. Project-data returns HTTP400
`PC_PRINCIPAL_ENVELOPE_AUDIENCE_MISMATCH`; no facts render.
Evidence: `browser-2026-11-20T14-27-31-713Z/failure.json` under the report root.

Cause: each D4A generation has a distinct Connector, while previous immutable
registrations remain ACTIVE. Gateway's tool-only query chooses one historical
registration, potentially differing from the exact signed Envelope target.
The real PostgreSQL query orders by connector_id; memory/fake fixtures had not
enforced target equality and missed this mismatch.

Fix: execution resolves the exact `gateway:<connector_id>` target and validates
its tenant, ACTIVE state and Tool membership before the existing signature,
assignment, PC/source authorization, credential and generation checks. There
is no fallback to another Connector. Existing approval discovery is unchanged;
this is not an Operation Authority Resolver, new Provider or authority-route
change. Wrong-tenant, wrong-Tool and non-Gateway targets fail closed.

Regression first failed on unchanged code (22:31:29), then passed after repair.
The strengthened Gateway suite has 14 passing tests; with D4A lifecycle tests,
49 cases are covered by the final full gate. Real project-data and direct
`ee.list_functions` calls subsequently succeeded through the actual Gateway,
Runtime admission, MCP adapter, MySQL-backed EE authorization and Trace store.
The local fix is reviewable in the task commit; its hash is reported at delivery.
One real read sample is Operation
`tool_6f42f3031b0b987430ae9de15989e9cabc24c8635f2abf7e9d029422519e799a`,
EE Trace `6d08448b-58e0-40da-8620-639470e3bfeb`. Gateway success does not close RCI-03.

### RCI-02: EE Identity Blocks Personal Conversation During Outage, Blocker

Reproduction: log in as rc.engineer; create a personal-scope conversation;
stop only this candidate's EE API/MCP; refresh capability state; send a personal
message. Expected: the PC personal conversation continues while external
business data is hidden. Actual: C65 returns HTTP503
`PC_EE_LOGIN_UNAVAILABLE`; personal task listing, turns and conversation reads
also return HTTP503. The message does not reach the Runtime/model.

Affected task: `ssts_workspace_17afdf8b-5244-4d75-88b9-06445a2cb7fe`.
Evidence: `browser-2026-11-20T14-33-14-423Z/failure.json`,
`connected-personal-during-ee-outage.png`, and redacted PC API logs.

Confirmed cause: `apps/api/src/main.ts` registers mandatory live source-session
validation for `ee:` authentication contexts. `EeProviderBundle.identity.validate`
requires an executable Bundle. Accepted D4A behavior closes all five ports on
failure and explicitly forbids silently turning an EE session into a local
session. With the identity source unreachable, current EE revocation cannot be
revalidated. Offline continuation needs an explicit identity/session policy or
Bundle-boundary decision; disabling validation here would weaken that baseline.
Development stopped rather than changing C61-C66/D4A behavior or caching Allow.

Minimum next decision: define which PC-native authentication context may survive
source failure and its expiry/revocation/reauthentication rules, while external
operations remain fail closed. No such policy or implementation is added here.

### RCI-03: Read Business Operations Stay VERIFYING, Unfixed Blocker

Actual MCP responses carry SUCCEEDED/KNOWN_SUCCESS and real EE Trace IDs, but
the visible Ledger rows and independent PostgreSQL read show **75 VERIFYING**,
2 PLANNED, zero SUCCEEDED Business Operations; Gateway has 75 KNOWN_SUCCESS
records. This is persisted, not just a screenshot taken before a UI refresh.
Final event/projection root cause has not been investigated further after the
contract stop condition. No recovery/compensation or event replay was added.

Evidence: `business-operation-states.jsonl`, `gateway-operation-states.jsonl`
in the baseline evidence directory, plus `real-mcp-trace-1440.png`/`-390.png`.
The initial browser assertion matched SUCCEEDED inside returned JSON and was
too broad. It is corrected to inspect each visible Ledger state's own DOM node.
Earlier checkpoint labels are retained as historical evidence, not terminal
Operation PASS. Independent re-execution now stops on this earlier defect.

### RCI-04: Raw Provider Error In Personal UI, Recorded P2

The failed personal turn renders `EE provider bundle is not executable` in the
ordinary conversation error panel. The app's main unavailable banner is neutral,
but the child error text is not. Recorded without cosmetic repair after the
contract boundary stop. No cross-project payload exposure was observed.

## Real Browser Results

Latest real run: `reports/real-ee-integration-closure-01/browser-2026-11-20T14-33-14-423Z/`.
It uses actual built PC frontend + API + PostgreSQL + Runtime admission and the
specified real EE API/MCP + MySQL. No browser response fixture/interception
substitutes the business dependency.

| State/action | Actual result at 1440 / 390 |
| --- | --- |
| Standalone | Native login, personal-only DOM/navigation/account, zero EE discovery/business calls |
| Zero projects | Real EE login/C65/directory, personal-only UI; no Catalog/project-data/approval fetch |
| Account-management role without membership | Personal-only UI; direct Catalog is HTTP200 with empty Tool Set; project CHAT creation HTTP403 |
| Generic-only permissions | Actual current Catalog filters out SSTS; generic task/project remains visible |
| Engineering without specifications | Actual Requirements/Functions render; no empty EE specification board |
| Full EE/SSTS | Actual spec/section/source label/detail read, input source version 1 |
| Direct tool / Trace | Actual functions MCP result KNOWN_SUCCESS and EE Trace, but Ledger VERIFYING prevents final Operation PASS |
| Revocation | FULLA removed; detail/provider fields disappear; hash/back/reload cannot restore FULLA; remaining ENG stays authorized |
| Different accounts | Reviewer sees FULLB only; FULLA Catalog empty, direct task creation HTTP403 |
| Real EE outage | Old external content clears, but same EE-authenticated personal conversation fails (RCI-02) |
| Recovery | Both isolated EE services restored; explicit retry returns READY; Core/EE/MCP health endpoints HTTP200 |

The run reached 18 recorded checkpoint groups before the outage failure; the
two Ledger-success groups were subsequently found to contain the RCI-03 weak
assertion and must not be counted as full PASS. There is no overall real PASS.
Actual same-context logout/login switching, held real late responses, PC-DENY
with independently EE-ALLOW, a successful model turn and a measured long quiet
network interval remain unexecuted. Synthetic coverage does not fill those gaps.

## Verification And Evidence

From `product/`:

```text
pnpm exec vitest run packages/persistence/tests/gateway.test.ts
  14 passed
pnpm check
  304 passed / 8 database-conditional skipped, 45 files passed / 7 suites skipped
  generated contracts, 24 ADR/66 Contract architecture checks, lint, typecheck, builds passed
node apps/web/tests/frontend-provider-isolation.e2e.mjs
  46 synthetic production-browser groups passed at 1440/390
node apps/web/tests/decoupling-d4a.e2e.mjs
  2 viewport groups passed (6 retry outcomes)
```

Full-gate log:
`reports/real-ee-integration-closure-01/2026-11-20T14-11-39-369Z/partial-fix-pnpm-check.log`.
Synthetic browser results:
`reports/frontend-provider-isolation-01/2026-11-20T14-40-32-186Z/` and
`2026-11-20T14-40-42-377Z/`. Those are regression evidence only.
Conditional PostgreSQL test variables remain unset; real candidate traffic
already uses its own PostgreSQL/MySQL. No shared database is substituted.

Initial EE fixtures had local setup errors (image-ID build syntax, internal-only
network publishing, an invalid seed permission key, Runtime naming mismatch and
an empty model endpoint). Those were corrected in the fixture and are not
claimed as product fixes. Catalog HTTP200/empty is a valid fail-closed discovery
result; the first test's assumed HTTP403 was corrected without changing Product.
All timestamped failed runs remain. No successful model response was produced
or fabricated, and no model output was seeded.

## Isolation, Screenshots And Retest

Evidence root: `reports/real-ee-integration-closure-01/2026-11-20T14-11-39-369Z/`.
`baseline.json` captures initial complete PC/EE file hashes and existing Docker
resources. `isolation-audit.json` confirms unchanged EE source, all 11 protected
container IDs/images/environment hashes/mounts/ports/networks unchanged, and no
task mount sharing an old data volume. Initial actual volume count is **95**;
all 95 remain, with 12 task volumes added (107 total). Historical 92-volume
records are not substituted for this task's observed baseline.

The task has 12 Compose containers, 2 active task-labeled user Runtimes, and 2
stopped preflight Runtime containers retained with their volumes. The preflight
wrong-prefix containers were stopped, and two invalid-endpoint task-only user
containers were recreated without deleting their state volumes. No historical
container, image, cache or volume was cleaned. Exact image IDs/configuration,
selected EE table hashes, all public table hashes in both new PC databases and
redacted logs are indexed in the audit/evidence directory. Hashing emits no row
dumps. The task's initial seed-time full database digest was not captured; the
recorded database digests are final state, not an invented no-drift comparison.
EE's complete 32,561-file digest is
`9734a3ac40eef31b4b7ef6f898735c4e887d86fbb6df9bbf9fa76e58952e0187`;
its git status also matches the initial observation.

Screenshots include personal/zero/generic/engineering/specification/Trace/
revoked/reviewer states at both widths. The developer visually inspected both
specification detail widths, mobile Trace and the outage screenshot; no header
overlap was seen in those views. Successful screenshot captures assert root
width fits the viewport. This is not a blanket visual PASS for the blocked run.

`recovery-final.json` records source restoration and READY at that instant;
`isolation-audit.json` records HTTP200 on 18790/18791/18792/18793. The Bundle's
short TTL still expires without explicit refresh/retry; HTTP200 readiness is not
permanent Provider readiness. Browser/test processes have exited. Candidate
containers remain available for review; no further business execution begins.

Independent reproduction/control instructions are in
`integration/real-ee-closure/README.md`. Credential-free operations/Trace samples
and source hygiene are indexed alongside the audit. The local commit contains
the bounded Gateway repair, fixtures and this **blocked** report, not completion
or release qualification. No push, remote deployment, EE/DSH/schema/.env change,
old Product/EE edit, D4B, MEMORY-01B or second Provider work occurred. Await an
explicit contract/scope decision before continuing remediation.

Final hygiene: `source-hygiene-final.json` scanned 16 source/document files and
34 evidence files against high-confidence credential patterns and the 15 actual
task-runtime secret values: zero findings. `git diff --check` passed; no task
Node/browser/test subprocess remained. Empty preflight logs were handled as
empty input; the earlier scanner diagnostic remains historical. The final Git
hash/tree and built API bundle hash are recorded in `local-commit-receipt.json`
at delivery; no evidence or credentials are committed.
