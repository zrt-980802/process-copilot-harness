# ADR-0004：Runtime 安全回收、Registry、健康、可观测性与持久 Workspace

- 状态：Accepted
- 日期：2026-11-06
- 范围：T1.1 / Runtime-7、Runtime Registry、T7.3、T10.4、T10.5
- 前置决策：ADR-0001、ADR-0002、ADR-0003
- 用户决策：CQ-01 选择方案 C

## 1. 背景

Runtime 是可创建、替换和回收的执行资源。Session、审批、业务任务和持久文件可能比 Runtime 生命周期更长，因此必须明确何时可以回收 Runtime、如何排空和清理、谁持有 Runtime Registry、如何区分健康维度，以及持久 Workspace 如何独立于 Runtime。

## 2. 总体决策

采用：

```text
PC Backend 权威 Runtime Registry
+ 明确 IDLE 条件
+ 分阶段 DRAINING 与 Finalizer
+ 分层健康模型
+ 审计与遥测分离
+ 用户根 Workspace + Session 子 Workspace
=
可回收、可恢复、可观测的 Runtime 运行架构
```

## 3. IDLE 定义

Runtime 只有同时满足以下条件才是 IDLE：

```text
active_step_count = 0
inflight_tool_call_count = 0
active_stream_count = 0
non_interruptible_job_count = 0
pending_assignment_transition_count = 0
required_state_persisted = true
```

以下情况不阻止 Runtime 进入 IDLE：

- Session 记录仍然存在；
- 等待用户输入；
- 等待已持久化审批；
- 外部 Durable Job 仍在运行但 Runtime 只持有稳定句柄。

## 4. 回收资格

只有同时满足以下条件才能进入 DRAINING：

- Runtime 状态为 IDLE；
- 超过配置化 `idle_timeout`；
- 无活动或过渡中的 Assignment；
- 无未持久化状态；
- 无回收阻断项；
- Control Plane 已关闭新准入。

具体超时不在 ADR 中写死，由启动时延、资源成本和恢复体验测试确定。

## 5. DRAINING 闸门

DRAINING 后拒绝：

- 新 Session Assignment；
- 新 Turn；
- 新 Tool Call；
- 新长任务；
- 新写操作。

允许：

- 已有工作收尾；
- 可中断工作取消；
- 状态 Flush；
- Assignment / Lease 释放；
- 连接关闭；
- 临时资源清理；
- 审计与指标 Flush。

## 6. 分阶段排空

```text
1. Admission Closed
2. Finish / Cancel interruptible work
3. Wait non-interruptible work until grace deadline
4. Flush persistent state
5. Release Assignment / Lease
6. Close MCP / LLM / Tool executors
7. Cleanup temporary resources
8. Mark TERMINATED
9. Stop process or container
```

排空超时不能伪造成功：

- 未完成写操作进入 Outcome Unknown / RECONCILING；
- 可重放工作记录为取消或中断；
- 先使旧 Assignment 失效并提高 Fencing；
- 记录强制终止原因；
- 终止后交给 Recovery Coordinator。

## 7. Finalizer 模型

每类资源注册：

```text
finalizer_name
deadline
idempotent
critical
```

关键 Finalizer 至少包括：

- Session Flush；
- Assignment Release；
- MCP Close；
- Tool Executor Close；
- Runtime 临时文件清理；
- Metrics / Audit Flush。

一个 Finalizer 失败不阻止其他 Finalizer 执行。最终聚合全部结果并记录失败。

## 8. Runtime Tombstone

Runtime 终止后保留：

- 最终状态；
- Cleanup Report；
- Final Event Sequence；
- Resource Leak Marker；
- `terminated_at`；
- 终止原因；
- 最后 Capability / Health 摘要。

不得物理删除 RuntimeRecord。

## 9. Runtime Registry

Process Copilot Backend 持有唯一权威 Runtime Registry。第一阶段作为 Backend 模块和数据库记录实现，不提前拆独立服务；接口按未来可拆分设计。

Runtime 只能上报自身观察，不能自行改变用户归属、Assignment 或权威状态。

### 9.1 注册握手

Runtime 使用一次性 Bootstrap Credential 登记：

```text
runtime_id
runtime_epoch
runtime_profile
build
capability_manifest
endpoint
```

验证后获得短期 Runtime Credential。旧 Epoch Credential 不可复用。

### 9.2 Registry 视图

至少包含：

- RuntimeRecord；
- RuntimeCapabilityManifest；
- Health Summary；
- Capacity Snapshot；
- Active Assignments；
- Last Heartbeat；
- Lease；
- Drain Reason；
- Cleanup Report。

### 9.3 心跳

至少携带：

```text
runtime_id
runtime_epoch
owner scope
status
manifest digest
active assignment generations
active work counters
resource metrics
last committed event watermark
monotonic heartbeat sequence
```

状态更新使用 `expected_version` 或 CAS，防止迟到心跳把 LOST、DRAINING 或 TERMINATED 改回 ACTIVE。

## 10. 分层健康模型

### 10.1 Liveness

