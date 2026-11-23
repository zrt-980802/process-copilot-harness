# RCI-03 READ Operation Projection verification

Date: 2026-11-23 (Asia/Shanghai).

Current closeout: **RCI-03 AUTHORIZATION REMEDIATION COMPLETE / READY FOR
INDEPENDENT RETEST / REAL EE READ RETEST PENDING**. The original implementation
record below is historical. The authorization bypass discovered in independent
review, preserved PostgreSQL supplement, final scope and current test counts are
recorded in `rci-03-authorization-remediation-verification.md`.
Remediation began at `317de013166f3ded3a684a4e9584de39d15df138` with five
uncommitted PostgreSQL test/fixture/document deliverables; it did not begin with
a clean worktree. They are preserved and included in the remediation commit.

PostgreSQL supplement: the originally unavailable persistence/restart validation
was completed after Docker recovery. See
`rci-03-postgres-restart-verification.md`. The original execution record and its
skip counts below remain historical evidence. Real EE retest is still pending.

```text
RCI-03 READ PROJECTION FIXED_PENDING_REAL_RETEST
WRITE VERIFICATION NOT EXPANDED
T1B / RCI-04 / T2 / T3 NOT STARTED
```

## Baseline and ownership

- Repository: `E:/shanzi_workspace/process-copilot-harness`, branch `main`.
- Implementation baseline: `51c8fd4e0e738d18624cec8f992d90b7fd9028b0`.
- Local `origin/main`: `e594699d67f3f3e24c06fb688a2322ae70730dda`.
- Remote: `git@github.com:zrt-980802/process-copilot-harness.git`; no remote operation.
- Initial user planning changes: README, architecture index, roadmap and untracked
  `governance/RCI-03-READ-OPERATION-PROJECTION-CLOSURE-TASK.md`. Preserved and
  advanced to the task's final developer status, without reverting their content.
- No schema, migrations, EE, DSH Core, Runtime protocol, frontend, environment,
  dependency version or port configuration changes.

## W0: T1A closeout

README, roadmap and architecture index now distinguish T1A COMPLETE and RCI-02
FIXED_PENDING_REAL_RETEST from T1B/T2/T3 implementation. The real EE closure task
has not been declared complete.

`IdentityAuthorizationService.classifyAuthorization()` uses the existing exact
AuthorityRouter matcher for all actions and scopes. Post-turn reauthorization
uses this classification instead of inspecting a `project:` prefix. Unknown,
ambiguous and empty routes Deny before authorization. A PC action on a project
scope is still PC_ONLY when that exact route says so; a Provider action requires
current source validation. Five W0 tests cover personal/project/unknown/ambiguous
and PC action on project scope. The old Workbench conflict-test double was
updated to supply real route classification and a nonempty valid action/scope;
it previously assumed an empty execution authority could complete.

## RCI03-0: red evidence

Before adding the verifier, two tests using real ControlledExecutionGatewayService,
EventProjectionService, memory repositories and the extracted unchanged production
event publisher both failed: first READ execution and idempotent replay.

- Operation: `rci03-read-red-01` (per-test isolated repository).
- C22: SUCCEEDED / KNOWN_SUCCESS.
- C24: COMPLETED / KNOWN_SUCCESS, result persisted.
- C28: actual VERIFYING; expected SUCCEEDED.
- Result digest:
  `sha256:1fd5b2f20debd148493b895630ecc5f07a382b750e26263b684779b255faa704`.
- Provider dispatches: exactly one, including the replay test.
- Initial result: **2 failed / 0 passed**. No direct SUCCEEDED transition helper.

Provider, identity/profile and Runtime Ports in this boundary suite are synthetic
fault/counting fixtures. Fastify, Workbench, Gateway, event publisher, verifier,
event inbox and projections are real implementations. This is not real EE,
Runtime or model acceptance. Initial failures are summarized here rather than
committing large transient logs.

## RCI03-1: durable READ verifier

`ReadOperationVerifier` loads C28 and its BusinessTask through EventProjection,
and C24 plus embedded C22 through the durable Gateway getter. It requires:

1. Exact tenant, Principal, task and operation association, including the C28
   external-record reference; complete task/operation projections.
