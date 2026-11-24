# PC authorization MVP acceptance remediation

Date: 2026-11-24 (Asia/Shanghai). Starting baseline: main at
`a80cb9ed90533f1dd8dde62e4da39acd3be2d3bf`; origin/main at
`e594699d67f3f3e24c06fb688a2322ae70730dda`, ahead 5, clean worktree.

## Security and regression

Before the fix, `pnpm exec vitest run apps/api/tests/provider-retry-authorization.test.ts`
failed: unauthenticated POST returned 200 instead of 401 and invoked the retry.
The test uses actual in-memory PC identity, C67 and C68 services, with synthetic
accounts and a retry spy; it is not a real EE test.

The endpoint now requires a current PC Session and a C68 PC-only ALLOW for
`provider.manage` on the server-selected `global:*` scope. An explicit global
allow for that action is required; a wildcard action alone does not grant it.
The policy still honors matching deny grants. Client request data cannot choose
the principal, action, scope, or resource authority. Authorization decisions
are recorded through the existing C68 audit path. The UI sends its current
Bearer Session. No administrative grant is automatically provisioned; an
operator must already have the explicit PC grant to retry.

The security test covers missing credentials (401, no retry), an ordinary
account (403, no retry), the explicit administrator grant (200, one retry),
audit linkage, stale Session rejection after grant changes, and wildcard-only
grant denial. D4A tests authenticate through the same PC services and cover
configuration, transport, timeout, inactive states and single-flight behavior.
The isolated main-process startup test checks unauthenticated retry is denied.

## Verification

- Focused retry, D4A, C67 and C68 suites: 70 passed, 0 skipped.
- `pnpm check`: 628 passed, 17 conditional skips; lint, typecheck, builds,
  generated checks, 25 ADR / 69 contract traceability and compatibility passed.
- T0: 220 protected files and 207 contract artifacts unchanged; drift 0.
- D4A production browser: desktop and mobile, two checks using synthetic HTTP
  responses; the fixture requires the current synthetic Bearer Session.
- `git diff --check` passed. Real EE, T3, deployments and remote push were not
  performed. No schema or database changes were needed.

This is developer verification for the short remediation, not independent
retest or real EE acceptance. RCI-02/RCI-03 real EE retests and T3 remain pending.
