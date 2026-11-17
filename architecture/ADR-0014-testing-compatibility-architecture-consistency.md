# ADR-0014：测试、版本兼容与架构一致性治理

- 状态：Accepted
- 日期：2026-11-09
- 范围：T11.1 至 T11.8
- 前置决策：ADR-0001 至 ADR-0013
- 用户授权：接受本批全部推荐方案作为第一版
- 实施原则：架构、契约、代码、配置、测试和证据必须可追溯

## 1. 决策摘要

采用：

```text
ADR authority
+ versioned contracts
+ traceability manifest
+ compatibility matrix
+ deterministic fixtures
+ security/isolation matrix
+ architecture consistency checks
+ evidence-gated references
+ explicit superseding ADR
```

核心结论：

1. ADR 是技术约束权威，活文档是浏览和讨论视图；
2. 实现任务书必须引用 ADR 和 Engineering Decision；
3. API、Event、Schema、Profile、Tool、Plugin、Connector 和 Policy 都版本化；
4. 每次发布生成 Compatibility Matrix；
5. 关键恢复路径使用固定 Fixture 和 Replay；
6. 安全边界使用负向矩阵测试；
7. 架构一致性通过机器可读 Manifest 检查；
8. 参考仓库达到 R2 才能进入设计依据；
9. 架构变化新增 Superseding ADR，不静默改写已接受历史；
10. 现有 Demo 不形成目标实现兼容义务；
11. 全量 ADR 后执行 DSH 无侵入实现审查；
12. 未通过门禁的实现不能标记架构完成。

## 2. 文档权威层次

```text
Accepted ADR
→ Engineering Decisions / Contracts
→ Implementation Task
→ Code / Schema / Config
→ Tests / Evidence
→ Living Spec projection
```

冲突时：

1. 新的 Superseding ADR；
2. 当前 Accepted ADR；
3. 版本化 Contract；
4. 实现任务书；
5. 活文档摘要；
6. Demo 行为。

## 3. Traceability Manifest

每个实施单元维护：

```text
decision_ids
engineering_decision_ids
module_owner
contract_refs
schema_refs
config_release_refs
test_refs
evidence_refs
known_deviations
supersedes
```

发布时检查：

- ADR 引用存在；
- Contract 版本存在；
- 关键测试存在；
- Deviation 有批准；
- 旧决策替代关系完整。

## 4. 版本轴

独立版本：

- PC Public API；
- Internal Service Contract；
- Event Envelope；
- Domain Event；
- DSH Adapter API；
- Bridge Protocol；
- DSH Runtime；
- Runtime Profile；
- Tool/Plugin Release；
- Expert Profile Release；
- Connector Definition/Registration；
- Resource Schema；
- Authorization Policy Model；
- Audit Schema；
- Projection Schema。

禁止使用一个应用版本号代替全部兼容关系。

## 5. Compatibility Matrix

```text
PC release
x Adapter API
x Bridge Protocol
x DSH runtime
x Runtime Profile
x Tool/Plugin releases
x Expert Profile release
x Connector/provider release
x Event/Projection schema
x Policy model
```

矩阵结果：

- SUPPORTED；
- SUPPORTED_WITH_LIMITS；
- MIGRATION_REQUIRED；
- BLOCKED；
- REVOKED。

生产调度只选择 SUPPORTED 或显式允许的 LIMITED 组合。

## 6. Contract 测试

至少覆盖：

- API Request/Response Fixture；
- Event Schema Fixture；
- Adapter Command/Event Fixture；
- Tool Schema/Digest；
- Connector Auth/Capability；
- ApprovalSnapshot；
- AuditEvent；
- ResourceRef；
- Error Taxonomy；
- Idempotency/Fencing。

Provider 和 Consumer 双方都运行同一 Fixture。

## 7. 恢复与 Replay 测试

固定历史：

- Session Event Log；
- Business Domain Events；
- Operation Ledger；
- Projection Snapshot；
- Runtime Failure；
- Outcome Unknown；
- Approval Wait；
- Credential Revocation。

升级后验证：

- 旧历史可读取；
- Projection Digest 一致；
- 非确定性 LLM 不重新调用；
- 未匹配 Action 被发现；
- 旧 Fencing 不复活；
- Unknown Outcome 不盲目重试。

## 8. 安全与隔离矩阵

维度：

```text
tenant A/B
user A/B
project A/B
session A/B
profile A/B
runtime A/B
connector A/B
credential generation old/new
authorization revision old/new
approval snapshot old/new
```

至少验证：

- 跨租户、跨用户、跨项目、跨 Session 拒绝；
- Token/Session/Connection 不串用；
- Tool Catalog 隐藏不替代执行拒绝；
- caller-supplied identity 无效；
- Secret 不出现在日志、文件和 Trace；
- Sandbox/Egress 逃逸拒绝；
- Audit Failure 的 Fail Closed；
- Break-glass 独立记录。

