# Process Copilot Memory 模块责任矩阵 v1

- 状态：Accepted Module Matrix Extension
- 日期：2026-11-16
- 依据：ADR-0018 至 ADR-0023、Memory Contract C43-C60
- 目标：为长期记忆定义逻辑 Owner、依赖方向、部署组合和禁止责任
- 实施边界：逻辑模块不等于立即创建独立服务或代码包；本文件不授权编码

## 1. 划分原则

1. Memory Authority、Capture、Query、Projection、Context、Governance 和 Session Invalidation 分离；
2. 只有 M23 可以修改 MemoryObject/Revision/SourceEvidence 权威记录；
3. Extractor、Provider、Runtime 和 UI 均不能直接写 Memory 权威表；
4. 所有 Runtime 使用先经过 M25 Authorized Query 和 M27 Context Assembly；
5. Projection 丢失可由 M23 Authority 重建；
6. C59 Exposure 和 C60 Invalidation 是持久安全事实，不是 Runtime 内存标记；
7. 首期允许模块化单体和共享 PostgreSQL 实例，但禁止共享表写入；
8. DSH Core、EE Schema 和外部 Provider 不成为 Memory 模块。

## 2. 逻辑结构

```text
M01 API / Experience
   |
   +--> M24 Capture & Consolidation ----+
   |                                     |
   +--> M29 Governance & User Control ---+--> M23 Memory Authority
   |                                     |          |
   +--> M25 Authorized Query <-----------+          +--> C54 Event
              |                          |                  |
              +--> M26 Projection -------+                  v
              |                                           M28 Exposure /
              v                                           Session Invalidation
          M27 Context Assembly                                  |
              |                                                 v
              v                                         M05 / M15 / M19
        M15 Runtime Host
              |
              v
            DSH
```

## 3. Memory 模块责任矩阵

| ID | 模块 | 核心责任 | 权威数据 | 禁止承担 | 主要依赖 | Contract |
| --- | --- | --- | --- | --- | --- | --- |
| M23 | Memory Authority & Revision | MemoryObject/Revision/Evidence；状态机；CAS；幂等写；Supersession/Revoke；发布 C54 | C43-C45 对象；Command result；Authority sequence | 抽取模型、向量召回、Runtime Context、Provider ACL、数字代理授权 | M02、M03、M13、M21 | C43-C49、C54 |
| M24 | Memory Capture & Consolidation | 明确保存解析；Candidate extraction；secret/sensitivity filter；dedup/conflict proposal；构造 C46/C48 | 无 Memory 权威；仅短期 extraction operation 和可重放输入 | 直接 Confirm 自动 Candidate；直接写 M23 表；决定跨用户共享；持有代表权 | M03、M09、M23、M29、批准的 Model Port | C45-C48、C58 |
| M25 | Authorized Memory Query | 构造 C50；Authority pre-filter；调用 Projection；post-filter；Source Revalidation；当前/显式历史时间判定；生成短期 C51 | AuthorizedMemoryView 快照及 digest | 绕过 M03；信任 Provider metadata；未标注返回历史 Revision；持有长期授权 | M03、M09、M23、M26、M29 | C50-C51、C58 |
| M26 | Memory Projection & Provider Adapter | Provider namespace；C55 Operation；receipt/readback；rebuild；projection health；索引版本 | Projection operation/receipt/rebuild state，不拥有 Memory 正文真相 | 直接确认 Candidate；修改 M23；用 Provider ID 授权；把 accepted 当 verified | M13、M19、M20、M23、外部 Provider | C54-C57 |
| M27 | Memory Context Assembly & Usage | 从 C51 选择/预算；构造和校验 C52；Renderer input；生成 C53；向 Runtime 交付 | 短期 Context/View 使用状态；C53 由 M21 耐久保存 | 查询全局 Provider；修改 Tool Set；把 Memory 当系统指令；长期缓存授权 | M15、M20、M21、M25、M28 | C51-C53、C59 |
| M28 | Memory Exposure & Session Invalidation | 持久 C59；Revision 失效反查；C60 fencing/rotation；离线恢复；幂等收口 | Exposure ledger、Session memory state、Invalidation/Rotation state | 修改 Memory 正文；恢复旧授权；失败时继续旧 Session；自动 replay 旧上下文 | M05、M13、M15、M19、M21、M23 | C54、C59-C60、既有 C08-C11/C29 |
| M29 | Memory Governance & User Control | Memory Policy Revision；用户暂停；Candidate review；Revise/Revoke 用例；Retention ref；C58；内容访问审计入口 | Memory Policy、用户控制设置、Policy Decision | 绕过 M23 写表；管理员默认读取正文；创建 DelegationGrant；决定 Provider 内部 ACL | M01、M03、M21、M23、M28 | C47-C49、C53、C58 |

