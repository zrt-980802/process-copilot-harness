# Process Copilot MEMORY-01 主动开发需求基线

> 状态：`MEMORY-01A INDEPENDENT REVIEW PASS AFTER REMEDIATION / MEMORY-01B ON HOLD`  
> 版本：v0.4  
> 日期：2026-11-17（Asia/Shanghai）  
> 产品：Process Copilot / 公司级 Agent Harness  
> 决策：`memory-implementation-decision-pack-v1.md` 已于 2026-11-17 接受；MEMORY-01A 已完成 Contract 生成、Memory Domain、PostgreSQL Authority、授权 Port、幂等/CAS、C54 Outbox，并在修复精确幂等重放问题后通过独立复核。01B 尚未开始，不代表完整长期记忆功能可用。独立复核见 Product `docs/memory-01a-independent-review.md`。

## 1. 产品目标

Process Copilot 的记忆能力不是简单保存聊天记录，也不是把全部历史对话塞回 Prompt。它要把人与 Agent 的长期使用过程转化为可治理、可追溯、可纠正、可授权使用的公司级知识资产。

目标分为四层：

1. **用户记忆**：帮助 Agent 跨会话理解同一用户的偏好、事实、目标和历史决策。
2. **系统记忆**：沉淀项目事实、成功方法、失败经验和恢复 Runbook。
3. **数字印象**：形成员工本人可查看、纠正和控制的专业印象。
4. **数字代理**：在本人明确授权范围内提供材料、转述事实或有限解释。

本轮开发只交付第 1 层的完整闭环，并建立能够承载后续三层的权威模型和安全边界。

## 2. 首期范围：Personal Memory MVP

### 2.1 必须完成

- 用户可明确要求 Agent “记住”一条信息。
- 记忆跨会话、退出登录、服务重启后仍然存在。
- 新对话可以在授权和相关性判断后使用旧记忆。
- 用户可以查看、搜索、修改、停用和删除自己的记忆。
- 修改必须生成新 Revision，不能覆盖历史来源。
- 删除或撤销后，权威库、检索 Projection 和缓存都不能继续返回该记忆。
- 每次记忆创建、修改、使用、拒绝和删除都有审计事件。
- 每条被使用的记忆都能回链到来源对话、消息、时间和 Revision。
- 多账号、跨项目和管理员场景必须保持现有隔离语义。

### 2.2 首期记忆类型

| 类型 | 示例 | 首期写入方式 |
| --- | --- | --- |
| `explicit_preference` | “以后技术方案先给结论，再给依据” | 用户明确保存 |
| `confirmed_fact` | “我是 EP37 的需求负责人” | 用户明确保存；使用时仍重新判权 |
| `ongoing_goal` | “本月目标是完成最小演示” | 用户明确保存 |
| `decision_history` | “当前选择先做只读 MCP，再做受控写入” | 用户明确保存并保留时间范围 |

自动抽取在首期只产生 `candidate`，不得直接变成已确认事实。

### 2.3 明确不做

- 不导入全部历史聊天。
- 不把“记录所有对话”等同于“形成长期记忆”。
- 不建立员工人格模型或参数化分身。
- 不向其他员工开放某人的个人记忆。
- 不实现员工数字人代答。
- 不允许记忆直接授予 Tool、Plugin、MCP 或业务资源权限。
- 不允许记忆内容触发审批、承诺或企业写操作。
- 不修改 DSH Core、共享 EE 数据库、生产配置或现有端口。
- 不接入真实员工全量数据，不远程部署。

## 3. 核心产品规则

1. **聊天记录是来源，Memory Object 才是长期记忆。**
2. **知识不能产生权限。** 记住“用户是项目负责人”不代表系统授予负责人权限。
3. **外部框架不是权威。** Mem0、OpenViking、Graphiti 或向量库只能作为 Provider/Projection。
4. **动态判权。** 每次检索和使用记忆时都按当前身份、项目成员关系、Scope、状态和目的重新判定。
5. **不可变修订。** 更正通过新 Revision 和 Supersession 表达，禁止静默覆盖。
6. **来源完整。** 没有 SourceEvidence 的内容不能升级为已确认记忆。
7. **记忆不是指令。** 检索到的内容只能作为事实性上下文，不能覆盖系统策略或发起工具调用。
8. **用户可控。** 用户可以暂停记忆个性化，并查看最近哪些回答使用过哪些记忆。
9. **默认最小化。** 只保存完成既定目的所需的最少内容，不保存模型推理、密钥、密码和完整工具回执。
10. **数字印象与委托授权后续独立建模。** 不允许从个人记忆自动推导代表权。

## 4. 领域模型

### 4.1 MemoryObject

稳定身份和当前状态，至少包含：

- `memory_id`
- `tenant_id`
- `owner_principal_id`
- `scope_type`: `PERSONAL | PROJECT | SYSTEM`
- `scope_id`
- `memory_kind`
- `object_state`: `CANDIDATE | CONFIRMED | PUBLISHED | REVOKED | EXPIRED | REJECTED`
- `sensitivity`: `INTERNAL | CONFIDENTIAL | RESTRICTED`
- `current_revision_id`
- `created_at / updated_at`

