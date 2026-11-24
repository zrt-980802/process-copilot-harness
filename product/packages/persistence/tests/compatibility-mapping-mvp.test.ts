import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import Ajv from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { CompatibilityMappingRegistry, EE_V1_MAPPING_RELEASES } from "@pc/application";
import { evidenceDigest } from "@pc/domain";

describe("T2C immutable C69 mapping registry", () => {
  const input = { action: "page:functions", provider_registration_id: "provider:eeclaw", resource_authority: "eeclaw",
    compatibility_version: "ee-v1", tool_keys: ["ee.list_functions"], observed_at: "2026-11-23T08:00:00.000Z" };

  it("pins the 26 original releases and validates every runtime artifact against C69", async () => {
    const bytes = await readFile(new URL("../../application/fixtures/ee-v1-mapping-release.json", import.meta.url));
    expect(createHash("sha256").update(bytes.toString().replaceAll("\r\n", "\n")).digest("hex")).toBe("d5e397a12a9659d933a2d2798df9a5c98ae3466cc08dd8bad135d315e53890bc");
    const fixture = JSON.parse(bytes.toString());
    expect(fixture).toEqual(EE_V1_MAPPING_RELEASES); expect(fixture).toHaveLength(26);
    const ajv = new Ajv({ strict: true, allErrors: true }); formats(ajv);
    const validate = ajv.compile(JSON.parse(await readFile(new URL("../../contracts/schemas/C69.pc.provider-compatibility-mapping-1.schema.json", import.meta.url), "utf8")));
    for (const release of EE_V1_MAPPING_RELEASES) {
      expect(validate(release), JSON.stringify(validate.errors)).toBe(true);
      expect(release.artifact_digest).toBe(evidenceDigest(release, "artifact_digest"));
    }
  });

  it.each(["missing", "ambiguous", "incompatible", "wrong authority", "unmapped tool", "new page", "wildcard"])("denies %s mapping", variant => {
    const release = EE_V1_MAPPING_RELEASES.find(item => item.pc_action_pattern === input.action)!;
    const extra = { ...structuredClone(release), mapping_release_id: "mapping:other" };
    extra.artifact_digest = evidenceDigest(extra, "artifact_digest");
    const registry = new CompatibilityMappingRegistry(variant === "missing" ? [] : variant === "ambiguous" ? [release, extra] : EE_V1_MAPPING_RELEASES);
    expect(() => registry.resolve({ ...input,
      ...(variant === "incompatible" ? { compatibility_version: "ee-v2" } : {}),
      ...(variant === "wrong authority" ? { resource_authority: "other" } : {}),
      ...(variant === "unmapped tool" ? { tool_keys: ["ee.unknown"] } : {}),
      ...(variant === "new page" ? { action: "page:new-feature" } : {}), ...(variant === "wildcard" ? { action: "page:*" } : {}) }))
      .toThrowError(expect.objectContaining({ code: "PC_AUTHORITY_MAPPING_DENIED" }));
  });

  it("rejects both stale digest and resealed mutation under an existing ACTIVE release id", () => {
    const registry = new CompatibilityMappingRegistry(EE_V1_MAPPING_RELEASES);
    const changed = structuredClone(EE_V1_MAPPING_RELEASES[0]!);
    changed.provider_permission_mapping = { ...changed.provider_permission_mapping, permission_keys: ["page:architecture"] };
    expect(() => registry.register(changed)).toThrowError(expect.objectContaining({ code: "PC_AUTHORITY_MAPPING_DENIED" }));
    changed.artifact_digest = evidenceDigest(changed, "artifact_digest");
    expect(() => registry.register(changed)).toThrowError(expect.objectContaining({ code: "PC_AUTHORITY_MAPPING_DENIED" }));
  });
});
