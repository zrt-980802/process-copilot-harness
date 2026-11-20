import { readFile } from "node:fs/promises";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect, it } from "vitest";

it("versions Bundle independently while keeping Health and Availability semantics", async () => {
  const schema = JSON.parse(await readFile("packages/contracts/schemas/C66.pc.provider-bundle-1.schema.json", "utf8"));
  const fixture = JSON.parse(await readFile("packages/contracts/fixtures/valid/C66.valid.json", "utf8"));
  const ajv = new Ajv({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  for (const state of ["UNCONFIGURED", "STARTING", "READY", "DEGRADED", "UNAVAILABLE", "DISABLED"]) {
    expect(validate({ ...fixture, bundle_state: state })).toBe(true);
  }
  for (const change of [{ contract_version: 2 }, { bundle_state: "HEALTHY" }, { registration_revision: 0 }, { token: "forbidden" }, { endpoint: "http://credential@host" }]) {
    expect(validate({ ...fixture, ...change })).toBe(false);
  }
  const health = JSON.parse(await readFile("packages/contracts/schemas/C62.pc.provider-health-1.schema.json", "utf8"));
  expect(health.properties.provider_state.enum).toContain("HEALTHY");
  expect(health.properties.provider_state.enum).not.toContain("READY");
});
