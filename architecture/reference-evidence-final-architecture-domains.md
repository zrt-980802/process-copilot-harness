# 最终架构域参考证据

- 状态：Accepted Evidence
- 日期：2026-11-09
- 关联决策：ADR-0010 至 ADR-0014
- 说明：本文件复用此前已完成源码核验的证据，不新增未经审计的产品依赖。

## REF-FINAL-001：DSH Session、Event、Approval 与 Teardown

```text
repository: deepseek-ai/deepseek-harness
baseline: dsh-v0.2.1-rc.3
commit: 1f81c047fc48fa190a683e469daa699857e9afe8
evidence_level: R2-R3
decision: adopt / adapt
```

复用证据：

- `reference-evidence-runtime-closure.md` 的 `REF-RUNTIME-001`；
- `reference-evidence-dsh-adapter.md` 的 `REF-ADAPTER-001` 至 `REF-ADAPTER-004`；
- `reference-evidence-tool-plugin-governance.md` 的 `REF-TP-001`。

已确认：

- Session 是内存 append-only log；
- `session/flush()` 是 awaited durability barrier；
- `resumeWith()` 可从持久日志恢复并修复开放 Turn / Tool；
- SessionEvent 可由 Plugin 订阅并导出；
- Approval 是执行期暂停点，不是持久业务审批；
- Agent/Tool Guard 可以做 Runtime 本地门禁；
- teardown 会取消、等待、释放 Scope、关闭持久句柄并聚合失败。

采用：

- 技术事件导出；
- Flush 和恢复边界；
- Approval 暂停桥；
- Guard 和资源生命周期。

不采用：

- 把 DSH Session 当作业务任务真相源；
- 把 DSH Approval 当作企业审批记录；
- 把同进程事件顺序外推为跨服务全局顺序；
- 把 DSH Core 变成租户、身份、审计或部署控制面。

## REF-FINAL-002：Temporal 持久历史、Activity 与 Replay

```text
repository: temporalio/sdk-go
commit: 72dabe87bba70ab346a4688c13b974dc181aa892
license: MIT
evidence_level: R3
decision: adapt
```

复用 `reference-evidence-runtime-closure.md` 的 `REF-RUNTIME-002`。

已确认：

- 内存状态可以从持久历史重建；
- Replay Fixture 可检测升级不兼容；
- Activity Heartbeat 保存可重算进度；
- Retry、Cancellation 和 Async Completion 独立；
- 长任务使用稳定 ID 外置。

采用：

- 事件历史和投影可重建；
- 长任务外置；
- 取消请求与完成事实分离；
- 升级 Replay / Compatibility Fixture。

不采用：

- 在确定性 Replay 中重新执行 LLM；
- 把 Retry 当作 exactly-once；
- 把 Heartbeat 当作业务提交证明；
- 把 Cancel 请求当作外部副作用已停止。

## REF-FINAL-003：OpenHands Conversation、Runtime 与 Workspace

```text
repositories:
  - OpenHands/software-agent-sdk
  - OpenHands/OpenHands
commits:
  - 295b3baf71dfac1be028c5b187134ec3eb495346
  - 149865db71e172c928e2a1fce2c37e9132bc1e02
licenses: MIT / repository-specific
evidence_level: R1-R2
decision: compare_only / adapt
```

复用 `reference-evidence-runtime-closure.md` 的 `REF-RUNTIME-003`、`REF-RUNTIME-004`。

已确认：

- 持久 Conversation 与可替换 Runtime 可以分离；
- 恢复时可检测未匹配 Action；
- WebSocket 重连后需要 REST/Event Reconciliation；
- Runtime URL、Sandbox Registry 和 UI readiness 可分层。

采用：

- Conversation / Task 与 Runtime 生命周期解耦；
- 断线重连后补齐；
- Sandbox/Runtime 发现只作为视图；
- 幂等 Close 和明确资源所有者。

不采用：

