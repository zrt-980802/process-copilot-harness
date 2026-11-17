# Multi-user conversation repair

2026-11-12. User authorized fixing non-engineer conversation and broad tests.
Read ADR-0001 (one user per Runtime), ADR-0007 (per-call delegation), ADR-0009
(immutable profiles and authorization intersection), ADR-0010 and current sources.

Root causes: one engineer-owned Runtime endpoint; engineer-only MCP binding;
SSTS profiles require the full engineering catalog; no independent personal
conversation/new-session entry. Login acceptance did not exercise multiple users
actually sending model turns. This task must verify those positive paths.

Implementation scope: Product Workbench/API, authenticated user Runtime resolver,
local restricted Docker provisioner, personal/project conversation profiles,
per-user MCP binding, frontend new-conversation flow and local demo Compose.
Preserve existing engineer Runtime, Principals, profiles, tasks and history.
No EE account grants, schema, .env, DSH Core, original EE checkout or remote edits.

Personal conversations have no enterprise tools or project access. They use an
explicit PC-owned self-scoped conversation policy. Project conversations choose
a published immutable release containing only currently authorized read tools.
Existing SSTS/controlled-review profiles retain all required dependencies.
Sessions never hot-swap their primary profile or silently drop required tools.

Runtime provisioning occurs only on execution, never login/home/history listing.
Each user gets a separate container/state volume and read-only materialization
subtree. Reuse one container across that user's sessions. The existing engineer
Runtime remains owned by that engineer. Provisioner accepts only authenticated
typed owner requests and derives image/config/mount/network from a fixed local
template; API/Runtime never receive the Docker socket. Limit local capacity.

Acceptance matrix: engineer/reviewer/admin/fresh account actually send real-model
turns; personal and project scopes; positive permitted MCP and denied forbidden
tools; no automatic project grants; two users concurrent; two sessions of one
user; foreign task/session/Runtime denial; revocation and invalid login; reload,
API and user Runtime restart with retained context; original SSTS conversation,
Markdown/capabilities/admin association; desktop layouts and browser errors.
Run full Product gates and real EE/MySQL tests; preserve exact evidence and
distinguish independent verification from executor self-check. No mock authority
or model response can count as end-to-end acceptance.
