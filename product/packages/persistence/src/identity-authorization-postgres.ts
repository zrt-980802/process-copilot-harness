import { randomUUID } from "node:crypto";
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResultRow
} from "pg";
import type {
  IdentityAuthorizationRepository,
  ExternalIdentityKey,
  ExternalIdentityBinding,
  ProvisionPilotAccountInput,
  ReplaceAuthorizationGrantsInput,
  VerifiedIdentityLinkInput
} from "@pc/application";
import type {
  AuthorizationGrant,
  ExternalIdentityLink,
  PCPrincipal,
  PilotAccount,
  PilotSession
} from "@pc/domain";
import { IdentityAuthorizationError } from "@pc/domain";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS pc_principal (
  principal_id TEXT PRIMARY KEY,
  principal_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  primary_identity_ref TEXT NOT NULL,
  identity_revision BIGINT NOT NULL,
  authorization_revision BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pc_external_identity_link (
  identity_link_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES pc_principal(principal_id) ON DELETE RESTRICT,
  identity_provider_ref TEXT NOT NULL,
  issuer TEXT NOT NULL,
  external_subject TEXT NOT NULL,
  tenant_or_org_ref TEXT NOT NULL,
  link_method TEXT NOT NULL,
  verification_level TEXT NOT NULL,
  status TEXT NOT NULL,
  identity_link_revision BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (issuer, external_subject, tenant_or_org_ref)
);

CREATE TABLE IF NOT EXISTS pc_pilot_account (
  pilot_account_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES pc_principal(principal_id) ON DELETE RESTRICT,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, account_key)
);