只回答进程和基本控制通道是否存活，不证明 Runtime 可调度。

### 10.2 Readiness

检查 DSH Core、Plugin Tree、Tool Registry、Event Bridge、必要持久化和受控 Gateway。`Readiness=false` 时不得接受新 Assignment。

### 10.3 Capability Health

每项 Capability 独立报告：

```text
HEALTHY
DEGRADED
UNAVAILABLE
```

单个 MCP Provider、Model Adapter 或文件服务失败，只阻止依赖该能力的 Profile，不默认使整个 Runtime FAILED。

### 10.4 Assignment Health

逐 Assignment 检查：

- Lease；
- Last Progress；
- Active Step / Tool / Stream；
- Checkpoint Watermark；
- Recovery State。

Runtime 总体健康不能掩盖单个 Session 卡死。

### 10.5 分离原则

Liveness、Readiness、Capability Health、Capacity 和 Assignment Health 必须分开。不得用一个 `/healthz=true` 表示全部正常。

## 11. 可观测性

日志、指标和 Trace 统一携带：

```text
tenant_id
user_id
runtime_id
runtime_epoch
session_id
assignment_generation
fencing_token（仅安全序号）
profile_release_id
tool_call_id
trace_id
```

关键指标至少包括：

- Runtime 状态数量与时长；
- 启动、就绪、排空和终止时延；
- Active Session / Step / Stream / Tool；
- Heartbeat Age 和 Lease Renewal Failure；
- Recovery 数量、耗时和结果；
- Stale Event / Fencing Rejection；
- Outcome Unknown / Reconciliation Backlog；
- Idle Reclaim；
- RSS、CPU、Event-loop Lag 和 Workspace Disk；
- LLM TTFT、Tool Latency 和 Gateway Auth Latency。

审计与普通遥测分离。安全和业务审计不能依赖可能采样或丢失的指标系统。

至少对以下情况告警：

- Runtime LOST；
- Lease 续租失败；
- Readiness 长时间 false；
- DRAINING 超时；
- Fencing 拒绝激增；
- Reconciliation 积压；
- 每用户 Runtime 达到硬上限；
- Flush 失败；
- Cleanup Leak。

## 12. 持久 Workspace：方案 C

采用：

```text
User Workspace Root
├─ shared/
├─ session-A/
├─ session-B/
└─ artifacts/
```

冻结以下原则：

1. 持久 Workspace 独立于 Runtime；
2. 用户拥有根作用域；
3. 每个 Session 使用独立子作用域；
4. 共享资源必须显式进入 `shared` 或通过 `resource_ref` 引用；
5. Runtime 只获得当前 Session 被授权的视图；
6. Runtime 本地目录只保存临时资源；
7. Runtime 回收、故障和升级不能改变持久 Workspace 的权威记录；
8. Profile、Task、Project 和数据权限继续约束 Workspace 可见范围。

本 ADR 不冻结对象存储产品、物理目录、配额、保留时间和归档策略，这些进入文件/工作空间专题。

## 13. 实现约束

1. DRAINING 后不得接受新工作；
2. Control Plane 在 grace deadline 后有权强制终止 Runtime；
3. 强制终止前必须使旧执行权失效并保存 unknown-result；
4. Finalizer 必须可独立执行并聚合失败；
5. Registry 状态变更使用 CAS 或等价并发控制；
6. 心跳不能无条件延长所有 Session Lease；
7. Readiness 和 Liveness 不得混用；
8. 持久 Workspace 不能以 Runtime 本地路径作为权威引用；
9. 浏览器和 Tool 不得获得超出当前 Session 的 Workspace 视图；
10. 审计记录不得因遥测采样而丢失。

## 14. 验收要求

至少验证：

- 有历史 Session 但无活动工作的 Runtime 可进入 IDLE 并回收；
- 等待持久审批不占 Runtime；
- DRAINING 拒绝新 Assignment、Turn 和 Tool；
- Finalizer 单项失败不阻止其他清理；
- DRAINING 超时不伪造成功；
- TERMINATED Runtime 的迟到心跳不能复活记录；
- Liveness=true、Readiness=false 时不可调度；
- 单 Capability 失败只影响依赖它的 Profile；
- 单 Assignment 卡死可以独立检测；
- Runtime 终止后历史、Cleanup Report 和 Leak Marker 可查询；
- Session A 的 Runtime 无法读取 Session B 未授权子空间；
- `shared` 资源必须通过显式授权访问；
- Runtime 替换后 Session Workspace 引用保持稳定。

## 15. 依据

正式证据卡见 `reference-evidence-runtime-closure.md`。

- DSH：采用可撤销生命周期、Session Flush 和 teardown 聚合失败的事实边界；
- Temporal SDK Go：借鉴长任务外置、取消和进度恢复语义；
- OpenHands SDK：借鉴持久 Conversation 与 Runtime 生命周期分离、幂等 Close 和重连对账；
- OpenHands 前端：仅作 Runtime URL、Sandbox Registry 和 readiness 对照，不采用浏览器直达 Runtime 的企业写安全模式。

