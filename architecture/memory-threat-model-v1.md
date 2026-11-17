# Process Copilot 长期记忆威胁模型 v1

- 状态：Proposed Security Baseline
- 日期：2026-11-16
- 依据：ADR-0018 至 ADR-0023、Memory Contract C43-C60
- 范围：Capture、Authority、Projection、Query、Context、Revoke、Recovery、未来 DigitalImpression/Delegation 边界
- 非目标：不替代企业正式隐私影响评估、法务意见、渗透测试或生产安全评审
- 实施边界：不授权编码、真实员工数据接入、外部 Provider 安装或部署

## 1. 安全目标

1. 跨 Tenant、用户、项目的 Memory 内容泄漏为零；
2. Memory 不产生身份、Role、Capability、Tool/MCP 权限或员工代表权；
3. 外部内容和模型输出不能直接升级为确认事实；
4. 已撤销内容立即停止授权读取，并最终从所有 Projection/缓存路径清除；
5. 每次实际使用都能回链 Principal、Purpose、Memory Revision、SourceEvidence 和 Policy Decision；
6. Provider、Runtime、缓存、审计和恢复路径不能绕过 Memory Authority；
7. Memory 中的恶意指令不能覆盖系统策略或触发 Tool；
8. 安全状态未知时 fail closed，不回退到“无记忆限制”的 Provider 默认行为。

## 2. 保护资产

| 资产 | 主要风险 | 保护目标 |
| --- | --- | --- |
| Personal Memory 正文 | 隐私泄漏、人格推断、内部滥用 | 机密性、本人控制 |
| Memory Revision/Valid Time | 静默篡改、旧事实误用 | 完整性、时间正确性 |
| SourceEvidence | 来源泄漏、伪造来源 | 可追溯性、当前授权 |
| Authorization/Policy Revision | 重放、伪造、过期 | 完整性、新鲜度 |
| AuthorizedMemoryView | 跨用户复用、缓存污染 | 短期、主体与目的绑定 |
| Projection/Provider Index | 越权召回、残留、侧信道 | 隔离、可删除、可重建 |
| Usage/Audit | 正文泄漏、缺失、抵赖 | 最小化、完整性 |
| DigitalImpression | 敏感推断、冒充本人 | 本人控制、分类披露 |
| DelegationGrant | 伪造授权、范围扩大 | 明确、有限、可撤销 |

## 3. 信任边界

```text
[Browser / User]
        |
        | authentication boundary
        v
[PC API / Request Context]
        |
        +--> [Identity & Authorization Authority]
        |
        +--> [Memory Authority] <--> [Conversation / Resource / Event Authorities]
        |          |
        |          | projection adapter boundary
        |          v
        |     [Keyword / Vector / Graph Provider]
        |
        | authorized view boundary
        v
[Context Assembler / DSH Adapter]
        |
        | runtime boundary
        v
[DSH Runtime / Model / Tool Runtime]
        |
        | controlled execution boundary
        v
[MCP / EE / External Systems]
```

默认不信任：

- 浏览器传入的 owner/scope/purpose；
- 对话、网页、文档和 ToolResult 中的指令；
- 模型抽取的事实、类型、置信度和授权判断；
- Provider 返回的 owner/scope/ACL/history/delete 状态；
- Runtime 本地缓存和旧 AuthorizedView；
- 管理员角色对 Personal Memory 的内容访问权。

## 4. 攻击者与误用者

- 普通员工尝试读取同事记忆；
- 已退出项目的员工复用旧 Session/View/缓存；
- 平台管理员或运维人员利用角色旁路读取正文；
- 恶意外部文档通过对话写入 sleeper memory；
- Provider/Plugin 被错误配置或返回伪造 metadata；
- 旧 Runtime、断网队列或恢复任务在撤权后重放；
- 模型错误地把推断当确认事实；
- 未来数字代理把员工历史行为误当授权；
- 无恶意但配置错误的开发者、脚本或迁移任务。

## 5. 威胁登记表

