# ADR-0010：Identity、Authorization 与 External-System Registration

- 状态：Accepted
- 日期：2026-11-09
- 范围：T4.1、T4.2、T4.7、H1 至 H5、K1、K5
- 前置决策：ADR-0001 至 ADR-0009
- 用户决策：CQ-IAM-01=A、CQ-IAM-02=A、CQ-IAM-03=A、CQ-IAM-04=A、CQ-IAM-05=A、CQ-IAM-06=A
- 实施原则：本 ADR 冻结第一版技术边界，不直接授权修改 EE Claw、DSH、数据库或部署

## 1. 决策摘要

采用：

```text
PCPrincipal
+ verified ExternalIdentityLink
+ layered authorization
+ EE Claw-first Integration Registration Authority
+ Connector / Account / Credential separation
+ short-lived CredentialLease
+ execution-time reauthorization
```

核心结论：

1. PC 建立自己的稳定 Principal，不直接复用 EE Claw Cookie、Account ID 或飞书 ID 作为内部主键；
2. EE Claw Account、飞书 Identity 和其他 IdP 通过受验证的 ExternalIdentityLink 关联；
3. 禁止按邮箱、用户名、显示名或 caller-supplied `open_id` 自动链接；
4. PC 管 PC 资源、Task、Profile、Tool 和调用策略；
5. EE Claw 管自身账号、项目和业务对象权限；
6. Gateway 每次重新授权，源系统执行最终校验；
7. DSH Guard 只做 Runtime 本地门禁；
8. 企业连接先进入 EE Claw-first Integration Registration Authority；
9. Integration Control Plane 允许逻辑独立部署，不要求进入 EE Claw 单体；
10. PC 只保存 Connector 引用、能力快照、健康和调用策略，不复制长期 Secret；
11. 用户业务调用优先 Delegated/OBO，App-only 显式标记，遗留系统使用每用户 CredentialRef；
12. SCIM、OpenFGA、DPoP/mTLS 接口预留，首期不强制建设。

## 2. 权威边界

### 2.1 PC Principal Authority

持有：

- PCPrincipal；
- PC Session；
- ExternalIdentityLink；
- PC Role / Policy；
- Profile Assignment；
- Task / Project / Resource Scope；
- IdentityRevision 和 AuthorizationRevision；
- Subject / Actor 审计关联。

不持有：

- EE Claw 最终业务权限；
- 外部系统最终数据权限；
- 长期外部 Secret；
- 源系统 Role 的静默复制权威。

### 2.2 EE Claw

持有：

- EE Claw Account 状态；
- Role、Page、Action；
- 项目和业务对象权限；
- EE Claw 内部操作最终校验；
- 账号、Session 和访问审计。

### 2.3 Integration Registration Authority

持有：

- ExternalSystemDefinition；
- ConnectorDefinition；
- ConnectorRegistration；
- ExternalAccountBinding；
- CredentialBinding；
- CredentialLease；
- ConnectorCapabilitySnapshot；
- Secret/Vault 引用；
- Refresh、Rotation、Revocation 和 Health。

### 2.4 Runtime 与外部系统

- Runtime 只获得短期 Principal Envelope、CredentialRef 或 CredentialLease；
- MCP/Connector 校验目标 Token、Audience/Resource、Scope 和调用策略；
- 源系统保留最终 Allow/Deny；
- PC Allow 不能强迫源系统 Allow。

## 3. 身份对象

```text
PCPrincipal
- principal_id
- principal_type: human | service
- tenant_id
- lifecycle_status
- primary_identity_ref
- identity_revision
- authorization_revision
```

```text
ExternalIdentityLink
- identity_link_id
- principal_id
- identity_provider_ref
- issuer
- external_subject
- tenant_or_org_ref
- link_method
- verification_level
- status
- identity_link_revision
```

外部身份唯一键：

```text
issuer + external_subject + tenant_or_org_ref
```

`open_id` 是应用作用域标识，不能单独作为跨应用稳定身份。飞书场景优先使用受验证的 `union_id` 或 IdP Subject，但仍必须通过 Identity Link。

## 4. 身份链接

允许：

- IdP 签名回调；
- 已登录会话重新认证；
- 受控管理员绑定；
- 已验证邮件或一次性 Challenge。

必须校验：

- issuer；
- external subject；
- tenant/org；
- nonce；
- redirect target；
- link conflict；
- existing link ownership。

覆盖、解绑和重绑必须递增 Identity Revision、写审计并失效旧 Session/Decision/Lease。

