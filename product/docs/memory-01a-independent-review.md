# MEMORY-01A Independent Review

- Status: `PASS_AFTER_REMEDIATION`
- Date: 2026-11-17 (Asia/Shanghai)
- Scope: MEMORY-01A Authority, Contract and PostgreSQL boundary only
- Base HEAD: `8e3134951ef478c5fb500457f8eda32d136e60c3`
- MEMORY-01B: not started
- Commit, push and deployment: not performed

## 1. Result

MEMORY-01A passes reviewer verification after one idempotency defect was found
and remediated. The accepted boundary contains C43-C60, the independent
`@pc/memory` package, Personal Memory Authority, immutable Revision and
SourceEvidence, mandatory authorization, PostgreSQL persistence, CAS and the
C54 Outbox.

This result does not claim that end-user long-term memory is available. There
is still no public Memory API, conversation intent integration, authorized
query path, Runtime Context injection, Projection, management UI or
PersonalMemoryEval run.

## 2. Finding and remediation

The initial implementation checked the REVOKED state before the repository
could recognize a repeated Revoke command. A successful Revoke therefore
failed when the same idempotency key and payload were retried. The repository
also reconstructed a replay from the latest aggregate, which could return a
later Object Version instead of the original successful command result.

The remediation:

- adds an explicit command replay lookup to the Authority Repository;
- performs replay recognition before mutable lifecycle checks;
- persists the command's Object snapshot and Revision reference;
- reconstructs the original result from that snapshot and immutable Revision;
- preserves current authorization and deadline checks before replay;
- keeps Revoke responses limited to tombstone metadata.

Regression coverage verifies Capture replay after a later Revision, Revision
replay after restart, Revoke replay after Authority has become REVOKED, and a
different payload under the same idempotency key remaining a conflict.

## 3. Fresh verification

The full Product gate passed after remediation:

```text
23 ADR traceability checks passed
60 Contract traceability checks passed
generated Contract inventory passed
architecture boundaries and compatibility passed
lint and typecheck passed
33 test files passed / 7 conditionally skipped
210 tests passed / 8 conditionally skipped
all workspace builds passed
```

A fresh `postgres:17-alpine` container was started on a random loopback-only
port with no named volume. The PostgreSQL test passed migration, restart,
exact-result replay, conflicting-payload rejection, competing Revision CAS,
cross-user denial, Revoke replay, withdrawn-content denial and ordered C54
events. The temporary container was removed after the run.

## 4. Boundary decision

MEMORY-01A is accepted at its defined implementation boundary. MEMORY-01B
remains on hold and requires a separate start decision. The next product-level
direction is source consolidation followed by PC/EE identity and authorization
decoupling; it must not silently expand this Memory acceptance result.
