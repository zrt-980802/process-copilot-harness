# RCI-03 PostgreSQL persistence and restart supplement

Date: 2026-11-23 (Asia/Shanghai).
Original supplement baseline: `main@317de013166f3ded3a684a4e9584de39d15df138`;
the worktree was clean before the supplement was written, not before the later
authorization remediation.

Current closeout: this supplement's five uncommitted test/fixture/document files
were preserved and reviewed by RCI-03-AUTHORIZATION-REMEDIATION-01. They are now
included with the bounded Gateway authorization fix in one local remediation
commit. See `rci-03-authorization-remediation-verification.md` for final results,
scope and independent-retest status. The original run below remains evidence.

**POSTGRES PERSISTENCE / RESTART DEVELOPER VERIFIED**

RCI-03 remains **READ PROJECTION FIXED_PENDING_REAL_RETEST**. This supplement
does not close real EE integration, expand WRITE verification, or start T1B,
RCI-04, T2, T3, D4B or MEMORY-01B.

## Scope and implementation

In the original PostgreSQL supplement, only test sources, a shared test fixture
and verification documents changed.
Production Gateway, verifier, EventProjection, Session, API, Runtime, EE, schema,
configuration and dependencies were unchanged in that supplement. No commit,
push or deployment occurred in that stage. The subsequent authorization fix
changes Gateway result-delivery guards; it does not change database schema.

The original 41-test READ fixture was extracted into
`apps/api/tests/support/read-operation-fixture.ts`. It now accepts repository
injection and a unique operation suffix; its default memory behavior remains.
The PostgreSQL suite uses real PostgresGatewayRepository,
PostgresEventProjectionRepository, ControlledExecutionGatewayService,
EventProjectionService, the production event publisher and ReadOperationVerifier.
Identity/profile/Runtime/Provider Ports remain synthetic fixtures. The database
and restart are real; this is not real EE, Runtime/model or independent acceptance.

## Isolation

The opt-in test creates a unique container, named volume and network with the
`pc.rci03.pg.run` ownership label. Restart/stop verify both the label and exact
mounted volume. No supplied database URL or existing container can become its
restart target. Existing local PostgreSQL 17 image is pinned by image ID;
`--pull=never` prevents fetching a different image. The test initializes only the
existing repositories' unchanged tables in its fresh synthetic database.

- Successful run/container: `rci03-pg-46de8897-cea8-4de8-8fc9-fca955dab928`.
- Volume: `rci03-pg-46de8897-cea8-4de8-8fc9-fca955dab928-data`.
- Network: `rci03-pg-46de8897-cea8-4de8-8fc9-fca955dab928-network`.
- Image: `sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac`.
- Database/user: `rci03`; password generated at runtime and omitted from evidence.
- Binding: 127.0.0.1 only; random task port 60989 before restart, 61005 afterward.
- Existing containers' IDs, image IDs, start times and restart counts were
  compared before/after and were identical. No shared/demo database was queried.
- Only the task container was restarted and then stopped. Its volume, container,
  network and evidence remain available; no old resource was deleted or restarted.

## Actual database restart evidence

The test closes every PostgreSQL pool before restarting its container. It then
rechecks the owned volume and published endpoint and creates fresh repository
and verifier instances, without creating replacement records or dispatching
Provider requests.

- PostgreSQL system identifier before/after: `7711209788546797602`.
- Postmaster before: `2026-11-23T03:52:19.959124+00:00`.
- Postmaster after: `2026-11-23T03:52:24.384181+00:00`.
- Same database identity and mounted volume, with a later postmaster start time,
  prove this was a real database restart rather than a service-object recreation.

Operation prefix:
`rci03-read-rci03-pg-46de8897-cea8-4de8-8fc9-fca955dab928-`.

| Suffix/scenario | Result |
| --- | --- |
| `first` | Persisted C24/C22 success and C28 SUCCEEDED; one Provider dispatch |
| `replay` | Gateway idempotent hit repaired VERIFYING; no second dispatch |
| `dispatched` | Gateway success persisted before VERIFYING publication; after restart recovered through VERIFYING to SUCCEEDED |
| `verifying` | Persisted VERIFYING after Gateway success; fresh post-restart verifier completed SUCCEEDED |
| `pending-event` | Verified event was durable PENDING before restart; the same event was resumed and APPLIED once |
| `concurrent` | Eight independent repository/pool pairs all returned success; exactly one verified event and no quarantine |

