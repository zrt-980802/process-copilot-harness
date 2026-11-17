import { createHash, randomUUID } from "node:crypto";
import type {
  CleanupState,
  ImmutableBlobStore,
  MaterializationRecord,
  MaterializationResultContract,
  Resource,
  ResourceAction,
  ResourceAuditEntry,
  ResourceBinding,
  ResourceClassification,
  ResourceKind,
  ResourceLifecycle,
  ResourceProvenance,
  ResourceRefContract,
  ResourceRepository,
  ResourceScope,
  ResourceScopeAuthorizationPort,
  ResourceVersion,
  ResourceVersionRef,
  WorkspaceAdmissionInput,
  WorkspaceAdmissionPort,
  WorkspaceMaterializer,
  WorkspaceViewBinding,
  WorkspaceViewSnapshot
} from "./types.js";
import { ResourceError } from "./types.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/octet-stream",
  "text/csv",
  "text/markdown",
  "text/plain"
]);

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new ResourceError(
      "PC_RESOURCE_INVALID_ARGUMENT",
      `${field} is required`,
      false,
      { field }
    );
  }
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ResourceError(
      "PC_RESOURCE_INVALID_ARGUMENT",
      `${field} must be a positive integer`,
      false,
      { field }
    );
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(
    value instanceof Uint8Array ? value : canonical(value)
  ).digest("hex")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function uniqueActions(actions: readonly ResourceAction[]): ResourceAction[] {
  const result = [...new Set(actions)].sort();
  if (result.length === 0) {
    throw new ResourceError(
      "PC_RESOURCE_ACTIONS_REQUIRED",
      "At least one Resource action is required"
    );
  }
  return result;
}

function detectMediaType(content: Uint8Array, declared: string): string {
  const mediaType = required(declared.split(";")[0] ?? "", "media_type").toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw new ResourceError(
      "PC_RESOURCE_MEDIA_TYPE_REJECTED",
      "Declared media type is not allowed"
    );
  }
  if (
    mediaType === "application/pdf"
    && Buffer.from(content.subarray(0, 5)).toString("ascii") !== "%PDF-"
  ) {
    throw new ResourceError(
      "PC_RESOURCE_MAGIC_MISMATCH",
      "PDF declaration does not match file magic"
    );
  }
  if (mediaType === "application/json") {
    try {
      JSON.parse(Buffer.from(content).toString("utf8"));
    } catch {
      throw new ResourceError(
        "PC_RESOURCE_MAGIC_MISMATCH",
        "JSON declaration does not contain valid JSON"
      );
    }
  }
  return mediaType;
}

function publicMaterialization(
  record: MaterializationRecord
): MaterializationResultContract {
  return {
    contract_name: "pc.materialization-result/1",
    contract_version: 1,
    materialization_id: record.materialization_id,
    state: record.state,
    mount_ref: record.mount_ref,
    materialized_entries: clone(record.materialized_entries),
    failed_entries: clone(record.failed_entries),
    expires_at: record.expires_at,
    cleanup_state: record.cleanup_state,
    result_digest: record.result_digest
  };
}

export interface UploadResourceInput {
  tenant_id: string;
  principal_id: string;
  pc_session_id?: string;
  kind: ResourceKind;
  display_name: string;
  classification: ResourceClassification;
  owner_scope: ResourceScope;
  media_type: string;
  content: Uint8Array;
  provenance: Omit<ResourceProvenance, "requested_by" | "observed_at"> & {
    observed_at?: string;
  };
}

export interface CreateVersionInput {
  tenant_id: string;
  principal_id: string;
  resource_id: string;
  expected_version_id: string;
  media_type: string;
  content: Uint8Array;
  provenance: Omit<ResourceProvenance, "requested_by" | "observed_at"> & {
    observed_at?: string;
  };
}

export class ResourceWorkspaceService implements WorkspaceAdmissionPort {
  constructor(
    private readonly repository: ResourceRepository,
    private readonly blobs: ImmutableBlobStore,
    private readonly materializer: WorkspaceMaterializer,
    private readonly scopeAuthorization?: ResourceScopeAuthorizationPort,
    private readonly now: () => Date = () => new Date()
  ) {}

  initialize(): Promise<void> {
    return this.repository.initialize();
  }

  close(): Promise<void> {
    return this.repository.close();
  }

