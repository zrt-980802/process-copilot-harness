# Process Copilot 长期记忆端到端流程与 ADR 决策地图 v1

- 状态：Accepted decision map
- 日期：2026-11-16
- 范围：个人记忆、项目/系统记忆预留、数字印象与数字代理边界
- 目的：先梳理流程和权威，再评审 ADR；本文件不授权开发、Schema 变更、Provider 引入或部署
- 接受记录：2026-11-16，用户确认按推荐方案持续推进；ADR-0018 至 ADR-0023 已接受

## 1. 总体结论

长期记忆不是聊天记录、Session Recovery、Profile、向量库或数字人的别名。目标架构分成五个独立域：

```text
Conversation / Resource / Tool Result / Business Event
                         |
                         v
                 Capture & Evidence
                         |
                         v
                  Memory Authority
       Object / Revision / Scope / Valid Time / State
                         |
             +-----------+-----------+
             |                       |
             v                       v
   Rebuildable Projection     Governance & Audit
 keyword / vector / graph     correction / revoke / use
             |
             v
        Authorized Memory View
             |
             v
     Runtime Context Assembly
             |
             v
      Answer / Refuse / Clarify

Digital Impression ---- separate derived product
Delegation Grant ------- separate authorization domain
```

核心不变量：

1. Conversation/Event 是来源，不是长期记忆权威。
2. Memory Authority 属于 Process Copilot Control Plane。
3. Projection 可删除、可重建、可替换，不能反向成为权威。
4. 每次读取都重新判权，不能复用写入时的旧授权结论。
5. Memory 是不可信数据上下文，不是系统指令或 Tool 授权。
6. Digital Impression 不产生代表权；Delegation 只能来自明确授权。

## 2. 权威分配

| 对象或决策 | 权威 | 非权威参与者 |
| --- | --- | --- |
| 身份、Tenant、项目成员关系 | Identity / Authorization Authority | Memory、Provider、Runtime |
| MemoryObject / MemoryRevision | PC Memory Authority | DSH、Mem0、OpenViking、向量库 |
| SourceEvidence | PC Memory Authority，引用原权威对象 | Extractor、Provider |
| 关键词/向量/图索引 | Projection Provider | PC Authority 可重建 |
| AuthorizedMemoryView | PC Authorization + Memory Query | Runtime 只消费短期视图 |
| Runtime Memory Context | PC Context Assembler | DSH 只接收当前轮上下文 |
| DigitalImpression | 未来独立派生域 | Memory 只提供经授权证据 |
| DelegationGrant / Decision | 未来 Delegation Authority | Memory、Profile、模型均不得推断 |
| Tool / MCP 权限 | 现有 Capability / Membership / Gateway | Memory 不扩权 |

## 3. 流程一：来源进入候选池

```text
Source Event
  -> Capture Policy
  -> Principal / Scope / Purpose 检查
  -> Sensitive Data Filter
  -> Candidate Extractor
  -> SourceEvidence 绑定
  -> Dedup / Conflict Detection
  -> CANDIDATE 或 DROP
```

### 输入

- 用户明确“记住……”的消息；
- 经批准参与记忆提炼的普通对话；
- ResourceVersion、ToolResult 或业务事件的稳定引用；
- 系统记忆候选所需的成功/失败轨迹。

### 规则

- 首期不默认全量录制历史对话。
- 明确保存意图可进入确认流程；自动抽取只能产生 Candidate。
- 密码、密钥、Token、完整工具回执和模型推理不得进入 Memory 内容。
- 外部网页、文档和 Tool 输出不能直接成为“关于员工的确认事实”。
- 没有 SourceEvidence 的候选必须拒绝。

## 4. 流程二：确认与发布

个人记忆与系统记忆使用不同发布门：

```text
Personal explicit save
  -> owner confirmation
  -> CONFIRMED

Automatic personal candidate
  -> owner review
  -> CONFIRMED or REJECTED

Project/System candidate
  -> evidence aggregation
  -> project owner / policy approval
  -> PUBLISHED or REJECTED
```

确认时创建稳定 `MemoryObject` 和不可变 `MemoryRevision`。确认只表示“允许作为记忆保存和使用”，不表示获得新的业务权限。

## 5. 流程三：授权检索与上下文注入

```text
Turn Request
  -> Principal Envelope
  -> Purpose + Project + Conversation Context
  -> Authority pre-filter
  -> Projection recall
  -> Authority post-filter
  -> Source access revalidation
  -> freshness / conflict / token budget ranking
  -> AuthorizedMemoryView
  -> typed Memory Context
  -> Runtime answer
  -> MemoryUsage Audit
```

### Fail-closed 条件

以下任一状态未知时返回空集合或拒绝，不回退到 Provider 默认行为：

