# ADR-0025 T0：Session、薄授权与 Provider 兼容合同冻结任务书

- 任务编号：`ADR-0025-T0-CONTRACT-AND-COMPATIBILITY-FIXTURE`
- 状态：`T0 COMPLETE / T1 NOT STARTED`（本地合同开发者验证；证据见 `product/docs/adr-0025-t0-verification.md`）
- 日期：2026-11-21（Asia/Shanghai）
- 架构依据：`architecture/ADR-0025-thin-session-authorization-legacy-provider-compatibility.md`（Accepted）
- 前置基线：`5ad4a094306921300811298c07f3e77e4d850b7b`；本任务书提交会位于该基线之后，不得为匹配基线而回退任务书
- 主工作仓库：`E:/shanzi_workspace/process-copilot-harness`
- 任务目标：只冻结 PC Session Assurance、薄授权 Decision 和 Legacy Provider Compatibility Mapping 的机器可读合同、矩阵与 golden fixture
- 完成性质：合同和兼容基线的本地开发者验证；不等于 T1 运行行为完成、真实 EE 联调通过或生产资格

## 1. 开始前必须读取

按顺序完整读取：

1. 工作区 `C:/Users/29557/Documents/ChatGPT/山子- PC/AGENTS.md`、`HANDOFF.md`、`workspace.paths.json`、`migration/source-snapshot.json`；
2. 仓库 `AGENTS.md`、`README.md`、`SOURCE-BASELINE.md`；
3. `governance/PROCESS-COPILOT-NEXT-PHASE-ROADMAP.md`；
4. ADR-0010、ADR-0014、ADR-0017、ADR-0024、ADR-0025；
5. `architecture/stable-contract-catalog-v1.md`、`architecture/external-provider-contract-catalog-v1.md`、`architecture/traceability-manifest-v1.json`；
6. C01、C02、C03、C32、C33、C34、C41、C42、C61、C62、C63、C65、C66 的 schema、fixture、生成定义和测试；
7. `product/docs/real-ee-integration-closure-01.md` 的 RCI-02 与 RCI-03；
8. 当前 Session、EE Login 和授权路由实现，仅用于盘点，不允许在 T0 修改。

开始工作前输出对齐块，至少确认：

- 当前仓库、分支、HEAD、remote 和工作树状态；
- ADR-0025 已 Accepted，T0 尚未开始；
- 当前 `PilotSession` 只有单一 `expires_at`，T0 只冻结未来合同，不改变其运行行为；
- 当前 `ee:` Session 每请求实时源 Session 校验导致 RCI-02，T0 不修复该行为；
- RCI-03 仍是独立 blocker，不纳入本任务；
- EE、DSH Core、数据库 schema、API、前端和运行环境均不在本任务修改范围。

## 2. 当前基线与合同缺口

### 2.1 已有事实

- PC 已持有 `PCPrincipal`、`PilotSession`、Authorization Revision 和 PC Policy；
- 外部登录签发的 PC Session 当前以外部 Session 到期和 PC 默认上限的较早者作为 `expires_at`；
- C63 已表达 `PC_ONLY | PC_AND_PROVIDER` 路由，但不记录一次完整授权决定；
- C41/C42 已冻结 EE V1 Authorization Decision 与零迁移兼容事实；
- C61-C66 已表达 Provider 注册、健康、路由、目录、能力和 Bundle generation；
- D3/D4A 已验证 PC-only 授权路由与 Provider Bundle 的基本边界；
- 当前真实联调仍因全局源 Session 校验导致 EE outage 阻断个人对话。

### 2.2 T0 必须闭合的缺口