## 5. 授权模型

有效能力是：

```text
PC platform policy
∩ EE Claw business authorization
∩ organization/project/task scope
∩ resource/tool/connector policy
∩ Profile requirement
∩ approval state
∩ runtime capability
∩ source-system final authorization
```

AuthorizationDecision 至少固定：

```text
subject_principal_id
actor_service_id
tenant/project/task/resource scope
operation + action_class
connector/account refs
identity_revision
authorization_revision
policy_model_revision
connector_revision
credential_generation
decision + reason_codes
evidence_refs
expires_at
```

Decision 是短期判断，不是长期凭据。

## 6. EE Claw Adapter

`EeClawAuthorizationAdapter` 读取：

- Account Active；
- Role、Page、Action；
- 已统一的 Project Grant；
- 业务对象权限；
- Revision 或版本摘要。

EE Claw 暂无统一 Revision 时：

- 写操作每次查询；
- 读操作只允许短 TTL；
- 记录 observed_at；
- 敏感操作在 Adapter 故障时 Fail Closed。

页面可见性不能替代项目、数据和操作权限。

## 7. Connector 模型

```text
ExternalSystemDefinition
→ ConnectorDefinition
→ ConnectorRegistration
→ ExternalAccountBinding
→ CredentialBinding
→ CredentialLease
```

ConnectorRegistration 至少绑定：

- tenant；
- environment；
- organization；
- endpoint/config ref；
- application identity；
- auth mode；
- credential binding ref；
- registration revision；
- capability snapshot；
- health/lifecycle。

Capability Snapshot 用于发现，不用于授权。

## 8. Credential 模式

### Delegated

用户业务操作优先 Token Exchange / OBO，绑定 Subject、Audience/Resource、Scope、Expiry 和 Generation。

### App-only

只用于明确不依赖用户业务权限的能力。审计必须显示 Credential Subject 为 Service，不能显示为用户本人执行。

### Per-user Legacy

不支持 OBO 的系统使用：

- ExternalAccountBinding；
- 每用户 CredentialRef；
- Broker 托管；
- 短期 Lease；
- 每次调用重新授权。

禁止 Token Passthrough。

## 9. 生命周期与撤权

以下变化先递增权威 Revision：

- 账号停用；
- Role/Permission 变化；
- Organization/Project Membership 变化；
- Identity Link 变化；
- Connector 停用；
- External Account Binding 变化；
- Credential Rotation/Revocation；
- Policy Model 变化；
- Profile Assignment 变化。

随后失效：

- Session；
- Authorization Decision；
- Effective Tool Set；
- Token Cache；
- MCP Session；
- Credential Lease；
- Durable Job 的运行授权。

已派发写操作进入 Reconciliation，不盲目重试。

## 10. 未来接口

```text
IdentityBrokerPort
IdentityLinkVerifier
OrganizationSyncProvider
AuthorizationDecisionPort
RelationPolicyBackend
EeClawAuthorizationAdapter
ConnectorRegistryPort
CredentialBrokerPort
SecretStorePort
CredentialRefreshProvider
ConnectorCapabilityProvider
RevocationEventConsumer
```

## 11. 验收要求

至少验证：

1. caller-supplied 外部 ID 不能成为可信 Principal；
2. 相同邮箱不同 Subject 不自动合并；
3. 链接覆盖需要确认或重新认证；
4. 解绑后旧 Session、Decision 和 Lease 失效；
5. EE Claw 账号停用后新操作立即拒绝；
6. 页面允许但项目拒绝时操作失败；
7. Profile Assignment 不会增加源系统权限；
8. App-only 审计不会显示成用户委托；
9. Audience/Resource/Scope 不匹配时拒绝；
10. Runtime、Prompt 和 Tool 参数中没有长期 Secret；
11. 旧 Credential Generation 被拒绝；
12. Connector Disabled 后发现和调用都失效；
13. Adapter 故障时敏感操作 Fail Closed；
14. 全链 Subject、Actor、Credential Subject 和 Source Decision 可关联。

## 12. 依据

正式证据：

- `reference-evidence-identity-authorization-external-registration.md`；
- `reference-evidence-final-architecture-domains.md`。

## 13. 非目标

本 ADR 不冻结：

- 具体 IdP、Vault、KMS、Policy Engine 或 iPaaS 产品；
- 数据库表和 API 路径；
- 组织架构业务规则；
- 管理页面；
- 首批连接器清单；
- DPoP/mTLS 启用时间；
- 现有 Demo 迁移。