- Principal、Tenant 或 Purpose 缺失；
- Memory Owner/Scope 不匹配；
- AuthorizationRevision 过期；
- 来源项目访问权无法重新验证；
- Revision 已过期、撤销或被替代；
- Projection 结果缺少权威对象绑定或 SourceEvidence；
- 删除/纠正传播尚未通过 readback；
- Provider/缓存使用的 Authority Snapshot 已过期。

## 6. 流程四：修订、冲突与时间

```text
New evidence / user correction
  -> compare current Revision
  -> classify duplicate / correction / temporal change / contradiction
  -> create new immutable Revision
  -> supersede old current Revision
  -> emit authority change
  -> update Projection
```

必须同时记录：

- `valid_from / valid_to`：事实在业务世界何时有效；
- `recorded_at`：系统何时得知并记录；
- `supersedes_revision_id`：替代关系；
- 原 Revision 和 SourceEvidence：保留审计，不静默覆盖。

冲突未解决时，不得由召回分数随机选择立场；返回澄清、拒答或明确展示冲突。

## 7. 流程五：撤销、删除与传播

```text
Revoke/Delete request
  -> owner + policy authorization
  -> Authority state = REVOKED
  -> issue AuthorityChange
  -> keyword/vector/graph/cache propagation
  -> per-target receipt
  -> readback verification
  -> COMPLETE or RecoveryCase
```

首期“删除完成”只能在以下路径均不可再召回后成立：

- 按 Memory ID 读取；
- 列表、搜索和相似度召回；
- Runtime 缓存和 Prompt 组装；
- Projection 重建；
- 服务重启与恢复。

审计最小元数据、备份物理到期和 Legal Hold 必须单独定义，不能用 UI 隐藏冒充物理删除。

## 8. 流程六：Projection 重建与 Provider 替换

```text
Authority Snapshot
  -> scope manifest
  -> projection release
  -> rebuild cursor
  -> keyword/vector/graph indexes
  -> digest/readback comparison
  -> activate projection revision
```

- 重建只从权威 Revision 和 SourceEvidence 读取。
- 不从 Provider 旧摘要反向生成权威事实。
- 重建不得隐式再次调用模型改写内容。
- Provider 迁移前后，PC 对象、授权、审计和删除语义必须不变。

## 9. 流程七：数字印象与数字代理（后续）

```text
Confirmed/Published Memories
  -> employee-controlled derivation
  -> DigitalImpression Revision
  -> employee accept/edit/reject

Delegation request
  -> explicit DelegationGrant
  -> per-request DelegationDecision
  -> authorized evidence view
  -> answer / draft / refuse / escalate
```

禁止转换：

- Memory 不能自动生成 DelegationGrant；
- DigitalImpression 不能自动生成 DelegationGrant；
- Profile/Role/历史行为不能推断员工愿意代答；
- 管理员角色不能替员工创建个人代表权；
- 数字代理不得伪装成真人。

## 10. 状态机

### Memory 生命周期

```text
CANDIDATE -> CONFIRMED -> SUPERSEDED
    |            |              |
    v            v              v
 REJECTED      REVOKED        retained audit metadata
                 |
                 v
              EXPIRED
```

项目/系统记忆使用 `PUBLISHED` 代替个人 `CONFIRMED`，并增加 Owner 审批。

### Projection Change 生命周期

```text
PENDING -> DISPATCHED -> ACCEPTED -> VERIFIED
   |           |            |
   +-----------+------------+-> FAILED / UNKNOWN -> RecoveryCase
```

Provider 的 `ACCEPTED` 不是删除或重建完成证明。

## 11. ADR 决策地图

| ADR | 决策问题 | 覆盖流程 |
| --- | --- | --- |
| ADR-0018 | Memory Authority、领域边界和 DSH 责任 | 全局 |
| ADR-0019 | Candidate、Revision、双时间、Supersession、撤销和删除 | 流程一、二、四、五 |
| ADR-0020 | Scope、Purpose、逐次动态判权和安全注入 | 流程三 |
| ADR-0021 | Projection、Provider、缓存、重建和恢复 | 流程五、六 |
| ADR-0022 | DigitalImpression 与 Delegation 分离 | 流程七 |
| ADR-0023 | Memory 暴露记录、持久 Session 失效与无重放轮换 | 流程五、Runtime 恢复 |

## 12. 评审顺序

建议按以下顺序评审，前一项未确认时不接受后一项：

1. ADR-0018：先确认权威和领域是否分开；
2. ADR-0019：确认什么能写、如何改、如何删；
3. ADR-0020：确认谁在什么目的下能读；
4. ADR-0021：确认索引和外部框架只做可重建 Projection；
5. ADR-0022：确认未来数字印象不等于代表权。
6. ADR-0023：确认撤销后旧 DSH Session 必须 fail closed，并以新 Session 无重放轮换。

ADR-0018 至 ADR-0023 已于 2026-11-16 接受。Contract Catalog、Threat Model、评测基线和 DSH 无侵入审查已形成草案；Accepted ADR 本身仍不授权编码。

