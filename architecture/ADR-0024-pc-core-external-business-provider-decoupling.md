# ADR-0024：PC Core 与外部业务平台解耦

- 状态：Accepted
- 日期：2026-11-17
- 范围：PC Identity、Authorization、Project Directory、Business Capability、Workbench Projection 与外部 Provider 路由
- 前置决策：ADR-0007、ADR-0008、ADR-0010、ADR-0012、ADR-0014、ADR-0015 至 ADR-0017、ADR-0018 至 ADR-0023
- 部分替代：ADR-0010 中 `EE Claw-first Integration Registration Authority` 作为运行时默认前提的部分；不替代 ADR-0010 的 Principal、Identity Link、分层授权、Credential 与源系统最终授权边界
- 当前实现证据：`product/apps/api/src/ee-login.ts`、`product/apps/api/src/main.ts`、`product/apps/api/src/workbench.ts`、`product/packages/application/src/eeclaw-adapter.ts`、`product/packages/application/src/identity-authorization.ts`
- 实施原则：本 ADR 只冻结目标边界和迁移门禁，不授权直接修改 EE schema、共享数据库、DSH Core 或生产部署

## 1. 背景

Process Copilot 的产品定位已经从 SSTS 专用工作台上升为公司级 Agent Harness。当前实现虽然具有独立的 `PCPrincipal`、PC Session、Authorization Grant、Runtime、Task、Memory、Approval 和 Audit，但运行装配仍存在 EE-first 耦合：

1. EE Session 是当前统一登录和逐请求 Session 校验的唯一企业入口；
2. `HttpEeClawAuthorizationAdapter` 作为全局 External Authorization Port 注册；
3. Workbench 项目目录直接来自 EE accessible-projects；
4. SSTS、Requirement、Function 和 Trace 等业务能力直接依赖 EE MCP；
5. EE Adapter 兼容校验失败可能阻止整个 API 启动，而不是只关闭 EE 能力。

这种装配适合首个纵向场景，不适合作为 Harness 的长期边界。PC 应能在没有 EE 的情况下提供个人对话、个人记忆、PC Task 和非 EE Plugin；连接 EE 后再增加 EE 项目和业务能力。

## 2. 决策摘要

采用：

```text
PC-owned Core Authorities
+ provider-scoped Identity
+ authority-routed Authorization
+ replaceable Project Directory
+ replaceable Business Capability Provider
+ replaceable Workbench Projection
+ capability-local fail closed
+ EE-Claw as the first external Provider
```

核心结论：

1. PC Core 不再以 EE Session、EE Project Directory 或 EE Adapter 健康作为启动前提；
2. PC 继续持有 PC Principal、Session、Policy、Task、Conversation、Memory、Runtime、Plugin、Tool、Approval 和 Audit 权威；
3. EE 继续持有 EE Account、项目成员、Role/Page/Action、业务对象和最终业务操作授权；
4. EE Login、Authorization、Project Directory、Business Capability 和 Workbench Projection 被拆成五类可替换 Port；
5. 身份 Provider 负责证明外部 Subject，不直接授予 PC Tool 或业务数据权限；
6. 授权按 action namespace、resource authority 和 connector registration 路由，不再让所有非个人 action 遍历全部外部授权端口；
7. PC Allow 不能覆盖外部 Provider Deny，外部 Provider Allow 也不能覆盖 PC Deny；
8. Provider 故障只关闭其拥有的能力，敏感业务操作 Fail Closed，PC Core 和其他 Provider 继续运行；
9. 不复制 EE 业务权限到 PC 形成第二权威；允许保存带 Revision、TTL 和证据引用的短期 Decision；
10. 不修改 DSH Core；Runtime 只消费 PC 签发的短期 Principal Envelope、Tool Set 和 Credential Lease。

## 3. 目标拓扑

