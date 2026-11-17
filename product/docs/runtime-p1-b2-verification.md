# Runtime P1-B2 Verification

- Date: 2026-11-10
- Development item: DEV-03
- Scope: P1-B2 Runtime release, revoke, drain and finalizers
- DSH: `0.2.1-rc.3` at `1f81c047fc48fa190a683e469daa699857e9afe8`
- Runtime image:
  `process-copilot-p1a-local-runtime-host:p1b2-20261110-0857`
- Runtime image digest:
  `sha256:8776a5fd669a8c32ad8dfa1d172c25e33b1f8789508983b3320954f0831ca51c`
- Retained evidence volume:
  `process-copilot-p1b2-final-verify-20261110_runtime-data`

## ADR Trace

This slice implements the local Runtime Host portion of:

- ADR-0002: same-generation Lease refresh, Lease expiry rejection and inactive
  Assignment rejection.
- ADR-0003: explicit teardown outcomes and persisted cleanup evidence.
- ADR-0004: Session revoke, Runtime drain, bounded finalizers, Cleanup Report
  aggregation and terminated Runtime tombstones.
- ADR-0006: `pc.bridge/session.release` over the fixed private Bridge without
  modifying DSH Core.

Runtime Registry authority, cross-process Lease ownership and Step/Tool Guard
remain in DEV-04.

## Implemented

- Same-generation `ASSIGN_SESSION` Lease refresh through
  `payload.lease_expires_at`.
- Rejection of expired and inactive Assignments before DSH dispatch.
- `REVOKE_SESSION` with idempotent durable Session release.
- `DRAIN_RUNTIME` with admission closure and Runtime termination.
- Bounded, idempotent finalizers with per-finalizer status and duration.
- Persisted aggregate Cleanup Report with `CLEAN` and `PARTIAL_FAILURE`
  classification.
- Later-finalizer execution after an earlier finalizer fails.
- Persisted `TERMINATED` tombstone that prevents same-Epoch resurrection.
- `pc.bridge/session.release`.

## Session Release Decision

The fixed `sdk-minimal` SDK method switch does not expose `session/close`.
The private Bridge plugin therefore wraps public `ctx.agents.create` and
`ctx.agents.resume`, retains the returned Agent handle, and implements
`pc.bridge/session.release` through the handle's idempotent `dispose()`.

This keeps cancellation, flush and exact Session disposal outside DSH Core.

## Final Image Docker Verification

The source Runtime volume was cloned into a dedicated evidence volume. The
final image was then started:

- with `--network none`;
- without host port publication;
- without source bind mounts;
- with the original Runtime ID and Epoch;
- with five persisted Sessions requiring resume.

Observed results:

- All five Sessions resumed successfully.
- One Session completed `REVOKE_SESSION` with a `CLEAN` five-finalizer report.
- A post-release Turn was rejected with
  `PC_RUNTIME_ASSIGNMENT_NOT_ACTIVE`.
- The remaining four Sessions completed `DRAIN_RUNTIME`.
- The aggregate drain report was `CLEAN`, with 22 finalizers, zero failed or
  timed-out finalizers and `resource_leak: false`.
- Runtime state reached `TERMINATED`.
- All five Assignments reached `RELEASED`.
- Bridge endpoint files were zero after drain.
- DSH/Python child processes were zero after drain; only Runtime Host Node
  remained.

The retained state reports:

```text
Runtime state:       TERMINATED
Bridge state:        CLOSED
Assignments:         5
Released:            5
Drained Sessions:    4
Drain finalizers:    22
Failed finalizers:   0
Cleanup state:       CLEAN
Resource leak:       false
Event files:         5
Bridge files:        0
```

## Tombstone Restart Verification

The final image was restarted against the terminated evidence volume with the
same Runtime ID and Epoch:

- health remained `TERMINATED / CLOSED`;
- DSH remained `NOT_STARTED`;
- no Bridge endpoint file was created;
- only the Runtime Host Node process existed;
- a new Assignment was rejected with `PC_RUNTIME_TERMINATED`.

The verification container was removed after the check. The evidence volume
was retained.

## Automated Verification

`pnpm check` passed:

- 17 ADR traceability entries;
- 42 generated Contract schemas and fixtures;
- architecture, compatibility and dependency checks;
- lint;
- typecheck;
- 8 test files / 73 tests;
- full build.

The tests cover Lease refresh and expiry, idempotent revoke, drain admission
closure, active-work cancellation, partial cleanup failure, later-finalizer
continuation and tombstone restart.

## Environment State

No remote source repository was configured or updated. No Docker workload on
`192.168.31.95` was changed. The local verification published no host ports.
