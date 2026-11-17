# DEV-09A-3: Real EE MCP Provider

Verified locally on 2026-11-11. Implementation is uncommitted on Product
`main@8e31349`. EE remains clean at `dev09a-ee-mcp@494db4ca`.

## Delivered behavior

Gateway uses the official TypeScript MCP client over Streamable HTTP. Each
dispatch owns a separate client and closes all HTTP/SSE streams at completion.
The SDK transport cancellation signal is combined with the Gateway deadline
and caller cancellation. Redirects and requests outside the configured endpoint
are rejected.

The Gateway supplies EE Account, PC Principal, Session, operation, deadline and
project headers from verified authority. It checks Assignment ownership and
requires the active External Account Binding to match the verified EE identity
link. Project tools reject missing, multiple or malformed project scopes and
caller-supplied `project_code` arguments. C41 calls explicitly request `read`
and verify the returned project and operation.

Discovery checks the MCP server identity, Tool schemas, read-only annotations
and EE metadata against `eea://catalog/read-tools`. Exact definitions produce
immutable Tool Releases. Endpoint, schemas, server version and Catalog changes
produce new release identities. Connector registration is deterministic for the
same tenant and discovered content. Discovery grants no user permissions and
does not assign tools to a Profile.

The configured credential issuer retains the service Bearer in backend memory.
Bindings contain `config:EE_MCP_ADAPTER_SECRET`, never the raw secret. HTTP,
protocol, Tool errors, timeout and cancellation return sanitized error codes.
Transport loss, timeout and cancellation after dispatch retain unknown outcome;
reconciliation cannot fabricate success.

## API Configuration

When Gateway storage is enabled, `apps/api/src/main.ts` selects `ee_mcp` and
rejects other Provider kinds. `DeterministicGatewayProvider` remains available
to isolated test fixtures.

Required configuration, supplied through the launching environment:

```text
PC_GATEWAY_PROVIDER=ee_mcp
EE_MCP_ADAPTER_URL=<configured internal /mcp endpoint>
EE_MCP_ADAPTER_SECRET=<service secret>
EECLAW_ADAPTER_URL=<EE authorization service>
EECLAW_ADAPTER_SECRET=<EE authorization adapter secret>
PC_PILOT_TENANT_ID=<tenant>
```

Identity, Profile, Resource and Registry stores must also be enabled. Normal
pilot provisioning requires its existing account configuration and a verified
`eeclaw` identity link. Startup discovers the Catalog and binds the configured
pilot's verified EE account. It does not create execution grants or Profile
assignments. No real `.env` was edited.

Historical DEV-07/08 Compose files configure a deterministic Gateway and cannot
be rebuilt as current live MCP environments without supplying real EE settings.
Their recorded verification results remain historical evidence.

## Verification

`pnpm check`: contract generation, 17 ADR/42 Contract checks, lint, typecheck,
133 passing tests, 6 database-conditional tests skipped, and all builds passed.

Seven official SDK protocol tests cover immutable discovery/schema changes,
unsafe Catalog rejection, concurrent identity/session isolation, project
selection rejection, credential scope, sanitized errors, lost transport,
HTTP denial, redirects, timeout, cancellation and legacy background SSE
cleanup. Four C41 adapter tests include operation forwarding, mismatched
authority, malformed JSON and ambiguous project scope rejection.

The new SDK test and real verifier also pass an explicit strict TypeScript
check, since the repository's package typechecks exclude test/deploy sources.

The Docker scenario runs on Docker Desktop's local `desktop-linux` context:

| Component | Real implementation used |
| --- | --- |
| PC API | Bundled `apps/api/src/main.ts`, authenticated HTTP routes |
| PC authority | PostgreSQL 17: Identity, Profile, Resource, Registry, Gateway, Event |
| EE services | Real Flask authorization and Uvicorn MCP applications |
| EE data | Dedicated MySQL 8.0.39, isolated database via existing EE schema setup |
| Protocol | TypeScript client 2.4.0, Python MCP 2.2.0 |

Assertions passed:

- Five tools discovered; `ee.list_functions` through PC API returns only
  `FN-EP37-001`, never `FN-EP38-001`.
- Signed stale Assignment and mixed Principal are rejected; an account binding
  outside the verified identity link is rejected before service credentials
  can be used for that account.
- ToolExecutionResult and Operation Ledger record known success with real EE
  Trace references. Event projection reaches `VERIFYING`, retaining its
  external operation record and five task events; two audit entries persist.
- API process restart preserves Connector identity, Catalog releases, Ledger,
  Event projection and idempotent replay. PostgreSQL grouping shows no duplicate
  tenant/endpoint/Catalog registrations.
- The existing Python EE scenario calls all five real tools, reads Resources
  and revokes membership. The next PC call is denied by live C41; a direct
  Provider call is independently rejected by the real EE MCP Adapter.
- PC Trace references resolve to persisted EE capability/tool spans for the
  correct account. Exported evidence and complete PC table data contain neither
  service secret.
- All containers have empty host port bindings. EE source is mounted read-only;
  the network is internal. No shared EE database is reachable through the test
  configuration.

During integration, missing C41 operation forwarding and overridden SDK abort
signals were found and fixed. The latter previously left background SSE
requests alive after calls completed; a dedicated regression now covers it.

## Reproduce

From Product, with Node/pnpm and Docker Desktop available:

```powershell
pnpm exec vitest run packages/gateway/tests packages/application/tests/eeclaw-adapter.test.ts
pnpm check
pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck --strict deploy/verify-dev09a3-local.mts packages/gateway/tests/mcp-provider.test.ts
node deploy/build-dev09a3.mjs
$env:PC_DEV09A3_EE_ROOT = 'E:/shanzi_workspace/feishu-ee-agents-dev09a'
docker compose -f deploy/docker-compose.dev09a3-local.yml up --build --abort-on-container-exit --exit-code-from verifier
```

The verifier image installs the isolated EE worktree's requirements and reuses
its existing real MySQL fixture to seed test data and run services. It invokes
real PC HTTP endpoints and validates the existing EE Trace tables before the
fixture removes its temporary database. It does not replace authorization,
Capability Gateway or Owner queries with mocks.

Evidence is retained in volume `pc-dev09a3-local_evidence`, including
`result.json`, per-stage JSON/logs, `ee-traces.json` and `api.log`. Desktop
exports are under `migration/dev09a3-evidence/` in the migration entry directory.
Named MySQL and PostgreSQL volumes are also retained. Cleanup is limited to:

```powershell
docker compose -f deploy/docker-compose.dev09a3-local.yml down
```

## Stage Boundary

The Registry Assignment is an explicit database fixture; no Runtime command
dispatcher or DSH success is simulated. Workspace admission uses actual
Resource upload, Binding, Workspace View and filesystem materialization.
The test runs the real EE authorization/MCP applications in a container test
harness, rather than deploying the entire EE frontend/application stack.

This completes Provider/Catalog integration verification only. Runtime Tool
Provider, Workbench integration, Runtime-backed SSTS, model execution and
controlled writes remain DEV-09A-4 through DEV-09A-7. `VERIFYING` is the actual
Event state reached; this stage does not claim full business-task completion.
The existing deterministic SSTS workbench is not a real AI/MCP Demo.

No commit, push, deployment, source task-state change, DSH Core change, database
schema source change or EE source edit was performed. Known EE Governance
Catalog baseline failures were not changed or rerun by this Product-only work.
