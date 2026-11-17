# ADR-0023：记忆上下文暴露记录与 DSH Session 轮换

- 状态：Accepted
- 日期：2026-11-16
- 范围：Runtime Memory Context、DSH Session Persistence、Revoke/Supersede/Source Access Loss
- 前置决策：ADR-0002、ADR-0003、ADR-0004、ADR-0006、ADR-0011、ADR-0018 至 ADR-0021
- 用户决策：2026-11-16 授权按推荐方案持续推进；采用 fail-closed Session 失效/轮换方案
- 实施原则：本 ADR 冻结撤销安全语义；不授权编码、自动重放、DSH Core 修改或部署

## A. 问题

Memory Authority 标记 `REVOKED/SUPERSEDED`、Projection 和缓存完成清除后，已注入旧 Memory 的 DSH 持久 Session 仍可能保留：

- 渲染后的 Memory Context；
- 基于该 Memory 生成的 Assistant Response；
- 后续模型可继续引用的 Session 历史。

仅停止新 Memory 查询不能清除已经进入模型 Session 的内容。若继续 Resume 旧 Session，就不能满足“撤销后不再使用”的安全承诺。

## B. 决策

采用 **Context Exposure Record + Session Contamination State + Fail-closed Rotation**：

1. 每次 C52 进入 Runtime 前写入暴露记录；
2. 暴露记录绑定 Memory Revision、AuthorizedView、PC Session、DSH Session、Turn 和 Context Digest；
3. Memory Revise/Supersede/Revoke/Expire 或 Source Access Loss 时反查受影响 Session；
4. 将相关 PC Assignment 标记为 `MEMORY_CONTEXT_STALE`；
5. 旧 DSH Session 禁止 `START_TURN` 和 `RESUME_SESSION`；
6. 执行现有 Session revoke/flush/release/fencing 收口；
7. 同一 PC Conversation 后续 Turn 使用新的 Assignment Generation 和新 DSH Session；
8. 首期不自动重放旧 DSH Session 历史；PC UI 的会话记录仍保留为产品历史。

## C. 权威边界

- PC Conversation 是用户可见会话历史权威；
- DSH Session 是可丢弃、可轮换的执行状态，不是产品会话权威；
- Memory Authority 决定 Revision 是否仍可使用；
- Exposure Record 决定哪些 Runtime Session 必须失效；
- DSH 自身 Session 日志不能宣告 Memory 已撤销。

## D. 暴露语义

只要 Memory Revision 被放入 C52 并派发给 Runtime，就按“可能影响模型”处理，不依赖模型是否在最终答案中显式引用。

原因：

- 无法可靠证明模型没有内部使用某条 Context；
- `answer_reference_status=NOT_USED` 只能表示未检测到引用，不是无影响证明；
- 保守暴露语义可避免选择性追踪遗漏。

## E. Session 状态

在现有 Assignment 状态之外增加 Memory Context 状态：

```text
CLEAN
EXPOSED
MEMORY_CONTEXT_STALE
ROTATING
ROTATED
```

状态要求：

- `CLEAN/EXPOSED` 且所有 Revision 仍有效时可继续；
- `MEMORY_CONTEXT_STALE` 立即拒绝新 Turn 和 Resume；
- `ROTATING` 执行旧 Session 收口和新 Assignment 创建；
- `ROTATED` 表示新 Session 已可用，旧 Session 永久 fenced。

Memory 状态和 Assignment 主状态保持分离，避免把业务撤销误写成 Runtime 故障。

## F. 触发条件

以下任一事件触发暴露反查：

- Memory Revision `SUPERSEDED`；
- Memory Object `REVOKED/EXPIRED`；
- SourceEvidence 当前访问权丢失；
- Owner/Project Membership/AuthorizationRevision 变化使旧 View 无效；
- Sensitivity/Scope 调整；
- Policy 明确要求清除已暴露 Context；
- 检测到 Memory Poisoning 或错误发布。

普通无关 Memory 更新不轮换未暴露该 Revision 的 Session。

## G. 首期连续性取舍

首期选择安全优先：

- PC 页面仍展示原对话；
- 新 DSH Session 不自动 replay 旧 Assistant Response；
- 当前 Turn 可携带仍授权的 Resource、当前用户问题和新 AuthorizedMemoryView；
- 必要时提示“运行上下文已刷新”，但不暴露安全细节；
- 不为追求无缝连续性而把可能受撤销 Memory 影响的摘要带入新 Session。

代价是撤销后的首个 Turn 可能失去部分模型上下文连续性。这是首期可接受的安全代价。

## H. 未来 Sanitized Rebuild

未来可以设计选择性重建，但必须另行满足：

- 由 PC Conversation Authority 重建，而非复制 DSH 日志；
- 去除 C52 Memory Block；
- 标记并排除所有受撤销 Revision 影响的 Assistant Turns；
- 摘要器不能重新引入被撤销内容；
- 重建 Manifest、Digest 和安全测试完整；
- 用户能够理解连续性变化。

在这些条件完成前，禁止自动 replay/summarize 受污染 Session。

## I. 与现有 Runtime 机制的关系

复用：

- Assignment Generation、Fencing Token；
- `REVOKE_SESSION`、flush、release；
- Runtime Session resume guard；
- Durable Event、RecoveryCase；
- PC Conversation Projection。

新增能力位于 PC Runtime Host/Adapter 和 Memory Control Plane，不需要修改 DSH Core。

## J. 失败与恢复

- Authority Revoke 不等待 Session rotation 完成；旧 Session 先被逻辑拒绝；
- 旧 Runtime 离线时写入持久 invalidation/fencing 状态，恢复后不得先 Resume；
- release/cleanup 失败进入 RecoveryCase，但不恢复旧 Session 使用权；
- 新 Session 创建失败时返回可重试错误，不回退旧 Session；
- 重复 invalidation/rotation 命令必须幂等。

## K. 验收门

- 每个 C52 派发均存在 Exposure Record；
- Revision 失效可反查全部暴露 Session；
- `MEMORY_CONTEXT_STALE` 的 START/RESUME 均 fail closed；
- Runtime 离线、重启、重复事件和恢复后旧 Session 仍不可用；
- 新 Session 使用新 Generation/Fencing；
- PC UI 历史保留但未自动 replay；
- DSH Core diff 为 0；
- 删除后通过旧 DSH Session 召回被撤销内容为 0。

