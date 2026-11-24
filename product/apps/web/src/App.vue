<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, provide, ref, shallowRef, watch } from "vue";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Database,
  Download,
  FileCheck2,
  FileText,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X
} from "lucide-vue-next";
import { api, ApiClientError, request } from "./api";
import { emptyExperience, experiencePolicy, visibleTasks } from "./experience-policy";
import { ExperienceSession } from "./experience-session";
import { experienceKey } from "./experience-context";
import { invalidatesExternalExperience } from "./authorization-presentation";
import { providerState, taskScene } from "./provider-view-adapter";
import ExecutionWorkbench from "./ExecutionWorkbench.vue";
import WorkbenchShell from "./WorkbenchShell.vue";
import AuthorityStatus from "./AuthorityStatus.vue";
import { setAuthorizationPresentationGeneration } from "./authorization-presentation";
import type {
  DraftRevision,
  InputSlot,
  Principal,
  SystemCapabilities,
  TaskInput,
  TaskProjection,
  Workspace,
  WorkspaceState
} from "./types";

const TOKEN_KEY = "pc.minimum-test.token";
const TASK_KEY = "pc.minimum-test.task";
const ACCOUNT_KEY = "pc.minimum-test.account";
const accountName = ref("");

const slotDefinitions: Array<{ slot: InputSlot; label: string; required: boolean }> = [
  { slot: "PRD", label: "PRD", required: true },
  { slot: "ARCHITECTURE", label: "架构说明", required: true },
  { slot: "COMMUNICATION_MATRIX", label: "通信矩阵", required: false }
];

const token = ref(sessionStorage.getItem(TOKEN_KEY) ?? "");
const principal = ref<Principal>();
const rawTasks = ref<Workspace[]>([]);
const snapshot = shallowRef(emptyExperience());
watch(() => snapshot.value.generation, setAuthorizationPresentationGeneration, { immediate: true, flush: "sync" });
const experience = computed(() => experiencePolicy(snapshot.value));
const tasks = computed(() => visibleTasks(rawTasks.value, snapshot.value));
const projects = computed(() => experience.value.showProjectSurface ? snapshot.value.projects : []);
const session = new ExperienceSession((path, accessToken, signal) => request(path, accessToken, { signal }),
  value => { snapshot.value = value; });
function invalidateExternal(caught?: unknown) {
  session.invalidate(caught instanceof ApiClientError && caught.status === 403 ? "denied" : "unavailable",
    caught instanceof ApiClientError ? caught.code : undefined);
}
provide(experienceKey, { snapshot, signal: () => session.signal, fail: invalidateExternal });
const projectCode = ref("");
const functionCode = ref("");
const taskMode = ref("READ");
const projection = ref<TaskProjection>();
const draftContent = ref("");
const draftFilename = ref("");
const busy = ref("");
const error = ref<{ title: string; message: string; retryable: boolean }>();
const notice = ref("");
const system = ref<SystemCapabilities>();

const accountKey = ref("");
const secret = ref("");
const taskTitle = ref("新的工作任务");
const conversationTitle = ref("新对话");
const conversationProject = ref("");
const conversationWorkspace = computed(() => workspace.value ? taskScene(workspace.value.profile_release_id) !== "ssts" : true);
const messageText = ref("请重点检查恢复边界、输入版本和人工评审约束。");
const reviewComment = ref("请补充异常恢复和验证要求。");

const authenticated = computed(() =>
  token.value !== "" && principal.value !== undefined
);
const workspace = computed(() => {
  const value = projection.value?.workspace;
  return value && tasks.value.some(task => task.workspace_id === value.workspace_id) ? value : undefined;
});
const inputs = computed(() => projection.value?.inputs ?? []);
const messages = computed(() => projection.value?.messages ?? []);
const drafts = computed(() => projection.value?.drafts ?? []);
const currentDraft = computed<DraftRevision | undefined>(() => {
  const id = workspace.value?.current_draft_id;
  if (id === undefined) return drafts.value.at(-1);
  return drafts.value.find((draft) => draft.draft_id === id);
});
const requiredReady = computed(() =>
  ["PRD", "ARCHITECTURE"].every((slot) =>
    inputs.value.some((input) => input.slot === slot)
  )
);
const canGenerate = computed(() => {
  const state = workspace.value?.state;
  return requiredReady.value
    && state !== undefined
    && !["GENERATING", "HUMAN_REVIEW", "ACCEPTED", "ARCHIVED"].includes(state);
});