```text
User / Enterprise IdP
          |
          v
Process Copilot Core
  +-- PC Principal and Session Authority
  +-- PC Policy and Authorization Revision
  +-- Conversation / Task / Memory / Approval / Audit
  +-- Plugin / Tool / MCP Registry and Gateway
  +-- Provider Router
          |
          +-- EE-Claw Provider
          |    +-- Identity Adapter
          |    +-- Authorization Adapter
          |    +-- Project Directory Adapter
          |    +-- Business Capability Adapter
          |    +-- Workbench Projection Adapter
          |
          +-- Other Business Provider
          |
          +-- Standalone / Local Provider
```

EE-Claw 是第一个 Provider，不再是 PC Core 的宿主或总权限中心。

## 4. 运行模式

### 4.1 Standalone

必须支持：

- 非 EE Identity Provider 或受控本地开发身份；
- 个人对话；
- PC Task；
- Personal Memory；
- 不依赖外部业务数据的 Plugin、Tool 和 MCP；
- PC Approval、Audit、Runtime 与 Session。

未注册的外部能力不得出现在 Effective Tool Set 中。

### 4.2 EE-connected

在 Standalone 能力之上增加：

- EE Identity Link 或 EE Login Provider；
- EE accessible projects；
- EE MCP Tool Catalog；
- EE Workbench Projection；
- EE 业务对象读写与最终源端授权。

EE 登录可以是一个身份入口，但不能成为所有 PC Session 的固定实现。

### 4.3 Multi-provider

同一 PC Principal 可以具有多个经过验证的 ExternalIdentityLink。每次调用必须根据资源 Authority 选择 Provider，禁止仅凭当前 UI 模式或 Tool 名称猜测目标系统。

## 5. 五类 Port

### 5.1 `IdentityProviderPort`

职责：

- 完成签名回调、票据交换、重新认证或受控本地认证；
- 返回可验证的 issuer、subject、tenant/org、authentication context、expiry 和 assurance；
- 校验或撤销由该 Provider 建立的外部认证上下文。

禁止：

- 直接写入 PC Role、Tool Grant 或项目业务权限；
- 按用户名、邮箱或显示名静默合并 Principal；
- 把外部 Cookie 或长期 Token 作为 PC Session 主键。

### 5.2 `EnterpriseAuthorizationPort`

职责：

- 对 Provider 拥有的 action/resource 做当前业务授权；
- 返回 Decision、reason、source revision/digest、evidence、observed_at 和 expiry；
- 支持撤权事件或严格短 TTL。

Port 只能收到路由给自己的请求。PC-only action 不得调用 EE Authorization Adapter。

### 5.3 `ProjectDirectoryPort`

职责：

- 返回当前 Principal 在该 Provider 下可访问的组织、项目和最小显示元数据；
- 标注 Provider、Authority、Revision 和观察时间；
- 不把目录可见性当作对象读写授权。

### 5.4 `BusinessCapabilityProviderPort`

职责：

- 发现和调用 Provider 拥有的 Tool/MCP 能力；
- 声明 action namespace、resource authority、read/write class、approval requirement 和 health；
- 通过 Gateway 使用短期 Credential，不向 Prompt、浏览器或 Runtime 文件系统暴露长期 Secret。

### 5.5 `WorkbenchProjectionPort`

职责：

- 把 Provider 的项目、角色和业务状态投影为 PC Workbench 可消费的只读视图；
- 返回 Projection Revision 和来源证据；
- 不授予额外权限，不替代 Project Directory 或 Authorization Decision。

## 6. 授权路由

每个受控调用先产生稳定的路由输入：

```text
subject_principal_id
action
action_namespace
resource_scope_refs
resource_authority
connector_registration_id?
business_task_id?
purpose
```

路由规则：

