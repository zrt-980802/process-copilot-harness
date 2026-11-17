# ADR-0017：Legacy 授权兼容与零迁移

- 状态：Accepted
- 日期：2026-11-09
- 范围：EE Claw `platform_auth` V1 合同、`page:*` 行为、新模块授权、新角色默认值、撤权与回滚
- 前置决策：ADR-0007、ADR-0009、ADR-0010、ADR-0014、ADR-0015
- 用户决策：2、4 已接受
- 代码基线：`runtaozhang` / `cefa7432f966e17b41c1638e128de652b934fd20`
- 实施原则：本 ADR 冻结兼容策略，不授权修改现有 8 张表、数据、V1 表单、API、代码或部署

## 1. 背景

EE Claw 当前 `platform_auth` 已上线或被现有代码依赖：

- 8 张授权、会话和审计表；
- `/api/v1/auth/*` 与 `/api/v1/access/*`；
- `/api/v1/auth/me` 身份和有效权限结果；
- 统一认证、CSRF、Origin、页面权限和编辑动作强制；
- `page:*` 对 `default_open` 页面展开；
- 多角色权限合并；
- 显式 `deny`；
- 每请求查询当前权限；
- 访问审计日志。

ADR-0015 引入企业角色、责任、工作台和配置的分离模型，但本阶段要求：

```text
不改 8 表
不迁移数据
不改 V1 表单
不破坏 V1 API
直接兼容
```

因此需要冻结 Legacy V1 合同，并为未来新增页面和新角色入口定义收敛规则。

## 2. 决策摘要

采用：

```text
V1 Contract Freeze
+ versioned BASELINE_PAGE_KEYS
+ existing role-permission write path
+ separate new-role default behavior
+ zero data migration
+ runtime-derived decision source
+ request-time revocation
```

本次唯一有意行为收口：

```text
page:*
不再动态覆盖未来所有 default_open 页面
只覆盖固定版本 BASELINE_PAGE_KEYS
```

该变化只影响未来新增页面，不减少基线时已有账号和角色的有效页面集合。

## 3. V1 合同冻结

### 3.1 数据结构

冻结现有 8 张表的结构和语义：

```text
platform_accounts
platform_roles
platform_permissions
platform_account_roles
platform_role_permissions
platform_auth_sessions
platform_login_attempts
platform_access_logs
```

本次范围：

- 不新增表；
- 不新增字段；
- 不改变约束；
- 不回填数据；
- 不物化通配符；
- 不增加账号级直授权限。

### 3.2 V1 API

冻结 `/api/v1/*` 的：

- 路径；
- HTTP Method；
- 请求体字段；
- 成功响应外层结构；
- 错误响应外层结构；
- 现有错误码；
- CSRF/Origin 行为；
- Cookie 名称和基本语义。

重点包括：

```text
/api/v1/auth/register
/api/v1/auth/login
/api/v1/auth/logout
/api/v1/auth/change-password
/api/v1/auth/me

/api/v1/access/accounts
/api/v1/access/accounts/{id}
/api/v1/access/accounts/{id}/roles
/api/v1/access/accounts/{id}/revoke-sessions
/api/v1/access/accounts/{id}/reset-password

/api/v1/access/roles
/api/v1/access/roles/{id}
/api/v1/access/roles/{id}/permissions
/api/v1/access/permissions
/api/v1/access/page-views
/api/v1/access/logs
/api/v1/access/logs/{id}
```

### 3.3 `/api/v1/auth/me`

冻结当前字段语义：

```text
account
roles
is_system_admin
permissions
allowed_page_keys
csrf_token
```

不得在 V1 中把 Workbench Projection、Responsibility Assignment 或 Policy Artifact Payload 混入这些字段并改变既有消费者含义。

可以通过新版本接口或独立查询暴露新模型。

### 3.4 错误结构

冻结：

```text
{
  "ok": false,
  "error": {
    "code": "...",
    "message": "...",
    "request_id": "...",
    "permission_key": "..."?
  }
}
```

不得改变现有错误码的语义。新增入口可以新增错误码，但不能让 V1 消费者把旧错误误判为成功。

### 3.5 审计日志

冻结 `platform_access_logs` 的字段和当前格式，包括：

- request/account/session；
- event type；
- permission key；
- route/api pattern；
- method/status；
- IP/User-Agent；
- failure reason；
- occurred_at；
- metadata JSON。