function stateLabel(state: WorkspaceState): string {
  return {
    CREATED: "新建",
    INPUT_INCOMPLETE: "资料不完整",
    READY: "可生成",
    CONVERSING: "对话中",
    GENERATING: "生成中",
    HUMAN_REVIEW: "待评审",
    ACCEPTED: "已接受",
    REJECTED: "已驳回",
    GENERATION_FAILED: "生成失败",
    ARCHIVED: "已归档"
  }[state];
}

function stateTone(state: WorkspaceState): string {
  if (state === "ACCEPTED") return "positive";
  if (state === "HUMAN_REVIEW" || state === "READY") return "attention";
  if (state === "REJECTED" || state === "GENERATION_FAILED") return "negative";
  return "neutral";
}

function inputFor(slot: InputSlot): TaskInput | undefined {
  return inputs.value.find((input) => input.slot === slot);
}

function shortId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function showError(caught: unknown, fallback: string): void {
  if (caught instanceof ApiClientError) {
    if (caught.status === 401) {
      clearSession();
      error.value = {
        title: "会话已失效",
        message: "请重新登录。",
        retryable: false
      };
      return;
    }
    if (experience.value.showProjectSurface && invalidatesExternalExperience(caught)) invalidateExternal(caught);
    error.value = {
      title: /PROVIDER|AUTHORITY|AUTHORIZATION|POLICY|GATEWAY/u.test(caught.code) ? "权限或能力暂不可用" : caught.code,
      message: caught.code.includes("PROVIDER") || caught.code.includes("WORKBENCH") ? "当前能力或项目范围不可用，请刷新能力状态。" : caught.message,
      retryable: caught.retryable
    };
    return;
  }
  error.value = {
    title: "操作失败",
    message: caught instanceof Error ? caught.message : fallback,
    retryable: true
  };
}

async function run<T>(
  name: string,
  operation: () => Promise<T>
): Promise<T | undefined> {
  busy.value = name;
  error.value = undefined;
  notice.value = "";
  try {
    return await operation();
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") return undefined;
    showError(caught, "请稍后重试。");
    return undefined;
  } finally {
    busy.value = "";
  }
}

async function signIn(): Promise<void> {
  const result = await run("login", async () => {
    const submittedAccount = accountKey.value;
    let signedIn;
    try {
      signedIn = await api.signIn(
        accountKey.value,
        secret.value,
        system.value?.provider_mode ?? "ee-connected"
      );
    }
    finally { secret.value = ""; }
    token.value = signedIn.access_token;
    sessionStorage.setItem(TOKEN_KEY, signedIn.access_token);
    principal.value = await api.me(signedIn.access_token);
    accountName.value = submittedAccount || "我的账号";
    sessionStorage.setItem(ACCOUNT_KEY, accountName.value);
    await loadTasks();
    const remembered = sessionStorage.getItem(TASK_KEY);
    const target = tasks.value.find((task) => task.workspace_id === remembered)
      ?? tasks.value[0];
    if (target !== undefined && !target.project_code) await selectTask(target.workspace_id);
  });
  if (result !== undefined) notice.value = "已进入本地验收环境";
}

function clearSession(): void {
  token.value = "";
  principal.value = undefined;
  session.invalidate("unconfigured");
  rawTasks.value = [];
  projection.value = undefined;
  draftContent.value = "";
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TASK_KEY);
  sessionStorage.removeItem(ACCOUNT_KEY);
  accountName.value = "";
}

async function logout(): Promise<void> {
  await run("logout", async () => {
    await api.signOut(
      token.value,
      system.value?.provider_mode ?? "ee-connected"
    );
    clearSession();
  });
}

async function restoreSession(): Promise<void> {
  await run("restore", async () => {
    if (!token.value) {
      if (system.value?.provider_mode === "standalone" || !system.value || providerState(system.value) !== "READY") return;
      try {
        const signedIn = await api.signIn(undefined, undefined, "ee-connected");
        token.value = signedIn.access_token;
        sessionStorage.setItem(TOKEN_KEY, signedIn.access_token);
      } catch (caught) { if (caught instanceof ApiClientError && caught.status === 401) return; throw caught; }
    }
    principal.value = await api.me(token.value);
    accountName.value = "我的账号";
    await loadTasks();
    const remembered = sessionStorage.getItem(TASK_KEY);
    const target = tasks.value.find(task => !task.project_code && task.workspace_id === remembered);
    if (target) await selectTask(target.workspace_id);
  });
}