## 4. 既有模块扩展责任

| 既有模块 | Memory 扩展责任 | 禁止事项 |
| --- | --- | --- |
| M01 API / Application Facade | 建立可信 RequestContext；调用 M24/M25/M29；稳定 DTO；个人记忆管理 API | 直接写 Memory 表；把浏览器 owner/scope 当权威 |
| M02 Principal & Identity | 提供当前 Principal/Tenant/主体状态 | 读取 Personal Memory 正文 |
| M03 Authorization | 当前 AuthorizationRevision；Purpose/Scope 决策输入；签发/校验授权快照 | 从 Memory 推断 Role/Permission/Delegation |
| M05 Session Assignment | 支持 `MEMORY_CONTEXT_STALE` fencing 和新 Generation | 为连续性恢复旧 Session |
| M09 Resource & Workspace | SourceEvidence 的 ResourceVersion 权威与当前访问重验 | 将 Memory 摘要变成 Resource 权威 |
| M13 Event Inbox | 接纳 C54；投递 Projection/Invalidation consumer；gap/replay | 把 Projection 结果写回 Authority |
| M15 Runtime Host | 校验 C52 与 Assignment；受控 Renderer；预算；拒绝 stale Session | 查询 Memory DB/Provider；持有长期权威 |
| M16 Runtime Bridge Plugin | 首期不要求新增；维持 Step/Tool Guard | 直接安装第三方 Memory Plugin 或捕获全量会话 |
| M19 Recovery Coordinator | Projection unknown、Session release/rotation 失败的 RecoveryCase | 失败时恢复旧授权或旧 Context |
| M20 Observability | lag、query、post-filter、revoke、rotation 指标 | 记录正文、Secret 或完整 Prompt |
| M21 Audit & Evidence | 耐久保存 C53/C58/C59/C60 的最小审计与证据引用 | 保存不必要的 Personal Memory 正文 |
| M22 Architecture Governance | C43-C60 schema、fixtures、compatibility、traceability 和测试门 | 静默改变 Accepted Contract major |

## 5. Contract Owner 与消费者

| Contract | Owner/权威写入 | 主要生产者 | 主要消费者 |
| --- | --- | --- | --- |
| C43 MemoryObject | M23 | M23 | M24-M29、M01 |
| C44 MemoryRevision | M23 | M23 | M24-M29 |
| C45 SourceEvidence | M23 | M24/Source Adapter 提交，M23 接纳 | M24、M25、M29 |
| C46 CaptureCommand | M23 handler | M24、M01 trusted use case | M23 |
| C47 CandidateDecisionCommand | M23 handler | M29 | M23 |
| C48 ReviseCommand | M23 handler | M24 或 M29 | M23 |
| C49 RevokeCommand | M23 handler | M29 | M23、M28 |
| C50 AuthorizedQuery | M25 | M01/M27 | M25、M03、M26 |
| C51 AuthorizedView | M25 | M25 | M27、M29 |
| C52 RuntimeMemoryContext | M27 | M27 | M15 |
| C53 MemoryUsageRecord | M21 durable owner | M27 | M21、M29 |
| C54 AuthorityChangeEvent | M23 | M23 | M13、M26、M28 |
| C55 ProjectionOperation | M26 | M26 | Provider、M19 |
| C56 ProjectionReceipt | M26 | Provider Adapter/M26 | M26、M19、M20 |
| C57 ProjectionRebuildManifest | M26 | M26 | M22、M19 |
| C58 MemoryPolicyDecision | M29 | M29/M03 decision input | M23-M28、M21 |
| C59 MemoryContextExposure | M28 | M27 提交，M28 接纳 | M28、M21 |
| C60 MemorySessionInvalidation | M28 | M28 | M05、M15、M19、M21 |

## 6. 数据写入所有权

