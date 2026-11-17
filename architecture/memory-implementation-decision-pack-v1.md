# Process Copilot Memory Implementation Decision Pack v1

- 状态：Accepted for Staged Implementation / MEMORY-01A Developer Verified / MEMORY-01B On Hold
- 日期：2026-11-17
- 范围：Personal Memory MVP（MEMORY-01A 至 MEMORY-01C）
- 权威依据：ADR-0018 至 ADR-0023、C43-C60、M23-M29
- 追溯依据：`memory-traceability-manifest-v1.json`、PersonalMemoryEval-v0
- 接受记录：用户于 2026-11-17 授权按本 Decision Pack 启动 MEMORY-01A；当前工作树继续，未授权提交、推送或部署
- 边界：MEMORY-01A 已完成开发者验证；不授权自动进入 01B、Provider 安装、历史数据导入、部署、提交或推送

## 1. 决策摘要

Personal Memory 首期采用以下实现：

1. Memory Authority 位于 PC Backend，PostgreSQL 是唯一权威存储；
2. 新建独立 `@pc/memory` 领域包，Memory 逻辑不进入 Conversation、Profile、Gateway 或 Runtime 模块；
3. `@pc/persistence` 提供 PostgreSQL Repository 和版本化 SQL migration；
4. 首期检索采用 PostgreSQL 结构化过滤加可解释的词法检索，不安装外部向量、图或 Memory Provider；
5. 所有浏览器请求从当前登录态派生 Tenant、Principal、AuthorizationRevision 和有效 Purpose，客户端不能扩大 Owner、Scope 或 Purpose；
6. Authority 事务通过 Outbox 发布 C54，Projection、缓存失效和 Session 轮换均由事件驱动；
7. Memory 一旦进入 Runtime，必须先持久化 C59 Exposure；相关 Revision 失效时生成 C60，并使用 `FRESH_SESSION_NO_REPLAY`；
8. MEMORY-01A 只完成 Authority、Contract、Repository、授权命令和确定性测试，不接入对话或 Runtime。

## 2. 与当前 Product 的落点

| 责任 | 实现落点 | 说明 |
| --- | --- | --- |
| C43-C49、C58 领域规则 | 新包 `packages/memory` | M23/M24/M29；纯 TypeScript，不依赖 Fastify、PostgreSQL 或 DSH |
| PostgreSQL Authority | `packages/persistence` | Memory Repository、事务、migration、Outbox |
| HTTP 组合与认证 | `apps/api` | 只做身份派生、输入解析、状态码映射和 Service 编排 |
| 授权来源 | 复用 `@pc/application` | 当前 Principal、AuthorizationRevision、Project Membership 和 Resource Access |
| C50-C53 查询与上下文 | `packages/memory` | M25/M27；不直接查询 Provider 原始结果 |
| C54-C57 Projection | `packages/memory` + `packages/persistence` Worker Port | M26；首期 Provider 是 PostgreSQL lexical projection |
| C59-C60 暴露与失效 | `packages/memory` + Runtime Adapter | M28；复用 Assignment Generation、Fencing、Release/Rotate 原语 |
| 管理界面 | `apps/web` | 仅 MEMORY-01C 开始，不在 01A 修改 |

依赖方向固定为：

```text
apps/api -> @pc/memory -> ports
                         ^
                         |
            @pc/persistence adapters

apps/web -> HTTP API only
@pc/memory -X-> DSH internals / EE database / Provider SDK
```

不把 Memory 表加入 EE，不修改 DSH Core，不把外部 Provider SDK 引入领域包。

## 3. 物理数据模型

### 3.1 ID、时间和内容表示

- 所有稳定 ID 使用应用侧生成的带前缀 UUID v4 字符串，与当前 Product 习惯一致；
- 时间使用 PostgreSQL `TIMESTAMPTZ`，写入 UTC instant；
- Contract 枚举使用 `TEXT + CHECK`，未知值 fail closed；
- `structured_content` 使用 JSONB，但首期必须通过 Memory Kind 对应的 JSON Schema；
- `retrieval_summary` 是可重建派生文本，不得成为权威内容；
- Digest 使用 SHA-256 hex；任何 Digest 都不是授权凭证；
- Secret、完整 Prompt、模型隐藏推理和完整 Tool 回执不得入库。