  async uploadResource(input: UploadResourceInput): Promise<{
    resource: Resource;
    version: ResourceVersion;
    resource_ref: ResourceRefContract;
  }> {
    const tenantId = required(input.tenant_id, "tenant_id");
    const principalId = required(input.principal_id, "principal_id");
    await this.assertScopeAuthorized(
      tenantId,
      principalId,
      "UPLOAD",
      input.owner_scope,
      input.pc_session_id
    );
    if (input.content.byteLength === 0 || input.content.byteLength > MAX_UPLOAD_BYTES) {
      throw new ResourceError(
        "PC_RESOURCE_SIZE_REJECTED",
        `Resource content must be between 1 and ${MAX_UPLOAD_BYTES} bytes`
      );
    }
    const mediaType = detectMediaType(input.content, input.media_type);
    const now = this.now().toISOString();
    const resourceId = `res_${randomUUID()}`;
    const versionId = `rv_${randomUUID()}`;
    const contentDigest = digest(input.content);
    const blobRef = await this.blobs.put(input.content, contentDigest);
    const provenance: ResourceProvenance = {
      ...clone(input.provenance),
      requested_by: principalId,
      observed_at: input.provenance.observed_at ?? now
    };
    const version: ResourceVersion = {
      resource_version_id: versionId,
      resource_id: resourceId,
      version_seq: 1,
      content_digest: contentDigest,
      bytes: input.content.byteLength,
      media_type: mediaType,
      blob_ref: blobRef,
      provenance,
      created_by: principalId,
      created_at: now
    };
    const resource: Resource = {
      resource_id: resourceId,
      tenant_id: tenantId,
      kind: input.kind,
      display_name: required(input.display_name, "display_name"),
      classification: input.classification,
      lifecycle_status: "ACTIVE",
      owner_scope: clone(input.owner_scope),
      current_version_id: versionId,
      created_by: principalId,
      created_at: now,
      updated_at: now
    };
    await this.repository.createResource(resource, version);
    await this.audit({
      event_type: "RESOURCE_AVAILABLE",
      tenant_id: tenantId,
      subject_principal_id: principalId,
      resource_refs: [{ resource_id: resourceId, resource_version_id: versionId }],
      decision: { outcome: "SUCCESS", reason_codes: ["upload_accepted"] },
      evidence_refs: [contentDigest]
    });
    return {
      resource: clone(resource),
      version: clone(version),
      resource_ref: this.resourceRef(resource, version)
    };
  }

  async createVersion(input: CreateVersionInput): Promise<{
    resource: Resource;
    version: ResourceVersion;
  }> {
    const resource = await this.requireResource(input.resource_id);
    this.assertOwner(resource, input.tenant_id, input.principal_id);
    if (resource.kind !== "WORKSPACE_FILE") {
      throw new ResourceError(
        "PC_RESOURCE_IMMUTABLE_KIND",
        "Only WORKSPACE_FILE resources accept new mutable versions"
      );
    }
    if (resource.lifecycle_status !== "ACTIVE") {
      throw new ResourceError(
        "PC_RESOURCE_NOT_ACTIVE",
        "Archived or deleted Resources cannot accept new versions"
      );
    }
    if (input.content.byteLength === 0 || input.content.byteLength > MAX_UPLOAD_BYTES) {
      throw new ResourceError("PC_RESOURCE_SIZE_REJECTED", "Resource content size is invalid");
    }
    const now = this.now().toISOString();
    const contentDigest = digest(input.content);
    const blobRef = await this.blobs.put(input.content, contentDigest);
    const versions = await this.repository.listVersions(resource.resource_id);
    const version: ResourceVersion = {
      resource_version_id: `rv_${randomUUID()}`,
      resource_id: resource.resource_id,
      version_seq: Math.max(...versions.map((candidate) => candidate.version_seq), 0) + 1,
      content_digest: contentDigest,
      bytes: input.content.byteLength,
      media_type: detectMediaType(input.content, input.media_type),
      blob_ref: blobRef,
      provenance: {
        ...clone(input.provenance),
        requested_by: input.principal_id,
        observed_at: input.provenance.observed_at ?? now
      },
      created_by: input.principal_id,
      created_at: now
    };
    const updated = await this.repository.appendVersion(
      resource.resource_id,
      input.expected_version_id,
      version,
      now
    );
    await this.audit({
      event_type: "RESOURCE_VERSION_CREATED",
      tenant_id: resource.tenant_id,
      subject_principal_id: input.principal_id,
      resource_refs: [{
        resource_id: resource.resource_id,
        resource_version_id: version.resource_version_id
      }],
      decision: { outcome: "SUCCESS", reason_codes: ["cas_version_created"] },
      evidence_refs: [version.content_digest]
    });
    return { resource: updated, version };
  }