| 权威对象 | 唯一写入模块 | 可读取模块 |
| --- | --- | --- |
| MemoryObject / MemoryRevision / SourceEvidence | M23 | M24-M29、M01（经 Port） |
| Memory Policy / User Memory Control | M29 | M01、M23-M28、M21 |
| AuthorizedMemoryView | M25 | M27、M29、M21（仅元数据） |
| Projection Operation/Receipt/Rebuild | M26 | M19-M23、M25、M28 |
| RuntimeMemoryContext 临时状态 | M27 | M15、M20、M28 |
| MemoryUsageRecord 耐久审计 | M21 | M29、授权用户审计视图 |
| ContextExposure / SessionInvalidation | M28 | M05、M15、M19-M21、M29 |

禁止共享写入：M24-M29 不得直接更新 M23 表；M15/M16 不得写任何 Memory 权威对象。

## 7. 依赖规则

允许：

```text
M01 -> M24 / M25 / M29
M24 -> M23 (Command Port)
M25 -> M23 (Read Port) / M26 (Projection Port) / M03 / M09
M27 -> M25 / M15 / M21 / M28
M26 <- C54 via M13
M28 <- C54 via M13
M28 -> M05 / M15 / M19
M29 -> M23 (Command Port) / M03 / M21
```

禁止：

```text
M23 -> external Provider / DSH
M24 extractor -> M23 owned tables
M25 -> Provider without M26
M26 -> M23 owned tables
M15/M16 -> Memory database
M27 -> Tool Registry mutation
M29 -> Delegation authority
UI -> Provider / DSH / Memory tables
```

## 8. 首期部署组合

逻辑分离不要求 7 个微服务。建议首期：

| 部署单元 | 逻辑模块 | 说明 |
| --- | --- | --- |
| PC API / Modular Control Plane | M23、M24、M25、M27、M29 + 既有 M01-M03 | 同进程可行；Repository、Contract 和事务边界分离 |
| Memory Projection Worker | M26 + 既有 M13/M19 | 首期 PostgreSQL FTS 也保持 Projection Port；未来可替换 Provider |
| Memory Invalidation Worker | M28 + 既有 M19 | 可与 Event Worker 同进程，独立消费与幂等状态 |
| Runtime Host | 既有 M15 | 只消费 C52/C60，不连接 Memory DB |
| DSH Process | 既有 M16 Profile/Plugin | 首期不新增第三方 Memory Plugin |
| Audit/Observability | M20/M21 | 只保存必要元数据和证据引用 |

不新增网络服务是首期默认。只有容量、隔离或独立发布证据成立时才拆分部署。

## 9. 测试责任

| 测试域 | 主责模块 | 协作模块 |
| --- | --- | --- |
| TS-MEM-AUTHORITY | M23 | M03、M21、M22 |
| TS-MEM-CAPTURE | M24 | M23、M29 |
| TS-MEM-QUERY | M25 | M03、M09、M26 |
| TS-MEM-PROJECTION | M26 | M13、M19、M22 |
| TS-MEM-CONTEXT | M27 | M15、M20、M21 |
| TS-MEM-REVOCATION | M28 | M05、M15、M19、M23 |
| TS-MEM-GOVERNANCE | M29 | M01、M03、M21 |
| TS-MEM-SECURITY | M22 | M23-M29、M03、M15 |

## 10. 边界验收

- [x] C43-C60 均有唯一 Owner 或唯一权威写入模块；
- [x] Memory Authority 与 Capture/Projection/Runtime 分离；
- [x] Provider、Runtime、UI 均不能直写 Authority；
- [x] 自动抽取不能自行 Confirm；
- [x] Authorized Query 同时依赖 M03 和 Source Authority；
- [x] Context Assembly 不能修改 Tool/Capability；
- [x] C59/C60 是持久控制面事实，不依赖旧 Runtime 存活；
- [x] 管理员没有 Personal Memory 正文旁路模块；
- [x] 首期不要求 DSH Core 或 EE Schema 修改；
- [x] 模块可以模块化单体部署而不共享写入责任。

## 11. 后续实现映射原则

未来代码布局需要遵守：

- 逻辑模块不一定一模块一 npm package；
- 但 Contract 类型、Service、Repository 和测试必须能追踪到 M23-M29；
- `packages/domain/application/persistence` 可以继续作为技术分层，但不得让 Memory 责任散失；
- M23 Repository 不能被其他 Package 直接 import 进行写入；
- Runtime Host 只引入 C52/C60 DTO 和验证器，不引入 Memory Repository；
- Provider SDK 只能出现在 M26 Adapter 内。