CREATE TABLE IF NOT EXISTS pc_pilot_session (
  authentication_context_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES pc_principal(principal_id) ON DELETE RESTRICT,
  token_digest TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pc_pilot_session_principal_expiry
  ON pc_pilot_session(principal_id, expires_at);

CREATE TABLE IF NOT EXISTS pc_authorization_grant (
  grant_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES pc_principal(principal_id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  effect TEXT NOT NULL,
  evidence_ref TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_authorization_grant_principal
  ON pc_authorization_grant(principal_id, action, scope_type, scope_id);
`;

interface PrincipalRow extends QueryResultRow {
  principal_id: string;
  principal_type: PCPrincipal["principal_type"];
  tenant_id: string;
  lifecycle_status: PCPrincipal["lifecycle_status"];
  primary_identity_ref: string;
  identity_revision: string | number;
  authorization_revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LinkRow extends QueryResultRow {
  identity_link_id: string;
  principal_id: string;
  identity_provider_ref: string;
  issuer: string;
  external_subject: string;
  tenant_or_org_ref: string;
  link_method: ExternalIdentityLink["link_method"];
  verification_level: ExternalIdentityLink["verification_level"];
  status: ExternalIdentityLink["status"];
  identity_link_revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AccountRow extends QueryResultRow {
  pilot_account_id: string;
  tenant_id: string;
  account_key: string;
  principal_id: string;
  secret_hash: string;
  status: PilotAccount["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface SessionRow extends QueryResultRow {
  authentication_context_id: string;
  principal_id: string;
  token_digest: string;
  issued_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

interface GrantRow extends QueryResultRow {
  grant_id: string;
  principal_id: string;
  action: string;
  scope_type: AuthorizationGrant["scope_type"];
  scope_id: string;
  effect: AuthorizationGrant["effect"];
  evidence_ref: string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function principalFromRow(row: PrincipalRow): PCPrincipal {
  return {
    principal_id: row.principal_id,
    principal_type: row.principal_type,
    tenant_id: row.tenant_id,
    lifecycle_status: row.lifecycle_status,
    primary_identity_ref: row.primary_identity_ref,
    identity_revision: Number(row.identity_revision),
    authorization_revision: Number(row.authorization_revision),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at)
  };
}

function linkFromRow(row: LinkRow): ExternalIdentityLink {
  return {
    identity_link_id: row.identity_link_id,
    principal_id: row.principal_id,
    identity_provider_ref: row.identity_provider_ref,
    issuer: row.issuer,
    external_subject: row.external_subject,
    tenant_or_org_ref: row.tenant_or_org_ref,
    link_method: row.link_method,
    verification_level: row.verification_level,
    status: row.status,
    identity_link_revision: Number(row.identity_link_revision),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at)
  };
}

function accountFromRow(row: AccountRow): PilotAccount {
  return {
    pilot_account_id: row.pilot_account_id,
    tenant_id: row.tenant_id,
    account_key: row.account_key,
    principal_id: row.principal_id,
    secret_hash: row.secret_hash,
    status: row.status,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at)
  };
}

function sessionFromRow(row: SessionRow): PilotSession {
  return {
    authentication_context_id: row.authentication_context_id,
    principal_id: row.principal_id,
    token_digest: row.token_digest,
    issued_at: iso(row.issued_at),
    expires_at: iso(row.expires_at),
    ...(row.revoked_at === null ? {} : { revoked_at: iso(row.revoked_at) })
  };
}

function grantFromRow(row: GrantRow): AuthorizationGrant {
  return {
    grant_id: row.grant_id,
    principal_id: row.principal_id,
    action: row.action,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    effect: row.effect,
    evidence_ref: row.evidence_ref
  };
}

async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresIdentityAuthorizationRepository
implements IdentityAuthorizationRepository {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(config: string | PoolConfig | Pool) {
    if (config instanceof Pool) {
      this.pool = config;
      this.ownsPool = false;
    } else {
      this.pool = new Pool(
        typeof config === "string" ? { connectionString: config } : config
      );
      this.ownsPool = true;
    }
  }

  async initialize(): Promise<void> {
    await this.pool.query(MIGRATION);
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }

  async resolveExternalPrincipal(input: ExternalIdentityKey, now: string): Promise<ExternalIdentityBinding> {
    return transaction(this.pool, async client => {
      // Serialize enrollment by the actual issuer/subject/tenant, including the
      // first login where there is no row to lock yet.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([input.issuer, input.external_subject, input.tenant_or_org_ref])]);
      const found = await client.query<LinkRow>(`SELECT * FROM pc_external_identity_link
        WHERE issuer=$1 AND external_subject=$2 AND tenant_or_org_ref=$3 FOR UPDATE`,
      [input.issuer, input.external_subject, input.tenant_or_org_ref]);
      let link = found.rows[0];
      if (link && (link.status !== "verified" || link.identity_provider_ref !== input.identity_provider_ref)) {
        throw new IdentityAuthorizationError("PC_IDENTITY_LINK_UNVERIFIED", "Existing identity link is unavailable");
      }
      if (!link) {
        const principalId = randomUUID(), linkId = randomUUID();
        await client.query(`INSERT INTO pc_principal(principal_id,principal_type,tenant_id,lifecycle_status,
          primary_identity_ref,identity_revision,authorization_revision,created_at,updated_at)
          VALUES($1,'human',$2,'active',$3,1,1,$4,$4)`, [principalId, input.tenant_or_org_ref, linkId, now]);
        const created = await client.query<LinkRow>(`INSERT INTO pc_external_identity_link(identity_link_id,principal_id,
          identity_provider_ref,issuer,external_subject,tenant_or_org_ref,link_method,verification_level,status,
          identity_link_revision,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,'signed_idp_callback','signed_idp_callback','verified',1,$7,$7) RETURNING *`,
        [linkId, principalId, input.identity_provider_ref, input.issuer, input.external_subject, input.tenant_or_org_ref, now]);
        link = created.rows[0]!;
      }
      const principal = await client.query<PrincipalRow>("SELECT * FROM pc_principal WHERE principal_id=$1", [link.principal_id]);
      const aliases = await client.query<{ account_key: string }>("SELECT account_key FROM pc_pilot_account WHERE principal_id=$1 ORDER BY account_key", [link.principal_id]);
      return { principal: principalFromRow(principal.rows[0]!), identity_link: linkFromRow(link), legacy_account_keys: aliases.rows.map(a => a.account_key) };
    });
  }

  async listExternalBindings(provider: string, issuer: string, tenant: string): Promise<ExternalIdentityBinding[]> {
    const links = await this.pool.query<LinkRow>(`SELECT * FROM pc_external_identity_link
      WHERE identity_provider_ref=$1 AND issuer=$2 AND tenant_or_org_ref=$3 ORDER BY external_subject`, [provider, issuer, tenant]);
    return Promise.all(links.rows.map(async link => {
      const principal = await this.getPrincipal(link.principal_id);
      const aliases = await this.pool.query<{ account_key: string }>("SELECT account_key FROM pc_pilot_account WHERE principal_id=$1 ORDER BY account_key", [link.principal_id]);
      return { principal: principal!, identity_link: linkFromRow(link), legacy_account_keys: aliases.rows.map(a => a.account_key) };
    }));
  }

  async revokeSession(contextId: string, now: string): Promise<void> {
    await this.pool.query("UPDATE pc_pilot_session SET revoked_at=$2 WHERE authentication_context_id=$1 AND revoked_at IS NULL", [contextId, now]);
  }

  provisionPilotAccount(
    input: ProvisionPilotAccountInput & { readonly secret_hash: string },
    now: string
  ): Promise<{
    principal: PCPrincipal;
    identity_link: ExternalIdentityLink;
    pilot_account: PilotAccount;
  }> {
    return transaction(this.pool, async (client) => {
      const principalId = randomUUID();
      const linkId = randomUUID();
      try {
        const principalResult = await client.query<PrincipalRow>(
          `INSERT INTO pc_principal (
             principal_id, principal_type, tenant_id, lifecycle_status,
             primary_identity_ref, identity_revision, authorization_revision,
             created_at, updated_at
           ) VALUES ($1, 'human', $2, 'active', $3, 1, 1, $4, $4)
           RETURNING *`,
          [principalId, input.tenant_id, linkId, now]
        );
        const linkResult = await client.query<LinkRow>(
          `INSERT INTO pc_external_identity_link (
             identity_link_id, principal_id, identity_provider_ref, issuer,
             external_subject, tenant_or_org_ref, link_method,
             verification_level, status, identity_link_revision,
             created_at, updated_at
           ) VALUES (
             $1, $2, 'pc-pilot', 'process-copilot', $3, $4,
             'pilot_bootstrap', 'pilot_bootstrap', 'verified', 1, $5, $5
           ) RETURNING *`,
          [linkId, principalId, input.account_key, input.tenant_id, now]
        );
        const accountResult = await client.query<AccountRow>(
          `INSERT INTO pc_pilot_account (
             pilot_account_id, tenant_id, account_key, principal_id,
             secret_hash, status, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)
           RETURNING *`,
          [
            randomUUID(),
            input.tenant_id,
            input.account_key,
            principalId,
            input.secret_hash,
            now
          ]
        );
        return {
          principal: principalFromRow(principalResult.rows[0] as PrincipalRow),
          identity_link: linkFromRow(linkResult.rows[0] as LinkRow),
          pilot_account: accountFromRow(accountResult.rows[0] as AccountRow)
        };
      } catch (error) {
        if (
          typeof error === "object"
          && error !== null
          && "code" in error
          && error.code === "23505"
        ) {
          throw new IdentityAuthorizationError(
            "PC_PILOT_ACCOUNT_EXISTS",
            "Pilot account or identity link already exists"
          );
        }
        throw error;
      }
    });
  }

  async getPilotAccount(
    tenantId: string,
    accountKey: string
  ): Promise<PilotAccount | undefined> {
    const result = await this.pool.query<AccountRow>(
      `SELECT * FROM pc_pilot_account
       WHERE tenant_id = $1 AND account_key = $2`,
      [tenantId, accountKey]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : accountFromRow(row);
  }

  async getPrincipal(principalId: string): Promise<PCPrincipal | undefined> {
    const result = await this.pool.query<PrincipalRow>(
      "SELECT * FROM pc_principal WHERE principal_id = $1",
      [principalId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : principalFromRow(row);
  }

  async findVerifiedIdentityLink(
    principalId: string,
    identityProviderRef: string
  ): Promise<ExternalIdentityLink | undefined> {
    const result = await this.pool.query<LinkRow>(
      `SELECT * FROM pc_external_identity_link
       WHERE principal_id = $1
         AND identity_provider_ref = $2
         AND status = 'verified'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [principalId, identityProviderRef]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : linkFromRow(row);
  }

  async createPilotSession(session: PilotSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO pc_pilot_session (
         authentication_context_id, principal_id, token_digest,
         issued_at, expires_at, revoked_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.authentication_context_id,
        session.principal_id,
        session.token_digest,
        session.issued_at,
        session.expires_at,
        session.revoked_at ?? null
      ]
    );
  }

  async findPilotSession(
    tokenDigest: string,
    now: string
  ): Promise<PilotSession | undefined> {
    const result = await this.pool.query<SessionRow>(
      `SELECT * FROM pc_pilot_session
       WHERE token_digest = $1
         AND revoked_at IS NULL
         AND expires_at > $2`,
      [tokenDigest, now]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : sessionFromRow(row);
  }

  linkVerifiedIdentity(
    input: VerifiedIdentityLinkInput,
    now: string
  ): Promise<{ principal: PCPrincipal; identity_link: ExternalIdentityLink }> {
    return transaction(this.pool, async (client) => {
      const principalResult = await client.query<PrincipalRow>(
        "SELECT * FROM pc_principal WHERE principal_id = $1 FOR UPDATE",
        [input.principal_id]
      );
      const principalRow = principalResult.rows[0];
      if (principalRow === undefined) {
        throw new IdentityAuthorizationError(
          "PC_PRINCIPAL_NOT_FOUND",
          "Principal was not found"
        );
      }
      const principal = principalFromRow(principalRow);
      if (principal.identity_revision !== input.expected_identity_revision) {
        throw new IdentityAuthorizationError(
          "PC_IDENTITY_REVISION_CONFLICT",
          "Principal identity revision changed",
          true
        );
      }
      const existingResult = await client.query<LinkRow>(
        `SELECT * FROM pc_external_identity_link
         WHERE issuer = $1 AND external_subject = $2 AND tenant_or_org_ref = $3
         FOR UPDATE`,
        [input.issuer, input.external_subject, input.tenant_or_org_ref]
      );
      const existing = existingResult.rows[0];
      if (existing !== undefined && existing.principal_id !== input.principal_id) {
        throw new IdentityAuthorizationError(
          "PC_IDENTITY_LINK_CONFLICT",
          "External identity is already linked to another Principal"
        );
      }
      const linkResult = existing === undefined
        ? await client.query<LinkRow>(
            `INSERT INTO pc_external_identity_link (
               identity_link_id, principal_id, identity_provider_ref, issuer,
               external_subject, tenant_or_org_ref, link_method,
               verification_level, status, identity_link_revision,
               created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $7, 'verified', 1, $8, $8
             ) RETURNING *`,
            [
              randomUUID(),
              input.principal_id,
              input.identity_provider_ref,
              input.issuer,
              input.external_subject,
              input.tenant_or_org_ref,
              input.verification_level,
              now
            ]
          )
        : await client.query<LinkRow>(
            `UPDATE pc_external_identity_link
             SET identity_provider_ref = $2,
                 link_method = $3,
                 verification_level = $3,
                 status = 'verified',
                 identity_link_revision = identity_link_revision + 1,
                 updated_at = $4
             WHERE identity_link_id = $1
             RETURNING *`,
            [
              existing.identity_link_id,
              input.identity_provider_ref,
              input.verification_level,
              now
            ]
          );
      const updatedResult = await client.query<PrincipalRow>(
        `UPDATE pc_principal
         SET identity_revision = identity_revision + 1,
             authorization_revision = authorization_revision + 1,
             updated_at = $2
         WHERE principal_id = $1
         RETURNING *`,
        [input.principal_id, now]
      );
      return {
        principal: principalFromRow(updatedResult.rows[0] as PrincipalRow),
        identity_link: linkFromRow(linkResult.rows[0] as LinkRow)
      };
    });
  }

  replaceAuthorizationGrants(
    input: ReplaceAuthorizationGrantsInput,
    now: string
  ): Promise<PCPrincipal> {
    return transaction(this.pool, async (client) => {
      const principalResult = await client.query<PrincipalRow>(
        "SELECT * FROM pc_principal WHERE principal_id = $1 FOR UPDATE",
        [input.principal_id]
      );
      const principalRow = principalResult.rows[0];
      if (principalRow === undefined) {
        throw new IdentityAuthorizationError(
          "PC_PRINCIPAL_NOT_FOUND",
          "Principal was not found"
        );
      }
      const principal = principalFromRow(principalRow);
      if (
        principal.authorization_revision
        !== input.expected_authorization_revision
      ) {
        throw new IdentityAuthorizationError(
          "PC_AUTHORIZATION_REVISION_CONFLICT",
          "Principal authorization revision changed",
          true
        );
      }
      await client.query(
        "DELETE FROM pc_authorization_grant WHERE principal_id = $1",
        [input.principal_id]
      );
      for (const grant of input.grants) {
        await client.query(
          `INSERT INTO pc_authorization_grant (
             grant_id, principal_id, action, scope_type,
             scope_id, effect, evidence_ref
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            input.principal_id,
            grant.action,
            grant.scope_type,
            grant.scope_id,
            grant.effect,
            grant.evidence_ref
          ]
        );
      }
      const updated = await client.query<PrincipalRow>(
        `UPDATE pc_principal
         SET authorization_revision = authorization_revision + 1,
             updated_at = $2
         WHERE principal_id = $1
         RETURNING *`,
        [input.principal_id, now]
      );
      return principalFromRow(updated.rows[0] as PrincipalRow);
    });
  }

  async listAuthorizationGrants(
    principalId: string
  ): Promise<AuthorizationGrant[]> {
    const result = await this.pool.query<GrantRow>(
      `SELECT * FROM pc_authorization_grant
       WHERE principal_id = $1
       ORDER BY action, scope_type, scope_id, effect, grant_id`,
      [principalId]
    );
    return result.rows.map(grantFromRow);
  }
}
