# ADR-0001：用户作用域 DSH Runtime Pool、生命周期、多 Runtime 与多 Profile 装配

- 状态：Accepted
- 日期：2026-11-05
- 范围：T1.1 / Runtime-1 至 Runtime-4
- 决策方：Process Copilot 架构讨论
- 后续议题：Runtime-5 Session Assignment、Lease 与 Runtime Epoch

## 1. 背景

Process Copilot 需要支持多用户、多 Runtime、多 Session 和多 Business Expert Profile。DSH Runtime 是 Agent 执行资源；Process Copilot 后端是用户、Session、Profile、权限、调度和 Runtime 记录的控制面。

核心安全要求：不同用户不能共享 Runtime；同一用户的多个 Session 必须保持上下文、权限、文件、Tool 和 Profile 隔离。

## 2. 总体决策

采用：

```text
Process Copilot Control Plane
        ↓
User-scoped DSH Runtime Pool
        ↓
每个 Runtime 在存活期间只服务一个用户
        ↓
同一 Runtime 可承载该用户多个独立 Session 和多个兼容 Profile
```

Runtime 不永久归属于用户，可按需创建、租用、空闲回收和故障替换。

Process Copilot 后端持有 Runtime 的权威记录和调度权；Runtime 是执行资源，不是 Session、Profile、权限或业务任务的权威来源。

## 3. 永久否决

以下模式永久否决：

1. 跨用户共享 Runtime；
2. 同一租户内多个用户共享 Runtime；
3. 一个 Session 独占一个 Runtime；
4. Runtime 在存活期间从一个用户切换给另一个用户；
5. 每创建一个 Session 就创建一个 Runtime；
6. 每切换一个 Session 级 Profile 就创建一个 Runtime；
7. Session 驱动 Runtime 级 Plugin 动态安装、升级或卸载；
8. 同一 Session 原地热切换 Business Expert Profile Release。

## 4. Runtime-1：权威记录与用户归属

### 4.1 权威来源

Process Copilot 后端持有 `RuntimeRecord`。Runtime 不能自行决定自己的用户归属、Session 分配或权限范围。

### 4.2 作用域

```text
RuntimeScope
- tenant_id
- owner_user_id
```

- `owner_user_id` 是实际隔离边界；
- `tenant_id` 用于组织、配置、审计和数据命名空间；
- `tenant_id` 不允许租户内用户共享 Runtime；
- Runtime 一旦绑定用户，终止前不得更换；
- Runtime 终止后保留历史记录，不物理删除。

### 4.3 RuntimeRecord 概念字段

```text
runtime_id
runtime_epoch
tenant_id
owner_user_id
runtime_class
runtime_profile_ref
status
endpoint_ref
started_at
last_heartbeat_at
lease_expires_at
created_at
terminated_at
```

这是一组必须保留的技术信息，不代表数据库表已经冻结。

### 4.4 双重校验

后端调度前和 Runtime 接收命令时，都必须校验：

```text
tenant_id
owner_user_id
runtime_id
runtime_epoch
session_id
assignment/lease validity
authorization revision
```

## 5. Runtime-2：生命周期

### 5.1 状态

```text
PROVISIONING
    ↓
STARTING
    ↓
READY
    ↓
IDLE ↔ ACTIVE
    ↓
DRAINING
    ↓
TERMINATED
```

异常状态：

```text
FAILED
LOST
```

### 5.2 不采用的状态

- `REQUESTED` 属于 `RuntimeProvisionRequest`，不是 Runtime 实例状态；
- `LEASED` 由 `owner_user_id` 和 Lease 字段表达，不单独作为生命周期状态。

### 5.3 创建时机

Runtime 在 Session 第一次真正开始 Agent 执行时按需创建或分配：

- 不在用户登录时创建；
- 不在 Session 仅建立记录时创建；
- 第一阶段不建设常驻 READY 预热池；
- 将来只有启动延迟证据证明必要时才考虑预热。

### 5.4 空闲与回收

Runtime 只有在以下条件满足时才能从 IDLE 进入 DRAINING：

```text
active_step_count = 0
inflight_tool_call_count = 0
active_stream_count = 0
non_interruptible_job_count = 0
required_state_persisted = true
idle_duration > configured_timeout
```

等待用户输入或已持久化的长期审批不应永久占用 Runtime。

## 6. Runtime-3：同一用户多个 Runtime

### 6.1 默认复用

一个用户优先复用已有、健康、Lease 有效、能力兼容且有容量的 Runtime。

### 6.2 新建 Runtime 的唯一合法原因

```text
FIRST_RUNTIME
FAILURE_REPLACEMENT
VERSION_ROLLOUT
CAPABILITY_INCOMPATIBLE
CAPACITY_EXHAUSTED
```

不允许 `NEW_SESSION`、`PROFILE_SWITCH` 或模糊 `OTHER` 作为自动扩容理由。

### 6.3 数量控制

采用：

```text
每用户 Runtime 全局硬上限
+
每 Runtime Class 软上限
```

具体数值由容量测试决定，不在本 ADR 中写死。

### 6.4 Session 粘性

