import type { PCPrincipal } from "@pc/domain";
import { IdentityAuthorizationError } from "@pc/domain";
import type {
  ExternalAuthorizationDecision,
} from "./identity-authorization.js";
import type { EnterpriseAuthorizationPort } from "./external-provider.js";

export interface EeClawAuthorizationDecision {
  readonly contract_name: "eeclaw.authorization-decision/1";
  readonly contract_version: 1;
  readonly subject_account_id: string;
  readonly actor_service_id?: string;
  readonly permission_key: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly operation?: string;
  readonly decision: "ALLOW" | "DENY";
  readonly reason_codes: readonly string[];
  readonly source: "baseline" | "role" | "deny" | "system_admin";
  readonly role_refs: readonly string[];
  readonly authorization_revision?: number;
  readonly authorization_version_digest: string;
  readonly policy_model_revision: number;
  readonly policy_artifact_release_refs: readonly string[];
  readonly decided_at: string;
  readonly observed_at: string;
  readonly expires_at?: string;
}

export interface EeClawLegacyCompatibilityDeclaration {
  readonly contract_name: "eeclaw.legacy-auth-compatibility/1";
  readonly contract_version: 1;
  readonly source_commit: string;
  readonly schema_fingerprint: string;
  readonly api_fingerprint: string;
  readonly auth_me_fingerprint: string;
  readonly audit_fingerprint: string;
  readonly baseline_page_keys_version: string;
  readonly baseline_page_keys_digest: string;
  readonly revocation_mode: string;
  readonly data_migration_required: boolean;
  readonly declared_at: string;
}

export interface EeClawAuthorizationAdapterOptions {
  readonly baseUrl: string;
  readonly sharedSecret: string;
  readonly resolveAccountId: (
    principal: PCPrincipal
  ) => Promise<string | undefined>;
  readonly resolvePermissionKey: (
    action: string
  ) => string | undefined;
  readonly resolveProjectOperation?: (action: string) =>
    "read" | "candidate" | "edit" | "review" | "membership_admin" | undefined;
  readonly fetchImpl?: typeof fetch;
}

const SOURCE_COMMIT = "cefa7432f966e17b41c1638e128de652b934fd20";
const BASELINE_VERSION = "BASELINE_PAGE_KEYS_V1";

function projectScope(
  resourceScopeRefs: readonly string[]
): Record<string, unknown> | undefined {
  const projects = resourceScopeRefs.filter((ref) => ref.startsWith("project:"));
  if (projects.length > 1 || projects.some((ref) => !/^project:[A-Za-z0-9_-]+$/u.test(ref))) return undefined;
  const projectRef = projects[0];
  if (projectRef === undefined) return {};
  return {
    type: "project",
    id: projectRef.slice("project:".length)
  };
}

function adapterDeny(
  code: string,
  evidenceRefs: readonly string[] = []
): ExternalAuthorizationDecision {
  return {
    decision: "DENY",
    reason_codes: [code],
    evidence_refs: evidenceRefs
  };
}

