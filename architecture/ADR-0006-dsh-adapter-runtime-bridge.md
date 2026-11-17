# ADR-0006：DSH Adapter、Runtime Host 与 PC Runtime Bridge

- 状态：Accepted
- 日期：2026-11-06
- 范围：T1.1 至 T1.5、T2.1 至 T2.5、T11.1、T11.3
- 前置决策：ADR-0001、ADR-0002、ADR-0003、ADR-0004、ADR-0005
- 用户决策：CQ-A-01=A、CQ-A-02=A、CQ-A-03=A、CQ-A-04=A
- 实施原则：首期基线已冻结；其他有价值方案保留为可演进接口，不形成首期实现义务

## 1. 背景

Process Copilot 需要驱动 DSH Runtime，但不能把 DSH 的 pre-stable SDK、SessionEvent、插件树、错误文本或进程生命周期直接暴露给业务模块。

前置 ADR 已规定：

- PC Backend 是 Runtime、Assignment、Lease、Fencing、恢复和业务状态权威；
- Runtime 按用户隔离，同一用户可拥有多个 Runtime；
- Session 在 Runtime 间迁移时保持业务身份；
- ResourceRef、Profile Release、授权版本和 Workspace View 独立于 Runtime；
- 企业写操作需要重新鉴权、幂等、Fencing 和结果对账。

现有 DSH SDK 提供 stdio JSON-RPC、Session prompt/resume/wait、事件通知和进程回收，但没有 PC 所需的 Runtime Epoch、Assignment Generation、Fencing、Lease、Profile Release、Workspace View、事件补齐和稳定业务错误码。

## 2. 总体决策

采用三部分 Adapter：

```text
Process Copilot Backend
        |
        | stable DshAdapterPort
        v
DSH Runtime Host
        |
        | versioned local bridge protocol
        v
dsh --profile process-copilot-runtime
        |
        +-- PC Runtime Bridge Plugin
        +-- Assignment / Fencing Guard
        +-- AgentPreset Registry
        +-- PC Capability Providers
        +-- Standard DSH Core
```

### 2.1 PC Adapter Port

PC 业务模块只依赖 PC 自有的命令、查询、事件、错误和能力 Schema。

### 2.2 Runtime Host

Runtime Host 负责 DSH 进程、Profile、Bridge 协议、健康、事件补齐、回收和本机资源。

### 2.3 PC Runtime Bridge Plugin

Bridge Plugin 位于 DSH Runtime 内，负责 Session/Agent/Preset/Guard/Event 的 DSH 语义翻译。

本 ADR 不要求修改 DSH Core。优先使用 Profile、Bundle、Plugin、AgentPreset、Hook、Capability Provider 和外部服务。

## 3. 首期用户决策

### 3.1 CQ-A-01：主集成载体

首期选择 A：

```text
PC Runtime Bridge Plugin
+ 版本化本机 stdio / IPC 协议
```

不直接把现有 DSH SDK JSON-RPC 或 Typert API Gateway 作为 PC 稳定契约。

未来升级接口：

- `RuntimeBridgeTransport` 不绑定 stdio，可增加 DSH upstream SDK Transport；
- 当 DSH SDK 补齐版本、取消、Session Close、Fencing 和 Catch-up 后，可提供兼容实现；
- Typert Gateway / Session Controller 保留为能力参考和备用 Transport，不进入业务接口。

### 3.2 CQ-A-02：Runtime Host 部署

首期选择 A：

- Runtime Host 是逻辑独立、可单独部署的执行单元；
- 首期允许与 PC Worker 同进程、同 Pod 或同节点部署；
- PC API / Business Backend 不直接持有 DSH child process。

未来升级接口：

- `RuntimeHostPort` 同时支持本地调用和远程调用；
- 可在规模、隔离或资源证据出现后拆成独立服务；
- 每个 DSH Runtime 自行暴露公网或业务网络端口不是默认升级路径。

### 3.3 CQ-A-03：事件可靠性

