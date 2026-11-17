import { createHash, randomUUID } from "node:crypto";
import type {
  EffectiveProfileResolution,
  EffectiveProfileSnapshot,
  ExpertProfileRelease,
  PluginRelease,
  ProfileAssignment,
  ProfileResolutionReport,
  ProfileRuntimeAdmissionInput,
  ReleaseStatus,
  RuntimeCapabilityManifest,
  ToolRelease
} from "@pc/domain";
import { ProfileCapabilityError } from "@pc/domain";

export interface PublishExpertProfileInput {
  readonly profile_release_id: string;
  readonly profile_definition_id: string;
  readonly release_version: number;
  readonly instructions_ref: string;
  readonly rules_ref: string;
  readonly tool_requirements: readonly string[];
  readonly plugin_requirements: readonly string[];
  readonly model_policy: Readonly<Record<string, unknown>>;
  readonly knowledge_policy: Readonly<Record<string, unknown>>;
  readonly output_contract: Readonly<Record<string, unknown>>;
  readonly completion_contract: Readonly<Record<string, unknown>>;
  readonly dependency_lock_digest: string;
  readonly published_at?: string;
}

export type PublishToolReleaseInput = Omit<
  ToolRelease,
  "contract_name" | "contract_version" | "status" | "release_digest"
>;

export type PublishPluginReleaseInput = Omit<
  PluginRelease,
  "contract_name" | "contract_version" | "status" | "release_digest"
>;

export interface ResolveEffectiveProfileInput {
  readonly principal_id: string;
  readonly pc_session_id: string;
  readonly requested_profile_release_id: string;
  readonly authorization_revision: number;
  readonly model_selection: Readonly<Record<string, unknown>>;
  readonly knowledge_view_refs: readonly string[];
  readonly dsh_preset_ref: string;
  readonly runtime_manifest: RuntimeCapabilityManifest;
}

export interface ProfileCapabilityRepository {
  listSessionSnapshots(pcSessionId: string): Promise<EffectiveProfileSnapshot[]>;
  initialize(): Promise<void>;
  close(): Promise<void>;
  putProfileRelease(release: ExpertProfileRelease): Promise<ExpertProfileRelease>;
  getProfileRelease(
    profileReleaseId: string
  ): Promise<ExpertProfileRelease | undefined>;
  transitionProfileRelease(
    profileReleaseId: string,
    expectedStatus: ReleaseStatus,
    status: ReleaseStatus
  ): Promise<ExpertProfileRelease>;
  putToolRelease(release: ToolRelease): Promise<ToolRelease>;
  getToolRelease(toolReleaseId: string): Promise<ToolRelease | undefined>;
  putPluginRelease(release: PluginRelease): Promise<PluginRelease>;
  getPluginRelease(pluginReleaseId: string): Promise<PluginRelease | undefined>;
  assignProfile(
    principalId: string,
    profileReleaseId: string,
    now: string
  ): Promise<ProfileAssignment>;
  getActiveProfileAssignment(
    principalId: string,
    profileReleaseId: string
  ): Promise<ProfileAssignment | undefined>;
  saveResolution(
    report: ProfileResolutionReport,
    snapshot?: EffectiveProfileSnapshot
  ): Promise<void>;
  getEffectiveProfileSnapshot(
    snapshotId: string
  ): Promise<EffectiveProfileSnapshot | undefined>;
}

export interface EffectiveProfileAdmissionPort {
  assertRuntimeAdmission(input: ProfileRuntimeAdmissionInput): Promise<void>;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ProfileCapabilityError(
        "PC_PROFILE_NON_CANONICAL_VALUE",
        "Profile data contains a non-finite number"
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new ProfileCapabilityError(
    "PC_PROFILE_NON_CANONICAL_VALUE",
    "Profile data must be JSON-compatible"
  );
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    freeze(child);
  }
  return value;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new ProfileCapabilityError(
      "PC_PROFILE_INVALID_ARGUMENT",
      `${field} is required`,
      false,
      { field }
    );
  }
  return normalized;
}

function releaseDigest(value: object): string {
  const payload = { ...(value as Record<string, unknown>) };
  delete payload.release_digest;
  delete payload.status;
  return digest(payload);
}