1. `resource_authority=pc`：只执行 PC Policy；
2. 单一外部 Authority：执行 PC Policy 与对应 Provider Decision 的交集；
3. 多 Authority 聚合读取：每个分片独立判权，结果携带来源，不允许一个 Provider 的 Allow 覆盖另一个 Provider 的 Deny；
4. 跨 Provider 写操作：首期禁止；未来必须使用 Durable Approval、Operation Ledger 和补偿策略；
5. Authority 缺失、重复、未知或路由不唯一：Fail Closed；
6. Capability Catalog 只用于发现，不能替代执行时授权。

有效能力仍遵循：

```text
PC platform policy
intersect selected provider business authorization
intersect task/resource/tool/connector policy
intersect approval state
intersect runtime capability
intersect source-system final authorization
```

## 7. 启动、健康与降级

Provider 必须有独立状态：

```text
UNCONFIGURED | STARTING | HEALTHY | DEGRADED | UNAVAILABLE | DISABLED
```

规则：

- 未配置 EE 时，PC API 和 Web 必须正常启动；
- EE Compatibility 或 Health 失败只把 EE Provider 标为不可用；
- EE Tool 不进入新的 Effective Tool Set，已有短期 EE Decision、Lease 和 MCP Binding 失效；
- 已派发且结果未知的 EE 写操作进入 Reconciliation，不自动改判失败或盲目重试；
- PC-only Conversation、Memory、Task 和非 EE Provider 不受影响；
- 前端基于 Capability Availability 呈现状态，不伪造成功或隐藏已发生的失败。

## 8. 身份与撤权

PC Session 绑定：

- PC Principal；
- Identity Provider ref；
- authentication context；
- Identity Revision；
- Authorization Revision；
- assurance 和 expiry。

以下变化必须递增相应 Revision 并失效受影响对象：

- Identity Link 解绑或重绑；
- Provider Session 撤销；
- PC Policy、Role 或 Tool Grant 变化；
- 外部账号停用、项目成员或业务权限变化；
- Connector、Credential 或 Capability Release 变化；
- Provider 从 HEALTHY 进入 DISABLED，或撤权信号要求立即失效。

失效范围至少包括 Authorization Snapshot、Principal Envelope、Effective Tool Set、Runtime Assignment、MCP Binding、Credential Lease 和未开始的 Durable Job。

## 9. 数据与审计边界

PC 可以持久化：

- ExternalIdentityLink；
- Connector Registration；
- Provider capability snapshot；
- 短期 Authorization Decision 及其 digest/revision/evidence；
- PC 自己的 Grant、Approval、Operation 和 Audit；
- 外部对象的稳定引用和受控 Projection。

PC 不得持久化为权威：

- EE Role/Page/Action 的可编辑副本；
- EE 项目成员关系的第二套真相；
- EE 业务对象最终读写权限；
- 外部长期 Credential 明文。

审计必须能回答：谁以什么身份、经哪个 Provider、对哪个 Authority 的资源、依据哪些 PC 和源端 Decision、通过哪个 Tool/MCP、产生什么最终结果。

## 10. 迁移顺序

### D0：合同与调用清单

- 冻结当前 EE 登录、授权、项目目录、Catalog 和 Workbench 调用；
- 建立 action namespace 与 resource authority 表；
- 增加 Provider 路由、健康和可用性 Contract；
- 不改变当前用户行为。

### D1：行为保持的 Port 拆分

- 从当前 EE 组合实现拆出五类 Port；
- EE 仍为唯一已配置 Provider；
- golden tests 保证现有 EE-connected 流程不变。

### D2：PC Core Standalone

- 增加非 EE Identity Provider；
- PC-only action 不再触发 EE 判权；
- 未配置 EE 时 PC 正常启动；
- 禁止自动授予企业 Tool。

### D3：Authority Router 与能力降级

- 用稳定 Router 替换全局 External Authorization Port 遍历；
- Tool Catalog、Project Directory 和 Workbench 按 Provider 装配；
- Provider 故障只降级其能力。

### D4：EE Provider 收口

