<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ArrowRight, Check, ChevronRight, CircleAlert, FileText, FolderOpen, MessageSquare, RefreshCw, Search, ShieldCheck, X } from "lucide-vue-next";
import { request } from "./api";
import PersonalCapabilities from "./PersonalCapabilities.vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Principal, TaskProjection, Workspace } from "./types";
import { loadHomeRecords } from "./home-records";
import { scopeLabel } from "./account-presentation";

interface Approval {
  approval_id: string; approval_version: number; status: string; requested_by: string; requested_at: string;
  expires_at: string; arguments?: Record<string, unknown>; resource_scope_refs?: string[];
  command_context?: { workspace_id: string };
}
interface Execution {
  events: Array<{ event_type: string; occurred_at: string; payload?: { text?: string[] } }>;
}
const props = defineProps<{ token: string; principal: Principal; accountName: string; tasks: Workspace[];
  projects: Array<{ project_code: string; project_name: string }>; initialTab?: string; initialProject?: string }>();
const emit = defineEmits<{ openTask: [id: string, target: string]; openProject: [code: string]; refresh: [] }>();
const tasks = ref<Workspace[]>([]);
const projections = ref<TaskProjection[]>([]);
const conversations = ref<Array<{ task: Workspace; preview: string; updatedAt: string }>>([]);
const approvals = ref<Approval[]>([]);
const busy = ref(false);
const failure = ref("");
const warnings = ref<string[]>([]);
const updatedAt = ref("");
const selectedProject = ref(props.initialProject ?? "");
const query = ref("");
const tab = ref(props.initialTab ?? "home");
watch(() => [props.initialTab, props.initialProject], () => {
  tab.value = props.initialTab ?? "home"; selectedProject.value = props.initialProject ?? ""; query.value = "";
});
const taskFilter = ref("active");
const detail = ref<Approval>();
const deciding = ref(false);
const decisionError = ref("");
const tabs = [{ id: "home", label: "总览" }, { id: "tasks", label: "我的任务" },
  { id: "conversations", label: "最近对话" }, { id: "approvals", label: "审批" }, { id: "artifacts", label: "最近成果" }, { id: "capabilities", label: "我的能力" }];
const labels: Record<string, string> = { CREATED: "新建", INPUT_INCOMPLETE: "资料待补齐", READY: "可生成", CONVERSING: "对话中",
  GENERATING: "生成中", HUMAN_REVIEW: "待评审", ACCEPTED: "已接受", REJECTED: "已驳回", GENERATION_FAILED: "生成失败", ARCHIVED: "已归档",
  PENDING: "待审批", APPROVED: "已批准", CONSUMED: "已执行", EXPIRED: "已过期", REVOKED: "已撤销" };
