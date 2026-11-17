# SSTS Minimum Browser Acceptance Guide

- Environment: local Docker only
- Entry: `http://127.0.0.1:18090`
- Tenant: `tenant_acceptance`
- Account: `pilot.acceptance`
- Password: `LocalAcceptanceSecret123`
- Engine: deterministic SSTS Draft adapter
- Enterprise writes: disabled

## Start

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/start-minimum-acceptance.ps1
```

Only the Web entry is published, and it binds to local loopback:

```text
127.0.0.1:18090 -> pc-web:80
```

The API and PostgreSQL ports remain inside the Docker network.

## Minimum acceptance path

1. Sign in with the prefilled local acceptance account.
2. Create a Task.
3. Attach `PRD` and `ARCHITECTURE` using either **使用样例** or the files in
   `samples/ssts-minimum-test/`.
4. Run **检查输入齐套** and confirm the Task becomes ready.
5. Send one Task message.
6. Generate Draft revision 1.
7. Confirm Validation is `PASSED`, citations include both exact inputs, and the
   Draft is marked `AI DRAFT`.
8. Reject revision 1 with a comment.
9. Generate revision 2.
10. Accept revision 2.
11. Download the Markdown Draft.
12. Refresh the browser and confirm the accepted Task, messages, inputs,
    revisions, review and Draft content recover.

## Expected result

```text
Task state: ACCEPTED
Input count: at least 2
Message count: at least 1
Draft count: 2
Review count: 2
Latest validation: PASSED
Latest revision: 2
Download: Markdown file
```

## Known boundary

This environment validates the product workflow, authorization, persistence,
provenance, review and download. It does not validate real LLM quality,
streaming, Runtime Assignment, Materialization or `START_TURN`; those require
the later Runtime-backed SSTS engine.

## Stop

Preserve test data:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/stop-minimum-acceptance.ps1
```

Remove the acceptance data as well:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/stop-minimum-acceptance.ps1 -RemoveData
```
