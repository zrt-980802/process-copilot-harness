import { evidenceDigest, IdentityAuthorizationError } from "@pc/domain";

export interface ProviderCompatibilityMapping {
  contract_name: "pc.provider-compatibility-mapping/1";
  contract_version: 1;
  mapping_release_id: string;
  provider_registration_id: string;
  provider_type: string;
  compatibility_version: string;
  pc_action_pattern: string;
  resource_authority: string;
  provider_permission_mapping: { permission_keys: readonly string[]; baseline_page_keys_version: string };
  provider_action_mapping: { action_keys: readonly string[] };
  provider_tool_mapping: { tool_keys: readonly string[] };
  decision_mode: "PC_AND_PROVIDER";
  artifact_digest: string;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "REVOKED";
  effective_from: string;
  supersedes_release_id?: string;
}

export class CompatibilityMappingRegistry {
  private readonly releases = new Map<string, ProviderCompatibilityMapping>();

  constructor(releases: readonly ProviderCompatibilityMapping[] = []) { releases.forEach(release => this.register(release)); }

  register(release: ProviderCompatibilityMapping): void {
    const existing = this.releases.get(release.mapping_release_id);
    if (release.contract_name !== "pc.provider-compatibility-mapping/1" || release.contract_version !== 1
      || release.artifact_digest !== evidenceDigest(release, "artifact_digest")
      || (existing && existing.artifact_digest !== release.artifact_digest)) {
      throw new IdentityAuthorizationError("PC_AUTHORITY_MAPPING_DENIED", "Mapping release integrity is invalid");
    }
    this.releases.set(release.mapping_release_id, structuredClone(release));
  }

  resolve(input: { action: string; provider_registration_id: string; resource_authority: string; compatibility_version: string;
    tool_keys: readonly string[]; observed_at: string }): ProviderCompatibilityMapping {
    const matches = [...this.releases.values()].filter(release => release.status === "ACTIVE"
      && release.provider_registration_id === input.provider_registration_id && release.resource_authority === input.resource_authority
      && release.pc_action_pattern === input.action && input.tool_keys.every(key => release.provider_tool_mapping.tool_keys.includes(key))
      && (input.action !== "tool.execute" || input.tool_keys.length === 1));
    const release = matches[0];
    if (matches.length !== 1 || !release || release.decision_mode !== "PC_AND_PROVIDER"
      || release.compatibility_version !== input.compatibility_version || release.provider_type !== input.resource_authority
      || release.artifact_digest !== evidenceDigest(release, "artifact_digest")
      || !Number.isFinite(Date.parse(release.effective_from)) || Date.parse(release.effective_from) > Date.parse(input.observed_at)
      || release.provider_permission_mapping.permission_keys.length !== 1 || release.provider_action_mapping.action_keys.length !== 1
      || !["read", "edit", "review"].includes(release.provider_action_mapping.action_keys[0]!)
      || !release.provider_tool_mapping.tool_keys.length) {
      throw new IdentityAuthorizationError("PC_AUTHORITY_MAPPING_DENIED", "No unique compatible mapping release exists");
    }
    return structuredClone(release);
  }
}
