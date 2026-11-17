# 企业角色模型与 Legacy 授权兼容参考证据

- 状态：Accepted Evidence
- 日期：2026-11-09
- 关联决策：ADR-0015、ADR-0016、ADR-0017
- 说明：源码事实与设计态页面证据分级记录；页面不能证明后端已实现

## REF-ROLE-001：EE Claw Platform Auth 源码事实

```text
reference_id: REF-ROLE-001
repository: E:/shanzi_workspace/feishu-ee-agents
branch: runtaozhang
commit: cefa7432f966e17b41c1638e128de652b934fd20
evidence_level: R3
adoption_decision: preserve / adapt
```

### 检查路径

- `backend/platform_auth/schema.py`
- `backend/platform_auth/store.py`
- `backend/platform_auth/middleware.py`
- `backend/platform_auth/resources.py`
- `backend/platform_auth/engineering.py`
- `backend/platform_auth/service.py`
- `backend/platform_auth/security.py`
- `backend/platform_auth/api.py`
- `frontend/src/components/access-control/RolesPanel.vue`
- `frontend/src/auth/rolePermissions.js`
- `backend/tests/scenarios/test_platform_auth_mysql.py`
- `backend/tests/scenarios/test_platform_access_audit_mysql.py`

### 已确认事实

1. 当前 Schema 有 8 张表：
   - Account；
   - Role；
   - Permission；
   - AccountRole；
   - RolePermission；
   - AuthSession；
   - LoginAttempt；
   - AccessLog。
2. `platform_roles` 只具有稳定 Key、名称、说明、状态和 Built-in 标记，不包含项目/模块/阶段责任范围；
3. Account 与 Role 是多对多；
4. Role 与 Permission 是多对多，Effect 为 `allow` / `deny`；
5. `has_permission()` 中精确 Deny 优先，之后精确 Allow，再处理通配符；
6. `effective_permissions()` 每次从当前 Account/Role/Permission 事实计算；
7. `before_request` 是统一认证、CSRF、Origin、Page Permission 和 Edit Action 强制点；
8. `page:*` 当前只允许 `default_open=true` 的页面；
9. `action:*` 和 System Admin 具有独立语义；
10. 当前 Registry 共 17 个 Page Key、9 个 Action Key；
11. `AuthStore.create_role()` 默认写入 `page:* = allow`；
12. `/api/v1/auth/me` 返回 Account、Role、系统管理员标志、Permissions、Allowed Page Keys 和 CSRF；
13. Access Log 记录 Request、Account、Session、Permission、Route/API、Method、Status 和 Metadata；
14. RolesPanel 允许管理 Role Definition 和 Page/Action Permission，不包含 Responsibility、Workbench Release 或 Role Configuration Release。

### 采用

- 保留现有授权角色、Permission Registry、请求级强制点和审计合同；
- 新模块授权继续走 RolePermission；
- 保持请求时撤权；
- Legacy V1 通过兼容层演进。

### 不可外推

- 8 表不包含 ADR-0015 的 ResponsibilityAssignment；
- 当前 Role 不等于 Workbench Projection；
- 当前 Permission 不表达 Focus；
- 当前 DB 不包含 PolicyArtifactRelease；
- 现有 `page:*` 动态展开不能证明未来新增页面应自动开放；
- 源码不证明 ADR-0015 至 ADR-0017 已实现。

### 工作区说明

核查时仓库存在用户或其他任务留下的未跟踪文件。本批只读检查，没有修改、删除、提交、推送或部署该仓库。

## REF-ROLE-002：飞书研发角色工作台设计态页面

```text
reference_id: REF-ROLE-002
source: 飞书研发角色工作台高保真页面
local_record: .ekko-tmp/process-copilot-feishu-role-workbench-audit-v0.1.md
evidence_level: R1-R2
adoption_decision: adapt concepts / not runtime fact
```

### 已观察

- 11 个角色；
- 13 个模块权限槽位；
- 45 个配置组；
- 100+ 配置项；
- 成员多角色绑定；
- `●/◐/○/—` 模块矩阵；
- KPI、待办、流程、上下游和 AI 文档草稿；
- 新增角色三步流程；
- 个人、角色、项目、组织和安全含义混合的配置项。

### 支持的设计判断

1. Authorization Role、Responsibility Role、Workbench Projection 和 Role Configuration 应拆分；
2. 模块矩阵不能作为单一 Permission Effect；
3. 多角色 Workbench 可以合并投影；
4. AgentInstance 不应自动合并多个 Expert Profile；
5. Role Configuration 需要版本、治理级别和发布；
6. AI 生成物必须保持 Draft、输入版本和人工评审边界。

### 不能证明

- 页面中的对象已存在后端表；
- `●` 具有 Approve/Publish 权限；
- UI 只读已经由服务端强制；
- 角色配置已经版本化；
- 申请模块已经接入持久审批；
- 页面展示数据来自当前生产权限系统。

## REF-ROLE-003：现有 ADR 一致性

```text
reference_id: REF-ROLE-003
source: Process Copilot ADR-0007 / ADR-0009 / ADR-0010 / ADR-0014
evidence_level: R4 for accepted internal decision authority
adoption_decision: preserve
```

### 一致性结论

- ADR-0015 不重新定义 PC Role；
- Enterprise Role 和 Workbench Focus 不能扩大 Profile 或 Tool 权限；
- 分层授权交集继续由 ADR-0007、ADR-0009、ADR-0010 约束；
- Policy Artifact Release 为 ADR-0010 的 `policy_model_revision` 提供版本载体；
- ADR-0017 的 Legacy Freeze 是兼容策略，不替代分层授权；
- 变化通过新增 ADR 和 Compatibility/Traceability 更新进入，不覆盖旧 ADR 历史。

## 综合结论

1. EE Claw 现有授权实现适合作为 Legacy V1 保留，不适合承载责任、投影和配置全部语义；
2. 页面设计说明四模型分解有业务必要性，但不能直接作为物理 Schema；
3. Policy Artifact 需要代码语义、DB 不可变 Release 和 Git 归档三层分工；
4. 零迁移可通过固定 Baseline 和运行时计算实现；
5. 本证据只支持 ADR 撰写，不授权代码或数据库变更。