async function loadTasks(selected = snapshot.value.selectedProject): Promise<void> {
  if (!token.value || !principal.value) return;
  await session.refresh(token.value, principal.value, selected);
  system.value = snapshot.value.health ?? system.value;
  await refreshTaskList();
}

async function refreshTaskList(): Promise<void> {
  const generation = snapshot.value.generation;
  try {
    const rows = await api.listTasks(token.value, !experience.value.showProjectSurface, session.signal);
    if (!session.isCurrent(generation)) return;
    rawTasks.value = rows;
    projectCode.value = snapshot.value.selectedProject;
  } catch (caught) {
    if (session.isCurrent(generation)) { invalidateExternal(caught); showError(caught, "读取任务失败"); }
  }
}

async function selectProject(code: string): Promise<void> {
  if (!projects.value.some(project => project.project_code === code)) return;
  await loadTasks(code);
}
async function createTask(): Promise<void> {
  if (!experience.value.showSstsExperience || taskTitle.value.trim() === "") return;
  await run("create-task", async () => {
    const created = await api.createTask(token.value, taskTitle.value.trim(), projectCode.value, functionCode.value.trim(), taskMode.value);
    await refreshTaskList();
    await selectTask(created.workspace_id);
    notice.value = "任务已创建";
  });
}

async function createConversation(): Promise<void> {
  if (conversationProject.value && !projects.value.some(project => project.project_code === conversationProject.value)) return;
  await run("create-conversation", async () => {
    const created = await api.createTask(token.value, conversationTitle.value.trim() || "新对话", conversationProject.value, "", "CHAT");
    await refreshTaskList();
    await selectTask(created.workspace_id);
    conversationTitle.value = "新对话";
  });
}

let taskSelection = 0;
async function selectTask(workspaceId: string): Promise<void> {
  const selection = ++taskSelection;
  await run("load-task", async () => {
    const expected = tasks.value.find(task => task.workspace_id === workspaceId);
    if (!expected) return;
    const generation = snapshot.value.generation;
    const value = await api.getTask(token.value, workspaceId, session.signal);
    if (!session.isCurrent(generation) || selection !== taskSelection || value.workspace.workspace_id !== expected.workspace_id
      || value.workspace.project_code !== expected.project_code || value.workspace.owner_principal_id !== principal.value?.principal_id
      || value.workspace.tenant_id !== principal.value?.tenant_id) return;
    projection.value = value;
    projectCode.value = value.workspace.project_code ?? "";
    sessionStorage.setItem(TASK_KEY, workspaceId);
    await loadDraftContent();
  });
}

async function refreshTask(): Promise<void> {
  try {
    const id = workspace.value?.workspace_id;
    await refreshTaskList();
    if (id && tasks.value.some(task => task.workspace_id === id)) await selectTask(id);
  } catch (caught) { showError(caught, "刷新任务失败"); }
}

async function loadDraftContent(): Promise<void> {
  draftContent.value = "";
  draftFilename.value = "";
  if (workspace.value === undefined || currentDraft.value === undefined) return;
  const generation = snapshot.value.generation;
  const id = workspace.value.workspace_id;
  const draftId = currentDraft.value.draft_id;
  const result = await api.draftContent(
    token.value,
    workspace.value.workspace_id,
    currentDraft.value.draft_id
  );
  if (!session.isCurrent(generation) || !experience.value.showSstsExperience || workspace.value?.workspace_id !== id || currentDraft.value?.draft_id !== draftId) return;
  draftContent.value = result.content;
  draftFilename.value = result.filename;
}

async function uploadInput(slot: InputSlot, file: File): Promise<void> {
  if (principal.value === undefined || workspace.value === undefined) return;
  const id = workspace.value.workspace_id;
  const generation = snapshot.value.generation;
  await run(`upload-${slot}`, async () => {
    const uploaded = await api.upload(
      token.value,
      principal.value as Principal,
      file
    );
    if (!session.isCurrent(generation) || workspace.value?.workspace_id !== id) return;
    await api.attachInput(
      token.value,
      id,
      slot,
      uploaded
    );
    await refreshTask();
    notice.value = `${slotDefinitions.find((item) => item.slot === slot)?.label} 已绑定`;
  });
}

