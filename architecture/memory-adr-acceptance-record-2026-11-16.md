# Process Copilot 长期记忆 ADR 集中接受记录

- 日期：2026-11-16
- 状态：Accepted architecture baseline
- 范围：ADR-0018 至 ADR-0023
- 用户决定：按照推荐方案持续推进，不再逐项重复确认
- 实施边界：本记录不授权代码、Schema、Provider、生产数据、部署、提交或推送

## 1. 接受结论

ADR-0018 至 ADR-0022 从 `Proposed` 转为 `Accepted`；随后在 DSH 无侵入审查中发现持久 Session 残留风险，并按同一“采用推荐方案持续推进”的用户决策接受 ADR-0023：

| ADR | 接受的核心决策 |
| --- | --- |
| ADR-0018 | PC Backend 持有 Memory Authority；Conversation/Resource/Profile/Memory/DigitalImpression/Delegation 分域；DSH 和 Provider 非权威 |
| ADR-0019 | Stable Object + Immutable Revision + SourceEvidence + 双时间；自动抽取只生成 Candidate；删除需要传播 readback |
| ADR-0020 | 每次查询按 Principal/Scope/Purpose 动态判权；来源访问权重验；Memory 作为类型化不可信 Context，不产生 Tool 权限 |
| ADR-0021 | PostgreSQL baseline 优先；关键词/向量/图均为可重建 Projection；Provider 通过 Adapter、回执和 readback 接入 |
| ADR-0022 | Memory、DigitalImpression、Delegation 三域分离；代表权仅来自本人明确 Grant；逐次决策；L4 默认排除 |
| ADR-0023 | 所有 Runtime Memory Context 建立暴露记录；Revision 失效后旧 DSH Session fail closed，并以新 Session 无重放轮换 |

## 2. 与既有 ADR 的一致性

### ADR-0005：Workspace Resource

Memory 只引用 ResourceVersion，不复制并替代 Resource Authority；一致。

### ADR-0006：DSH Adapter / Runtime Bridge

Memory Context 通过外部 Adapter 注入，不修改 DSH Core；一致。

### ADR-0007：MCP Principal Delegation

MCP 技术调用委托继续表达“谁调用企业能力”，不被重新解释为“谁可以代表员工发言”；一致。

### ADR-0009：Expert Profile

Profile 负责 Agent 装配和能力策略，不持有员工事实或员工代表权；一致。

### ADR-0010 / ADR-0015：Identity、Authorization、Role

Memory 不成为身份或授权权威；管理员角色不产生 Personal Memory 内容旁路；一致。

### ADR-0011：Event、Projection、Recovery

Memory Authority 与可重建 Projection 分离，失败进入 RecoveryCase；一致。

### ADR-0012：Approval、Audit、Sandbox

Memory 写入、使用、撤销有审计，Memory 作为不可信数据不能覆盖 Policy 或触发 Tool；一致。

### ADR-0013 / ADR-0014：部署、可观测性、测试

Projection lag、撤销传播、缓存和重建均纳入可观测性与隔离测试；一致。

## 3. 已冻结的不变量

1. 知识不能产生权限。
2. Conversation/Event 是来源，不是长期记忆权威。
3. Memory Authority 不属于 DSH、Plugin 或外部框架。
4. 自动抽取不直接生成员工确认事实。
5. Memory 内容不能成为系统指令、Tool 调用或 Capability 扩权依据。
6. 撤销在 Authority 层立即生效，Projection 完成需 readback。
7. Provider 可以替换，PC 的对象、授权、审计和删除语义不能变化。
8. DigitalImpression 不等于 Delegation。
9. 员工代表权只能来自本人明确、有限、可撤销授权。
10. Accepted ADR 不等于实施授权。
11. 撤销后的持久 DSH Session 不得继续使用；首期安全优先于模型上下文连续性。

## 4. 留给下一阶段的设计项

以下内容没有被 ADR 提前拍死，需要在 Contract/Threat Model 阶段继续：

- MemoryObject、Revision、Evidence、AuthorizedView 的精确字段和 Contract；
- API 路径、错误码、幂等键和分页语义；
- 数据保留、Legal Hold、备份物理到期和离职处理；
- Candidate Extractor 的模型、策略和敏感信息分类；
- Personal/Project/System Memory 的正式发布 Policy；
- PostgreSQL FTS 的 baseline 指标；
- Mem0/OpenViking/Graphiti 的 Adopt/Adapt/Reject 结论；
- Context token budget、排序和冲突交互；
- DigitalImpression 与 Delegation 的产品试点和组织治理。

## 5. 下一阶段顺序

```text
Accepted ADR baseline
  -> Memory Contract Catalog
  -> Threat Model and isolation matrix
  -> Evaluation dataset and baseline protocol
  -> DSH non-invasive implementation review
  -> implementation task design
  -> separate development authorization
```

在 Contract、Threat Model 和评测基线完成前，不进入 MEMORY-01A 编码。

