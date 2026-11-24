<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Check, ExternalLink, FileSearch, MessageSquare, Play, RefreshCw, Send, ShieldCheck, Square, Wrench, X } from "lucide-vue-next";
import { useExperience } from "./experience-context";
import type { ExperienceProjection } from "./experience-policy";
import { sourceLinks, sourceCommand, type Row } from "./provider-view-adapter";
import SchemaField from "./SchemaField.vue";
import MarkdownMessage from "./MarkdownMessage.vue";
import { authorizationSources } from "./authorization-presentation";
interface Tool { tool_release_id: string; tool_definition_id: string; schema_digest: string;
  compatibility?: { display_name?: string; domain?: string };
  input_schema: { type: string; properties: Record<string, { type?: string }>; required?: string[] };
  risk_manifest: { action_class: string } }
interface Approval { approval_id: string; approval_version: number; status: string; requested_by: string;
  operation_id: string; tool_release_id: string; arguments?: Record<string, unknown>; resource_scope_refs?: string[];
  command_context?: { workspace_id: string; call_id: string } }
interface Execution { session?: { assignment: { runtime_id: string; runtime_epoch: number; assignment_generation: number; lease_expires_at: string; effective_profile_snapshot_id: string } };
  tool_release_ids: string[];
  runtime_available: boolean;
  events: Array<{ event_id: string; event_type: string; durability: string; occurred_at: string }>;
  ledger: Array<{ operation: { operation_id: string; state: string; approval_id?: string };
    audit?: Array<{ authority_decision?: { decision_id: string; pc_session_id: string; decision_mode: string;
      provider_mapping_release_id?: string; provider_decision_ref?: string } }>;
    external?: { tool_release_id: string; outcome_state: string; result?: { result: Record<string, unknown>; external_evidence_refs: string[] } } }> }
interface ChatMessage { message_id: string; role: "user" | "assistant"; content: string; sequence: number; occurred_at: string }
const props = defineProps<{ token: string; project: string; workspaceId?: string; conversationMode?: boolean; experience: ExperienceProjection }>();
function authority(item: Execution["ledger"][number]) { return item.audit?.filter(row => row.authority_decision).at(-1)?.authority_decision; }
const { request } = useExperience(() => props.project);
const emit = defineEmits<{ changed: [] }>();
const tab = ref("run");
const tools = ref<Tool[]>([]);
const selected = ref<Tool>();
const args = ref<Record<string, unknown>>({});
const result = ref<unknown>();
const execution = ref<Execution>();
const approvals = ref<Approval[]>([]);
const error = ref("");
const busy = ref(false);
const prompt = ref("");
const ownerUri = ref("");
const ownerResult = ref<unknown>();
const chat = ref<ChatMessage[]>([]);
const chatLoading = ref(false);
const chatError = ref("");
const runningWorkspace = ref("");
const pendingPrompt = ref("");
const messagesElement = ref<HTMLElement>();
const running = computed(() => runningWorkspace.value === props.workspaceId);
const tabDefinitions = [{ key: "run", label: "对话", icon: MessageSquare }, { key: "tools", label: "工具", icon: Wrench },
  { key: "evidence", label: "证据与追溯", icon: FileSearch }, { key: "approvals", label: "审批", icon: ShieldCheck }];
const tabs = computed(() => tabDefinitions.filter(item => item.key !== "tools" || !!props.project && tools.value.length > 0)
  .filter(item => item.key !== "approvals" || !!props.project && props.experience.showApprovals));
const answer = computed(() => typeof (result.value as { content?: unknown })?.content === "string"
  ? (result.value as { content: string }).content : "");