  async createDerivedResource(
    input: Omit<UploadResourceInput, "kind" | "provenance"> & {
      derived_from: ResourceVersionRef[];
      acquisition_operation: string;
      request_id?: string;
      trace_id?: string;
    }
  ): Promise<{
    resource: Resource;
    version: ResourceVersion;
    resource_ref: ResourceRefContract;
  }> {
    if (input.derived_from.length === 0) {
      throw new ResourceError(
        "PC_RESOURCE_PROVENANCE_REQUIRED",
        "Derived Resource requires at least one exact source version"
      );
    }
    for (const ref of input.derived_from) {
      const version = await this.requireVersion(ref.resource_version_id);
      const resource = await this.requireResource(ref.resource_id);
      if (
        version.resource_id !== resource.resource_id
        || resource.tenant_id !== input.tenant_id
      ) {
        throw new ResourceError(
          "PC_RESOURCE_PROVENANCE_SCOPE_MISMATCH",
          "Derived Resource source is outside the requested tenant"
        );
      }
    }
    return this.uploadResource({
      ...input,
      kind: "DERIVED",
      provenance: {
        source_system: "process-copilot",
        acquisition_operation: input.acquisition_operation,
        ...(input.request_id === undefined ? {} : { request_id: input.request_id }),
        ...(input.trace_id === undefined ? {} : { trace_id: input.trace_id }),
        derived_from: clone(input.derived_from)
      }
    });
  }

  async createArtifactResource(input: {
    tenant_id: string;
    principal_id: string;
    display_name: string;
    classification: Extract<ResourceClassification, "INTERNAL" | "CONFIDENTIAL">;
    media_type: string;
    content: Uint8Array;
    derived_from: ResourceVersionRef[];
    acquisition_operation: string;
    request_id: string;
    trace_id?: string;
  }): Promise<{
    resource: Resource;
    version: ResourceVersion;
    resource_ref: ResourceRefContract & {
      media_type: string;
      display_name: string;
    };
  }> {
    if (input.derived_from.length === 0) {
      throw new ResourceError(
        "PC_RESOURCE_PROVENANCE_REQUIRED",
        "Artifact Resource requires at least one exact source version"
      );
    }
    for (const reference of input.derived_from) {
      await this.readResourceVersion({
        tenant_id: input.tenant_id,
        principal_id: input.principal_id,
        resource_id: reference.resource_id,
        resource_version_id: reference.resource_version_id
      });
    }
    const created = await this.uploadResource({
      tenant_id: input.tenant_id,
      principal_id: input.principal_id,
      kind: "ARTIFACT",
      display_name: input.display_name,
      classification: input.classification,
      owner_scope: {
        scope_type: "USER_ROOT",
        scope_id: input.principal_id
      },
      media_type: input.media_type,
      content: input.content,
      provenance: {
        source_system: "process-copilot",
        acquisition_operation: input.acquisition_operation,
        request_id: input.request_id,
        ...(input.trace_id === undefined ? {} : { trace_id: input.trace_id }),
        derived_from: clone(input.derived_from)
      }
    });
    return {
      ...created,
      resource_ref: {
        ...created.resource_ref,
        media_type: created.version.media_type,
        display_name: created.resource.display_name
      }
    };
  }

