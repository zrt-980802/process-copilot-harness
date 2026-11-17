# ADR-0007：MCP Principal Envelope、用户委托与多 Session 隔离

- 状态：Accepted
- 日期：2026-11-06
- 范围：T4.3 至 T4.6、T5.1 至 T5.8、T9.3 至 T9.4、T11.2
- 前置决策：ADR-0001 至 ADR-0006
- 用户决策：CQ-M-01=A、CQ-M-02=A、CQ-M-03=A、CQ-M-04=A
- 实施原则：首期基线已冻结；DPoP、mTLS 和其他增强能力只保留接口，后续通过新 ADR 演进

## 1. 背景

Process Copilot 的同一个用户可以拥有多个 PC Session、多个 Runtime 和多个业务任务。每个 Session 又可能同时访问多个 MCP Server。

MCP 连接不能脱离用户、项目、Profile、审批、Assignment、Fencing 和授权版本独立使用。否则会出现：

- 不同用户共用 Token；
- 同一用户不同项目串用权限；
- Session A 使用 Session B 的 MCP 状态；
- 旧权限和旧凭据在撤权后继续生效；
- Runtime 故障恢复后重用旧 Token；
- 非幂等写操作因断线或 401 被重复执行。

本 ADR 定义 PC 到 MCP 的身份、凭据、连接、协议 Session、Tool 可见性、撤权和长调用边界。

## 2. 总体决策

采用：

```text
Process Copilot Authorization Service
        |
        | short-lived Principal Envelope
        v
PC Runtime Bridge / PC MCP Tool Provider
        |
        | Runtime Credential + Envelope
        v
PC MCP Gateway / Credential Broker
        |
        | audience/resource-bound downstream credential
        v
MCP Server / EE Claw Gateway
        |
        v
Authoritative Business System
```

权威边界：

1. PC Backend 持有用户、Session、Task、Project、Profile、Approval 和 Authorization Revision 权威；
2. Runtime 只持有短期 Envelope 和 CredentialRef，不持有企业系统长期 Token；
3. PC MCP Gateway 每次调用重新鉴权并取得下游凭据；
4. MCP Server 和业务系统执行最终权限校验；
5. Tool Discovery 过滤不能替代执行时授权；
6. 企业写操作继续校验 Assignment、Lease、Fencing、Approval 和幂等键。

## 3. 首期用户决策

### 3.1 CQ-M-01：下游凭据

首期选择 A：

```text
用户业务调用
→ Token Exchange / On-Behalf-Of 优先

明确的 App-only 能力
→ 服务凭据

不支持 Token Exchange 的遗留系统
→ 每用户 CredentialRef + Credential Broker
```

永久禁止把 PC 登录 Token、上游 IdP Token 或 EE Claw 登录 Token原样透传给任意 MCP Server。

### 3.2 CQ-M-02：Principal Envelope

首期选择 A：

```text
短期签名 Envelope
+ 服务端 Authorization / Credential / Approval Ref
+ 实时 Revision 校验
```

Envelope 提供调用来源和上下文，Gateway 的实时校验提供当前授权事实。

### 3.3 CQ-M-03：连接和协议 Session

首期选择 A：

```text
Stateless MCP 优先
+ Stateful MCP Session 按 PC Session 隔离
+ HTTP 连接满足安全条件时允许共享
```

用户权限不跟随物理连接，而是跟随每一次调用。

### 3.4 CQ-M-04：撤权时的在途调用

首期选择 A：

```text
未派发：立即拒绝
在途读取：尽力取消，撤权后不交付结果
未派发写入：立即拒绝
已派发写入：停止重试，进入 Outcome Unknown / Reconciliation
Durable Job：暂停并重新鉴权
```

系统不能把取消请求伪装成外部副作用已经停止。

## 4. 名词边界

