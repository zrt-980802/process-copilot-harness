# ADR-0003：Runtime 故障恢复、工作分类与外部结果对账

- 状态：Accepted
- 日期：2026-11-06
- 范围：T1.1 / Runtime-6
- 前置决策：ADR-0001、ADR-0002
- 后续议题：Runtime-7 安全回收、Registry、健康与可观测性

## 1. 背景

DSH Runtime 可能因进程崩溃、网络分区、容器替换、版本升级或资源回收而中断。恢复不能只回答“重新启动 Agent”，还必须处理中断的 LLM 流、未完成 Tool、外部写操作、审批、文件任务、权限变化和迟到事件。

ADR-0002 已规定 Assignment Generation、Runtime Epoch、Lease、Fencing Token 和幂等键。本 ADR 在这些执行权约束之上，定义恢复权威、稳定恢复点、工作分类、重新鉴权和外部结果对账。

## 2. 总体决策

Process Copilot Backend 中的 `Recovery Coordinator` 是恢复权威。恢复只依赖 Runtime 外部的持久事实；DSH Runtime 不自行决定迁移、恢复或外部写操作重试。

```text
持久事实
+ 当前 Assignment / Lease / Fencing
+ 工作恢复分类
+ 重新鉴权
+ 外部结果对账
=
可解释、可审计的恢复结果
```

## 3. 恢复权威与持久事实

恢复至少依据：

- SessionRecord；
- Assignment 历史；
- SessionEvent 和消息记录；
- Effective Profile Snapshot；
- Authorization Revision；
- ToolCall / ToolResult；
- Approval；
- 文件与资源引用；
- Checkpoint；
- 外部 Operation Ledger；
- 审计记录。

Runtime 内存、临时目录、开放连接和局部缓存不得作为恢复权威。

## 4. 稳定恢复点

Checkpoint 只建立在稳定边界：

- 用户输入已提交；
- Agent Step 已完成；
- Tool Result 已提交；
- Approval 状态已持久化；
- Turn 已完成。

流式 token、尚未提交的模型中间状态和 Runtime 本地变量不是恢复点。不承诺从任意 token 位置继续生成。

## 5. 中断的 LLM 流

- 中断的部分输出标记为未完成草稿或中断记录；
- 不把部分输出伪装为正式完成消息；
- 新 Runtime 从最后稳定 Checkpoint 重新生成完整结果；
- 重新生成必须保留模型版本、Prompt/Profile 版本和恢复原因；
- 旧 Runtime 的迟到流事件按 ADR-0002 作为 stale event 拒绝更新当前投影。

## 6. 工作恢复分类

每个 Tool、长任务和外部操作必须声明一种恢复分类：

```text
REPLAY_SAFE
IDEMPOTENT_RETRY
RECONCILE_BEFORE_RETRY
NON_RECOVERABLE
EXTERNAL_DURABLE_JOB
```

含义：

- `REPLAY_SAFE`：可从稳定输入重新执行，不产生重复副作用；
- `IDEMPOTENT_RETRY`：使用相同幂等键重试，受控边界返回既有结果；
- `RECONCILE_BEFORE_RETRY`：必须先查询外部状态，再决定补记、重试或人工介入；
- `NON_RECOVERABLE`：不能自动恢复，必须明确失败或交由人工处理；
- `EXTERNAL_DURABLE_JOB`：工作由独立持久 Job Worker 承担，Runtime 只保存 `job_id` 或 `operation_id`。

未声明分类的写操作默认按 `RECONCILE_BEFORE_RETRY` 处理。

## 7. Outcome Unknown 与对账

企业写操作结果未知时禁止盲目重试。Recovery Coordinator 先使用：

```text
operation_id
idempotency_key
external_ref
```

查询受控 Gateway 或最终业务系统。

结果处理：

- 已成功：补记 Tool Result 和业务结果；
- 明确失败且可重试：按分类和当前授权决定是否重试；
- 明确未执行：允许重新执行；
- 无法确定：进入 `RECONCILING` 或人工核查；
- 当前用户已无权限：不得继续执行，即使旧审批曾有效。

