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
  with Provider-local degradation are complete; D4 is planned but not started.
- EE business authorization remains authoritative for EE projects and objects;
  PC owns PC Principal, Session, Conversation, Memory, Task, Plugin, Tool,
  Approval and Audit policy.

This repository is a development baseline. It is not a production release or
deployment qualification.

D2 supports a controlled local/development identity and personal Workbench
without EE configuration. D3 isolates a configured EE outage to EE-owned
paths. This does not make the local provider a production IAM and does not
implement production multi-provider routing.

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