  async readResourceVersion(input: {
    tenant_id: string;
    principal_id: string;
    resource_id: string;
    resource_version_id: string;
  }): Promise<{
    resource_ref: ResourceRefContract & {
      media_type: string;
      display_name: string;
    };
    content: Uint8Array;
  }> {
    const resource = await this.requireResource(input.resource_id);
    this.assertTenant(resource, input.tenant_id);
    if (resource.lifecycle_status !== "ACTIVE") {
      throw new ResourceError(
        "PC_RESOURCE_NOT_ACTIVE",
        "Inactive Resources cannot be read"
      );
    }
    const version = await this.requireVersion(input.resource_version_id);
    if (version.resource_id !== resource.resource_id) {
      throw new ResourceError(
        "PC_RESOURCE_VERSION_MISMATCH",
        "ResourceVersion does not belong to the requested Resource"
      );
    }
    if (resource.created_by !== input.principal_id) {
      const bindings = await this.repository.listBindings(resource.resource_id);
      let allowed = false;
      for (const binding of bindings) {
        if (
          binding.revoked_at !== undefined
          || !binding.allowed_actions.includes("READ")
        ) continue;
        try {
          await this.assertScopeAuthorized(
            input.tenant_id,
            input.principal_id,
            "READ",
            {
              scope_type: binding.scope_type,
              scope_id: binding.scope_id
            }
          );
          allowed = true;
          break;
        } catch (error) {
          if (
            !(error instanceof ResourceError)
            || error.code !== "PC_RESOURCE_SCOPE_DENIED"
          ) throw error;
        }
      }
      if (!allowed) {
        throw new ResourceError(
          "PC_RESOURCE_READ_DENIED",
          "ResourceVersion is not readable by this Principal"
        );
      }
    }
    const content = await this.blobs.read(version.blob_ref);
    if (digest(content) !== version.content_digest) {
      throw new ResourceError(
        "PC_RESOURCE_DIGEST_MISMATCH",
        "Stored ResourceVersion content failed digest verification"
      );
    }
    return {
      resource_ref: {
        ...this.resourceRef(resource, version),
        media_type: version.media_type,
        display_name: resource.display_name
      },
      content
    };
  }

  async createBinding(input: {
    tenant_id: string;
    principal_id: string;
    pc_session_id?: string;
    resource_id: string;
    scope: ResourceScope;
    allowed_actions: ResourceAction[];
  }): Promise<ResourceBinding> {
    const resource = await this.requireResource(input.resource_id);
    this.assertTenant(resource, input.tenant_id);
    if (resource.created_by !== input.principal_id) {
      throw new ResourceError(
        "PC_RESOURCE_OWNER_DENIED",
        "Only the Resource owner can create a new Binding"
      );
    }
    await this.assertScopeAuthorized(
      input.tenant_id,
      input.principal_id,
      "SHARE",
      input.scope,
      input.pc_session_id
    );
    const binding: ResourceBinding = {
      binding_id: `rb_${randomUUID()}`,
      tenant_id: input.tenant_id,
      resource_id: resource.resource_id,
      scope_type: input.scope.scope_type,
      scope_id: required(input.scope.scope_id, "scope_id"),
      allowed_actions: uniqueActions(input.allowed_actions),
      created_by: input.principal_id,
      created_at: this.now().toISOString()
    };
    await this.repository.createBinding(binding);
    await this.audit({
      event_type: "RESOURCE_BOUND",
      tenant_id: resource.tenant_id,
      subject_principal_id: input.principal_id,
      resource_refs: [{
        resource_id: resource.resource_id,
        resource_version_id: resource.current_version_id
      }],
      decision: { outcome: "SUCCESS", reason_codes: ["binding_created"] },
      evidence_refs: [binding.binding_id]
    });
    return clone(binding);
  }

  async revokeBinding(input: {
    tenant_id: string;
    principal_id: string;
    binding_id: string;
  }): Promise<ResourceBinding> {
    const binding = await this.repository.getBinding(input.binding_id);
    if (binding === undefined || binding.tenant_id !== input.tenant_id) {
      throw new ResourceError("PC_RESOURCE_BINDING_NOT_FOUND", "Binding was not found");
    }
    await this.assertScopeAuthorized(
      input.tenant_id,
      input.principal_id,
      "SHARE",
      { scope_type: binding.scope_type, scope_id: binding.scope_id }
    );
    const revoked = await this.repository.revokeBinding(
      binding.binding_id,
      this.now().toISOString()
    );
    const resource = await this.requireResource(binding.resource_id);
    await this.audit({
      event_type: "RESOURCE_BINDING_REVOKED",
      tenant_id: binding.tenant_id,
      subject_principal_id: input.principal_id,
      resource_refs: [{
        resource_id: resource.resource_id,
        resource_version_id: resource.current_version_id
      }],
      decision: { outcome: "SUCCESS", reason_codes: ["binding_revoked"] },
      evidence_refs: [binding.binding_id]
    });
    return revoked;
  }