function label(value: string) { return labels[value] ?? value; }
function date(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function preview(markdown: string) {
  const html = DOMPurify.sanitize(marked.parse(markdown, { async: false, gfm: true }));
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,tr,br").forEach((node) => node.append(" "));
  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}
function active(task: Workspace) { return !["ACCEPTED", "ARCHIVED"].includes(task.state); }
function matches(project: string | undefined, value: unknown) {
  return (!selectedProject.value || project === selectedProject.value)
    && JSON.stringify(value).toLowerCase().includes(query.value.trim().toLowerCase());
}
function approvalProject(item: Approval) { return item.resource_scope_refs?.find((scope) => scope.startsWith("project:"))?.slice(8); }
function expired(item: Approval) { return Date.parse(item.expires_at) <= Date.now(); }
function canDecide(item: Approval) { return item.status === "PENDING" && !expired(item) && item.requested_by !== props.principal.principal_id; }
const filteredTasks = computed(() => tasks.value.filter((task) => matches(task.project_code, task)));
const ongoing = computed(() => filteredTasks.value.filter(active));
const taskRows = computed(() => taskFilter.value === "active" ? ongoing.value : filteredTasks.value);
const chats = computed(() => conversations.value.filter((item) => matches(item.task.project_code, item)));
const approvalRows = computed(() => approvals.value.filter((item) => matches(approvalProject(item), item)));
const pending = computed(() => approvalRows.value.filter(canDecide));
const awaiting = computed(() => approvalRows.value.filter((item) => item.status === "PENDING" && !expired(item) && item.requested_by === props.principal.principal_id));
const artifacts = computed(() => projections.value.flatMap((projection) => projection.drafts.map((draft) => ({ draft, task: projection.workspace })))
  .filter((item) => matches(item.task.project_code, item)).sort((a, b) => b.draft.created_at.localeCompare(a.draft.created_at)));
const projects = computed(() => props.projects.filter((item) => matches(item.project_code, item)));
const resume = computed(() => chats.value[0]);
const greeting = computed(() => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date()));
let generation = 0;
let refreshController: AbortController | undefined;
onBeforeUnmount(() => { generation++; refreshController?.abort(); });
async function refresh() {
  refreshController?.abort();
  refreshController = new AbortController();
  const { signal } = refreshController;
  const token = props.token;
  const version = ++generation;
  busy.value = true; failure.value = ""; warnings.value = [];
  try {
    const [owned, visible] = await Promise.allSettled([
      request<{ tasks: Workspace[] }>("/v1/ssts-tasks", token, { signal }),
      request<{ items: Approval[] }>("/v1/workbench/approvals", token, { signal })]);
    if (version !== generation) return;
    if (owned.status === "rejected") throw owned.reason;
    tasks.value = [...owned.value.tasks].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    approvals.value = visible.status === "fulfilled" ? visible.value.items.sort((a, b) => b.requested_at.localeCompare(a.requested_at)) : [];
    if (visible.status === "rejected") warnings.value.push("审批暂时无法读取");
    const rows = await loadHomeRecords(tasks.value, signal, async (task, activeSignal) => ({ task,
      results: await Promise.allSettled([
        request<TaskProjection>(`/v1/ssts-tasks/${task.workspace_id}`, token, { signal: activeSignal }),
        request<Execution>(`/v1/workbench/tasks/${task.workspace_id}/execution`, token, { signal: activeSignal })]) }));
    if (version !== generation) return;
    const restored: typeof conversations.value = [];
    const loaded: TaskProjection[] = [];
    for (const { task, results: [projection, execution] } of rows) {
      if (projection.status === "fulfilled") loaded.push(projection.value);
      else warnings.value.push(`${task.title}：成果暂时无法读取`);
      if (execution.status === "fulfilled") {
        const last = execution.value.events.filter((event) => event.event_type === "dsh.assistant/message").at(-1);
        if (last) restored.push({ task, preview: preview(last.payload?.text?.join(" ") ?? ""), updatedAt: last.occurred_at });
      } else warnings.value.push(`${task.title}：对话暂时无法读取`);
    }
    projections.value = loaded;
    conversations.value = restored.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    updatedAt.value = new Date().toISOString();
  } catch (error) { if (version === generation) failure.value = error instanceof Error ? error.message : String(error); }
  finally { if (version === generation) busy.value = false; }
}
function refreshAll() { emit("refresh"); void refresh(); }
function openApproval(item: Approval) { detail.value = item; decisionError.value = ""; }
async function decide(decision: "APPROVE" | "REJECT") {
  const item = detail.value;
  if (!item || !canDecide(item)) return;
  deciding.value = true; decisionError.value = "";
  try {
    await request(`/v1/workbench/approvals/${item.approval_id}/decision`, props.token, {
      method: "POST", body: JSON.stringify({ expected_version: item.approval_version, decision }) });
    await refresh(); detail.value = approvals.value.find((entry) => entry.approval_id === item.approval_id);
  } catch (error) { decisionError.value = error instanceof Error ? error.message : String(error); }
  finally { deciding.value = false; }
}
watch(() => [props.token, props.tasks.map((task) => `${task.workspace_id}:${task.version}`).join("|")], () => { void refresh(); }, { immediate: true });
</script>

