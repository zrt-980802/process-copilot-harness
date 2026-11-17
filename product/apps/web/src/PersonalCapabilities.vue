<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Activity, BadgeCheck, Boxes, ChevronRight, PlugZap, RefreshCw, ShieldCheck, UserRound, Wrench, X } from "lucide-vue-next";
import { request } from "./api";
import type { CapabilityChain, Workspace } from "./types";

interface Tool {
  tool_release_id: string; tool_definition_id: string; input_schema: Record<string, unknown>;
  compatibility: { domain?: string; display_name?: string; description?: string };
  risk_manifest: { action_class: string }; approval_policy: string; recovery_class: string;
}
type Project = { project_code: string; project_name: string };
type Capability = Tool & { projects: Project[] };
const props = defineProps<{ token: string; projects: Project[]; tasks: Workspace[]; project: string; query: string }>();
const tools = ref<Capability[]>([]);
const chain = ref<CapabilityChain>();
const busy = ref(false);
const errors = ref<string[]>([]);
const detail = ref<Capability>();
const domains: Record<string, string> = { projects: "项目", requirements: "需求", functions: "功能",
  specifications: "技术规范", traceability: "追溯关系", controlled_commands: "受控命令", other: "其他" };
const chainProject = computed(() => props.project || props.projects[0]?.project_code || "");
const chainTask = computed(() => [...props.tasks]
  .filter((task) => task.project_code === chainProject.value)
  .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]);
const visible = computed(() => tools.value.filter((tool) => (!props.project || tool.projects.some((project) => project.project_code === props.project))
  && JSON.stringify(tool).toLowerCase().includes(props.query.trim().toLowerCase())));
const groups = computed(() => Object.entries(domains).map(([key, name]) => ({ key, name,
  tools: visible.value.filter((tool) => (domains[tool.compatibility.domain ?? ""] ? tool.compatibility.domain : "other") === key) })).filter((group) => group.tools.length));