async function fileSelected(slot: InputSlot, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file !== undefined) await uploadInput(slot, file);
  input.value = "";
}

async function checkInputs(): Promise<void> {
  if (workspace.value === undefined) return;
  await run("check-inputs", async () => {
    const result = await api.checkInputs(
      token.value,
      workspace.value?.workspace_id ?? ""
    );
    await refreshTask();
    notice.value = result.complete
      ? "必需资料已齐套"
      : `缺少：${result.missing_slots.join("、")}`;
  });
}

async function sendMessage(): Promise<void> {
  if (workspace.value === undefined || messageText.value.trim() === "") return;
  await run("message", async () => {
    await api.appendMessage(
      token.value,
      workspace.value?.workspace_id ?? "",
      messageText.value.trim()
    );
    messageText.value = "";
    await refreshTask();
  });
}

async function generateDraft(): Promise<void> {
  if (workspace.value === undefined || !canGenerate.value) return;
  await run("generate", async () => {
    await api.generateDraft(token.value, workspace.value?.workspace_id ?? "");
    await refreshTask();
    notice.value = "Draft 已生成，等待人工评审";
  });
}

async function review(decision: "ACCEPTED" | "REJECTED"): Promise<void> {
  if (workspace.value === undefined || currentDraft.value === undefined) return;
  await run(`review-${decision}`, async () => {
    await api.reviewDraft(
      token.value,
      workspace.value?.workspace_id ?? "",
      currentDraft.value?.draft_id ?? "",
      decision,
      decision === "REJECTED" ? reviewComment.value : undefined
    );
    await refreshTask();
    notice.value = decision === "ACCEPTED" ? "Draft 已接受" : "Draft 已驳回";
  });
}

async function download(): Promise<void> {
  if (workspace.value === undefined || currentDraft.value === undefined) return;
  await run("download", async () => {
    await api.downloadDraft(
      token.value,
      workspace.value?.workspace_id ?? "",
      currentDraft.value?.draft_id ?? ""
    );
    notice.value = `${draftFilename.value || "SSTS Draft"} 已下载`;
  });
}

async function initialize(): Promise<void> {
  try {
    system.value = await api.capabilities();
    await restoreSession();
  } catch (caught) {
    showError(caught, "无法读取系统能力状态");
  }
}

async function retryProvider(): Promise<void> {
  await run("retry-provider", async () => {
    await request("/v1/providers/eeclaw/retry", token.value, { method: "POST" });
    await loadTasks();
    notice.value = "企业项目能力已重新检查";
  });
}

let expiryTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => snapshot.value.generation, () => {
  rawTasks.value = rawTasks.value.filter(task => !task.project_code);
  if (projection.value?.workspace.project_code) projection.value = undefined;
  draftContent.value = ""; draftFilename.value = ""; functionCode.value = "";
  projectCode.value = ""; conversationProject.value = ""; error.value = undefined; notice.value = "";
  sessionStorage.removeItem(TASK_KEY);
  history.replaceState(null, "", location.pathname);
}, { flush: "sync" });
watch(snapshot, value => {
  clearTimeout(expiryTimer);
  if (value.phase === "ready") expiryTimer = setTimeout(() => session.invalidate("expired"), Math.max(0, value.expiresAt - Date.now()));
});
const refreshExperience = () => { if (token.value && principal.value) void loadTasks(); };
onMounted(() => {
  void initialize();
  window.addEventListener("focus", refreshExperience);
  window.addEventListener("popstate", refreshExperience);
});
onBeforeUnmount(() => {
  clearTimeout(expiryTimer);
  session.invalidate();
  window.removeEventListener("focus", refreshExperience);
  window.removeEventListener("popstate", refreshExperience);
});
</script>