  async createWorkspaceView(input: {
    tenant_id: string;
    principal_id: string;
    pc_session_id: string;
    authorization_revision: number;
    binding_ids: string[];
    allowed_actions: ResourceAction[];
    ttl_seconds?: number;
  }): Promise<WorkspaceViewSnapshot> {
    const allowedActions = uniqueActions(input.allowed_actions);
    const bindings: WorkspaceViewBinding[] = [];
    for (const bindingId of [...new Set(input.binding_ids)].sort()) {
      const binding = await this.repository.getBinding(bindingId);
      if (
        binding === undefined
        || binding.revoked_at !== undefined
        || binding.tenant_id !== input.tenant_id
      ) {
        throw new ResourceError(
          "PC_RESOURCE_BINDING_UNAVAILABLE",
          "Workspace View contains a missing, revoked or cross-tenant Binding"
        );
      }
      const scope = { scope_type: binding.scope_type, scope_id: binding.scope_id };
      await this.assertScopeAuthorized(
        input.tenant_id,
        input.principal_id,
        "READ",
        scope,
        input.pc_session_id
      );
      const effectiveActions = binding.allowed_actions.filter((action) =>
        allowedActions.includes(action)
      );
      if (effectiveActions.length === 0) {
        throw new ResourceError(
          "PC_RESOURCE_ACTION_INTERSECTION_EMPTY",
          "Workspace View action set does not intersect the Binding"
        );
      }
      const resource = await this.requireResource(binding.resource_id);
      if (resource.lifecycle_status !== "ACTIVE") {
        throw new ResourceError(
          "PC_RESOURCE_NOT_ACTIVE",
          "Workspace View cannot include an inactive Resource"
        );
      }
      bindings.push({
        binding_id: binding.binding_id,
        resource_ref: {
          resource_id: resource.resource_id,
          resource_version_id: resource.current_version_id
        },
        scope_type: binding.scope_type,
        scope_id: binding.scope_id,
        allowed_actions: effectiveActions
      });
    }
    const now = this.now();
    const semantic = {
      tenant_id: required(input.tenant_id, "tenant_id"),
      pc_session_id: required(input.pc_session_id, "pc_session_id"),
      principal_id: required(input.principal_id, "principal_id"),
      authorization_revision: input.authorization_revision,
      bindings,
      allowed_actions: allowedActions
    };
    const ttlSeconds = input.ttl_seconds === undefined
      ? undefined
      : positiveInteger(input.ttl_seconds, "ttl_seconds");
    const snapshot: WorkspaceViewSnapshot = {
      contract_name: "pc.workspace-view-snapshot/1",
      contract_version: 1,
      workspace_view_snapshot_id: `wvs_${randomUUID()}`,
      ...semantic,
      created_at: now.toISOString(),
      ...(ttlSeconds === undefined
        ? {}
        : { expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString() }),
      snapshot_digest: digest(semantic)
    };
    await this.repository.saveWorkspaceView(snapshot);
    return clone(snapshot);
  }