const recent = computed(() => chain.value?.recent_operations[0]);
const chainNodes = computed(() => chain.value ? [
  { key: "scope", title: "账号与项目", icon: UserRound, state: "ready",
    value: `${chain.value.scope.project_code} · ${chain.value.scope.project_name}`,
    meta: `授权版本 ${chain.value.scope.authorization_revision}` },
  { key: "profile", title: "Profile / Snapshot", icon: BadgeCheck,
    state: chain.value.effective_snapshot ? "ready" : chain.value.profile ? "idle" : "empty",
    value: chain.value.profile?.profile_definition_id ?? "当前项目尚无任务 Profile",
    meta: chain.value.effective_snapshot?.effective_profile_snapshot_id ?? (chain.value.profile ? "任务尚未建立有效快照" : "创建任务后绑定") },
  { key: "tools", title: "Effective Tool Set", icon: Wrench,
    state: chain.value.tool_set.length ? "ready" : "empty",
    value: `${chain.value.tool_set.length} 项当前授权工具`,
    meta: chain.value.tool_set.map((tool) => tool.tool_definition_id).join(" · ") || "无项目工具" },
  { key: "runtime", title: "Runtime / Plugin", icon: Boxes,
    state: chain.value.runtime?.manifest ? "ready" : "idle",
    value: chain.value.runtime?.manifest ? `${chain.value.runtime.state} · DSH ${chain.value.runtime.manifest.dsh_version}` : "尚无既有 Runtime 会话",
    meta: chain.value.runtime?.manifest?.plugin_releases.map(String).join(" · ") || "查看不会创建 Runtime" },
  { key: "connector", title: "MCP Provider", icon: PlugZap,
    state: chain.value.connector.state === "ACTIVE" ? "ready" : "empty",
    value: `${chain.value.connector.mcp_server_id} · ${chain.value.connector.state}`,
    meta: `${chain.value.connector.provider_key} / ${chain.value.connector.auth_mode}` },
  { key: "operation", title: "Operation / Trace", icon: Activity,
    state: recent.value ? "ready" : "idle",
    value: recent.value ? `${recent.value.tool_name ?? recent.value.operation_kind} · ${recent.value.state}` : "暂无调用记录",
    meta: recent.value?.trace_refs[0] ?? "执行工具后记录可追溯证据" },
  { key: "authority", title: "EE 业务权威", icon: ShieldCheck,
    state: chain.value.tool_set.length ? "ready" : "empty",
    value: chain.value.tool_set.length ? "项目成员与工具权限均已通过" : "没有项目 Tool Set",
    meta: "EE 逐请求重新判权" }
] : []);
let generation = 0;
async function refresh() {
  const version = ++generation;
  tools.value = []; chain.value = undefined; detail.value = undefined; errors.value = []; busy.value = true;
  const results = await Promise.allSettled(props.projects.map(async (project) => ({ project,
    catalog: await request<{ tools: Tool[] }>(`/v1/workbench/catalog?project_code=${encodeURIComponent(project.project_code)}`, props.token) })));
  if (version !== generation) return;
  const merged = new Map<string, Capability>();
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") { errors.value.push(`${props.projects[index]?.project_code}：能力暂时无法读取`); continue; }
    for (const tool of result.value.catalog.tools) {
      const existing = merged.get(tool.tool_release_id);
      if (existing) existing.projects.push(result.value.project);
      else merged.set(tool.tool_release_id, { ...tool, projects: [result.value.project] });
    }
  }
  tools.value = [...merged.values()];
  if (chainProject.value) {
    const query = new URLSearchParams({ project_code: chainProject.value });
    if (chainTask.value) query.set("workspace_id", chainTask.value.workspace_id);
    try {
      let result: CapabilityChain;
      try { result = await request<CapabilityChain>(`/v1/workbench/capability-chain?${query}`, props.token); }
      catch (error) {
        if (!chainTask.value) throw error;
        const projectOnly = new URLSearchParams({ project_code: chainProject.value });
        result = await request<CapabilityChain>(`/v1/workbench/capability-chain?${projectOnly}`, props.token);
        if (version === generation) errors.value.push(`${chainProject.value}：既有任务链已失效，当前仅展示项目授权链`);
      }
      if (version === generation) chain.value = result;
    } catch { if (version === generation) errors.value.push(`${chainProject.value}：调用链暂时无法读取`); }
  }
  if (version === generation) busy.value = false;
}
watch(() => [props.token, props.projects.map((item) => item.project_code).join("|"), props.project,
  props.tasks.map((item) => `${item.workspace_id}:${item.updated_at}`).join("|")], () => { void refresh(); }, { immediate: true });
watch(() => props.query, () => { detail.value = undefined; });
</script>

