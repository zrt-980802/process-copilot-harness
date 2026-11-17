# Identity、Authorization 与 External-System Registration 参考证据

> 状态：Accepted Evidence
> 日期：2026-11-09
> 关联范围：T4.1、T4.2、T4.7、H1 至 H5、K1、K5
> 关联决策：ADR-0010
> 说明：本文件已通过用户全 A 决议进入第一版正式证据库。

## 1. 证据结论摘要

1. EE Claw 当前主工作树已经具备真实平台账号、密码哈希、Cookie Session、CSRF/Origin、角色、页面/动作权限、会话撤销、账号停用和访问审计；
2. 当前主工作树的页面/动作 RBAC 是平台级权限，不等于完整组织、项目、业务对象和字段级授权；
3. OTA 项目级 `view/edit` Grant、`authz_revision`、`enforce/deny_all` 和 Fail Closed Guard 已在提交 `a6076144` 实现，但该提交不在当前 `HEAD`，且主要接入 OTA 路由，不能描述为全系统项目授权；
4. EE Claw 的飞书集成持有 `open_id` / `union_id`，但尚无可信的平台账号到飞书账号绑定流程；
5. 部分业务入口仍接受 `X-Open-Id` 或请求体身份字段，这些字段不能直接升级为可信 Principal；
6. 当前飞书调用使用环境变量中的应用凭据，是 App Identity，不是每用户委托凭据；
7. 当前没有统一 OIDC Identity Broker、SCIM 组织同步、Connector Registry 或 Credential Broker；
8. Keycloak 证明外部身份链接应经过确认、邮件验证或重新认证，不能按用户名/邮箱自动合并；
9. Nango 证明连接身份、加密凭据、刷新状态、并发刷新、失败退避和连接生命周期审计需要独立建模；
10. OpenFGA 证明授权模型版本、关系事实和请求上下文应分层，检查必须固定模型版本并支持当前关系事实。

## REF-IAM-001：EE Claw 平台账号、会话、RBAC 与审计

```text
reference_id: REF-IAM-001
product_tree_node: T4.1 / H1-H5 / K1
repository: E:/shanzi_workspace/feishu-ee-agents
current_head: 29fb7ec26a02cff28fff7dc86d7c62268b23a498
license: internal repository
technology_stack: Python / Flask / MySQL / Vue
evidence_level: R3 for implemented platform auth; R2 for branch-only project scope
adoption_decision: adopt facts / adapt boundaries
```

### 当前主工作树检查路径

- `docs/features/platform-account-rbac.md`
- `docs/issues/platform-account-rbac-known-issues.md`
- `backend/platform_auth/schema.py`
- `backend/platform_auth/security.py`
- `backend/platform_auth/store.py`
- `backend/platform_auth/service.py`
- `backend/platform_auth/api.py`
- `backend/platform_auth/middleware.py`
- `backend/platform_auth/resources.py`
- `backend/platform_auth/audit.py`
- `backend/architecture_configuration_integration.py`
- `frontend/src/auth/store.js`
- `frontend/src/auth/rolePermissions.js`
- `frontend/src/auth/navigation.js`
- `backend/tests/platform_auth/`
- `backend/tests/scenarios/test_platform_auth_mysql.py`
- `backend/tests/scenarios/test_platform_access_audit_mysql.py`
- `frontend/tests/platform-auth.spec.js`
- `frontend/tests/platform-access-audit.spec.js`

### 已确认实现

```text
platform_accounts
  password_hash = Werkzeug scrypt
        |
        v
platform_auth_sessions
  token_hash + csrf_hash
        |
        v
HttpOnly eea_session Cookie
+ readable eea_csrf Cookie
+ X-CSRF-Token
+ Origin validation
        |
        v
platform_roles
+ platform_permissions
+ platform_account_roles
+ platform_role_permissions
        |
        v
server-side page/action authorization
+ account/session lifecycle
+ append-only access audit
```

已实现的安全事实：

- 数据库只保存 Session Token 和 CSRF Token 的摘要；
- Session Cookie 为 HttpOnly；
- 写请求校验 Origin、CSRF Cookie、Header 和 Session 绑定摘要；
- 账号停用、改密、重置密码和管理员操作可以撤销 Session；
- 每次请求读取当前权限，不依赖长期前端权限缓存；
- 页面与 API 权限由服务端判断，401 与 403 分离；
- 登录、退出、失败、页面访问、API 完成和权限拒绝进入访问审计；
- 审计不保存 Cookie、Authorization、CSRF、密码和请求/响应正文。

### 当前权限边界

当前主模型是：