  async materialize(input: {
    tenant_id: string;
    principal_id: string;
    workspace_view_snapshot_id: string;
    resource_refs: ResourceVersionRef[];
    purpose: MaterializationRecord["purpose"];
    target_runtime_id: string;
    target_runtime_epoch: number;
    pc_session_id: string;
    ttl_seconds: number;
    allowed_actions: ResourceAction[];
  }): Promise<MaterializationResultContract> {
    const snapshot = await this.requireWorkspaceView(
      input.workspace_view_snapshot_id
    );
    this.assertSnapshotOwner(snapshot, input);
    const now = this.now();
    if (
      snapshot.expires_at !== undefined
      && Date.parse(snapshot.expires_at) <= now.getTime()
    ) {
      throw new ResourceError(
        "PC_RESOURCE_WORKSPACE_VIEW_EXPIRED",
        "Workspace View Snapshot has expired"
      );
    }
    const actions = uniqueActions(input.allowed_actions);
    if (actions.some((action) => !snapshot.allowed_actions.includes(action))) {
      throw new ResourceError(
        "PC_RESOURCE_ACTION_NOT_ALLOWED",
        "Materialization requests an action outside the Workspace View"
      );
    }
    const requestedRefs = [...new Map(
      input.resource_refs.map((ref) => [
        `${ref.resource_id}:${ref.resource_version_id}`,
        ref
      ])
    ).values()];
    if (requestedRefs.length === 0) {
      throw new ResourceError(
        "PC_RESOURCE_REFS_REQUIRED",
        "Materialization requires at least one ResourceVersion"
      );
    }
    const entries: Parameters<WorkspaceMaterializer["materialize"]>[0]["entries"] = [];
    for (const ref of requestedRefs) {
      const viewBinding = snapshot.bindings.find((binding) =>
        binding.resource_ref.resource_id === ref.resource_id
        && binding.resource_ref.resource_version_id === ref.resource_version_id
      );
      if (
        viewBinding === undefined
        || actions.some((action) => !viewBinding.allowed_actions.includes(action))
      ) {
        throw new ResourceError(
          "PC_RESOURCE_NOT_IN_WORKSPACE_VIEW",
          "ResourceVersion is not whitelisted for the requested actions"
        );
      }
      const [resource, version] = await Promise.all([
        this.requireResource(ref.resource_id),
        this.requireVersion(ref.resource_version_id)
      ]);
      if (
        resource.tenant_id !== input.tenant_id
        || version.resource_id !== resource.resource_id
      ) {
        throw new ResourceError(
          "PC_RESOURCE_SCOPE_MISMATCH",
          "ResourceVersion identity does not match the Workspace View"
        );
      }
      const content = await this.blobs.read(version.blob_ref);
      if (digest(content) !== version.content_digest) {
        throw new ResourceError(
          "PC_RESOURCE_INTEGRITY_FAILURE",
          "Stored ResourceVersion failed digest verification"
        );
      }
      entries.push({
        version,
        display_name: resource.display_name,
        content,
        mode: actions.includes("WRITE") ? "READ_WRITE" : "READ_ONLY"
      });
    }
    const materializationId = `mat_${randomUUID()}`;
    const created = await this.materializer.materialize({
      tenant_id: input.tenant_id,
      principal_id: input.principal_id,
      pc_session_id: input.pc_session_id,
      target_runtime_id: input.target_runtime_id,
      target_runtime_epoch: input.target_runtime_epoch,
      materialization_id: materializationId,
      entries
    });
    const expiresAt = new Date(
      now.getTime() + positiveInteger(input.ttl_seconds, "ttl_seconds") * 1000
    ).toISOString();
    const resultFields = {
      materialization_id: materializationId,
      state: "READY" as const,
      mount_ref: `materialization:${materializationId}`,
      materialized_entries: created.entries,
      failed_entries: [],
      expires_at: expiresAt,
      cleanup_state: "ACTIVE" as const
    };
    const record: MaterializationRecord = {
      ...resultFields,
      tenant_id: input.tenant_id,
      principal_id: input.principal_id,
      workspace_view_snapshot_id: snapshot.workspace_view_snapshot_id,
      pc_session_id: input.pc_session_id,
      target_runtime_id: input.target_runtime_id,
      target_runtime_epoch: input.target_runtime_epoch,
      purpose: input.purpose,
      allowed_actions: actions,
      internal_root: created.internal_root,
      requested_at: now.toISOString(),
      result_digest: digest(resultFields)
    };
    await this.repository.saveMaterialization(record);
    await this.audit({
      event_type: "RESOURCE_MATERIALIZED",
      tenant_id: input.tenant_id,
      subject_principal_id: input.principal_id,
      resource_refs: requestedRefs,
      decision: { outcome: "SUCCESS", reason_codes: ["workspace_view_whitelist"] },
      evidence_refs: [record.mount_ref, record.result_digest]
    });
    return publicMaterialization(record);
  }

  async cleanupExpired(): Promise<MaterializationResultContract[]> {
    const now = this.now().toISOString();
    const records = await this.repository.listExpiredMaterializations(now);
    const cleaned: MaterializationResultContract[] = [];
    for (const record of records) {
      let cleanupState: CleanupState = "CLEANED";
      try {
        await this.materializer.cleanup(record.internal_root);
      } catch {
        cleanupState = "FAILED";
      }
      const updated: MaterializationRecord = {
        ...record,
        state: cleanupState === "CLEANED" ? "CLEANED" : "EXPIRED",
        cleanup_state: cleanupState
      };
      await this.repository.updateMaterialization(updated);
      cleaned.push(publicMaterialization(updated));
      await this.audit({
        event_type: cleanupState === "CLEANED"
          ? "MATERIALIZATION_CLEANED"
          : "MATERIALIZATION_CLEANUP_FAILED",
        tenant_id: record.tenant_id,
        subject_principal_id: record.principal_id,
        resource_refs: record.materialized_entries.map((entry) => ({
          resource_id: entry.resource_id,
          resource_version_id: entry.resource_version_id
        })),
        decision: {
          outcome: cleanupState === "CLEANED" ? "SUCCESS" : "FAILURE",
          reason_codes: [cleanupState.toLowerCase()]
        },
        evidence_refs: [record.mount_ref]
      });
    }
    return cleaned;
  }

