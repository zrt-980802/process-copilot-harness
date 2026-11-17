# Process Copilot MVP Implementation Decision Pack v1

- Status: Accepted for MVP implementation
- Date: 2026-11-09
- Scope: P0 engineering baseline and FO SSTS Draft Assistant MVP
- Authority: ADR-0001 through ADR-0017 remain authoritative; this document selects implementations without changing their semantics

## 1. Product slice

The first product slice is **FO SSTS Draft Assistant**:

```text
controlled pilot sign-in
-> create task
-> upload source material
-> start a session with the fixed FO Expert Profile
-> check input completeness
-> generate a cited SSTS draft
-> accept or reject the draft
-> download
```

The first release does not publish to EE Claw, perform enterprise writes, expose a role administration UI, or expose Policy Artifact authoring.

## 2. Repository and language

| Decision | Selection |
|---|---|
| Repository | Greenfield `product/` pnpm workspace |
| Language | TypeScript |
| Package manager | pnpm 11 |
| Runtime baseline | Node.js 24 for development; code targets Node.js 22-compatible APIs |
| Module format | ESM |
| Source reuse | Architecture documents and stable contracts only; no prototype UI, API, schema, or state-model reuse |

The architecture workspace remains the specification root. The product repository may read governance documents during CI but must not modify DSH Core or EE Claw.

## 3. Application topology

| Deployable | Implementation | Initial responsibility |
|---|---|---|
| Web | Vue 3 + Vite | Login, task list, task workspace |
| API | Fastify modular monolith | Stable HTTP facade and control-plane orchestration |
| Runtime Host | Fastify + Node.js process supervisor boundary | Runtime health, command ingress, bridge lifecycle |
| Worker | API process polling loop initially | PostgreSQL Inbox/Outbox and background jobs |

Logical module ownership follows `implementation-module-responsibility-matrix-v1.md` even when modules share a process.

## 4. Data and integration

| Concern | Selection |
|---|---|
| Authority store | PostgreSQL |
| Blob storage | S3-compatible port; local filesystem adapter only for development |
| Jobs/events | PostgreSQL Inbox/Outbox plus polling worker |
| Contracts | JSON Schema 2020-12 plus generated TypeScript interfaces |
| Validation | AJV with format validation |
| Observability | OpenTelemetry API boundary; console exporter allowed in local development |
| Runtime integration | Stable `DshAdapterPort`; no control-plane import of DSH internals |

Stable Resource contracts never expose local paths. Runtime mount references remain Runtime Host-local values.

## 5. Security and identity

MVP sign-in uses controlled Pilot Accounts behind the same `IdentityPort` and `RequestContext` shape intended for enterprise identity. This is not anonymous mode.

The implementation must:

- enforce tenant and principal scope server-side;
- keep authorization snapshots versioned;
- reject unknown security enums and stale fencing tokens;
- keep long-lived credentials outside Runtime;
- avoid enterprise write operations in the MVP path;
- record structured audit evidence without tokens or source document bodies.

## 6. Contract generation

`stable-contract-catalog-v1.md` is the source for C01-C42 field names and required/optional status. The product contract generator adds:

- required `contract_name` and `contract_version`;
- JSON Schema identifiers and semantic metadata;
- explicit enums for security- and runtime-critical fields;
- one valid and one missing-required-field invalid fixture per contract;
- generated TypeScript interfaces;
- a generated contract manifest.

Changing a generated schema requires changing the accepted catalog or an explicit generator rule. Generated files are verified as clean in CI.

## 7. Testing and gates

The P0 gate consists of:

1. all 42 schemas parse and accept their golden fixture;
2. all 42 invalid fixtures are rejected;
3. Traceability covers ADR-0001 through ADR-0017 and references existing contracts;
4. compatibility declarations retain the accepted DSH and Legacy V1 constraints;
5. forbidden dependency checks reject Web-to-Persistence, Control-Plane-to-DSH-internal, Bridge-to-control-plane-database, and UI-to-Runtime imports;
6. lint, typecheck, unit tests, and production builds pass;
7. API and Runtime Host expose health endpoints.

## 8. Deferred decisions

The following are intentionally deferred until the Runtime Walking Skeleton research is accepted:

- in-process child runtime versus containerized Runtime Host for the first pilot;
- bridge transport selection;
- DSH session persistence and resume adapter details;
- event export checkpoint format;
- runtime process kill, drain, and finalizer mechanics;
- production OpenTelemetry collector and deployment topology.

These decisions must be made before P1 implementation, but they do not block P0.