```text
PlatformAccount
→ Role
→ page:* / page:<module>
→ action:* / action:<operation>
```

它适合：

- Web 登录和账号生命周期；
- 顶级页面可见性；
- 平台管理动作；
- 部分工程编辑动作；
- 访问审计。

它尚不能自动证明：

- 组织、部门和岗位成员关系；
- 所有模块统一的项目范围；
- 业务对象级和字段级权限；
- 外部系统账号绑定；
- 跨系统委托授权；
- Connector 和 Credential 权限；
- 统一 Authorization Revision。

### 项目范围分支证据

提交：

```text
a6076144a2a50f55c1b3d38eca2da97ac0f0d97b
feat(ota): project-scoped OTA external evidence foundation (#281)
```

关键路径：

- `backend/platform_auth/project_scope.py`
- `backend/platform_auth/schema.py`
- `backend/platform_auth/store.py`
- `backend/platform_auth/middleware.py`
- `backend/admin_api.py`
- `backend/tests/platform_auth/test_project_scope.py`
- `docs/tasks/integration-requests/INT-PLATFORM-AUTH-PROJECT-SCOPE-001.md`

已实现：

- `platform_project_grants`；
- `view/edit` Grant；
- `authz_revision`；
- `enforce/deny_all`；
- 空 Grant 默认无权；
- 状态读取失败时 Fail Closed；
- Revision 参与缓存失效；
- 项目范围拒绝和管理动作审计。

证据限制：

- `git merge-base --is-ancestor a6076144 HEAD` 返回否；
- 当前 `HEAD` 不包含 `backend/platform_auth/project_scope.py`；
- 路由接入主要位于 OTA；
- 不能把这项实现描述为当前主分支的全模块项目授权。

### 验证状态

项目文档记录：

- 平台认证、RBAC、Web 工作台和访问审计已完成真实 MySQL 与浏览器自验证；
- `P3-SHARED-AUTH-RBAC-001`、`P3-SHARED-AUTH-WEB-002`、`P3-SHARED-ACCESS-AUDIT-003` 已完成；
- 最终全链 `P3-SHARED-AUTH-E2E-004` 曾受 Neo4j 环境阻塞；
- 本批不重新修改或运行 EE Claw；
- 当前环境缺少 `FEISHU_APP_ID` 时，部分测试在收集阶段失败，这不是核心认证代码回归证据。

### 可直接采用的事实

1. EE Claw 账号和 Session 是真实实现，不是 Demo 占位；
2. 平台页面/action 权限可以作为 EE Claw 内部授权事实来源之一；
3. 账号停用和 Session 撤销必须传播到 Process Copilot；
4. 访问审计已有可复用的事件和脱敏纪律；
5. 项目授权需要稳定 Project Scope、Revision 和 Fail Closed，而不能只依赖页面权限。

### 不可直接推导

- 不能把 EE Claw Cookie 直接作为 Process Copilot 或 MCP Token；
- 不能把 `page:*` 当作业务对象权限；
- 不能把 OTA 项目 Grant 当作所有模块统一实现；
- 不能把前端隐藏菜单当作授权；
- 不能把访问日志当作完整跨系统业务审计；
- 不能把本地开发 Auth Bypass 带入目标架构。

## REF-IAM-002：EE Claw 飞书身份与应用凭据现状

```text
reference_id: REF-IAM-002
product_tree_node: T4.1 / T4.2 / K5
repository: E:/shanzi_workspace/feishu-ee-agents
baseline_commit: 29fb7ec26a02cff28fff7dc86d7c62268b23a498
evidence_level: R2
adoption_decision: adopt gaps / reject caller identity trust
```

### 检查路径

- `backend/config.py`
- `backend/ws_bot.py`
- `backend/feishu/tools_impl.py`
- `backend/feishu/sender.py`
- `backend/admin_api.py`
- `backend/agent/runner.py`
- `backend/eea/regulations/standard_package_web_service.py`
- `backend/eea/projects/topology_design/web_service.py`
- `docs/modules/m1-requirements/eea-requirements-issue-log.md`

### 已确认事实

