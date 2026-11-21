# ADR-0025 T0 Contract And Compatibility v1

Date: 2026-11-21 (Asia/Shanghai). Authority: Accepted ADR-0025.
Status: **T0 COMPLETE / T1 NOT STARTED** (local contract developer verification).
Scope: contract fixtures only; no Session, authorization or API behavior changes.

## T0-0 Baseline And Negative Space

- Repository `process-copilot-harness`, main at `894c809a0504eb7424274135c30c17824dd5a858`;
  origin `git@github.com:zrt-980802/process-copilot-harness.git`; initially clean.
- Baseline has 66 contracts. C67-C69 are unoccupied. The first inventory test failed
  with `expected length 69 but got 66` (1 failed, 0 skipped), before definitions changed.
- C01 binds trusted request identity/revision, not authentication assurance or expiry.
- C02 binds a short-lived execution envelope, not the PC login Session lifecycle.
- C03 records an execution authorization snapshot, not a complete authority decision
  or its logical request reuse boundary.
- C41 is the EE decision with source digest/observation; C42 freezes V1/zero migration.
  Neither is a PC Grant or a compatibility mapping release.
- C63 selects a route; it does not record PC/source intersection or a source decision.
- Existing C01-C66 schemas and fixture pairs retain identical Git content. No major semantics change.

Read-only runtime inventory:

| Responsibility | Current call site | T0 disposition |
| --- | --- | --- |
| Local issuance | application/identity-authorization.ts `signInPilot` | unchanged |
| External issuance | `signInExternal`, min(source expiry, DEFAULT_SESSION_TTL_MS) | unchanged |
| Authentication | `authenticate` -> repository/session validator | unchanged |
| Revocation | `signOut` -> repository `revokeSession`; identity revision checks | unchanged |
| Login proof | api/ee-login.ts `exchange`, `validate` | unchanged |
| Online source check | api/main.ts `registerSessionValidator` for `ee:` | RCI-02 unchanged |
| Authority route | application/authority-router.ts `evaluate` | unchanged |
| Source bundle | api/ee-provider-bundle.ts identity/authorization ports | unchanged |

Runtime no-touch set: every tracked file outside contracts, architecture, this task's
verification/governance files and contract-only checks. In particular all files under
`product/apps/`, all other `product/packages/`, `.env*`, deployment, migration, database
and DSH files are immutable. `product/scripts/check-adr0025-t0.mjs` compares their
SHA-256 content to the baseline Git blobs (LF normalized because existing clean
Windows checkouts include CRLF) and checks new paths against an allowlist.
Baseline/current combined fingerprints are emitted by the audit, not stored as credentials.

## T0-1 Session Matrix (C67)

| Authentication method | Provider ref | Identity link/evidence expiry | Assurance |
| --- | --- | --- | --- |
| LOCAL | local | forbidden | LOCAL_VERIFIED |
| STANDALONE | standalone | forbidden | LOCAL_VERIFIED |
| PROVIDER | registered identity ref | required verified link + evidence expiry | PROVIDER_VERIFIED |

`pc_absolute_limit_at` records the configured issue-time upper bound as an absolute
UTC instant. `absolute_expires_at` is immutable for the Session ID and strictly after
issuance, at most `min(pc_absolute_limit_at, authentication_evidence_expires_at)` for
PROVIDER; at most the PC limit for LOCAL/STANDALONE. The bound itself is immutable.

| Event/state | Result |
| --- | --- |
| Issue PROVIDER, provider healthy + current evidence | valid within both bounds |
| Issue/reauthenticate PROVIDER, provider unavailable | Deny |
| Observe active Session, source unavailable | PC-only allowed until fixed expiry |
| Idle renewal while source unavailable | Deny; ordinary observation is not renewal |
| Idle renewal healthy | may adjust idle only within fixed absolute |
| Absolute/evidence/PC bound changed under same ID | invalid, including shortening |
| idle > absolute, absolute <= issued | invalid |
| now >= idle or absolute, expired/revoked, revision mismatch | Deny |
| Reauthentication | new Session ID and freshly verified evidence, never mutation |
| Provider Session ID/cookie/token/secret | forbidden; references are non-secret evidence IDs |

## Decision Matrix (C68)