### 3.2 Authority 表

| 表 | Contract | 关键字段 | 关键约束 |
| --- | --- | --- | --- |
| `pc_memory_object` | C43 | memory/tenant/owner/subject/scope/kind/sensitivity/object_state/current_revision/policy_revision/version | `memory_id` PK；Personal Scope 由服务端派生；Object 状态不包含 SUPERSEDED |
| `pc_memory_revision` | C44 | revision/memory/no/state/content/summary/confidence/valid time/recorded time/digest | `(memory_id, revision_no)` 唯一；每个 Object 最多一个 CURRENT；内容字段发布后不可修改 |
| `pc_memory_source_evidence` | C45 | authority/object/version/fragment/subject/sensitivity/displayability/digest/revalidation policy | 仅保存引用和最小摘要，不复制完整来源正文 |
| `pc_memory_revision_evidence` | C44-C45 | revision_id/source_evidence_id/ordinal | 多对多连接；一个可用 Revision 至少一条 Evidence |
| `pc_memory_command` | C46-C49 | command/idempotency/payload digest/principal/result/error/timestamps | `(tenant_id, principal_id, idempotency_key)` 唯一；相同 key 不同 payload 稳定冲突 |
| `pc_memory_policy_decision` | C58 | decision/kind/principal/memory/revision/purpose/auth/policy/reasons/digest | 不保存被拒绝的敏感正文 |
| `pc_memory_authority_event` | C54 | event/object version/change/object/revision/scope digest/sequence/causation | 与 Authority 变更同事务写入；也是 Outbox 源 |

Object、Revision、Evidence 和连接表使用显式外键；`current_revision_id` 使用可延迟约束以支持同一事务创建首个 Revision。首期不物理删除 Authority 行，不配置会级联删除审计、Evidence、Usage 或 Event 的 `ON DELETE CASCADE`。

状态字段严格分离：

```text
object_state   = CANDIDATE | CONFIRMED | PUBLISHED | REVOKED | EXPIRED | REJECTED
revision_state = CURRENT | SUPERSEDED | WITHDRAWN
```

Revision 的内容、Evidence 绑定和 Valid Time 不可原地改写。允许在同一 Authority 事务中把旧 Revision 的状态从 `CURRENT` 改为 `SUPERSEDED`，同时插入新 `CURRENT` Revision 并更新 Object 指针；这里的“不可变”指业务内容不可覆盖，不禁止受约束的状态转换。

### 3.3 Query、Projection 和治理表

| 表 | Contract | 首次需要批次 | 作用 |
| --- | --- | --- | --- |
| `pc_memory_projection_document` | C55 | 01B | PostgreSQL lexical projection；只保存 Authority ref、scope manifest、派生检索文本和 release |
| `pc_memory_projection_operation` | C55-C56 | 01B | 幂等 UPSERT/HIDE/DELETE/REBUILD_SCOPE 状态和 Provider ref |
| `pc_memory_projection_receipt` | C56 | 01B | Acceptance 与 Readback 分列，未验证不得宣称完成 |
| `pc_memory_rebuild` | C57 | 01B | 固定 Authority Snapshot、manifest digest、激活和核验结果 |
| `pc_memory_usage` | C53 | 01B | 一次 View/Context 的实际提供或引用记录 |
| `pc_memory_usage_revision` | C53 | 01B | Usage 与 Revision 的连接，不复制正文 |
| `pc_memory_context_exposure` | C59 | 01B | Session、Generation、Context 与已暴露 Revision |
| `pc_memory_session_invalidation` | C60 | 01B | Fencing、Release、Rotation、Recovery 状态 |
| `pc_memory_user_setting` | Governance | 01C | 个性化暂停、显示偏好；暂停不删除 Authority 内容 |

### 3.4 索引与隔离

最低索引：

