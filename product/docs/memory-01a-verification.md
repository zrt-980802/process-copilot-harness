# MEMORY-01A Authority and Contract Verification

- Status: `DEVELOPER_VERIFIED / INDEPENDENT_REVIEW_PASS_AFTER_REMEDIATION`
- Date: 2026-11-17 (Asia/Shanghai)
- Scope: MEMORY-01A only
- Base HEAD: `8e3134951ef478c5fb500457f8eda32d136e60c3`
- Worktree: existing Product worktree; pre-existing uncommitted and untracked files preserved
- Commit / push / deployment: not performed
- Independent review: `docs/memory-01a-independent-review.md`

The independent review found and remediated an exact-result idempotency defect
affecting Revoke and replay after later state changes. The original developer
verification below is retained as the pre-review record; the independent
report is the current closure result.

## 1. Delivered

### Contract baseline

- Extended the generated inventory from C01-C42 to C01-C60.
- C43-C60 are generated from `architecture/memory-contract-catalog-v1.md`.
- Added strict Memory enums, nested schemas, valid fixtures, missing-required-field invalid fixtures and generated TypeScript interfaces.
- C51 requires `temporal_role` and the full authorized item shape.
- C52 rejects undeclared Tool/Capability fields and only accepts typed, untrusted Memory Context items.
- Traceability now validates ADR-0001 through ADR-0023 and C01 through C60.

### Memory Domain

Added independent `@pc/memory` ownership for:

- Memory Object and Revision states;
- SourceEvidence and immutable content digests;
- Capture, Revise and Revoke commands;
- server-derived Personal owner/scope;
- mandatory current-authorization Port;
- idempotency payload semantics and CAS inputs;
- deterministic secret rejection;
- C58 Policy Decision and C54 Authority Event creation.

Automatic capture can only create `CANDIDATE`. Only explicit owner save can create a `CONFIRMED` Personal Memory in 01A.

### PostgreSQL Authority

Added versioned migration `0001_memory_authority.sql` and `PostgresMemoryAuthorityRepository` for:

- `pc_memory_object`;
- `pc_memory_revision`;
- `pc_memory_source_evidence` and Revision/Evidence links;
- `pc_memory_command` idempotency ledger;
- `pc_memory_policy_decision`;
- `pc_memory_authority_event` Outbox;
- migration version and digest verification.

Capture, Revise and Revoke write Object, Revision, Evidence, Policy, Command Result and C54 Outbox in one PostgreSQL transaction. Revise/Revoke lock the Object and enforce Object Version plus current Revision CAS.

## 2. Security invariants verified

- Object State and Revision State are separate.
- Client owner or Personal scope forgery is rejected.
- Project/System kinds are not enabled by the Personal MVP.
- Missing SourceEvidence is rejected.
- Secret-like values, password fields and private keys are rejected before persistence.
- Current authorization is mandatory for capture, read, revise and revoke.
- Denied or stale AuthorizationRevision fails closed.
- Cross-user direct read returns the same not-found result.
- Same idempotency key plus same payload replays the first result.
- Same idempotency key plus different payload is rejected.
- Competing Revision CAS allows exactly one winner.
- Revoke sets Object to `REVOKED` and current Revision to `WITHDRAWN`.
- Revoke response contains tombstone metadata only; revoked content is not returned by the Service.
- C54 Outbox uses one event per Object Version and deterministic producer sequence.

## 3. Verification executed

### Generated Contract and architecture gates

```text
60/60 generated schemas
60/60 valid fixtures accepted
60/60 missing-required-field fixtures rejected
ADR-0001..ADR-0023 traceability passed
C01..C60 traceability passed
Architecture dependency boundaries passed
Compatibility baseline passed
```

### Domain and repository tests

```text
Memory Domain: 8 passed
Contract package targeted run: 63 passed
Fresh PostgreSQL 17 Memory Authority run: 1 passed
```

The PostgreSQL test uses a new temporary `postgres:17-alpine` container with a random loopback port and no named volume. It verifies migration/restart, capture replay, idempotency conflict, concurrent Revise CAS, cross-user denial, Revoke, withdrawn content denial and ordered C54 events. The container is stopped and automatically removed after each run.

### Full Product gate

```text
pnpm check
  check:generated: pass
  check:architecture: pass
  lint: pass
  typecheck: pass
  test: 210 passed / 8 conditional skipped
  build: pass
```

The full gate result is developer verification. It is not independent acceptance.

## 4. Deliberately not implemented

- no browser or public Memory HTTP API;
- no conversation “remember this” intent integration;
- no AuthorizedMemoryQuery/C51 runtime service;
- no PostgreSQL lexical projection;
- no C52 Runtime Context dispatch;
- no C53 Usage, C59 Exposure or C60 Session Rotation implementation;
- no Memory management UI;
- no automatic Candidate extraction model;
- no PersonalMemoryEval machine-readable fixtures or B0-B3 runs;
- no Mem0, OpenViking, Graphiti, vector or graph Provider;
- no real employee history or production data;
- no DSH Core, EE schema, shared database, port or production configuration change.

## 5. MEMORY-01B handoff

01B must begin with an explicit authorization adapter and published `memory.*` action policy. It must not add an implicit allow to the existing identity service.

Recommended order:

1. wire trusted identity/current AuthorizationRevision to `MemoryAuthorizationPort`;
2. add explicit-save conversation intent and C45 Evidence adapter;
3. implement C50-C51 Authorized Query with Source Revalidation;
4. implement PostgreSQL lexical projection and readback;
5. add C52/C53 Context and Usage;
6. add C59/C60 Exposure, Fencing and `FRESH_SESSION_NO_REPLAY`;
7. run cross-session, revoke and restart acceptance before any UI expansion.

MEMORY-01B remains on hold until this report receives independent review or an explicit owner decision to proceed.