1. 没有稳定合同表达 PC Session 的 authentication method、Identity Link、revision、idle expiry 和固定 absolute expiry；
2. 没有单一合同记录 `PC_ONLY`、`PC_AND_PROVIDER`、`DENY_UNKNOWN` 的完整决策证据；
3. 没有不可变合同表达 PC Action 到 EE V1 Permission/Action/Tool 的兼容映射发布物；
4. 现有测试没有把“同一逻辑请求内复用”和“禁止跨请求/Turn/Tool Call/Provider Generation 复用 Allow”固定成机器可检查规则；
5. EE V1 的 `page:*`、Deny 优先、请求时撤权与零迁移需要形成 ADR-0025 专属 golden matrix。

T0 只解决以上合同与测试缺口，不改变生产路径。

## 3. 冻结的合同候选

合同编号延续 C01-C66，T0 默认新增 C67-C69。若开始实施时发现编号已被合法占用，必须停止并报告，不能自行改号或覆盖。

### 3.1 C67 `pc.session-assurance/1`

用途：表达 PC 签发 Session 的身份保证、固定时限和 revision，不携带 Access Token、Provider Cookie、Provider Session ID 或长期凭据。

至少包含：

```text
contract_name
contract_version
session_assurance_id
pc_session_id
principal_id
tenant_id
authentication_method
identity_provider_ref
identity_link_id?
authentication_evidence_expires_at?
identity_revision
authorization_revision
assurance_level
issued_at
idle_expires_at?
absolute_expires_at
revoked_at?
session_state
evidence_refs[]
assurance_digest
```

必须由 schema 或语义测试固定：

- `absolute_expires_at > issued_at`；
- `idle_expires_at` 存在时不得晚于 `absolute_expires_at`；
- Provider-backed Session 必须携带 `authentication_evidence_expires_at`，且绝对到期不得晚于外部身份凭证到期与 PC 配置上限的较早者；
- 普通访问和 idle 续活不得改变 `absolute_expires_at`；
- Provider 不可达时不得签发新 Provider-backed Session 或跨越当前 absolute expiry 续期；
- Local/Standalone Session 不得伪造 `identity_link_id`；
- 合同中不得出现 Provider Session ID、Cookie、Token 或 Secret。

跨字段时间比较若不能由 JSON Schema 安全表达，必须由独立语义测试固定，不能只写在 Markdown 中。

### 3.2 C68 `pc.authority-decision/1`

用途：记录薄授权对一个 action/resource 的最终决策与证据链，不替代 C03、C41 或源系统最终判权。

至少包含：

```text
contract_name
contract_version
decision_id
principal_id
pc_session_id
tenant_id
logical_request_id
turn_id?
tool_call_id?
action
resource_ref
resource_authority
decision_mode
pc_policy_revision
identity_revision
provider_registration_id?
provider_bundle_generation?
provider_mapping_release_id?
provider_decision_ref?
provider_decision_observed_at?
decision
reason_codes[]
evidence_refs[]
observed_at
expires_at
decision_digest
```

固定三种模式：

| Mode | 必须结果 |
| --- | --- |
| `PC_ONLY` | 只允许 PC Policy + PC resource scope；禁止 Provider 决策字段和 Provider 调用证据 |
| `PC_AND_PROVIDER` | 必须同时绑定 PC Allow、当前 Provider generation、Mapping Release 和 Provider Decision；任一缺失均 Deny |
| `DENY_UNKNOWN` | unknown/ambiguous/missing authority 或 mapping 只能是 Deny，不得携带推测出的 Provider Allow |

同一个 Provider Decision 只能在相同 `logical_request_id`、Turn、Tool Call 和 Provider generation 所界定的同一个逻辑请求内复用。fixture 和语义测试必须证明任一边界变化后不能继续使用。

### 3.3 C69 `pc.provider-compatibility-mapping/1`

用途：把稳定 PC Action/Resource 映射到一个 Provider 的兼容授权协议。它是不可变发布物，不是 Grant、Allow 缓存或权限副本。

至少包含：

```text
contract_name
contract_version
mapping_release_id
provider_registration_id
provider_type
compatibility_version
pc_action_pattern
resource_authority
provider_permission_mapping
provider_action_mapping
provider_tool_mapping
decision_mode
artifact_digest
status
effective_from
supersedes_release_id?
```

