CREATE TABLE IF NOT EXISTS pc_schema_migration (
  component TEXT NOT NULL,
  version BIGINT NOT NULL,
  migration_name TEXT NOT NULL,
  migration_digest TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (component, version),
  UNIQUE (component, migration_name)
);

CREATE TABLE IF NOT EXISTS pc_memory_object (
  memory_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  subject_principal_id TEXT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('PERSONAL', 'PROJECT', 'SYSTEM')),
  scope_id TEXT NOT NULL,
  memory_kind TEXT NOT NULL CHECK (memory_kind IN (
    'EXPLICIT_PREFERENCE', 'CONFIRMED_FACT', 'ONGOING_GOAL', 'DECISION_HISTORY',
    'PROJECT_FACT', 'RUNBOOK', 'FAILURE_GOTCHA'
  )),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
  object_state TEXT NOT NULL CHECK (object_state IN (
    'CANDIDATE', 'CONFIRMED', 'PUBLISHED', 'REVOKED', 'EXPIRED', 'REJECTED'
  )),
  current_revision_id TEXT,
  policy_revision BIGINT NOT NULL CHECK (policy_revision >= 1),
  version BIGINT NOT NULL CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  CHECK (scope_type <> 'PERSONAL' OR (scope_id = owner_principal_id AND subject_principal_id = owner_principal_id))
);

CREATE INDEX IF NOT EXISTS pc_memory_object_owner
  ON pc_memory_object(tenant_id, owner_principal_id, object_state, updated_at DESC, memory_id);
CREATE INDEX IF NOT EXISTS pc_memory_object_scope
  ON pc_memory_object(tenant_id, scope_type, scope_id, object_state);

CREATE TABLE IF NOT EXISTS pc_memory_revision (
  revision_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES pc_memory_object(memory_id) ON DELETE RESTRICT,
  revision_no BIGINT NOT NULL CHECK (revision_no >= 1),
  revision_state TEXT NOT NULL CHECK (revision_state IN ('CURRENT', 'SUPERSEDED', 'WITHDRAWN')),
  content_digest TEXT NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE (memory_id, revision_id),
  UNIQUE (memory_id, revision_no),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS pc_memory_revision_one_current
  ON pc_memory_revision(memory_id) WHERE revision_state = 'CURRENT';
CREATE INDEX IF NOT EXISTS pc_memory_revision_valid_time
  ON pc_memory_revision(memory_id, valid_from, valid_to);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pc_memory_object_current_revision_fk'
  ) THEN
    ALTER TABLE pc_memory_object
      ADD CONSTRAINT pc_memory_object_current_revision_fk
      FOREIGN KEY (memory_id, current_revision_id)
      REFERENCES pc_memory_revision(memory_id, revision_id)
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS pc_memory_source_evidence (
  source_evidence_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'CONVERSATION_MESSAGE', 'RESOURCE_VERSION', 'BUSINESS_EVENT', 'TOOL_RESULT'
  )),
  source_authority TEXT NOT NULL,
  source_object_id TEXT NOT NULL,
  source_version_id TEXT,
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
  captured_at TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  evidence_digest TEXT NOT NULL CHECK (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_memory_evidence_source
  ON pc_memory_source_evidence(tenant_id, source_authority, source_object_id, source_version_id);

CREATE TABLE IF NOT EXISTS pc_memory_revision_evidence (
  revision_id TEXT NOT NULL REFERENCES pc_memory_revision(revision_id) ON DELETE RESTRICT,
  source_evidence_id TEXT NOT NULL REFERENCES pc_memory_source_evidence(source_evidence_id) ON DELETE RESTRICT,
  ordinal BIGINT NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (revision_id, source_evidence_id),
  UNIQUE (revision_id, ordinal)
);

CREATE TABLE IF NOT EXISTS pc_memory_command (
  command_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_kind TEXT NOT NULL CHECK (command_kind IN ('CAPTURE', 'REVISE', 'REVOKE')),
  payload_digest TEXT NOT NULL CHECK (payload_digest ~ '^sha256:[a-f0-9]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, principal_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS pc_memory_policy_decision (
  decision_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  memory_id TEXT REFERENCES pc_memory_object(memory_id) ON DELETE RESTRICT,
  revision_id TEXT REFERENCES pc_memory_revision(revision_id) ON DELETE RESTRICT,
  decision_kind TEXT NOT NULL CHECK (decision_kind IN ('CAPTURE', 'QUERY', 'REVISE', 'REVOKE', 'CONTEXT_ASSEMBLY')),
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW', 'DENY', 'REQUIRE_CONFIRMATION', 'REQUIRE_REDACTION', 'REQUIRE_ESCALATION')),
  authorization_revision BIGINT NOT NULL CHECK (authorization_revision >= 0),
  policy_revision BIGINT NOT NULL CHECK (policy_revision >= 1),
  decided_at TIMESTAMPTZ NOT NULL,
  decision_digest TEXT NOT NULL CHECK (decision_digest ~ '^sha256:[a-f0-9]{64}$'),
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS pc_memory_policy_subject
  ON pc_memory_policy_decision(tenant_id, principal_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS pc_memory_authority_event (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  memory_id TEXT NOT NULL REFERENCES pc_memory_object(memory_id) ON DELETE RESTRICT,
  revision_id TEXT REFERENCES pc_memory_revision(revision_id) ON DELETE RESTRICT,
  object_version BIGINT NOT NULL CHECK (object_version >= 1),
  producer_sequence BIGINT NOT NULL CHECK (producer_sequence >= 1),
  change_kind TEXT NOT NULL CHECK (change_kind IN (
    'CREATED', 'CONFIRMED', 'PUBLISHED', 'REVISED', 'SUPERSEDED', 'REVOKED', 'EXPIRED'
  )),
  occurred_at TIMESTAMPTZ NOT NULL,
  causation_command_id TEXT NOT NULL REFERENCES pc_memory_command(command_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  payload JSONB NOT NULL,
  dispatched_at TIMESTAMPTZ,
  dispatch_attempts BIGINT NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
  UNIQUE (memory_id, producer_sequence)
);

CREATE INDEX IF NOT EXISTS pc_memory_event_stream
  ON pc_memory_authority_event(tenant_id, memory_id, producer_sequence);
CREATE INDEX IF NOT EXISTS pc_memory_event_outbox_pending
  ON pc_memory_authority_event(occurred_at, event_id) WHERE dispatched_at IS NULL;