<template>
  <main v-if="!authenticated" class="login-shell">
    <section class="login-panel">
      <div class="brand-lockup">
        <span class="brand-mark">PC</span>
        <div>
          <p>Process Copilot</p>
          <h1>Process Copilot</h1>
        </div>
      </div>


      <form class="login-form" @submit.prevent="signIn">
        <label>
          账号
          <input v-model="accountKey" autocomplete="username" required />
        </label>
        <label>
          密码
          <input
            v-model="secret"
            type="password"
            autocomplete="current-password"
            required
          />
        </label>
        <button data-test="login" type="submit" :disabled="busy !== ''">
          <RefreshCw v-if="busy === 'login'" :size="17" class="spin" />
          <ShieldCheck v-else :size="17" />
          登录
        </button>
      </form>

      <div v-if="error" class="inline-error" role="alert">
        <CircleAlert :size="18" />
        <div>
          <strong>{{ error.title }}</strong>
          <span>{{ error.message }}</span>
        </div>
      </div>
    </section>
  </main>

  <WorkbenchShell v-else-if="principal" :token="token" :principal="principal" :tasks="tasks" :projects="projects"
    :snapshot="snapshot" :experience="experience"
    :account-name="accountName" :projection="projection" @open-task="selectTask" @select-project="selectProject" @refresh="refreshExperience" @logout="logout">
    <template #provider-status="{ project: scopeProject }">
    <AuthorityStatus :token="token" :account-name="accountName" :project="scopeProject" :generation="snapshot.generation"
      :experience="experience" :source-state="system ? providerState(system) : 'UNCONFIGURED'" @session-invalid="clearSession" />
    <div v-if="experience.showProviderStatus"
      class="global-error provider-unavailable" role="status">
      <CircleAlert :size="18" />
      <div>
        <strong>企业项目能力暂不可用</strong>
        <span>请重新检查当前能力状态。</span>
      </div>
      <button class="secondary-button" type="button" :disabled="busy !== ''" @click="retryProvider">重试</button>
    </div>
    <div v-if="error" class="global-error" role="alert">
      <CircleAlert :size="18" />
      <div>
        <strong>{{ error.title }}</strong>
        <span>{{ error.message }}</span>
      </div>
      <button
        class="icon-button"
        type="button"
        title="关闭"
        @click="error = undefined"
      >
        <X :size="17" />
      </button>
    </div>
    <div v-if="notice" class="global-notice">
      <Check :size="17" />
      <span>{{ notice }}</span>
      <button
        class="icon-button"
        type="button"
        title="关闭"
        @click="notice = ''"
      >
        <X :size="16" />
      </button>
    </div>
    </template>
    <template #default="{ mode, project: activeProject }">
    <form v-if="mode === 'conversation'" class="conversation-launcher" @submit.prevent="createConversation">
      <label><span>新对话名称</span><input v-model="conversationTitle" aria-label="对话名称" maxlength="200" /></label>
      <label><span>新对话范围</span><select v-model="conversationProject" aria-label="对话范围"><option value="">个人范围</option><option v-for="project in projects" :key="project.project_code" :value="project.project_code">项目 · {{ project.project_code }} · {{ project.project_name }}</option></select></label>
      <button data-test="new-conversation" type="submit" :disabled="busy !== ''"><Plus :size="17" />新建对话</button>
    </form>
    <section class="product-layout" :class="{ 'personal-chat-layout': conversationWorkspace }">
      <aside class="task-sidebar">
        <div class="section-heading">
          <div>
            <span>{{ mode === 'conversation' ? '对话' : '任务' }}</span>
            <strong>{{ tasks.length }}</strong>
          </div>
        </div>
        <div v-if="mode !== 'conversation' && experience.showSstsExperience" class="project-fields">
          <label>项目<select v-model="projectCode" aria-label="项目" @change="selectProject(projectCode)"><option v-for="project in projects" :key="project.project_code" :value="project.project_code">{{ project.project_code }} · {{ project.project_name }}</option></select></label>
          <label>Function<input v-model="functionCode" aria-label="Function 编码" /></label>
          <label>任务类型<select v-model="taskMode"><option value="READ">SSTS 草稿</option><option value="REVIEW">SSTS 草稿与受控评审</option></select></label>
        </div>
        <form v-if="mode !== 'conversation' && experience.showSstsExperience" class="new-task" @submit.prevent="createTask">
          <input v-model="taskTitle" aria-label="新任务标题" />
          <button
            data-test="create-task"
            class="icon-button primary"
            type="submit"
            title="新建任务"
          >
            <Plus :size="18" />
          </button>
        </form>
        <div class="task-list">
          <button
            v-for="task in tasks.filter(item => (item.project_code ?? '') === activeProject)"
            :key="task.workspace_id"
            type="button"
            class="task-item"
            :class="{ active: task.workspace_id === workspace?.workspace_id }"
            @click="selectTask(task.workspace_id)"
          >
            <span class="task-title">{{ task.title }}</span>
            <span class="task-meta">
              <span class="status-dot" :class="stateTone(task.state)" />
              {{ stateLabel(task.state) }}
              <span>{{ dateTime(task.updated_at) }}</span>
            </span>
            <ChevronRight :size="17" />
          </button>
        </div>
      </aside>

      <section v-if="workspace && (workspace.project_code ?? '') === activeProject" class="workbench">
        <header class="workspace-header">
          <div>
            <div class="workspace-title-row">
              <h1 :title="workspace.title">{{ workspace.title }}</h1>
              <span
                data-test="workspace-state"
                class="status-badge"
                :class="stateTone(workspace.state)"
              >
                {{ stateLabel(workspace.state) }}
              </span>
            </div>
            <p class="workspace-scope" data-test="workspace-scope">{{ workspace.project_code ? `项目范围 · ${workspace.project_code} · ${workspace.function_code || '项目对话'}` : '个人范围 · 个人对话' }}</p>
          </div>
          <div class="authority-badge">
            <Database :size="16" />
            PostgreSQL Authority
          </div>
        </header>
        <ExecutionWorkbench :key="workspace.workspace_id" :experience="experience" :token="token" :project="workspace.project_code ?? ''" :workspace-id="workspace.workspace_id" :conversation-mode="mode === 'conversation' || conversationWorkspace" @changed="refreshTask" />

        <section v-if="!conversationWorkspace && experience.showSstsExperience" class="conversation-band">
          <div class="band-heading">
            <div>
              <MessageSquare :size="18" />
              <h2>任务消息</h2>
            </div>
            <span>{{ messages.length }}</span>
          </div>
          <div v-if="messages.length > 0" class="message-list">
            <article
              v-for="message in messages"
              :key="message.message_id"
              class="message"
            >
              <div class="message-meta">
                <strong>{{ message.role === "USER" ? "你" : message.role }}</strong>
                <span>#{{ message.sequence }} · {{ dateTime(message.created_at) }}</span>
              </div>
              <p>{{ message.content }}</p>
            </article>
          </div>
          <div v-else class="empty-line">尚无消息</div>
          <form class="message-composer" @submit.prevent="sendMessage">
            <textarea
              v-model="messageText"
              rows="3"
              placeholder="补充本次任务的关注点"
              :disabled="workspace.state === 'ACCEPTED'"
            />
            <button
              data-test="send-message"
              class="icon-button primary"
              type="submit"
              title="发送消息"
              :disabled="workspace.state === 'ACCEPTED' || busy !== ''"
            >
              <Send :size="18" />
            </button>
          </form>
        </section>

        <section v-if="!conversationWorkspace && experience.showSstsExperience" class="draft-band">
          <div class="band-heading">
            <div>
              <FileCheck2 :size="18" />
              <h2>SSTS Draft</h2>
            </div>
            <span v-if="currentDraft" data-test="draft-revision">
              Revision {{ currentDraft.revision }}
            </span>
          </div>

          <div v-if="currentDraft" class="draft-body">
            <div class="draft-toolbar">
              <span
                class="validation-badge"
                :class="currentDraft.validation.status === 'PASSED'
                  ? 'positive'
                  : 'negative'"
              >
                {{ currentDraft.validation.status }}
              </span>
              <span>{{ shortId(currentDraft.content_digest) }}</span>
              <button
                data-test="download-draft"
                type="button"
                class="secondary-button"
                @click="download"
              >
                <Download :size="16" />
                下载
              </button>
            </div>
            <pre class="draft-content">{{ draftContent }}</pre>
            <div
              v-if="workspace.state === 'HUMAN_REVIEW'"
              class="review-bar"
            >
              <input v-model="reviewComment" aria-label="驳回意见" />
              <button
                data-test="reject-draft"
                type="button"
                class="secondary-button danger"
                :disabled="busy !== ''"
                @click="review('REJECTED')"
              >
                <X :size="16" />
                驳回
              </button>
              <button
                data-test="accept-draft"
                type="button"
                :disabled="busy !== ''"
                @click="review('ACCEPTED')"
              >
                <Check :size="16" />
                接受 Draft
              </button>
            </div>
          </div>
          <div v-else class="draft-empty">
            <FileText :size="28" />
            <span>尚未生成 Draft</span>
          </div>
        </section>
      </section>

      <aside v-if="workspace && !conversationWorkspace && experience.showSstsExperience" class="evidence-sidebar">
        <section class="evidence-section">
          <div class="band-heading">
            <div>
              <FileText :size="18" />
              <h2>输入资料</h2>
            </div>
            <span>{{ inputs.length }}/3</span>
          </div>
          <div class="input-list">
            <article
              v-for="definition in slotDefinitions"
              :key="definition.slot"
              class="input-row"
              :data-slot="definition.slot"
            >
              <div class="input-name">
                <strong>{{ definition.label }}</strong>
                <span>{{ definition.required ? "必需" : "可选" }}</span>
              </div>
              <template v-if="inputFor(definition.slot)">
                <div class="file-name">
                  <FileCheck2 :size="16" />
                  <span>
                    {{ inputFor(definition.slot)?.resource_ref.display_name }}
                  </span>
                </div>
                <code>
                  {{
                    shortId(
                      inputFor(definition.slot)?.resource_ref
                        .resource_version_id ?? ""
                    )
                  }}
                </code>
              </template>
              <div class="input-actions">
                <label class="secondary-button file-picker">
                  <Upload :size="15" />
                  上传
                  <input
                    type="file"
                    accept=".md,.txt,.json,text/markdown,text/plain,application/json"
                    @change="fileSelected(definition.slot, $event)"
                  />
                </label>
              </div>
            </article>
          </div>
          <button
            data-test="check-inputs"
            type="button"
            class="wide-button secondary-button"
            @click="checkInputs"
          >
            <ShieldCheck :size="16" />
            检查输入齐套
          </button>
        </section>

        <section class="evidence-section">
          <div class="band-heading">
            <div>
              <Sparkles :size="18" />
              <h2>生成</h2>
            </div>
          </div>
          <button
            data-test="generate-draft"
            type="button"
            class="wide-button"
            :disabled="!canGenerate || busy !== ''"
            @click="generateDraft"
          >
            <RefreshCw
              v-if="busy === 'generate'"
              :size="17"
              class="spin"
            />
            <Sparkles v-else :size="17" />
            {{
              workspace.state === "REJECTED"
                ? "重新生成 Draft"
                : "生成 Draft"
            }}
          </button>
        </section>

        <section v-if="currentDraft" class="evidence-section">
          <div class="band-heading">
            <div>
              <ShieldCheck :size="18" />
              <h2>校验</h2>
            </div>
            <span>{{ currentDraft.validation.checks.length }}</span>
          </div>
          <div class="check-list">
            <div
              v-for="check in currentDraft.validation.checks"
              :key="check.code"
              class="check-row"
            >
              <Check
                v-if="check.status === 'PASS'"
                :size="16"
                class="pass-icon"
              />
              <CircleAlert v-else :size="16" class="warn-icon" />
              <div>
                <strong>{{ check.code }}</strong>
                <span>{{ check.message }}</span>
              </div>
            </div>
          </div>
        </section>

        <section v-if="currentDraft" class="evidence-section">
          <div class="band-heading">
            <div>
              <FileText :size="18" />
              <h2>引用</h2>
            </div>
            <span>{{ currentDraft.citations.length }}</span>
          </div>
          <div class="citation-list">
            <article
              v-for="citation in currentDraft.citations"
              :key="citation.citation_id"
            >
              <strong>{{ citation.slot }}</strong>
              <span>{{ citation.resource_ref.display_name }}</span>
              <code>
                {{ shortId(citation.resource_ref.resource_version_id) }}
              </code>
            </article>
          </div>
        </section>
      </aside>

      <section v-if="!workspace || (workspace.project_code ?? '') !== activeProject" class="no-task">
        <ExecutionWorkbench :token="token" :project="activeProject" :experience="experience" :conversation-mode="true" />
      </section>
    </section>
    </template>
  </WorkbenchShell>
</template>
