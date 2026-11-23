# RCI-03 authorization remediation verification

Date: 2026-11-23 (Asia/Shanghai).

```text
RCI-03 AUTHORIZATION REMEDIATION COMPLETE
READY FOR INDEPENDENT RETEST
REAL EE READ RETEST PENDING
T1B / RCI-04 / T2 / T3 NOT STARTED
NO PUSH / NO DEPLOYMENT
```

## Baseline and preserved work

- Repository: `E:/shanzi_workspace/process-copilot-harness`, branch `main`.
- Starting HEAD: `317de013166f3ded3a684a4e9584de39d15df138`.
- Local `origin/main`: `e594699d67f3f3e24c06fb688a2322ae70730dda`;
  initially ahead 3 / behind 0. No fetch or remote mutation.
- Remote: `git@github.com:zrt-980802/process-copilot-harness.git`.
- Five existing uncommitted deliverables were preserved: READ projection test
  fixture extraction, PostgreSQL suite, shared fixture, PostgreSQL report and
  the READ projection report. No reset, checkout, deletion or history cleanup.
- The single remediation commit includes those deliverables plus the bounded
  Gateway fix, security tests and this report. The final response supplies its
  hash and post-commit clean-worktree check; this report does not embed its own
  commit hash. Expected final relation: ahead 4 / behind 0, origin unchanged.

## Reproduction before the fix

Four boundary tests failed against the unmodified Gateway:

1. Revoke binding after persisted success, then replay the same idempotency key.
2. Rotate credentials after persisted success, then replay the old generation.
3. Return the existing result from the beginOperation race after revocation.
4. Revoke binding while a controlled Promise suspends Provider dispatch, then
   release the successful response.

All four incorrectly delivered the business body and produced a verified event:
C22 SUCCEEDED, C24 COMPLETED / KNOWN_SUCCESS, C28 SUCCEEDED, Provider dispatches
1, verified events 1. Initial result: **4 failed / 0 passed**. Initial failures
are preserved locally in `red.log`; no temporary failure log is committed.

## Fix and current authority

Gateway `currentResultDeliveryGuard` is shared by:

- findOperationByIdempotency's persisted-result branch;
- beginOperation's competing-existing-result branch;
- fresh dispatch success after C24/C22 persistence and VERIFYING publication;
- manual READ verification authorization, after the server's existing active
  PC Session, local link, owner/tenant and explicit source Session checks.

Every result branch passes through `deliverPersistedResult`: current guard,
READ-only fact verifier, then a fresh current guard before returning the body.
The second guard reauthorizes after asynchronous verification event IO; it does
not reuse the first Allow. Existing admission, Assignment, effective Profile,
workspace and approval guards remain in place.

The shared guard reads the current published Tool, active exact Connector and
Tool membership, schema and Connector permission scope. It checks current PC
Principal lifecycle and authorization revision through envelope verification,
exact request/Operation/session/task/scope association, current active binding
with tenant/Connector/Principal/identity fields, positive current credential
generation and envelope generation equality. For EE MCP it resolves the current
verified external subject and matches the binding's external account.

The original persisted credential lease must identify the same tenant,
Principal, PC Session, Connector, external account and credential subject. That
lease is an immutable identity association, not current authorization: an old
lease or Operation success is never an Allow. A current valid envelope after
credential rotation can recover the same identity's persisted result without
redispatch; rebinding to a different external account cannot expose it.

The guard calls the current identity/Authority Router evaluation with exact
persisted scopes, required Tool permissions and selected Tool. It requires
current Allow, Principal, revision, allowed actions, scope/Tool-set digests and
nonexpired authorization. The real identity service still intersects PC grants
with the exact current Provider authority route. No source permission is copied
into PC and no Provider Allow is stored or reused across requests.

Missing, unknown, mismatched or failing checks become nonretryable
`PC_GATEWAY_RESULT_DELIVERY_DENIED` (existing API mapping: HTTP 403), with bounded
reason codes and no business response, secret or raw Provider error. A denial
audit references Operation/Connector/Tool only. Audit IO failure still denies
delivery and reports `audit_recorded: false`.

Delivery authorization errors are normalized to ControlledGatewayError, including
when current source evaluation throws GatewayProviderError. They cannot enter
execute's Provider-failure handler and overwrite a real persisted success.

## Security results

New suite: **25 passed / 0 skipped**. The four original failures now deny before
automatic verification. Mandatory outcomes:

| Scenario | C22 | C24 | C28 | dispatches | verified events | delivery |
| --- | --- | --- | --- | --- | --- | --- |
| Revoked binding before persisted replay | SUCCEEDED | COMPLETED / KNOWN_SUCCESS | VERIFYING | 1 | 0 | Denied |
| Old credential generation before replay | SUCCEEDED | COMPLETED / KNOWN_SUCCESS | VERIFYING | 1 | 0 | Denied |
| Binding revoked in flight | SUCCEEDED | COMPLETED / KNOWN_SUCCESS | VERIFYING | 1 | 0 | Denied |
| Revoked binding in beginOperation race | SUCCEEDED | COMPLETED / KNOWN_SUCCESS | VERIFYING | 1 | 0 | Denied |

