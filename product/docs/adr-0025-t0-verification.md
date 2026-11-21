# ADR-0025 T0 Verification

Date: 2026-11-21 (Asia/Shanghai). Status: **T0 COMPLETE / T1 NOT STARTED**.
Repository: `E:/shanzi_workspace/process-copilot-harness`, main.
Baseline: `894c809a0504eb7424274135c30c17824dd5a858`, initially clean.
Remote: `git@github.com:zrt-980802/process-copilot-harness.git` (no push).

## Sequential Work Packages

| Stage | Result |
| --- | --- |
| T0-0 | 66 contracts inventoried; C67-C69 unoccupied; first inventory test failed 1/1, expected 69 vs actual 66 |
| T0-1 | Session/decision/authority/mapping/EE V1/reuse matrices frozen in architecture result |
| T0-2 | C67-C69 source definitions, schema, valid/invalid pairs, generated TS and manifest; repeat generation/check passed |
| T0-3 | Contract package 201 passed / 0 skipped; no runtime imports in new tests |
| T0-4 | ADR-0025 links C67-C69; 25 ADR / 69 contracts; compatibility/no-touch gates passed; status updated only after full validation |
| T0-5 | All required local gates passed; no runtime implementation or real integration claim |

## Contracts And Invariants

- C67 `pc.session-assurance/1`: IDs, auth method/provider/link/evidence expiry,
  identity/authorization revisions, assurance, issue/idle/fixed absolute bounds,
  revocation/state/evidence/digest. Added `pc_absolute_limit_at` makes the PC issue-time
  configured cap auditable. PROVIDER requires link/evidence; LOCAL/STANDALONE forbid them.
- C68 `pc.authority-decision/1`: principal/session/tenant, request/Turn/Tool Call,
  action/resource/authority/mode, PC policy and identity revisions, PC policy/scope
  decisions, Provider registration/generation/mapping/decision/ref/time, result,
  reasons/evidence/time/expiry/digest. ALLOW requires the full intersection;
  DENY receipts may lack unavailable evidence; PC_ONLY forbids Provider evidence.
- C69 `pc.provider-compatibility-mapping/1`: release, registration/type/version,
  exact PC action/authority, permission/action/tool protocol keys, mode, digest,
  state/effective date/supersedes. No endpoints/credentials/roles/membership/Allow cache.
- Digests use canonical recursively sorted JSON, excluding their own digest field,
  UTF-8 SHA-256. ACTIVE mapping mutation requires new release/digest.

Independent semantic oracle exists only under contracts/tests/support; it is not
exported or imported by runtime. These are future contract compatibility proofs,
not implementations of T1/T2 and not real EE integration acceptance.

## Golden Coverage

`packages/contracts/fixtures/adr0025-golden-matrix.json` holds fixed Session,
Decision and Legacy expected outcomes and the exact 16-page V1 baseline. Additional
table-driven tests cover mapping states and each request reuse boundary separately.

- Absolute expiry fixed at issue, earlier source/PC cap, no sliding by observation,
  idle renewal or editing issue-time caps; idle/absolute boundaries and revisions.
  The pure oracle compares the recorded cap against the trusted issue-time PC
  lifetime input; simultaneously forging later evidence and a later cap is denied.
- Source unavailable cannot issue/reauthenticate/renew Provider-backed assurance;
  observation stays bounded; Local/Standalone cannot invent identity links.
- PC_ONLY zero source evidence/call declaration; PC_AND_PROVIDER intersection;
  unknown/missing/ambiguous/expired/revoked/generation mismatch Deny.
- Same-request reuse valid; changed HTTP request, Turn, Tool Call, generation,
  principal/session/tenant/action/resource (including absent Turn/Call) Deny.
- Missing/duplicate/ambiguous/version/authority/registration/tampered/revoked mappings
  Deny; immutable ACTIVE release and fixture-only second-provider separation.
- EE V1 fixed page:* baseline, new page/action/capability exclusion, explicit Deny,
  project membership, object and tool intersection, next-request revocation and zero mutation.
- C01-C66 generated schema/fixture content unchanged, including C41/C42 pinned
  8-table/V1 API/auth-me/audit/page fingerprint and zero migration declarations.