首期选择 A：

```text
Live Event Stream
+ DSH 持久技术日志 Catch-up
+ PC at-least-once 幂等接纳
```

未来升级接口：

- `AdapterEventSink` 保留同步确认模式；
- 合规要求出现时，可对特定事件或操作启用同步 PC Event Store 提交；
- 不要求所有 DSH append 首期同步双写 PC。

### 3.4 CQ-A-04：DSH 技术 Session 日志

首期选择 A：

- 使用 DSH Session Persistence 保存技术日志；
- 存储位于 Runtime 临时生命周期之外；
- 新 Runtime 可以访问同一用户和 Session 的技术日志；
- PC 保存规范 Adapter 事件、业务投影和业务状态权威。

未来升级接口：

- Session Persistence 通过 Provider 边界接入；
- 可升级为 PC-backed DSH SessionPersistence Provider；
- Runtime 本地临时 JSONL 永久否决为唯一持久方案。

## 4. 反腐层边界

### 4.1 业务层禁止依赖 DSH 类型

PC 业务模块不得：

- import DSH SDK 类型作为领域对象；
- 直接调用 DSH SDK Client；
- 直接解析 DSH SessionEvent 推进业务状态；
- 依赖 DSH 错误文本或 JSON-RPC code；
- 管理 DSH child process；
- 直接写 DSH Profile、Patch、Tool、MCP 或文件 API。

### 4.2 DSH 原始信息的允许范围

原始 DSH 类型和事件只允许出现在：

- Adapter 内部翻译层；
- 技术诊断；
- 受控回放和证据存档；
- `technical_payload`。

PC 业务投影只消费 PC 规范事件。

## 5. 权威边界

### 5.1 PC Backend 权威

PC Backend 持有：

- RuntimeRecord；
- SessionAssignment；
- Runtime Epoch；
- Assignment Generation；
- Fencing Token；
- Lease；
- Effective Profile Snapshot；
- Authorization Revision；
- Workspace View Revision；
- Business Task / Approval / Operation Ledger；
- 业务审计和恢复决策。

### 5.2 DSH Runtime 权威

DSH 只持有当前实例的：

- Agent / Session 技术状态；
- Turn / Step；
- ToolCall / ToolResult；
- 模型请求和流；
- DSH Session 技术日志；
- 当前插件树和 Capability Provider；
- Runtime 本地缓存和临时执行资源。

### 5.3 Runtime Host 权威

Runtime Host 负责：

- 自己启动和拥有的 Runtime 进程；
- PID、启动参数、退出码和 stderr 尾部；
- Bridge 握手；
- 进程级 Liveness；
- shutdown / terminate；
- 本机临时目录和 orphan 清理；
- 与 PC RuntimeRecord 对账。

Runtime Host 不自行改变 Assignment、用户归属或业务恢复决策。

## 6. Runtime Profile 与 Session Profile

### 6.1 专用命名 Profile

首期 Runtime 使用：

```text
dsh --profile process-copilot-runtime
```

生产 Runtime 只加载版本锁定的 Bundle，不接受终端用户任意安装插件。

### 6.2 Runtime 级静态装配

Runtime 存活期间：

- Bundle Lock 不变；
- Runtime Profile Digest 不变；
- Bridge Protocol Major 不变；
- 关键 Capability Provider 不热替换；
- HMR 关闭；
- 变更通过创建新 Runtime 和迁移 Session 完成。

### 6.3 Session 级 AgentPreset

```text
Effective Profile Snapshot
→ DshPresetRef
  - preset_id
  - preset_revision_digest
  - required_capabilities
  - allowed_tool_set_digest
```

Bridge 在 Agent 创建或恢复的 setup window 中绑定 Preset。

规则：

- Session 首个 Turn 前冻结 Profile Release；
- 已开始 Session 不原地切换 Profile Release；
- DSH Preset 不是 PC Profile 权威；
- Preset 定义变化只影响新 Session 或明确的新 Session 分支；
- Session Profile 不触发 Runtime 级插件安装或卸载。