- 浏览器直达 Runtime 作为企业写入口；
- 多用户共享 Sandbox；
- Transcript Bootstrap 作为精确恢复；
- 前端 readiness 作为调度权威。

## REF-FINAL-004：IBM ContextForge Gateway 隔离与审计

```text
repository: IBM/mcp-context-forge
commit: fe828977a44646e92e72daaab31d4d344f2a7191
evidence_level: R2-R3
decision: compare_only / adapt
```

复用 `reference-evidence-mcp-multisession-auth.md` 的 `REF-MCP-006`。

已确认：

- Token Scope 与 RBAC 分层；
- Session Token 团队范围从数据库实时解析；
- Revocation 使用 JTI、数据库和缓存失效；
- Token Exchange Cache 包含用户、Audience 和 Subject Token Hash；
- Stateful Session 保存 Owner 并在后续请求校验；
- Token Exchange 有独立 Correlation 和审计。

采用：

- Gateway 每请求授权；
- Session Owner Binding；
- 完整缓存键和 Single-flight；
- 撤权先改变权威状态；
- Token 与审计关联但不记录 Token。

不采用：

- 其 Team/Public/Admin 语义；
- 把 Gateway 当作 PC 业务权限权威；
- 授权服务故障时对敏感写 Fail Open。

## REF-FINAL-005：EE Claw 平台身份与访问审计

```text
repository: E:/shanzi_workspace/feishu-ee-agents
observed_head: 29fb7ec26a02cff28fff7dc86d7c62268b23a498
project_scope_reference_commit: a6076144a2a50f55c1b3d38eca2da97ac0f0d97b
evidence_level: R3 / R2
decision: adopt facts / adapt boundaries
```

复用 `reference-evidence-identity-authorization-external-registration.md` 的 EE Claw 证据。

已确认：

- 平台账号、密码哈希、Cookie Session、CSRF/Origin；
- Role、Page/Action Permission；
- 账号停用、会话撤销和访问审计；
- 项目范围分支包含 Grant、Revision 和 Fail Closed；
- 当前仍存在 caller-supplied `open_id` 风险；
- 飞书应用凭据不是每用户委托凭据。

采用：

- 账号和会话事实适配；
- 当前权限实时查询；
- 审计脱敏纪律；
- 项目范围 Revision 和 Fail Closed 方向。

不采用：

- Cookie 或 `open_id` 直接作为 PC/MCP 身份；
- 页面权限替代业务对象权限；
- 把 OTA 分支实现描述成全模块现状。

## REF-FINAL-006：OpenFGA 模型版本与关系检查

```text
repository: openfga/openfga
commit: 4b09dafb027d839e6c42073e6e288f5ea6881d4d
license: Apache-2.0
evidence_level: R2
decision: adapt / compare_only
```

复用 `reference-evidence-expert-profile-technical-model.md` 的 `REF-EP-003`。

采用：

- 授权模型版本固定；
- 持久 Relationship Tuple 与请求 Context 分离；
- Union、Intersection、Difference 和 Condition；
- Higher Consistency 绕过普通缓存；
- 模型版本和关系 Revision 进入决策证据。

不采用：

- 强制首期部署 OpenFGA；
- 把 Policy Engine 决策替代源系统最终权限；
- 把 Contextual Tuple 当作持久业务事实。

## 综合结论

1. PC 业务状态必须由持久事件、Operation Ledger 和投影重建，DSH 只提供技术事件；
2. Approval、Authorization、Execution 和 Verification 必须是四个独立事实；
3. Audit 使用独立可靠存储，不依赖会采样的遥测；
4. Sandbox、Egress、Workspace 和 Credential 使用显式能力边界；
5. 单租户部署也必须携带 `tenant_id` 并满足未来多租户隔离契约；
6. 容量、健康和授权分层，不能用一个状态或一个 `/healthz` 代替；
7. 兼容性必须使用精确版本、契约 Fixture、Replay 和矩阵验证；
8. 参考实现只提供证据，不形成必须采用其产品、数据库或部署方式的约束。
