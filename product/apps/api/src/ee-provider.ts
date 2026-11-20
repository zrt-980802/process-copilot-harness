import type {
  IdentityAuthorizationService,
  ProjectDirectoryItem,
  ProjectDirectoryPort,
  ProviderWorkbenchProjection,
  WorkbenchProjectionPort
} from "@pc/application";
import { IdentityAuthorizationError } from "@pc/domain";

export interface EeClawProjectDirectoryAdapterOptions {
  readonly identity: IdentityAuthorizationService;
  readonly baseUrl: string;
  readonly sharedSecret: string;
  readonly fetchImpl?: typeof fetch;
}

export class EeClawProjectDirectoryAdapter implements ProjectDirectoryPort {
  readonly provider_registration_id = "provider:eeclaw";
  readonly resource_authority = "eeclaw";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: EeClawProjectDirectoryAdapterOptions) {
    if (options.sharedSecret.trim() === "") {
      throw new Error("EE Claw adapter shared secret is required");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listProjects(input: Parameters<ProjectDirectoryPort["listProjects"]>[0]): Promise<readonly ProjectDirectoryItem[]> {
    const accountId = await this.options.identity.resolveExternalSubject(
      input.principal.principal_id,
      "eeclaw",
      { issuer: this.baseUrl, tenant: input.principal.tenant_id }
    );
    if (accountId === undefined) {
      throw new IdentityAuthorizationError(
        "PC_WORKBENCH_EXTERNAL_ACCOUNT_DENIED",
        "Verified EE identity required"
      );
    }
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/api/internal/process-copilot/v1/projects/accessible`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            "x-pc-adapter-secret": this.options.sharedSecret
          },
          body: JSON.stringify({
            account_id: accountId,
            permission_key: "page:projects",
            operation: "read"
          }),
          signal: AbortSignal.timeout(5_000)
        }
      );
    } catch {
      throw new IdentityAuthorizationError(
        "PC_PROVIDER_UNAVAILABLE",
        "EE project directory is temporarily unavailable",
        true
      );
    }
    if ([401, 403].includes(response.status)) {
      throw new IdentityAuthorizationError(
        "PC_WORKBENCH_PROJECT_DENIED",
        "EE project directory denied the request"
      );
    }
    if (!response.ok) {
      throw new IdentityAuthorizationError(
        "PC_PROVIDER_UNAVAILABLE",
        "EE project directory is temporarily unavailable",
        true
      );
    }
    const body = await response.json() as {
      ok: boolean;
      data?: {
        contract_name?: string;
        items?: ProjectDirectoryItem[];
        authorization_version_digest?: string;
      };
    };
    if (
      !body.ok
      || body.data?.contract_name !== "eeclaw.accessible-projects/1"
      || !Array.isArray(body.data.items)
      || !/^[a-f0-9]{64}$/u.test(body.data.authorization_version_digest ?? "")
    ) {
      throw new IdentityAuthorizationError(
        "PC_PROVIDER_INCOMPATIBLE",
        "EE project directory returned an incompatible contract"
      );
    }
    return body.data.items;
  }
}

export class EeClawWorkbenchProjectionAdapter
implements WorkbenchProjectionPort {
  readonly provider_registration_id = "provider:eeclaw";
  readonly resource_authority = "eeclaw";

  project(
    input: Parameters<WorkbenchProjectionPort["project"]>[0]
  ): ProviderWorkbenchProjection {
    return {
      scope: {
        project_code: input.project_code,
        project_name: typeof input.project_record.project_name === "string"
          ? input.project_record.project_name
          : input.project_code,
        authorization_revision: input.authorization_revision,
        source: "EE accessible project membership and per-tool authorization"
      },
      tool_set: input.tools.map((tool) => ({
        tool_release_id: tool.tool_release_id,
        tool_definition_id: tool.tool_definition_id,
        display_name: typeof tool.compatibility.display_name === "string"
          ? tool.compatibility.display_name
          : tool.tool_definition_id,
        action_class: tool.risk_manifest.action_class,
        provider_kind: tool.provider_kind,
        status: tool.status
      })),
      recent_operations: input.operations.map((operation) => ({
        operation_id: operation.operation_id,
        operation_kind: operation.operation_kind,
        state: operation.state,
        updated_at: operation.updated_at,
        tool_release_id: operation.tool_release_id,
        tool_name: operation.tool_name,
        outcome_state: operation.outcome_state,
        trace_refs: [...new Set(operation.evidence_refs.filter((ref) =>
          ref.startsWith("eea://traces/")))]
      }))
    };
  }
}