  async transitionLifecycle(input: {
    tenant_id: string;
    principal_id: string;
    resource_id: string;
    expected_lifecycle: ResourceLifecycle;
    lifecycle: ResourceLifecycle;
  }): Promise<Resource> {
    const resource = await this.requireResource(input.resource_id);
    this.assertOwner(resource, input.tenant_id, input.principal_id);
    const allowed: Record<ResourceLifecycle, ResourceLifecycle[]> = {
      ACTIVE: ["ARCHIVED", "DELETION_REQUESTED"],
      ARCHIVED: ["ACTIVE", "DELETION_REQUESTED"],
      DELETION_REQUESTED: ["DELETED"],
      DELETED: []
    };
    if (!allowed[input.expected_lifecycle].includes(input.lifecycle)) {
      throw new ResourceError(
        "PC_RESOURCE_LIFECYCLE_TRANSITION_INVALID",
        `Resource cannot transition from ${input.expected_lifecycle} to ${input.lifecycle}`
      );
    }
    const updated = await this.repository.updateLifecycle(
      resource.resource_id,
      input.expected_lifecycle,
      input.lifecycle,
      this.now().toISOString()
    );
    await this.audit({
      event_type: `RESOURCE_${input.lifecycle}`,
      tenant_id: resource.tenant_id,
      subject_principal_id: input.principal_id,
      resource_refs: [{
        resource_id: resource.resource_id,
        resource_version_id: resource.current_version_id
      }],
      decision: { outcome: "SUCCESS", reason_codes: ["lifecycle_transition"] },
      evidence_refs: []
    });
    return updated;
  }

  getWorkspaceView(snapshotId: string): Promise<WorkspaceViewSnapshot | undefined> {
    return this.repository.getWorkspaceView(snapshotId);
  }

  async getResourceProjection(resourceId: string): Promise<{
    resource: Resource;
    versions: ResourceVersion[];
    bindings: ResourceBinding[];
    audit: ResourceAuditEntry[];
  }> {
    const resource = await this.requireResource(resourceId);
    const [versions, bindings, audit] = await Promise.all([
      this.repository.listVersions(resourceId),
      this.repository.listBindings(resourceId),
      this.repository.listAudit(resourceId)
    ]);
    return { resource, versions, bindings, audit };
  }

  async assertWorkspaceAdmission(input: WorkspaceAdmissionInput): Promise<{
    materialization_id: string;
    mount_ref: string;
    expires_at: string;
  }> {
    const snapshot = await this.requireWorkspaceView(
      input.workspace_view_snapshot_id
    );
    this.assertSnapshotOwner(snapshot, {
      tenant_id: input.tenant_id,
      principal_id: input.principal_id,
      pc_session_id: input.pc_session_id
    });
    if (snapshot.authorization_revision !== input.authorization_revision) {
      throw new ResourceError(
        "PC_RESOURCE_AUTHORIZATION_REVISION_STALE",
        "Workspace View Authorization Revision is stale"
      );
    }
    const now = this.now();
    if (
      snapshot.expires_at !== undefined
      && Date.parse(snapshot.expires_at) <= now.getTime()
    ) {
      throw new ResourceError(
        "PC_RESOURCE_WORKSPACE_VIEW_EXPIRED",
        "Workspace View Snapshot has expired"
      );
    }
    const active = await this.repository.findActiveMaterialization({
      workspace_view_snapshot_id: input.workspace_view_snapshot_id,
      pc_session_id: input.pc_session_id,
      target_runtime_id: input.runtime_id,
      target_runtime_epoch: input.runtime_epoch,
      now: now.toISOString()
    });
    if (active === undefined) {
      throw new ResourceError(
        "PC_RESOURCE_MATERIALIZATION_REQUIRED",
        "Runtime Assignment requires an active matching Materialization"
      );
    }
    return {
      materialization_id: active.materialization_id,
      mount_ref: active.mount_ref,
      expires_at: active.expires_at
    };
  }

