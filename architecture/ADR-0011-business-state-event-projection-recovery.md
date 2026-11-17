# ADR-0011：业务状态、事件投影、Operation Ledger 与恢复

- 状态：Accepted
- 日期：2026-11-09
- 范围：T8.1 至 T8.7
- 前置决策：ADR-0001 至 ADR-0010
- 用户授权：接受本批全部推荐方案作为第一版
- 实施原则：PC 业务事实与 DSH 技术事实分离；非确定性 LLM 不做确定性 Replay

## 1. 决策摘要

采用：

```text
DSH technical events
→ versioned Event Envelope
→ durable PC Event Inbox
→ idempotent Event Normalizer
→ Business Event Store / Operation Ledger
→ rebuildable Projections
→ Task / Approval / Operation views
```

核心结论：

1. DSH 持有 Agent、Session、Turn、Step 和 Tool 的技术执行事实；
2. PC 持有 BusinessTask、Subtask、BusinessOperation、Approval、Evidence、Decision 和 Verification 的业务事实；
3. 业务状态不能直接由 UI、Runtime 内存或单条 SessionEvent 充当；
4. 所有跨边界事件按 at-least-once 处理；
5. 只保证单事件流局部顺序，不假设全局顺序；
6. Projection 必须可从持久事件和快照重建；
7. Tool 返回、外部副作用、回读验证和业务成功是不同事实；
8. 暂停、等待和持久审批不占用 Runtime；
9. 恢复重新鉴权、重新绑定 Runtime 和 Credential；
10. Cancel 是请求，Compensation 是新业务操作，不改写历史。

## 2. 对象与基数

```text
BusinessTask
  1 ── N Subtask
  1 ── N AgentInstance
  1 ── N BusinessOperation
```

```text
AgentInstance
  1 ── N ExecutionBinding history
  1 ── N DSH Session generation
  1 ── 1 active primary ExpertProfileRelease
```

```text
DSH Session
  1 ── N Turn
  1 ── N Step
  1 ── N ToolCall
```

```text
BusinessOperation
  1 ── N ToolCall
  1 ── N ExecutionAttempt
  0 ── N ApprovalDecision
  0 ── N Verification
  0 ── N ReconciliationAttempt
```

一个业务操作可以有多个技术 Attempt，但只能有一个当前业务结果。

## 3. 权威事实

### DSH

- Session / Turn / Step；
- ToolCall / ToolResult；
- Approval Query；
- SessionEvent；
- Runtime 内当前 Context。

### PC

- BusinessTask / Subtask；
- AgentInstance；
- ExecutionBinding；
- BusinessOperation；
- BusinessApproval；
- Evidence / Decision / Verification；
- UserActionRequired；
- Recovery / Compensation；
- Operation Ledger；
- Projection Cursor。

DSH Event 是输入证据，不直接成为 PC 业务状态。

## 4. Event Envelope

```text
EventEnvelope
- envelope_version
- event_id
- event_type
- producer
- producer_version
- occurred_at
- observed_at
- tenant_id
- user_id
- task_id
- agent_instance_id
- runtime_id
- runtime_epoch
- session_id
- assignment_generation
- fencing_token
- stream_id
- stream_sequence
- causation_id
- correlation_id
- operation_id
- tool_call_id
- payload_schema_version
- payload
- payload_digest
```

规则：

- `event_id` 全局唯一；
- `stream_sequence` 只在同一 Stream 单调；
- 迟到事件不能复活已被新 Fencing 取代的执行权；
- Payload 使用版本化 Schema；
- 大 Payload 使用 ResourceRef；
- 敏感值只保存引用或摘要。

## 5. Ingestion 与幂等

Event Inbox 先持久化再确认接收。

幂等键：

```text
producer + event_id
```

Normalizer：

- 验证 Schema；
- 验证 Runtime Epoch / Assignment Generation / Fencing；
- 识别重复；
- 检测缺口；
- 标记迟到；
- 转换为 PC Domain Event；
- 使用 expected_revision 更新 Aggregate。

重复事件返回已处理结果，不重复产生业务副作用。

## 6. 顺序、乱序与缺口

不建立昂贵的全局总序。

使用：

- per-stream sequence；
- aggregate revision；
- causation/correlation；
- watermark；
- gap detection；
- Event Backfill。

