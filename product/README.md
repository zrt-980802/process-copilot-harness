# Process Copilot Product

Greenfield implementation workspace for the FO SSTS Draft Assistant MVP.

Connected engineering workbench demo: http://127.0.0.1:18091.
See [demo services, accounts and verification](docs/dev09b-workbench-demo.md).
Both PC and EE now use EE accounts. See [unified local login](docs/unified-ee-login.md)
for current credentials, stable PC identity associations and verification.

DEV-09A local real-model/MCP acceptance is implemented. Current Docker entry:
http://127.0.0.1:18090. See [local handoff](docs/dev09a-local-handoff.md) and
[verification evidence and limits](docs/dev09a-complete-verification.md).

## Commands

```bash
pnpm install
pnpm generate:contracts
pnpm check
pnpm dev
```

Local endpoints:

- Web: `http://localhost:5173`
- API health: `http://localhost:3000/health`
- Runtime Host health: `http://localhost:3100/health`

## Test deployment

The test Compose stack builds three containers and does not depend on the
legacy PC MySQL or Query MCP services. Runtime Host reuses the verified Gate 2
DSH Compose runtime layer through the dedicated
`process-copilot-dsh-runtime-base:0.2.1-rc.3-gate2` image. The base contains
the pinned DSH source, official Python SDK and Linux-native dependencies;
`DSH_HOME` is persisted in a separate named volume. No legacy Process Copilot
business code is invoked by the new Runtime Host.

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/prepare-artifacts.ps1
docker compose -f deploy/docker-compose.test.yml build
docker compose -f deploy/docker-compose.test.yml up -d
```

`DEEPSEEK_API_KEY`, provider endpoint and model routing remain runtime
environment inputs. They are not written to Compose files or image layers.

## Isolated local P1-B2 build

The local P1-B2 stack uses a separate Compose project, dedicated bridge network
and named volume. It publishes no host ports, allows only required outbound
model traffic, and does not reuse the test deployment container names or image
tags. Runtime control uses a secret-authenticated random loopback endpoint
separate from the stock DSH SDK stdio channel.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/build-p1a-local.ps1
docker compose -f deploy/docker-compose.p1a-local.yml up -d
docker compose -f deploy/docker-compose.p1a-local.yml exec -T runtime-host `
  node -e "fetch('http://127.0.0.1:3100/health').then(r=>r.text()).then(console.log)"
```

P1-B2 adds exact-Session `CANCEL_TURN`, durable-prefix `FLUSH_SESSION`,
`CATCH_UP_EVENTS`, `REVOKE_SESSION`, and `DRAIN_RUNTIME`. Durable release uses
the fixed private Bridge's captured DSH Agent handle; drain aggregates bounded,
idempotent finalizers into a persisted Cleanup Report.

P1-B1 evidence remains in `docs/runtime-p1-b1-verification.md`; final-image
P1-B2 teardown and tombstone evidence is recorded in
`docs/runtime-p1-b2-verification.md`.

## Isolated local DEV-04 Registry build

DEV-04 adds the PostgreSQL Runtime Registry authority, two-phase
SessionAssignment activation, per-Assignment Lease CAS, Runtime Epoch fencing,
query projections and Host/Bridge Step and Tool Guards.

The dedicated Compose stack publishes no host ports and uses an internal Docker
network:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/prepare-artifacts.ps1
docker compose -f deploy/docker-compose.dev04-local.yml up -d --build
docker compose -f deploy/docker-compose.dev04-local.yml exec -T api `
  node -e "fetch('http://127.0.0.1:3000/ready').then(r=>r.text()).then(console.log)"
```

Concurrency, Lease expiry, Guard, PostgreSQL restart and Runtime replacement
evidence is recorded in `docs/runtime-dev04-verification.md`.

## Isolated local DEV-06 Resource build

DEV-06 adds immutable ResourceVersion authority, scoped Bindings,
WorkspaceViewSnapshot whitelists, controlled Materialization, TTL cleanup,
Provenance and Runtime Workspace admission.

The dedicated stack uses only internal Docker networking and named volumes. It
publishes no host ports:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/prepare-artifacts.ps1
docker compose -f deploy/docker-compose.dev06-local.yml up -d --build
docker compose -f deploy/docker-compose.dev06-local.yml exec -T api `
  node dist/verify-dev06-local.mjs setup
