<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { CircleUserRound, Database, ShieldCheck } from "lucide-vue-next";
import { request } from "./api";
import type { ExperienceProjection } from "./experience-policy";
import { authorizationSources, safeAuthorizationReason, type AuthorizationObservation } from "./authorization-presentation";

interface View {
  principal_id: string; account_name: string;
  session: { state: string; pc_session_id: string; expires_at: string };
  capability_groups: Array<{ key: string; capabilities: Array<{ action: string; available: boolean }> }>;
  last_decision?: Omit<AuthorizationObservation, "generation">;
}
const props = defineProps<{ token: string; accountName: string; project: string; generation: number; experience: ExperienceProjection; sourceState: string }>();
const emit = defineEmits<{ sessionInvalid: [] }>();
const view = ref<View>();
const observation = ref<AuthorizationObservation>();
const unavailable = ref(false);
const denialMessage = ref("");
let deniedResource = "";
let observedToken = "";
let controller: AbortController | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const names: Record<string, string> = { "conversation.run": "个人对话", "personal_task.read": "查看任务", "personal_task.write": "管理任务" };
const capabilities = computed(() => view.value?.capability_groups.flatMap(group => group.capabilities) ?? []);
const scope = computed(() => props.experience.showProjectSurface && props.project ? `项目 · ${props.project}` : "个人范围");
const source = computed(() => props.sourceState === "READY" ? "已连接" : props.sourceState === "UNCONFIGURED" ? "未连接" : "暂不可用");
const currentName = computed(() => view.value?.account_name && view.value.account_name !== "PC account" ? view.value.account_name : props.accountName);
const expiry = computed(() => view.value ? new Date(view.value.session.expires_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "");
function observed(event: Event) {
  const value = (event as CustomEvent<AuthorizationObservation>).detail;
  if (!view.value || value.generation !== props.generation || value.principal_id !== view.value.principal_id
    || value.pc_session_id !== view.value.session.pc_session_id) return;
  if (value.decision_mode === "PC_AND_PROVIDER" && value.decision === "ALLOW"
    && (!props.experience.showProjectSurface || value.resource_ref !== `project:${props.project}`)) return;
  observation.value = value;
  if (value.decision === "DENY") {
    deniedResource = value.resource_ref;
    denialMessage.value = safeAuthorizationReason(value.reason_codes);
  } else if (value.resource_ref === deniedResource) {
    deniedResource = ""; denialMessage.value = "";
  }
}
window.addEventListener("pc-authorization-observed", observed);
watch(() => [props.token, props.generation], async () => {
  controller?.abort(); clearTimeout(expiryTimer);
  controller = new AbortController();
  const signal = controller.signal;
  if (observedToken !== props.token) { denialMessage.value = ""; deniedResource = ""; }
  observedToken = props.token;
  view.value = undefined; observation.value = undefined; unavailable.value = false;
  try {
    const result = await request<View>("/v1/identity/capabilities", props.token, { signal });
    if (signal.aborted) return;
    view.value = result;
    const remaining = Date.parse(result.session.expires_at) - Date.now();
    if (remaining <= 0) emit("sessionInvalid");
    else expiryTimer = setTimeout(() => emit("sessionInvalid"), Math.min(remaining, 2_147_483_647));
  } catch (error) {
    if (signal.aborted) return;
    unavailable.value = true;
    if (error instanceof Error && "status" in error && error.status === 401) emit("sessionInvalid");
  }
}, { immediate: true });
watch(() => [props.sourceState, props.experience.showProjectSurface, props.project], () => {
  if (observation.value?.decision_mode === "PC_AND_PROVIDER") observation.value = undefined;
}, { flush: "sync" });
onBeforeUnmount(() => { controller?.abort(); clearTimeout(expiryTimer); window.removeEventListener("pc-authorization-observed", observed); });
</script>

<template>
  <section class="authority-status" aria-label="当前能力与数据源" data-test="authority-status">
    <h2><ShieldCheck :size="15" />当前能力与数据源</h2>
    <dl class="authority-status-fields">
      <div><dt><CircleUserRound :size="14" />PC 账号</dt><dd>{{ currentName }} <small v-if="view">登录有效 · {{ expiry }} 到期</small><small v-else>{{ unavailable ? '状态暂不可用' : '核对中' }}</small></dd></div>
      <div><dt>当前范围</dt><dd>{{ scope }}<small v-if="experience.showProjectSurface">{{ experience.tools.some(tool => tool.risk_manifest.action_class === 'READ') ? '项目读取可用' : '当前无读取能力' }}</small></dd></div>
      <div><dt><Database :size="14" />外部数据源</dt><dd>{{ source }}<small>{{ experience.showProjectSurface ? '按当前项目授权' : '外部能力未启用' }}</small></dd></div>
    </dl>
    <div class="authority-status-footer">
      <span class="authority-capabilities"><span v-for="capability in capabilities" :key="capability.action" :class="{ denied: !capability.available }">{{ names[capability.action] ?? '个人能力' }}{{ capability.available ? '' : ' · 不可用' }}</span></span>
      <span v-if="observation" class="authority-last-request" role="status">最近请求：{{ authorizationSources(observation.decision_mode) }} · {{ observation.decision === 'ALLOW' ? '已允许' : '已拒绝' }}</span>
    </div>
    <p v-if="denialMessage" class="authority-denial" role="status">{{ denialMessage }}</p>
  </section>
</template>

<style scoped>
.authority-status { padding: 12px 16px; border-bottom: 1px solid #dce2e7; background: #f8fafb; min-width: 0; }
.authority-status h2 { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; margin: 0 0 10px; color: #253238; }
.authority-status-fields { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin: 0; }
.authority-status-fields > div { min-width: 0; }
.authority-status dt { display: flex; align-items: center; gap: 5px; color: #65727b; font-size: 11px; margin-bottom: 4px; }
.authority-status dd { margin: 0; font-size: 13px; color: #253238; overflow-wrap: anywhere; }
.authority-status dd small { display: block; color: #65727b; font-size: 11px; line-height: 1.5; }
.authority-status-footer { display: flex; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; margin-top: 10px; font-size: 11px; color: #426458; }
.authority-capabilities { display: flex; gap: 10px; flex-wrap: wrap; }
.authority-capabilities .denied, .authority-denial { color: #9b3a40; }
.authority-last-request { overflow-wrap: anywhere; }
.authority-denial { margin: 6px 0 0; font-size: 12px; line-height: 1.6; }
@media (max-width: 600px) { .authority-status { padding: 10px 12px; } .authority-status-fields { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; } .authority-status-fields > div:first-child { grid-column: 1 / -1; } }
</style>