| 对象 | 含义 | 是否是权限权威 |
|---|---|---:|
| PC Session | Process Copilot 的工作上下文 | 否 |
| MCP Protocol Session | 可选的传输协议状态 | 否 |
| HTTP Connection | 网络连接和连接池资源 | 否 |
| Token / Credential | 对特定主体、目标、范围和期限的授权材料 | 否 |
| Authorization Service | 当前用户、项目、角色和策略权威 | 是 |
| Authoritative Business System | 最终业务数据和操作权限权威 | 是 |

PC Session、MCP Session、HTTP Connection 和 Token 不能互相替代。

## 5. Subject、Actor 与 Credential Subject

严格区分：

```text
Subject
  最终业务权限所代表的用户

Actor
  当前代为执行的 PC 服务、Runtime 或 Agent

Credential Subject
  下游 Token 实际表示的主体
```

服务账号调用必须标记为 App-only，不能显示成用户委托调用。

审计链至少记录：

```text
subject_user
→ process_copilot_service
→ runtime
→ agent/profile
→ tool_call
→ downstream_credential_subject
→ authoritative_system
```

## 6. Principal Envelope

### 6.1 定位

Envelope 是一次调用的短期声明，不是永久授权。

它证明：

- 谁发起；
- 哪个 Runtime 和 Assignment 在执行；
- 属于哪个 Session、Task、Project 和 Profile；
- 目标是哪个 MCP Server 和 Tool；
- 签发时观察到哪个授权和凭据版本；
- 调用关联哪个 Approval、Operation 和 Trace。

Gateway 验证签名后仍必须读取当前权威状态。

### 6.2 概念字段

```text
PrincipalEnvelope
- envelope_version
- envelope_id
- issued_at
- not_before
- expires_at
- nonce

- tenant_id
- subject_user_id
- subject_external_account_ref
- actor_service_id
- actor_runtime_id
- actor_runtime_epoch

- pc_session_id
- task_id
- project_id
- business_object_refs
- expert_profile_release_id

- assignment_generation
- fencing_token
- authorization_revision
- workspace_view_revision
- policy_revision

- mcp_server_id
- tool_ref
- tool_schema_digest
- requested_action_class
- requested_scopes
- requested_resource_indicators

- approval_ref
- approval_parameter_hash

- tool_call_id
- operation_id
- idempotency_key
- trace_id
- span_id

- credential_ref
- credential_generation
- auth_mode
```

字段是技术要求，不代表数据库表或 JWT Claim 名已经冻结。

### 6.3 禁止携带

Envelope 不包含：

- 下游 Access Token 或 Refresh Token；
- Client Secret 或用户密码；
- 文件正文或完整 Tool 大参数；
- 长期 API Key；
- 完整权限列表；
- 敏感审批正文。

大对象使用稳定引用和 Hash。

### 6.4 生命周期

Envelope：

- 使用短 TTL；
- 不能跨 Runtime Epoch；
- 不能跨 Assignment Generation；
- 不能跨 Credential Generation；
- 不能在故障恢复时直接重用；
- 过期后必须重新签发和重新鉴权。

具体 TTL 由实现测试确定。

## 7. 凭据模式

### 7.1 Token Exchange / OBO

需要保留用户业务权限和用户审计主体时，使用：

```text
validated user assertion
→ Authorization Server / Security Token Service
→ audience/resource-bound delegated token
→ downstream MCP Server
```

下游 Token 至少绑定：

- Authorization Server Issuer；
- Subject；
- Actor / Client；
- Audience 或 Resource；
- Scope；
- Expiry；
- Credential Generation。

### 7.2 App-only 服务凭据

只用于：

- 公共目录同步；
- 系统健康检查；
- 不依赖用户业务权限的后台任务；
- 管理员明确批准的服务集成。

不得用服务账号静默替代用户权限。

### 7.3 遗留凭据

不支持 Token Exchange 的系统使用：

- 每用户外部账号绑定；
- Vault 中的 CredentialRef；
- 短期 Credential Lease；
- 每次调用前权限校验；
- Credential Generation 隔离。

