import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(process.cwd(), "packages", "contracts");
const manifest = JSON.parse(
  await readFile(path.join(packageRoot, "contract-manifest.json"), "utf8")
) as {
  contracts: Array<{
    id: string;
    schema: string;
    valid_fixture: string;
    invalid_fixture: string;
  }>;
};

describe("C01-C69 contract fixtures", () => {
  it("contains exactly 69 schemas and fixture pairs", async () => {
    await expect(readdir(path.join(packageRoot, "schemas"))).resolves.toHaveLength(69);
    await expect(readdir(path.join(packageRoot, "fixtures", "valid"))).resolves.toHaveLength(69);
    await expect(readdir(path.join(packageRoot, "fixtures", "invalid"))).resolves.toHaveLength(69);
  });

  for (const contract of manifest.contracts) {
    it(`${contract.id} accepts valid and rejects invalid fixture`, async () => {
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      const schema = JSON.parse(
        await readFile(path.join(packageRoot, contract.schema), "utf8")
      );
      const validFixture = JSON.parse(
        await readFile(path.join(packageRoot, contract.valid_fixture), "utf8")
      );
      const invalidFixture = JSON.parse(
        await readFile(path.join(packageRoot, contract.invalid_fixture), "utf8")
      );
      const validate = ajv.compile(schema);

      expect(validate(validFixture), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(invalidFixture)).toBe(false);
      expect(validate.errors?.some((error) => error.keyword === "required")).toBe(true);
    });
  }

  it("freezes the DEV-05 EE Claw security semantics", async () => {
    const c37 = JSON.parse(
      await readFile(
        path.join(
          packageRoot,
          "schemas",
          "C37.eeclaw.role-module-relation-1.schema.json"
        ),
        "utf8"
      )
    );
    expect(c37.properties.visibility.enum).toEqual(["none", "visible"]);
    expect(c37.properties.capabilities.items.enum).toEqual([
      "read",
      "edit",
      "approve",
      "publish"
    ]);

    const c41 = JSON.parse(
      await readFile(
        path.join(
          packageRoot,
          "schemas",
          "C41.eeclaw.authorization-decision-1.schema.json"
        ),
        "utf8"
      )
    );
    expect(c41.required).not.toContain("authorization_revision");
    expect(c41.required).toContain("authorization_version_digest");
    expect(c41.required).toContain("observed_at");

    const c42Schema = JSON.parse(
      await readFile(
        path.join(
          packageRoot,
          "schemas",
          "C42.eeclaw.legacy-auth-compatibility-1.schema.json"
        ),
        "utf8"
      )
    );
    const c42Fixture = JSON.parse(
      await readFile(
        path.join(packageRoot, "fixtures", "valid", "C42.valid.json"),
        "utf8"
      )
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(c42Schema);

    expect(c42Fixture.source_commit).toBe(
      "cefa7432f966e17b41c1638e128de652b934fd20"
    );
    expect(c42Fixture.baseline_page_keys_version).toBe(
      "BASELINE_PAGE_KEYS_V1"
    );
    expect(c42Fixture.data_migration_required).toBe(false);
    expect(c42Fixture.baseline_page_keys_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(validate(c42Fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(
      validate({ ...c42Fixture, data_migration_required: true })
    ).toBe(false);
  });

  it("freezes the Memory object/revision and session invalidation semantics", async () => {
    const c43 = JSON.parse(await readFile(path.join(
      packageRoot, "schemas", "C43.pc.memory-object-1.schema.json"
    ), "utf8"));
    const c44 = JSON.parse(await readFile(path.join(
      packageRoot, "schemas", "C44.pc.memory-revision-1.schema.json"
    ), "utf8"));
    const c60 = JSON.parse(await readFile(path.join(
      packageRoot, "schemas", "C60.pc.memory-session-invalidation-1.schema.json"
    ), "utf8"));

    expect(c43.properties.object_state.enum).not.toContain("SUPERSEDED");
    expect(c43.properties.object_state.enum).toContain("REVOKED");
    expect(c44.properties.revision_state.enum).toEqual([
      "CURRENT", "SUPERSEDED", "WITHDRAWN"
    ]);
    expect(c60.properties.rotation_policy.enum).toEqual([
      "FRESH_SESSION_NO_REPLAY"
    ]);
    expect(c60.additionalProperties).toBe(false);

    const c51 = JSON.parse(await readFile(path.join(
      packageRoot, "schemas", "C51.pc.authorized-memory-view-1.schema.json"
    ), "utf8"));
    const c52 = JSON.parse(await readFile(path.join(
      packageRoot, "schemas", "C52.pc.runtime-memory-context-1.schema.json"
    ), "utf8"));
    const c51Fixture = JSON.parse(await readFile(path.join(
      packageRoot, "fixtures", "valid", "C51.valid.json"
    ), "utf8"));
    const c52Fixture = JSON.parse(await readFile(path.join(
      packageRoot, "fixtures", "valid", "C52.valid.json"
    ), "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validateView = ajv.compile(c51);
    const validateContext = ajv.compile(c52);
    const withoutTemporalRole = structuredClone(c51Fixture);
    delete withoutTemporalRole.items[0].temporal_role;
    expect(validateView(withoutTemporalRole)).toBe(false);
    const withToolGrant = structuredClone(c52Fixture);
    withToolGrant.items[0].tool_release_id = "forbidden-tool";
    expect(validateContext(withToolGrant)).toBe(false);
  });

  it("freezes external-provider authority routing and non-authoritative availability semantics", async () => {
    const c61 = JSON.parse(await readFile(path.join(
      packageRoot, "schemas", "C61.pc.provider-registration-1.schema.json"
    ), "utf8"));
    const c63 = JSON.parse(await readFile(path.join(
      packageRoot, "schemas", "C63.pc.authority-route-1.schema.json"
    ), "utf8"));
    const c64 = JSON.parse(await readFile(path.join(
      packageRoot, "schemas", "C64.pc.project-directory-snapshot-1.schema.json"
    ), "utf8"));
    const c65 = JSON.parse(await readFile(path.join(
      packageRoot, "schemas", "C65.pc.capability-availability-1.schema.json"
    ), "utf8"));
    const route = JSON.parse(await readFile(path.join(
      packageRoot, "fixtures", "valid", "C63.valid.json"
    ), "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validateRoute = ajv.compile(c63);

    expect(c61.additionalProperties).toBe(false);
    expect(c61.properties.port_kinds.items.enum).toContain("PROJECT_DIRECTORY");
    expect(c64.properties).not.toHaveProperty("decision");
    expect(c64.properties).not.toHaveProperty("allowed_actions");
    expect(c65.properties).not.toHaveProperty("decision");
    expect(c65.properties.capabilities.items.properties.availability_state.enum).toEqual([
      "AVAILABLE", "DEGRADED", "UNAVAILABLE", "DISABLED"
    ]);
    expect(validateRoute(route), JSON.stringify(validateRoute.errors)).toBe(true);
    expect(validateRoute({ ...route, authorization_mode: "PC_ONLY" })).toBe(false);
    const pcOnly = {
      ...route,
      authorization_mode: "PC_ONLY",
      action_namespace: "conversation.run",
      action_pattern: "conversation.run",
      resource_authority: "pc",
      resource_scope_pattern: "user:*",
      capability_provider_required: false
    };
    delete pcOnly.provider_registration_id;
    expect(validateRoute(pcOnly), JSON.stringify(validateRoute.errors)).toBe(true);
  });
});
