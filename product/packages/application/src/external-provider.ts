import type { PCPrincipal, PilotSession, ToolRelease } from "@pc/domain";
import type {
  ExternalAuthorizationPort,
  PilotSignInResult
} from "./identity-authorization.js";

export interface IdentityProviderAccount {
  readonly id: number;
  readonly username: string;
  readonly display_name: string;
  readonly status: string;
}

export type IdentityProviderBindingProjection = Readonly<Record<string, unknown>>;

export type IdentityProviderAuthenticationRequest =
  | {
      readonly kind: "ticket_exchange";
      readonly ticket: unknown;
      readonly code_verifier: unknown;
    }
  | {
      readonly kind: "local_credentials";
      readonly tenant_id: unknown;
      readonly account_key: unknown;
      readonly secret: unknown;
    };

export type IdentityProviderAuthenticationResult = PilotSignInResult & {
  readonly account?: IdentityProviderAccount;
};

export interface IdentityProviderPort {
  readonly provider_registration_id: string;
  readonly identity_provider_ref: string;
  authenticate(
    input: IdentityProviderAuthenticationRequest
  ): Promise<IdentityProviderAuthenticationResult>;
  validate(
    session: PilotSession,
    principal: PCPrincipal
  ): Promise<IdentityProviderAccount | undefined>;
  bindings(): Promise<{
    readonly items: readonly IdentityProviderBindingProjection[];
  }>;
}

export interface EnterpriseAuthorizationPort
extends ExternalAuthorizationPort {
  readonly provider_registration_id: string;
  readonly resource_authority: string;
}

export type ProjectDirectoryItem = Readonly<Record<string, unknown>>;

export interface ProjectDirectoryPort {
  readonly provider_registration_id: string;
  readonly resource_authority: string;
  listProjects(input: {
    readonly principal: PCPrincipal;
  }): Promise<readonly ProjectDirectoryItem[]>;
}

export interface ProviderWorkbenchOperation {
  readonly operation_id: string;
  readonly operation_kind: string;
  readonly state: string;
  readonly updated_at: string;
  readonly tool_release_id?: string;
  readonly tool_name?: string;
  readonly outcome_state?: string;
  readonly evidence_refs: readonly string[];
}

export interface ProviderWorkbenchProjection {
  readonly scope: Readonly<Record<string, unknown>>;
  readonly tool_set: readonly Readonly<Record<string, unknown>>[];
  readonly recent_operations: readonly Readonly<Record<string, unknown>>[];
}

export interface WorkbenchProjectionPort {
  readonly provider_registration_id: string;
  readonly resource_authority: string;
  project(input: {
    readonly project_code: string;
    readonly project_record: ProjectDirectoryItem;
    readonly authorization_revision: number;
    readonly tools: readonly ToolRelease[];
    readonly operations: readonly ProviderWorkbenchOperation[];
  }): ProviderWorkbenchProjection;
}