Additional cases cover in-flight credential rotation and authorized recovery,
current PC/source Deny, revision/expiry/scope/Tool permission changes, external
subject mismatch/missing verified identity, disabled Connector/missing Tool
membership/removed Connector scopes, unpublished Tool, missing or wrong
tenant/Principal/Connector binding, invalid generation, changed external account,
missing envelope generation, current Provider-authority error and safe HTTP 403.
Each denied success retains true C22/C24 facts, C28 VERIFYING, no verified event,
exactly one dispatch and a denial audit without the business body.

The existing 41 READ tests still cover normal first success, legal replay,
crash recovery, concurrent verification, manual /verify authorization, forged
evidence, cross-tenant/Principal rejection, failure/unknown/non-READ exclusion.
WRITE, DESTRUCTIVE and EXTERNAL_SIDE_EFFECT do not gain READ auto-verification.
The verifier remains a durable fact verifier with trusted authorization callers;
its direct unit and PostgreSQL calls do not establish request authorization.

## Verification and evidence

| Check | Result |
| --- | --- |
| New result-authorization tests | 25 passed / 0 skipped |
| READ projection + result authorization + reauthorization route + Gateway persistence boundary | 85 passed / 0 skipped, 4 files |
| Task-owned real PostgreSQL persistence/restart/concurrency | 3 passed / 0 skipped, 1 file |
| `product/pnpm check` | 549 passed / 11 skipped; 50 passing files / 8 skipped files; generated, architecture, lint, typecheck, test, build pass |
| T0 compatibility | 220 protected files / 207 contract artifacts unchanged; 69 contracts; runtime_imports=0; t0_compatibility_drift=0 |
| Final scope / sensitive / whitespace / process audit | 8 intended files; out_of_scope_changes=0; forbidden source/config changes=0; sensitive_findings=0; diff check pass; no task processes |
| Historical Docker resources | Existing-container drift=0; new task PostgreSQL container stopped; all containers/volumes/networks/evidence retained |

Counts overlap; do not sum them. Eight legacy PostgreSQL conditional skips remain
unexecuted; the other three opt-in tests were run separately against real Docker
PostgreSQL. Those skipped cases are not passes. The initial full check stopped
at a test-formatting lint error, fixed before the final complete pass. An earlier
test expansion used an immutable registration put and a recursive spy; both
test setup issues were corrected, with explicit expected denial reasons so a
generic exception cannot satisfy the security assertions. No production
authorization behavior was weakened to accommodate a test.

Evidence (ignored, not committed):

- `product/reports/rci-03-authorization/2026-11-23-remediation-01/`:
  red, targeted, PostgreSQL and full-check logs; final compatibility, scope,
  sensitive-information and process audits.
- `product/reports/rci-03-postgres/rci03-pg-63133012-a99d-44ee-81ae-e4d72ebc8e90/`:
  actual restart identities, endpoint change, concurrent outcomes, retained
  resources and identical existing-container snapshots.
- Previous PostgreSQL evidence and containers/volumes/networks
  `rci03-pg-46de8897-cea8-4de8-8fc9-fca955dab928` and
  `rci03-pg-35db380c-9676-4771-a23b-8052621a0039` remain intact.

Only the newly created, ownership-labeled PostgreSQL task container was restarted
and stopped; its container, volume, network and evidence remain. Generated
database credentials are runtime-only and omitted from evidence. No task server
or child process remains after verification.

## Scope and remaining limits

Final scope: Gateway service, three test sources plus their shared fixture, and
three verification documents (eight files total). No API implementation,
Session/identity implementation, Authority Router, Runtime protocol, frontend,
EE, DSH Core, contracts, schema, migration, .env, ports, versions, production
settings or old worktrees changed. No new dependency, shared/demo database query,
remote call, push, deployment or historical cleanup.

This is local developer verification with synthetic identity/Provider Ports and
real Gateway/EventProjection/HTTP implementations. PostgreSQL persistence and
restart are real. Real EE READ retest, real Runtime/model and browser acceptance
were not executed. Historical real EE data and its 75 VERIFYING rows were not
modified. RCI-02 and RCI-03 still require separately authorized real EE retest.

Authorization checks are fresh request-time observations, not an atomic
transaction spanning external authority, binding storage and event persistence.
They do not implement distributed revocation fan-out, cross-instance authority
coordination or retroactive deletion of earlier verified facts. No such broader
guarantee is claimed. WRITE verification and unknown-outcome reconciliation are
not expanded. T1B, RCI-04, T2, T3, D4B and MEMORY-01B are not started.

Independent retest: run the four-file targeted Vitest command and the opt-in
PostgreSQL command in the supplement, then `pnpm check` from `product/`.
Inspect the three mandatory security scenarios' C22/C24/C28, dispatch and
verified-event assertions. Real EE retest remains a separate task.