乱序事件：

- 先进入 Inbox；
- 不满足前置 Revision 时保持 Pending；
- 请求补齐缺口；
- 超过等待策略后进入 Recovery Review；
- 不通过时间戳猜测覆盖新状态。

## 7. 状态机

### BusinessTask

```text
DRAFT
→ READY
→ RUNNING
→ WAITING_USER | WAITING_APPROVAL | PAUSED | RECOVERING
→ COMPLETED | FAILED | CANCELLED
```

### BusinessOperation

```text
PLANNED
→ AWAITING_APPROVAL
→ APPROVED
→ DISPATCHING
→ DISPATCHED
→ VERIFYING
→ SUCCEEDED | FAILED | OUTCOME_UNKNOWN
OUTCOME_UNKNOWN → RECONCILING → SUCCEEDED | FAILED | COMPENSATION_REQUIRED
```

禁止：

- ToolResult=success 直接把 Operation 标成 SUCCEEDED；
- Approval=approved 直接表示已执行；
- CancelRequested 直接表示已取消；
- Runtime LOST 直接把 BusinessTask 标成 FAILED。

## 8. Projection 与重建

Projection 是可删除、可重建的查询视图。

每个 Projector 保存：

```text
projector_name
projector_version
partition
last_event_cursor
projection_schema_version
last_checkpoint
health
```

重建：

```text
latest compatible snapshot
→ replay normalized domain events
→ verify aggregate revision
→ compare digest
→ atomically replace projection
```

LLM 输出作为已发生的 Event Payload 或 ResourceVersion 重放，不在重建时重新调用模型。

## 9. Checkpoint 与 Snapshot

Snapshot 只用于加速，不是唯一真相。

至少固定：

- aggregate revision；
- source event cursor；
- state digest；
- schema version；
- projector version；
- dependency refs。

Snapshot 不得跳过未确认外部写结果。

## 10. 暂停、等待与人工接管

WAITING_USER、WAITING_APPROVAL、PAUSED：

- 持久化业务状态；
- Flush DSH Session；
- 释放 Runtime Assignment；
- 保留 Resume Token Ref；
- 不保留长期 Credential；
- 恢复时重新授权和调度。

人工接管创建：

- TakeoverRequested；
- TakeoverGranted；
- previous actor；
- new actor；
- scope；
- reason；
- revision。

接管不改写原 Actor 历史。

## 11. 恢复

恢复顺序：

```text
load BusinessTask / Operation authority
→ classify interrupted work
→ resolve Outcome Unknown
→ reauthorize principal and scope
→ resolve current Profile / Tool / Connector
→ acquire new Runtime Assignment
→ acquire new Credential Lease
→ restore or create DSH Session generation
→ resume from durable checkpoint
```

分类继续使用 ADR-0003：

- Replayable；
- Resumable；
- Reconciliation Required；
- Non-resumable。

## 12. Compensation

Compensation：

- 是新的 BusinessOperation；
- 引用原 Operation；
- 有独立授权、审批、幂等和结果；
- 不删除或覆盖原事件；
- 失败时仍保留 Outcome 和人工处理入口。

## 13. 验收要求

至少验证：

1. 重复事件不重复推进状态；
2. 乱序事件不会覆盖新 Revision；
3. Event Gap 可补齐；
4. 旧 Fencing Event 被拒绝；
5. Projection 可从空库重建；
6. Snapshot 删除后结果一致；
7. 重建不重新调用 LLM；
8. Tool success 不等于业务 success；
9. 已派发写超时进入 Outcome Unknown；
10. WAITING_APPROVAL 可释放 Runtime；
11. 恢复使用新 Authorization 和 Credential；
12. 人工接管保留原 Actor；
13. Compensation 不改写原 Operation；
14. 一个 AgentInstance 只有一个活动 ExecutionBinding；
15. 多 Attempt 不产生多个当前业务结果。

## 14. 依据

- `reference-evidence-runtime-closure.md`；
- `reference-evidence-dsh-adapter.md`；
- `reference-evidence-final-architecture-domains.md`。

## 15. 非目标

不冻结：

- 具体 Event Store 产品；
- 数据库表和 Partition 数；
- 消息队列产品；
- 状态保留周期；
- UI 状态文案；
- 业务场景专用状态；
- DSH Core 修改。