```

Use `recover` after an API/PostgreSQL restart and Runtime epoch replacement,
and `safety` for the Linux symlink cleanup check. Full evidence is recorded in
`docs/dev06-verification.md`.

## Isolated local DEV-07 Gateway build

DEV-07/08 Compose commands below describe historical deterministic Gateway
fixtures. Current API main requires real EE configuration when Gateway is
enabled. Use the DEV-09A-3 verification stack for current live MCP integration.

DEV-07 adds Connector and External Account authority, short-lived Credential
Leases, Principal Envelope verification, per-Principal/per-Session MCP
bindings, durable Approval, atomic Operation Ledger idempotency, execution-time
Guard checks and Outcome Unknown reconciliation.

The dedicated stack uses an internal Docker network and publishes no host
ports:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/prepare-artifacts.ps1
$env:PC_BUILD_TAG = "dev07-20261110"
docker compose -f deploy/docker-compose.dev07-local.yml build api
docker compose -f deploy/docker-compose.dev07-local.yml up -d --no-build
docker compose -f deploy/docker-compose.dev07-local.yml ps
```

Full security, persistence and restart evidence is recorded in
`docs/dev07-verification.md`.

## Isolated local DEV-08 Event and Recovery build

DEV-08 adds the durable Event Inbox, per-stream ordering and gap handling,
BusinessTask/BusinessOperation projections, deterministic rebuild,
RecoveryCase orchestration, Gateway event publication and Runtime event
export.

The dedicated stack uses an internal Docker network and publishes no host
ports:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/prepare-artifacts.ps1
$env:PC_BUILD_TAG = "dev08-20261110"
docker compose -f deploy/docker-compose.dev08-local.yml build api runtime-host
docker compose -f deploy/docker-compose.dev08-local.yml up -d
docker compose -f deploy/docker-compose.dev08-local.yml --profile verify run --rm verifier setup
```

Use `recover` after API or PostgreSQL restart verification. Full evidence is
recorded in `docs/dev08-verification.md`.

## Isolated local DEV-09 SSTS Draft backend closure

DEV-09 adds the durable SSTS Task Workspace, exact ResourceVersion inputs,
fixed FO Profile, conversation messages, idempotent Draft generation,
citations, validation, immutable revisions, human review and authorized
download.

The dedicated stack uses PostgreSQL 17 on an internal Docker network and
publishes no host ports:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/prepare-artifacts.ps1
$env:PC_BUILD_TAG = "dev09-20261111"
docker compose -f deploy/docker-compose.dev09-local.yml build api
docker compose -f deploy/docker-compose.dev09-local.yml up -d postgres resource-init api
docker compose -f deploy/docker-compose.dev09-local.yml --profile verify run --rm verifier setup
```

Use `recover` after API or PostgreSQL restart verification. Full evidence and
the frontend entry assessment are recorded in `docs/dev09-verification.md`.

## Minimum browser acceptance environment

The local browser workbench exercises sign-in, Task creation, exact input
attachment, messages, Draft generation, citations, validation, rejection,
regeneration, acceptance and download.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/start-minimum-acceptance.ps1
```

Open `http://127.0.0.1:18090`. Credentials and the acceptance path are in
`docs/minimum-browser-acceptance-guide.md`.

Published endpoints:

- Web: `http://<docker-host>:18080`
- API: `http://<docker-host>:18011/health`
- Runtime Host: `http://<docker-host>:18012/health`
- Web-routed API: `http://<docker-host>:18080/api/health`
- Web-routed Runtime Host: `http://<docker-host>:18080/runtime/health`

Architecture and contract authority remain in the sibling `architecture/` directory.

## Real EE MCP Provider (DEV-09A-3)

The Gateway now uses the official MCP client and the real EE read-only Adapter.
Catalog discovery publishes immutable Tool Releases and a deterministic
Connector; account identity, per-call authorization and project selection stay
under server authority. Runtime Tool Provider and real AI SSTS remain later
stages.

```powershell
node deploy/build-dev09a3.mjs
$env:PC_DEV09A3_EE_ROOT = 'E:/shanzi_workspace/feishu-ee-agents-dev09a'
docker compose -f deploy/docker-compose.dev09a3-local.yml up --build --abort-on-container-exit --exit-code-from verifier
```

Configuration, phase boundaries, evidence and scoped cleanup are documented in
[DEV-09A-3 verification](docs/dev09a3-verification.md).