- Object：`(tenant_id, owner_principal_id, object_state, updated_at desc, memory_id)`；
- Scope：`(tenant_id, scope_type, scope_id, object_state)`；
- Revision：`(memory_id, revision_no desc)`，以及 CURRENT partial unique index；
- Valid Time：`(memory_id, valid_from, valid_to)`；
- Evidence：`(tenant_id, source_authority, source_object_id, source_version_id)`；
- Event：`(tenant_id, memory_id, producer_sequence)` 和未派发 Outbox partial index；
- Projection：`(tenant_id, owner_principal_id, projection_release)` 加 GIN search vector；
- Exposure：`(tenant_id, memory_id, revision_id, pc_session_id)`；
- Invalidation：未完成状态 partial index。

所有 Repository 方法必须把 `tenant_id` 和授权 Scope 作为查询条件，不允许先按 ID 读取后在应用层隐藏。首期不依赖 PostgreSQL RLS 作为唯一防线；未来可以叠加 RLS，但 Service/Repository 条件仍必须存在。

### 3.5 Migration 方式

Memory 使用独立版本目录，例如：

```text
packages/persistence/migrations/memory/
  0001_memory_authority.sql
  0002_memory_query_projection.sql
  0003_memory_exposure_governance.sql
```

Migration 只作用于 PC PostgreSQL。Migration runner 必须记录版本和 digest；已应用 migration 不可原地修改。01A 只应用 `0001`，后续 migration 由对应批次启用。禁止修改 EE schema 或共享数据库。

## 4. Authority 事务规则

### 4.1 Create Confirmed Memory

同一事务完成：

1. 锁定或创建幂等命令记录；
2. 校验可信 RequestContext、Personal Scope、Sensitivity 和 Evidence；
3. 插入 C43 Object；
4. 插入 C44 CURRENT Revision；
5. 插入 C45 Evidence 和绑定；
6. 写 C58 Policy Decision；
7. 更新 Object `current_revision_id`；
8. 按结果态写一条 C54 Outbox：Candidate 创建使用 CREATED，明确保存直接形成 Confirmed 时使用 CONFIRMED；
9. 固化命令结果。

任何一步失败全部回滚。重试返回同一业务结果，不创建第二个 Memory。

### 4.2 Revise

对 Object 行执行 `version` CAS，并校验 `expected_current_revision_id`。同一事务把旧 CURRENT 转为 SUPERSEDED、插入新 CURRENT、更新 Object 指针/version、写 Policy Decision 和 C54。并发修改只能一个成功，失败方得到 `MEMORY_REVISION_CONFLICT`。

### 4.3 Revoke

Authority Commit 前校验 Owner、Version 和当前 Revision。Commit 中把 Object 设为 REVOKED、CURRENT Revision 设为 WITHDRAWN、写 C58 和 C54。Commit 成功后所有 Authority Query 立即返回 0；Projection 清除、缓存失效和 Session 轮换是异步收口，但不能延迟 Authority 拒绝。

### 4.4 Historical Decision Recall

默认 Query 只读取 CURRENT。只有 `purpose=DECISION_RECALL` 且显式提供过去的 `valid_at` 时，才允许读取覆盖该时点的 SUPERSEDED Revision；返回项必须是 `temporal_role=HISTORICAL`，并重新校验 Evidence 当前访问权。

## 5. HTTP/API 映射

Contract 是稳定边界；以下 HTTP 是首期传输映射。所有 `/v1` 用户接口使用现有登录态，`tenant_id`、`principal_id`、`authorization_revision`、Owner 和 Personal Scope 均由服务端派生。

### 5.1 用户 API

| Method / Path | 能力 | Contract | 批次 |
| --- | --- | --- | --- |
| `POST /v1/memories` | 明确保存 Personal Memory | C45-C46、C58 -> C43-C44 | 01B |
| `GET /v1/memories` | 授权列表/搜索/筛选 | C50-C51 | 01C |
| `GET /v1/memories/:memoryId` | 详情、来源摘要、当前 Revision | C43-C45、C50-C51 | 01C |
| `GET /v1/memories/:memoryId/revisions` | 当前与受控历史展示 | C44、C50-C51 | 01C |
| `POST /v1/memories/:memoryId/revisions` | 创建修订 | C48、C58 | 01C |
| `POST /v1/memories/:memoryId/revoke` | 撤销 | C49、C58 | 01C |
| `POST /v1/memory-candidates/:memoryId/confirm` | 确认 Candidate | C47、C58 | 02 |
| `POST /v1/memory-candidates/:memoryId/reject` | 拒绝 Candidate | C47、C58 | 02 |
| `GET /v1/memory-usage` | 本人最近使用记录 | C53 | 01C |
| `GET/PUT /v1/memory-settings` | 个性化暂停/恢复 | Governance | 01C |