必须固定：

- `ACTIVE` 发布物不可原地修改；变化生成新 release 和 digest；
- 缺失、重复、歧义、未知版本或 Authority 不匹配全部 Deny；
- Mapping 不能产生 PC Grant，不能保存 Provider Allow；
- Mapping 不包含 endpoint、Cookie、Token、Secret 或可编辑 EE 权限数据；
- EE V1 `page:*` 只按 `BASELINE_PAGE_KEYS_V1` 展开；
- 新 PC Action 不因已有 `page:*` 自动获得 EE 业务能力；
- 第二 Provider 新增独立 Mapping，不修改 PC Core Decision Mode。

## 4. 工作包与执行顺序

必须按 T0-0 -> T0-1 -> T0-2 -> T0-3 -> T0-4 -> T0-5 顺序执行。前一工作包未准出，不得更新后一工作包状态。

### T0-0：基线盘点与负空间冻结

1. 记录当前 HEAD、工作树和合同总数；
2. 盘点 C01/C03/C41/C42/C63 能表达与不能表达的字段；
3. 盘点当前 Session 签发、认证、撤销和 Provider 校验调用点；
4. 生成明确的 runtime no-touch 清单；
5. 先写失败测试或检查，证明 C67-C69 尚未存在且 T0 交付可被门禁识别。

准出：新增合同的必要性和与既有合同的关系明确；没有通过修改 C01/C03/C41/C42 major 语义来规避新合同。

### T0-1：决策矩阵与兼容矩阵

形成 `architecture/adr-0025-t0-contract-and-compatibility-v1.md`，至少包含：

- Session authentication method 与 assurance matrix；
- absolute/idle expiry、reauthentication 和 revocation matrix；
- PC_ONLY / PC_AND_PROVIDER / DENY_UNKNOWN 路由矩阵；
- Action namespace、resource authority 与 mapping release matrix；
- EE V1 `page:*`、精确 Allow、显式 Deny、项目成员、业务对象和 Tool 的兼容矩阵；
- Provider healthy/unavailable/generation-changed 下的 Decision 可复用矩阵；
- T1、T2、T3 的明确接口与非目标。

准出：任何 unknown、missing、ambiguous、expired、revoked 或 generation mismatch 都有唯一 Deny 结果。

### T0-2：生成 C67-C69

1. 将 C67-C69 加入合同定义生成源；
2. 生成 schema、valid fixture、invalid fixture、TypeScript interface 和 contract manifest；
3. 更新合同生成器、完整性检查和合同计数 66 -> 69；
4. 更新 stable/external Provider Contract Catalog；
5. 生成文件必须由现有生成命令产生，禁止手工维护生成结果造成漂移。

准出：`pnpm generate:contracts` 后工作树无二次漂移，`pnpm check:generated` 通过。

### T0-3：Golden fixture 与语义测试

至少增加以下 fixture/test：

| 场景 | 必须结果 |
| --- | --- |
| Provider-backed Session 固定 absolute expiry | valid；后续 observation 不改变 absolute expiry |
| idle expiry 晚于 absolute expiry | invalid |
| Session 合同包含 Provider Session/Cookie/Token | invalid 或敏感字段扫描失败 |
| Provider 不可达时创建/续期声明 | semantic fixture Deny |
| PC_ONLY 带 Provider Decision | invalid |
| PC_AND_PROVIDER 缺 PC Allow | Deny |
| PC_AND_PROVIDER 缺 Provider Decision/Mapping/generation | Deny |
| PC Allow + EE Deny | Deny |
| PC Deny + EE Allow | Deny |
| 同一逻辑请求内复用 Provider Decision | valid |
| 跨 HTTP 请求/Turn/Tool Call 复用 | Deny |
| Provider generation 变化后复用 | Deny |
| Mapping 缺失、重复、歧义、未知版本 | Deny |
| `page:*` + V1 baseline page | 保持现有行为 |
| `page:*` + 新 PC Action/新业务能力 | 不自动 Allow |
| Standalone Action | 不装配 EE Mapping，不产生 EE 调用声明 |