2. READ in both ledgers; only VERIFYING, an interrupted DISPATCHED predecessor,
   or the same already verified SUCCEEDED fact is eligible.
3. C24 COMPLETED / KNOWN_SUCCESS; C22 SUCCEEDED / KNOWN_SUCCESS, no retry or
   reconciliation flag, supported contract/version and matching operation ID.
4. Recomputed C22 canonical result digest using the same Gateway result sealing
   function. C24 embeds that C22 digest; C28 must match it. No new digest field
   or contract/schema is invented. Stored C24 arguments must rehash to its
   argument digest and match the C28 input digest.
5. Matching Provider operation identity and matching C24/C22 evidence arrays,
   including its stable `eea://traces/<encoded-provider-operation-id>` reference.
   Evidence must use bounded `eea://traces/` or `eea://operations/` references,
   with no URL credentials/query/body. The current EE adapter already produces
   this format; arbitrary evidence strings cannot establish success.
6. C28 result/evidence consistency. An already SUCCEEDED operation must also
   retain the system verifier reference and matching complete verifier cursor.

Failures return `PC_READ_VERIFICATION_*` reason codes, not a Provider outage.
The verifier does not store response bodies, credentials, Provider Allow or new
authorization decisions. Its event contains digest and stable references only.

## RCI03-2: execution and recovery wiring

```text
Direct Gateway HTTP OR internal Runtime Tool HTTP
  -> existing current authorization / assignment / binding / approval guards
  -> ControlledExecutionGatewayService.execute
  -> persist C24 + C22 and existing gateway audit
  -> publish VERIFYING
  -> READ-only verification hook
  -> reread durable C28 / task / C24 / C22
  -> pc.operation.verified (pc-read-verifier, version 1.0.0)
  -> atomic inbox/cursor/projection CAS
  -> C28 SUCCEEDED
```

The shared production publisher is extracted into `gateway-event-publisher.ts`;
`main.ts` uses this same factory as the boundary tests. Both idempotent result
branches (initial lookup and beginOperation race) run the READ hook. No Provider
request is sent to repair a projection. No success handler is added to the UI.

For an interruption after Gateway success but before VERIFYING publication, the
verifier first validates the durable facts and emits a recovery VERIFYING event
from DISPATCHED, then emits verified. It does not jump from PLANNED to success.
For an interruption after the verified event reached Inbox but before projection,
the next verifier resumes the same pending event.

Event identity is deterministic for operation/revision/state/result digest, with
separate verifier/recovery streams. Existing repository transaction/CAS atomically
applies event, projection and cursor. Concurrent service instances can observe
the same winning terminal event without quarantining a duplicate, appending a
conflicting success, or overwriting a later state. A concurrent recovery observer
may observe an already verified result; final digest/evidence/cursor validation
still applies. All changes use existing tables and revision mechanisms.

## RCI03-3: verify API

`POST /v1/business-operations/:operationId/verify` now requests server verification.
Use an absent body or `{}`. Any nonempty body, including legacy `evidence_refs`
or `result_digest`, is rejected with HTTP 403
`PC_READ_VERIFICATION_CLIENT_FACTS_DENIED`. These fields never supply facts.

The API checks active PC Session and local identity link, C28 owner/tenant,
READ kind, explicit source Session validation where applicable, then current
Gateway tool/Connector/account-binding/source authorization before the same
verifier. Reverification does not dispatch MCP or call Provider reconciliation.
Cross-owner/tenant and revoked binding cases return 403. Non-READ returns HTTP400
`PC_READ_VERIFICATION_UNSUPPORTED_KIND` without advancing state. Invalid result
or predecessor states fail closed. The successful response includes operation ID,
before/after state, verifier version, reason codes, digest and safe references;
it excludes the stored business response and credentials.

## RCI03-4: results and limits

The dedicated READ suite has **41 passing tests** covering:

- First execution, both Gateway idempotent branches and stable repeated success.
- Interruptions before VERIFYING, before verified publication, and after verified
  Inbox persistence. Fresh verifier/service instances recover without dispatch.
