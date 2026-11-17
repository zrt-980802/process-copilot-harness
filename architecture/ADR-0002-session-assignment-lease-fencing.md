# ADR-0002：Session Assignment、Lease、Fencing 与幂等执行

- 状态：Accepted
- 日期：2026-11-05
- 范围：T1.1 / Runtime-5
- 前置决策：ADR-0001
- 后续议题：Runtime-6 故障恢复

## 1. 背景

在用户作用域 DSH Runtime Pool 中，同一用户可以拥有多个 Runtime；Session 在正常运行时粘性绑定 Runtime，但会因故障、DRAINING 或版本升级迁移。网络分区、Runtime 暂时失联、进程恢复和迟到事件可能导致两个 Runtime 同时认为自己拥有同一 Session，形成脑裂和重复写操作。

本 ADR 定义 Session 执行权的唯一来源、租约、代数、Fencing、幂等和迁移规则。

## 2. 总体决策

Process Copilot 后端持有唯一权威 `SessionAssignment`。任何 Runtime 只有在 Assignment 为 ACTIVE、Lease 有效、Runtime Epoch 匹配且 Fencing Token 当前有效时，才能执行 Session 或提交结果。

```text
Session Assignment
+ Assignment Generation
+ Runtime Epoch
+ Lease
+ Fencing Token
+ Tool Idempotency Key
=
单一合法执行者与可拒绝的旧执行者
```

## 3. 权威对象

```text
SessionAssignment
- assignment_id
- tenant_id
- user_id
- session_id
- runtime_id
- runtime_epoch
- assignment_generation
- fencing_token
- status
- assigned_at
- accepted_at
- last_renewed_at
- lease_expires_at
- revoked_at
- released_at
- expired_at
```

字段是概念要求，不代表数据库类型和表结构已经冻结。

## 4. Assignment Generation

- Session 第一次分配时 generation 初始化；
- 每次重新分配严格递增；
- Runtime 所有命令、事件、状态提交和 Tool 调用都携带 generation；
- generation 小于当前权威记录的消息属于旧分配，必须拒绝修改当前状态；
- generation 是 Session 分配代数，不能由 Runtime Epoch 替代。

## 5. Runtime Epoch

- Runtime 每次创建或重建形成新的 epoch；
- 所有命令和事件携带 runtime_id + runtime_epoch；
- 旧 epoch 的事件不得影响新 Runtime 实例；
- Runtime Epoch 表示 Runtime 实例代数，Assignment Generation 表示 Session 分配代数，二者必须同时校验。

## 6. Session Lease

- Assignment 使用有期限 Lease；
- Runtime 按 Session 续租，允许在一次心跳中批量提交多个 Session 续租请求；
- 后端逐项校验 runtime、epoch、generation、fencing token、用户归属和 Assignment 状态后批准续租；
- Lease 时长可配置，由网络、事件循环延迟和恢复目标测试确定；
- Runtime 失联后必须等待旧 Lease 过期，或有证据证明旧执行者已终止，才能进行故障重新分配；
- Runtime 整体心跳不能无条件延长其所有 Session Lease。

## 7. Fencing Token

- 每次新 Assignment 生成严格递增的 Fencing Token；
- 所有 Session 状态写入、关键 SessionEvent、Tool Result 和企业写操作携带 Fencing Token；
- 接收边界保存或可查询当前有效 token；
- token 小于当前值的请求必须拒绝；
- Lease 决定何时可以重新分配，Fencing Token 阻止旧执行者在重新分配后继续写入。

## 8. Assignment 生命周期

```text
PENDING
→ ACTIVE
→ REVOKING
→ RELEASED
```

异常或超时分支：

```text
PENDING → REJECTED
ACTIVE / REVOKING → EXPIRED
```

含义：

- `PENDING`：后端已提出分配，Runtime 尚未确认；
- `ACTIVE`：Runtime 已接受并持有有效 Lease；
- `REVOKING`：停止接收该 Session 新工作，等待安全释放；
- `RELEASED`：Runtime 正常释放执行权；
- `EXPIRED`：Lease 已过期；
- `REJECTED`：Runtime 因状态、容量或兼容性拒绝 Assignment。

## 9. 两阶段分配