静态 Token 不进入 Runtime Profile、Agent Prompt 或用户可编辑参数。

## 8. Token 缓存

最小缓存键：

```text
tenant_id
+ subject_user_id
+ external_account_ref
+ authorization_server_issuer
+ mcp_server_id
+ resource_indicator
+ normalized_scope_set
+ credential_generation
+ authorization_revision
+ token_binding_key_id
```

如果项目范围由 Token Claim 表达，还必须加入 `project_id` 或资源范围摘要。

同一用户的不同 PC Session 只有在完整键完全一致、当前授权仍有效时才可复用 Token。不能按 Server、Tenant 或用户单独缓存。

## 9. DPoP 与 mTLS Token Binding

普通 Bearer Token 类似“拿到门票即可使用”。如果 Token 被窃取，攻击者可能直接重放。

DPoP 和 mTLS 都把 Token 与调用方持有的私钥绑定：

### 9.1 DPoP

调用方每次请求时使用私钥生成请求证明。只有同时持有 Token 和对应私钥的一方才能使用该 Token。

### 9.2 mTLS

调用方在 TLS 握手时出示指定客户端证书。只有持有证书私钥的一方才能建立符合 Token 绑定要求的连接。

### 9.3 首期边界

本 ADR 只要求接口可以表达：

```text
binding_mode = bearer | dpop | mtls
binding_key_ref
certificate_ref
token_binding_key_id
```

首期仍允许：

```text
短期 Bearer Token
+ Audience / Resource 限制
+ Gateway 托管
+ 每次调用重新授权
```

首期不要求建设 DPoP 或 mTLS。未来只有在 Authorization Server、MCP Server 和企业基础设施均支持，且风险证据证明必要时，才通过新 ADR 启用。

## 10. 连接与 Session 隔离

### 10.1 简化判断

| 对象 | 首期规则 |
|---|---|
| PC Session | 不跨用户共享 |
| MCP Protocol Session | 不跨 PC Session 共享 |
| Token / Credential | 不跨安全缓存键共享 |
| HTTP Connection | 证明无连接级用户状态时可以共享 |

### 10.2 Stateless 优先

对新建 PC Gateway 和可控 MCP Server，优先：

```text
Stateless Streamable HTTP
+ per-request Authorization
+ PC Operation Ledger
```

用户权限和业务状态不保存在 MCP Protocol Session。

### 10.3 Stateful Session

Server 要求 `Mcp-Session-Id` 时，保存：

```text
McpProtocolSessionRecord
- mcp_session_id
- tenant_id
- subject_user_id
- pc_session_id
- mcp_server_id
- credential_generation
- authorization_revision
- created_at
- last_used_at
- expires_at
- status
```

任一安全字段不匹配都拒绝复用。

### 10.4 HTTP 连接

物理连接可以共享的条件：

- Authorization Header 每请求生成；
- 不使用用户 Cookie；
- 不使用连接级用户状态；
- 不使用用户专属 mTLS 证书；
- Server 不把连接本身当作用户身份；
- 缓存按 Principal 隔离；
- Trace 和审计按请求绑定。

以下情况必须按用户或 Credential Binding 隔离：

- 用户专属客户端证书；
- Cookie 或连接内状态表示用户；
- MCP Session 与连接绑定；
- 无法证明 Header 每次正确替换；
- 代理或响应缓存无法证明隔离。

如果实现团队无法证明可以安全共享，默认隔离。

### 10.5 分开建模

```text
McpClientInstance
  Server 元数据、协议能力和 Raw Catalog

McpProtocolSession
  可选协议状态

HttpConnectionPool
  网络复用

CredentialLease
  短期授权材料
```

关闭连接不等于撤销 Token；撤销 Token 也不等于外部操作已经停止。

## 11. Tool Catalog 与有效 Tool Set