## 9. 并发与故障矩阵

覆盖：

- 双 Scheduler；
- Lease 过期和续租竞态；
- Runtime LOST 与迟到 Event；
- 重复 Tool Result；
- Event Gap/乱序；
- Credential 并发 Refresh；
- Approval 与参数变化竞态；
- Cancel 与外部完成竞态；
- Queue 重投递；
- Projection Rebuild；
- 部分存储不可用。

测试结论不能只依赖 Happy Path。

## 10. 性能与容量门禁

不冻结固定性能数字，但每个 Release 必须记录：

- 测试环境；
- 数据规模；
- 并发模型；
- Queue/Runtime/Tool/Connector 负载；
- p50/p95/p99；
- Error/Timeout；
- Resource Usage；
- Saturation Point；
- Recovery Behavior。

容量结论必须可重复，不使用单次手工观感。

## 11. Evidence Gate

参考级别：

- R0：名称或宣传；
- R1：文档/界面观察；
- R2：源码路径和调用链；
- R3：代表性测试或运行验证；
- R4：规范、标准或权威互操作验证。

采用结论：

- adopt；
- adapt；
- compare_only；
- reject。

ADR 中的依据必须包含：

- repository；
- commit/tag；
- license；
- checked paths；
- confirmed behavior；
- non-transferable limits；
- adoption decision。

## 12. Architecture Consistency Check

检查输入：

- `architecture/README.md`；
- ADR 文件；
- Living Spec；
- Technical Open List；
- Discussion List；
- Reference Governance；
- Contract Registry；
- Traceability Manifest；
- Release Manifest。

检查规则：

- ADR 编号和索引一致；
- Accepted ADR 不存在未标注覆盖；
- Open List 状态与 ADR 一致；
- Living Spec 最新版本包含决策；
- Reference ID 可解析；
- 文件路径存在；
- Release 引用精确版本；
- 禁止 Demo Migration 约束回流；
- 未授权的 DSH Core 修改被标记。

## 13. 架构偏差

实现无法满足 ADR 时：

```text
Deviation Request
- affected ADR
- reason/evidence
- scope
- risk
- temporary controls
- expiry
- owner
- resolution plan
```

偏差：

- 不自动修改 ADR；
- 有期限；
- 进入审计；
- 发布说明可见；
- 到期后阻止继续发布或转为新 ADR。

## 14. ADR 演进

新需求变化：

1. 创建新 Proposed ADR；
2. 标明 `Supersedes`；
3. 保留旧 ADR；
4. 更新 Compatibility Matrix；
5. 定义迁移和回滚；
6. 更新测试 Fixture；
7. 更新 Living Spec 新版本。

禁止直接覆盖历史 Accepted 结论。

## 15. 发布门禁

第一版实现发布至少需要：

- 适用 ADR 清单；
- Contract Fixture 通过；
- Security/Isolation Matrix 通过；
- Migration/Replay 通过；
- Compatibility Matrix；
- Evidence/Traceability Manifest；
- Known Deviation 清单；
- Rollback Plan；
- Observability/Audit 验证；
- DSH 修改审查结果。

## 16. DSH 无侵入实现审查

全部技术 ADR 完成后，对每项所需行为按顺序评估：

```text
1. Runtime Profile / Bundle
2. PC Adapter / Gateway
3. DSH Plugin
4. Capability Seam 外部实现
5. Tool / MCP
6. 独立持久服务
7. Runtime 包装层
8. 最后才是 DSH Core 修改
```

每项记录：

- 所属 ADR；
- 当前 DSH 事实；
- 无侵入候选；
- 缺口；
- 必要性证据；
- 维护/升级成本；
- adopt/adapt/fork/upstream 建议。

## 17. 验收要求

至少验证：

1. 所有 Accepted ADR 出现在索引；
2. Open List 状态与 ADR 一致；
3. Living Spec 最新版本包含全部第一版决策；
4. 每个实施任务可追溯到 ADR；
5. Event/API/Adapter Fixture 双方通过；
6. 旧历史升级后可重建；
7. 跨租户/用户/项目负向矩阵通过；
8. 兼容矩阵阻止不支持组合；
9. Evidence ID 和 Commit 可解析；
10. Deviation 到期会阻止发布；
11. Superseding ADR 不删除旧 ADR；
12. Demo 结构不进入目标兼容要求；
13. DSH 修改必须经过无侵入审查；
14. 架构检查可在 CI 重复运行。

## 18. 依据

- `process-copilot-reference-repository-governance.md`；
- `architecture/ARCHITECTURE-WORKING-METHOD.md`；
- ADR-0001 至 ADR-0013；
- `reference-evidence-final-architecture-domains.md`。

## 19. 非目标

不冻结：

- CI 产品；
- 测试框架；
- 性能目标数值；
- 发布平台；
- 代码目录结构；
- Demo 迁移；
- DSH 修改结论。
