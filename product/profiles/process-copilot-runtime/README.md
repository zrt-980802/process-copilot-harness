# Process Copilot Runtime Profile

DEV-04 fixed profile release layered over DSH `sdk-minimal`.

- DSH version: `0.2.1-rc.3`
- DSH source commit: `1f81c047fc48fa190a683e469daa699857e9afe8`
- General shell and filesystem tools: disabled
- JSONL persistence: inherited from `sdk-minimal`
- Session checkpoint policy: enabled
- Runtime bridge protocol: stock SDK plus private loopback PC Bridge `1.0`
- PC Bridge operations: handshake, Session flush, exact-Session cancel and event history
- Session release: private Bridge disposal of the captured DSH Agent handle
- Runtime finalizers: revoke, drain, executor close and persisted Cleanup Report
- Assignment Guard cache: monotonic authority snapshots from Runtime Host
- Step Guard: fail-closed `agent/pre-step` admission
- Tool Guard: monotonic `tools.guard()` denial immediately before dispatch
- PC Bridge authentication: random per-process secret inherited by Runtime Host and DSH only

The Runtime Host supplies the workspace, `DSH_HOME`, provider, model and exact
patch path. The fixed private plugin captures the Agent handle returned by
public `ctx.agents.create/resume` and uses its idempotent disposer for exact
Session release. This preserves quiescent cancellation, persistence flush and
scoped disposal without modifying DSH Core or extending the stock SDK method
switch.

P0 intentionally contains no dynamic plugin installation and no DSH source modification.
