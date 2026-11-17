# Process Copilot Harness repository

Read `README.md`, `SOURCE-BASELINE.md`, `governance/PROCESS-COPILOT-NEXT-PHASE-ROADMAP.md`
and relevant files under `architecture/` before changing implementation.

## Ownership

- `product/` is the Product implementation.
- `architecture/` is the accepted architecture authority and must remain next
  to Product because Product checks reference `../architecture`.
- EE-Claw is an external business platform and authorization provider. Its
  source is not vendored into this repository.

## Current direction

- MEMORY-01A is closed at its defined Authority and Contract boundary.
- MEMORY-01B remains on hold.
- The next mainline is a Superseding ADR and phased implementation for PC/EE
  identity, authorization and business-provider decoupling.
- PC platform permission and EE business-data permission must remain distinct
  authorities whose decisions are intersected for EE operations.

## Constraints

- Preserve existing behavior and tests unless a task explicitly changes them.
- Do not modify DSH Core, EE schema, shared databases or production settings.
- Do not add real secrets, `.env` files, database dumps, Runtime state or large
  test evidence to Git.
- Do not replace real business dependencies with mocks in integration claims.
- Do not claim complete Memory, standalone mode or production readiness from
  partial implementation or developer-only verification.
- Run `pnpm check` from `product/` before delivery.
