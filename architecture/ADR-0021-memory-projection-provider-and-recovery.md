# ADR-0021：记忆 Projection、Provider、缓存与恢复

- 状态：Accepted
- 日期：2026-11-16
- 范围：Keyword/Vector/Graph Projection、Provider Adapter、Rebuild、Delete Propagation、Cache
- 前置决策：ADR-0006、ADR-0011、ADR-0013、ADR-0014、ADR-0018 至 ADR-0020
- 用户决策：2026-11-16 按推荐方案持续推进；确认 PostgreSQL baseline、可重建 Projection 和 Provider 回执加 readback
- 实施原则：本 ADR 不选择 Mem0、OpenViking、Graphiti 或具体向量数据库，不授权安装 DSH Plugin

## A. 决策问题

1. 关键词、向量、图和上下文树是否属于权威；
2. 首期 baseline 和外部 Provider 如何演进；
3. Provider 写入、删除、重建和失败如何对账；
4. Runtime 缓存如何响应 Revision、撤销和授权变化；
5. Provider 替换如何不改变领域与安全语义。

## B. 建议决策

采用 **权威与 Projection 分离、PostgreSQL baseline 优先、外部 Provider 通过稳定 Port 接入、所有 Projection 可从 Authority Snapshot 重建** 的设计。

## C. Projection 原则

- Projection 只保存检索所需的派生内容和权威引用；
- Provider 结果必须绑定 PC Memory/Revision/SourceEvidence；
- Projection 丢失不能导致权威数据丢失；
- Projection 旧数据不能反向恢复成权威事实；
- Projection Release、Authority Snapshot 和 Schema Digest 必须版本化；
- 召回结果始终由 PC 执行授权 post-filter。

## D. 首期 baseline

建议首期只使用：

- PostgreSQL 权威存储；
- 结构化字段查询；
- PostgreSQL 全文检索；
- 可确定性测试的 freshness/conflict/ranking 规则。

理由：先验证领域、授权、修订和删除语义，避免把模型抽取质量和向量召回不确定性混入第一轮架构验收。

此建议不等于最终拒绝向量或图能力。

## E. 稳定 Provider Port

语义能力至少包括：

- `SubmitProjectionChanges`
- `QueryProjection`
- `ApplyProjectionRevocation`
- `ReadbackProjectionState`
- `RebuildProjection`
- `GetProjectionHealth`

请求必须携带 PC 生成的 opaque namespace、Authority Change ID、Revision、Scope Manifest、Idempotency Key 和 Deadline。Provider ID 不能成为 PC 幂等或授权主键。

## F. 同步与对账

```text
Authority Commit
  -> Durable Outbox/Event
  -> Projection Operation
  -> Provider Receipt
  -> Readback
  -> VERIFIED
       or
     UNKNOWN/FAILED -> RecoveryCase
```

- Authority 写入不与外部 Provider 做脆弱的分布式事务；
- Projection 失败不回滚已确认的权威 Revision，但在未同步期间可降低或关闭召回；
- Revoke 在 Authority 层立即阻断读取，不等待 Provider；
- Provider 超时后不得盲目重复非幂等写入；
- 所有重试必须由 Operation ID 和 Idempotency Key 收敛。

## G. 缓存

缓存键至少绑定：

- tenant / principal；
- scope / purpose；
- AuthorizationRevision；
- MemoryRevision 或 AuthorizedViewRevision；
- ProjectionRelease；
- 有效期。

以下事件必须使缓存失效或无法命中：

- Memory Revise/Revoke/Expire；
- Project Membership/Role 变化；
- Source Resource 撤权或版本失效；
- Policy/AuthorizationRevision 变化；
- Projection Release 切换。

## H. 重建

重建流程：

```text
fixed Authority Snapshot
  -> scope manifest
  -> deterministic projection input
  -> provider build
  -> count/digest/sample authorization verification
  -> atomic activation
```

若重建需要模型重新摘要，必须创建新的 Extraction/Projection Release，不能静默改写历史 MemoryRevision。

## I. Provider 引入门

外部 Provider 进入候选前至少通过：

- 对象归属和 direct-get 越权测试；
- 跨用户/项目召回测试；
- 修订、删除和缓存传播测试；
- 重启、断网、重复投递和旧队列重放测试；
- 从固定 Authority Snapshot 重建测试；
- 许可证、供应链、遥测和凭据边界审查；
- Provider 替换后 PC Contract 与审计断言不变。

未通过前，不直接安装官方 DSH memory bundle 到生产 Runtime Profile。

## J. 可观测性

至少观测：

- authority-to-projection lag；
- query latency / recall count / post-filter drop；
- stale AuthorizationRevision rejection；
- revoke propagation age；
- readback failure / RecoveryCase；
- rebuild cursor / digest / activation；
- cache hit 按 Scope/Purpose 的隔离统计，不记录秘密正文。

## K. 否决方案

- 向量库作为唯一 Memory Store：缺少稳定权威与可验证修订；
- Provider 写成功即视为 Authority Commit：供应商故障会改变核心状态；
- 删除请求 accepted 即宣称完成：缺少 readback；
- DSH Plugin 直接全量捕获会话：绕过采集策略和身份权威；
- Provider 切换时从旧 Provider 摘要导入权威：会固化派生错误。

## L. 接受门

- PostgreSQL baseline 优先级得到确认；
- Projection 全部可重建且非权威得到确认；
- Provider 操作需要回执加 readback 得到确认；
- 缓存绑定 Authorization/Revision 得到确认；
- 外部 Provider 和 DSH Plugin 需独立 PoC/任务授权得到确认。

