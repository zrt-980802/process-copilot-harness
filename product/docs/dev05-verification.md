# DEV-05 Identity, Profile and Capability Verification

- Date: 2026-11-10
- Product code commit: `0039abf`
- EE Claw branch: `runtaozhang`
- EE Claw commit: `5937cf63`
- EE Claw Legacy V1 source baseline:
  `cefa7432f966e17b41c1638e128de652b934fd20`
- API image: `process-copilot-dev05-local-api:20261110`
- API image digest:
  `sha256:bf1ab382472fa1f32864bb740d983b9fd41d17336a74eeb2153e21d5f277b276`
- PostgreSQL verification image: `sm-bench-postgres:16-alpine`
- PostgreSQL version: `16.14`

## ADR Trace

This slice implements the first executable authority path for:

- ADR-0009: fixed Expert Profile Release, assignment, effective resolution and
  immutable EffectiveProfileSnapshot.
- ADR-0010: stable PCPrincipal, verified external identity links,
  Authorization Revision, snapshots and signed Principal Envelopes.
- ADR-0015: EE Claw enterprise role data remains an external authority and
  cannot expand Process Copilot permissions.
- ADR-0016: Tool, Plugin and Profile releases are immutable and digest-bound.
- ADR-0017: Legacy V1 authorization remains zero-migration and request-time
  revocable.

## Product Authority

The product repository now provides:

- independent PCPrincipal identity, without treating EE account ID, Cookie or
  Feishu IDs as the principal;
- startup-provisioned Pilot accounts and durable Pilot sessions;
- verified identity links that reject caller-supplied identity assertions;
- explicit grants, monotonic Authorization Revision, immutable Authorization
  Snapshots and signed Principal Envelopes;
- fixed FO Tool, Plugin and Expert Profile releases;
- Profile assignment, deterministic resolution reports and immutable
  EffectiveProfileSnapshot;
- Runtime admission before DEV-04 Assignment persistence;
- read-only HTTP consumption of EE Claw C41/C42.

The fixed FO seed uses the stable publication timestamp
`2026-11-10T00:00:00.000Z`. This was required after production-container
restart verification exposed that a startup-time timestamp made the fixed
Release ID conflict with its own previously persisted immutable content.

## EE Claw Compatibility

The `runtaozhang` change keeps the existing V1 tables, public APIs, cookies,
`/auth/me`, role creation and registration semantics intact.

- `page:*` expands only to the frozen `BASELINE_PAGE_KEYS_V1`.
- New default-open pages do not become implicitly allowed.
- C41 is exposed only through the internal shared-secret route.
- C42 pins the Legacy V1 source commit and declares zero data migration.
- Unknown project scope fails closed with
  `project_scope_authority_unavailable`.
- Internal Process Copilot routes are excluded from normal authenticated API
  resource mapping because their dedicated service-secret guard is the
  authorization boundary.

## Automated Verification

Product `pnpm check` passed:

- 17 ADR traceability entries;
- 42 generated Contract schemas and fixtures;
- architecture, compatibility and dependency checks;
- lint and typecheck;
- 16 test files passed, 2 PostgreSQL opt-in files skipped;
- 98 tests passed, 2 skipped;
- full build.

The two PostgreSQL opt-in files were then executed inside an isolated Docker
network:

```text
postgres-runtime-registry.test.ts: 1 passed
postgres-identity-profile.test.ts: 1 passed
```

The second test persisted and recovered a Pilot session, explicit Grant,
Profile/Tool/Plugin releases and EffectiveProfileSnapshot. It also re-seeded
the fixed FO release after service restart and verified identical immutable
content.

EE Claw verification:

```text
backend platform_auth + real MySQL scenario: 40 passed
frontend platform-auth permission tests: 6 passed
Python compileall: passed
frontend production build: passed
```

The frontend build retained its existing large-chunk warnings.

## Production API Restart

The production API bundle ran with PostgreSQL-backed Runtime Registry,
Identity and Profile stores. The API:

1. provisioned and signed in a Pilot account;
2. assigned the fixed FO Profile;
3. created an EffectiveProfileSnapshot;
4. restarted against the same PostgreSQL volume;
5. authenticated the original Bearer token;
6. returned the same principal, Authorization Revision, Snapshot ID and
   Snapshot digest.

The retained database evidence volume is:

```text
process-copilot-dev05-postgres-data
```

The API and PostgreSQL containers published no host ports.

## Real C41/C42 HTTP Verification

The real product `HttpEeClawAuthorizationAdapter` called the real EE Flask
adapter backed by an isolated MySQL database:

- C42 returned the pinned source commit and `data_migration_required=false`;
- C41 returned `ALLOW` for `page:architecture` without project scope;
- C41 returned `DENY` with
  `project_scope_authority_unavailable` for `project:EP37`;
- the product retained the C41 authorization digest as evidence.

The Flask verification server used a temporary loopback-assigned port and was
stopped after the test. No fixed local port was added or changed.

## Compose Baseline

`deploy/docker-compose.dev05-local.yml` enables PostgreSQL Runtime Registry,
Identity and Profile stores on one internal Docker network and publishes no
host ports. Copy `deploy/dev05.env.example` to `deploy/dev05.env` and replace
the example secrets before starting it. EE adapter variables remain optional.

The default Compose database image remains `postgres:17-alpine`. The local
verification used the already-present PostgreSQL 16.14 image because the
official PostgreSQL 17 pull did not complete; no existing image tag or running
environment was changed.

## Environment State

- No remote Git repository was configured or pushed.
- No deployment was made to `192.168.31.95`.
- Existing local fixed ports and existing Docker workloads were not changed.
- Verification containers were removed after evidence collection; the
  PostgreSQL evidence volume and local images were retained.