可使用确定性 fixture、fake 和 spy 证明合同语义，但不得把它们描述为真实 EE 集成验收。T0 不启动真实 EE、Docker、Runtime 或模型。

### T0-4：Traceability 与兼容治理

1. ADR-0025 Traceability 增加 C67-C69；
2. `implementation_status` 只有在全部 T0 门禁通过后才能更新为 `t0-contracts-complete-t1-not-started`；
3. Compatibility 检查固定 C41/C42 与 C67-C69 的关系；
4. Architecture 检查固定 25 ADR、69 Contract；
5. README/目录只更新合同和 T0 状态，不宣告 RCI-02 修复；
6. 不把 RCI-03 写成通过或降级为非 blocker。

### T0-5：验证与状态收口

形成 `product/docs/adr-0025-t0-verification.md`，记录：

- 实际修改文件；
- C67-C69 的最终字段和不变量；
- golden matrix 与测试命令；
- 通过数、跳过数和未执行项；
- runtime no-touch 审计；
- T1 准入条件和剩余风险；
- 本地提交、push、服务、数据库和外部环境状态。

完成后停止，不自动进入 T1。

## 5. 允许与禁止修改范围

### 5.1 允许

- `product/packages/contracts/` 的定义源、schema、fixture、生成 TypeScript、manifest 和合同测试；
- 必要的纯语义测试或 golden fixture；
- `architecture/` 下的合同目录、T0 矩阵、traceability 和兼容说明；
- `product/scripts/` 中只与合同计数、追踪和兼容门禁直接相关的检查；
- T0 验证文档和治理状态。

### 5.2 禁止

- `product/apps/api/src/main.ts`、`ee-login.ts`、`server.ts`、`workbench.ts`；
- `IdentityAuthorizationService`、Authority Router、Provider Bundle、Gateway、Runtime 或 Memory 的运行实现；
- API 路径、响应语义、登录流程、Session 校验位置或前端交互；
- 数据库 migration、schema、表、索引或数据；
- EE 源码、EE V1 API、8 张授权表、账号、角色、Permission 或审计数据；
- DSH Core、共享数据库、`.env`、端口、生产配置和 `192.168.31.95`；
- RCI-02 行为修复、RCI-03 投影修复、D4B 或 MEMORY-01B。

如果合同测试必须导入运行模块才能通过，先停止并报告；不得以 T0 名义顺手重构运行代码。

## 6. 全量准出条件

只有以下全部满足才能标记 `T0 COMPLETE / T1 NOT STARTED`：

1. C67-C69 名称、字段、major version 和不变量已冻结；
2. 每个合同都有 valid/invalid fixture、schema、manifest 和生成 TypeScript；
3. 合同总数、测试和门禁从 66 一致更新为 69；
4. Session 固定 absolute expiry 和 no-sliding 由语义测试证明；
5. PC_ONLY / PC_AND_PROVIDER / DENY_UNKNOWN 的条件由 schema 或语义测试证明；
6. Provider Allow 不可跨请求、Turn、Tool Call 或 generation 复用；
7. EE V1 `page:*`、Deny、请求时授权和零迁移 golden behavior 保持；
8. Traceability 将 ADR-0025 关联 C67-C69，但明确 T1 未开始；
9. runtime no-touch 审计证明禁止文件无差异；
10. 从 `product/` 执行 `pnpm check` 全部通过；
11. `git diff --check`、JSON 解析和敏感信息扫描通过；
12. 没有启动或修改 EE、Docker、数据库、Runtime、远端或演示环境；
13. 形成 T0 架构结果和验证记录；
14. 完成后停止，不自动实施 T1。