export class HttpEeClawAuthorizationAdapter
implements EnterpriseAuthorizationPort {
  readonly provider_registration_id = "provider:eeclaw";
  readonly resource_authority = "eeclaw";
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: EeClawAuthorizationAdapterOptions) {
    if (options.sharedSecret.trim() === "") {
      throw new Error("EE Claw adapter shared secret is required");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async evaluate(input: {
    readonly principal: PCPrincipal;
    readonly action: string;
    readonly resource_scope_refs: readonly string[];
    readonly observed_at: string;
  }): Promise<ExternalAuthorizationDecision> {
    const accountId = await this.options.resolveAccountId(input.principal);
    if (accountId === undefined) {
      return adapterDeny("eeclaw_identity_link_missing");
    }
    const permissionKey = this.options.resolvePermissionKey(input.action);
    if (permissionKey === undefined) {
      return adapterDeny("eeclaw_permission_mapping_missing");
    }
    const scope = projectScope(input.resource_scope_refs);
    if (scope === undefined) return adapterDeny("eeclaw_project_scope_invalid");
    const operation = scope.type === "project"
      ? this.options.resolveProjectOperation?.(input.action) : undefined;
    if (scope.type === "project" && this.options.resolveProjectOperation !== undefined && operation === undefined) {
      return adapterDeny("eeclaw_operation_mapping_missing");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/api/internal/process-copilot/v1/authorization/decide`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-pc-adapter-secret": this.options.sharedSecret
          },
          body: JSON.stringify({
            account_id: accountId,
            permission_key: permissionKey,
            scope,
            ...(operation === undefined ? {} : { operation })
          }),
          signal: AbortSignal.timeout(5_000)
        }
      );
    } catch {
      throw new IdentityAuthorizationError(
        "PC_PROVIDER_UNAVAILABLE",
        "EE authorization provider is temporarily unavailable",
        true
      );
    }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        throw new IdentityAuthorizationError(
          "PC_PROVIDER_AUTHENTICATION_FAILED",
          "EE authorization provider rejected the adapter identity"
        );
      }
      throw new IdentityAuthorizationError(
        response.status >= 500
          ? "PC_PROVIDER_UNAVAILABLE"
          : "PC_PROVIDER_INCOMPATIBLE",
        "EE authorization provider returned an unusable response",
        response.status >= 500
      );
    }
    let body: {
      ok?: boolean;
      data?: EeClawAuthorizationDecision;
    };
    try { body = await response.json() as typeof body; }
    catch {
      throw new IdentityAuthorizationError(
        "PC_PROVIDER_INCOMPATIBLE",
        "EE authorization provider returned invalid JSON"
      );
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new IdentityAuthorizationError(
        "PC_PROVIDER_INCOMPATIBLE",
        "EE authorization provider returned an incompatible contract"
      );
    }
    const decision = body.data;
    if (
      body.ok !== true
      || decision?.contract_name !== "eeclaw.authorization-decision/1"
      || decision.contract_version !== 1
      || decision.subject_account_id !== accountId
      || decision.permission_key !== permissionKey
      || decision.scope?.type !== scope.type || decision.scope?.id !== scope.id
      || (operation !== undefined && decision.operation !== operation)
      || !["ALLOW", "DENY"].includes(decision.decision)
      || !Array.isArray(decision.reason_codes) || decision.reason_codes.some((code) => typeof code !== "string")
      || !Array.isArray(decision.policy_artifact_release_refs)
      || decision.policy_artifact_release_refs.some((ref) => typeof ref !== "string")
      || !/^[a-f0-9]{64}$/.test(
        decision.authorization_version_digest ?? ""
      )
      || (
        decision.expires_at !== undefined
        && (!Number.isFinite(Date.parse(decision.expires_at))
          || Date.parse(decision.expires_at) <= Date.parse(input.observed_at))
      )
    ) {
      throw new IdentityAuthorizationError(
        "PC_PROVIDER_INCOMPATIBLE",
        "EE authorization provider returned an incompatible contract"
      );
    }
    return {
      decision: decision.decision,
      reason_codes: [...decision.reason_codes],
      evidence_refs: [
        `eeclaw:C41:${decision.authorization_version_digest}`,
        ...decision.policy_artifact_release_refs
      ]
    };
  }

  async fetchCompatibility(): Promise<EeClawLegacyCompatibilityDeclaration> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/internal/process-copilot/v1/compatibility`,
      {
        headers: {
          "x-pc-adapter-secret": this.options.sharedSecret
        },
        signal: AbortSignal.timeout(5_000)
      }
    );
    if (!response.ok) {
      throw new Error(`EE Claw compatibility request failed: ${response.status}`);
    }
    const body = await response.json() as {
      ok?: boolean;
      data?: EeClawLegacyCompatibilityDeclaration;
    };
    const declaration = body.data;
    if (
      body.ok !== true
      || declaration?.contract_name
        !== "eeclaw.legacy-auth-compatibility/1"
      || declaration.contract_version !== 1
      || declaration.source_commit !== SOURCE_COMMIT
      || declaration.baseline_page_keys_version !== BASELINE_VERSION
      || declaration.data_migration_required
      || declaration.revocation_mode !== "request_time"
    ) {
      throw new Error("EE Claw compatibility declaration is unsupported");
    }
    return declaration;
  }
}