用户写接口要求 `Idempotency-Key`；Revise/Revoke body 还要求 `expected_object_version` 和 `expected_current_revision_id`。浏览器 body 不接受有效的 Owner、Tenant、AuthorizationRevision 或任意 Purpose。

### 5.2 内部 API/Port

| Port / Internal endpoint | 能力 | Contract | 调用者 |
| --- | --- | --- | --- |
| `MemoryAuthorityPort` | Create/Revise/Revoke/Get | C43-C49 | Memory Service only |
| `POST /v1/internal/memory/query` | 创建短期 Authorized View | C50-C51、C58 | API conversation orchestration |
| `POST /v1/internal/memory/context` | 预算、冲突处理和类型化 Context | C51-C52 | Conversation/Runtime Adapter |
| `POST /v1/internal/memory/usage` | 记录提供/引用结果 | C53 | Runtime response orchestration |
| `MemoryProjectionPort` | UPSERT/HIDE/DELETE/REBUILD | C54-C57 | Projection Worker |
| `MemoryExposurePort` | 派发前记录 Exposure | C59 | Context Dispatcher |
| `MemoryInvalidationPort` | Fence/Release/Rotate | C60 | Invalidation Worker |

Internal endpoint 仍需服务身份、可信 Principal Context 和 Deadline；不得把浏览器传入的 `purpose` 原样透传。

### 5.3 HTTP 和错误映射

| 结果 | HTTP |
| --- | ---: |
| 创建成功 | 201 |
| 幂等重放成功 | 原成功状态并标记 replay |
| 列表/查询成功 | 200 |
| 输入或未知枚举 | 400 |
| 未认证 | 401 |
| Scope/Purpose/Source Access 拒绝 | 403 |
| 不泄露存在性的 ID 访问 | 404 |
| Version/Revision/幂等 payload 冲突 | 409 |
| Deadline exceeded | 408 |
| Projection 暂不可用但 Authority 正常 | 503，仅影响检索，不放宽为未过滤查询 |

列表使用不透明 cursor，排序固定为 `updated_at desc, memory_id desc`。Cursor 绑定 Principal、Filter 和 Policy Revision，不能跨用户或修改过滤条件重放。

## 6. Event 与异步链路映射

### 6.1 Authority Event

C54 作为既有 C25 EventEnvelope 的 payload 发布，不新建第二套事件包络。建议事件名：

```text
pc.memory.created.v1
pc.memory.confirmed.v1
pc.memory.revised.v1
pc.memory.superseded.v1
pc.memory.revoked.v1
pc.memory.expired.v1
```

`stream_kind=MEMORY`、`stream_id=memory_id`、`stream_sequence=object_version`。每次 Object Version 事务只发布一条 C54：例如显式保存直接产生 `CONFIRMED`，不再为同一 Version 另发 `CREATED`；Revision 更新发布 `REVISED`，旧 Revision 的 SUPERSEDED 状态包含在 Authority 结果中。事件只携带 C54 的最小元数据和 refs，不携带 Memory 正文。Authority 写入与 Outbox 写入同事务；Worker 至少一次投递，消费者按 `event_id` 和 Object Version 幂等收敛。

`SOURCE_ACCESS_LOST` 不是 C54 change kind。它由现有 Identity/Authorization 或 Resource Access 变更事件触发重新判权，并映射为 C60 trigger；如需新增稳定 Memory Authority change kind，必须先修订 Contract，而不能在实现中私加枚举。

### 6.2 Projection 状态机

```text
C54 committed
  -> C55 operation PENDING
  -> Provider/SQL projection ACCEPTED
  -> C56 readback VERIFIED
  -> operation COMPLETE
```

`ACCEPTED`、超时和未知结果均不能直接变成 COMPLETE。旧队列恢复时必须重新读取 Authority Object Version；若 Revision 已 SUPERSEDED/WITHDRAWN 或 Object 已 REVOKED，旧 UPSERT 变为 HIDE/DELETE，不得复活正文。