## 7. 停止与升级条件

出现以下任一情况立即停止并报告：

1. C67-C69 编号已被其他合法变更占用；
2. 必须破坏 C01/C03/C41/C42 既有 major 语义才能表达新合同；
3. 必须修改 Session、登录、授权、API、数据库或前端运行行为；
4. 必须修改 EE schema、EE V1 API、角色/权限数据或 DSH Core；
5. Mapping 只能通过复制 EE Allow、项目成员或 Role/Page/Action 到 PC 才能成立；
6. 无法稳定区分 PC-owned 与 Provider-owned Authority；
7. 无法让 unknown/missing/ambiguous mapping fail closed；
8. 发现与任务范围重叠的未知工作树改动，无法安全区分；
9. 测试需要共享数据库、生产服务或 `192.168.31.95`；
10. 需要进入 T1 才能让 T0 门禁通过。

## 8. T1 准入门槛

T0 完成不自动授权 T1。只有另行批准的 T1 任务书至少引用以下冻结结果后，才允许拆分 Session 验证：

- C67 的固定 absolute expiry 与 authentication method；
- C68 的三种 Decision Mode 和证据要求；
- C69 的不可变 Mapping Release；
- PC-owned Action 网络断言为零 Provider 调用；
- Provider-owned Action 的 PC + 当前 Provider 交集授权；
- EE outage、Session expiry、撤权、恢复和重登验收矩阵。

## 9. 交付报告格式

完成报告必须依次说明：

1. 结论：`T0 COMPLETE / T1 NOT STARTED` 或明确未完成；
2. C67-C69 最终摘要；
3. 修改文件与 runtime no-touch 结果；
4. 定向测试、全量测试和精确通过/跳过数；
5. golden fixture 覆盖和未覆盖项；
6. RCI-02/RCI-03 仍未修复的声明；
7. 本地提交哈希和工作树状态；
8. 是否 push、部署、启动服务、连接数据库或修改 EE/DSH。

默认允许全部验证通过后创建一个本地提交；不得 push、部署或自动进入 T1。

## 10. 可直接发送给主力开发的开场 Prompt

```text
执行任务 ADR-0025-T0-CONTRACT-AND-COMPATIBILITY-FIXTURE。

唯一任务书：
E:/shanzi_workspace/process-copilot-harness/governance/ADR-0025-T0-CONTRACT-AND-COMPATIBILITY-FIXTURE-TASK.md

主仓库：
E:/shanzi_workspace/process-copilot-harness

先完整读取任务书以及其中“开始前必须读取”的全部文件，核对当前分支、HEAD、remote 和工作树，再输出开始前对齐块。任务书提交位于业务基线 5ad4a09 之后，不要为了匹配该哈希回退任务书。

严格按 T0-0 至 T0-5 顺序执行。本任务只冻结 C67 pc.session-assurance/1、C68 pc.authority-decision/1、C69 pc.provider-compatibility-mapping/1，以及对应 schema、fixture、生成类型、golden matrix、traceability 和验证文档。

不得修改 Session、登录、授权、API、Workbench、Gateway、Runtime、Memory 或前端运行行为；不得修改 EE、DSH Core、数据库 schema、.env、端口、共享环境、生产设置或 192.168.31.95。不要启动 Docker、真实 EE、Runtime 或模型。fixture/fake 只能作为合同验证，不得冒充真实集成验收。

必须证明 fixed absolute expiry/no sliding、PC_ONLY/PC_AND_PROVIDER/DENY_UNKNOWN、Provider Allow 不跨请求/Turn/Tool Call/generation 复用、EE V1 page:* 与 Deny/零迁移兼容。完成 product/pnpm check、runtime no-touch 审计和验证文档后，只能标记 T0 COMPLETE / T1 NOT STARTED。

验证全部通过后可创建一个本地提交，但不要 push、部署或自动继续 T1。遇到停止条件时停止并报告，不要自行扩大范围。
```
