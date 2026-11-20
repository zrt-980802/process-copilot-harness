import type { SystemCapabilities } from "./types";

export interface Project { project_code: string; project_name: string }
export interface ExperienceTool {
  tool_release_id: string; tool_definition_id: string; schema_digest?: string;
  compatibility: { display_name?: string; domain?: string; description?: string };
  risk_manifest: { action_class: string }; input_schema?: Record<string, any>;
  approval_policy?: string; recovery_class?: string;
}
export interface ProjectCatalog { connector: { capability_digest: string }; tools: ExperienceTool[] }
export type Row = Record<string, any>;

// EE identifiers are adapter protocol, never the product navigation or identity.
export const sceneTools = {
  context: "ee.get_project_context", requirements: "ee.list_requirements", functions: "ee.list_functions",
  specifications: "ee.list_ssts", specification: "ee.get_ssts", matrix: "ee.get_function_ssts_matrix",
  stats: "ee.get_traceability_stats", candidate: "ee.create_ssts_candidate",
  submit: "ee.submit_ssts_review", decide: "ee.decide_ssts_review"
} as const;

export function sceneCapabilities(tools: readonly ExperienceTool[]) {
  const has = (name: string) => tools.some(tool => tool.tool_definition_id === name);
  return { engineering: has(sceneTools.functions), requirements: has(sceneTools.requirements),
    ssts: has(sceneTools.specifications) && has(sceneTools.specification),
    approvals: tools.some(tool => tool.risk_manifest.action_class !== "READ"),
    projectData: tools.some(tool => Object.values(sceneTools).includes(tool.tool_definition_id as never)
      && tool.risk_manifest.action_class === "READ") };
}

export function taskScene(profile: string): "conversation" | "ssts" | "generic" {
  if (profile.startsWith("profile:conversation:")) return "conversation";
  return /(?:^|[:_-])ssts(?:[:_-]|$)/u.test(profile) || profile.startsWith("profile:ee-review:") ? "ssts" : "generic";
}

export function providerState(health: SystemCapabilities): string {
  const state = health.provider_bundle?.bundle_state ?? health.provider_health?.provider_state;
  if (state) return state === "HEALTHY" ? "READY" : state;
  if (health.capabilities.project_workbench === "available") return "READY";
  return health.capabilities.ee_provider === "unconfigured" ? "UNCONFIGURED" : "UNAVAILABLE";
}

export function unwrap(envelope: Row): Row {
  const data = envelope.structuredContent ?? envelope;
  const result = data.result?.data ?? data.data ?? data.result ?? data;
  return result.result ?? result;
}

export function projectView(results: Record<string, Row>, tools: readonly ExperienceTool[]) {
  const permitted = new Set(tools.map(tool => tool.tool_definition_id));
  const read = (name: string) => permitted.has(name) && results[name] ? unwrap(results[name]!) : {};
  const requirements: Row[] = read(sceneTools.requirements).items ?? [];
  const functions: Row[] = read(sceneTools.functions).functions ?? read(sceneTools.functions).items ?? [];
  const matrix: Row[] = read(sceneTools.matrix).matrix ?? [];
  const specifications: Row[] = (read(sceneTools.specifications).items ?? []).map((spec: Row) => ({ ...spec,
    associated_functions: matrix.filter(row => (row.ssts_links ?? []).some((link: Row) =>
      link.ssts_code === spec.ssts_code && link.status === "confirmed")).map(row => row.function_code) }));
  return { requirements, functions, specifications,
    sourceLabel: requirements.length + functions.length + specifications.length > 0 ? "EE" : "" };
}

export function sourceLinks(project: string, payload: Row | undefined, tools: readonly ExperienceTool[]) {
  if (!project || !tools.some(tool => tool.tool_definition_id === sceneTools.context)) return [];
  const links = [{ uri: `eea://projects/${project}`, name: "项目来源" }];
  const document = payload ? unwrap(payload).document : undefined;
  if (document?.ssts_code && tools.some(tool => tool.tool_definition_id === sceneTools.specification)) {
    links.push({ uri: `eea://projects/${project}/ssts/${encodeURIComponent(document.ssts_code)}`, name: document.ssts_code });
  }
  return links;
}

export function sourceCommand(project: string, uri: string) {
  const prefix = `eea://projects/${project}`;
  if (uri === prefix) return { name: sceneTools.context, arguments: {} };
  if (uri.startsWith(prefix + "/ssts/")) return { name: sceneTools.specification,
    arguments: { ssts_code: decodeURIComponent(uri.slice((prefix + "/ssts/").length)) } };
  return undefined;
}