### 6.3 Revoke 与 Session 轮换

```text
C49 Authority Commit
  -> C54 REVOKED/SUPERSEDED/SOURCE_ACCESS_LOST
  -> Authority Query immediately denies
  -> Projection HIDE/DELETE + readback
  -> lookup C59 exposures
  -> create C60 invalidations
  -> fence current Assignment Generation
  -> cancel/release affected DSH Session
  -> allocate new Generation + new DSH Session
  -> FRESH_SESSION_NO_REPLAY
  -> mark ROTATED or open RecoveryCase
```

任何非 `ROTATED` 状态都不能恢复旧 Session。进程重启时，未完成 C60 必须先恢复 invalidation worker，不能先 Resume Session。

## 7. PostgreSQL Lexical Baseline

检索顺序固定为：

1. Authority 前置过滤 Tenant、Principal、Scope、Object/Revision State、Sensitivity、Purpose；
2. Evidence Source Access Revalidation；
3. 对允许集合执行 PostgreSQL lexical ranking；
4. 依据 Kind、Valid Time、冲突、置信度和 token budget 做确定性排序；
5. 重新用 Authority ref 后置过滤；
6. 生成短期 C51 View。

首期 search document 由 Kind、`retrieval_summary` 和受控关键词构成，使用内建 `simple` 配置；中文内容额外生成确定性 CJK bigram token，以避免依赖未批准的数据库扩展。原始 `structured_content` 不为检索方便复制到多套索引。`pg_trgm`、Embedding 和 Graph 均后置到 MEMORY-04 评测。

Projection 失败时不允许回退到跨 Scope 全表查询、未经授权的 Provider top-k 或完整聊天历史。

## 8. Context 组装与安全

C52 以类型化数据段传给 Runtime，不与 System Prompt、用户输入或 Tool output 拼成同级指令。每项至少包含 Memory/Revision ref、Kind、Content、时间、Evidence 摘要、temporal role 和 usage constraints。

固定规则：

- Memory 文本一律视为不可信事实上下文；
- 不解析其中的 Tool Call、Role、Capability、MCP、审批或系统指令；
- 当前 Turn 明确输入优先于偏好类 Memory；
- 冲突、低置信、过期或 Evidence 失权时澄清或拒答；
- 派发 C52 前先持久化 C59；如果 C59 失败，不向 Runtime 发送 Context；
- C51/C52 到期、AuthorizationRevision 改变或 PolicyRevision 改变后必须重建。

## 9. 任务切分与停止线

### MEMORY-01A：Authority 与 Contract

| 子任务 | 内容 | 交付门 |
| --- | --- | --- |
| 01A-0 Contract Generation | C43-C60 JSON Schema、TypeScript、valid/invalid fixtures、manifest | 18/18 schema 和 fixtures；生成物 clean |
| 01A-1 Domain Core | `@pc/memory` 对象、状态机、错误、Ports | 无 Fastify/PG/DSH 依赖；状态不变量单测 |
| 01A-2 PostgreSQL Authority | `0001` migration、Repository、事务、CAS、幂等 | 真实 PostgreSQL 并发/重启测试 |
| 01A-3 Policy & Service | 可信 RequestContext、Owner/Scope/Purpose、Create/Revise/Revoke | 跨用户/管理员/伪造字段全部拒绝 |
| 01A-4 Event & Recovery | C54 Outbox、重试、命令结果恢复 | API/Worker/PostgreSQL 重启不重复写 |
| 01A-5 Verification/Handoff | 01A 证据、独立复核入口、01B Port 交接 | Product 全门不回退；停止，不接对话/Runtime |

01A 完成后必须停下来验收。不得顺带建立 UI、自动抽取、外部 Provider、Runtime Context 或真实员工数据。

### MEMORY-01B：显式保存、查询与 Runtime