<template>
  <section class="home-section personal-capabilities" aria-label="我的能力" :aria-busy="busy">
    <div class="section-title"><h2>能力调用链</h2><div class="capability-heading-actions"><span class="source-tag"><ShieldCheck :size="13" />只读视图</span><button class="icon-button" title="刷新能力调用链" :disabled="busy" @click="refresh"><RefreshCw :size="16" :class="{ spin: busy }" /></button></div></div>
    <p class="capability-explanation">展示当前账号在项目中的真实授权链。读取本页不会准备 Runtime、调用模型或执行 MCP。</p>
    <div v-if="errors.length" class="home-warning" role="alert"><p v-for="error in errors" :key="error">{{ error }}</p></div>
    <p v-if="busy" class="home-loading" role="status">正在读取授权与既有执行记录</p>
    <div v-if="chain" class="capability-chain-heading"><div><strong>{{ chain.scope.project_code }} 调用链</strong><small v-if="!project">当前展示首个授权项目；可在上方切换项目</small><small v-else>当前项目</small></div><span v-if="chain.workspace" class="pill">{{ chain.workspace.title }}</span><span v-else class="pill neutral">尚无项目任务</span></div>
    <ol v-if="chain" class="capability-chain" aria-label="能力调用层级">
      <li v-for="(node, index) in chainNodes" :key="node.key" :class="`chain-${node.state}`">
        <div class="chain-icon"><component :is="node.icon" :size="18" /></div>
        <div><small>{{ String(index + 1).padStart(2, '0') }}</small><strong>{{ node.title }}</strong><span>{{ node.value }}</span><code>{{ node.meta }}</code></div>
        <ChevronRight v-if="index < chainNodes.length - 1" class="chain-arrow" :size="16" />
      </li>
    </ol>
    <div v-else-if="!busy && !projects.length" class="capability-no-scope"><ShieldCheck :size="23" /><div><strong>当前账号没有项目 Tool Set</strong><p>平台身份不等于项目成员资格。未获得显式项目成员授权时，不建立项目 Profile、Runtime 或 MCP 调用链。</p></div></div>
    <section v-if="chain?.recent_operations.length" class="chain-evidence"><h3>最近调用证据</h3><div v-for="operation in chain.recent_operations" :key="operation.operation_id"><Activity :size="15" /><div><strong>{{ operation.tool_name || operation.operation_kind }}</strong><small>{{ operation.state }}{{ operation.outcome_state ? ` · ${operation.outcome_state}` : '' }}</small><code v-if="operation.trace_refs.length">{{ operation.trace_refs.join(' · ') }}</code><code v-else>{{ operation.operation_id }}</code></div></div></section>

    <div class="section-title capability-tools-title"><h2>我的能力 <small>{{ visible.length }}</small></h2></div>
    <p class="capability-explanation">按项目 Catalog 展示当前可用工具。实际执行仍按项目权限校验，受控操作需人工审批。</p>
    <div class="capability-groups"><section v-for="group in groups" :key="group.key"><h2>{{ group.name }} <small>{{ group.tools.length }}</small></h2><button v-for="tool in group.tools" :key="tool.tool_release_id" class="capability-item" @click="detail = tool"><Wrench v-if="tool.risk_manifest.action_class === 'READ'" :size="19" /><ShieldCheck v-else :size="19" /><div><strong>{{ tool.compatibility.display_name || tool.tool_definition_id }}</strong><code>{{ tool.tool_definition_id }}</code><small class="capability-projects">{{ tool.projects.filter(item => !project || item.project_code === project).map(item => item.project_code).join(' · ') }}</small></div><span class="pill" :class="{ controlled: tool.risk_manifest.action_class !== 'READ' }">{{ tool.risk_manifest.action_class === 'READ' ? '只读' : '精确审批' }}</span><ChevronRight :size="15" /></button></section></div>
    <p v-if="!busy && !visible.length" class="home-empty">{{ errors.length ? '未能读取匹配的能力，请重试' : '暂无匹配的授权能力' }}</p>
    <aside v-if="detail" class="detail-drawer" aria-label="能力详情"><header><div><small>我的能力 · MCP 工具</small><h2>{{ detail.compatibility.display_name || detail.tool_definition_id }}</h2><code>{{ detail.tool_definition_id }}</code></div><button class="icon-button" title="关闭能力详情" @click="detail = undefined"><X :size="19" /></button></header><div class="detail-content"><p>{{ detail.compatibility.description }}</p><h3>授权项目</h3><p v-for="item in detail.projects" :key="item.project_code">{{ item.project_code }} · {{ item.project_name }}</p><dl><dt>操作</dt><dd>{{ detail.risk_manifest.action_class }}</dd><dt>审批策略</dt><dd>{{ detail.approval_policy }}</dd><dt>恢复策略</dt><dd>{{ detail.recovery_class }}</dd></dl><details><summary>参数与协议</summary><pre>{{ JSON.stringify(detail.input_schema, null, 2) }}</pre><code>{{ detail.tool_release_id }}</code></details></div></aside>
  </section>
</template>
