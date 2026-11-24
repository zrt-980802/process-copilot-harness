<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Activity, ArrowRight, Blocks, Check, ChevronRight, CircleAlert, FileText, FolderOpen,
  GitBranch, Home, LayoutDashboard, List, LogOut, MessageSquare, RefreshCw, Search, ShieldCheck, Sparkles, UserRound, Wrench, X } from "lucide-vue-next";
import { api } from "./api";
import PersonalHome from "./PersonalHome.vue";
import type { Principal, TaskProjection, Workspace } from "./types";
import { roleLabel, type EEAccountPresentation } from "./account-presentation";
import type { ExperienceProjection, ExperienceSnapshot } from "./experience-policy";
import { useExperience } from "./experience-context";
import { projectView as adaptProjectView, sceneTools, taskScene, unwrap, type Row } from "./provider-view-adapter";

const props = defineProps<{ token: string; principal: Principal; accountName: string; tasks: Workspace[];
  projects: Array<{ project_code: string; project_name: string }>;
  experience: ExperienceProjection; snapshot: ExperienceSnapshot; projection?: TaskProjection | undefined }>();
const emit = defineEmits<{ openTask: [id: string]; selectProject: [code: string]; refresh: []; logout: [] }>();
const view = ref("home");
const homeTab = ref("home");
const homeProject = ref("");
const conversationScope = ref("");
const accountDialog = ref<HTMLDialogElement>();
const providerIdentity = ref<EEAccountPresentation>();
const identityOpen = ref(false);
const accountRole = computed(() => "PC 用户");
const project = computed({ get: () => props.snapshot.selectedProject, set: code => openProject(code) });
const { request, snapshot: currentSnapshot } = useExperience(() => project.value);
let identityController: AbortController | undefined;
onBeforeUnmount(() => identityController?.abort());
const densityKey = `pc.density.${props.principal.tenant_id}.${props.principal.principal_id}`;
const compact = ref(localStorage.getItem(densityKey) === "compact");
watch(compact, value => localStorage.setItem(densityKey, value ? "compact" : "comfortable"));
const workspaceVisited = ref(false);
const query = ref("");
const busy = ref(false);
const failure = ref("");
const fetchedAt = ref("");
const facts = ref<Record<string, Row>>({});
const tools = computed(() => props.experience.tools);
const graph = ref(true);
const missingOnly = ref(false);
const detail = ref<{ title: string; code: string; kind: string; data: Row }>();
const detailBusy = ref(false);
const resourceRows = ref<Row[]>([]);
const navDefinitions = [
  { id: "home", label: "首页", icon: Home }, { id: "overview", label: "项目总览", icon: LayoutDashboard },
  { id: "engineering", label: "工程", icon: GitBranch }, { id: "conversation", label: "对话", icon: MessageSquare },
  { id: "workspace", label: "工作台", icon: FileText }, { id: "requirements", label: "需求", icon: List },
  { id: "resources", label: "资料", icon: FolderOpen }, { id: "artifacts", label: "成果", icon: FileText },
  { id: "tasks", label: "任务", icon: ShieldCheck }
];
const nav = computed(() => navDefinitions.filter(item => props.experience.visibleNavigationItems.includes(item.id)));
const labels: Record<string, string> = { new: "已录入", draft: "草稿", in_review: "评审中", active: "进行中",
  confirmed: "已确认", CREATED: "新建", INPUT_INCOMPLETE: "资料待补齐", READY: "可生成", CONVERSING: "对话中",
  GENERATING: "生成中", HUMAN_REVIEW: "待评审", ACCEPTED: "已接受", REJECTED: "已驳回", GENERATION_FAILED: "生成失败", ARCHIVED: "已归档" };
const projectTasks = computed(() => props.tasks.filter(task => task.project_code === project.value));
const selectedTask = computed(() => projectTasks.value.find(task => task.workspace_id === props.projection?.workspace.workspace_id) ?? projectTasks.value[0]);
const projectName = computed(() => props.projects.find(item => item.project_code === project.value)?.project_name ?? "");
const title = computed(() => nav.value.find(item => item.id === view.value)?.label ?? "首页");
const business = computed(() => adaptProjectView(facts.value, tools.value));
const requirements = computed(() => business.value.requirements);
const functions = computed(() => business.value.functions);
const specifications = computed(() => business.value.specifications);
const uncovered = computed(() => functions.value.filter(fun => !specifications.value.some(spec => spec.associated_functions.includes(fun.code))));
const filteredRequirements = computed(() => requirements.value.filter(matches));
const filteredFunctions = computed(() => functions.value.filter(item => matches(item) && (!missingOnly.value || uncovered.value.some(fun => fun.code === item.code))));
const filteredSpecs = computed(() => specifications.value.filter(matches));
const filteredTasks = computed(() => projectTasks.value.filter(matches));
const artifacts = computed(() => resourceRows.value.flatMap(projection => (projection.drafts ?? []).map((draft: Row) => ({ ...draft,
  task: projection.workspace.title, workspace_id: projection.workspace.workspace_id, state: projection.workspace.state }))));
