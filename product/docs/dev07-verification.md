# DEV-07 Controlled Gateway, MCP and Durable Approval Verification

- Date: 2026-11-10
- Implementation commit: `06e637e`
- Scope: ADR-0007, ADR-0008, ADR-0010, ADR-0012; C02-C05, C15-C16, C21-C24
- Environment: local isolated Docker only
- Remote deployment: not performed
- Remote Git push: not performed

## Delivered boundary

DEV-07 provides:

- strict Principal Envelope verification with issuer, audience, signature,
  expiry and current Authorization Revision checks;
- immutable Tool risk, approval, idempotency and recovery metadata;
- Connector Registration and per-Principal External Account Binding;
- short-lived Credential Lease references without durable token material;
- MCP Session Binding isolated by tenant, Principal, PC Session, Connector,
  Authorization Revision, Credential Generation and tool catalog digest;
- durable Business Approval with self-approval denial and exact operation,
  argument, target, Tool, Connector and Authorization Revision binding;
- atomic Approval consumption and External Operation creation;
- idempotency conflict detection and duplicate dispatch prevention;
- Controlled Execution Gateway checks for current Assignment, Runtime Epoch,
  Generation, Fencing, Tool Guard, Effective Profile, Workspace View,
  authorization and credential generation;
- Outcome Unknown persistence and explicit reconciliation;
- authenticated management, approval, execution, operation, MCP and audit APIs;
- Memory and PostgreSQL authorities.

The Runtime receives only an opaque Credential Lease reference. The provider
access token exists only inside one dispatch call and is not stored in the
Operation Ledger, MCP Binding, API response or audit payload.

## Automated verification

Final `pnpm check` result:

```text
Architecture dependency boundaries passed
Traceability passed for 17 ADRs and 42 contracts
Compatibility baseline assertions passed
20 test files passed, 4 PostgreSQL-conditioned files skipped
113 tests passed, 4 skipped
lint, typecheck and all package builds passed
```

Focused DEV-07 tests cover:

- Principal Envelope signature tampering and current-revision verification;
- two users and one user's two PC Sessions receiving distinct MCP bindings;
- stale credential generation, hidden Tool, stale schema/recovery metadata and
  Runtime Guard denial;
- Approval self-approval denial, argument mutation rejection and atomic
  `APPROVED -> CONSUMED`;
- completed and concurrent idempotency deduplication;
- same idempotency key with a different request digest;
- Outcome Unknown followed by reconciliation;
- audit persistence failure preventing provider dispatch;
- authenticated API tenant/Principal injection and cross-user denial;
- `secret_ref` and ephemeral token material absence from public and durable
  evidence.

`postgres-gateway.test.ts` is opt-in through `PC_TEST_POSTGRES_URL`. The same
repository behavior was exercised with a dedicated PostgreSQL 17 container
before the full Compose verification.

## PostgreSQL restart evidence

A dedicated internal Docker network, PostgreSQL 17 container and data volume
were used without host port publication. Setup persisted:

```json
{
  "approval_status": "CONSUMED",
  "operation_outcome": "OUTCOME_UNKNOWN",
  "mcp_state": "ACTIVE"
}
```

After restarting PostgreSQL and recreating the repository client:

```json
{
  "approval_status": "CONSUMED",
  "mcp_state": "ACTIVE",
  "recovered_operation_outcome": "OUTCOME_UNKNOWN",
  "reconciled_operation_outcome": "KNOWN_SUCCESS",
  "durable_audit_entries": 1,
  "credential_material_leaked": false
}
```

The one-time repository verification container, network and volume were
removed after success.

## Isolated Compose evidence

Compose file:

```text
deploy/docker-compose.dev07-local.yml
```

Images:

```text
process-copilot-dev07-local-api:dev07-20261110
  sha256:3ef530d0ff0677d3ac635d06a3fd59c1c773b3b26c84fc39f9c2bb77b148cab1
postgres:17-alpine
  sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac
process-copilot-dev06-local-runtime-host:dev06-20261110
```

The DEV-07 stack remains available for local acceptance. Its control network
is internal and no host ports are published:

```text
api          3000/tcp
runtime-host 3100/tcp
postgres     5432/tcp
```

Container-internal HTTP verification completed:

```json
{
  "approval_status": "PENDING",
  "self_approval_status": 403,
  "secret_ref_exposed": false
}
```

After API restart, then API stop plus PostgreSQL restart plus API recreation:

```json
{
  "postgres_restarted": true,
  "api_recreated": true,
  "approval_status": "PENDING"
}
```

The API readiness projection reported `controlled_gateway: ready`.

## Constraints preserved

- no changes or deployment to `192.168.31.95`;
- no connection to shared EE MySQL;
- no host port publication;
- no DSH Core modification;
- no remote Git repository configured or pushed;
- ADR-0018, ADR-0019 and ADR-0020 remain Draft and were not used as DEV-07
  acceptance authority.
