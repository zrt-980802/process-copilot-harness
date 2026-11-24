CREATE TABLE pc_session_assurance (
  session_assurance_id TEXT PRIMARY KEY CHECK (length(session_assurance_id) > 0),
  pc_session_id TEXT NOT NULL UNIQUE CHECK (length(pc_session_id) > 0),
  authentication_context_id TEXT NOT NULL UNIQUE REFERENCES pc_pilot_session(authentication_context_id) ON DELETE RESTRICT,
  principal_id TEXT NOT NULL REFERENCES pc_principal(principal_id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL CHECK (length(tenant_id) > 0),
  authentication_method TEXT NOT NULL CHECK (authentication_method IN ('LOCAL','STANDALONE','PROVIDER')),
  identity_provider_ref TEXT NOT NULL CHECK (length(identity_provider_ref) > 0),
  identity_link_id TEXT REFERENCES pc_external_identity_link(identity_link_id) ON DELETE RESTRICT,
  identity_link_revision BIGINT CHECK (identity_link_revision > 0),
  pilot_account_id TEXT REFERENCES pc_pilot_account(pilot_account_id) ON DELETE RESTRICT,
  identity_revision BIGINT NOT NULL CHECK (identity_revision > 0),
  authorization_revision BIGINT NOT NULL CHECK (authorization_revision > 0),
  assurance_level TEXT NOT NULL CHECK (assurance_level IN ('LOCAL_VERIFIED','PROVIDER_VERIFIED')),
  issued_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ,
  pc_absolute_limit_at TIMESTAMPTZ NOT NULL,
  authentication_evidence_expires_at TIMESTAMPTZ,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  session_state TEXT NOT NULL CHECK (session_state IN ('ACTIVE','EXPIRED','REVOKED')),
  evidence_refs JSONB NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) > 0),
  assurance_digest TEXT NOT NULL CHECK (assurance_digest ~ '^sha256:[a-f0-9]{64}$'),
  record_version BIGINT NOT NULL DEFAULT 1 CHECK (record_version > 0),
  CHECK (pc_session_id <> authentication_context_id),
  CHECK (issued_at < absolute_expires_at AND absolute_expires_at <= pc_absolute_limit_at),
  CHECK (idle_expires_at IS NULL OR (issued_at < idle_expires_at AND idle_expires_at <= absolute_expires_at)),
  CHECK ((session_state = 'REVOKED') = (revoked_at IS NOT NULL)),
  CHECK ((authentication_method = 'PROVIDER' AND identity_link_id IS NOT NULL AND identity_link_revision IS NOT NULL
    AND authentication_evidence_expires_at IS NOT NULL AND absolute_expires_at <= authentication_evidence_expires_at
    AND assurance_level = 'PROVIDER_VERIFIED' AND identity_provider_ref NOT IN ('local','standalone') AND pilot_account_id IS NULL)
    OR (authentication_method IN ('LOCAL','STANDALONE') AND identity_link_id IS NULL AND identity_link_revision IS NULL
    AND authentication_evidence_expires_at IS NULL AND assurance_level = 'LOCAL_VERIFIED' AND pilot_account_id IS NOT NULL
    AND ((authentication_method = 'LOCAL' AND identity_provider_ref = 'local')
      OR (authentication_method = 'STANDALONE' AND identity_provider_ref = 'standalone'))))
);
CREATE INDEX pc_session_assurance_principal_expiry ON pc_session_assurance(principal_id,tenant_id,session_state,absolute_expires_at);
CREATE INDEX pc_session_assurance_link_revision ON pc_session_assurance(identity_link_id,identity_link_revision) WHERE identity_link_id IS NOT NULL;