## 7. 启动、握手与注册

### 7.1 启动阶段

```text
PROCESS_SPAWNED
→ BRIDGE_HANDSHAKE
→ CONTROL_PLANE_REGISTERED
→ READY
```

只有全部完成才允许接收 Assignment。

### 7.2 Bridge Handshake

至少上报：

```text
bridge_protocol_version
bridge_build
dsh_version
dsh_commit
runtime_profile_id
runtime_profile_digest
bundle_lock_digest
capability_manifest
session_format_versions
supported_command_versions
supported_event_versions
```

Runtime Host 必须执行兼容判断，不兼容组合不得进入 READY。

### 7.3 Control Plane Registration

注册携带：

```text
runtime_id
runtime_epoch
tenant_id
owner_user_id
runtime_class
host_id
bridge_handshake_digest
bootstrap_credential
```

PC Backend 验证后签发短期 Runtime Credential。

## 8. AssignmentEnvelope

所有 Session 命令必须携带：

```text
AssignmentEnvelope
- tenant_id
- user_id
- session_id
- runtime_id
- runtime_epoch
- assignment_generation
- fencing_token
- lease_expires_at
- authorization_revision
- effective_profile_release_id
- dsh_preset_ref
- workspace_view_revision
```

Bridge 只缓存当前执行视图，不持有权威。缓存过期、失联或不确定时拒绝新工作。

## 9. 命令契约

### 9.1 统一命令外壳

```text
AdapterCommand
- command_id
- command_type
- command_schema_version
- idempotency_key
- payload_hash
- issued_at
- deadline
- trace_context
- assignment_envelope
- payload
```

相同 `command_id`：

- 相同 payload_hash 返回原状态或原结果；
- 不同 payload_hash 返回 `COMMAND_CONFLICT`；
- 不得重复执行。

### 9.2 Runtime 命令

```text
ProvisionRuntime
RegisterRuntime
SetRuntimeAdmission
DrainRuntime
TerminateRuntime
RefreshRuntimeCredential
```

### 9.3 Session 命令

```text
AssignSession
ResumeSession
SubmitTurn
SubmitSteering
CancelTurn
ReleaseSession
RevokeAssignment
RefreshAssignmentLease
RefreshAuthorizationSnapshot
RefreshWorkspaceView
```

语义：

- `SubmitTurn` 只返回接纳回执，不返回最终回答；
- `CancelTurn` 是取消请求，不证明 Tool 或外部操作已停止；
- `ResumeSession` 由 PC Recovery Coordinator 发起；
- `ReleaseSession` 等待 flush 和 Agent dispose；
- `RevokeAssignment` 立即关闭新准入并触发活动取消。

### 9.4 命令状态

```text
RECEIVED
VALIDATED
ADMITTED
STARTED
COMMITTED
REJECTED
FAILED
CANCEL_REQUESTED
CANCELLED
OUTCOME_UNKNOWN
```

## 10. 查询契约

首期查询：

```text
GetRuntimeStatus
GetRuntimeCapabilities
GetRuntimeHealth
GetRuntimeCapacity
GetSessionExecutionStatus
GetAssignmentObservation
GetCommandStatus
GetSessionEventCursor
GetOpenWork
GetCleanupReport
```

查询默认不创建 Agent、不恢复冷 Session、不续 Lease、不触发模型调用。

观察值标记：

```text
AUTHORITATIVE_PC
OBSERVED_RUNTIME
DERIVED_ADAPTER
UNKNOWN
```

Runtime 观察不能覆盖 PC 权威记录。

## 11. 事件契约

### 11.1 事件外壳

```text
AdapterEvent
- event_id
- event_type
- event_schema_version
- runtime_id
- runtime_epoch
- tenant_id
- user_id
- session_id
- assignment_generation
- fencing_token_version
- command_id
- dsh_session_seq
- runtime_event_seq
- durability
- occurred_at
- observed_at
- trace_context
- payload
```