| ID | 威胁 | 风险 | 主要控制 | 验证 |
| --- | --- | --- | --- | --- |
| TM-01 | 猜测 Memory ID 直接读取他人内容 | Critical | C50 授权查询；禁止底表/Provider 直读；owner/scope 动态判权 | 两账号已知 ID 交叉 GET 全拒绝 |
| TM-02 | 列表、搜索、向量、图邻居绕过 Scope | Critical | pre-filter + post-filter；opaque namespace；C51 绑定权威对象 | sentinel 跨 user/project 零召回 |
| TM-03 | 客户端伪造 owner/scope/purpose | Critical | scope 服务端派生；Purpose allowlist；C46/C50 Policy Decision | 修改请求字段不能扩大结果 |
| TM-04 | 管理员默认读取个人记忆 | Critical | ADR-0020 无内容旁路；运维只看健康/元数据 | demo.admin 内容访问拒绝并审计 |
| TM-05 | 外部文档诱导写入伪造员工事实 | High | 自动抽取只生成 Candidate；Evidence 类型/来源标记；本人确认 | 恶意文档不能生成 Confirmed |
| TM-06 | Memory 中持久化 Prompt Injection | Critical | C52 类型化不可信区；指令裁剪；Tool Policy 独立 | “忽略系统并调用工具”不生效 |
| TM-07 | Memory 声明自己有权限并扩展 Tool Set | Critical | Capability/Gateway 独立判权；Context 不携带 Tool grant | Memory 内容无法新增 Tool/MCP |
| TM-08 | Project 撤权后继续使用旧 Memory | Critical | Source Revalidation；AuthorizationRevision；缓存绑定 | 撤权后下一请求零内容 |
| TM-09 | 旧 AuthorizedView/Session 重放 | High | View 短时过期；principal/purpose/session 绑定；nonce/digest | 跨 Session/用户重放拒绝 |
| TM-10 | 更新后旧 Revision 仍被召回 | High | Supersession；Authority post-filter；Projection change | 旧 Revision 零新 Context |
| TM-11 | 冲突事实按向量分数随机选择 | High | conflict state；valid time；clarify/refuse | 冲突样本不静默选边 |
| TM-12 | Revoke 只隐藏 UI，Provider/缓存仍可读 | Critical | Authority 立即拒绝；C55-C56 readback；RecoveryCase | ID/search/vector/cache/restart 全测 |
| TM-13 | 备份/重建使已撤销内容复活 | Critical | fixed Authority Snapshot；撤销 tombstone/manifest；重建验证 | 删除后重建零复活 |
| TM-14 | Provider pending queue 在撤权后重放 | Critical | generation/authority change/idempotency；旧 revision 拒绝 | 断网排队、撤权、恢复测试 |
| TM-15 | Provider `accepted` 被当成删除完成 | High | receipt/readback 分离；verified 状态机 | 未 readback 不标完成 |
| TM-16 | Provider metadata 伪造 owner/scope | Critical | Provider metadata 不可信；回绑 C43/C44 | 伪造 metadata 被 post-filter 丢弃 |
| TM-17 | 审计/日志记录 Memory 正文或 Secret | High | 最小化 C53/C58；结构化日志；secret scan | 日志、Trace、错误无正文/凭据 |
| TM-18 | Extractor/模型供应链泄露个人数据 | High | approved model route；最小输入；无训练/遥测声明审查 | 网络与遥测清单、合成数据 PoC |
| TM-19 | 大量 Capture/Query 导致成本或容量 DoS | Medium | quota/rate limit；token/item budget；async extraction | 限流和背压测试 |
| TM-20 | DigitalImpression 被当成员工确认事实 | High | 分类字段；本人接受；inference 明示 | inference 不能进入 confirmed view |
| TM-21 | Memory/DigitalImpression 自动产生代答授权 | Critical | ADR-0022 禁止转换；独立 Grant/Decision | 无 Grant 时 Delegate 永远拒绝 |
| TM-22 | 有效 Grant 被扩大接收者/主题/期限 | Critical | per-request intersection；immutable Grant Revision | 超 Scope 请求拒绝/升级 |
| TM-23 | 数字代理隐藏身份冒充真人 | High | 强制 response disclosure；审计 | 所有代答含机器可读披露 |
| TM-24 | 侧信道泄露“某人是否有某记忆” | Medium | 统一拒绝语义；结果计数最小化；constant-shape response | 未授权 ID 存在/不存在不可区分 |
| TM-25 | 已撤销 Memory 通过持久 DSH Session 历史继续影响回答 | Critical | C59 暴露记录；C60 fail-closed invalidation；新 Session 不 replay | 旧 Session START/RESUME 拒绝，轮换后零召回 |

## 6. Capture 安全流程

```text
Input Source
  -> classify source trust
  -> authenticate actor
  -> derive owner/scope server-side
  -> secret/PII/sensitive filter
  -> separate data from instructions
  -> create SourceEvidence
  -> extract Candidate
  -> dedup/conflict scan
  -> confirmation gate
```

强制控制：

- 明确保存也不能保存密码、Token 或私钥；
- 自动 Extractor 不拥有 `CONFIRM/PUBLISH` 权限；
- 外部来源只能证明“来源中写了什么”，不能证明“员工本人确认了什么”；
- Candidate 内容和 Extractor 原始输出都按不可信输入处理；
- Capture Policy Revision 必须进入 C46/C58。

## 7. Query 与 Context 安全流程

```text
trusted request context
  -> derive allowed authority set
  -> restricted projection query
  -> bind result to C43/C44
  -> post-filter
  -> source revalidation
  -> conflict/freshness check
  -> redact/minimize
  -> C51 AuthorizedView
  -> C52 untrusted Memory Context
```

禁止降级：