- 飞书消息入口可以取得 `open_id` 和 `union_id`；
- `union_id` 更适合跨应用用户关联，`open_id` 是应用作用域标识；
- 当前 Web 业务路径中仍存在读取 `X-Open-Id`、请求体 `open_id` 或 `union_id` 的实现；
- 飞书 Client 使用 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`；
- 当前凭据代表企业应用，不代表每个 EE Claw Web 用户；
- 未发现平台账号与飞书身份之间的验证、确认、解绑、重绑和冲突处理权威；
- 未发现统一 OIDC Broker、SCIM 同步、Connector Registry 或 Credential Broker。

### 架构约束

1. `X-Open-Id`、请求体 `open_id` 和 `union_id` 只能作为未经验证的输入；
2. 飞书回调中的签名验证身份与 Web 调用中的自报身份必须分开；
3. `open_id` 不能作为跨应用稳定主键；
4. 外部身份必须关联到内部稳定 Principal；
5. App Credential 必须显式标记为 App-only；
6. 需要用户权限时，不能用 App Credential 静默替代用户委托；
7. 身份绑定变更必须产生 Revision、审计和 Session/Token 失效。

## REF-IAM-003：Keycloak Identity Brokering 与安全账号链接

```text
reference_id: REF-IAM-003
product_tree_node: T4.2 / K5
candidate_repository: keycloak/keycloak
baseline_commit: d4d55541da034a55a785c09922fcd62e51cd5bde
license: Apache-2.0
technology_stack: Java / OIDC / SAML / Identity Broker
evidence_level: R2
adoption_decision: adopt / adapt
```

### 检查路径

- `docs/documentation/server_admin/topics/identity-broker/overview.adoc`
- `docs/documentation/server_admin/topics/identity-broker/first-login-flow.adoc`
- `docs/documentation/server_admin/topics/identity-broker/client-initiated-account-linking.adoc`
- `docs/documentation/server_admin/topics/identity-broker/logout.adoc`
- `docs/documentation/server_admin/topics/identity-broker/tokens.adoc`
- `docs/documentation/server_development/topics/identity-brokering.adoc`
- `docs/documentation/server_development/topics/identity-brokering/account-linking.adoc`
- `js/apps/account-ui/test/account-security/linked-accounts.spec.ts`

### 已确认机制

```text
Local Principal
        |
        +-- Federated Identity Link
                provider alias
                external subject
                external username
                token/session metadata
