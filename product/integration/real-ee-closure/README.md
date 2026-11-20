# Real EE Integration Candidate

Status: BLOCKED. See `../../docs/real-ee-integration-closure-01.md` before running.
This is a local task fixture, not production deployment configuration.

The runner only targets Compose project `pc-real-ee-closure-01`. EE is loaded
read-only from `E:/shanzi_workspace/feishu-ee-agents-dev09a`. All database and
Runtime volumes belong to this task. Standalone has a separate PostgreSQL,
data volume and control network. No database port is published.

From `product/`, using the Python environment recorded in workspace.paths.json:

```powershell
pnpm --filter @pc/web build
python integration/real-ee-closure/run.py start
python integration/real-ee-closure/run.py browser
```

`start` refuses an existing candidate, creates random runtime-only credentials,
builds PC from local source, initializes existing EE schemas in the fresh task
database and seeds explicit PC policies after real EE login/ticket exchange.
The synthetic engineering records are real persisted EE data. No mocked API,
MCP response, Runtime, authorization decision or AI output is used.

The current candidate already exists. Do not rerun `start` or `resume` to
overwrite it. `browser` reads only this candidate's runtime credentials into
its process environment, never prints or persists them, and writes a new
timestamped evidence directory. It now asserts the visible Business Operation
state directly. It is expected to fail on the recorded VERIFYING defect until
that defect is separately repaired. The original failure evidence is retained.

Current loopback endpoints:

- Standalone PC: http://127.0.0.1:18790/
- EE-connected PC: http://127.0.0.1:18791/
- Actual EE API: http://127.0.0.1:18792/api/health
- Actual MCP: http://127.0.0.1:18793/health (MCP calls require service authentication).

`revoke` and `restore` change only the fixture engineer's RCI-FULLA membership
through HarnessStore. `stop-ee`/`start-ee` affect only this candidate's EE
services. The browser runner restores fault/membership fixtures in `finally`.
`stop` stops only task containers and task-labeled user Runtimes; it deletes no
volumes. `snapshot` and `audit.py` record source/configuration/data hashes.

`update-api` is a scoped rebuild/recreation of this candidate's PC API only.
`manager` updates the task fixture manager mount. `runtime-config` was a
preflight repair for a blank model endpoint; it recreates only this candidate's
template Runtimes and task-labeled user Runtime containers, retaining their
volumes. These are explicit environment controls, not product fixes or
automatic recovery logic. Do not use them on historical/demo stacks.

The D4A health TTL is short and requires an explicit retry before a new EE
observation; the browser runner does this. Core readiness HTTP200 does not mean
the Provider remains executable indefinitely. No background polling is added.
The task did not establish a successful real-model conversation or release
qualification. No D4B or MEMORY-01B work is authorized by this fixture.
