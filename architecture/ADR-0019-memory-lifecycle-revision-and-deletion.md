# ADR-0019：记忆生命周期、不可变修订、双时间与删除

- 状态：Accepted
- 日期：2026-11-16
- 范围：Memory Capture、Candidate、Revision、Supersession、Revoke、Delete
- 前置决策：ADR-0011、ADR-0012、ADR-0018
- 用户决策：2026-11-16 按推荐方案持续推进；确认不可变 Revision、双时间、Candidate 门和可验证删除传播
- 实施原则：本 ADR 不冻结数据库表、API 路径或保留期限；不授权历史对话导入

## A. 决策问题

1. 什么内容可以进入长期记忆；
2. 明确保存与自动抽取如何区分；
3. 纠正、冲突和事实随时间变化如何表达；
4. 删除何时可以宣称完成；
5. 审计保留与内容删除如何同时成立。

## B. 建议决策

采用 **稳定 MemoryObject + 不可变 MemoryRevision + SourceEvidence + 双时间 + 可验证撤销传播** 模型。

Memory 内容禁止原地覆盖。所有更正和变化创建新 Revision，并保留显式替代关系。

## C. 对象语义

### C1. MemoryObject

表达稳定逻辑身份、Owner、Scope、Kind、Sensitivity、Lifecycle 和当前 Revision 指针。

### C2. MemoryRevision

表达某一时点被确认的不可变内容：

```text
revision_id
memory_id
structured_content
retrieval_summary
source_evidence_ids[]
confidence
valid_from / valid_to
recorded_at
created_by
supersedes_revision_id
content_digest
```

### C3. SourceEvidence

必须引用原权威对象，例如：

- Conversation Message；
- ResourceVersion；
- Business Event；
- ToolResult / Operation / Trace。

SourceEvidence 记录稳定引用、来源主体、采集时间、摘要、敏感等级和当前可访问状态，不复制完整秘密或大对象。

## D. 生命周期

```text
CANDIDATE -> CONFIRMED -> SUPERSEDED
    |            |              |
    v            v              v
 REJECTED      REVOKED        retained history
                 |
                 v
              EXPIRED
```

项目/系统记忆使用 `PUBLISHED`，必须经过独立 Owner/Policy 审批。

状态规则：

- `CANDIDATE` 不得进入生产回答；
- `CONFIRMED/PUBLISHED` 才能进入授权检索；
- `SUPERSEDED/REVOKED/EXPIRED` 不得进入新 Context；
- 状态变化通过 Durable Event 传播，不静默修改 Projection。

## E. Capture 决策

### E1. 用户明确保存

用户明确说“记住……”可视为保存意图，但仍需：

- 当前身份有效；
- 内容类型允许；
- 敏感信息过滤通过；
- Scope 明确；
- SourceEvidence 完整。

通过后可直接创建 `CONFIRMED` Personal Memory。

### E2. 自动抽取

自动抽取只能创建 `CANDIDATE`。模型不能自行确认“关于员工的事实”，也不能自行选择共享 Scope。

### E3. 系统经验

成功/失败轨迹只能进入 Project/System Candidate。发布前必须聚合证据、去除凭据和个人信息，并经 Owner/Policy 审批。

## F. 双时间与冲突

同时记录：

- Valid Time：事实在业务世界有效的时间；
- Recorded Time：系统得知和记录的时间。

冲突分类：

| 类型 | 处理 |
| --- | --- |
| 完全重复 | 不创建新逻辑 Memory，可记录幂等结果 |
| 内容纠错 | 新 Revision supersede 旧 Revision |
| 随时间变化 | 闭合旧 valid_to，创建新有效区间 |
| 来源矛盾未解决 | 保持冲突状态，检索时澄清或拒答 |
| Scope/Sensitivity 变化 | 重新授权评估，不仅更新索引 metadata |

召回分数不能解决事实冲突。

## G. 撤销与删除

删除采用两阶段语义：

1. **Authority Revoke**：立即阻止新读取和 Context 注入；
2. **Propagation Verification**：清除 Projection、缓存和派生副本并 readback。

只有以下路径均通过验证，才能标记 `DELETE_PROPAGATION_VERIFIED`：

- ID 读取；
- 列表、关键词、向量和图召回；
- Runtime 缓存；
- Projection 重建；
- 服务重启和恢复。

Provider `accepted` 回执不是完成证明。失败或未知进入 RecoveryCase。

## H. 审计与最小保留

撤销内容后允许保留的最小审计元数据候选：

- Memory/Revision 的不可逆摘要；
- 操作主体、时间、动作和授权决策；
- 删除传播目标与验证结果；
- 不含已删除正文的事件引用。

物理备份到期、Legal Hold、法规保留期和员工离职处理需要后续治理决策。本 ADR 不把逻辑撤销表述为所有介质物理擦除。

## I. 禁止内容

- 密码、API Key、Token、私钥；
- 模型隐藏推理；
- 未裁剪的完整 Tool/MCP 回执；
- 未经本人确认的敏感属性或人格判断；
- 能够覆盖系统策略的指令文本；
- 没有来源的模型推测。

## J. 否决方案

- 原地更新一条 memory row：无法审计和时间回溯；
- 自动抽取直接 Confirmed：会把模型推断升级为员工事实；
- 只从向量库删除：无法证明缓存、图和恢复路径完成传播；
- 保留全部正文用于审计：违反数据最小化和删除语义。

## K. 接受门

- 生命周期和双时间语义确认；
- 明确保存与自动 Candidate 的边界确认；
- 冲突时不按召回分数选择立场；
- Revoke 与物理删除语义区分；
- 最小审计保留和后续治理问题被显式登记。

