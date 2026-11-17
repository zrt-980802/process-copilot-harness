# Runtime Walking Skeleton Research v1

- Status: Implementation recommendation
- Date: 2026-11-09
- DSH baseline: `0.2.1-rc.3`
- DSH commit: `1f81c047fc48fa190a683e469daa699857e9afe8`
- Scope: P1/M3 Runtime Walking Skeleton only
- Related ADRs: ADR-0001 through ADR-0006, ADR-0011 through ADR-0014

## 1. Recommendation

Use the supported DSH process boundary, not an embedded DSH library:

```text
Process Copilot Control Plane
  -> C09 RuntimeCommand
Runtime Host
  -> DshAdapter
  -> DSH TypeScript SDK client
  -> stdio JSON-RPC
DSH child process
  -> fixed PC runtime profile
  -> SDK JSON-RPC server
  -> Session + Agent Loop + JSONL persistence + checkpoint policy
```

The first child profile should derive from `sdk-minimal`, then remove shell and broad filesystem tools and add only the fixed FO SSTS profile components. Runtime Host owns the child process, its environment, DSH home, workspace mount, command serialization, event normalization, health, and teardown.

This preserves the DSH no-intrusion decision: PC imports the published SDK client surface and treats all DSH session events as adapter input, never as stable PC contracts.

## 2. Evidence from the pinned source

| Need | DSH seam | Evidence |
|---|---|---|
| Supported process launch | `dsh --profile <name>` | `apps/cli/README.md`; CLI is the sole supported Node launcher |
| External control | SDK client and stdio JSON-RPC | `packages/sdk/client`, `packages/sdk/protocol`, `packages/sdk/server` |
| Session create | `session/prompt` lazily creates a Session/Agent | `packages/sdk/server/src/server.ts` |
| Session resume | `session/resume` -> `ctx.agents.resume()` | `packages/sdk/server/src/server.ts`; SDK server README |
| Continuous conversation | repeated prompt on one stable `sessionId` | `packages/sdk/client/src/api.ts` |
| Live durable facts | `session.event` notification | SDK protocol types and server subscriptions |
| Live status | `session.status` running/idle | SDK protocol types and server subscriptions |
| Persistence | JSONL Session backend | `packages/session/session-persistence-jsonl` |
| Durability barriers | request/tool/step checkpoint policy | `packages/session/session-checkpoint-policy` |
| Crash repair | interrupted turn and unknown tool outcome repair | `packages/core/session/src/repair.ts` |
| Graceful stop | protocol shutdown, then EOF/SIGTERM/SIGKILL | SDK client README and dispose path |

The fixed source tree remained detached at the pinned commit and no DSH tracked file was modified.

## 3. Command mapping

| PC command | First implementation |
|---|---|
| `QUERY_CAPABILITIES` | Runtime Host static declaration plus successful SDK initialize handshake |
| `QUERY_HEALTH` | child process state, last protocol response, active Session count, event lag |
| `ASSIGN_SESSION` | validate Runtime epoch/generation/fence; reserve local Session slot |
| `START_TURN` | subscribe first, call `session/prompt`, wait for durable receipt and next idle |
| `RESUME_SESSION` | call `session/resume` using the same DSH home and workspace |
| `FLUSH_SESSION` | PC Bridge extension calls `ctx.sessions.flush(session)` |
| `CANCEL_TURN` | PC Bridge extension resolves the live Agent and calls `agent.cancel(..., { keepInbox: true })` |
| `REVOKE_SESSION` | cancel, flush, release mapping, then reject the old generation |
| `DRAIN_RUNTIME` | reject new assignment/turn commands, wait active work, flush, shutdown |
| `TERMINATE_RUNTIME` | graceful shutdown followed by the SDK client's bounded kill ladder |
| `CATCH_UP_EVENTS` | PC Bridge history stream from the requested DSH Session sequence |

`FLUSH_SESSION`, `CANCEL_TURN`, and `CATCH_UP_EVENTS` cannot be truthfully implemented by the stock SDK protocol. They require an out-of-tree PC Runtime Bridge plugin or an accepted upstream SDK protocol addition.

## 4. Two-stage implementation

### Stage P1-A: stock SDK spike

Deliver an executable spike using the unmodified `sdk-minimal` protocol:

1. Runtime Host launches one child with an isolated `DSH_HOME`;
2. initialize with a fixed provider/model and workspace;
3. create a stable PC Session to DSH Session mapping;
4. run two prompts on the same Session;
5. normalize new `session.event` notifications into C25;
6. stop the child;
7. launch a replacement child with the same durable home;
8. resume the Session and run a third prompt.

P1-A proves process ownership, profile boot, prompt flow, persistence, resume, event normalization, and health. It must not claim full C09 support.

### Stage P1-B: PC Runtime Bridge plugin

Build one fixed out-of-tree plugin loaded by the PC runtime profile. It exposes only PC-owned operations:

```text
pc.bridge/handshake
pc.bridge/session.flush
pc.bridge/session.cancel
pc.bridge/session.events
pc.bridge/session.release
```

The plugin may use DSH public Cordis services inside the child process:

- `ctx.sessions.flush(session)` for durability;
- live Agent cancellation for the exact Session;
- Session Query/history observation for catch-up;
- `session/event` for ordered live export;
- the current profile/plugin inventory for capability evidence.

The plugin must not read the PC database, decide PC authorization, or expose raw DSH errors as stable error codes.

Transport recommendation:

1. keep the stock SDK stdio channel for initialize, prompt, resume, wait, and shutdown;
2. use a private loopback or named-pipe JSON-RPC side channel for PC Bridge control;
3. generate a per-process random endpoint and secret, inherited only by Runtime Host and the child;
4. bind the bridge handshake to runtime id, runtime epoch, bridge protocol version, profile digest, and process identity.

Using a separate channel avoids forking the stock SDK server's closed method switch and avoids corrupting stdout, which is exclusively reserved for SDK JSON-RPC.

## 5. Event normalization and recovery

DSH `SessionEvent` is adapter input, not C25.

The normalizer should emit:

```text
event_id = hash(runtime_id, runtime_epoch, dsh_session_id, dsh_session_seq, payload_digest)
producer = pc-runtime-bridge
runtime_id / runtime_epoch
pc_session_id
dsh_session_id
dsh_session_seq = DSH event.seq
runtime_event_seq = Runtime Host monotonic export sequence
assignment_generation
fencing_token
durability = DURABLE_DSH after the flush/catch-up boundary
payload = allowlisted normalized payload
```

Rules:

- Inbox uniqueness is `event_id`;
- ordering authority is `(dsh_session_id, dsh_session_seq)`, not timestamps;
- live delivery can be `OBSERVED` until a flush confirms durability;
- catch-up starts at the last acknowledged DSH sequence;
- duplicates are accepted and ignored by the Inbox;
- gaps quarantine the Session projection and trigger `CATCH_UP_EVENTS`;
- unknown DSH event types are retained as diagnostic evidence or ignored, never promoted to business facts automatically.

## 6. Fencing and command admission

Runtime Host must validate before dispatch:

1. `runtime_id` and `runtime_epoch` match the local process;
2. Assignment is active;
3. `assignment_generation` equals the current generation;
4. `fencing_token` matches;
5. `command_id` has not completed before;
6. expected state/version matches;
7. deadline has not expired.

The child process receives no authority to overwrite Assignment. A stale command is rejected locally and never reaches DSH.

P1 should enforce one active root turn per Session. Parallel Sessions may be enabled only after command ordering, event cursors, and capacity accounting are proven.

## 7. Profile and workspace

Create one immutable `process-copilot-runtime` profile release:

- based on the standalone SDK composition;
- JSONL Session persistence with compression disabled for pilot diagnostics;
- checkpoint policy enabled;
- fixed FO instructions and output contract;
- no shell, browser, generic filesystem write, plugin manager, HMR, or dynamic install;
- workspace access only through a materialized Session view;
- no long-lived enterprise credential;
- exact bundle lock, profile digest, DSH commit, and bridge protocol in C07.

Profile changes require a new Release and a new Runtime or explicit Session migration. An active Session never hot-swaps its profile.

## 8. Risks and decisions

| Risk | Effect | Required control |
|---|---|---|
| SDK protocol has no version negotiation | silent drift | bridge handshake validates exact SDK/DSH/profile tuple |
| SDK has no cancel/flush/history methods | incomplete C09 semantics | Stage P1-B bridge plugin before P1 exit |
| resume does not replay old notifications | event gap after crash | catch-up history endpoint plus Inbox cursor |
| stock `sdk-minimal` grants broad shell access | unsuitable for product workload | fixed restricted PC profile |
| stdout is the SDK protocol | framing corruption | diagnostics only on stderr; bridge uses separate channel |
| child death mid-tool | external outcome may be unknown | no enterprise write tools in MVP; preserve C29 recovery classification |
| JSONL is Runtime-local | replacement host may not see history | pilot uses durable per-user volume; production storage decision remains explicit |
| one child can own multiple Sessions | cancellation/drain blast radius | capacity limits and staged concurrency |

## 9. P1 exit gate

P1 is complete only when automated tests prove:

- two prompts run on one Session and preserve history;
- stale runtime epoch, generation, and fence are rejected before DSH dispatch;
- duplicate event export does not duplicate Inbox state;
- a forced event gap is repaired from a cursor;
- child termination followed by replacement resumes the Session;
- cancel reaches the exact live Session without killing unrelated Sessions;
- flush proves the acknowledged DSH prefix is durable;
- drain rejects new work and reaches quiescence;
- all DSH errors map to stable C31 codes;
- DSH source and EE Claw source remain unchanged.

## 10. Implementation order

1. `runtime-adapter`: command state machine, idempotency, fencing, stable errors;
2. `runtime-host`: child lifecycle, health, capacity, drain, kill ladder;
3. stock SDK P1-A spike and recovery fixture;
4. fixed restricted runtime profile;
5. PC Runtime Bridge plugin and side channel;
6. event normalizer, cursor, Inbox dedupe, gap repair;
7. crash/cancel/flush/drain integration tests;
8. compatibility declaration promoted from planned to verified.

