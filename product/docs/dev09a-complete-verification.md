# DEV-09A local full-chain verification

Date: 2026-11-11. Executor: Codex desktop, local Windows + isolated Docker.
Scope: DEV-09A-4 through 7, building on the separately verified stages 1-3.
Status: independent final PASS; EE task is auto_done. The verifier checked the final reloaded backend receipts, current browser report, downloaded revision and screenshot against the stated local scope.

## Implemented behavior

- Official pinned DSH SDK creates session-scoped immutable AgentPresets with the effective READ tool set. Signed Principal Envelope, Assignment, Lease, generation/fence, Profile, WorkspaceView and live EE authorization guard each tool call. EE/API service secrets are excluded from the DSH child environment.
- Workbench projects, task modes, schema forms, Runtime facts/events, evidence, Trace and durable approvals use backend projections. The browser never receives the MCP service secret.
- Runtime-backed SSTS requires successful Requirement, Function, SSTS and Trace reads in the generating turn. Exact uploaded inputs and EE evidence snapshots become immutable ResourceVersions and artifact provenance. Local acceptance does not publish EE content.
- The only controlled enterprise command is submitting an existing exact SSTS snapshot for review. It requires a REVIEW profile, independent approval, exact arguments/digest, active reviewer account and project review authority, and the existing Owner state machine.
- Lost WRITE responses remain UNKNOWN. Retrying the same command does not redispatch; reconciliation reads the actual persisted EE operation receipt and independently reads the Owner SSTS snapshot.
- Runtime epoch replacement retains DSH history/cursors but expires old authority, archives the previous state and issues a new fenced Assignment. Rollback and resurrection of a TERMINATED Runtime are rejected. Replayed historical DSH sequences deduplicate by session and payload.
- Single-executor API startup marks abandoned read generations failed, allowing explicit fresh generation through FAILED -> RECOVERING -> RUNNING. A focused repository/state-machine regression covers this path; it is not claimed as a separate live process-kill experiment.

## Verification evidence

`pnpm check` passed: generated contracts, 17 ADR / 42 Contract architecture checks, lint, typecheck, 134 tests passed / 6 environment-conditional skipped, and all builds. The skipped suites are not counted as passing; real integration evidence below is separate.

Real Docker backend sequence (`deploy/verify-dev09a-complete.py` and `.mts`):

1. Real EE Flask + official MCP + isolated MySQL; original project-filter/Trace/revocation scenario.
2. Real DSH + configured DeepSeek model (`deepseek-v4.1-flash`, user-supplied OpenAI-compatible service) calls EE tools and generates a cited SSTS.
3. API replacement preserves artifact digest and approval. Direct write without approval returns 403.
4. Independent reviewer approves after another API replacement. A transport fault proxy forwards the real write and drops its response after completion: UNKNOWN is persisted; duplicate does not replay.
5. Another API replacement; actual EE receipt plus independent SSTS readback proves KNOWN_SUCCESS / in_review.
6. Runtime epoch 1 -> 2 replacement; same persisted DSH session continues with a new Assignment and preserved input view.

Backend evidence: Docker volume `pc-dev09a-complete_evidence`, copied into desktop migration `dev09a-complete-evidence/`. Earlier epoch-1-only attempt is retained separately as `dev09a-epoch1-history/` and is not the final epoch replacement evidence.

Real Chrome acceptance (`deploy/verify-dev09a-browser.mjs`) passed:

- Nine Catalog tools; numeric schema form calls real `ee.list_requirements` and displays REQ-000001.
- Runtime epoch 2 and Assignment visible; real running model turn cancelled (`was_running=true`, `cancel_requested=true`). Cancellation deliberately returns `PC_DSH_CANCELLED` HTTP 503 under the existing API error mapping; this expected response is recorded separately from unexpected browser errors.
- Canonical `eea://projects/...` navigation performs a fresh authorized Owner read through Gateway. This is an in-workbench read-only resource viewer, not a deployed full EE editor or external EE Web deep link.
- Revision 1 rejected, real model revision 2 generated, accepted locally, Markdown downloaded, accepted state and exact draft restored on reload.
- Screenshots inspected at 1440/1100/390px. No page overflow or unexpected browser errors. The existing mobile task strip intentionally scrolls horizontally within its own container.

Browser evidence: `reports/dev09a-complete/browser-result.json`, `cancelled-turn.json`, screenshots, downloaded `EP37 power monitoring SSTS-r2.md`. Draft inspection found the actual power/CAN/100ms input, EE Requirement/Function/SSTS facts, real Trace URIs, explicit proposed/TBC parameters, tests and unresolved gaps. Workflow acceptance is not engineering approval of every generated technical statement.

EE independent real test suite: 11 passed, 5 third-party deprecation warnings. See EE `docs/tasks/verifications/DEV-09A-47-OWNER-BOUNDARY.md` for exact invocation, concurrent section insertion/update locks, reviewer disable/revocation race, receipt isolation and single review side effect.

## Local operation and boundaries

Web: http://127.0.0.1:18090. Only this loopback port is published. API, Runtime, MCP, EE HTTP and both databases stay inside the isolated Compose networks. The verifier service intentionally hosts the real local acceptance processes and retains the fixture for browser use; it is not a production deployment topology.

```powershell
node deploy/build-dev09a-complete.mjs
& 'E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe' deploy/start-dev09a-local.py up -d --build
```

The helper prefers caller environment credentials, then the existing local verifier container configuration, then the pre-existing DSH credential file. It never prints the credential. The user-supplied key has not been written into source, `.env`, reports or DSH configuration. Preserve the local container configuration for reuse, or provide credentials through the process environment.

The environment uses isolated seeded EE accounts/data and pilot authentication, not enterprise SSO or production data. Login values are local acceptance fixtures in the verification script. The key/model endpoint must remain valid for further model calls. Keep Docker Desktop running.

No commits, pushes, remote deployment, DSH Core changes, schema changes, shared database access, original EE worktree edits, global prune or volume deletion were performed. All pending source changes and historical snapshots remain available. DEV-10 and subsequent work are outside this completion.
