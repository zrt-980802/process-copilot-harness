# Local engineering workbench demo

Current login update (2026-11-12): both PC and EE use EE accounts; old Pilot names
are historical aliases. See [unified-ee-login.md](unified-ee-login.md) for current
accounts, identity boundaries and validation. Earlier login descriptions below
remain historical evidence.

Entry: http://127.0.0.1:18091. Local Docker only. EE account/permission administration: http://127.0.0.1:18092/access-control. The previous 18090 containers were retired on 2026-11-12; their volumes and evidence remain.

Current personal capabilities, EE account access, exact Docker cleanup and 146-test verification: [personal-capabilities-ee-admin.md](personal-capabilities-ee-admin.md).

## Personal homepage (2026-11-12)

Login now opens **首页**, a personal view across accessible projects. It reads owned PC workspaces, their saved DSH conversation events, draft revisions and visible approvals through existing authenticated APIs. Opening the homepage does not prepare a Runtime session or run MCP/model calls. Conversation previews display readable text extracted from sanitized Markdown. Search, project filters and task-state filters use these records; unavailable dependencies display errors or partial-data notices.

The homepage includes project entries, ongoing tasks, recent conversations, recent generated drafts, and separate counts for requests awaiting the current approver and requests submitted by the current user. Task and conversation links select the corresponding project and workspace. **工作** retains the engineering overview; **工作台** retains the original SSTS page. The account avatar opens account information and a display-density preference saved separately for each principal in this browser. It does not invent profile-edit, SSO or credential-management APIs.

Acceptance exposed a Runtime bundle-change defect: profile resolution read the live dependency digest while admission read an older registered manifest. Workbench now synchronizes the live manifest after checking its owner, resolves a fresh immutable snapshot when runtime requirements change, and replaces the Assignment with a higher generation/fence. DSH's persisted preset remains reusable only when historical snapshots from the same session prove identical profile, authorization, tools, model and knowledge scope; only the runtime bundle digest may differ. Tool context and Gateway validation continue using the current snapshot. Preset registration is idempotent across repeated configuration, including Cordis service proxies. DSH Core and existing histories were not edited. Runtime-event read failures now propagate instead of appearing as empty conversation histories.

Validation: full Product gates **143 passed / 6 conditional skipped**, including the new admission, immutable-history, owner-denial and preset compatibility/idempotency regressions. The final bridge change also passed targeted tests and lint. Chrome homepage acceptance compares actual API counts, exercises project/task links, conversation/input preservation, filters, account preferences, reviewer ownership isolation, and error recovery at 1440/1100/390 widths. Pending/expired approval actions and dependency failures use browser-only intercepted fixtures; no stored approvals are changed. Evidence: `reports/personal-home/`; script: `node deploy/verify-personal-home.mjs`.

The connected conversation regression also passes actual release and higher-generation restoration in the same Runtime container, a fresh model turn calling real EE tools, original draft access, reload and mobile layout. Hidden-tenant login and Markdown/security regressions pass again. See `reports/workbench-conversation/` and `reports/workbench-markdown/`. These are desktop-session acceptance results; the earlier independent EE acceptance remains historical evidence. All local data volumes and existing user-created tasks are preserved; no commit, push or remote deployment was performed.

## Conversation and original workbench (2026-11-12)

The navigation now exposes both Conversation and the original SSTS Workbench. The engineering overview and relationship views remain available. Both execution views use the same task, DSH Session and governed tools. The original page retains inputs, task notes, generated drafts, downloads, review, exact approvals and Owner evidence.

Conversation restores actual user/assistant text from the pinned DSH SDK's paginated Session events through a new authenticated, task-owned endpoint. Text-only projection excludes system messages, thinking and tool payloads; it does not rewrite the immutable C25 audit stream. Navigation preserves the mounted execution panel, unsent input and ongoing turn. Reload restores saved history. Runtime/tool state refresh discards responses from previously selected tasks. The composer remains visible at 1440, 1100 and 390 pixels.

Expired Workspace View Snapshots now require a fresh authorized view and materialization before Assignment reuse. The pinned SDK retains disposed Session handles after external bridge release. The PC adapter therefore recycles the SDK process only after active turns have completed, replays Assignment Guards and explicitly resumes surviving Sessions. The Runtime container, durable histories, PC/EE data and DSH Core remain intact. Concurrent active turns complete before recycling.

