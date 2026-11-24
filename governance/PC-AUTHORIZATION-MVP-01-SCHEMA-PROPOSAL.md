# PC-AUTHORIZATION-MVP-01: PC-owned schema approval proposal

Date: 2026-11-23 (Asia/Shanghai).
Status: APPROVED by the user on 2026-11-23 (Asia/Shanghai); implemented and locally verified on 2026-11-24.
Live task record: `../product/docs/pc-authorization-mvp-01-verification.md`.

This proposal was prepared at the required T1B schema gate. The user's subsequent
explicit approval authorized only the PC schema and isolated implementation/tests
described here. Existing candidates and shared/production databases are excluded.

## 1. Why existing storage is insufficient

Actual source: `product/packages/persistence/src/identity-authorization-postgres.ts`.
The current pc_pilot_session table contains only authentication_context_id,
principal_id, token_digest, issued_at, expires_at and revoked_at. It has no JSON
payload or generic extension column. Its repository insert/select functions
persist exactly those fields. Memory reconstruction cannot prove PostgreSQL
persistence of data the database never recorded.

The Principal and ExternalIdentityLink tables hold current revisions, not the
identity, link and authorization revisions observed at Session issuance.
After a change, copying current revisions onto an old Session would invent its
issuance evidence and defeat revision invalidation. The current expires_at is
already fixed and capped by min(source expiry, eight hours), but it does not
retain the original external evidence expiry or issue-time PC cap separately.
Those distinct facts cannot safely be inferred from the resulting minimum.

C67 also requires an independent PC Session ID, authentication method, assurance
level, safe evidence, digest and lifecycle state. The existing authentication
context can contain a source-session reference; it must not become C67's PC
Session ID. Storing C67 in another domain's event/resource payload or encoding it
into the authentication-context string would change ownership and validation
semantics without solving durable Session lifecycle consistency.

Conclusion: complete T1B requires an explicit, additive PC-owned schema change.
It cannot be delivered through an in-memory cache or a no-schema runtime patch.

## 2. Proposed schema surface

Add one PC-owned table, pc_session_assurance, alongside pc_pilot_session. Keep
the existing table, indexes and all legacy rows. No EE table is involved.
Do not add an External Authority Binding table: T2B remains a composed view.
Do not add a Mapping table: T2C uses immutable code/fixture C69 releases.

Proposed columns, before any implementation:

| Column | PostgreSQL type / requirement | Purpose |
| --- | --- | --- |
| session_assurance_id | TEXT PRIMARY KEY | PC-issued C67 ID |
| pc_session_id | TEXT NOT NULL UNIQUE | Random opaque PC Session ID, independent of Provider and Runtime Session IDs |
| authentication_context_id | TEXT NOT NULL UNIQUE REFERENCES pc_pilot_session, ON DELETE RESTRICT | Internal one-to-one association; not serialized into C67 |
| principal_id | TEXT NOT NULL REFERENCES pc_principal, ON DELETE RESTRICT | PC owner |
| tenant_id | TEXT NOT NULL | PC tenant, checked against the current Principal |
| authentication_method | TEXT NOT NULL | LOCAL, STANDALONE or PROVIDER |
| identity_provider_ref | TEXT NOT NULL | Exact identity method/provider |
| identity_link_id | TEXT NULL REFERENCES pc_external_identity_link, ON DELETE RESTRICT | Verified Provider link; absent for LOCAL/STANDALONE C67 |
| identity_link_revision | BIGINT NULL | Issue-time link revision, internal metadata outside the unchanged C67 shape |
| pilot_account_id | TEXT NULL REFERENCES pc_pilot_account, ON DELETE RESTRICT | Internal local-account association; supports current native-account status checks |
| identity_revision | BIGINT NOT NULL | Principal identity revision at issuance |
| authorization_revision | BIGINT NOT NULL | PC authorization revision at issuance |
| assurance_level | TEXT NOT NULL | LOCAL_VERIFIED or PROVIDER_VERIFIED |
| issued_at | TIMESTAMPTZ NOT NULL | Immutable issuance time |
| idle_expires_at | TIMESTAMPTZ NULL | Optional C67 idle bound |
| pc_absolute_limit_at | TIMESTAMPTZ NOT NULL | Immutable issue-time PC cap |
| authentication_evidence_expires_at | TIMESTAMPTZ NULL | Verified source-evidence expiry for PROVIDER |
| absolute_expires_at | TIMESTAMPTZ NOT NULL | Immutable final upper bound |
| revoked_at | TIMESTAMPTZ NULL | PC revocation time |
| session_state | TEXT NOT NULL | ACTIVE, EXPIRED or REVOKED |
| evidence_refs | JSONB NOT NULL | Nonempty safe pc: references, never source secrets |
| assurance_digest | TEXT NOT NULL | C67 canonical SHA-256 digest |
| record_version | BIGINT NOT NULL DEFAULT 1 | Internal lifecycle compare-and-swap version |

