# DEV-09A local handoff

Implementation and evidence: [verification](dev09a-complete-verification.md).
Owning architecture: `../architecture/ee-agent-mcp-full-chain-integration-research-v1.md` and accepted ADR-0001 through ADR-0017.

The Docker acceptance environment remains available at http://127.0.0.1:18090.
Login: tenant `tenant_acceptance`, account `pilot.acceptance`, local fixture secret `LocalAcceptanceSecret123`.
Reviewer: `reviewer.acceptance`, local fixture secret `LocalReviewerSecret123`.
These are isolated test accounts; model credentials are separate runtime inputs.

## User scenario

1. Sign in, select EP37, enter FN-EP37-001 and create a task. READ mode exposes read tools; REVIEW additionally permits explicit review requests.
2. Bind actual PRD/architecture uploads (or the clearly labelled local sample inputs). Generate a Draft; Runtime obtains real EE facts and exact-source citations. Rejection permits a fresh revision; local acceptance permits download and never publishes EE content.
3. Tools display the live schema. Read SSTS-EP37-001 and inspect its `snapshot_digest`. For a new editable Owner document, request `ee.submit_ssts_review` with that exact digest and a real platform reviewer ID. The existing acceptance document is already in_review, so a second submission is correctly rejected by Owner state.
4. The separate reviewer can inspect exact arguments and approve/reject in the approval tab even with no owned tasks. The requester executes the approved request. If outcome is UNKNOWN, use readback reconciliation rather than a new command.
5. Runtime shows epoch, Assignment, Lease and Profile; evidence shows actual Trace and Owner read-only resource navigation. Running turns support cancellation. Refresh preserves durable state.

## Resuming development

Use the original Product and isolated EE worktree from desktop `workspace.paths.json`; do not develop in the migration entry or old PC prototype. Pending changes are intentionally uncommitted. Preserve old task histories, snapshots and volumes.

The default launcher command rebuilds/restarts the acceptance runner and reseeds a fresh isolated EE fixture. It is a reproducible local test harness, not a persistent enterprise EE installation. Prior Product artifacts remain in PostgreSQL, but old fixture endpoints and expired Runtime leases are historical evidence. For the currently running final acceptance, use the newest workspace in `migration/dev09a-complete-evidence/state.json`.

When deliberately ending this fixture, creating `/evidence/stop.request` inside this verifier gracefully closes only its acceptance processes; named volumes are retained. Do not use `down -v`, global prune or commands against shared services. This handoff does not authorize cleanup or commits.