Session 正常运行期间保持 Runtime 粘性。仅在以下情况，于安全点重新分配：

- Runtime 故障；
- Runtime 进入 DRAINING；
- Runtime/Profile 版本升级。

安全点至少要求：无活动 Step、无 Tool in-flight、无流式输出且必要状态已持久化。

### 6.5 调度可追溯

后端应记录候选 Runtime、兼容性、容量快照、选择结果和创建原因。

## 7. Runtime-4：多 Profile 装配与隔离

### 7.1 双层 Profile

严格区分：

```text
DSH Runtime Profile
→ Runtime 级插件、能力和基础配置

Business Expert Profile Release
→ Session 级专业指令、Tool、知识、模型和输出契约
```

### 7.2 Runtime Capability Manifest

Runtime 启动后实际上报：

- Runtime Profile 版本；
- Plugin 及版本；
- Capability；
- Tool Provider；
- Model Adapter；
- 文件、网络、沙箱和安全能力。

后端不能只根据期望配置推测 Runtime 实际能力。

### 7.3 Profile Runtime Requirements

每个 Expert Profile Release 声明：

- required capabilities；
- required plugins and versions；
- required tool providers；
- required model adapters；
- forbidden capabilities；
- 文件、网络和沙箱要求。

调度器使用 Requirements 与 Runtime Capability Manifest 做兼容判定。

### 7.4 Plugin 稳定性

Runtime 启动后，Runtime 级 Plugin 集保持稳定。Session 创建、Profile 切换或 Session 结束不得安装、升级或卸载 Runtime 级 Plugin。

如果 Profile 需要当前 Runtime 不具备的能力：

1. 查找该用户其他兼容 Runtime；
2. 没有时以 `CAPABILITY_INCOMPATIBLE` 创建新 Runtime。

### 7.5 Effective Profile Snapshot

每个 Session 固定一份不可变快照：

```text
Expert Profile Release
∩ User Permission
∩ Project/Task Scope
∩ Runtime Security Constraints
∩ Tool Policy
=
Effective Profile Snapshot
```

快照保存版本和引用，不保存真实密钥。

### 7.6 Tool 隔离

采用三层机制：

```text
Runtime Tool Registry
+
Session-scoped Tool View
+
tools/pre-execute 再授权
```

模型只看到 Session Tool View；即使构造出不可见 Tool Call，执行前也必须拒绝。

### 7.7 模型、知识与文件隔离

- Model Adapter 是 Runtime 级能力；
- 模型选择和参数是 Session 级配置；
- 知识、项目、文件和资源范围是 Session 级；
- 真实模型或外部系统凭据通过受控凭据引用解析，不进入 Snapshot。

### 7.8 Session 固定 Profile

一个 Session 从创建到终止固定：

```text
一个 Expert Profile Release
一个 Effective Profile Snapshot
```

切换 Profile 必须创建新 Session，可通过 `source_session_id` 引用旧 Session。

### 7.9 Profile 版本规则

- 普通升级不影响旧 Session；
- 新 Session 使用新 Profile Release；
- 旧 Session 继续固定旧版本；
- 安全撤销可阻止旧 Session 继续执行；
- 被撤销的旧 Session 可只读查看历史，但不能原地热换 Profile。

## 8. 实现约束

后续代码和任务书必须满足：

1. Runtime API 和事件包含 tenant、user、runtime、epoch、session 和 trace；
2. Runtime 内不得用用户级全局变量代表当前 Session；
3. Session Context、Prompt、Tool View、文件范围和审批上下文独立；
4. Runtime Plugin 集合不受单个 Session 动态修改；
5. 调度器先检查用户归属，再检查能力兼容和容量；
6. 所有 Runtime 创建、分配、迁移、排空和终止都有审计记录；
7. 跨用户 Runtime 调度必须在后端和 Runtime 两端被拒绝；
8. 版本和 Snapshot 必须可恢复、可解释、可审计。

## 9. 验收要求

实现阶段至少需要验证：

- 两个用户无法进入同一 Runtime；
- 同一用户多个 Session 不串 Prompt、Tool、文件和 Profile；
- 不兼容 Profile 会选择或创建该用户的另一个 Runtime；
- 新 Session 不会无条件创建 Runtime；
- Profile 普通升级不改变旧 Session；
- Profile 撤销能阻止旧 Session 继续执行；
- DRAINING Runtime 不接受新工作；
- LOST/FAILED Runtime 不再获得有效调度；
- 迟到 epoch 事件被拒绝；
- Runtime 回收后 Session 权威记录仍存在。

## 10. 依据与未决项

### 已有依据

- DSH 官方架构、Agent 生命周期、Tool Pipeline 和 Capability Seams；
- 当前 Process Copilot 多 Session、持久任务和审批实践；
- 已确认的用户隔离和多 Profile需求。

### 仍需参考仓库审计

- 用户作用域 Worker/Runtime Pool；
- Session 粘性与 Lease；
- Capability Manifest 和调度；
- Profile/Plugin 版本兼容；
- 故障恢复与幂等写操作。

### 下一 ADR/讨论

Runtime-5：Session Assignment、Lease 和 Runtime Epoch 如何防止重复执行与脑裂。