  private async assertScopeAuthorized(
    tenantId: string,
    principalId: string,
    action: ResourceAction,
    scope: ResourceScope,
    pcSessionId?: string
  ): Promise<void> {
    const scopeId = required(scope.scope_id, "scope_id");
    let allowed = false;
    if (scope.scope_type === "USER_ROOT" || scope.scope_type === "USER_SHARED") {
      allowed = scopeId === principalId;
    } else if (scope.scope_type === "SESSION") {
      allowed = pcSessionId !== undefined && scopeId === pcSessionId;
    } else if (this.scopeAuthorization !== undefined) {
      allowed = await this.scopeAuthorization.authorize({
        tenant_id: tenantId,
        principal_id: principalId,
        action,
        scope: { scope_type: scope.scope_type, scope_id: scopeId }
      });
    }
    if (!allowed) {
      throw new ResourceError(
        "PC_RESOURCE_SCOPE_DENIED",
        "Principal is not authorized for the Resource scope"
      );
    }
  }

  private assertOwner(
    resource: Resource,
    tenantId: string,
    principalId: string
  ): void {
    this.assertTenant(resource, tenantId);
    if (resource.created_by !== principalId) {
      throw new ResourceError(
        "PC_RESOURCE_OWNER_DENIED",
        "Only the Resource owner can perform this operation"
      );
    }
  }

  private assertTenant(resource: Resource, tenantId: string): void {
    if (resource.tenant_id !== tenantId) {
      throw new ResourceError(
        "PC_RESOURCE_TENANT_MISMATCH",
        "Resource belongs to another tenant"
      );
    }
  }

  private assertSnapshotOwner(
    snapshot: WorkspaceViewSnapshot,
    input: {
      tenant_id: string;
      principal_id: string;
      pc_session_id: string;
    }
  ): void {
    if (
      snapshot.tenant_id !== input.tenant_id
      || snapshot.principal_id !== input.principal_id
      || snapshot.pc_session_id !== input.pc_session_id
    ) {
      throw new ResourceError(
        "PC_RESOURCE_WORKSPACE_VIEW_SCOPE_MISMATCH",
        "Workspace View does not belong to this tenant, principal and Session"
      );
    }
  }

  private async requireResource(resourceId: string): Promise<Resource> {
    const resource = await this.repository.getResource(resourceId);
    if (resource === undefined) {
      throw new ResourceError("PC_RESOURCE_NOT_FOUND", "Resource was not found");
    }
    return resource;
  }

  private async requireVersion(resourceVersionId: string): Promise<ResourceVersion> {
    const version = await this.repository.getVersion(resourceVersionId);
    if (version === undefined) {
      throw new ResourceError(
        "PC_RESOURCE_VERSION_NOT_FOUND",
        "ResourceVersion was not found"
      );
    }
    return version;
  }

  private async requireWorkspaceView(
    snapshotId: string
  ): Promise<WorkspaceViewSnapshot> {
    const snapshot = await this.repository.getWorkspaceView(snapshotId);
    if (snapshot === undefined) {
      throw new ResourceError(
        "PC_RESOURCE_WORKSPACE_VIEW_NOT_FOUND",
        "Workspace View Snapshot was not found"
      );
    }
    return snapshot;
  }

  private resourceRef(
    resource: Resource,
    version: ResourceVersion
  ): ResourceRefContract {
    return {
      contract_name: "pc.resource-ref/1",
      contract_version: 1,
      resource_id: resource.resource_id,
      resource_version_id: version.resource_version_id,
      resource_type: resource.kind,
      tenant_id: resource.tenant_id,
      owner_scope: clone(resource.owner_scope),
      content_digest: version.content_digest,
      classification: resource.classification,
      provenance_ref: `provenance:${version.resource_version_id}`
    };
  }

  private async audit(
    input: Omit<
      ResourceAuditEntry,
      "contract_name" | "contract_version" | "audit_id" | "occurred_at" | "entry_hash" | "retention_class"
    >
  ): Promise<void> {
    const unsigned = {
      contract_name: "pc.audit-entry/1" as const,
      contract_version: 1 as const,
      audit_id: `audit_${randomUUID()}`,
      ...clone(input),
      occurred_at: this.now().toISOString(),
      retention_class: "RESOURCE_LIFECYCLE" as const
    };
    await this.repository.appendAudit({
      ...unsigned,
      entry_hash: digest(unsigned)
    });
  }
}
