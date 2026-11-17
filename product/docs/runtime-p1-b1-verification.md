# Runtime P1-B1 Verification

- Date: 2026-11-10
- Scope: P1-B first slice
- DSH: `0.2.1-rc.3` at `1f81c047fc48fa190a683e469daa699857e9afe8`
- Runtime image:
  `process-copilot-p1a-local-runtime-host:p1b1-20261110-0115`
- Runtime image digest:
  `sha256:e4cf42bd68d4e12c71f16bc3e82f2da23c5ca9834f3e7897d34b899fa7899d60`

## ADR Trace

This slice implements part of:

- ADR-0002: stale Runtime epoch, Assignment generation and fencing remain
  rejected before DSH dispatch.
- ADR-0004: the control endpoint is loopback-only, secret-authenticated,
  mode `0600`, and stale endpoint descriptors are removed at startup.
- ADR-0006: the stock SDK stdio channel remains isolated from a versioned PC
  Runtime Bridge control channel.
- Runtime Walking Skeleton Research v1, P1-B: handshake, Session flush,
  exact-Session cancel and Session event history are available.

## Implemented

- `pc.bridge/handshake`
- `pc.bridge/session.flush`
- `pc.bridge/session.cancel`
- `pc.bridge/session.events`
- Runtime commands `FLUSH_SESSION`, `CANCEL_TURN` and `CATCH_UP_EVENTS`
- `OBSERVED` live events and `DURABLE_DSH` catch-up events
- event identity deduplication
- conflicting DSH sequence rejection
- explicit resume requirement before flush or catch-up after replacement
- stable cancelled-turn result: `KNOWN_FAILURE / PC_DSH_CANCELLED`

## Real Docker Evidence

- Bridge handshake reached `READY` with protocol `1.0`.
- No host ports were published.
- A real model turn returned `P1B1-READY`.
- Flush confirmed a durable prefix through DSH sequence `13`.
- Full catch-up returned 14 durable events and wrote no duplicates.
- Container replacement required `RESUME_SESSION`.
- Resume created DSH sequence `14`; catch-up repaired that one missing event.
- The resulting local event sequence was continuous from `0` through `14`
  with 15 unique event IDs.
- A live turn was cancelled through the side channel. Cancel returned while
  the turn was still running, and the turn closed as
  `KNOWN_FAILURE / PC_DSH_CANCELLED`.
- Stale endpoint files were removed after replacement; only the active
  descriptor remained.

## Automated Verification

`pnpm check` passed:

- generated contract inventory
- architecture, traceability and compatibility checks
- lint
- typecheck
- 8 test files / 68 tests
- full build

Node syntax validation for the bridge plugin and Python bridge compilation also
passed.

## Deliberately Deferred

The following are not claimed by P1-B1:

- `pc.bridge/session.release`
- `REVOKE_SESSION`
- `DRAIN_RUNTIME`
- finalizer aggregation and Cleanup Report
- Tool Guard and Lease refresh

Those operations require the next P1-B teardown/finalizer slice.

## Environment State

The isolated test container and network were removed after verification. The
dedicated evidence volume and local images remain. No remote source repository
was configured or updated, and the Docker workloads on `192.168.31.95` were
not changed.