async function post<T>(path: string, body: unknown): Promise<T> {
  return request(path, props.token, { method: "POST", body: JSON.stringify(body) });
}
async function perform(fn: () => Promise<void>) {
  busy.value = true; error.value = "";
  try { await fn(); } catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught); }
  finally { busy.value = false; }
}
let refreshGeneration = 0;
async function refresh() {
  const generation = ++refreshGeneration;
  const { project, workspaceId, token } = props;
  const [catalog, state, pending] = await Promise.all([
    Promise.resolve({ tools: project ? props.experience.tools as Tool[] : [] }),
    workspaceId ? request<Execution>(`/v1/workbench/tasks/${workspaceId}/execution`, token) : Promise.resolve(undefined),
    project && props.experience.showApprovals && tab.value === "approvals"
      ? request<{ items: Approval[] }>("/v1/workbench/approvals", token) : Promise.resolve({ items: [] })
  ]);
  if (generation !== refreshGeneration || workspaceId !== props.workspaceId || project !== props.project || token !== props.token) return;
  tools.value = state ? catalog.tools.filter(tool => state.tool_release_ids.includes(tool.tool_release_id)) : catalog.tools;
  if (selected.value && !tools.value.some(tool => tool.tool_release_id === selected.value?.tool_release_id)) selected.value = undefined;
  execution.value = state; approvals.value = pending.items.filter(item => item.resource_scope_refs?.includes(`project:${project}`)
    && tools.value.some(tool => tool.tool_release_id === item.tool_release_id));
}
function choose(tool: Tool) { selected.value = tool; args.value = {}; result.value = undefined; }
async function invoke() {
  if (!selected.value || !props.workspaceId) return;
  await perform(async () => {
    const command = { tool_release_id: selected.value!.tool_release_id, arguments: args.value, call_id: crypto.randomUUID() };
    const base = `/v1/workbench/tasks/${props.workspaceId}`;
    if (selected.value!.risk_manifest.action_class === "READ") result.value = await post(`${base}/tools`, command);
    else {
      const approval = await post<Approval>(`${base}/write-requests`, command);
      result.value = approval; tab.value = "approvals";
    }
    await refresh();
  });
}
async function decide(approval: Approval, decision: string) {
  await perform(async () => { await post(`/v1/workbench/approvals/${approval.approval_id}/decision`,
    { expected_version: approval.approval_version, decision }); await refresh(); });
}
async function execute(approval: Approval) {
  if (!props.workspaceId) return;
  await perform(async () => {
    result.value = await post(`/v1/workbench/tasks/${props.workspaceId}/approvals/${approval.approval_id}/execute`, {});
    await refresh(); tab.value = "evidence";
  });
}
async function turn() {
  if (!props.workspaceId || !prompt.value.trim() || runningWorkspace.value) return;
  const id = props.workspaceId;
  const text = prompt.value.trim();
  runningWorkspace.value = id; pendingPrompt.value = text; prompt.value = ""; error.value = "";
  await scrollMessages();
  try {
    const response = await post(`/v1/workbench/tasks/${id}/turns`, { prompt: text, request_id: crypto.randomUUID() });
    if (props.workspaceId === id) { result.value = response; await loadConversation(); await refresh(); emit("changed"); }
  } catch (caught) {
    if (props.workspaceId === id) {
      error.value = caught instanceof Error ? caught.message : String(caught);
      if (!prompt.value) prompt.value = text;
      await loadConversation();
    }
  } finally { runningWorkspace.value = ""; pendingPrompt.value = ""; await scrollMessages(); }
}
async function cancel() {
  if (!props.workspaceId) return;
  try { result.value = await post(`/v1/workbench/tasks/${props.workspaceId}/cancel`, {}); await refresh(); }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught); }
}
async function reconcile(operationId: string) {
  await perform(async () => { result.value = await post(`/v1/workbench/tasks/${props.workspaceId}/operations/${operationId}/reconcile`, {}); await refresh(); });
}
function ownerLinks(payload?: Record<string, unknown>) { return sourceLinks(props.project, payload, props.experience.tools); }
async function openOwner(uri: string) {
  if (!props.workspaceId || !props.experience.showProjectSurface) return;
  const command = sourceCommand(props.project, uri);
  const tool = command && tools.value.find(entry => entry.tool_definition_id === command.name);
  if (!tool || !command) return;
  await perform(async () => {
    ownerResult.value = await post<Row>(`/v1/workbench/tasks/${props.workspaceId}/tools`, {
      tool_release_id: tool.tool_release_id, arguments: command.arguments, call_id: crypto.randomUUID() });
    ownerUri.value = uri; history.replaceState(null, "", `#owner=${encodeURIComponent(uri)}`); await refresh();
  });
}
function closeOwner() { ownerUri.value = ""; history.replaceState(null, "", location.pathname); }
let chatGeneration = 0;
async function scrollMessages() {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (messagesElement.value) messagesElement.value.scrollTop = messagesElement.value.scrollHeight;
}
async function loadConversation() {
  const generation = ++chatGeneration;
  if (!props.workspaceId) return;
  chatLoading.value = true; chatError.value = "";
  try {
    const response = await request<{ messages: ChatMessage[] }>(`/v1/workbench/tasks/${props.workspaceId}/conversation`, props.token);
    if (generation === chatGeneration) { chat.value = response.messages; await scrollMessages(); }
  } catch (caught) {
    if (generation === chatGeneration) chatError.value = caught instanceof Error ? caught.message : String(caught);
  } finally { if (generation === chatGeneration) chatLoading.value = false; }
}
function messageTime(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
watch(() => props.conversationMode, (value) => { if (value) { tab.value = "run"; void scrollMessages(); } });
watch(() => [props.workspaceId, props.project, props.token], () => {
  ownerUri.value = "";
  execution.value = undefined;
  chat.value = []; result.value = undefined; prompt.value = ""; error.value = "";
  void loadConversation();
  void perform(refresh);
}, { immediate: true });
watch(tab, () => { if (tab.value === "approvals" && props.experience.showApprovals) void perform(refresh); });
onBeforeUnmount(() => { refreshGeneration++; chatGeneration++; });
</script>
<template>
  <section class="execution-workbench">
    <div class="execution-tabs" role="tablist">
      <button v-for="item in tabs" :key="item.key" type="button" role="tab" :aria-selected="tab === item.key" @click="tab = item.key">
        <component :is="item.icon" :size="16" />{{ item.label }}<span v-if="item.key === 'approvals'">{{ approvals.filter(a => a.status === 'PENDING').length }}</span>
      </button>
      <button class="icon-button" type="button" title="刷新执行状态" @click="perform(refresh)"><RefreshCw :size="16" /></button>
    </div>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <section v-if="ownerUri" class="owner-resource">
      <div class="section-heading"><h3>{{ ownerUri }}</h3><button class="icon-button" type="button" title="关闭 Owner 资源" @click="closeOwner"><X :size="16" /></button></div>
      <pre>{{ JSON.stringify(ownerResult, null, 2) }}</pre>
    </section>
    <div v-if="tab === 'tools'" class="tools-layout">
      <nav class="tool-roster" aria-label="当前工具">
        <button v-for="tool in tools" :key="tool.tool_release_id" type="button" :class="{ selected: selected?.tool_release_id === tool.tool_release_id }" @click="choose(tool)">
          <span>{{ tool.compatibility?.display_name || tool.tool_definition_id }}<code>{{ tool.tool_definition_id }}</code></span><small>{{ tool.risk_manifest.action_class === 'READ' ? '只读' : '审批' }}</small>
        </button>
        <p v-if="!tools.length" class="empty-line">暂无可用工具</p>
      </nav>
      <form v-if="selected" class="tool-form" @submit.prevent="invoke">
        <h3>{{ selected.compatibility?.display_name || selected.tool_definition_id }}</h3>
        <SchemaField v-model="args" :schema="selected.input_schema" name="" />
        <button type="submit" :disabled="busy || !workspaceId"><Play :size="16" />{{ selected.risk_manifest.action_class === 'READ' ? '执行' : '申请审批' }}</button>
      </form>
      <p v-else class="empty-line">未选择工具</p>
    </div>
    <div v-show="tab === 'run'" class="run-view">
      <details v-if="execution?.session" class="runtime-details"><summary>运行环境</summary><dl class="runtime-facts">
        <dt>Runtime</dt><dd>{{ execution.session.assignment.runtime_id }} · epoch {{ execution.session.assignment.runtime_epoch }}</dd>
        <dt>Assignment</dt><dd>generation {{ execution.session.assignment.assignment_generation }}</dd>
        <dt>Lease</dt><dd>{{ execution.session.assignment.lease_expires_at }}</dd>
        <dt>Profile</dt><dd>{{ execution.session.assignment.effective_profile_snapshot_id }}</dd>
      </dl></details>
      <div v-if="chatError" class="chat-error" role="alert"><span>{{ chatError }}</span><button class="icon-button" title="重试加载对话" @click="loadConversation"><RefreshCw :size="16" /></button></div>
      <div ref="messagesElement" class="chat-transcript" role="log" aria-label="对话记录" :aria-busy="chatLoading || running">
        <p v-if="chatLoading && !chat.length" class="empty-line">正在恢复对话</p>
        <div v-else-if="!chat.length && !running && !chatError" class="chat-empty"><MessageSquare :size="28" /><h2>开始对话</h2><p>{{ project }} · {{ tools.length }} 个可用工具</p></div>
        <article v-for="message in chat" :key="message.message_id" class="chat-message" :class="message.role" :data-message-id="message.message_id">
          <div class="chat-message-meta"><strong>{{ message.role === 'user' ? '你' : 'Process Copilot' }}</strong><time>{{ messageTime(message.occurred_at) }}</time></div>
          <details v-if="message.role === 'user' && message.content.length > 700" class="chat-long-input"><summary>执行输入</summary><MarkdownMessage :content="message.content" /></details>
          <MarkdownMessage v-else :content="message.content" />
        </article>
        <article v-if="running" class="chat-message user"><div class="chat-message-meta"><strong>你</strong><span>发送中</span></div><p>{{ pendingPrompt }}</p></article>
        <div v-if="running" class="chat-running" role="status"><RefreshCw :size="15" class="spin" />正在执行</div>
      </div>
      <form @submit.prevent="turn" class="turn-composer"><textarea v-model="prompt" aria-label="运行消息" placeholder="向 Process Copilot 发送消息" rows="3" :disabled="running" @keydown.ctrl.enter.prevent="turn" @keydown.meta.enter.prevent="turn" />
        <div><span class="chat-context">{{ project ? `项目范围 · ${project}` : '个人范围' }} · {{ execution?.session ? (execution.runtime_available ? '会话已连接' : '待连接') : '新会话' }}</span><button type="submit" :disabled="busy || !!runningWorkspace || !workspaceId || !prompt.trim()"><Send :size="16" />发送</button>
          <button v-if="running" type="button" @click="cancel"><Square :size="16" />停止</button></div>
      </form>
      <details class="runtime-details"><summary>执行事件 · {{ execution?.events.length || 0 }}</summary><div class="event-table"><table><thead><tr><th>事件</th><th>持久性</th><th>时间</th></tr></thead>
        <tbody><tr v-for="event in execution?.events.slice(-60)" :key="event.event_id"><td>{{ event.event_type }}</td><td>{{ event.durability }}</td><td>{{ event.occurred_at }}</td></tr></tbody></table></div></details>
    </div>
    <div v-if="tab === 'evidence'" class="evidence-list">
      <article v-for="item in execution?.ledger" :key="item.operation.operation_id" class="evidence-row">
        <strong>{{ tools.find(t => t.tool_release_id === item.external?.tool_release_id)?.tool_definition_id || item.operation.operation_id }}</strong>
        <span>{{ item.operation.state }}</span>
        <small v-if="authority(item)">执行授权：{{ authorizationSources(authority(item)!.decision_mode) }}</small>
        <details v-if="authority(item)"><summary>授权记录</summary><dl class="operation-authority-record">
          <dt>PC 会话</dt><dd>{{ authority(item)!.pc_session_id }}</dd><dt>PC 决策</dt><dd>{{ authority(item)!.decision_id }}</dd>
          <template v-if="authority(item)!.provider_mapping_release_id"><dt>兼容映射</dt><dd>{{ authority(item)!.provider_mapping_release_id }}</dd></template>
          <template v-if="authority(item)!.provider_decision_ref"><dt>数据源决策</dt><dd>{{ authority(item)!.provider_decision_ref }}</dd></template>
        </dl></details>
        <button v-if="item.external?.outcome_state === 'OUTCOME_UNKNOWN'" type="button" :disabled="busy" @click="reconcile(item.operation.operation_id)"><RefreshCw :size="16" />回读对账</button>
        <code v-for="uri in item.external?.result?.external_evidence_refs" :key="uri">{{ uri }}</code>
        <a v-for="link in ownerLinks(item.external?.result?.result)" :key="link.uri" :href="`#owner=${encodeURIComponent(link.uri)}`" @click.prevent="openOwner(link.uri)"><ExternalLink :size="14" />{{ link.name }}</a>
        <details v-if="item.external?.result"><summary>Owner 返回与参数证据</summary><pre>{{ JSON.stringify(item.external.result, null, 2) }}</pre></details>
      </article>
      <p v-if="!execution?.ledger.length" class="empty-line">暂无执行证据</p>
    </div>
    <div v-if="tab === 'approvals'" class="approval-list">
      <article v-for="approval in approvals" :key="approval.approval_id" class="approval-row">
        <div><strong>{{ tools.find(t => t.tool_release_id === approval.tool_release_id)?.tool_definition_id || '受控请求' }}</strong><span>{{ approval.status }}</span></div>
        <code>{{ approval.approval_id }}</code><span>{{ approval.resource_scope_refs?.join(', ') }}</span>
        <pre>{{ JSON.stringify(approval.arguments, null, 2) }}</pre>
        <div v-if="approval.status === 'PENDING'" class="approval-actions">
          <button type="button" :disabled="busy" @click="decide(approval, 'APPROVE')"><Check :size="16" />批准</button>
          <button type="button" :disabled="busy" @click="decide(approval, 'REJECT')"><X :size="16" />拒绝</button>
        </div>
        <button v-if="approval.status === 'APPROVED' && approval.command_context?.workspace_id === workspaceId" type="button" :disabled="busy" @click="execute(approval)"><Play :size="16" />执行已批准请求</button>
      </article>
      <p v-if="!approvals.length" class="empty-line">暂无审批</p>
    </div>
    <details v-if="result" class="tool-result" :open="!answer"><summary>执行结果</summary><pre>{{ JSON.stringify(result, null, 2) }}</pre></details>
  </section>
</template>

<style scoped>
.operation-authority-record { min-width: 0; font-size: 12px; }
.operation-authority-record dt { color: #65727b; margin-top: 8px; }
.operation-authority-record dd { margin: 2px 0 0; overflow-wrap: anywhere; }
</style>