- EE Adapter 成为正式 Provider Bundle；
- 保留 C41/C42 兼容与请求时授权；
- 不修改 EE V1 schema 和既有业务权限语义。

### D5：独立验收与迁移完成

- Standalone、EE-connected、EE outage 和 multi-provider routing 验收；
- 旧全局 EE 装配路径删除前保留可回滚开关；
- 通过后再决定 MEMORY-01B 是否恢复。

## 11. 验收要求

1. 不配置 EE 时，PC API、Web 和 Runtime 控制面可启动；
2. 非 EE 用户可使用个人对话、个人记忆、PC Task 和非 EE Plugin；
3. PC-only action 不调用 EE Login、Authorization 或 Project Directory；
4. EE action 必须同时获得 PC Allow 与 EE Allow；
5. PC Deny 覆盖 EE Allow，EE Deny 覆盖 PC Allow；
6. 未知或歧义 Authority 稳定拒绝；
7. EE 不可用时 EE 能力 Fail Closed，PC Core 继续工作；
8. EE 撤权后旧 Snapshot、Runtime Assignment、MCP Binding 和 Credential Lease 失效；
9. Project Directory 可见不能替代对象读写授权；
10. Profile、Memory 和 Workbench Projection 不能增加 Tool 或业务权限；
11. 多 Provider Identity Link 不按邮箱或用户名自动合并；
12. 审计可关联 PC Subject、Identity Provider、Resource Authority、Provider Decision 和最终 Operation；
13. 当前 EE-connected 演示账号和业务语义在 D1/D4 后保持兼容；
14. 全量 Contract、Architecture、Lint、Typecheck、Unit、PostgreSQL、断网和重启门禁通过。

## 12. 永久禁止

1. 不得把 EE Cookie、Session ID 或 Account ID 直接作为 PC Principal；
2. 不得把所有 PC action 默认路由到 EE；
3. 不得以 Capability Catalog、页面可见性或 Project Directory 代替执行时授权；
4. 不得复制 EE 业务权限并让 PC 成为并列最终权威；
5. 不得在 Provider 故障时扩大权限或复用过期 Decision；
6. 不得让 EE outage 阻止纯 PC 能力启动；
7. 不得把长期外部 Secret 放入浏览器、Prompt、Tool 参数或 Runtime Workspace；
8. 不得以解耦为由修改 DSH Core；
9. 不得在本 ADR 下修改 EE schema、共享数据库或生产配置；
10. 不得在没有 Operation Ledger 和 Reconciliation 的情况下实现跨 Provider 写入。

## 13. Contract 与模块影响

复用：

- C01 Request Context；
- C02 Principal Envelope；
- C03 Authorization Snapshot；
- C04 Credential Lease Ref；
- C15 Tool Release；
- C16 Plugin Release；
- C21/C22 Tool Execution；
- C23 MCP Session Binding；
- C24 External Operation；
- C32 Audit Entry；
- C33 Compatibility Declaration；
- C41/C42 EE Authorization 与 Legacy Compatibility；
- C43-C60 Memory Authority 与 Context 边界。

首批 D0 Contract 已冻结为 C61-C65：Provider Registration、Provider Health、Authority Route、Project Directory Snapshot 和 Capability Availability。其字段与评审结论见 `external-provider-contract-catalog-v1.md`；D0 只建立边界，不改变现有运行行为。

主要影响模块：M01、M02、M03、M07、M08、M11、M14、M16、M21、M22；Memory M23-M29 只消费 PC Authorization Port，不直接依赖 EE Provider。

## 14. 非目标

- 建设全公司的通用 IAM 产品；
- 把 EE 平台账号和权限数据整体迁移到 PC；
- 本轮实现 SCIM、OpenFGA、OPA 或新的企业 IdP 产品；
- 修改 EE V1 授权表和 API；
- 实现跨 Provider 分布式事务；
- 恢复 MEMORY-01B；
- 远程部署或生产切换。