首期仅开放 `PERSONAL`；`PROJECT` 和 `SYSTEM` 进入模型但不开放写入口。

### 4.2 MemoryRevision

不可变内容修订，至少包含：

- `revision_id`
- `memory_id`
- `revision_state`: `CURRENT | SUPERSEDED | WITHDRAWN`
- 结构化内容和可检索摘要
- `source_evidence_ids`
- `confidence`
- `valid_from / valid_to`
- `created_by`
- `recorded_at`
- `supersedes_revision_id`
- `content_digest`

Object State 与 Revision State 必须分离。创建新 Revision 时旧 `CURRENT` Revision 转为 `SUPERSEDED`，MemoryObject 仍保持 `CONFIRMED/PUBLISHED`；`WITHDRAWN` Revision 在任何 Purpose 下都不得返回正文。

### 4.3 SourceEvidence

来源引用而不是内容副本，支持：

- `conversation_id / message_id`
- `resource_id / resource_version_id`
- `operation_id / trace_id`
- 来源主体、采集时间、摘要和敏感级别
- 来源当前是否仍可访问

### 4.4 AuthorizedMemoryView

调用方永远不直接读取底层 Memory 表。检索结果必须经过授权投影，至少返回：

- 当前允许使用的内容
- Memory 和 Revision 标识
- 来源摘要与时间
- 适用范围、有效期和置信度
- 使用目的和授权决策标识

## 5. 核心流程

### 5.1 明确保存

```text
用户明确说“记住……”
  -> 识别保存意图
  -> 敏感信息与范围校验
  -> 建立 SourceEvidence
  -> 创建 CONFIRMED Memory + Revision
  -> 更新检索 Projection
  -> 返回简短确认
```

明确保存只代表用户授权保存该信息，不代表信息能够突破现有业务权限。

### 5.2 自动候选

```text
新对话消息
  -> Candidate Extractor
  -> 类型 / 敏感性 / 来源 / 重复与冲突判断
  -> CANDIDATE
  -> 用户在记忆管理页确认或拒绝
```

首个垂直切片可以暂不启用自动候选，但接口和状态必须预留。

### 5.3 检索与注入

```text
新一轮对话
  -> Identity + Purpose + Project Context
  -> Authorized Memory Query
  -> 相关性、时效性、冲突和预算排序
  -> 安全封装为 Memory Context
  -> Agent 生成回答
  -> 记录 Memory Usage Audit
```

记忆上下文必须与用户消息、系统指令、Tool 输出分区，不能拼成未标注的普通文本。

### 5.4 修改和删除

- 修改创建新 Revision，并将旧 Revision 标记为被替代。
- 删除首期采用权威 `REVOKED` + Projection/缓存清除；审计仅保留最小事件元数据。
- 删除后通过 Memory ID、关键词、向量近邻、缓存和重启恢复路径均不得再次检索到内容。
- 备份物理到期和 Legal Hold 属于后续治理项，首期不得伪称已完成物理擦除。

## 6. 权限与隔离

首期授权条件是以下条件的交集：

```text
当前登录身份
AND 当前 Tenant
AND Memory Owner
AND Scope
AND 当前项目成员关系（如果来源属于项目）
AND Lifecycle State
AND Sensitivity Policy
AND 当前使用目的
```

强制规则：

- `demo.engineer` 不能读取 `demo.reviewer` 的个人记忆，反之亦然。
- 平台管理员不因角色而获得个人记忆内容读取权。
- 来源项目权限被撤销后，该记忆即使仍属于本人，也不能继续暴露已无权访问的项目内容。
- 禁止通过 ID 直读、搜索、向量相似、缓存、导出、审计和恢复接口绕过判权。
- Tool/MCP 的权限继续由现有 Capability、Project Membership 和 Gateway 判定，Memory 不参与授权扩权。

## 7. 产品界面

### 7.1 记忆管理页

放在个人首页或个人设置的稳定入口，首期支持：

- 开启/暂停个性化记忆；
- 按类型、项目、状态和时间筛选；
- 搜索记忆；
- 查看内容、来源、创建时间、最近使用时间；
- 编辑、停用、删除；
- 查看 Revision 历史和使用记录。

### 7.2 对话体验

- 不弹出频繁的模式切换提示。
- 明确保存后只做简短确认。
- 正常回答保持无缝；记忆使用详情放在可展开的来源/审计区。
- 记忆不足、冲突或过期时，Agent 应询问或声明不知道，不能补造。

## 8. 技术落点

### 8.1 Product

- PostgreSQL 承担 Memory Authority。
- 新增独立 Memory Domain/Package，不把逻辑塞进 Conversation、Profile 或 Runtime 模块。
- 复用现有 Identity、Project Membership、ResourceVersion、Durable Event、Audit 和 Recovery 原语。
- 先使用 PostgreSQL 结构化查询与全文检索建立可测 baseline；向量、图和外部 Provider 后置。

### 8.2 Runtime / DSH

