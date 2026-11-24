# Real EE READ Retest Fixture

This is a development test fixture, not a deployment configuration. See
`../../docs/real-ee-read-retest-01-verification.md` for results and limits.
It uses the read-only dev09a EE tree, its own Compose project, networks,
volumes and loopback ports 18890-18893. `start` refuses existing candidate
containers or volumes. Initialization runs the existing PC and EE schema
initializers only on fresh task databases; it does not change schema sources.

The current retained candidate must not be reseeded. The Python runner supports
`browser`, `browser-skip-generic`, `outage`, `stop-ee`, `start-ee` and `stop`.
Each browser/outage execution needs an already executable Provider at start so
that a real EE administrator can sign in and obtain an explicitly authorized
PC Session. A skipped browser scenario is reported PARTIAL, never PASS. `outage`
restores EE in a finally block and preserves failures. Test output excludes
credentials and is written to a new ignored report directory per run.

The current model-backed turn is blocked by `PC_DSH_AUTH` both online and
offline; the DSH turn-end event reports model-provider HTTP 401 and an invalid
key. New candidates accept only an explicit `DEEPSEEK_API_KEY` or the dedicated
`refs.DEEPSEEK_API_KEY` credential; generic browser-session credentials are not
model credentials and are never used as a fallback. `stop` stops only
this project's containers and task-labelled user Runtimes; volumes and evidence
are retained. Never point this fixture at shared databases or a historical
demo project.