<template>
  <main class="personal-home" :aria-busy="busy">
    <header class="personal-heading"><div><span class="page-eyebrow">{{ greeting }}</span><h1>我的首页</h1><p>{{ principal.ee_account?.display_name || accountName }} · 个人范围</p></div><button class="icon-button" title="刷新我的首页" :disabled="busy" @click="refreshAll"><RefreshCw :size="18" :class="{ spin: busy }" /></button></header>
    <div v-if="failure" class="home-error" role="alert"><CircleAlert :size="17" /><span>{{ failure }}</span><button class="icon-button" title="重试首页" @click="refreshAll"><RefreshCw :size="16" /></button></div>
    <p v-if="busy && !updatedAt" class="home-loading" role="status">正在读取个人工作记录</p>
    <div v-if="warnings.length" class="home-warning" role="alert"><p v-for="item in warnings" :key="item">{{ item }}</p></div>
    <div class="personal-metrics">
      <button @click="tab = 'home'"><FolderOpen :size="18" /><span>我的项目</span><strong>{{ projects.length }}</strong></button>
      <button @click="tab = 'tasks'; taskFilter = 'active'"><FileText :size="18" /><span>进行中任务</span><strong>{{ ongoing.length }}</strong></button>
      <button @click="tab = 'conversations'"><MessageSquare :size="18" /><span>最近对话</span><strong>{{ chats.length }}</strong></button>
      <button @click="tab = 'approvals'"><ShieldCheck :size="18" /><span>待我审批</span><strong>{{ pending.length }}</strong></button>
      <button @click="tab = 'artifacts'"><Check :size="18" /><span>生成成果</span><strong>{{ artifacts.length }}</strong></button>
    </div>
    <div class="home-viewbar"><nav class="home-tabs" aria-label="个人首页视图"><button v-for="item in tabs" :key="item.id" :aria-current="tab === item.id ? 'page' : undefined" @click="tab = item.id">{{ item.label }}</button></nav><label class="home-project-filter"><select v-model="selectedProject" aria-label="筛选首页项目"><option value="">全部范围</option><option v-for="item in props.projects" :key="item.project_code" :value="item.project_code">{{ item.project_code }} · {{ item.project_name }}</option></select></label></div>
    <div class="home-searchbar"><label class="search-field"><Search :size="16" /><input v-model="query" aria-label="搜索个人工作" placeholder="搜索项目、任务或成果" /></label><span v-if="updatedAt" class="muted">更新于 {{ date(updatedAt) }}</span></div>
    <div class="home-columns" :class="{ 'single-column': tab !== 'home' }">
      <div class="home-main">
        <PersonalCapabilities v-if="tab === 'capabilities'" :token="token" :projects="props.projects" :tasks="tasks" :project="selectedProject" :query="query" />
        <section v-if="tab === 'home' && resume" class="home-resume"><MessageSquare :size="24" /><div><small>继续上次对话 · {{ scopeLabel(resume.task.project_code) }}</small><h2>{{ resume.task.title }}</h2><p>{{ resume.preview }}</p></div><button class="icon-button primary" title="继续最近对话" @click="emit('openTask', resume.task.workspace_id, 'conversation')"><ArrowRight :size="19" /></button></section>
        <section v-if="tab === 'home' || tab === 'tasks'" class="home-section" aria-label="我的任务">
          <div class="section-title"><h2>我的任务 <small>{{ filteredTasks.length }}</small></h2><select v-if="tab === 'tasks'" v-model="taskFilter" aria-label="任务状态筛选"><option value="active">进行中</option><option value="all">全部状态</option></select><button v-else class="text-link" @click="tab = 'tasks'">全部 <ArrowRight :size="14" /></button></div>
          <button v-for="task in (tab === 'home' ? ongoing.slice(0, 5) : taskRows)" :key="task.workspace_id" class="home-row home-task-row" :data-workspace="task.workspace_id" @click="emit('openTask', task.workspace_id, 'workspace')"><FileText :size="19" /><div><strong>{{ task.title }}</strong><small>{{ scopeLabel(task.project_code) }}{{ task.function_code ? ` · ${task.function_code}` : '' }} · {{ date(task.updated_at) }}</small></div><span class="pill" :class="task.state.toLowerCase()">{{ label(task.state) }}</span><ChevronRight :size="15" /></button>
          <p v-if="!busy && !(tab === 'home' ? ongoing : taskRows).length" class="home-empty">{{ tab === 'tasks' && taskFilter === 'all' ? '暂无匹配任务' : '暂无进行中的任务' }}</p>
        </section>
        <section v-if="tab === 'home' || tab === 'conversations'" class="home-section" aria-label="最近对话">
          <div class="section-title"><h2>最近对话 <small>{{ chats.length }}</small></h2><button v-if="tab === 'home'" class="text-link" @click="tab = 'conversations'">全部 <ArrowRight :size="14" /></button></div>
          <button v-for="item in (tab === 'home' ? chats.slice(0, 4) : chats)" :key="item.task.workspace_id" class="home-row home-chat-row" @click="emit('openTask', item.task.workspace_id, 'conversation')"><MessageSquare :size="19" /><div><strong>{{ item.task.title }}</strong><p>{{ item.preview }}</p><small>{{ scopeLabel(item.task.project_code) }} · {{ date(item.updatedAt) }}</small></div><ChevronRight :size="15" /></button>
          <p v-if="!busy && !chats.length" class="home-empty">暂无已保存的对话</p>
        </section>
        <section v-if="tab === 'home' || tab === 'artifacts'" class="home-section" aria-label="最近成果">
          <div class="section-title"><h2>最近成果 <small>{{ artifacts.length }}</small></h2><button v-if="tab === 'home'" class="text-link" @click="tab = 'artifacts'">全部 <ArrowRight :size="14" /></button></div>
          <button v-for="item in (tab === 'home' ? artifacts.slice(0, 4) : artifacts)" :key="item.draft.draft_id" class="home-row home-artifact-row" @click="emit('openTask', item.task.workspace_id, 'workspace')"><FileText :size="19" /><div><strong>{{ item.task.title }}</strong><small>{{ item.task.project_code }} · 修订 {{ item.draft.revision }} · {{ date(item.draft.created_at) }}</small></div><span class="pill">{{ item.draft.validation.status === 'PASSED' ? '校验通过' : '校验失败' }}</span><ChevronRight :size="15" /></button>
          <p v-if="!busy && !artifacts.length" class="home-empty">暂无生成成果</p>
        </section>
        <section v-if="tab === 'approvals'" class="home-section" aria-label="我的审批">
          <div class="section-title"><h2>待我审批 <small>{{ pending.length }}</small></h2></div>
          <button v-for="item in pending" :key="item.approval_id" class="home-row home-approval-row" @click="openApproval(item)"><ShieldCheck :size="19" /><div><strong>{{ item.arguments?.ssts_code || '受控请求' }}</strong><small>{{ approvalProject(item) }} · {{ date(item.requested_at) }}</small></div><span class="pill controlled">待审批</span><ChevronRight :size="15" /></button>
          <p v-if="!busy && !pending.length" class="home-empty">暂无待我审批的请求</p>
          <div class="section-title"><h2>审批记录 <small>{{ approvalRows.length }}</small></h2></div>
          <button v-for="item in approvalRows" :key="item.approval_id" class="home-row home-approval-row" @click="openApproval(item)"><ShieldCheck :size="19" /><div><strong>{{ item.arguments?.ssts_code || '受控请求' }}</strong><small>{{ approvalProject(item) }} · {{ item.requested_by === principal.principal_id ? '我提交的' : '授权审批' }} · {{ date(item.requested_at) }}</small></div><span class="pill">{{ item.status === 'PENDING' && expired(item) ? '已过期' : label(item.status) }}</span><ChevronRight :size="15" /></button>
          <p v-if="!busy && !approvalRows.length" class="home-empty">暂无审批记录</p>
        </section>
      </div>
      <aside v-if="tab === 'home'" class="home-aside">
        <section class="home-section"><div class="section-title"><h2>我的项目 <small>{{ projects.length }}</small></h2></div><button v-for="item in projects" :key="item.project_code" class="home-project" :data-project="item.project_code" @click="emit('openProject', item.project_code)"><img src="/assets/project-car.jpg" alt="" /><div><small>{{ item.project_code }}</small><strong>{{ item.project_name }}</strong><span>{{ tasks.filter(task => task.project_code === item.project_code).length }} 个我的任务</span></div><ChevronRight :size="15" /></button><p v-if="!busy && !projects.length" class="home-empty">暂无匹配项目</p></section>
        <section class="home-section home-attention"><div class="section-title"><h2>需要关注</h2></div><button class="home-row" @click="tab = 'approvals'"><ShieldCheck :size="18" /><div><strong>{{ pending.length }} 项待我审批</strong><small>{{ awaiting.length }} 项等待他人审批</small></div><ChevronRight :size="14" /></button><button v-for="task in ongoing.filter(item => ['INPUT_INCOMPLETE', 'HUMAN_REVIEW', 'GENERATION_FAILED'].includes(item.state))" :key="task.workspace_id" class="home-row" @click="emit('openTask', task.workspace_id, 'workspace')"><CircleAlert :size="18" /><div><strong>{{ task.title }}</strong><small>{{ label(task.state) }} · {{ task.project_code }}</small></div><ChevronRight :size="14" /></button></section>
      </aside>
    </div>
    <aside v-if="detail" class="detail-drawer" aria-label="审批详情"><header><div><small>{{ approvalProject(detail) }} · 受控评审</small><h2>{{ detail.arguments?.ssts_code || '审批请求' }}</h2><code>{{ detail.approval_id }}</code></div><button class="icon-button" title="关闭审批详情" :disabled="deciding" @click="detail = undefined"><X :size="19" /></button></header><div class="detail-content"><span class="pill">{{ label(detail.status) }}</span><h3>提交参数</h3><pre>{{ JSON.stringify(detail.arguments, null, 2) }}</pre><p>有效期至 {{ date(detail.expires_at) }}</p><p v-if="detail.requested_by === principal.principal_id && detail.status === 'PENDING'">等待其他审批人处理</p><p v-if="decisionError" class="home-error" role="alert">{{ decisionError }}</p><div v-if="canDecide(detail)" class="approval-actions"><button :disabled="deciding" @click="decide('APPROVE')"><Check :size="16" />批准</button><button class="secondary-button danger" :disabled="deciding" @click="decide('REJECT')"><X :size="16" />拒绝</button></div><button v-if="tasks.some(task => task.workspace_id === detail?.command_context?.workspace_id)" class="drawer-action" @click="emit('openTask', detail.command_context!.workspace_id, 'workspace')"><ArrowRight :size="16" />进入任务工作台</button></div></aside>
  </main>
</template>
