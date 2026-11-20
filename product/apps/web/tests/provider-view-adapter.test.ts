import { describe, expect, it } from "vitest";
import { projectView, sceneCapabilities, sourceCommand, sourceLinks, taskScene, type ExperienceTool } from "../src/provider-view-adapter";

const tool = (name: string): ExperienceTool => ({ tool_definition_id: name, tool_release_id: name,
  compatibility: {}, risk_manifest: { action_class: "READ" } });
describe("provider scene adapter", () => {
  it("does not classify unknown personal or project profiles as SSTS", () => {
    expect(taskScene("profile:generic:1")).toBe("generic");
    expect(taskScene("profile:conversation:personal:1")).toBe("conversation");
    expect(taskScene("profile:ee-review:v2:1")).toBe("ssts");
    expect(taskScene("profile:fo-ssts-draft:1")).toBe("ssts");
  });
  it("accepts real result envelopes only for current tools and labels only returned rows", () => {
    const facts = { "ee.list_functions": { structuredContent: { result: { data: { functions: [{ code: "F1" }] } } } },
      "ee.list_ssts": { items: [{ ssts_code: "S1" }] } };
    expect(projectView(facts, []).sourceLabel).toBe("");
    const view = projectView(facts, [tool("ee.list_functions")]);
    expect(view.functions).toEqual([{ code: "F1" }]);
    expect(view.specifications).toEqual([]);
    expect(view.sourceLabel).toBe("EE");
    expect(projectView({}, [tool("ee.list_ssts")]).sourceLabel).toBe("");
  });
  it("removes the scene and owner links with missing capabilities", () => {
    expect(sceneCapabilities([tool("ee.list_ssts")]).ssts).toBe(false);
    expect(sourceLinks("P", {}, [])).toEqual([]);
    expect(sourceCommand("P", "eea://projects/OTHER/ssts/S1")).toBeUndefined();
  });
});