Retry 不等于 exactly-once。幂等、防重、Fencing 与外部对账必须同时存在。

## 8. 重新鉴权

恢复前重新验证：

- 用户与租户；
- 项目、任务和数据范围；
- Expert Profile Release；
- Effective Profile Snapshot 是否仍可使用；
- Tool 和 Capability；
- Approval 及参数 Hash；
- 凭据；
- 文件和资源引用；
- Authorization Revision；
- 当前 Assignment、Lease、Generation、Epoch 和 Fencing Token。

安全撤销优先于恢复。旧授权、旧凭据或旧审批不能自动延续。

## 9. 审批等待

审批持久化到 Process Copilot 后端后，不继续占用 Runtime。

批准后：

1. 重新选择或创建兼容 Runtime；
2. 建立新的有效 Assignment；
3. 重新鉴权；
4. 校验审批参数 Hash 和操作预览；
5. 执行 Tool；
6. 回读最终业务系统验证结果。

## 10. 长任务与不可透明恢复资源

需要跨 Runtime 存活的文件解析、批处理、浏览器长作业和工作流进入独立 Durable Job Worker。

默认不可透明恢复：

- 未外置的浏览器状态；
- Runtime 内命令进程；
- 无稳定外部句柄的长 MCP 调用；
- 无法对账的非幂等写操作；
- 仅存在 Runtime 本地目录中的持久业务文件。

## 11. 恢复状态

```text
RECOVERY_PENDING
→ RECOVERING
→ RECONCILING（可选）
→ RECOVERED / RECOVERY_FAILED
```

业务状态和技术恢复状态保持分离。`RECOVERED` 只表示技术恢复完成，不自动等于业务任务成功。

## 12. 审计要求

每次恢复至少记录：

- 旧 Runtime、Epoch 和 Assignment；
- 故障原因与检测方式；
- 最后稳定 Checkpoint；
- 未完成的 LLM、Tool、Job 和审批；
- 工作恢复分类；
- 外部对账请求与结果；
- 重新鉴权结果；
- 新 Runtime、Assignment、Generation 和 Fencing Token；
- 用户可见处理；
- 最终恢复结果。

## 13. 实现约束

1. Recovery Coordinator 位于 Process Copilot Control Plane；
2. Runtime 不得自行提升 Generation、Epoch 或 Fencing Token；
3. 未完成 Tool 必须产生明确结果、对账状态或恢复状态，不能永久悬空；
4. LLM 不得在确定性 replay 中隐式重新调用；
5. 写操作未知结果不得自动转成失败后重试；
6. 恢复必须重新鉴权并校验 Approval Hash；
7. Durable Job 的权威状态位于 Runtime 外；
8. 所有恢复决定可查询、可解释、可审计。

## 14. 验收要求

至少验证：

- Runtime 崩溃后从最后稳定 Checkpoint 恢复；
- 中断的 LLM 流不会被标记为完成；
- 不同恢复分类采用不同策略；
- 非幂等 unknown-result 不自动重试；
- 已成功但结果未回传的写操作可通过对账补记；
- 权限撤销后恢复被拒绝；
- 审批等待不持续占用 Runtime；
- Approval 参数变化会阻止执行；
- External Durable Job 可跨 Runtime 继续查询；
- 旧 Epoch、Generation 和 Fencing 事件被拒绝并审计；
- 不可恢复资源产生明确用户可见结果；
- 恢复记录能够还原完整决策链。

## 15. 依据与边界

正式证据卡见 `reference-evidence-runtime-closure.md`。

- DSH `dsh-v0.2.1-rc.3`：采用 Session 持久恢复边界，适配到 PC Control Plane；
- Temporal SDK Go：借鉴持久历史、heartbeat、retry/cancellation 和长任务外置，但不照搬确定性 Workflow replay 到 LLM；
- OpenHands software-agent-sdk：借鉴 base state + event log、未匹配 Action 检测和重连对账，但不采用其浏览器直达 Runtime 的安全边界。