| 子任务 | 内容 | 交付门 |
| --- | --- | --- |
| 01B-1 Explicit Capture | 对话“记住”意图到 C46；Evidence 回链 | 仅明确保存可 Confirmed；Secret 拒绝 |
| 01B-2 Authorized Query | C50-C51、PostgreSQL lexical projection、Source Revalidation | direct/list/search 全路径隔离 |
| 01B-3 Context & Usage | C52-C53、预算/冲突/abstention | Tool Set 不变；provenance 100% |
| 01B-4 Exposure & Rotation | C59-C60、Fencing、Fresh Session | SEC-MEM-013 至 016、021 通过 |
| 01B-5 Cross-session E2E | 新会话、退出重登、API/Runtime/PostgreSQL 重启 | 合成账号闭环；停止后验收 |

### MEMORY-01C：用户控制和独立验收

| 子任务 | 内容 | 交付门 |
| --- | --- | --- |
| 01C-1 Management UI | 列表、搜索、详情、来源、Revision、Usage | 桌面/移动端、可访问性、无正文越权 |
| 01C-2 User Control | 修改、撤销、暂停个性化 | 暂停不注入；撤销后全路径 0 返回 |
| 01C-3 PersonalMemoryEval | 60 场景确定性 Oracle，B0-B3 Harness | 安全硬门全部通过；质量阈值有实测依据 |
| 01C-4 Independent Acceptance | 独立 run_id、证据、缺陷回交 | 开发自测与独立结论分离 |

### 后续独立立项

- MEMORY-02：自动 Candidate、冲突整理和用户确认；
- MEMORY-03：Project/System Memory；
- MEMORY-04：外部 Vector/Graph/Context Provider PoC；
- MEMORY-05：Digital Impression；
- DELEGATE-01：Delegation Grant 和只读数字代理。

后续项目不得从 Personal Memory 自动获得授权或代表权。

## 10. 测试与证据门

### 01A 必须执行

- C43-C60 schema/fixture/generator gate；
- 状态机、Evidence 必需、双时间和内容不可变；
- 幂等相同 payload 重放、不同 payload 冲突；
- Revise/Revoke CAS 并发；
- 跨 Tenant、跨用户、Admin、伪造 Owner/Scope/Purpose；
- PostgreSQL transaction rollback、API/Worker/PostgreSQL 重启；
- C54 Outbox 无丢失、重复消费收敛；
- Product 既有 lint/typecheck/test/build 全量门禁。

### 01B/01C 才执行

- PostgreSQL lexical quality、Context token budget；
- Projection acceptance/readback/rebuild；
- C59/C60 Runtime Session 轮换；
- 浏览器体验和 60 场景 B0-B3 评测；
- 外部 Provider B4 不在 MEMORY-01。

证据目录按 task/run_id 隔离，报告不得包含 Secret、真实员工正文或模型隐藏推理。

## 11. 明确延期的决策

以下内容不阻断 MEMORY-01A，但进入真实员工试点前必须另行冻结：

- 数据保留期限、Legal Hold、离职和账号转移；
- 字段级加密、KMS、备份到期和物理擦除 SLA；
- Break-glass 是否存在及双人审批；
- 中文 tokenizer 的生产选型和外部 Provider 数据驻留；
- 自动 Candidate 的模型、阈值和人工确认体验；
- Project/System Memory 的 Publisher、Owner 和发布流程；
- Digital Impression 与 Delegation 的 HR、法务和员工代表评审。

延期项不得用默认值静默开放。未知状态、未知 Purpose 和未实现 Purpose 一律拒绝。

## 12. 开发启动门

开始 MEMORY-01A 编码前必须由负责人确认：

- [x] 本 Decision Pack 被接受，状态从 Proposed 改为 Accepted；
- [x] `memory_object_state` 与 `memory_revision_state` 的分离无异议；
- [x] 01A 业务实现只改 Product，当前既有工作区变更的归属保持不变；
- [x] 用户授权后在当前 Product 工作树继续，未创建提交或清理既有改动；
- [x] 真实 PostgreSQL 只使用无数据卷的隔离临时实例；
- [x] 不接入真实员工历史、外部 Provider、EE schema 或 DSH Core；
- [x] 01A 已在完成后停止，01B 先保持 On Hold。

MEMORY-01A 的开发启动门已经关闭，开发者验证见 `../product/docs/memory-01a-verification.md`。当前停止线为 `INDEPENDENT_REVIEW_NEXT / MEMORY-01B ON HOLD`。