All three interrupted Operations retained digest
`sha256:1fd5b2f20debd148493b895630ecc5f07a382b750e26263b684779b255faa704`.
Each has one APPLIED `pc.operation.verified` and Provider dispatch count 1.
Projection rebuild returned identical digest/state/evidence after recovery and
concurrent verification. Repeated verification did not add a second terminal event.
No new MCP dispatch or Provider reconciliation was used for recovery.

## Test Results

| Check | Result |
| --- | --- |
| Dedicated real PostgreSQL suite | 3 passed / 0 skipped |
| Original READ boundary suite after fixture extraction | 41 passed / 0 skipped |
| `product/pnpm check` | 524 passed / 11 skipped; generated/architecture/lint/typecheck/test/build pass |
| T0 compatibility and sensitive scan | 220 protected files, 207 unchanged contract artifacts, 69 contracts; runtime_imports=0; t0_compatibility_drift=0; sensitive_findings=0 |
| Scope, `git diff --check`, task processes and demo health | Recorded in final audit |

Counts overlap. The standard check intentionally does not start Docker: 8 legacy
PostgreSQL conditional tests remain skipped, plus the 3 opt-in tests that were
executed separately above. These are not 11 newly passing tests and do not imply
the legacy PostgreSQL suites were executed in this task.

The first new run had 1 pass / 2 failures because the Docker restart reassigned
its random host port, leaving the test's connection string stale. Evidence and
stopped resources for that failed run are retained:
`rci03-pg-35db380c-9676-4771-a23b-8052621a0039` with `-data`/`-network` suffixes.
The test orchestration now rechecks the task container's loopback binding after
restart and waits for host TCP availability. The successful run observed the
actual port change above. No product fix was needed or made.

## Reproduction and Evidence

Prerequisites: Docker running and local `postgres:17-alpine` image available.
Run from `product/`:

```powershell
$env:PC_RCI03_POSTGRES_TEST = '1'
try {
  pnpm exec vitest run apps/api/tests/postgres-read-operation.test.ts
} finally {
  Remove-Item Env:PC_RCI03_POSTGRES_TEST
}
```

Every run uses unique resources and evidence; it does not overwrite old results.
It stops only its container in teardown and retains its volume and diagnostics.
The opt-in variable is process-local; no `.env` file is used or changed.

Success evidence directory:
`product/reports/rci-03-postgres/rci03-pg-46de8897-cea8-4de8-8fc9-fca955dab928/`.

Key files: `environment.json`, `before-restart.json`, `after-restart.json`,
`concurrent-outcomes.json`, `results.json`, `resources-final.json`, `postgres.log`,
`existing-containers-before.json`, `existing-containers-after.json`, `vitest.log`,
`pnpm-check.log` and final scope/process/health audit. No passwords, connection
strings or database dumps are included.

Historical real EE evidence and its 75 VERIFYING rows were not modified. Real EE
READ retest remains separately authorized work. The original supplement ended
with uncommitted test/document changes; they are included in the current local
authorization-remediation commit rather than discarded or overwritten.

## Authorization-remediation PostgreSQL rerun

The same opt-in suite passed **3 tests / 0 skipped** with the current Gateway
guard and the shared fixture's complete current authorization snapshots.

- Run/container: `rci03-pg-63133012-a99d-44ee-81ae-e4d72ebc8e90`.
- Volume/network: the same run ID with `-data` / `-network` suffixes.
- Image ID: unchanged from the original successful run above.
- System identifier: `7711246372386279458` before and after restart.
- Postmaster start: `2026-11-23T06:14:18.035667+00:00` to
  `2026-11-23T06:14:24.720581+00:00`.
- Loopback port: 60205 to 60227 after restart, refreshed by the test.
- First execution, legal replay, three durable interruption windows and eight
  independent concurrent pools retained the same digest and one verified event;
  each synthetic Provider dispatch count remained 1.
- Before/after snapshots of all existing containers were identical. Only the new
  labeled task container was restarted and stopped. All old resources and
  evidence, including the failed orchestration run, remain retained.
- New container is stopped; its volume, network and evidence are retained.

Evidence: `product/reports/rci-03-postgres/rci03-pg-63133012-a99d-44ee-81ae-e4d72ebc8e90/`.
These persistence tests use the verifier directly in recovery/concurrency cases
to prove durable fact/event behavior. Authorization is separately tested through
Gateway delivery and the manual verify HTTP boundary; this is not a claim of
real EE authorization acceptance.
