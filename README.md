# Process Copilot Harness

Process Copilot is a company-level Agent Harness. SSTS and EE-Claw are the
first vertical scenario and external business provider; they are not the
product boundary.

## Repository layout

- `product/`: Process Copilot applications, packages, contracts, deployment
  definitions and verification documentation.
- `architecture/`: accepted ADRs, module and contract catalogs, threat models,
  implementation decisions and traceability manifests.
- `governance/`: active development requirements and the next-phase roadmap.

The `product` architecture checks intentionally read `../architecture`. Keep
these directories adjacent.

## Current baseline

- DEV-09 and the later local demo work are preserved as source history and
  documentation.
- MEMORY-01A passed independent review after idempotency remediation.
- MEMORY-01B is not implemented and remains on hold.
- The next mainline is PC/EE identity, authorization and business-provider
  decoupling. D0 contracts, D1 ports, D2 Standalone and D3 Authority Router
  with Provider-local degradation are complete. D4A Bundle lifecycle is complete;
  D4B has not started. This is not completion of all D4 work.
- EE business authorization remains authoritative for EE projects and objects;
  PC owns PC Principal, Session, Conversation, Memory, Task, Plugin, Tool,
  Approval and Audit policy.

This repository is a development baseline. It is not a production release or
deployment qualification.

D2 supports a controlled local/development identity and personal Workbench
without EE configuration. D3 isolates a configured EE outage to EE-owned
paths. This does not make the local provider a production IAM and does not
implement production multi-provider routing.

D4A publishes all five EE ports, Catalog, Profiles and Connector as one fenced
generation. Failed reload closes EE execution and retains diagnostic metadata;
the persistent personal Workbench continues. Architecture and developer evidence:
`architecture/external-provider-decoupling-d4a-provider-bundle-v1.md` and
`product/docs/decoupling-d4a-verification.md`.

The frontend projects current availability, authorized project discovery and the
selected Catalog into one neutral experience. Personal-only states do not mount
project/scenario navigation or fetch provider account details. Current EE/SSTS
capabilities retain their vertical views. Design and local developer evidence:
`architecture/frontend-provider-neutral-experience-v1.md` and
`product/docs/frontend-provider-isolation-01-verification.md`.

The real EE isolation task remains pending real retest. The Session/source
boundary (RCI-02), READ projection closure (RCI-03), and bounded Gateway
Connector-target repair are developer verified; the real task is not complete.
Evidence and retest limits:
`product/docs/real-ee-integration-closure-01.md`.

ADR-0025 T0 freezes C67-C69 Session Assurance, Authority Decision and immutable
Provider Compatibility Mapping, with 69 total contracts and pure golden tests.
**T0 COMPLETE / T1A COMPLETE / T1B-T3 NOT STARTED**. RCI-02 is fixed at the
deterministic PC/source boundary and remains pending real EE retest. RCI-03 READ
projection is also fixed pending real retest. Contract and T1A evidence:
`architecture/adr-0025-t0-contract-and-compatibility-v1.md` and
`product/docs/adr-0025-t0-verification.md`, plus
`product/docs/adr-0025-t1a-verification.md`.

RCI-03 verifies durable Gateway results before moving a READ Business Operation
from VERIFYING to SUCCEEDED. Write and unknown outcomes retain their stronger
readback/reconciliation rules. Real EE retest requires a separate task; no next
phase starts automatically. Developer verification:
`product/docs/rci-03-read-operation-projection-verification.md`. Task authority:
`governance/RCI-03-READ-OPERATION-PROJECTION-CLOSURE-TASK.md`.

## Verify

Prerequisites: Node.js 22 or later and pnpm 11.21.0.

```powershell
cd product
pnpm install --frozen-lockfile
pnpm check
```

PostgreSQL-backed conditional tests require their documented isolated test
database variables. Do not point them at shared or production databases.

## Safety boundaries

- Do not commit `.env`, credentials, model keys, database files or Runtime
  state.
- Do not modify DSH Core as part of ordinary Product work.
- Do not copy EE business permissions into PC as a second authority.
- Do not connect tests to `192.168.31.95` or shared EE databases.
- Use isolated local containers and preserve unrelated user data.