### 11.2 事件分类

Runtime：

```text
RuntimeSpawned
BridgeHandshakeCompleted
RuntimeRegistered
RuntimeReady
RuntimeAdmissionChanged
RuntimeDraining
RuntimeTerminated
RuntimeFaulted
RuntimeCapabilityChanged
```

Assignment / Session：

```text
AssignmentAccepted
AssignmentRejected
SessionReady
SessionReleased
LeaseExpiring
LeaseExpired
AssignmentRevoked
StaleCommandRejected
```

执行：

```text
TurnAdmitted
TurnStarted
StepStarted
AssistantStreamFrame
ToolCallObserved
ToolResultObserved
StepEnded
TurnEnded
CheckpointAdvanced
ExecutionFaulted
```

控制：

```text
CancelObserved
AuthorizationRefreshRequired
WorkspaceViewRefreshRequired
ApprovalRequested
OutcomeUnknown
```

### 11.3 原始 DSH 事件

原始 DSH SessionEvent：

- 放入 `technical_payload`；
- 附带 DSH 和事件格式版本；
- 由翻译器生成 PC 规范事件；
- 未识别事件进入 `UNKNOWN_TECHNICAL_EVENT`；
- 不直接推进 PC 业务状态机。

## 12. 事件可靠性

### 12.1 At-least-once

PC Backend 按以下键幂等接纳：

```text
event_id
或
(runtime_id, runtime_epoch, session_id, dsh_session_seq, event_type)
```

### 12.2 局部顺序

- Session 技术事件按 `session_id + dsh_session_seq` 有序；
- Runtime 生命周期按 `runtime_id + runtime_epoch + runtime_event_seq` 有序；
- 不提供跨 Session 全局总序。

### 12.3 Live + Catch-up

```text
PC last accepted cursor
→ Runtime Host requests catch-up
→ Bridge reads DSH persisted Session log
→ resend missing durable events
→ switch to live stream
```

日志缺失、格式不兼容或游标越界时进入 `GAP_DETECTED`，交给 Recovery Coordinator。

### 12.4 Durability

```text
EPHEMERAL
OBSERVED
DURABLE_DSH
DURABLE_PC
```

流式 token 不作为恢复事实；`session/event` 回调不自动等于持久提交。

## 13. Lease、Fencing 与门禁

### 13.1 Host 校验

Runtime Host 在发送命令前校验：

- Runtime ID / Epoch；
- 用户归属；
- Assignment Generation；
- Fencing Token；
- Lease；
- deadline；
- Adapter API 版本。

### 13.2 Bridge 二次校验

Bridge 在执行前再次校验 Assignment 缓存。

### 13.3 Step 门禁

`agent/pre-step` 在以下情况拒绝：

- Lease 失效；
- Assignment 撤销；
- Authorization Revision 过期；
- Workspace View 过期且 Step 需要资源；
- Runtime DRAINING。

### 13.4 Tool 最终门禁

`tools/pre-execute` 和 monotonic Tool Guard 再次检查 Assignment 和 Lease。

企业写 Tool 必须把 operation_id、idempotency_key 和 fencing token 交给 PC Gateway。Runtime 本地 Guard 不是企业写操作的唯一安全边界。

### 13.5 撤销

收到 Revoke 或 Lease 到期：

1. 关闭新命令；
2. 拒绝新 Step 和 Tool；
3. cancel 活动 Agent；
4. 等待活动工作收敛；
5. flush；
6. 上报未完成 Tool 和 Outcome Unknown；
7. 释放 Agent；
8. 上报 SessionReleased。

## 14. Resource、Tool、MCP 与 Approval

### 14.1 Resource

Adapter 只传：

- WorkspaceViewSnapshotRef；
- ResourceRef；
- MaterializationRequest；
- Allowed Actions。

DSH `cwd` 只是 Materialization 执行路径，不是 Resource 身份。

### 14.2 企业写 Tool