```text
Raw MCP Catalog
∩ Connector Policy
∩ Expert Profile Release
∩ User / Tenant Permission
∩ Project / Resource Scope
∩ Tool Risk Policy
∩ Runtime Capability
= Effective Tool Set Snapshot
```

模型只看到当前有效 Tool，但 Gateway 仍在执行时重新校验。

稳定 ToolRef：

```text
ToolRef
- mcp_server_id
- raw_tool_name
- provider_release
- schema_digest
- risk_class
```

远端 `serverInfo.name` 不是稳定安全身份。

以下变化使 Tool Set 失效：

- 用户停用或项目移除；
- 角色和数据范围变化；
- Profile Release 变化；
- Connector 或 Server 禁用；
- Tool Schema 或风险分类变化；
- Credential、Approval 或 Policy 变化。

## 12. 撤权

每次 Tool Call 校验：

```text
authorization_revision
credential_generation
policy_revision
assignment_generation
fencing_token
```

撤权传播顺序：

```text
1. 权威 Authorization Revision 递增
2. Gateway 拒绝旧版本新请求
3. Token、Tool Set、Decision Cache 失效
4. Stateful MCP Session 关闭或标记 REAUTH_REQUIRED
5. Runtime 收到取消或刷新指令
6. Durable Job 暂停并重新鉴权
7. 已派发写操作进入对账
8. 写入审计和告警
```

不能先等待全部缓存清理完成，再改变权威版本。

权限、撤权或凭据权威查询失败时：

- 企业写操作 Fail Closed；
- 敏感读取 Fail Closed；
- 普通读取只有显式降级策略允许时才能继续。

## 13. 长调用、取消和重试

所有外部调用进入 Operation Ledger：

```text
operation_id
tool_call_id
mcp_server_id
tool_ref
schema_digest
subject_user_id
actor_service_id
credential_generation
authorization_revision
assignment_generation
fencing_token
idempotency_key
request_hash
status
external_ref
attempts
last_error_class
started_at
completed_at
```

必须遵守：

- Client Timeout 只表示停止等待；
- Cancel 是请求，不是完成事实；
- HTTP 断线不证明 Server 未执行；
- 401 刷新不等于写操作可以安全重放；
- 403 `insufficient_scope` 不静默扩大权限；
- 重连不自动重放企业写 Tool。

恢复分类沿用 ADR-0003：

```text
REPLAY_SAFE
IDEMPOTENT_RETRY
RECONCILE_BEFORE_RETRY
NON_RECOVERABLE
EXTERNAL_DURABLE_JOB
```

未声明分类的写 Tool 默认 `RECONCILE_BEFORE_RETRY`。

未知写结果：

```text
OUTCOME_UNKNOWN
→ query by operation_id / idempotency_key / external_ref
→ SUCCEEDED / FAILED / MANUAL_REVIEW
```

## 14. Durable Job

跨 Runtime 生存的工作使用：

```text
Durable Job
+ job_id
+ operation_id
+ authorization checkpoint
+ credential reacquisition
+ reconciliation
```

恢复时重新鉴权，不复用旧连接、旧 Envelope 或旧 Token。

## 15. DSH 无侵入实现

DSH `0.2.1-rc.3` 通用 MCP Client 使用每 Server 静态 Header 和受监督连接，不能直接承担多用户动态委托边界。

采用：

```text
PC Runtime Bridge / AgentPreset
        |
        v
PC MCP Tool Provider Plugin
  - discovery through PC Gateway
  - session-scoped Tool registration
  - ToolExecution → Principal Envelope
  - per-call Gateway invocation
        |
        v
PC MCP Gateway
```

DSH 已提供 `createMcpToolDefinition()` 和完整 `ToolExecution` 回调上下文。PC Plugin 可以在每次调用时解析 Session、Assignment 和授权信息。

现有通用 MCP Client 保留用于：

- 公共读取；
- Runtime 固定开发工具；
- 明确的 App-only 服务能力；
- 本地 stdio 辅助工具；
- 不接触企业权限的测试 Server。