Proposed constraints:

- Positive identity, authorization, link (when present) and record revisions.
- Closed enums for method, assurance and lifecycle state; nonempty identifiers.
- issued_at < absolute_expires_at <= pc_absolute_limit_at.
- If present, issued_at < idle_expires_at <= absolute_expires_at.
- PROVIDER requires link ID/revision and external evidence expiry; its absolute
  bound is no later than that evidence expiry, assurance is PROVIDER_VERIFIED,
  identity_provider_ref is neither local nor standalone, and pilot_account_id
  is absent.
- LOCAL/STANDALONE require LOCAL_VERIFIED and their exact method/provider pair;
  Provider link/revision/evidence-expiry fields are absent. The current native
  account implementation records pilot_account_id as internal metadata; its
  owner, tenant and active status are checked locally on authentication.
- REVOKED requires revoked_at; other states forbid it.
- evidence_refs is a nonempty JSON array. C67 schema/semantic validation also
  checks unique pc: references, closed fields and canonical digest on read/write.
- assurance_digest matches the existing sha256:<64 lowercase hex> format.
- Foreign keys prevent dangling Session/Principal/account/link references.
  Cross-row owner/tenant/method consistency is enforced by repository joins and
  issuance transactions, not misrepresented as a PostgreSQL row CHECK.

Proposed non-unique indexes:

1. (principal_id, tenant_id, session_state, absolute_expires_at), for scoped
   Session status/revocation.
2. Partial (identity_link_id, identity_link_revision) WHERE identity_link_id IS
   NOT NULL, for local link invalidation/diagnostics.

Primary/unique constraints provide the assurance ID, PC Session ID and legacy
authentication-context lookup indexes. No new Grant, EE role, membership,
Provider Allow or credential table/index is proposed. Internal metadata is not
added to C67-C69 contracts and cannot independently establish Allow.

## 3. Upgrade and repository behavior after approval

1. Add a versioned PC-owned migration under persistence/migrations/identity and
   wire the repository initialization through the same versioned definition.
   Initialization must detect incompatible partial schemas, not silently accept
   them through CREATE TABLE IF NOT EXISTS alone. Existing migration source and
   contract artifacts must remain compatible; no destructive DDL is required.
2. Apply only to a newly provisioned, task-owned isolated PostgreSQL database.
   Capture its ownership labels, image, migration fingerprint and safe before/
   after schema fingerprints. Existing real-EE/demo/test databases are not
   migration targets for this task.
3. Add memory and PostgreSQL repository methods for atomic Session+C67 issuance,
   local lookup and transactional revocation. Lock/recheck the Principal and
   selected account/link at issuance so their revisions cannot be sampled from
   inconsistent generations. Failed C67 validation rolls back the token row too.
4. Mint a fresh opaque pc_session_id and session_assurance_id. Keep bearer Token
   storage as a digest in the existing Session table. Do not serialize source
   Session IDs, Cookies, Tokens or credential references into C67 or the UI.
5. Preserve the existing eight-hour default PC maximum; no .env or version/port
   changes. External absolute expiry is min(verified evidence expiry, issue-time
   PC cap). C67 and legacy expires_at must agree. For the MVP there is no sliding
   renewal; idle can be absent or fixed to the absolute bound. Reauthentication
   requires current authentication and a new PC Session ID.
6. Local authentication validates C67 schema/digest/bounds/state, active Principal,
   exact tenant/owner, issue-time revisions and current local account/link facts.
   A missing, ambiguous, revoked, changed or unknown association denies. Provider
   Health is not required for PC-owned actions. Source-owned actions additionally
   require fresh current source authorization and existing execution guards.
7. Only bounded lifecycle methods may update state/revoked_at/idle bound and
   digest using record_version CAS. They cannot alter Session ID, method, owner,
   issuance time, original caps/evidence expiry or issue-time revision bindings.
   Sign-out updates both records transactionally. Partial/digest-inconsistent
   states fail closed; no automatic re-enrollment repairs missing assurance.
