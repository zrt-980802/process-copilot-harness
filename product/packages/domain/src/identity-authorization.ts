export type PrincipalType = "human" | "service";
export type PrincipalLifecycleStatus = "active" | "disabled";
export type IdentityLinkStatus = "verified" | "revoked";
export type IdentityVerificationLevel =
  | "pilot_bootstrap"
  | "signed_idp_callback"
  | "admin_reauthentication";
export type AuthorizationScopeType =
  | "global"
  | "project"
  | "task"
  | "resource";
export type AuthorizationEffect = "allow" | "deny";

export interface PCPrincipal {
  readonly principal_id: string;
  readonly principal_type: PrincipalType;
  readonly tenant_id: string;
  readonly lifecycle_status: PrincipalLifecycleStatus;
  readonly primary_identity_ref: string;
  readonly identity_revision: number;
  readonly authorization_revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ExternalIdentityLink {
  readonly identity_link_id: string;
  readonly principal_id: string;
  readonly identity_provider_ref: string;
  readonly issuer: string;
  readonly external_subject: string;
  readonly tenant_or_org_ref: string;
  readonly link_method: IdentityVerificationLevel;
  readonly verification_level: IdentityVerificationLevel;
  readonly status: IdentityLinkStatus;
  readonly identity_link_revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PilotAccount {
  readonly pilot_account_id: string;
  readonly tenant_id: string;
  readonly account_key: string;
  readonly principal_id: string;
  readonly secret_hash: string;
  readonly status: "active" | "disabled";
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PilotSession {
  readonly authentication_context_id: string;
  readonly principal_id: string;
  readonly token_digest: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly revoked_at?: string;
}

export interface AuthorizationGrant {
  readonly grant_id: string;
  readonly principal_id: string;
  readonly action: string;
  readonly scope_type: AuthorizationScopeType;
  readonly scope_id: string;
  readonly effect: AuthorizationEffect;
  readonly evidence_ref: string;
}

export interface AuthorizationSnapshot {
  readonly contract_name: "pc.authorization-snapshot/1";
  readonly contract_version: 1;
  readonly authorization_revision: number;
  readonly policy_model_revision: number;
  readonly principal_id: string;
  readonly project_id?: string;
  readonly profile_release_id?: string;
  readonly allowed_actions: readonly string[];
  readonly resource_scope_digest: string;
  readonly tool_set_digest: string;
  readonly decision: "ALLOW" | "DENY";
  readonly reason_codes: readonly string[];
  readonly issued_at: string;
  readonly expires_at: string;
  readonly decision_evidence_refs: readonly string[];
}

export interface PrincipalEnvelope {
  readonly contract_name: "pc.principal-envelope/1";
  readonly contract_version: 1;
  readonly envelope_id: string;
  readonly issuer: string;
  readonly audience: string;
  readonly tenant_id: string;
  readonly subject_principal_id: string;
  readonly actor_principal_id: string;
  readonly pc_session_id: string;
  readonly business_task_id?: string;
  readonly runtime_id: string;
  readonly runtime_epoch: number;
  readonly assignment_generation: number;
  readonly fencing_token?: string;
  readonly authorization_revision: number;
  readonly credential_generation?: number;
  readonly allowed_actions: readonly string[];
  readonly resource_scope_refs: readonly string[];
  readonly issued_at: string;
  readonly expires_at: string;
  readonly nonce: string;
  readonly signature: string;
}

export class IdentityAuthorizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "IdentityAuthorizationError";
  }
}