新增模型的审计可以写入新的事件类型和 metadata，但不能删除、改名或改变 V1 字段含义。

## 4. `page:*` 基线冻结

### 4.1 当前问题

当前行为：

```text
page:* allow
+ permission.default_open = true
→ page allowed
```

如果未来新增页面默认 `default_open = true`，历史角色会自动获得该页面，形成未经审批的授权扩大。

### 4.2 决策

引入代码常量：

```text
BASELINE_PAGE_KEYS_V1
baseline_version = 1
```

`page:*` 只展开到该固定集合。

初始集合必须与 commit：

```text
cefa7432f966e17b41c1638e128de652b934fd20
```

中当前 `default_open = true` 的页面权限集合一致，包括其现有 `page:unmapped` 行为，不包括 `page:access-control`。

确切清单由代码常量和 golden fixture 固定，不能在运行时根据全部 `platform_permissions.default_open` 动态扩大。

### 4.3 新增页面

新增页面：

- 可以注册新的 `page:*` 之外 Permission Key；
- 默认不进入 `BASELINE_PAGE_KEYS_V1`；
- 必须通过现有 RolePermission 写路径显式授权；
- 若要进入新的通配基线，必须发布 `BASELINE_PAGE_KEYS_V2` 并通过独立兼容决策。

### 4.4 Deny

显式 `deny` 继续优先于：

- 精确 `allow`；
- `page:*`；
- Baseline Expansion。

本 ADR 不冻结系统永远开放。平台仍可通过显式 Deny、角色停用、账号停用、权限移除或新版本策略收紧授权。

## 5. 新模块授权路径

新模块授权继续写入：

```text
platform_permissions
platform_role_permissions
```

首期：

- 不新增授权表；
- 不新增 Permission 字段；
- 不新增现有 V1 表单字段；
- 不新增账号级直授模型；
- 通过现有角色 Permission 组合完成授权。

Responsibility Assignment、Workbench Projection 和 Role Configuration 不能直接写入 V1 RolePermission 表模拟授权。

## 6. 新角色默认权限

### 6.1 V1 入口

现有 V1 角色创建入口保持现有行为：

```text
POST /api/v1/access/roles
```

V1 消费者和现有表单语义不变。当前 `AuthStore.create_role()` 在创建角色时写入 `page:* = allow`；V1 入口必须继续保持这一默认行为。

### 6.2 新入口

未来新的 Enterprise Role/Role Package 创建入口：

```text
new role
→ no permissions by default
```

只有显式选择已发布 Permission Key 并通过授权管理流程，才产生 RolePermission。

### 6.3 双入口约束

两个入口的差异必须：

- 有独立 Contract；
- 有明确命名；
- 有测试同时覆盖；
- 不根据前端来源、User-Agent 或隐藏字段猜测；
- 不允许新入口退回 `page:*` 默认。

## 7. 不做数据迁移（零迁移）

本次不做：

```text
不新增账号行
不新增角色行
不新增责任分配行
不物化 page:* 到每个页面
不回填项目 Grant
不回填 Workbench Projection
不回填 Role Configuration
不强制用户重登
```

兼容通过运行时计算和代码常量实现。

旧数据保持原样，旧账号和旧角色使用同一 ID、Assignment 和 Permission 记录。

## 8. Decision Source

授权判定来源在运行时派生：

```text
source ∈ {
  baseline,
  role,
  deny,
  system_admin
}
```

语义：

| Source | 含义 |
|---|---|
| `baseline` | `page:*` 对 `BASELINE_PAGE_KEYS_V1` 的展开 |
| `role` | 精确 RolePermission Allow |
| `deny` | 精确或通配 Deny |
| `system_admin` | 内建系统管理员绕过普通角色权限 |

`source`：

- 不落库；
- 不新增字段；
- 可在内部诊断、审计 metadata 或新版本 API 中返回；
- 不改变 V1 `/auth/me` 响应。

## 9. 撤权即时生效

当前实现没有长期有效权限缓存：

```text
request
→ authenticate session
→ query current account/role/permission
→ enforce
```

必须保持：

- 角色撤销后下一个请求失效；
- 角色停用后下一个请求失效；
- 账号停用后 Session 不再授权；
- 精确 Deny 下一个请求生效；
- Permission 变更不要求重启服务。

若未来引入缓存，必须：

