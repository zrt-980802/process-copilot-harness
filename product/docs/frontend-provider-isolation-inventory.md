# FRONTEND-PROVIDER-ISOLATION-01 Inventory

Date: 2026-11-20. Baseline: main@57160da3871a5853551071e522f1015a9624c79a (known task governance commit over efadcd3). Working tree started clean. origin is git@github.com:zrt-980802/process-copilot-harness.git; read-only remote main=f9d0f26917df990bb6a657b52ab4208dfbac0b76. No rollback or remote mutation.

## FPI-0 Trace Inventory

Whole-repository ripgrep includes ee.*, ee_account, providerMode/provider_mode, SSTS, project_code/project_workbench, EP37/FN-EP defaults, identity labels, project-car and source labels, including API presentation, tests, fixtures, docs and assets. Generated dependencies/build/reports and lockfiles are excluded. Exact raw matches are retained under this task's ignored reports directory (`inventory-rg.jsonl`); the source families and dispositions below are the maintained inventory.

| Owning surface | Classification | Disposition | Required change |
| --- | --- | --- | --- |
| App.vue login badges/account labels | user-visible brand, implicit mode | ADAPT | neutral product/login labels; mode remains authentication transport only |
| App.vue EP37/power-monitoring sample defaults | demo fixture/default scenario | REMOVE | remove sample insertion and fixed task titles; real uploaded inputs remain |
| App.vue initialization/restore/retry/loadTasks | implicit capability, request orchestration | ADAPT | current C65/directory/catalog evidence, no mode-based business admission |
| App.vue retained task/projection/draft/sessionStorage | stale identity/project state | GATE | only visible task IDs may reopen; generation + abort; no external task auto-restore |
| App.vue SSTS workspace/forms/ExecutionWorkbench | scenario capabilities | GATE | current assembled SSTS capabilities; personal conversation remains independent |
| WorkbenchShell.vue static nav/quick workflows/empty states | static layout, scenario assumptions | ADAPT | one Experience Projection controls every navigation/section/button |
| WorkbenchShell.vue ee.* fact reads/owner lookup | internal protocol | ADAPT | isolate in scenario adapter; templates consume neutral view model |
| WorkbenchShell.vue EE status/MCP/source/spec headings | user-visible provider brand | GATE | neutral default; real provider source only with actual current business rows |
| WorkbenchShell.vue accountRole and ee_account | provider identity | GATE | PC identity by default, current provider diagnostics only on explicit expansion |
| WorkbenchShell.vue project/facts/tools/detail async | stale external projection | ADAPT | clear synchronously on evidence generation change, abort/fence all completions |
| PersonalHome.vue task rereads/approval request | implicit mode/network | ADAPT | consume parent visible tasks; approval requests only for visible supported scope/view |
| PersonalHome.vue projects/artifacts/tasks/identity | user-visible data | GATE | filter by one projection before child requests, clear on transition |
| PersonalCapabilities.vue catalog fan-out/chain | protocol/implicit first project | ADAPT | use current selected Catalog; request chain only in visible capabilities view |
| ExecutionWorkbench.vue unconditional approvals/poll timer | hidden requests | REMOVE | no unconditional polling; scoped reads and approvals only when their view is open |
| ExecutionWorkbench.vue tool/owner identifiers, eea:// links | internal protocol/diagnostics | ADAPT | scenario adapter; gate owner links on current evidence and present neutral names |
| ExecutionWorkbench.vue tools/write buttons | scenario capabilities | GATE | only current Catalog tool IDs; no default EE review fallback |
| api.ts eeAuth/signIn/signOut/PKCE | internal identity adapter | KEEP_INTERNAL | transport unchanged; never used as project/scene evidence |
| account-presentation.ts roleLabel/EEAccountPresentation | internal provider presentation | KEEP_INTERNAL | only consume in explicitly expanded diagnostics with current evidence |
| types.ts Principal.ee_account/CapabilityChain | internal transport fields | KEEP_INTERNAL | boundary adapter owns display projection; no default template identity inference |
| public/assets/project-car.jpg, workbench.css asset selectors | demo asset/layout | REMOVE | remove runtime references; file remains historical, never used as project evidence |
| server.ts projects/catalog/availability/chain routes | API presentation | KEEP_INTERNAL | current source authorization preserved, no cached Allow |
| server.ts ssts-tasks mixed listing | implicit backend directory read | ADAPT | additive personal-only query avoids EE reads for personal surface; original default preserved |
| api workbench.ts/runtime/gateway/application EE implementation | internal provider protocol | KEEP_INTERNAL | no provider/router/permission rewrite |
| contracts C61-C66, schemas/fixtures/generators | internal discovery/health/authority | KEEP_INTERNAL | consume without changing v1 meanings or adding a new authority |
| current web unit and D4A browser tests | test fixture | ADAPT | neutral expectations, complete state/network matrix; fixtures explicitly synthetic |
| legacy fe-demo/ee-business/deploy scripts | historical demo/test fixture | KEEP_DIAGNOSTIC | retained historical scenarios; not run against protected demo stacks |
| docs/governance/ADR/deploy example references | documentation/diagnostics | KEEP_DIAGNOSTIC | historical identities, protocols and evidence remain traceable |