Unexecuted by design: real EE, Docker, Runtime/model, database, browser, source
outage/recovery, migration and production/independent acceptance. T0 does not prove
runtime enforcement. RCI-02 and RCI-03 remain independent **unfixed blockers**.

## Commands And Results

```powershell
cd E:/shanzi_workspace/process-copilot-harness/product
pnpm generate:contracts
pnpm check:generated
pnpm exec vitest run packages/contracts/tests
pnpm check
node scripts/check-adr0025-t0.mjs
git diff --check
```

| Validation | Exact result |
| --- | --- |
| Initial negative inventory | 1 failed / 0 skipped, expected failure before new contracts |
| Final T0 semantic tests | 127 passed / 0 skipped |
| Final whole contract package | 201 passed / 0 skipped, 3 files |
| Final pnpm check | exit 0; 434 passed / 8 skipped, 46 passed files / 7 skipped files |
| Generated inventory/repeat generation | 69 schemas + 69 valid + 69 invalid, no byte drift |
| Architecture | 25 ADR / 69 contracts; dependency, traceability, compatibility passed |
| Lint/typecheck/build | passed across Product |
| Additional new-test typecheck | passed with Vite-compatible ESNext/Bundler module resolution |
| JSON | 209 contract JSON artifacts parsed; changed JSON documents also parsed |
| Sensitive scan | zero findings on task changes; no key/token/credential values added |
| git diff --check | passed |
| Runtime no-touch | 358 immutable files + 198 old contract artifacts unchanged; zero new runtime imports/out-of-scope changes |

The 8 skipped tests are existing conditional PostgreSQL cases (7 files), with no
`PC_TEST_POSTGRES_URL` configured. No database tests were enabled. Initial local
authoring failures (strict schema conditionals and aliased fixture request bindings)
were corrected in contract/test source before the final gate. An optional NodeNext
test compilation exposed the repo's existing Ajv CommonJS interop pattern; the new
test files were verified with the bundler resolution actually used by Vitest.

Final full-gate log (ignored, retained locally):
`product/reports/adr-0025-t0/20261121T155232089/pnpm-check.log`.
Final audit log: the same directory, `final-architecture-audit.log`.
Process and diff/scan evidence: the same directory, `final-worktree-audit.log`.
Logs are not committed and do not replace the checked-in contract fixtures.

## Change Surface And No-Touch

Changed source: contract catalogs, session-authority-contract-definitions.mjs,
generate-contracts.mjs, check-generated.mjs, contracts.test.ts, adr0025-t0.test.ts,
test-only oracle/golden JSON, traceability/compatibility/no-touch scripts and manifests,
T0 architecture/report/index/README/governance status. Generated outputs: only
C67-C69 schema/valid/invalid pairs, appended TS interfaces and contract manifest.
The initial generation checker only regenerated; it now also detects byte drift.

No-touch compares 358 immutable runtime/configuration files and 198 old contract
artifacts against the baseline. Existing Windows CRLF is normalized to LF for Git
comparison; raw checkout digest is separately recorded. No forbidden file is rewritten.

First audit normalized digest: `4f9a4049c1377779566880ab52237f97b69bfaca3240fe651b2d6ca3f420f10f`.
First raw checkout digest: `ba11b7a885bc203727f8e2eff38d05435a2ab985f984befc761b4dc70ef149b6`.

## T1 Gate And Delivery Boundaries

T1 requires a separately authorized task citing C67 fixed bounds, C68 modes/evidence,
C69 immutable release, PC-owned zero Provider calls, live source intersection,
and real expiry/revocation/outage/relogin tests. It is not automatically authorized.

No service/environment/database startup or access is requested by these contract
tests. Existing full unit tests may start their own bounded local fake/loopback
fixtures; those are not real EE/Runtime services. Conditional database tests must
remain skipped with no test database variables configured.

No EE/DSH/schema/.env/runtime/production changes, push or deployment.
One local commit is created after the final checks, containing this report;
its hash is reported in the delivery message (`git log -1` resolves it).
Worktree expected clean after that commit. No automatic T1 execution.