1. 绑定 Authorization Revision；
2. 绑定 Account/Role/Permission Revision；
3. 撤权先递增权威 Revision；
4. 失效 Session/Decision/Cache；
5. 敏感写操作继续实时查询或使用严格短 TTL；
6. 通过 ADR-0007、ADR-0010 的撤权矩阵。

禁止引入无法保证撤权上界的权限缓存。

## 10. 回滚

由于本策略不修改表结构和数据：

```text
rollback
→ 回滚代码与配置
→ 无数据回滚
```

回滚不得：

- 删除或转换现有 Permission 数据；
- 恢复过程中扩大新增页面权限；
- 要求用户重建角色；
- 重写访问审计历史。

如果未来实现引入新表或数据迁移，则不再属于本 ADR 的零迁移范围，必须新增实施决策或 ADR。

## 11. 分层授权保持不变

本 ADR 不创建新的授权计算模型。有效能力继续是：

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

依据：

- ADR-0010 §5；
- ADR-0007 §2；
- ADR-0009 D2。

Workbench Visibility、Focus、Responsibility 和 Role Configuration 都不能绕过该交集。

## 12. 永久禁止

1. 不得在 V1 路径改变响应结构或现有错误码语义；
2. 不得让新增页面自动进入 `BASELINE_PAGE_KEYS_V1`；
3. 不得为兼容新增账号级直授权限；
4. 不得引入延迟撤权且无 Revision 的权限缓存；
5. 不得在本次范围修改任何现有表结构；
6. 不得物化 `page:*` 并回填所有角色；
7. 不得强制旧账号重登作为兼容前提；
8. 不得把 Responsibility Assignment 写入 `platform_roles`；
9. 不得把 Workbench Projection 当作 V1 Permission；
10. 不得把零迁移解释为永不收紧授权。

## 13. 验收要求

1. 老账号可见页面集合在策略上线前后完全相同；
2. 老角色有效权限集合不减少；
3. 新增页面在 V1 `page:*` 下不自动可见；
4. 通过 V1 入口新建角色仍保持既有 `page:*` 兼容行为；
5. 通过新入口新建角色的有效权限为空；
6. 回滚代码后系统正常启动，数据无需处理；
7. 撤销角色后下一个请求立即失效；
8. 审计日志字段与格式不变；
9. 精确 Deny 继续覆盖 Baseline 和 Role Allow；
10. `/api/v1/auth/me` 的既有字段和含义不变；
11. 两个角色创建入口的默认权限差异有独立测试；
12. Decision Source 可以被测试推导，但数据库无新增字段。

## 14. 依据

### Accepted ADR

- ADR-0007：撤权与每次调用重新授权；
- ADR-0009：Profile 不能扩大权限；
- ADR-0010：PC/EE Claw/源系统分层授权；
- ADR-0014：兼容矩阵和 Contract Fixture；
- ADR-0015：企业角色、责任、工作台和配置分离。

### 源码证据

- `backend/platform_auth/schema.py`：8 张表；
- `backend/platform_auth/store.py`：Role/Permission、Deny、通配符和请求时解析；
- `backend/platform_auth/middleware.py`：统一 `before_request` 强制点；
- `backend/platform_auth/resources.py`：Page/Action Registry；
- `backend/platform_auth/engineering.py`：Edit Action；
- `backend/platform_auth/service.py`：角色创建、权限替换和 Session TTL；
- `backend/platform_auth/api.py`：V1 API 与 `/auth/me`；
- `frontend/src/auth/rolePermissions.js`：前端通配符投影；
- `backend/tests/scenarios/test_platform_auth_mysql.py`；
- `backend/tests/scenarios/test_platform_access_audit_mysql.py`。

仓库：

```text
E:/shanzi_workspace/feishu-ee-agents
branch: runtaozhang
commit: cefa7432f966e17b41c1638e128de652b934fd20
```

源码证据等级：R3。证据证明 V1 当前事实，不证明本 ADR 的 Baseline Constant 或新入口已经实现。

## 15. 非目标

本 ADR 不决定：

- 新入口具体 URL；
- 新入口 UI；
- `BASELINE_PAGE_KEYS_V1` 的代码位置；
- 新授权缓存产品；
- 新表或数据模型；
- PC Role 重构；
- 责任角色存储；
- Workbench/Configuration Release 存储；
- 实施排期。

以上实现必须由独立任务授权。