## Baseline Request Graph

Startup: health -> identity/optional EE ticket transport -> ssts-tasks + projects based on health/mode -> optional remembered task/draft. Shell mount independently calls ee-auth/me. Home independently rereads ssts-tasks and approvals, then task projection/execution for every returned task. Project view calls catalog, project-data, then all task projections. Capabilities view fans out Catalog over all projects and reads chain. Execution view reads catalog/execution/approvals at mount and every 5 seconds even for personal/hidden paths. Retry success refreshes health/tasks/projects; retry failure aborts that path. Existing component-local tokens do not coordinate authority changes across all these owners.

## FPI-1 Frozen Experience Matrix

| Evidence state | Personal shell | Project navigation/scenario | Permitted discovery | Permitted business reads |
| --- | --- | --- | --- | --- |
| Standalone / UNCONFIGURED | home/conversation/personal tasks | none, no provider identity/asset | core health + personal scope only | no project/EE reads |
| Unavailable/disabled/stale evidence | neutral actionable notice, personal remains | none; drop all old external state | health, explicit retry only | no directory/catalog/data/approval/detail requests |
| READY, current C65, zero directory projects | personal shell | none | one C65 + directory observation | no Catalog/data/approvals/details |
| READY, current projects, generic Catalog | personal + generic project surface | supported generic entries only | selected authorized Catalog | visible current task/scene only; no SSTS path |
| Current engineering tools, no specification rows | project/engineering as supported | no empty provider-specification board | selected Catalog | only tools present; source label only on returned rows |
| Current EE/SSTS Catalog + business rows | existing vertical workflow | engineering, SSTS, controlled commands as present | selected Catalog | current project and exact available tools only |
| Failure/revocation/zero projects/catalog reduction | immediately clear on observed change | personal or newly supported surface | fresh discovery only after explicit refresh | abort and discard old-generation completions |

Core/personal paths do not derive authority from health. C65 is availability, directory is request-time visibility, selected Catalog is the current PC+provider-filtered tool set. Each remains bounded by current principal, request generation, provider generation/catalog revision and expiry. No project/task array, provider_mode, localStorage, URL or static asset can manufacture this evidence. UI discovery never replaces backend authorization.

Pure policy and controller tests freeze these cases before implementation. Production-build desktop/mobile browser tests additionally cover account diagnostics, direct URL/hash/history, project switches, provider faults/revocation, capability removal, TTL expiry, retry failure/success-zero, late results and exact request sets. Completion/disposition evidence is recorded in frontend-provider-isolation-01-verification.md.

## Final Disposition And Repeatable Scan

All hotspot groups above are implemented. `REMOVE` for the vehicle refers to its
runtime references: the historical image and old fixture/deployment scripts are
retained. Empty specification headings, counts and graph columns are gated too.
Unknown profiles stay generic; known SSTS/review tasks require the current scene.
Personal task discovery no longer indirectly requests the source directory.

`node scripts/inventory-frontend-provider.mjs` performs a case-insensitive whole
repository scan covering protocol keys, project identifiers, identity fields,
implicit mode checks, assets and scene text. It writes a per-match category and
disposition to an ignored timestamped `classified-matches.json`. These lexical
categories deliberately include false-positive documentation/protocol hits;
the manually reviewed table above determines their runtime handling. The initial
pre-implementation `inventory-rg.jsonl` is preserved separately. No historical
test fixture or accepted ADR is rewritten to erase an EE reference.