- 通过外部 Memory Context Provider 注入授权视图。
- 不修改 DSH Core。
- Runtime 不持有权威状态；本地缓存可丢失、可重建、必须受 Revision 和撤销约束。

### 8.3 EE

- 首期不修改 EE schema。
- EE 只作为来源资源和项目授权权威之一。
- 所有 EE 来源在使用时重新验证当前访问权。

## 9. 接口能力

首期至少需要以下服务能力，具体 HTTP 路径在 Contract 阶段冻结：

- `CreateConfirmedMemory`
- `CreateMemoryCandidate`
- `ListAuthorizedMemories`
- `GetAuthorizedMemory`
- `ReviseMemory`
- `RevokeMemory`
- `ConfirmMemoryCandidate`
- `RejectMemoryCandidate`
- `QueryAuthorizedMemoryContext`
- `RecordMemoryUsage`
- `RebuildMemoryProjection`

所有写接口必须支持幂等键，所有读接口必须携带当前 Principal 和 Purpose。

## 10. 首期验收场景

### A. 正常闭环

1. 工程师在对话 A 中明确保存偏好。
2. 新建对话 B，Agent 正确使用该偏好。
3. 退出、重登并重启服务后，偏好仍可使用。
4. 用户修改偏好，新 Revision 生效，旧内容不再参与回答。
5. 用户删除记忆，新对话、搜索和重启恢复后均不再返回。

### B. 账号与项目隔离

1. 工程师、评审人分别保存同名但不同内容的记忆，互不污染。
2. 管理员不能读取两人的个人记忆内容。
3. 撤销工程师的项目成员关系后，项目来源内容不再被其记忆上下文使用。
4. 直接 ID、列表、搜索、Projection 和缓存路径均返回一致的拒绝结果。

### C. 安全与正确性

1. 对话中的恶意文本不能被当作系统指令保存或执行。
2. Memory 内容要求调用 Tool、泄露其他用户或覆盖策略时必须无效。
3. 冲突记忆不能随机选择；应使用最新有效 Revision或请求澄清。
4. 过期、撤销、无来源或来源已无权访问的记忆不能进入 Prompt。
5. 每次使用能够定位到 Memory、Revision、SourceEvidence 和授权决策。

## 11. 准出标准

- 跨 Tenant、用户、项目泄漏：`0`。
- 未授权 Memory 使用：`0`。
- 已撤销内容在权威查询、Projection、缓存和恢复后的返回：`0`。
- 已使用记忆的来源与 Revision 完整率：`100%`。
- 关键写操作具备幂等、重试和重启恢复测试。
- Product 全量门禁不回退，新增 Memory 测试全部通过。
- 不修改 DSH Core、EE schema、共享数据库、生产配置和现有端口。
- 本地开发者验收与独立验收结论分开记录。

## 12. 开发批次

### MEMORY-01A：Authority 与 Contract

- 领域对象、状态机、错误语义和 Contract；
- PostgreSQL Repository 与迁移；
- Principal/Scope/Purpose 动态判权；
- Revision、Supersession、Revoke 和审计；
- 纯服务层和真实 PostgreSQL 测试。

### MEMORY-01B：显式保存与授权检索

- 对话中的显式保存意图；
- SourceEvidence 绑定；
- PostgreSQL 全文检索 baseline；
- AuthorizedMemoryView；
- 跨会话检索和 Runtime Memory Context 注入；
- Prompt 注入与撤销缓存测试。

### MEMORY-01C：用户控制界面与端到端验收

- 记忆管理页；
- 查看来源、修订和最近使用；
- 编辑、停用、删除和暂停个性化；
- 多账号浏览器验收、重启恢复和独立测试交接。

### 后续批次

- `MEMORY-02`：自动候选抽取、冲突整理与用户确认。
- `MEMORY-03`：项目事实、Runbook、Failure/Gotcha 系统记忆。
- `MEMORY-04`：可替换向量/图/上下文 Provider 评测。
- `MEMORY-05`：员工数字印象，仅本人预览和纠正。
- `DELEGATE-01`：L0/L1 只读数字代理；必须另行立项和授权。

## 13. 第一个开发任务的停止线

第一个长任务建议只执行 `MEMORY-01A`，完成后停止并交付：

- 需求到 Contract 的映射；
- 数据模型和迁移；
- Service/API 最小闭环；
- 真实 PostgreSQL 权限、幂等、Revision、撤销和恢复测试；
- 对 MEMORY-01B 的明确接口交接。

不得在同一任务中顺带接入 Mem0/OpenViking、自动抽取、数字印象、数字代理或生产数据。

## 14. 与旧计划的关系

本文件将原《PHASE-2-MEMORY-DIGITAL-DELEGATE-PROVISIONAL-PLAN》中的“仅调研、暂不实施”更新为主动开发决策，但不否定其中的治理原则和后续路线。

正式状态解释如下：

- Personal Memory：进入开发。
- System Memory：进入架构预留，尚未开发。
- Digital Impression：保留为后续阶段，尚未开发。
- Digital Delegate：保留为独立立项，尚未授权开发。

