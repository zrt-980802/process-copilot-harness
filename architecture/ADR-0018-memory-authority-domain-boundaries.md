# ADR-0018：长期记忆权威与领域边界

- 状态：Accepted
- 日期：2026-11-16
- 范围：Personal Memory、Project/System Memory 预留、Runtime Context
- 前置决策：ADR-0005、ADR-0006、ADR-0009、ADR-0010、ADR-0011、ADR-0012
- 用户决策：2026-11-16 按推荐方案持续推进；确认 PC Memory Authority、领域分离和 DSH/Provider 非权威边界
- 实施原则：本 ADR 只提出架构决策；不授权编码、Schema 变更、Provider 引入、历史数据导入或部署

## A. 决策问题

1. 长期记忆的权威属于哪个系统；
2. 长期记忆与聊天记录、Session Recovery、Profile、Workspace 和 Resource 的边界；
3. Personal、Project、System Memory 是否共用权威模型；
4. DSH Runtime、Plugin 和外部记忆框架承担什么责任；
5. DigitalImpression 和 Delegation 是否属于 Memory Domain。

## B. 建议决策

采用 **PC Memory Control Plane 作为唯一 Memory Authority，Runtime 只消费短期授权视图，Projection/Provider 可替换** 的架构。

```text
Source Authorities
  Conversation / ResourceVersion / Business Event / Tool Result
                             |
                             v
                    PC Memory Authority
            Object / Revision / Evidence / Scope / State
                 |                         |
                 v                         v
       Rebuildable Projection       Governance / Audit
                 |
                 v
         AuthorizedMemoryView
                 |
                 v
       Runtime Memory Context
```

## C. 领域边界

### C1. Memory Domain 持有

- `MemoryObject` 稳定身份；
- 不可变 `MemoryRevision`；
- `SourceEvidence`；
- Scope、Sensitivity、Valid Time 和 Lifecycle State；
- 纠正、Supersession、撤销、过期和删除传播状态；
- AuthorizedMemoryView 的查询策略和使用审计。

### C2. Conversation Domain 持有

- 原始消息和对话顺序；
- Turn、模型响应和会话显示；
- 消息级访问控制和保留策略。

Conversation 是 Memory 的证据来源之一，不因被提炼为记忆而失去自己的权威边界。

### C3. Resource / Workspace Domain 持有

- Resource、ResourceVersion、WorkspaceViewSnapshot；
- 文件、材料、业务对象和版本内容；
- Materialization 与来源追踪。

Memory 只保存稳定引用和必要摘要，不复制大对象并冒充 Resource Authority。

### C4. Profile Domain 持有

- Agent 的职责、能力、Prompt Policy、Tool/Plugin 装配和版本。

Profile 不是员工记忆，也不持有员工代表权。Profile 可以声明“是否允许消费 Memory Context”，但不能决定某条 Memory 的授权。

### C5. DigitalImpression 与 Delegation

两者均为独立领域：

- DigitalImpression 是经员工控制的派生数据产品；
- Delegation 是明确授权和逐次决策系统；
- Memory 只能提供证据，不能生成代表权。

## D. Memory 分类

共享一个权威骨架，但使用不同发布门：

| 分类 | Owner | 发布门 | 首期状态 |
| --- | --- | --- | --- |
| Personal Memory | 员工本人 | 本人明确保存或确认 Candidate | 进入首期设计 |
| Project Memory | 项目 | Project Owner/Policy 审批 | 仅预留 |
| System/Runbook Memory | 组织/系统 Owner | 证据聚合与发布审批 | 仅预留 |

共享模型不表示共享内容或共享授权。Personal Memory 默认禁止跨用户读取。

## E. DSH 与 Runtime 边界

DSH/Runtime 可以：

- 接收当前 Turn 的 `AuthorizedMemoryView`；
- 使用受控 Memory Context 参与生成；
- 上报候选来源事件和使用事件；
- 持有可丢失、短期、受 Revision 约束的缓存。

DSH/Runtime 不可以：

- 成为 MemoryObject/Revision 权威；
- 自由选择 tenant/user/project scope；
- 直接持有 Provider 管理凭据；
- 把本地摘要升级为确认事实；
- 从 Memory 推断 Tool/MCP 权限或 Delegation；
- 因接入记忆而修改 DSH Core。

## F. 外部框架边界

Mem0、OpenViking、Graphiti、向量库或图数据库只能作为：

- Candidate Extractor；
- Keyword/Vector/Graph Projection；
- Context ranking 或 compression Provider；
- 隔离 PoC 中的可替换实现。

Provider 自身 ID、ACL、History、Diff、Delete Receipt 和 Memory 状态均不是 PC 权威事实。

## G. 选择理由

1. 与 ADR-0005 的 ResourceVersion 和可控 Materialization 一致；
2. 与 ADR-0006 的 Adapter/Bridge 边界一致，不侵入 DSH；
3. 与 ADR-0010 的 Identity/Authorization Authority 一致；
4. 与 ADR-0011 的权威状态、可重建 Projection 和 RecoveryCase 一致；
5. 防止外部框架默认 ACL、跨 Workspace 召回或删除语义反向定义企业权限；
6. 为后续 Provider 替换、员工纠错和数字代理治理保留稳定边界。

## H. 否决方案

### H1. 把全部聊天历史作为 Memory

否决。成本、隐私、时效性和 Prompt 注入风险不可控，且无法表达确认、修订与撤销。

### H2. 让 DSH Plugin 成为长期权威

否决。Runtime 生命周期、身份边界和企业审计责任不适合承担长期权威。

### H3. 直接使用 Mem0/OpenViking 数据模型作为 PC Schema

否决。会把 Provider 的对象归属、ACL、删除和版本语义泄漏进核心领域。

### H4. 把 Memory 合并进 Profile

否决。Profile 是 Agent 装配策略，Memory 是用户/项目事实，两者 Owner、生命周期和授权完全不同。

## I. 后果

正面：

- 权威清晰，可逐次判权、审计、纠错和删除；
- DSH Core 保持无侵入；
- 可从 PostgreSQL baseline 演进到外部 Provider；
- 数字印象和委托不会污染个人记忆模型。

成本：

- 需要独立 Memory Domain、Adapter 和 Projection 同步机制；
- Provider 功能不能直接暴露给前端或 Runtime；
- 必须为来源访问权变化建立重新判权路径。

## J. 接受门

- 五个领域的 Owner 和禁止转换规则得到确认；
- Personal/Project/System Memory 共享骨架但授权隔离得到确认；
- DSH/Provider 非权威边界得到确认；
- 与 ADR-0005/0006/0010/0011/0012 无冲突。

