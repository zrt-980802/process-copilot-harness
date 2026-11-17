# DEV-08 Event, Business State and Recovery Verification

- Date: 2026-11-10
- Implementation commit: `85f974c`
- Scope: ADR-0003, ADR-0011, ADR-0012; C24-C30
- Environment: local isolated Docker only
- Remote deployment: not performed
- Remote Git push: not performed

## Delivered boundary

DEV-08 provides:

- strict versioned Event Envelopes with tenant, Principal, stream and
  correlation coordinates;
- durable Memory and PostgreSQL Event Inbox authorities;
- producer/event deduplication, per-stream ordering, gap detection, pending
  drain, late-event rejection and sequence-conflict quarantine;
- Runtime authority checks for Epoch, Assignment Generation and Fencing;
- BusinessTask and BusinessOperation state machines with aggregate revision
  compare-and-set;
- provider success separated from verified business success;
- deterministic Projection rebuild and persisted Checkpoint digests;
- RecoveryCase classification for replay, retry, reconciliation, manual
  handling, approval wait and Runtime migration;
- Gateway event publication into BusinessOperation projections;
- Outcome Unknown reconciliation without replaying external writes;
- authenticated Event ingestion and Business Task, Operation and Recovery APIs;
- Runtime HTTP event export with persisted-prefix retry and Session-local
  sequence numbers.

Projection rebuild replays only persisted facts. It does not call the LLM or
dispatch a Tool again.

## Automated verification

Final `pnpm check` result:

```text
Architecture dependency boundaries passed
Traceability passed for 17 ADRs and 42 contracts
Compatibility baseline assertions passed
22 test files passed, 5 PostgreSQL-conditioned files skipped
123 tests passed, 5 skipped
lint, typecheck and all package builds passed
```

Focused DEV-08 coverage includes:

- immutable duplicate convergence and event ID conflicts;
- out-of-order pending state, gap repair and Projection completeness;
- reused sequence quarantine and stale Runtime authority;
- Task and Operation transition guards;
- `provider success -> VERIFYING -> explicit verification -> SUCCEEDED`;
- deterministic rebuild with technical events attached to a BusinessTask;
- Gateway Approval, dispatch, Outcome Unknown and reconciliation events;
- durable Approval wait and Runtime migration recovery;
- Runtime exporter failure followed by Session-prefix replay;
- two-user API isolation and Event ingestion secret authentication.

`postgres-event-projection.test.ts` is opt-in through
`PC_TEST_POSTGRES_URL`. It was executed against a dedicated PostgreSQL 17
container on an internal Docker network and passed:

```text
Inbox, Cursor, Task, Operation, Checkpoint, RecoveryCase and
ReconciliationResult restored across repository reconnects
```

The one-time PostgreSQL test container, network and work volume were removed
after success.

## Isolated Compose evidence

Compose file:

```text
deploy/docker-compose.dev08-local.yml
```

Images:

```text
process-copilot-dev08-local-api:dev08-20261110
  sha256:71dd0f9cf7f0460cc1d20c343f107d9ac18546e3457709b8629636f0b5a7b0d1
process-copilot-dev08-local-runtime-host:dev08-20261110
  sha256:2b2027c624e50122b72a9af3fd7996c508d64a3be05fbefcec33f7f8078fb520
postgres:17-alpine
```

The DEV-08 stack remains available for local acceptance. Its control network
is internal and no host ports are published:

```text
api          3000/tcp
runtime-host 3100/tcp
postgres     5432/tcp
```

Container-internal setup verification completed:

```json
{
  "event_ingest_denied": true,
  "runtime_event_count": 2,
  "gap_repaired": true,
  "duplicate_converged": true,
  "sequence_conflict_quarantined": true,
  "projection_source_event_count": 9,
  "recovery_state": "RECOVERY_PENDING"
}
```

After API restart, and again after API stop plus PostgreSQL restart plus API
container recreation:

```json
{
  "task_state": "RECOVERING",
  "operation_state": "OUTCOME_UNKNOWN",
  "gap_task_state": "RUNNING",
  "recovery_state": "RECOVERY_PENDING",
  "duplicate_runtime_events": 2,
  "rebuild_digest_matches": true
}
```

## Constraints preserved

- no changes or deployment to `192.168.31.95`;
- no connection to shared EE MySQL;
- no host port publication;
- no DSH Core modification;
- no remote Git repository configured or pushed;
- ADR-0018, ADR-0019 and ADR-0020 remain Draft and were not used as DEV-08
  acceptance authority.