| Mode | Required conditions for Allow | Provider evidence |
| --- | --- | --- |
| PC_ONLY | active C67 + current PC Allow + PC resource scope Allow; authority pc | forbidden, zero calls |
| PC_AND_PROVIDER | PC Allow + scope Allow + current unique ACTIVE C69 + current generation + current Provider Allow | required reference/observation and exact request binding |
| DENY_UNKNOWN | never Allow | no guessed Provider decision |

Unknown, missing, ambiguous, expired, revoked, incompatible, unavailable or
generation-mismatched inputs have one result: **DENY**. A well-shaped DENY receipt
may omit unavailable Provider evidence; it cannot claim ALLOW. PC Deny wins over
Provider Allow; Provider Deny wins over PC Allow. Discovery/health never imply Allow.
`pc_decision`, `pc_scope_decision`, `provider_decision` explicitly record intersections;
references alone cannot assert a policy result. C68 supplements C03 and C41.

## Action, Authority And Release Matrix (C69)

| Intent | Authority | Mapping | Mode |
| --- | --- | --- | --- |
| conversation.run / personal_task.* / memory.personal.* / profile.use / plugin.use | pc | none | PC_ONLY |
| project.read / requirement.read / function.read / ssts.* / provider tool.execute | declared Provider (EE: eeclaw) | exactly one matching immutable release | PC_AND_PROVIDER |
| unknown action/authority, missing/duplicate/ambiguous mapping | unknown | invalid | DENY_UNKNOWN |
| independent future Provider fixture | its own authority/registration/release | no EE mapping reuse | PC_AND_PROVIDER |

C69 is a code/fixture artifact, not editable roles, membership, grants or cached Allow.
Its permission/action/tool mappings are closed objects with exact protocol keys.
EE compatibility version is `ee-v1`, other fixture-only providers use their own versions.
ACTIVE content is canonical JSON (recursively sorted keys, UTF-8, SHA-256), digest
excluding `artifact_digest`. A changed release requires a new ID, digest and
`supersedes_release_id`; old ACTIVE releases cannot be edited, even with a new digest.

## EE V1 Golden Compatibility Matrix

| Input | Required outcome |
| --- | --- |
| page:* Allow + BASELINE_PAGE_KEYS_V1 member | original baseline Allow |
| page:* + new page / new PC action / new capability | Deny |
| exact Allow + no Deny | role Allow |
| explicit exact/wildcard Deny + Allow | Deny |
| page Allow, missing project membership | Deny |
| member, business-object Deny | Deny |
| page/member/object Allow, Tool Deny | Deny |
| revoke membership/role/action before next request | next request Deny, old receipt cannot replay |
| standalone | no EE mapping, calls or Provider decision |
| C41/C42 | identical schema/fixtures; pinned 8-table/API/audit/page fingerprints |
| zero migration | no tables/rows/grants generated or changed; no write fixture port |

The fixed 16-page baseline includes page:unmapped, excludes page:access-control.
Golden evaluation is a pure contract oracle, **not** a real EE integration result.

## Request Reuse Matrix

| Change | Reuse |
| --- | --- |
| same HTTP logical_request_id, Turn, Tool Call, generation, principal/session/tenant/action/resource | valid only while evidence current |
| HTTP request, Turn, Tool Call or generation changes (including presence/absence) | Deny |
| source revoked/expired/unavailable; mapping release superseded | Deny |
| principal/session/tenant/action/resource changes | Deny |

Source observation must be within the current request and its expiry, bound to the
same mapping release. No Allow survives generation change or a new HTTP request.

## T1-T3 Interfaces And Non-Goals

| Stage | Future input / acceptance boundary | T0 status |
| --- | --- | --- |
| T1 | C67 issuance, fixed expiry/revisions, split local/source validation; PC-owned network zero calls | NOT STARTED |
| T2 | C68 decisions + C69 mapping releases, source request-time intersection | NOT STARTED |
| T3 | real EE outage/recovery/expiry/revocation/relogin acceptance | NOT STARTED |

RCI-02 remains an unfixed runtime blocker. RCI-03 remains an independent unfixed
Operation projection blocker. T0 does not authorize D4B, MEMORY-01B, migrations,
second Provider implementation, cross-instance fan-out, source modifications or deployment.