Validation: Product full gates 139 passed, six conditional skipped. `deploy/verify-workbench-conversation.mjs --restore` verifies anonymous/other-owner denial, identical history after actual release and higher-generation reassignment in the same Runtime container, a real model turn with fresh tools, the original Draft download entry, navigation/input preservation, reload and three responsive viewports. Evidence: `reports/workbench-conversation/result.json`, `sdk-restoration.json` and screenshots. This follow-up was verified in the current desktop session; the earlier independent EE acceptance remains the DEV-09B baseline.

The supplied `ai工作台演示2` reference informed the navigation rail, project context, overview, relationship/list view and detail drawers. The connected implementation uses actual EE MCP facts and PC durable tasks, inputs, generated drafts and approval state. No template AI responses, invented completion percentages or prototype process authority were copied.

## Accounts

The local login displays account and password only; the existing demo tenant is supplied internally. Conversation messages render GFM Markdown through `marked` and an explicit DOMPurify allowlist, including headings, lists, tables, quotes, links and fenced code. Scripts, embedded active content and unsafe link protocols are removed. Long tables/code scroll within the message. `deploy/verify-workbench-markdown.mjs` verifies actual login/history plus browser-only formatting/security fixtures at 1440/390 pixels without changing stored messages; evidence is in `reports/workbench-markdown/`. Web build/typecheck passed.

Tenant: `tenant_acceptance`. Engineer: `pilot.acceptance` / `LocalAcceptanceSecret123`.
Separate approver: `reviewer.acceptance` / `LocalReviewerSecret123`.
These are local demo accounts only. Model credentials remain in the runtime environment and are not included in this document.

## Services and persistence

Compose: `deploy/docker-compose.workbench-demo.yml` + `deploy/docker-compose.ee-admin.yml`, project `pc-workbench-demo`. The launcher includes both.

| Service | Purpose | Storage |
| --- | --- | --- |
| ee-api | Real platform account/project authorization, guarded demo initialization | EE MySQL only |
| ee-mcp-adapter | Official MCP, existing Governance Gateway and Owner calls | EE MySQL only |
| ee-mysql | MySQL 8.0.39, database ee_pc_demo, database-scoped ee_demo user | ee-mysql-data |
| pc-api | Actual Identity/Profile/Resource/Gateway/SSTS application | PC PostgreSQL only |
| pc-postgres | PostgreSQL 17, database pc_demo | pc-postgres-data |
| pc-runtime | Pinned DSH runtime, real configured model | runtime-data, pc-data |
| seed | One-shot idempotent PC bootstrap through actual API | pc-data/demo/seed-tasks.json |
| web | nginx and built Vue workbench | Local port 18091 |
| ee-admin-web | Actual EE frontend, account/permission/audit APIs | Local port 18092 |

Only the two frontend services are published to loopback. Database, EE API, MCP and Runtime ports are internal. The control network is internal; model egress belongs to Runtime. EE source is mounted read-only from the isolated DEV-09A worktree. The EE frontend now exposes account/permission/audit management; the remaining EE business APIs, bot, webhook worker and Neo4j are not started. No remote environment or original EE checkout is modified.

EE creates the existing schemas in the new database, then seeds two explicitly fictional projects. EP37 contains six requirements/functions and three SSTS documents; EP38 contains three requirements/functions and three SSTS documents. Nine Requirement-Function links and six confirmed Function-SSTS links are actual DB rows. EP37 intentionally has three functions with no confirmed SSTS link. A draft and an in-review case are available. The acceptance run submitted SSTS-EP37-003 for review through real approval; it did not publish it.

Three PC workspaces are seeded: EP37 power monitoring (complete required inputs), EP37 CAN freshness (architecture input intentionally missing), EP38 power monitoring (complete required inputs). The first now contains a genuinely model-generated SSTS draft with exact source versions and Trace references. EE source specifications are synthetic input records, not AI-generated output.