- Mismatched operation/tenant/Principal/task/kind, result IDs, result/input digests,
  missing records/results/tasks, missing/different Provider evidence/identity and
  in-progress records. Business state remains VERIFYING.
- PLANNED, KNOWN_FAILURE/FAILED and OUTCOME_UNKNOWN rejection. Unknown remains
  in the existing reconciliation workflow.
- Non-READ idempotent records do not invoke the hook. Fresh WRITE, DESTRUCTIVE
  and EXTERNAL_SIDE_EFFECT executions, with required explicit synthetic approvals,
  retain C28 VERIFYING even though Gateway succeeds; verify API rejects them.
- Eight concurrent verifier instances from VERIFYING and DISPATCHED each produce
  one verified event and one terminal state. Projection rebuild preserves the
  same SUCCEEDED state, digest, event identity and evidence.
- Real direct Gateway and Runtime Tool Fastify entries use the same Gateway
  and system verifier. Runtime/Provider Ports are synthetic, not live services.
- Forged verify body, cross Principal, cross tenant and revoked account binding
  rejection; authorized owner response contains no stored business body.

| Verification | Final result |
| --- | --- |
| READ projection suite | 41 passed, 0 skipped |
| W0 exact routing suite | 5 passed, 0 skipped |
| 9-file targeted Gateway/EventProjection/Workbench/T1A/D3/D4A suite | 161 passed, 0 skipped |
| Contracts package (C22/C24/C28/C30 and T0 baseline included) | 214 passed, 0 skipped |
| Closed-port real main.ts startup suite | 6 passed, 0 skipped |
| `pnpm check` | 524 passed, 8 conditional PostgreSQL skips; generated/architecture/lint/typecheck/test/build pass |
| T0 compatibility/sensitive gate | 220 protected files, 207 unchanged contract artifacts, 69 contracts; runtime_imports=0; t0_compatibility_drift=0; sensitive_findings=0 |
| `git diff --check` and scope audit | Pass; no schema/EE/DSH/Runtime protocol/environment changes |

Rows overlap; do not sum counts. Eight conditional PostgreSQL skips are not
passes. No PostgreSQL integration/restart validation was executed: the Docker
Linux engine named pipe was unavailable and there was no reachable task-owned
isolated PostgreSQL instance. Docker status/image-list reads returned the missing
pipe error; no daemon, container, database or shared/demo service was started.
Memory repository reconstruction/CAS tests do not prove database restart safety.
Real EE, real Runtime/model and browser acceptance were not executed. Closed-port
startup uses isolated memory stores and dynamically allocated loopback ports;
its child processes close in finally blocks.

During test development, one API failure-injection double used a ProviderError
where the guard actually throws ControlledGatewayError; it was replaced with
real external-binding revocation. The first full check exposed the old Workbench
test double's missing W0 classification method/empty authority; its fixture now
uses the real classifier and a valid scope. An internal-Tool test also needed a
shared synthetic clock/session reference. Final targeted/full runs pass; none of
these corrections changed production error or authorization semantics.

Evidence directory (ignored, never committed):
`product/reports/rci-03/2026-11-23-read-projection/`.
Contains targeted, contract, loopback and full-check logs plus scope/process
audits. Earlier evidence is preserved; no historical 75-row data was changed.

## RCI03-5: original implementation handoff (historical)

- Local developer verification only. RCI-02 and RCI-03 await real EE READ retest
  under a separately authorized task; REAL-EE-INTEGRATION-CLOSURE-01 is not closed.
- Stable EE Trace evidence is intentionally required by this bounded verifier;
  no second Provider or generic write verification is implemented.
- WRITE/DESTRUCTIVE/EXTERNAL_SIDE_EFFECT still need their existing independent
  readback/C30 path; this task adds no readback, compensation or replay to them.
- T1B, RCI-04, T2, T3, D4B and MEMORY-01B are not started by this task.
- No shared/demo database access, environment changes, Docker mutations, remote
  calls, push, deployment, merge, cleanup or schema migration.
- Task processes are stopped. A single local commit includes the preserved task
  planning changes and bounded implementation; final delivery reports its hash
  and a clean worktree. No automatic next task.
