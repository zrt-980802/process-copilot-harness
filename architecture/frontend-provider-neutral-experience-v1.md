# Provider Neutral Frontend Experience v1

- Task: FRONTEND-PROVIDER-ISOLATION-01
- Authority: ADR-0024; C61-C66 retain their existing schemas and meanings.
- Scope: local developer verification of presentation and request ownership.

## Evidence And Projection

`experience-policy.ts` is the single presentation policy. It accepts the current
PC principal/tenant, C65 availability and expiry, C66 generation/catalog metadata,
the current authorized directory, selected project and that project's Catalog.
The policy intersects AVAILABLE release IDs with the current Catalog. It emits
navigation, project/engineering/SSTS/approval/identity flags, allowed request
kinds and a reason to remove external state. It never emits an authorization
decision. `provider_mode` only selects existing sign-in/sign-out transport.

The directory observation and Catalog are acquired within one abortable local
generation, not restored from browser storage. C65 must match principal, tenant,
expiry, catalog revision and the current bundle generation evidence. Catalog
digest must match C65. The projection expires at the earlier C65/C66 expiry.
Directory visibility is discovery evidence, never object authorization.

| Current evidence | Experience | External discovery/business requests |
| --- | --- | --- |
| UNCONFIGURED / standalone | Personal home, tasks and conversation | None |
| Unavailable / disabled / denied / expired | Personal plus neutral actionable status | Explicit refresh/retry only; no business reads |
| READY without AVAILABLE capabilities | Personal, internal no-capabilities state | C65 only; no directory/Catalog |
| READY, current C65, empty directory | Personal, internal zero-projects state | C65 and directory; no Catalog |
| Authorized project, generic Catalog | Generic overview and project conversation | Selected Catalog and visible supported task reads |
| Current engineering capabilities/data | Engineering/requirements as supported | Supported current project-data/tool reads |
| Current SSTS capabilities/data | Existing draft, resources, artifacts and approvals | Current scene/task/tool reads, explicit approvals view |

SSTS requires both list and detail capabilities. Engineering and requirements
are independent. An empty specification result has no provider specification
heading, empty board or metric. Known SSTS/review profile IDs are classified by
the scene adapter; an arbitrary profile is not assumed to be SSTS. Historical
task metadata cannot assemble a removed scene. Generic fixtures in tests are
not an implementation of a second Provider.

## Ownership And Invalidation

`ExperienceSession` serializes health -> C65 -> directory -> selected Catalog,
publishing only a complete current observation. Refresh, project change, source
denial, observed outage and expiry invalidate the old local generation first.
External requests use both component and experience AbortSignals. Generation
checks discard responses even when transport ignores abort. Task selection and
draft responses are also fenced against later selections in the same project.

The shell clears selection-related state, facts, tools, details, resource rows,
provider diagnostics and filters on generation replacement. App clears external
tasks/projection/drafts and removes task bookmarks and URL fragments. Restoring a
session may reopen a current personal task; it never auto-restores an external
task from a bookmark or URL. Back/forward navigation revalidates discovery and
clears hidden fragments. A revoked selected project does not silently switch to
another project's Catalog. Personal tasks remain independent of an external
generation replacement. No unconditional five-second polling remains.

Revocation is observed through request-time failures, explicit refresh,
window focus/history revalidation or evidence expiry. This is not cross-instance
revocation fan-out or immediate detection of an unobserved source change.

## Adapter And Identity

`provider-view-adapter.ts` owns EE tool names, source URI parsing, result-envelope
unwrapping, known scene profile classification and business view models. Templates
consume the view model and policy rather than `ee.*` result keys. Protocol IDs
remain available in explicitly opened current tools/trace diagnostics.

Default account presentation uses the PC principal and entered account name,
with a neutral restored-account fallback. Provider account details are fetched
only after explicit diagnostics expansion with a current available project
Catalog. Closing, invalidating or unmounting diagnostics aborts and fences its
result. No provider account is loaded as a shell mount side effect.

The vehicle asset is retained as a historical file but has no runtime reference.
Fixed project/sample defaults and the synthetic-engineering badge are removed.
Provider source labels appear only with returned, capability-filtered EE rows.

## Compatible Personal Discovery

The existing mixed `/v1/ssts-tasks` endpoint performs a directory check. Calling
that endpoint for a personal-only page would indirectly contact EE even though
the browser never calls the directory route. The additive `?scope=personal`
selector filters the authenticated owner's local workspaces before touching
the Workbench/Provider. Default mixed listing and its source authorization are
unchanged. This narrows results and grants nothing. There is no new C61-C66
field, schema, migration or backend authorization bypass.

Backend request-time PC policy and source-system authorization still intersect
for every external operation. The existing Gateway, approvals, Runtime, ledger,
EE authorization and recovery contracts are unchanged. No Allow is stored in
browser storage or derived from health, a project name or a profile name.

## Verification Boundary

Pure policy/controller/adapter tests, API personal-discovery regression and
production Vue/DOM tests exercise this design. Browser fixtures run on a random
loopback port, at 1440 and 390 pixels, including precise approval and Operation/
Trace UI compatibility. They do not prove live EE/Runtime/model execution.
Database-conditional checks are skipped without explicitly isolated variables.
See `../product/docs/frontend-provider-isolation-01-verification.md` for commands,
request counts, screenshots, evidence and independent retest guidance.

D4B, MEMORY-01B, second Provider development, cross-instance coordination and a
visual redesign are outside this implementation.