```text
DSH Tool
→ PC Tool Gateway
→ re-auth + fencing + idempotency + approval hash
→ EE Claw / source system
```

### 14.3 Approval

DSH Approval 只作为执行期暂停点，不等于 PC 持久业务审批。本 ADR 只保留 `ApprovalRequested` 事件和暂停入口。

### 14.4 MCP

Adapter 只传 Principal、Assignment 和 Authorization Snapshot 引用。MCP 连接、Token Exchange 和缓存隔离由后续 MCP ADR 定义。

## 15. 错误模型

### 15.1 稳定错误码

```text
ADAPTER_INVALID_ARGUMENT
ADAPTER_NOT_READY
ADAPTER_DEADLINE_EXCEEDED
ADAPTER_CANCELLED

RUNTIME_NOT_FOUND
RUNTIME_EPOCH_MISMATCH
RUNTIME_NOT_READY
RUNTIME_DRAINING
RUNTIME_CAPABILITY_UNAVAILABLE
RUNTIME_TRANSPORT_LOST

ASSIGNMENT_NOT_FOUND
ASSIGNMENT_STALE
ASSIGNMENT_REVOKED
LEASE_EXPIRED
FENCED

SESSION_NOT_FOUND
SESSION_BUSY
SESSION_PROFILE_MISMATCH
SESSION_PERSISTENCE_UNAVAILABLE
SESSION_EVENT_GAP

AUTHORIZATION_STALE
WORKSPACE_VIEW_STALE
RESOURCE_UNAVAILABLE

COMMAND_CONFLICT
COMMAND_ALREADY_COMMITTED
COMMAND_OUTCOME_UNKNOWN

DSH_STARTUP_FAILED
DSH_PROTOCOL_INCOMPATIBLE
DSH_INTERNAL_FAILURE
```

### 15.2 错误结构

```text
AdapterError
- code
- message
- retryable
- outcome_state
- recovery_action
- runtime_id / epoch
- session_id / generation
- command_id
- details
- diagnostic_cause
```

调用方只能按 `code` 分支。DSH 文本只进入 `diagnostic_cause`。

### 15.3 Outcome State

```text
NOT_STARTED
STARTED_NOT_COMMITTED
COMMITTED
UNKNOWN
```

超时、通道断开或进程退出不能自动解释为 NOT_STARTED。

## 16. 版本与能力协商

版本独立：

```text
adapter_api_version
bridge_protocol_version
dsh_runtime_version
```

Capability Manifest 至少包括：

```text
commands
queries
events
session_event_formats
profile_features
resource_features
tool_guard_features
approval_features
persistence_features
```

兼容规则：

- Adapter API Major 不兼容；
- Minor 只新增可选字段和能力；
- Runtime Host 支持当前和前一 Bridge Minor；
- DSH、PC Bundle 和 Bridge 使用明确兼容矩阵；
- 升级通过新 Runtime 灰度和 Session 迁移完成。

## 17. 进程与部署

### 17.1 Runtime 实例

```text
runtime_id + runtime_epoch
→ one owned DSH process/container instance
```

一个实例可承载同一用户多个 Session，不得跨用户。

### 17.2 Runtime Host 监督

负责：

- spawn；
- stdout protocol purity；
- stderr 限长；
- startup timeout；
- heartbeat；
- cooperative shutdown；
- EOF / TERM / KILL ladder；
- exit reconciliation；
- orphan detection；
- temp cleanup。

### 17.3 网络

- Runtime Host 与 Bridge 默认使用本机 stdio 或 IPC；
- 每个 Runtime 不暴露业务网络端口；
- 浏览器、移动端和外部系统不得直连 Runtime；
- 跨节点通信只发生在 PC Backend 与 Runtime Host 之间。

## 18. 候选实现包

候选责任：

```text
process-copilot-dsh-adapter-contract
process-copilot-runtime-host
@process-copilot/dsh-runtime-bundle
@process-copilot/dsh-runtime-bridge
@process-copilot/dsh-assignment-guard
@process-copilot/dsh-profile-provider
@process-copilot/dsh-resource-provider
@process-copilot/dsh-event-exporter
```

