# DEV-06 Resource and Workspace Verification

- Date: 2026-11-10
- Implementation commit: `623b0d9`
- Scope: ADR-0005, ADR-0010, ADR-0012; C17-C20 and C32
- Environment: local isolated Docker only
- Remote deployment: not performed
- Remote Git push: not performed

## Delivered boundary

DEV-06 now provides:

- stable `Resource` identity and immutable `ResourceVersion`;
- compare-and-swap updates for `WORKSPACE_FILE`;
- explicit user, Session, project, task and business-object Binding types;
- immutable `WorkspaceViewSnapshot` whitelists;
- authenticated upload, version, Binding, View, Materialization and lifecycle APIs;
- hash-addressed immutable local Blob storage;
- typed, contained Runtime Materialization roots with opaque public handles;
- active Materialization admission in Runtime Assignment and Guard paths;
- Runtime Host TTL, epoch, handle and directory validation before admission/Turn;
- explicit derived-resource provenance;
- TTL cleanup and resource lifecycle audit entries without full content bodies;
- Memory and PostgreSQL repositories.

Stable API and Contract responses do not expose `internal_root`, Blob paths or
server absolute paths.

## Automated verification

Final `pnpm check` result:

```text
Architecture dependency boundaries passed
Traceability passed for 17 ADRs and 42 contracts
Compatibility baseline assertions passed
18 test files passed, 3 PostgreSQL-conditioned files skipped
104 tests passed, 3 skipped
lint, typecheck and all package builds passed
```

The focused tests cover:

- two authenticated users cannot read each other's Resource projection;
- Session Binding and WorkspaceView principal/session/tenant isolation;
- project scope fails closed without an authorization provider;
- immutable versions and stale CAS rejection;
- exact derived provenance;
- no full content in resource audit entries;
- path component traversal rejection;
- active Materialization required before Runtime Assignment;
- Runtime Host rejects expired or invalid Materialization coordinates;
- expired roots are removed while immutable Blob content remains.

`postgres-resource.test.ts` is opt-in through `PC_TEST_POSTGRES_URL`. The same
PostgreSQL repository behavior was exercised through the isolated Docker E2E
described below.

## Isolated Docker evidence

Compose file:

```text
deploy/docker-compose.dev06-local.yml
```

Final images:

```text
process-copilot-dev06-local-api:dev06-20261110
process-copilot-dev06-local-runtime-host:dev06-20261110
sm-bench-postgres:16-alpine
```

The local machine used the already-present PostgreSQL 16.14 verification image.
Its custom entrypoint ignores the official `POSTGRES_USER` and `POSTGRES_DB`
variables, so the isolated volume was bootstrapped with a local
`process_copilot` role/database before starting the API. The default Compose
image remains `postgres:17-alpine`.

The stack used an internal Docker network and published no host ports:

```text
api          3000/tcp
runtime-host 3100/tcp
postgres     5432/tcp
```

`docker ps` showed no host-side address or published port for any DEV-06
container.

Setup verification:

```json
{
  "resource_version_id": "rv_4ffd6158-acb2-410b-8f27-3a008c41a75c",
  "content_digest": "sha256:ba5ead5506d9a1dfff56fce5ed819966ef278b4e65d62112ae82e4bcc67a5dd9",
  "first_workspace_view_snapshot_id": "wvs_d9e01608-0465-41be-ba79-558d4d2f749b",
  "first_materialization_id": "mat_07768454-478e-4a92-8d57-35fff90337d5",
  "first_assignment_id": "5b09ed00-1c59-4a9a-a85f-b58330988367"
}
```

The setup flow verified that Assignment is denied with
`PC_RESOURCE_MATERIALIZATION_REQUIRED` before Materialization, then succeeds
after the API and Runtime Host observe the same named-volume root. A separate
one-second Materialization was cleaned successfully.

## Restart and rematerialization

The verification then:

1. stopped the API;
2. restarted PostgreSQL;
3. replaced Runtime Host epoch 1 with epoch 2 and a separate Runtime state
   volume;
4. recreated the API;
5. loaded the same ResourceVersion from PostgreSQL;
6. created a new WorkspaceView for a new Session;
7. rematerialized the exact same immutable version;
8. created a new epoch-2 Assignment.

Recovery result:

```json
{
  "resource_version_id": "rv_4ffd6158-acb2-410b-8f27-3a008c41a75c",
  "content_digest": "sha256:ba5ead5506d9a1dfff56fce5ed819966ef278b4e65d62112ae82e4bcc67a5dd9",
  "recovery_workspace_view_snapshot_id": "wvs_4ebc6918-ed8e-44b0-ad9f-409bf698043a",
  "recovery_materialization_id": "mat_7e6a1bab-4a76-43ec-81be-cca1e8635df9",
  "recovery_assignment_id": "b789100b-dd60-42f5-b625-1dad1acee213",
  "runtime_epoch": 2
}
```

The ResourceVersion ID and digest remained unchanged.

## Symlink cleanup safety

Inside the Linux API container, the verification created an expired
Materialization containing a symlink to a marker outside the Materialization
root. Cleanup removed the expired root without following the link:

```json
{
  "cleanup_state": "CLEANED",
  "outside_marker_preserved": true,
  "expired_root_removed": true
}
```

Final PostgreSQL evidence contained one immutable Resource and version, three
Bindings, three Workspace Views, four Materialization records and ten
resource-lifecycle audit entries.

## Retained local evidence

The DEV-06 containers remain healthy for inspection. Named volumes retain:

- PostgreSQL authority data;
- immutable Blob data;
- Materialization evidence;
- verification state;
- separate Runtime state for epoch 2.

No shared EE MySQL, remote test environment or fixed host port was used.