1. 后端创建 PENDING Assignment；
2. Runtime 校验自身 ID/Epoch、用户归属、Profile/Capability、容量和状态；
3. Runtime 返回 Accepted 或 Rejected；
4. 后端只有收到合法 Accepted 后才把 Assignment 置为 ACTIVE；
5. PENDING 不能执行 Session Tool 或企业写操作。

## 10. 正常迁移

```text
旧 Assignment → REVOKING
→ 旧 Runtime 停止接受新工作
→ 等待安全点
→ 持久化状态
→ RELEASED
→ generation 与 fencing token 递增
→ 新 PENDING Assignment
→ 新 Runtime 接受
→ ACTIVE
```

安全点至少要求：

- 无活动 Step；
- 无 Tool in-flight；
- 无流式输出；
- 必要状态已持久化。

## 11. 故障迁移

旧 Runtime 为 LOST、无法正常 RELEASE 时：

1. 停止对旧 Assignment 续租；
2. 等待 Lease 过期，除非已可靠证明旧 Runtime 终止；
3. 旧 Assignment 标记 EXPIRED；
4. 重新鉴权；
5. generation 与 fencing token 递增；
6. 创建新 Assignment；
7. 新 Runtime 恢复 Session；
8. 旧 Runtime 恢复后，旧 token、generation 或 epoch 的写入全部拒绝。

## 12. Session 粘性

Session 正常运行期间不得任意迁移。只允许因以下原因在安全点重新分配：

- Runtime 故障；
- Runtime DRAINING；
- Runtime/Profile 版本升级。

容量均衡不得随意迁移正在运行的 Session。

## 13. Tool 幂等

Fencing 防止旧执行者写入；幂等键防止当前合法执行者因重试重复写入。企业写 Tool 至少使用：

```text
idempotency_key
= tenant_id
+ user_id
+ session_id
+ assignment_generation
+ tool_call_id
```

同一 Tool Call 重试使用相同幂等键。MCP Gateway 或最终业务系统应返回已有结果，不重复执行。

## 14. 写入边界

Fencing Token 必须在最后受控写入边界校验。Runtime 不得持有可以绕过受控网关直接执行企业写操作的长期凭据。

推荐路径：

```text
DSH Runtime
→ MCP / Tool Gateway
→ 校验用户、Assignment、Lease、Fencing、权限、审批、幂等键
→ EE Claw / 外部系统
```

如果外部系统暂不支持 Fencing，由受控 Gateway 负责校验并成为唯一写入口。

## 15. 迟到事件

迟到或旧 Assignment 事件：

- 不得修改当前 Session 状态；
- 记录为 stale event；
- 保留原始信息供审计；
- 必要时向旧 Runtime 发送停止指令；
- 不能静默当作当前事件处理。

## 16. 实现约束

1. 后端是 SessionAssignment 唯一权威来源；
2. Runtime 不得自行续租成功，只能请求后端批准；
3. 所有 Runtime 命令和事件携带 runtime_id、runtime_epoch、session_id、generation、fencing token、trace_id；
4. PENDING、EXPIRED、REVOKING Assignment 不得启动新 Agent Step 或企业写 Tool；
5. 写 Tool 同时验证 Fencing 和幂等键；
6. Runtime 整体心跳不能替代每个 Session 的 Lease 校验；
7. Session 迁移必须产生新 generation 和更大的 fencing token；
8. 旧 epoch、旧 generation 和旧 token 的事件不可更新当前投影；
9. Assignment 决策和状态变化必须审计。

## 17. 验收要求

至少验证：

- 同一 Session 同一时刻只有一个 ACTIVE Assignment；
- Runtime A 失联后，在 Lease 未过期前不会分配给 B；
- B 获得更高 token 后，A 的迟到写入被拒绝；
- Runtime 重建后旧 epoch 事件被拒绝；
- PENDING Assignment 不能执行写 Tool；
- Runtime 可批量申请 Session Lease，但后端逐项批准；
- 同一合法 Tool Call 重试不会重复写入；
- 正常迁移遵循 REVOKE/RELEASE，再建立新 Assignment；
- 故障迁移进行重新鉴权和未完成 Tool 核查；
- stale event 被保留审计但不污染当前状态。

## 18. 未决项

- Lease、心跳和失联阈值的具体值；
- Fencing Token 的持久化和分配机制；
- EE Claw/MCP Gateway 当前是否支持幂等和 Fencing；
- Runtime-6 中未完成 LLM 流、Tool、文件和外部操作的恢复分类。