当前不要求修改 DSH Core。

## 16. 审计

至少记录：

- EnvelopeIssued / Rejected；
- AuthorizationChecked；
- CredentialLeaseIssued / Refreshed / Revoked；
- TokenExchangeSucceeded / Failed；
- ToolCatalogFiltered；
- ToolCallAdmitted / Denied；
- ApprovalValidated；
- DownstreamDispatched；
- CancelRequested；
- OutcomeUnknown；
- Reconciled；
- ProtocolSessionOpened / Closed；
- CacheInvalidated；
- RevocationPropagated。

禁止记录：

- Access Token、Refresh Token 或 Subject Token；
- Client Secret；
- DPoP 私钥或 mTLS 私钥；
- 完整 Authorization Header；
- 未脱敏 Tool 参数；
- 完整用户文件正文。

## 17. 永久禁止

1. Token Passthrough；
2. 按 Tenant 或 Server 单独缓存用户 Token；
3. 把 MCP Session ID 当作用户身份；
4. 把 HTTP 连接当作授权作用域；
5. Runtime 持有企业系统长期凭据；
6. 服务账号静默替代用户委托；
7. Tool 未展示就视为无需执行授权；
8. 401 后无条件重放写 Tool；
9. 撤权后继续使用旧 Authorization Revision；
10. Cancel、Timeout 或断线被记录为外部副作用已停止；
11. Raw Token、Secret 或私钥进入日志；
12. 因用户作用域 MCP 需求直接推导修改 DSH Core。

## 18. 验收要求

至少验证：

- 不同用户不能共享 Token、协议 Session 或用户绑定连接；
- 同用户不同 PC Session 不串项目、Profile、Approval 或 Tool Set；
- HTTP 连接共享时 Authorization Header 按请求变化；
- Token 缓存缺少任一安全维度时测试失败；
- PC 登录 Token 不透传；
- Audience / Resource 不匹配时拒绝；
- 旧 Authorization Revision 和 Credential Generation 被拒绝；
- 用户停用和项目移除后新调用立即失败；
- 撤权会清除 Token、Tool Set、Decision 和协议 Session 缓存；
- 无权限 Tool 不进入有效 Tool Set；
- 隐藏 Tool 被直接调用时 Gateway 仍拒绝；
- Tool Schema 变化后旧 Schema Digest 失败；
- 401 刷新不绕过写操作恢复分类；
- 403 Step-up 不静默扩大 Scope；
- Cancel/Timeout 不伪造完成；
- Outcome Unknown 进入对账；
- Durable Job 恢复后使用新 Envelope 和 Credential Lease；
- Stateful MCP Session 与错误用户或 PC Session 组合时拒绝；
- 权限服务故障时写操作 Fail Closed；
- DSH Core 无修改时完成用户作用域 MCP 调用最小闭环。

## 19. 依据

正式证据卡见 `reference-evidence-mcp-multisession-auth.md`。

## 20. 未来演进

以下能力保留接口，但不是首期义务：

1. DPoP Sender-constrained Token；
2. mTLS Certificate-bound Token；
3. Enterprise-Managed Authorization；
4. 下游 MCP Server 原生 Fencing；
5. 分布式 Token Exchange Single-flight；
6. 跨区域授权缓存和撤权总线；
7. DSH upstream 动态 AuthProvider。

任何演进都必须新增 ADR，不能静默改变首期语义。

## 21. 实施授权

本 ADR 只冻结技术设计，不自动授权：

- 建设 PC MCP Gateway；
- 建设 Credential Broker；
- 接入 IdP 或 Token Exchange；
- 修改 EE Claw；
- 修改 DSH；
- 建设 Vault、Redis 或消息总线；
- 数据库迁移；
- 部署；
- 提交或推送。

实施必须等待全部技术 ADR、统一 DSH 无侵入审查和独立任务书。