const inputs = computed(() => resourceRows.value.flatMap(projection => (projection.inputs ?? []).map((input: Row) => ({ ...input, task: projection.workspace.title }))));
function matches(item: unknown) { return JSON.stringify(item).toLowerCase().includes(query.value.toLowerCase()); }
function label(state: string) { return labels[state] ?? state; }
function date(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

let generation = 0;
function clearProjectState() {
  identityController?.abort();
  generation++; facts.value = {}; fetchedAt.value = ""; resourceRows.value = []; detail.value = undefined;
  providerIdentity.value = undefined; identityOpen.value = false; query.value = ""; missingOnly.value = false; failure.value = "";
  busy.value = false; detailBusy.value = false; homeProject.value = ""; homeTab.value = "home"; conversationScope.value = "";
}
async function refresh() {
  const version = ++generation;
  const code = project.value;
  const task = selectedTask.value;
  if (!props.experience.showProjectSurface || !code) return;
  busy.value = true; failure.value = ""; detail.value = undefined; facts.value = {};
  try {
    if (task && props.experience.allowedProjectRequests.includes("project-data")) {
      const data = await request<{ fetched_at: string; results: Record<string, Row> }>(`/v1/workbench/tasks/${task.workspace_id}/project-data`, props.token);
      if (version !== generation) return;
      facts.value = data.results; fetchedAt.value = data.fetched_at;
    }
    if (["resources", "artifacts"].includes(view.value)) {
      const rows = await Promise.all(projectTasks.value.map(entry => request<TaskProjection>(`/v1/ssts-tasks/${entry.workspace_id}`, props.token)));
      if (version === generation) resourceRows.value = rows;
    }
  } catch (error) { if (version === generation) { facts.value = {}; resourceRows.value = []; failure.value = "当前项目资料不可用，请重新检查能力状态。"; } }
  finally { if (version === generation) busy.value = false; }
}
function navigate(id: string) {
  if (id === "capabilities" && props.experience.showProjectSurface) { homeTab.value = "capabilities"; homeProject.value = project.value; view.value = "home"; }
  else if (props.experience.visibleNavigationItems.includes(id)) {
    view.value = id; if (id === "home") { homeTab.value = "home"; homeProject.value = ""; }
  } else view.value = "home";
  query.value = ""; detail.value = undefined;
}
function openTask(id?: string, target = "workspace") {
  const task = props.tasks.find(task => task.workspace_id === id);
  workspaceVisited.value = true;
  if (task) emit("openTask", task.workspace_id);
  const mode = task && taskScene(task.profile_release_id) !== "ssts" ? "conversation"
    : target === "workspace" && !props.experience.showSstsExperience ? "conversation" : target;
  conversationScope.value = task?.project_code ?? "";
  navigate(mode);
}
let pendingProject = "";
function openProject(code: string) {
  if (!props.projects.some(item => item.project_code === code)) return;
  if (code === project.value && props.snapshot.catalog) { navigate("overview"); return; }
  pendingProject = code; emit("selectProject", code);
}
const projectView = computed(() => !["home", "workspace", "conversation"].includes(view.value));
async function inspect(kind: string, item: Row) {
  const version = generation;
  detail.value = { title: item.title ?? item.ssts_title, code: item.code ?? item.ssts_code, kind, data: item };
  if (kind !== "SSTS" || !selectedTask.value) return;
  const selectedDetail = detail.value;
  detailBusy.value = true;
  try {
    const tool = tools.value.find(entry => entry.tool_definition_id === sceneTools.specification);
    if (!tool) return;
    const result = await request<Row>(`/v1/workbench/tasks/${selectedTask.value.workspace_id}/tools`, props.token, {
      method: "POST", body: JSON.stringify({ tool_release_id: tool.tool_release_id, arguments: { ssts_code: item.ssts_code }, call_id: crypto.randomUUID() }) });
    if (version === generation && detail.value === selectedDetail && !result.isError) detail.value.data = unwrap(result.structuredContent);
  } finally { if (version === generation) detailBusy.value = false; }
}
async function identityDiagnostics(event: Event) {
  identityController?.abort();
  identityOpen.value = (event.target as HTMLDetailsElement).open;
  if (!identityOpen.value || !props.experience.showProviderIdentityDetails) { providerIdentity.value = undefined; return; }
  const version = generation;
  identityController = new AbortController();
  try {
    const epoch = currentSnapshot.value.generation;
    const result = await api.accountPresentation(identityController.signal);
    if (epoch === currentSnapshot.value.generation && version === generation && identityOpen.value && props.experience.showProviderIdentityDetails) providerIdentity.value = result;
  } catch { if (version === generation) providerIdentity.value = undefined; }
}
watch(() => props.snapshot.generation, () => {
  clearProjectState();
  if (!(view.value === "conversation" && props.projection && !props.projection.workspace.project_code)) view.value = "home";
}, { flush: "sync" });
watch(() => props.snapshot.phase, phase => {
  if (phase === "ready" && pendingProject === project.value && props.experience.showProjectSurface) { pendingProject = ""; view.value = "overview"; }
  else if (phase !== "ready" && phase !== "loading") pendingProject = "";
}, { flush: "post" });
watch(() => props.projection?.workspace.workspace_id, () => {
  if (view.value === "conversation") conversationScope.value = props.projection?.workspace.project_code ?? "";
});
watch(() => props.experience.visibleNavigationItems.join("|"), () => {
  if (!props.experience.visibleNavigationItems.includes(view.value)) view.value = "home";
}, { flush: "sync" });
watch([project, projectView, view], () => { if (projectView.value && props.experience.showProjectSurface) void refresh(); });
watch(() => props.tasks.map(task => `${task.workspace_id}:${task.version}`).join("|"), () => { if (projectView.value) void refresh(); });
</script>

<template>
  <div class="desktop-workbench" :class="{ compact }">
    <nav class="nav-rail" aria-label="主导航">
      <div class="rail-brand" title="Process Copilot"><Blocks :size="23" /></div>
      <button v-for="item in nav" :key="item.id" :class="{ active: view === item.id }" :title="item.label"
        :aria-current="view === item.id ? 'page' : undefined" @click="item.id === 'conversation' ? openTask(undefined, 'conversation') : item.id === 'workspace' ? openTask(selectedTask?.workspace_id) : navigate(item.id)">
        <component :is="item.icon" :size="21" /><span>{{ item.label }}</span>
      </button>
      <div class="rail-bottom"><button class="avatar" title="账号与设置" @click="accountDialog?.showModal()"><UserRound :size="20" /></button><button title="退出登录" @click="emit('logout')"><LogOut :size="19" /></button></div>
    </nav>
    <div class="desktop-body">
      <header class="desktop-topbar">
        <strong>Process Copilot</strong><span class="header-divider" />
        <span v-if="view === 'home'" class="home-scope">个人范围 · 我的跨项目记录</span>
        <span v-else-if="view === 'conversation' && !conversationScope" class="current-scope">个人范围</span>
        <label v-else class="current-scope"><span>{{ project ? '项目范围' : '个人范围' }}</span><select v-model="project" aria-label="当前项目"><option v-for="item in projects" :key="item.project_code" :value="item.project_code">{{ item.project_code }} · {{ item.project_name }}</option></select></label>
        <ChevronRight :size="15" class="muted" /><span class="breadcrumb">{{ title }}</span>
        <div class="topbar-end"><button class="icon-button refresh-experience" title="刷新能力状态" @click="emit('refresh')"><RefreshCw :size="17" /></button><span class="demo-indicator">个人工作台</span><button v-if="projectView && experience.showProjectSurface" class="icon-button" title="重新检查能力状态" :disabled="busy" @click="emit('refresh')"><RefreshCw :size="17" :class="{ spin: busy }" /></button><button class="account-summary" title="账号与设置" aria-label="账号与设置" @click="accountDialog?.showModal()"><UserRound :size="17" /><span><strong>{{ accountName }}</strong><small data-test="account-role">{{ accountRole }}</small></span></button></div>
      </header>
      <slot name="provider-status" :project="view === 'home' ? '' : view === 'conversation' ? conversationScope : project" />
      <div v-if="failure && projectView" class="workbench-alert" role="alert"><CircleAlert :size="18" /><span>{{ failure }}</span><button class="icon-button" title="重试" @click="refresh"><RefreshCw :size="16" /></button></div>
      <div v-if="busy && projectView" class="project-loading" role="status"><RefreshCw :size="14" class="spin" />读取项目资料</div>

      <PersonalHome :initial-tab="homeTab" :initial-project="homeProject" v-if="view === 'home'" :token="token" :principal="principal" :account-name="accountName" :tasks="tasks" :projects="projects" :snapshot="snapshot" :experience="experience" :key="snapshot.generation" @open-task="openTask" @open-project="openProject" @refresh="emit('refresh')" />

      <div v-if="workspaceVisited && (view === 'conversation' || view === 'workspace' && experience.showSstsExperience)" class="task-workspace" :class="{ 'conversation-workspace': view === 'conversation' }"><slot :mode="view" :project="view === 'conversation' ? conversationScope : project" /></div>
      <section v-if="projectView && experience.showProjectSurface && !project" class="project-scope-empty"><FolderOpen :size="26" /><h1>选择项目</h1><p>{{ projects.length ? '项目资料' : '个人对话与我的记录' }}</p><button v-if="!projects.length" class="secondary-button" @click="navigate('home')"><Home :size="16" />我的首页</button></section>
      <main v-if="projectView && project && experience.showProjectSurface" class="desktop-content" :class="{ 'with-summary': view === 'overview' }">
        <section class="content-main">
          <template v-if="view === 'overview'">
            <div class="page-eyebrow">{{ project }} / 项目工作区</div>
            <div class="page-heading"><div><h1>工作总览</h1><p>{{ projectName }}</p></div><span class="source-tag"><Activity :size="13" /> {{ busy ? '读取中' : failure ? '读取失败' : fetchedAt ? '已更新' : '尚未读取' }}</span></div>
            <div class="overview-command"><Sparkles :size="23" /><div><h2>继续当前项目工作</h2><p>{{ selectedTask?.title ?? '当前项目尚无任务' }}</p></div><button class="icon-button primary" title="继续对话" @click="openTask(selectedTask?.workspace_id, 'conversation')"><MessageSquare :size="20" /></button></div>
            <div class="quick-workflows">
              <button v-if="experience.showRequirements" @click="navigate('requirements')"><List :size="21" /><strong>需求与范围</strong><span>{{ requirements.length }} 条项目需求</span><ChevronRight :size="15" /></button>
              <button v-if="experience.showEngineeringExperience" @click="navigate('engineering')"><GitBranch :size="21" /><strong>工程追溯</strong><span>{{ functions.length }} 项功能关系</span><ChevronRight :size="15" /></button>
              <button v-if="experience.showSstsExperience" @click="openTask(selectedTask?.workspace_id)"><FileText :size="21" /><strong>SSTS 草稿</strong><span>{{ projectTasks.length }} 个工作任务</span><ChevronRight :size="15" /></button>
              <button @click="navigate('capabilities')"><Wrench :size="21" /><strong>可用能力</strong><span>{{ tools.length }} 个授权工具</span><ChevronRight :size="15" /></button>
            </div>
            <div class="section-title"><h2>我的任务</h2><button v-if="experience.visibleNavigationItems.includes('tasks')" class="text-link" @click="navigate('tasks')">全部任务 <ArrowRight :size="14" /></button></div>
            <button v-for="task in projectTasks" :key="task.workspace_id" class="overview-task" @click="openTask(task.workspace_id)"><span class="task-kind"><FileText :size="18" /></span><div><strong>{{ task.title }}</strong><small>{{ task.function_code }} · {{ date(task.updated_at) }}</small></div><span class="pill" :class="task.state.toLowerCase()">{{ label(task.state) }}</span><ChevronRight :size="16" /></button>
            <p v-if="!projectTasks.length && !busy" class="empty-state">当前账号在此项目中没有任务</p>
            <div class="section-title"><h2>项目活动</h2><span class="muted">{{ fetchedAt ? date(fetchedAt) : '尚未读取' }}</span></div>
            <div v-if="business.sourceLabel" class="activity-line"><span class="activity-dot" /><div><strong>工程资料同步</strong><p><span v-if="experience.showRequirements">需求 {{ requirements.length }} </span><span v-if="experience.showEngineeringExperience">功能 {{ functions.length }} </span><span v-if="experience.showSstsExperience && specifications.length">技术规范 {{ specifications.length }}</span></p></div><span class="source-tag">{{ business.sourceLabel }}</span></div>
          </template>

          <template v-else>
            <div class="page-eyebrow">{{ project }} / {{ projectName }}</div>
            <div class="page-heading"><div><h1>{{ view === 'engineering' ? '工程关系' : view === 'requirements' ? '项目需求' : view === 'resources' ? '输入资料' : view === 'artifacts' ? '工作成果' : '项目任务' }}</h1><p>{{ projectName }}</p></div><div v-if="view === 'engineering'" class="segmented"><button :class="{ selected: graph }" title="关系视图" @click="graph = true"><GitBranch :size="17" /></button><button :class="{ selected: !graph }" title="列表视图" @click="graph = false"><List :size="17" /></button></div></div>
            <div class="data-toolbar"><label class="search-field"><Search :size="16" /><input v-model="query" aria-label="搜索当前视图" placeholder="搜索名称、编码或内容" /></label><label v-if="view === 'engineering' && experience.showSstsExperience" class="check-filter"><input v-model="missingOnly" type="checkbox" />仅缺少规范</label><span class="toolbar-source">{{ view === 'tasks' || view === 'resources' || view === 'artifacts' ? 'PC 工作区' : business.sourceLabel }}</span></div>

            <template v-if="view === 'engineering'">
              <div class="engineering-stats"><div v-if="experience.showRequirements"><span>需求</span><strong>{{ requirements.length }}</strong></div><div><span>功能</span><strong>{{ functions.length }}</strong></div><div v-if="experience.showSstsExperience && specifications.length"><span>技术规范</span><strong>{{ specifications.length }}</strong></div><div v-if="experience.showSstsExperience && specifications.length" class="attention-stat"><span>未关联规范的功能</span><strong>{{ uncovered.length }}</strong></div></div>
              <div v-if="graph" class="relationship-map" :class="{ 'without-specifications': !experience.showSstsExperience || !specifications.length, 'without-requirements': !experience.showRequirements }"><div class="map-head"><span v-if="experience.showRequirements">需求输入</span><span>功能分解</span><span v-if="experience.showSstsExperience && specifications.length">技术规范</span></div>
                <div v-for="fun in filteredFunctions" :key="fun.code" class="relation-row">
                  <button v-if="experience.showRequirements" class="relation-node requirement-node" @click="inspect('需求', requirements.find(r => r.code === fun.source_requirement_code) ?? { code: fun.source_requirement_code, title: '来源待核实' })"><small>{{ fun.source_requirement_code || '未关联来源' }}</small><strong>{{ requirements.find(r => r.code === fun.source_requirement_code)?.title ?? '来源待核实' }}</strong><span>需求</span></button>
                  <ArrowRight v-if="experience.showRequirements" class="relation-arrow" :size="18" />
                  <button class="relation-node function-node" @click="inspect('功能', fun)"><small>{{ fun.code }}</small><strong>{{ fun.title }}</strong><span>{{ label(fun.status) }}</span></button>
                  <ArrowRight v-if="experience.showSstsExperience && specifications.length" class="relation-arrow" :size="18" />
                  <div v-if="experience.showSstsExperience && specifications.length" class="spec-nodes"><button v-for="spec in specifications.filter(s => (s.associated_functions ?? []).includes(fun.code))" :key="spec.ssts_code" class="relation-node spec-node" @click="inspect('SSTS', spec)"><small>{{ spec.ssts_code }}</small><strong>{{ spec.ssts_title }}</strong><span>{{ label(spec.status) }}</span></button><div v-if="!specifications.some(s => (s.associated_functions ?? []).includes(fun.code))" class="missing-node"><CircleAlert :size="16" />尚未关联技术规范</div></div>
                </div>
              </div>
              <table v-else class="data-table"><thead><tr><th>功能编码</th><th>功能名称</th><th>来源需求</th><th v-if="experience.showSstsExperience && specifications.length">规范</th><th>状态</th></tr></thead><tbody><tr v-for="fun in filteredFunctions" :key="fun.code" @click="inspect('功能', fun)"><td class="code-cell">{{ fun.code }}</td><td>{{ fun.title }}</td><td>{{ fun.source_requirement_code || '未关联' }}</td><td v-if="experience.showSstsExperience && specifications.length">{{ specifications.filter(s => (s.associated_functions ?? []).includes(fun.code)).length }}</td><td><span class="pill">{{ label(fun.status) }}</span></td></tr></tbody></table>
            </template>

            <table v-if="view === 'requirements'" class="data-table"><thead><tr><th>需求编码</th><th>需求名称</th><th>优先级</th><th>状态</th><th>更新时间</th></tr></thead><tbody><tr v-for="item in filteredRequirements" :key="item.code" tabindex="0" @click="inspect('需求', item)" @keydown.enter="inspect('需求', item)"><td class="code-cell">{{ item.code }}</td><td><strong>{{ item.title }}</strong><small class="cell-summary">{{ item.content }}</small></td><td><span class="priority-dot" :class="item.priority" />{{ item.priority === 'high' ? '高' : item.priority === 'low' ? '低' : '中' }}</td><td><span class="pill">{{ label(item.status) }}</span></td><td>{{ date(new Date(item.updated_at * 1000).toISOString()) }}</td></tr></tbody></table>


            <table v-if="view === 'tasks'" class="data-table"><thead><tr><th>任务</th><th>功能范围</th><th>状态</th><th>更新时间</th><th /></tr></thead><tbody><tr v-for="task in filteredTasks" :key="task.workspace_id" tabindex="0" @click="openTask(task.workspace_id)" @keydown.enter="openTask(task.workspace_id)"><td><strong>{{ task.title }}</strong></td><td class="code-cell">{{ task.function_code }}</td><td><span class="pill" :class="task.state.toLowerCase()">{{ label(task.state) }}</span></td><td>{{ date(task.updated_at) }}</td><td><ChevronRight :size="16" /></td></tr></tbody></table>

            <template v-if="view === 'resources'">
              <table class="data-table"><thead><tr><th>资料名称</th><th>类型</th><th>所属任务</th><th>版本</th></tr></thead><tbody><tr v-for="item in inputs.filter(matches)" :key="item.input_id" @click="inspect('输入资料', item)"><td><FileText :size="16" /> {{ item.resource_ref.display_name }}</td><td>{{ item.slot }}</td><td>{{ item.task }}</td><td>{{ item.revision }}</td></tr></tbody></table>
              <div v-if="!inputs.length && !busy" class="empty-state"><FolderOpen :size="30" /><p>当前项目尚无输入资料</p><button @click="openTask(selectedTask?.workspace_id)">进入工作台</button></div>
            </template>
            <template v-if="view === 'artifacts'">
              <template v-if="specifications.length && experience.showSstsExperience"><h2 class="table-section-label">{{ business.sourceLabel }} 技术规范</h2><table class="data-table"><thead><tr><th>编码</th><th>技术规范</th><th>状态</th><th>关联功能</th></tr></thead><tbody><tr v-for="item in filteredSpecs" :key="item.ssts_code" @click="inspect('SSTS', item)"><td class="code-cell">{{ item.ssts_code }}</td><td>{{ item.ssts_title }}</td><td><span class="pill" :class="item.status">{{ label(item.status) }}</span></td><td>{{ (item.associated_functions ?? []).join('、') }}</td></tr></tbody></table></template>
              <h2 class="table-section-label">PC 生成草稿</h2><div v-if="!artifacts.length" class="empty-state">尚无生成草稿</div><button v-for="item in artifacts.filter(matches)" :key="item.draft_id" class="overview-task" @click="openTask(item.workspace_id)"><FileText :size="20" /><div><strong>{{ item.task }}</strong><small>修订 {{ item.revision }} · {{ date(item.created_at) }}</small></div><span class="pill">{{ label(item.state) }}</span><ChevronRight :size="16" /></button>
            </template>
            <p v-if="!busy && !failure && ((view === 'requirements' && !filteredRequirements.length) || (view === 'engineering' && !filteredFunctions.length) || (view === 'tasks' && !filteredTasks.length))" class="empty-state">没有匹配的记录</p>
          </template>
        </section>

        <aside v-if="view === 'overview'" class="project-summary">

          <span class="page-eyebrow">{{ project }}</span><h2>{{ projectName }}</h2>
          <div class="summary-metrics"><div v-if="experience.showRequirements"><strong>{{ requirements.length }}</strong><span>需求</span></div><div v-if="experience.showEngineeringExperience"><strong>{{ functions.length }}</strong><span>功能</span></div><div v-if="experience.showSstsExperience && specifications.length"><strong>{{ specifications.length }}</strong><span>技术规范</span></div><div><strong>{{ projectTasks.length }}</strong><span>我的任务</span></div></div>
          <h3>需要关注</h3><button v-if="experience.showEngineeringExperience && experience.showSstsExperience" class="attention-item" @click="navigate('engineering'); missingOnly = true"><CircleAlert :size="17" /><div><strong>{{ uncovered.length }} 项功能缺少规范关联</strong><small>工程追溯</small></div><ChevronRight :size="14" /></button>
          <button v-if="specifications.length && experience.showSstsExperience" class="attention-item" @click="navigate('artifacts')"><ShieldCheck :size="17" /><div><strong>{{ specifications.filter(s => s.status === 'in_review').length }} 份规范处于评审中</strong><small>{{ business.sourceLabel }} 技术规范</small></div><ChevronRight :size="14" /></button>
          <div class="summary-footer"><Check :size="14" /><span>{{ fetchedAt ? `更新于 ${date(fetchedAt)}` : busy ? '正在读取' : '尚未读取' }}</span></div>
        </aside>
      </main>
      <aside v-if="detail" class="detail-drawer" aria-label="记录详情"><header><div><small>{{ detail.kind }}</small><h2>{{ detail.title }}</h2><code>{{ detail.code }}</code></div><button class="icon-button" title="关闭详情" @click="detail = undefined"><X :size="20" /></button></header><div class="detail-content"><p v-if="detailBusy">正在读取规范快照</p><template v-else><p v-if="detail.data.content || detail.data.description" class="detail-prose">{{ detail.data.content || detail.data.description }}</p><div v-if="detail.data.document" class="spec-detail"><span class="pill">{{ label(detail.data.document.status) }}</span><article v-for="section in detail.data.sections" :key="section.section_number"><h3>{{ section.section_number }} {{ section.section_title }}</h3><p>{{ section.content }}</p></article></div><template v-if="detail.kind === 'MCP 工具'"><p>{{ detail.data.compatibility.description }}</p><dl><dt>操作</dt><dd>{{ detail.data.risk_manifest.action_class }}</dd><dt>审批策略</dt><dd>{{ detail.data.approval_policy }}</dd><dt>恢复策略</dt><dd>{{ detail.data.recovery_class }}</dd></dl><h3>参数</h3><pre>{{ JSON.stringify(detail.data.input_schema, null, 2) }}</pre></template><details><summary>记录与来源</summary><pre>{{ JSON.stringify(detail.data, null, 2) }}</pre></details><button class="drawer-action" @click="openTask(selectedTask?.workspace_id)"><MessageSquare :size="16" />进入任务工作台</button></template></div></aside>
    </div>
    <dialog ref="accountDialog" class="account-dialog" aria-labelledby="account-heading" @click="(event) => { if (event.target === accountDialog) accountDialog?.close(); }">
      <header><UserRound :size="21" /><h2 id="account-heading">账号与设置</h2><button class="icon-button" title="关闭账号设置" @click="accountDialog?.close()"><X :size="19" /></button></header>
      <dl><dt>当前账号</dt><dd>{{ accountName || '我的账号' }}</dd><dt>平台身份</dt><dd>{{ accountRole }}</dd><dt>PC 身份</dt><dd><code>{{ principal.principal_id }}</code></dd></dl>
      <details v-if="experience.showProviderIdentityDetails" class="account-identifiers" @toggle="identityDiagnostics"><summary>身份提供方诊断</summary>
        <dl v-if="identityOpen && providerIdentity"><dt>身份提供方登录名</dt><dd>{{ providerIdentity.account.username }}</dd><dt>身份提供方账号 ID</dt><dd>{{ providerIdentity.account.id }}</dd><dt>来源角色</dt><dd>{{ roleLabel(providerIdentity) }}</dd></dl>
      </details>
      <h3>显示密度</h3><div class="density-options" role="group" aria-label="显示密度"><button :aria-pressed="!compact" @click="compact = false">舒适</button><button :aria-pressed="compact" @click="compact = true">紧凑</button></div>
      <footer><button class="secondary-button" @click="emit('logout')"><LogOut :size="16" />退出登录</button></footer>
    </dialog>
  </div>
</template>