The bootstrap volume contains only installation identity/schema revision and real EE account IDs. PC reads those IDs instead of assuming auto-increment values. EE account/role creation is transactional. A database-instance/schema marker avoids rerunning the shared initializer that refreshes built-in grants. Repeated seed does not reset existing memberships, roles, edits, deleted records, reviews or completed PC inputs. Pending PC bootstrap resumes missing input slots; completed bootstrap is tracked by immutable workspace ID rather than mutable title.

## Start and verify

Run from Product in PowerShell:

```powershell
pnpm --filter @pc/web build
node deploy/build-workbench-demo.mjs
E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe deploy/start-workbench-demo.py
node deploy/verify-workbench-demo.mjs --generate --review --browser
E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe deploy/verify-workbench-idempotency.py
```

The launcher inherits the already configured credential in memory from this demo Runtime or the previous DEV-09A verifier; explicit process environment takes priority. If neither exists, set `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` and `PC_DEV09A_MODEL` in the local launch environment. No key is written to repository files. This local image derives from the previously verified DSH image; a clean machine needs that pinned base image first.

To stop this stage while retaining all data:

```powershell
E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe deploy/start-workbench-demo.py stop
```

Do not use `down -v`, global prune, shared MySQL, remote deployment or automatic commit/push.

## MCP organization

Nine stable protocol tools are displayed in six domains: projects, requirements, functions, specifications, traceability and controlled commands. Verified Catalog resource metadata equals tool metadata; the Catalog digest includes presentation identity. PC preserves the verified display/domain metadata in ToolRelease compatibility. Protocol names, input injection, page/project authorization and exact approval/recovery rules remain unchanged.

The project projection endpoint reads six real tools through `RuntimeWorkbench.prepare` and the controlled Gateway. It verifies task ownership, current project authority, Profile/Tool releases and signed session context. PC never reads EE tables directly. Engineering relationships use confirmed links returned by the real Function-SSTS matrix. Current list counts refer to loaded records, not a fabricated process completion metric.

## Verification and limits

Evidence: `reports/workbench-demo/`.

- Product `pnpm check`: 135 passed, six conditional skipped; 17 ADR/42 contract gates, lint, typecheck and build passed.
- Independent EE real isolated MySQL/MCP suite: 13 passed, including the four Catalog tests; five upstream deprecation warnings.
- Actual two-project queries, nine tools/six domains, unauthorized project and cross-account task reads, separate reviewer approval, actual Owner write and independent readback passed.
- Real model draft generation and download passed with at least six exact source references and EE Trace references. API/Runtime recreation retained the draft.
- Chrome 1440/1100 navigation, search, missing-link filter, graph, detail snapshots, asset rendering, project switching, reload and horizontal overflow checks passed.
- Seed idempotency compares hashes of actual EE business/auth rows and PC tasks/inputs/draft projections before and after both seeds; see seed-idempotency.json.
- Restart regression: API control IP changed from 172.24.0.4 to 172.24.0.6 while Web container ID stayed identical. Docker DNS resolution recovered login and preserved the generated draft digest. Evidence: restart-persistence.json. This check restarted services; it did not replace their container IDs.
- The restart/idle test also exposed a Guard comparison defect: a fresh Assignment resets its local authority version, so it must not be compared against the old generation's renewal version. The bridge now checks generation/fence before comparing versions within the same generation. A regression preserves rejection of old generations, lower fences and stale/conflicting same-generation authority. Real project reads recover through a higher-generation Assignment without deleting history or rejected records.
- After replacement, the same real DSH session called live Function/matrix tools and correctly identified FN-EP37-004/005/006 as uncovered, with actual Trace references. See real-model-recovered-turn.json.

Independent final acceptance: PASS; EE task DEV-09B-EE-DEMO-WORKSPACE is auto_done. The independent verifier reran the 13 real EE tests, three Guard regressions, idempotency, project/owner denial and exact artifact-download comparison. Detailed disposition is in the EE task verification record.

This is a local connected engineering demo, not full EE deployment, production SSO or enterprise publishing. PC draft acceptance is local review. Runtime conversation history is restored from DSH; it is separate from the task notes consumed by the structured SSTS workflow. Responses are displayed after a turn completes; token streaming is not implemented. The engineering graph presents connected Requirement/Function/SSTS facts, not every lifecycle stage from the reference prototype. Existing unreadable dependencies fail visibly rather than being replaced by mock results. No commits or pushes were made.
