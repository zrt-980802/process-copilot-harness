import type {
  MaterializationRecord,
  Resource,
  ResourceAuditEntry,
  ResourceBinding,
  ResourceLifecycle,
  ResourceRepository,
  ResourceVersion,
  WorkspaceViewSnapshot
} from "@pc/resource";
import { ResourceError } from "@pc/resource";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryResourceRepository implements ResourceRepository {
  private readonly resources = new Map<string, Resource>();
  private readonly versions = new Map<string, ResourceVersion>();
  private readonly bindings = new Map<string, ResourceBinding>();
  private readonly views = new Map<string, WorkspaceViewSnapshot>();
  private readonly materializations = new Map<string, MaterializationRecord>();
  private readonly audits = new Map<string, ResourceAuditEntry>();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  createResource(resource: Resource, version: ResourceVersion): Promise<void> {
    if (
      this.resources.has(resource.resource_id)
      || this.versions.has(version.resource_version_id)
    ) {
      throw new ResourceError(
        "PC_RESOURCE_CONFLICT",
        "Resource or ResourceVersion already exists"
      );
    }
    this.resources.set(resource.resource_id, clone(resource));
    this.versions.set(version.resource_version_id, clone(version));
    return Promise.resolve();
  }

  getResource(resourceId: string): Promise<Resource | undefined> {
    const resource = this.resources.get(resourceId);
    return Promise.resolve(resource === undefined ? undefined : clone(resource));
  }

  getVersion(resourceVersionId: string): Promise<ResourceVersion | undefined> {
    const version = this.versions.get(resourceVersionId);
    return Promise.resolve(version === undefined ? undefined : clone(version));
  }

  listVersions(resourceId: string): Promise<ResourceVersion[]> {
    return Promise.resolve(
      [...this.versions.values()]
        .filter((version) => version.resource_id === resourceId)
        .sort((left, right) => left.version_seq - right.version_seq)
        .map(clone)
    );
  }

  appendVersion(
    resourceId: string,
    expectedVersionId: string,
    version: ResourceVersion,
    updatedAt: string
  ): Promise<Resource> {
    const resource = this.resources.get(resourceId);
    if (resource === undefined) {
      throw new ResourceError("PC_RESOURCE_NOT_FOUND", "Resource was not found");
    }
    if (resource.current_version_id !== expectedVersionId) {
      throw new ResourceError(
        "PC_RESOURCE_VERSION_CONFLICT",
        "Resource current version changed",
        true
      );
    }
    if (this.versions.has(version.resource_version_id)) {
      throw new ResourceError(
        "PC_RESOURCE_VERSION_CONFLICT",
        "ResourceVersion already exists",
        true
      );
    }
    const updated = {
      ...resource,
      current_version_id: version.resource_version_id,
      updated_at: updatedAt
    };
    this.versions.set(version.resource_version_id, clone(version));
    this.resources.set(resourceId, updated);
    return Promise.resolve(clone(updated));
  }

  updateLifecycle(
    resourceId: string,
    expectedLifecycle: ResourceLifecycle,
    lifecycle: ResourceLifecycle,
    updatedAt: string
  ): Promise<Resource> {
    const resource = this.resources.get(resourceId);
    if (resource === undefined) {
      throw new ResourceError("PC_RESOURCE_NOT_FOUND", "Resource was not found");
    }
    if (resource.lifecycle_status !== expectedLifecycle) {
      throw new ResourceError(
        "PC_RESOURCE_LIFECYCLE_CONFLICT",
        "Resource lifecycle changed",
        true
      );
    }
    const updated = {
      ...resource,
      lifecycle_status: lifecycle,
      updated_at: updatedAt
    };
    this.resources.set(resourceId, updated);
    return Promise.resolve(clone(updated));
  }

  createBinding(binding: ResourceBinding): Promise<void> {
    if (this.bindings.has(binding.binding_id)) {
      throw new ResourceError(
        "PC_RESOURCE_BINDING_CONFLICT",
        "Binding already exists"
      );
    }
    this.bindings.set(binding.binding_id, clone(binding));
    return Promise.resolve();
  }

  getBinding(bindingId: string): Promise<ResourceBinding | undefined> {
    const binding = this.bindings.get(bindingId);
    return Promise.resolve(binding === undefined ? undefined : clone(binding));
  }

  listBindings(resourceId: string): Promise<ResourceBinding[]> {
    return Promise.resolve(
      [...this.bindings.values()]
        .filter((binding) => binding.resource_id === resourceId)
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .map(clone)
    );
  }

  revokeBinding(bindingId: string, revokedAt: string): Promise<ResourceBinding> {
    const binding = this.bindings.get(bindingId);
    if (binding === undefined) {
      throw new ResourceError(
        "PC_RESOURCE_BINDING_NOT_FOUND",
        "Binding was not found"
      );
    }
    if (binding.revoked_at !== undefined) return Promise.resolve(clone(binding));
    const updated = { ...binding, revoked_at: revokedAt };
    this.bindings.set(bindingId, updated);
    return Promise.resolve(clone(updated));
  }

  saveWorkspaceView(snapshot: WorkspaceViewSnapshot): Promise<void> {
    if (this.views.has(snapshot.workspace_view_snapshot_id)) {
      throw new ResourceError(
        "PC_RESOURCE_WORKSPACE_VIEW_CONFLICT",
        "Workspace View Snapshot already exists"
      );
    }
    this.views.set(snapshot.workspace_view_snapshot_id, clone(snapshot));
    return Promise.resolve();
  }

  getWorkspaceView(
    workspaceViewSnapshotId: string
  ): Promise<WorkspaceViewSnapshot | undefined> {
    const snapshot = this.views.get(workspaceViewSnapshotId);
    return Promise.resolve(snapshot === undefined ? undefined : clone(snapshot));
  }

  saveMaterialization(record: MaterializationRecord): Promise<void> {
    if (this.materializations.has(record.materialization_id)) {
      throw new ResourceError(
        "PC_RESOURCE_MATERIALIZATION_CONFLICT",
        "Materialization already exists"
      );
    }
    this.materializations.set(record.materialization_id, clone(record));
    return Promise.resolve();
  }

  getMaterialization(
    materializationId: string
  ): Promise<MaterializationRecord | undefined> {
    const record = this.materializations.get(materializationId);
    return Promise.resolve(record === undefined ? undefined : clone(record));
  }

  findActiveMaterialization(input: {
    workspace_view_snapshot_id: string;
    pc_session_id: string;
    target_runtime_id: string;
    target_runtime_epoch: number;
    now: string;
  }): Promise<MaterializationRecord | undefined> {
    const record = [...this.materializations.values()].find((candidate) =>
      candidate.workspace_view_snapshot_id === input.workspace_view_snapshot_id
      && candidate.pc_session_id === input.pc_session_id
      && candidate.target_runtime_id === input.target_runtime_id
      && candidate.target_runtime_epoch === input.target_runtime_epoch
      && candidate.state === "READY"
      && candidate.cleanup_state === "ACTIVE"
      && Date.parse(candidate.expires_at) > Date.parse(input.now)
    );
    return Promise.resolve(record === undefined ? undefined : clone(record));
  }

  listExpiredMaterializations(now: string): Promise<MaterializationRecord[]> {
    return Promise.resolve(
      [...this.materializations.values()]
        .filter((record) =>
          record.cleanup_state === "ACTIVE"
          && Date.parse(record.expires_at) <= Date.parse(now)
        )
        .map(clone)
    );
  }

  updateMaterialization(record: MaterializationRecord): Promise<void> {
    if (!this.materializations.has(record.materialization_id)) {
      throw new ResourceError(
        "PC_RESOURCE_MATERIALIZATION_NOT_FOUND",
        "Materialization was not found"
      );
    }
    this.materializations.set(record.materialization_id, clone(record));
    return Promise.resolve();
  }

  appendAudit(entry: ResourceAuditEntry): Promise<void> {
    if (this.audits.has(entry.audit_id)) {
      throw new ResourceError("PC_RESOURCE_AUDIT_CONFLICT", "Audit entry exists");
    }
    this.audits.set(entry.audit_id, clone(entry));
    return Promise.resolve();
  }

  listAudit(resourceId: string): Promise<ResourceAuditEntry[]> {
    return Promise.resolve(
      [...this.audits.values()]
        .filter((entry) =>
          entry.resource_refs.some((reference) => reference.resource_id === resourceId)
        )
        .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at))
        .map(clone)
    );
  }
}
