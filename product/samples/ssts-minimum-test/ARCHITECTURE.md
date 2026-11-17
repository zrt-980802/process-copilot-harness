# Payment Reconciliation Architecture

## Boundaries

- PostgreSQL is the business-state authority.
- Uploaded files become immutable ResourceVersions.
- Draft generation is read-only and replay-safe.
- Human acceptance does not publish to EE Claw.

## Components

- Process Copilot API
- SSTS Draft aggregate
- Resource Workspace
- Business Task and Operation projection
- PostgreSQL durable store