export class ProfileCapabilityService implements EffectiveProfileAdmissionPort {
  listSessionSnapshots(pcSessionId: string): Promise<EffectiveProfileSnapshot[]> {
    return this.repository.listSessionSnapshots(pcSessionId);
  }
  constructor(
    private readonly repository: ProfileCapabilityRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  initialize(): Promise<void> {
    return this.repository.initialize();
  }

  close(): Promise<void> {
    return this.repository.close();
  }

  publishExpertProfile(
    input: PublishExpertProfileInput
  ): Promise<ExpertProfileRelease> {
    const releaseWithoutDigest = {
      contract_name: "pc.expert-profile-release/1" as const,
      contract_version: 1 as const,
      profile_release_id: required(
        input.profile_release_id,
        "profile_release_id"
      ),
      profile_definition_id: required(
        input.profile_definition_id,
        "profile_definition_id"
      ),
      release_version: input.release_version,
      status: "PUBLISHED" as const,
      instructions_ref: required(input.instructions_ref, "instructions_ref"),
      rules_ref: required(input.rules_ref, "rules_ref"),
      tool_requirements: [...new Set(input.tool_requirements)].sort(),
      plugin_requirements: [...new Set(input.plugin_requirements)].sort(),
      model_policy: structuredClone(input.model_policy),
      knowledge_policy: structuredClone(input.knowledge_policy),
      output_contract: structuredClone(input.output_contract),
      completion_contract: structuredClone(input.completion_contract),
      dependency_lock_digest: required(
        input.dependency_lock_digest,
        "dependency_lock_digest"
      ),
      published_at: input.published_at === undefined
        ? this.now().toISOString()
        : required(input.published_at, "published_at")
    };
    return this.repository.putProfileRelease(freeze({
      ...releaseWithoutDigest,
      release_digest: releaseDigest(releaseWithoutDigest)
    }));
  }

  publishToolRelease(input: PublishToolReleaseInput): Promise<ToolRelease> {
    const releaseWithoutDigest = {
      contract_name: "pc.tool-release/1" as const,
      contract_version: 1 as const,
      ...structuredClone(input),
      status: "PUBLISHED" as const
    };
    return this.repository.putToolRelease(freeze({
      ...releaseWithoutDigest,
      release_digest: releaseDigest(releaseWithoutDigest)
    }));
  }

  publishPluginRelease(
    input: PublishPluginReleaseInput
  ): Promise<PluginRelease> {
    const releaseWithoutDigest = {
      contract_name: "pc.plugin-release/1" as const,
      contract_version: 1 as const,
      ...structuredClone(input),
      status: "PUBLISHED" as const
    };
    return this.repository.putPluginRelease(freeze({
      ...releaseWithoutDigest,
      release_digest: releaseDigest(releaseWithoutDigest)
    }));
  }

  async assignProfile(
    principalId: string,
    profileReleaseId: string
  ): Promise<ProfileAssignment> {
    const release = await this.requirePublishedProfile(profileReleaseId);
    return this.repository.assignProfile(
      required(principalId, "principal_id"),
      release.profile_release_id,
      this.now().toISOString()
    );
  }

  transitionProfileRelease(
    profileReleaseId: string,
    expectedStatus: ReleaseStatus,
    status: ReleaseStatus
  ): Promise<ExpertProfileRelease> {
    if (status === "PUBLISHED") {
      throw new ProfileCapabilityError(
        "PC_PROFILE_INVALID_TRANSITION",
        "A revoked or superseded release cannot be republished in place"
      );
    }
    return this.repository.transitionProfileRelease(
      profileReleaseId,
      expectedStatus,
      status
    );
  }

  async resolveEffectiveProfile(
    input: ResolveEffectiveProfileInput
  ): Promise<EffectiveProfileResolution> {
    const createdAt = this.now().toISOString();
    const profile = await this.repository.getProfileRelease(
      input.requested_profile_release_id
    );
    const assignment = await this.repository.getActiveProfileAssignment(
      input.principal_id,
      input.requested_profile_release_id
    );
    const hardFailures: string[] = [];
    const selectedTools: ToolRelease[] = [];
    const selectedPlugins: PluginRelease[] = [];

    if (profile === undefined) {
      hardFailures.push("profile_release_not_found");
    } else if (profile.status !== "PUBLISHED") {
      hardFailures.push(`profile_release_${profile.status.toLowerCase()}`);
    }
    if (assignment === undefined) hardFailures.push("profile_assignment_missing");

    if (profile !== undefined) {
      for (const toolId of profile.tool_requirements) {
        const tool = await this.repository.getToolRelease(toolId);
        if (tool === undefined || tool.status !== "PUBLISHED") {
          hardFailures.push(`tool_release_unavailable:${toolId}`);
        } else {
          selectedTools.push(tool);
        }
      }
      for (const pluginId of profile.plugin_requirements) {
        const plugin = await this.repository.getPluginRelease(pluginId);
        if (plugin === undefined || plugin.status !== "PUBLISHED") {
          hardFailures.push(`plugin_release_unavailable:${pluginId}`);
        } else {
          selectedPlugins.push(plugin);
        }
      }
    }

    const requiredDshVersion = selectedPlugins[0]?.dsh_compatibility
      ?? input.runtime_manifest.dsh_version;
    const requiredBridgeProtocol = "1.0";
    const actualBridgeProtocols =
      input.runtime_manifest.bridge_protocol_versions;
    const runtimeCompatible =
      input.runtime_manifest.dsh_version === requiredDshVersion
      && actualBridgeProtocols.includes(requiredBridgeProtocol);
    if (!runtimeCompatible) hardFailures.push("runtime_capability_incompatible");

    const report: ProfileResolutionReport = freeze({
      contract_name: "pc.profile-resolution-report/1",
      contract_version: 1,
      resolution_report_id: randomUUID(),
      requested_profile_release_id: input.requested_profile_release_id,
      inputs: {
        principal_id: input.principal_id,
        pc_session_id: input.pc_session_id,
        authorization_revision: input.authorization_revision,
        runtime_id: input.runtime_manifest.runtime_id,
        runtime_epoch: input.runtime_manifest.runtime_epoch
      },
      selected: {
        profile_release_id: profile?.profile_release_id,
        tool_release_ids: selectedTools.map((tool) => tool.tool_release_id),
        plugin_release_ids: selectedPlugins.map(
          (plugin) => plugin.plugin_release_id
        )
      },
      omitted: {},
      conflicts: [],
      warnings: [],
      hard_failures: hardFailures,
      runtime_compatibility: {
        compatible: runtimeCompatible,
        required_dsh_version: requiredDshVersion,
        actual_dsh_version: input.runtime_manifest.dsh_version,
        required_bridge_protocol: requiredBridgeProtocol,
        actual_bridge_protocols: actualBridgeProtocols
      },
      created_at: createdAt
    });

    if (
      hardFailures.length > 0
      || profile === undefined
      || assignment === undefined
    ) {
      await this.repository.saveResolution(report);
      return { report };
    }

    const semanticSnapshot = {
      pc_session_id: required(input.pc_session_id, "pc_session_id"),
      profile_release_id: profile.profile_release_id,
      profile_assignment_ids: [assignment.profile_assignment_id],
      authorization_revision: input.authorization_revision,
      tool_release_ids: selectedTools.map((tool) => tool.tool_release_id).sort(),
      plugin_release_ids: selectedPlugins
        .map((plugin) => plugin.plugin_release_id)
        .sort(),
      model_selection: structuredClone(input.model_selection),
      knowledge_view_refs: [...input.knowledge_view_refs].sort(),
      dsh_preset_ref: required(input.dsh_preset_ref, "dsh_preset_ref"),
      runtime_requirements: {
        dsh_version: requiredDshVersion,
        bridge_protocol_version: requiredBridgeProtocol,
        profile_digest: input.runtime_manifest.profile_digest,
        bundle_lock_digest: input.runtime_manifest.bundle_lock_digest
      }
    };
    const snapshot: EffectiveProfileSnapshot = freeze({
      contract_name: "pc.effective-profile-snapshot/1",
      contract_version: 1,
      effective_profile_snapshot_id: randomUUID(),
      ...semanticSnapshot,
      resolution_report_id: report.resolution_report_id,
      created_at: createdAt,
      snapshot_digest: digest(semanticSnapshot)
    });
    await this.repository.saveResolution(report, snapshot);
    return { report, snapshot };
  }

  async assertRuntimeAdmission(
    input: ProfileRuntimeAdmissionInput
  ): Promise<void> {
    const snapshot = await this.repository.getEffectiveProfileSnapshot(
      input.effective_profile_snapshot_id
    );
    if (snapshot === undefined) {
      throw new ProfileCapabilityError(
        "PC_PROFILE_SNAPSHOT_NOT_FOUND",
        "Effective Profile Snapshot was not found"
      );
    }
    const requirements = snapshot.runtime_requirements;
    if (
      input.runtime_manifest.dsh_version !== requirements.dsh_version
      || !input.runtime_manifest.bridge_protocol_versions.includes(
        requirements.bridge_protocol_version
      )
      || input.runtime_manifest.profile_digest !== requirements.profile_digest
      || input.runtime_manifest.bundle_lock_digest
        !== requirements.bundle_lock_digest
    ) {
      throw new ProfileCapabilityError(
        "PC_PROFILE_RUNTIME_INCOMPATIBLE",
        "Runtime capability manifest does not satisfy the Effective Profile Snapshot",
        false,
        {
          effective_profile_snapshot_id:
            input.effective_profile_snapshot_id,
          runtime_id: input.runtime_manifest.runtime_id,
          runtime_epoch: input.runtime_manifest.runtime_epoch
        }
      );
    }
  }

  getEffectiveProfileSnapshot(
    snapshotId: string
  ): Promise<EffectiveProfileSnapshot | undefined> {
    return this.repository.getEffectiveProfileSnapshot(snapshotId);
  }

  getToolRelease(toolReleaseId: string): Promise<ToolRelease | undefined> {
    return this.repository.getToolRelease(toolReleaseId);
  }

  getProfileRelease(
    profileReleaseId: string
  ): Promise<ExpertProfileRelease | undefined> {
    return this.repository.getProfileRelease(profileReleaseId);
  }

  async seedFixedFoRelease(): Promise<{
    profile: ExpertProfileRelease;
    tool: ToolRelease;
    plugin: PluginRelease;
  }> {
    const tool = await this.publishToolRelease({
      tool_release_id: "tool:ssts-draft:1",
      tool_definition_id: "tool:ssts-draft",
      version: 1,
      provider_kind: "process-copilot-internal",
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      schema_digest: digest({ input: "ssts-draft", output: "draft" }),
      risk_manifest: {
        action_class: "READ",
        external_side_effect: false,
        sensitivity: "LOW",
        requires_readback: false
      },
      required_permissions: ["draft.generate"],
      approval_policy: "NONE",
      idempotency_class: "IDEMPOTENT",
      recovery_class: "REPLAY_SAFE",
      compatibility: { contract: "1" },
      artifact_refs: ["artifact:ssts-draft-tool:1"]
    });
    const plugin = await this.publishPluginRelease({
      plugin_release_id: "plugin:pc-runtime-bridge:1",
      plugin_definition_id: "plugin:pc-runtime-bridge",
      version: 1,
      source: {
        type: "repository",
        ref: "packages/dsh-bridge",
        contract: "1.0"
      },
      artifact_digest: digest({ plugin: "pc-runtime-bridge", version: 1 }),
      signature_refs: ["signature:local-build:1"],
      sbom_ref: "sbom:pc-runtime-bridge:1",
      dsh_compatibility: "0.2.1-rc.3",
      dependencies: [],
      declared_capabilities: [
        "assignment-guard",
        "session-resume",
        "event-catch-up"
      ],
      risk_manifest: { modifies_dsh_core: false }
    });
    const profile = await this.publishExpertProfile({
      profile_release_id: "profile:fo-ssts-draft:1",
      profile_definition_id: "profile:fo-ssts-draft",
      release_version: 1,
      instructions_ref: "profiles/process-copilot-runtime/cordis.patch.yml",
      rules_ref: "profiles/process-copilot-runtime/README.md",
      tool_requirements: [tool.tool_release_id],
      plugin_requirements: [plugin.plugin_release_id],
      model_policy: { mode: "configured-runtime-model" },
      knowledge_policy: { source: "session-materialized-only" },
      output_contract: { kind: "AI_DRAFT", enterprise_write: false },
      completion_contract: { requires_source_refs: true },
      dependency_lock_digest: digest({
        dsh: "0.2.1-rc.3",
        plugin: plugin.release_digest,
        tool: tool.release_digest
      }),
      published_at: "2026-11-10T00:00:00.000Z"
    });
    return { profile, tool, plugin };
  }

  private async requirePublishedProfile(
    profileReleaseId: string
  ): Promise<ExpertProfileRelease> {
    const profile = await this.repository.getProfileRelease(profileReleaseId);
    if (profile === undefined || profile.status !== "PUBLISHED") {
      throw new ProfileCapabilityError(
        "PC_PROFILE_RELEASE_UNAVAILABLE",
        "Profile Release is missing, revoked or superseded"
      );
    }
    return profile;
  }
}