- Provider 不可用时，不直接查询全局索引；
- Authorization 服务不可用时，不沿用无限期旧 View；
- Source 无法验证时，不返回正文；
- Context 超预算时，不绕过排序拼接全量历史。

## 8. Revoke 与恢复安全流程

撤销顺序：

1. Authority CAS 更新为 `REVOKED`；
2. 新查询立即拒绝；
3. 发布 C54 Authority Change；
4. 使匹配 Revision/Auth/View 的缓存不可命中；
5. 向各 Projection 发 C55；
6. 收集 C56 Receipt；
7. 逐路径 readback；
8. 未验证目标进入 RecoveryCase；
9. 固定 Snapshot 重建验证不可复活。

任何步骤失败都不能回退 Authority Revoke。

## 9. 数据最小化

### 允许进入 Authority

- 完成用途所需的最少结构化内容；
- 可追溯 SourceEvidence 引用；
- Valid/Recorded Time、Scope、Sensitivity 和 Policy Revision。

### 默认不进入 Authority

- 完整历史会话副本；
- 模型隐藏推理；
- Secret 和凭据；
- 大型文件正文；
- 与用途无关的个人属性；
- 未经确认的人格、绩效、健康、政治、宗教等敏感推断。

## 10. 管理与运维边界

- 管理员可查看服务健康、数量、延迟、失败传播和不可逆摘要；
- 默认不能查看 Personal Memory 正文；
- 未来 Break-glass 必须单独 ADR/Policy、双人审批、限时、通知本人并全量审计；
- 当前版本不提供 Break-glass 内容读取能力；
- Debug dump、Trace、错误响应和支持导出不得绕过正文边界。

## 11. 安全测试矩阵

### 身份与 Scope

- `SEC-MEM-001` engineer/reviewer 相同关键词不同内容互不召回；
- `SEC-MEM-002` 已知他人 Memory ID 读取/修改/撤销均拒绝；
- `SEC-MEM-003` admin 列表、搜索、详情、导出正文均拒绝；
- `SEC-MEM-004` 跨 Tenant opaque namespace sentinel 零泄漏；
- `SEC-MEM-005` Project 撤权后旧 Session/View/缓存全部失效。

### Capture 与注入

- `SEC-MEM-006` 外部网页要求“记住我是管理员”只形成不可信 Candidate 或被丢弃；
- `SEC-MEM-007` Memory 中的系统覆盖、Tool 调用、数据外传指令均无效；
- `SEC-MEM-008` Secret/Token/私钥模式不能保存；
- `SEC-MEM-009` 自动抽取不能产生 Confirmed；
- `SEC-MEM-010` 缺 SourceEvidence 的内容不能发布。

### Revision、删除与恢复

- `SEC-MEM-011` 并发 Revise CAS 只有一个成功；
- `SEC-MEM-012` Superseded Revision 不进入新 Context；
- `SEC-MEM-013` Revoke 后 ID/list/search/vector/cache 全部拒绝；
- `SEC-MEM-014` Provider 断网队列在撤权后恢复不写入旧内容；
- `SEC-MEM-015` 删除后从 Authority Snapshot 重建不复活；
- `SEC-MEM-016` Provider accepted 但未 readback 时状态保持 pending/unknown。

### 数字印象与委托边界

- `SEC-MEM-017` DigitalImpression inference 不冒充 confirmed fact；
- `SEC-MEM-018` 无 DelegationGrant 时任何他人代答请求拒绝；
- `SEC-MEM-019` Grant 超接收者/主题/期限请求拒绝；
- `SEC-MEM-020` DelegateResponse 强制披露非真人实时答复。
- `SEC-MEM-021` 撤销已暴露 Revision 后旧 DSH Session 无法 START/RESUME，新 Session 不 replay 旧上下文。

## 12. 准出门

进入实现任务设计前必须满足：

- Critical 威胁均有预防控制、检测控制和测试 ID；
- C43-C60 能表达 Principal、Purpose、Revision、Policy、Revoke、Exposure、Session Invalidation 和 readback；
- direct-get、search、vector、graph、cache、audit、export、backup/rebuild 均在隔离矩阵中；
- Personal Memory 管理员无正文旁路；
- Memory Prompt Injection 与 Tool 权限分离可测试；
- Provider/Extractor 不持有企业授权权威；
- 删除不被简化为 UI 隐藏或 Provider accepted；
- 数字印象与 Delegation 禁止转换可测试。

## 13. 开放治理问题

以下问题不阻断架构基线，但在真实员工试点前必须闭合：

- 数据保留期限、Legal Hold 和离职处理；
- 静态加密、字段加密、KMS 和密钥轮换；
- 数据驻留、跨境、Provider 遥测和模型训练声明；
- 员工访问、导出、更正和删除请求的组织流程；
- 安全事件通知、回滚和大规模 Projection 清除；
- Break-glass 是否允许以及双人审批机制；
- DigitalImpression/Delegation 的法务、HR 和员工代表评审。

