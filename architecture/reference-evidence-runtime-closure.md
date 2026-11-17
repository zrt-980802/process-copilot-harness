# Runtime 收尾批次参考仓库证据卡

- 状态：Accepted Evidence
- 日期：2026-11-06
- 关联决策：ADR-0003、ADR-0004

## REF-RUNTIME-001：DSH Session 恢复与 Teardown

```text
reference_id: REF-RUNTIME-001
product_tree_node: T8 运行状态、持久化与恢复 / T10 部署与健康
problem_statement: DSH 实际提供哪些 Session 恢复、持久屏障和资源回收机制？
candidate_repository: 本机 DSH
baseline_branch_tag_commit: dsh-v0.2.1-rc.3 / 1f81c047fc48fa190a683e469daa699857e9afe8
evidence_level: R2-R3
adoption_decision: adapt
reviewed_at: 2026-11-06
```

已检查：

- `packages/core/session/src/index.ts`
- `packages/core/session/src/types.ts`
- `packages/core/session/src/repair.ts`
- `packages/core/agent-loop/src/index.ts`

确认：

- Session 是内存 append-only log；
- 持久化由插件订阅 `session/event`；
- `Session.append()` 不等于 durable；
- `session/flush()` 是 awaited durability barrier；
- `resumeWith()` 先取得持久层 Write Handle，再读取日志和修复开放 Turn/Tool；
- teardown 会 cancel、wait idle、dispose scope、close durable handle、退出 Registry，并聚合失败。

采用范围：

- Session 恢复语义；
- Tool Call 无结果时的显式修复；
- Flush 作为稳定恢复边界；
- 可撤销资源生命周期与失败聚合。

不可外推：

- 同进程 Write Handle 不等于跨 Runtime Lease/Fencing；
- DSH 不提供用户作用域 Runtime Pool Registry；
- DSH 不恢复外部命令、浏览器或任意 MCP 调用；
- DSH 不替代 PC Recovery Coordinator。

## REF-RUNTIME-002：Temporal SDK Go

```text
reference_id: REF-RUNTIME-002
product_tree_node: T8 运行状态、持久化与恢复
problem_statement: 如何借鉴持久历史、重试、取消、Heartbeat 和长任务外置？
candidate_repository: temporalio/sdk-go
baseline_branch_tag_commit: 72dabe87bba70ab346a4688c13b974dc181aa892
license: MIT
evidence_level: R3
adoption_decision: adapt
reviewed_at: 2026-11-06
```

已检查：

- `internal/internal_task_handlers.go`
- `internal/internal_worker.go`
- `internal/internal_command_state_machine.go`
- `activity/activity.go`
- `test/replaytests/replay_test.go`

可借鉴：

- 从持久历史重建内存，缓存只作优化；
- replay fixture 检测升级不兼容；
- Activity Heartbeat 保存可重算进度；
- Retry / Cancellation / Async Completion；
- 长任务以稳定 ID 外置。

不可照搬：

- LLM 不能在确定性 replay 中隐式重调；
- Heartbeat 不是强提交证明；
- Retry 不等于 exactly-once；
- Cancel 是请求，不是完成事实；
- Outcome Unknown 仍需 PC Operation Ledger 和 Reconciliation。

## REF-RUNTIME-003：OpenHands software-agent-sdk

```text
reference_id: REF-RUNTIME-003
product_tree_node: T8 恢复 / T10 Runtime 生命周期
problem_statement: 持久 Conversation 如何与可替换 Runtime 分离，并处理未匹配 Action 和断线重连？
candidate_repository: OpenHands/software-agent-sdk
baseline_branch_tag_commit: 295b3baf71dfac1be028c5b187134ec3eb495346
license: MIT
evidence_level: R2
adoption_decision: compare_only / adapt
reviewed_at: 2026-11-06
```

已检查：

- `openhands/sdk/conversation/state.py`
- `openhands/sdk/agent/base.py`
- `openhands/sdk/conversation/impl/local_conversation.py`
- `openhands/sdk/conversation/impl/remote_conversation.py`
- `openhands/sdk/event/resume_transcript.py`

可借鉴：

- Base State + Event Log 恢复；
- 恢复时校验工具兼容；
- 未匹配 Action 检测；
- WebSocket 重连后 REST/Event Reconciliation；
- 幂等 Close 和资源所有者明确；
- 持久 Conversation 与 Runtime/Sandbox 生命周期分离。

不可照搬：

- 多 Conversation 共享 Sandbox 不符合 PC 用户作用域 Runtime 约束；
- Transcript Bootstrap 是降级恢复，不是精确恢复；
- 不采用浏览器直达 Runtime 的 Session Key 作为企业写入口。

## REF-RUNTIME-004：OpenHands 前端

```text
reference_id: REF-RUNTIME-004
product_tree_node: T10 Runtime Registry 与健康
problem_statement: 前端如何发现 Runtime、查询 Sandbox Registry 并判断可用性？
candidate_repository: OpenHands/OpenHands
baseline_branch_tag_commit: 149865db71e172c928e2a1fce2c37e9132bc1e02
evidence_level: R1-R2
adoption_decision: compare_only
reviewed_at: 2026-11-06
```

已检查：

- `src/api/runtime-service/agent-server-runtime-service.ts`
- `src/api/cloud/sandbox-service.api.ts`
- `src/hooks/use-runtime-is-ready.ts`

对照结论：

- 可参考 per-conversation Runtime URL、Sandbox Registry 查询和 UI readiness 组合；
- 前端 readiness 不能替代后端权威健康模型；
- 浏览器直达 Runtime 不符合 PC 的受控企业写 Gateway 原则；
- 该仓库不作为 Runtime 生命周期、隔离和恢复的主要依据。

## 证据结论

1. DSH 提供 Session 级恢复与 teardown 基础，不提供 PC 所需的跨 Runtime Control Plane；
2. Temporal 的持久历史与 Activity 模型适合借鉴，但不能把非确定性 LLM 当成可重放 Workflow；
3. OpenHands 证明持久 Conversation 与可替换 Runtime 分离是可行模式，但其安全与共享边界不能照搬；
4. ADR-0003、ADR-0004 中的 Recovery Coordinator、Lease/Fencing、Workspace C 和企业写 Gateway 属于 Process Copilot 自身控制面设计。