8. Retain all existing Session/evidence rows. No cleanup job or data deletion.

## 4. Existing Session compatibility

Fail-closed cutover is proposed: a Session without C67 is not silently upgraded.
Return stable reauthentication-required denial, clear the browser's stale login
state through the existing login flow, and allow explicit local logout/revocation.
Do not sample today's revisions or infer source evidence expiry to backfill it.

Old rows remain as historical evidence with their original fixed expires_at.
They are not extended, converted from Provider to Local, or accepted through a
legacy grace window. A fresh local login must validate current native credentials;
a fresh Provider login must validate current source proof. Provider unavailability
cannot create, renew or reauthenticate a Provider-backed Session.

The old authentication-context key remains internal storage compatibility only.
C67.pc_session_id identifies the PC login Session; existing Runtime/Assignment
session IDs keep their separate meaning and protocol. C68 and safe audit link
those scopes explicitly rather than replacing Runtime IDs.

## 5. Rollback and recovery

This proposal authorizes no rollback now. After approval, schema installation
must use transactional additive DDL and fail without a partial table/index set.
The MVP is single-API local development; mixed old/new writers are not supported.

- On migration failure, roll back the DDL transaction and preserve diagnostics.
- On implementation failure, stop only the new MVP candidate and retain its
  PostgreSQL volume and evidence. Do not point an old permissive binary at a
  database with live new Sessions as a hot fallback.
- A restored pre-upgrade snapshot remains offline until an explicitly authorized
  recovery procedure revokes old bearer Sessions and verifies the selected code
  and schema pairing. Never restore a snapshot as an implicit way to revive
  revoked or revision-stale Sessions.
- The normal safe rollback is code/candidate rollback with additive assurance
  data retained. No automated DROP TABLE, DROP COLUMN, down migration, schema
  rewrite, Token recovery or volume deletion is proposed.
- Reapplying the approved migration must be idempotent with the exact schema
  fingerprint. A mismatched schema requires intervention, not destructive repair.

## 6. Isolated PostgreSQL / API restart test plan

After schema approval only, provision fresh task-labeled PostgreSQL resources,
generated runtime-only credentials and dynamically assigned loopback endpoints.
Do not reuse, restart or delete RCI-03 PostgreSQL resources, real-EE closure
resources or the 18591/18592 demo. No database port/config change is made to an
existing candidate.

Required real-database tests:

1. Apply migration twice; compare tables, constraints and indexes; reject an
   incompatible partial schema without destructive repair.
2. Issue native and Provider-backed Sessions atomically with exact C67/digest;
   interrupt issuance inside its transaction and prove no usable orphan token.
3. Restart the API, retaining the same database; authenticate using persisted
   C67, identical IDs, digest, revisions and immutable expiry.
4. Close all pools, restart only the newly owned PostgreSQL container, verify
   the same system identifier and mounted volume with a later postmaster start,
   refresh its assigned endpoint and reopen repositories.
5. Recheck valid, absolute/idle-expired, revoked, disabled-account, changed
   identity/link/authorization-revision and legacy-without-C67 Sessions. None
   can acquire a later expiry or survive a disqualifying change after restart.
6. Concurrent revoke/authenticate and CAS lifecycle tests: no lost revoke or
   overwritten immutable bounds, audit links remain reconstructible.
7. Measure all Provider Port counters at zero for PC-only identity/Task/
   conversation/Policy paths; run separate real EE checks only when the existing
   authorized EE fixture becomes available. Synthetic ports are unit evidence.
8. Re-run RCI-03 replay/in-flight revocation, T0 compatibility and final pnpm
   check. Preserve existing conditional-skip distinctions.

Stop only processes/resources started by this task; retain all new and old
containers, volumes, networks and evidence. A database restart result must come
from this real PostgreSQL test, not memory repository reconstruction.

## 7. Approval boundary

Approval requested: the PC-owned table/constraints/indexes and isolated upgrade/
recovery testing described above, plus the corresponding PC repository/domain
implementation. No EE schema/API/permission changes, shared or production
database access, DSH Core, .env, existing ports, technology versions, D4B,
MEMORY-01B, push, deployment or cleanup are included.

The user explicitly approved PC-AUTHORIZATION-MVP-01's PC-owned schema changes
after reviewing this proposal. This approval applies to the scope above, not EE,
shared/production databases, existing candidates or destructive rollback.
Before approval, only this proposal and the live document had changed; no DDL
or runtime change was performed. Subsequent execution is recorded in the live log.
