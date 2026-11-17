import type { RuntimeCapabilityManifest } from "./runtime-registry.js";

export type ReleaseStatus = "PUBLISHED" | "REVOKED" | "SUPERSEDED";

export interface ExpertProfileRelease {
  readonly contract_name: "pc.expert-profile-release/1";
  readonly contract_version: 1;
  readonly profile_release_id: string;
  readonly profile_definition_id: string;
  readonly release_version: number;
  readonly status: ReleaseStatus;
  readonly instructions_ref: string;
  readonly rules_ref: string;
  readonly tool_requirements: readonly string[];
  readonly plugin_requirements: readonly string[];
  readonly model_policy: Readonly<Record<string, unknown>>;
  readonly knowledge_policy: Readonly<Record<string, unknown>>;
  readonly output_contract: Readonly<Record<string, unknown>>;
  readonly completion_contract: Readonly<Record<string, unknown>>;
  readonly dependency_lock_digest: string;
  readonly published_at: string;
  readonly release_digest: string;
}

export interface ToolRelease {
  readonly contract_name: "pc.tool-release/1";
  readonly contract_version: 1;
  readonly tool_release_id: string;
  readonly tool_definition_id: string;
  readonly version: number;
  readonly provider_kind: string;
  readonly input_schema: Readonly<Record<string, unknown>>;
  readonly output_schema: Readonly<Record<string, unknown>>;
  readonly schema_digest: string;
  readonly risk_manifest: Readonly<Record<string, unknown>>;
  readonly required_permissions: readonly string[];
  readonly approval_policy: string;
  readonly idempotency_class: string;
  readonly recovery_class: string;
  readonly compatibility: Readonly<Record<string, unknown>>;
  readonly status: ReleaseStatus;
  readonly artifact_refs: readonly string[];
  readonly release_digest: string;
}

export interface PluginRelease {
  readonly contract_name: "pc.plugin-release/1";
  readonly contract_version: 1;
  readonly plugin_release_id: string;
  readonly plugin_definition_id: string;
  readonly version: number;
  readonly source: Readonly<Record<string, unknown>>;
  readonly artifact_digest: string;
  readonly signature_refs: readonly string[];
  readonly sbom_ref: string;
  readonly dsh_compatibility: string;
  readonly dependencies: readonly string[];
  readonly declared_capabilities: readonly string[];
  readonly risk_manifest: Readonly<Record<string, unknown>>;
  readonly status: ReleaseStatus;
  readonly release_digest: string;
}

export interface ProfileAssignment {
  readonly profile_assignment_id: string;
  readonly principal_id: string;
  readonly profile_release_id: string;
  readonly status: "active" | "revoked";
  readonly revision: number;
  readonly assigned_at: string;
  readonly revoked_at?: string;
}

export interface EffectiveProfileSnapshot {
  readonly contract_name: "pc.effective-profile-snapshot/1";
  readonly contract_version: 1;
  readonly effective_profile_snapshot_id: string;
  readonly pc_session_id: string;
  readonly profile_release_id: string;
  readonly profile_assignment_ids: readonly string[];
  readonly authorization_revision: number;
  readonly tool_release_ids: readonly string[];
  readonly plugin_release_ids: readonly string[];
  readonly model_selection: Readonly<Record<string, unknown>>;
  readonly knowledge_view_refs: readonly string[];
  readonly dsh_preset_ref: string;
  readonly runtime_requirements: Readonly<{
    dsh_version: string;
    bridge_protocol_version: string;
    profile_digest: string;
    bundle_lock_digest: string;
  }>;
  readonly resolution_report_id: string;
  readonly created_at: string;
  readonly snapshot_digest: string;
}

export interface ProfileResolutionReport {
  readonly contract_name: "pc.profile-resolution-report/1";
  readonly contract_version: 1;
  readonly resolution_report_id: string;
  readonly requested_profile_release_id: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly selected: Readonly<Record<string, unknown>>;
  readonly omitted: Readonly<Record<string, unknown>>;
  readonly conflicts: readonly string[];
  readonly warnings: readonly string[];
  readonly hard_failures: readonly string[];
  readonly runtime_compatibility: Readonly<{
    compatible: boolean;
    required_dsh_version: string;
    actual_dsh_version: string;
    required_bridge_protocol: string;
    actual_bridge_protocols: readonly unknown[];
  }>;
  readonly created_at: string;
}

export interface EffectiveProfileResolution {
  readonly report: ProfileResolutionReport;
  readonly snapshot?: EffectiveProfileSnapshot;
}

export interface ProfileRuntimeAdmissionInput {
  readonly effective_profile_snapshot_id: string;
  readonly runtime_manifest: RuntimeCapabilityManifest;
}

export class ProfileCapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ProfileCapabilityError";
  }
}