包可以在实施设计中合并，但责任、版本和测试面不能消失。

## 19. 机制选择标准

| 需求 | 优先机制 |
|---|---|
| 进程级静态装配 | Profile / Bundle |
| Session 级工具和 Prompt | AgentPreset |
| Step / Tool 门禁 | Plugin Hook / Tool Guard |
| 可替换执行能力 | Capability Seam |
| 企业权限、业务写和审计 | PC Gateway / External Service |
| Runtime 生命周期与调度 | PC Adapter / Runtime Host |
| 模型可见操作 | Tool |
| 外部标准工具接入 | MCP |
| 长期业务状态 | PC Backend |

Plugin 不承载跨 Runtime Registry、用户权威、Business Task、持久审批、企业操作账本或 Resource 权限权威。

## 20. 永久禁止

1. PC 业务代码直接调用 DSH SDK；
2. 前端直连 DSH Runtime；
3. 把 DSH Runtime 作为用户、权限、Profile 或业务状态权威；
4. 把 `session/event` 回调直接视为持久提交；
5. 用 Runtime 心跳替代 Session Lease；
6. Tool 绕过 PC Gateway 执行企业写；
7. 活动 Runtime 热换关键 Bundle 或 Bridge Major；
8. 以默认 Preset 替代丢失的 Profile Release；
9. 以 DSH 错误字符串或进程退出码作为 PC 分支条件；
10. 因 Adapter 需要新行为直接推导修改 DSH Core；
11. Runtime 本地临时 JSONL 作为唯一 Session 持久化。

## 21. 未来演进

以下路径保留接口，但需要新证据和新 ADR：

1. DSH upstream SDK 成熟后替换自定义 Bridge Transport；
2. Typert Gateway 成为备用或特定场景 Transport；
3. Runtime Host 从同 Pod 拆分为独立服务；
4. 特定合规事件启用同步 PC Event Store；
5. 建设 PC-backed DSH SessionPersistence Provider；
6. Bridge 协议支持额外 Runtime 类型。

这些演进不能静默改变首期语义。

## 22. 验收要求

至少验证：

- PC 业务模块不 import DSH SDK 类型；
- Runtime 只能通过命名 Profile 启动；
- 不同用户不能进入同一 DSH 进程；
- 同用户多个 Session 不串 Assignment 或事件；
- 旧 Epoch、Generation、Fencing 和过期 Lease 被拒绝；
- 撤销会取消活动 Agent 并阻止新 Tool；
- 外部写 Gateway 再次校验 Fencing 和幂等；
- command_id 重放不重复执行；
- SubmitTurn 只返回接纳；
- CancelTurn 只表示请求；
- 断线后按 Session seq 补齐；
- 重复事件不重复推进 PC 投影；
- 缺失游标进入 GAP_DETECTED；
- Profile Release 固定映射 AgentPreset；
- 已开始 Session 不原地切换 Profile；
- ResourceRef 不因 Runtime 替换变化；
- 浏览器不能访问 Bridge；
- DSH 错误文本不成为 PC 分支条件；
- 不兼容版本不能进入 READY；
- shutdown 失败可升级终止并产生 Cleanup Report；
- DSH Core 无修改时完成最小端到端路径；
- 替代 Transport、远程 Runtime Host、同步 Event Sink 和 PC-backed Persistence 接口可以被兼容实现。

## 23. 依据

正式证据卡见 `reference-evidence-dsh-adapter.md`。

## 24. 实施授权

本 ADR 只冻结技术设计，不自动授权：

- 编写 Adapter 或 Plugin；
- 修改 DSH；
- 建设 Runtime Host；
- 引入 RPC、消息队列或对象存储；
- 部署；
- 数据迁移。

实施必须等待全部技术 ADR、统一 DSH 无侵入审查和独立任务书。