```

First Broker Login 流程支持：

- 新建本地账号；
- 检测可能存在的账号；
- 用户确认是否链接；
- 邮件验证；
- 重新认证现有账号；
- 覆盖已有链接前再次确认。

文档明确警告：

- 在允许用户自助注册任意用户名或邮箱的环境中，AutoLink 是危险的；
- 自动按邮箱或用户名链接不能作为通用默认；
- 安全链接需要确认、受信验证或重新认证。

### 可借鉴

1. 内部 Principal 与外部身份链接分离；
2. Provider + External Subject 形成外部身份唯一性；
3. 首次登录与主动链接使用不同流程；
4. 冲突、覆盖、解绑和重绑需要显式确认；
5. Session/Token 撤销是独立控制，不由账号链接自然替代。

### 不可直接照搬

- Keycloak Realm、Client、Role 和 Flow 配置不等于我方业务权限；
- Keycloak 不替代 EE Claw 和源系统的最终业务授权；
- 本批不决定必须部署 Keycloak；
- 不能复制其数据库模型作为 Process Copilot Schema。

## REF-IAM-004：Nango Connector、Credential Encryption 与 Refresh Lifecycle

```text
reference_id: REF-IAM-004
product_tree_node: T4.2 / K5
candidate_repository: NangoHQ/nango
baseline_commit: ca937eecd79fa19b509c38df6a88a49f20e22fc6
license: Elastic License 2.0
technology_stack: TypeScript / PostgreSQL / OAuth / Integration Platform
evidence_level: R2
adoption_decision: compare_only / adapt concepts
```

### 许可证边界

Elastic License 2.0 不作为直接复制代码的默认来源。本批只比较对象和生命周期。

### 检查路径

- `packages/shared/lib/services/connection.service.ts`
- `packages/shared/lib/services/connections/credentials/refresh.ts`
- `packages/shared/lib/services/connections/utils.ts`
- `packages/shared/lib/utils/encryption.manager.ts`
- `packages/server/lib/middleware/audit/connection.middleware.ts`
- `packages/database/lib/migrations/20221026075018_create_connection.cjs`
- `packages/database/lib/migrations/20241024094439_connections_end_user.cjs`
- `packages/server/lib/controllers/v1/connections/connectionId/postRefresh.ts`

### 连接身份

连接唯一性至少包含：

```text
environment_id
+ provider_config_key
+ connection_id
+ optional end_user_id
```

这说明：

- Connector Definition；
- 环境/租户 Registration；
- 用户 External Account Binding；
- 实际 Connection；

不应压缩为一个对象。

### 凭据存储

`EncryptionManager` 对连接 Credentials 使用：

```text
encrypted_credentials
+ credentials_iv
+ credentials_tag
```

Provider Client Secret、环境变量和 API Secret 也有独立加密元数据。

可借鉴：

- Secret 与业务对象分离；
- 只返回 CredentialRef 或脱敏状态；
- 加密材料包含 IV/Tag；
- 轮换和加密状态需要显式生命周期。

不可照搬：

- 具体 DEK、数据库加密流程和密钥轮换限制；
- 把加密后的 Secret 直接暴露给 Runtime；
- 以单一数据库加密替代 Vault/KMS、访问控制和审计。

### Refresh 生命周期

源码记录：

- `credentials_expires_at`；
- `last_refresh_success`；
- `last_refresh_failure`；
- `refresh_attempts`；
- `refresh_exhausted`；
- 失败 Cooldown；
- 手动刷新绕过普通 Cooldown；
- 并发 Refresh 的 in-flight collapse；
- 分布式 Lock；
- Refresh 成功/失败 Hook 与日志。

这证明 Credential 生命周期必须独立于 Connector Registration。

### 连接审计

连接中间件定义：

- `connection.created`；
- `connection.updated`；
- `connection.metadata_updated`；
- `connection.refreshed`；
- `connection.deleted`。

审计记录环境范围、Actor、Target、Provider Config 和变更字段。

### 风险与限制

- Refresh Token Rotation 和并发刷新存在复杂竞态；
- 连接平台的“已刷新”不自动证明最终业务权限仍然有效；
- Nango 的 Connection 权限模型不等于 Process Copilot 的用户、项目和审批模型；
- ELv2 使其更适合 `compare_only / adapt`。

## REF-IAM-005：OpenFGA 授权模型版本与关系检查

```text
reference_id: REF-IAM-005
product_tree_node: T4.1 / T4.2 / H4
candidate_repository: openfga/openfga
baseline_commit: 4b09dafb027d839e6c42073e6e288f5ea6881d4d
license: Apache-2.0
technology_stack: Go / gRPC / ReBAC
evidence_level: R2
adoption_decision: adapt / compare_only
```

### 复用证据

本证据复用 `reference-evidence-expert-profile-technical-model.md` 的 `REF-EP-003`：

- Authorization Model 每次写入生成不可变 Model ID；
- Check 使用精确 Authorization Model ID；
- 持久 Relationship Tuple 与请求 Contextual Tuple 分离；
- 支持 Union、Intersection、Difference 和 Conditions；
- Higher Consistency 可以绕过普通缓存；
- 当前关系事实和模型版本共同参与授权。

### 对本批的约束

1. Policy Model、Role/Relation Fact 和请求 Context 必须分层；
2. Authorization Revision 不能只存在于前端；
3. Project、Organization、External Account 和 Connector 权限应使用稳定对象引用；
4. 缓存键必须包含授权模型版本和关系 Revision；
5. Policy Engine 只能做决策，不自动成为源系统最终权限权威；
6. 本批不决定必须采用 OpenFGA。

## 2. 综合采用结论

### Adopt

- 内部稳定 Principal 与外部身份链接分离；
- 账号链接必须验证，禁止按邮箱、用户名或 caller-supplied ID 自动合并；
- 权限模型、关系事实、请求上下文和 Revision 分层；
- Connector、Registration、External Account、Credential 和 Lease 分层；
- 凭据只在服务端 Broker/Vault 中使用；
- Refresh、轮换、撤销、失败和审计是独立生命周期；
- 源系统执行最终权限校验。

### Adapt

- EE Claw 平台账号可作为一个身份来源，但不直接成为跨系统 Token；
- EE Claw 页面/action RBAC 可进入授权适配器，但不能替代项目/业务对象权限；
- OTA Project Grant 可作为 Scope Guard 参考，但需统一后才能扩展到其他模块；
- EE Claw-first 外部系统注册可由逻辑独立 Integration Control Plane 实现，不要求所有代码进入单体；
- OpenFGA 风格关系模型可用于复杂授权，但首期允许接口后置。

### Compare Only

- Nango 的具体数据库、加密和刷新实现；
- Keycloak 的具体 Realm/Flow/数据库结构；
- OpenFGA 的完整部署和运维形态。

### Reject

- 信任 `X-Open-Id` 或请求体身份字段；
- 按邮箱/用户名自动绑定外部账号；
- 把 App Credential 伪装为用户委托；
- 把 Profile Assignment 当成外部系统授权；
- 把页面权限当作项目或业务对象权限；
- 把 Token、Refresh Token、Client Secret 放入 Runtime、Prompt 或 Tool 参数；
- 仅靠隐藏 Tool、菜单或 Connector 来替代执行时授权。
