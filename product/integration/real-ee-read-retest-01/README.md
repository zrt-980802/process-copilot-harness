# Real EE READ Retest Fixture

This is a development test fixture, not a deployment configuration. See
`../../docs/real-ee-read-retest-01-verification.md` for results and limits.
It uses the read-only dev09a EE tree, its own Compose project, networks,
volumes and loopback ports 18890-18893. `start` refuses existing candidate
containers or volumes. Initialization runs the existing PC and EE schema
initializers only on fresh task databases; it does not change schema sources.

The current retained candidate must not be reseeded. The Python runner supports
`resume`, `update-app`, `browser`, `browser-skip-generic`, `adversarial-a1`,
`outage`, `stop-ee`, `start-ee` and `stop`. Before recreating the two Runtime templates,
`resume` validates and
removes every task-owned dynamic user Runtime container in any state. Its named
state volume is retained and reused when that user Runtime is lazily provisioned
again. Explicit process values
for `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` and `RC_MODEL` override the stale
values retained in stopped containers and are never written to this fixture.
After `stop` scrubs the templates, `resume` requires a fresh process-only
`DEEPSEEK_API_KEY`; the placeholder is never accepted as an active credential.
Each browser/outage execution needs an already executable Provider at start so
that a real EE administrator can sign in and obtain an explicitly authorized
PC Session. A skipped browser scenario is reported PARTIAL, never PASS. `outage`
restores EE in a finally block and preserves failures. Test output excludes
credentials and is written to a new ignored report directory per run. The
model outage check requires a successful turn response, a new durable assistant
message and the same role-bound DOM message; transcript-wide substring matching
is not accepted.

The retained historical failures include `PC_DSH_AUTH` from an invalid model
key. A historical 19-check run used an explicit process-only model credential
and visibly produced an assistant response, but its weak transcript-wide oracle
does not close the hardened model check. Candidates accept only an explicit `DEEPSEEK_API_KEY`
or the dedicated `refs.DEEPSEEK_API_KEY` credential; generic browser-session
credentials are not model credentials and are never used as a fallback. `stop`
stops only this project's containers, enumerates every task-labelled dynamic
Runtime and then validates its tenant/owner/name/mounts before deleting its
container without `-v`, then recreates the two stopped
Runtime templates with a non-secret placeholder. Postconditions require zero
dynamic Runtime containers, stopped placeholder templates and unchanged task
volume fingerprints. Runtime state volumes and evidence are retained; this is
a container-metadata guarantee, not a claim about retained volume contents.
Never point this fixture at shared databases or a historical demo project.

The hardened run `browser-2026-11-25T04-46-11-416Z` passed all 19 checks with
zero page errors. Its outage turn recorded HTTP 200, exact assistant content
`42`, exactly one new visible user/assistant pair with consecutive projection
sequences, matching DOM identity and both EE endpoints stopped. This is local
developer evidence and remains subject to independent retest.

The bounded `adversarial-a1` action creates one current-generation real EE READ
Operation, confirms its owner can retrieve the persisted result, confirms a
different Principal receives HTTP 403 without a result field, and proves result
reads do not redispatch the Provider. Its first run passed data isolation but
also exposed an open audit gap: the API-level Principal scope denial happens
before the Gateway result-delivery guard, so no `RESULT_DELIVERY_DENIED` audit is
appended. The short remediation routes the scope check through Gateway and the
second real A1 run records exactly one denial audit while retaining HTTP 403 and
zero redispatch. A1 does not claim the remaining binding, tampering or in-flight matrix.
