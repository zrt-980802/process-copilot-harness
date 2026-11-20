import type {
  ApiErrorBody,
  DraftRevision,
  InputSlot,
  Principal,
  SignInResult,
  SystemCapabilities,
  TaskProjection,
  UploadedResource,
  Workspace
} from "./types";
import type { EEAccountPresentation } from "./account-presentation";

const API_BASE = "/api";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function parseError(response: Response): Promise<ApiClientError> {
  let body: ApiErrorBody = {};
  try {
    body = await response.json() as ApiErrorBody;
  } catch {
    // Non-JSON proxy failures are normalized below.
  }
  return new ApiClientError(
    response.status,
    body.error?.code ?? `HTTP_${response.status}`,
    body.error?.message ?? "请求失败",
    body.error?.retryable ?? response.status >= 500,
    body.error?.details
  );
}

export async function request<T>(
  path: string,
  token?: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function eeAuth(path: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, any>> {
  const csrf = document.cookie.split("; ").find((part) => part.startsWith("eea_csrf="))?.slice(9);
  const response = await fetch(`/api/ee-auth/${path}`, { credentials: "same-origin", cache: "no-store", ...(signal ? { signal } : {}),
    ...(body === undefined ? {} : json("POST", body)),
    headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}) } });
  if (!response.ok) throw await parseError(response);
  const payload = await response.json();
  return payload.data;
}

async function base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export const api = {
  capabilities(): Promise<SystemCapabilities> {
    return request("/health");
  },

  async accountPresentation(signal?: AbortSignal): Promise<EEAccountPresentation> {
    return await eeAuth("me", undefined, signal) as unknown as EEAccountPresentation;
  },
  async signIn(accountKey: string | undefined, secret: string | undefined,
    providerMode: SystemCapabilities["provider_mode"]): Promise<SignInResult> {
    if (providerMode === "standalone") {
      if (accountKey === undefined || secret === undefined) {
        throw new ApiClientError(401, "PC_AUTHENTICATION_REQUIRED",
          "Local credentials are required", false);
      }
      return request("/v1/pilot/sign-in", undefined, json("POST", {
        account_key: accountKey,
        secret
      }));
    }
    if (accountKey !== undefined) await eeAuth("login", { username: accountKey, password: secret });
    else await eeAuth("me");
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const launch = await eeAuth("process-copilot/launch", { audience: "process-copilot", code_challenge: challenge });
    return request("/v1/auth/ee/exchange", undefined, json("POST", { ticket: launch.ticket, code_verifier: verifier }));
  },

  async signOut(token: string, providerMode: SystemCapabilities["provider_mode"]): Promise<void> {
    if (providerMode === "ee-connected") {
      try { await eeAuth("logout", {}); }
      catch (error) { if (!(error instanceof ApiClientError) || error.status !== 401) throw error; }
    }
    await request("/v1/auth/logout", token, json("POST", {}));
  },

  async me(token: string): Promise<Principal> {
    const result = await request<{ principal: Principal; account?: Principal["ee_account"] }>(
      "/v1/identity/me",
      token
    );
    return { ...result.principal, ...(result.account ? { ee_account: result.account } : {}) };
  },

  async listTasks(token: string, personalOnly = false, signal?: AbortSignal): Promise<Workspace[]> {
    const result = await request<{ tasks: Workspace[] }>(
      personalOnly ? "/v1/ssts-tasks?scope=personal" : "/v1/ssts-tasks",
      token,
      signal ? { signal } : {}
    );
    return result.tasks;
  },

  createTask(token: string, title: string, projectCode: string, functionCode: string, mode: string): Promise<Workspace> {
    return request("/v1/workbench/tasks", token, json("POST", { title, ...(projectCode ? { project_code: projectCode } : {}),
      ...(functionCode ? { function_code: functionCode } : {}), mode }));
  },

  getTask(token: string, workspaceId: string, signal?: AbortSignal): Promise<TaskProjection> {
    return request(`/v1/ssts-tasks/${workspaceId}`, token, signal ? { signal } : {});
  },

  async upload(
    token: string,
    principal: Principal,
    file: File
  ): Promise<UploadedResource> {
    return request("/v1/resources/uploads", token, json("POST", {
      kind: "UPLOAD",
      display_name: file.name,
      classification: "INTERNAL",
      owner_scope: {
        scope_type: "USER_ROOT",
        scope_id: principal.principal_id
      },
      media_type: file.type || "text/markdown",
      content_base64: await base64(file),
      provenance: {
        source_system: "process-copilot-minimum-workbench",
        acquisition_operation: "browser-upload"
      }
    }));
  },

  attachInput(
    token: string,
    workspaceId: string,
    slot: InputSlot,
    resource: UploadedResource
  ): Promise<void> {
    return request(
      `/v1/ssts-tasks/${workspaceId}/inputs`,
      token,
      json("POST", {
        slot,
        resource_id: resource.resource.resource_id,
        resource_version_id: resource.version.resource_version_id
      })
    );
  },

  checkInputs(token: string, workspaceId: string): Promise<{
    complete: boolean;
    missing_slots: InputSlot[];
    workspace: Workspace;
  }> {
    return request(
      `/v1/ssts-tasks/${workspaceId}/check-inputs`,
      token,
      json("POST", {})
    );
  },

  appendMessage(
    token: string,
    workspaceId: string,
    content: string
  ): Promise<void> {
    return request(
      `/v1/ssts-tasks/${workspaceId}/messages`,
      token,
      json("POST", { content })
    );
  },

  async generateDraft(
    token: string,
    workspaceId: string
  ): Promise<DraftRevision> {
    const result = await request<{ draft: DraftRevision }>(
      `/v1/ssts-tasks/${workspaceId}/drafts/generate`,
      token,
      json("POST", {
        idempotency_key: `browser-${workspaceId}-${crypto.randomUUID()}`
      })
    );
    return result.draft;
  },

  reviewDraft(
    token: string,
    workspaceId: string,
    draftId: string,
    decision: "ACCEPTED" | "REJECTED",
    comment?: string
  ): Promise<void> {
    return request(
      `/v1/ssts-tasks/${workspaceId}/drafts/${draftId}/review`,
      token,
      json("POST", {
        decision,
        ...(comment === undefined || comment.trim() === ""
          ? {}
          : { comment: comment.trim() })
      })
    );
  },

  async draftContent(
    token: string,
    workspaceId: string,
    draftId: string
  ): Promise<{ content: string; filename: string }> {
    const response = await fetch(
      `${API_BASE}/v1/ssts-tasks/${workspaceId}/drafts/${draftId}/download`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (!response.ok) throw await parseError(response);
    const disposition = response.headers.get("content-disposition") ?? "";
    const encoded = /filename="([^"]+)"/u.exec(disposition)?.[1];
    return {
      content: await response.text(),
      filename: encoded === undefined
        ? "ssts-draft.md"
        : decodeURIComponent(encoded)
    };
  },

  async downloadDraft(
    token: string,
    workspaceId: string,
    draftId: string
  ): Promise<void> {
    const result = await this.draftContent(token, workspaceId, draftId);
    const url = URL.createObjectURL(new Blob([result.content], {
      type: "text/markdown;charset=utf-8"
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(url);
  }
};
