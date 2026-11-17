# ADR-0015：企业角色模型与模块能力关系

- 状态：Accepted
- 日期：2026-11-09
- 范围：EE Claw / `feishu-ee-agents` 企业业务角色、责任分配、模块能力、工作台投影和角色配置
- 前置决策：ADR-0007、ADR-0009、ADR-0010
- 后续决策：ADR-0016
- 用户决策：1-A、1-C、1-D 已接受
- 实施原则：本 ADR 只冻结架构语义，不授权修改 EE Claw 代码、现有 8 张表、数据、API、表单或部署

## 1. 范围声明

本 ADR 定义的是企业业务角色模型，适用对象为 `feishu-ee-agents` / EE Claw 平台侧。

本 ADR 不重新定义 Process Copilot Role。PC 侧的 Principal、Role/Policy、Profile Assignment 和分层授权仍以 ADR-0010 §2.1、§5，ADR-0007 §2，ADR-0009 D2 为准。

EE Claw 企业角色事实可以被 PC Authorization Adapter、Profile Resolver 和 Workbench Projection 消费，但不能静默替代 PC Principal、PC Role、Profile Assignment 或源系统最终授权。

## 2. 背景

EE Claw 当前授权实现具有：

- 独立 Account、Role、Permission、AccountRole、RolePermission、Session、LoginAttempt、AccessLog 表；
- 页面与动作权限键；
- 多角色分配；
- `allow` / `deny` 与 `page:*` / `action:*`；
- 每请求查询当前授权；
- `before_request` 统一强制点；
- 页面、动作和访问审计。

飞书研发角色工作台设计态页面还表达：

- 一个成员可绑定多个企业角色；
- 角色与模块之间存在 `●`、`◐`、`○`、`—` 四级关系；
- 角色工作台包含默认模块、指标、待办、流程、上下游、AI 草稿和配置；
- 配置同时包含个人偏好、角色默认、项目治理、组织治理和安全策略；
- 责任关系具有项目、模块和阶段范围。

如果把以上语义全部写入 `platform_roles` 或单一 Permission Effect，会导致：

1. 授权、责任、展示和配置相互污染；
2. 项目 × 模块 × 阶段组合造成角色数量膨胀；
3. `●` 被错误解释成更高权限；
4. Profile 或工作台投影间接扩大用户权限；
5. UI 只读被误当成服务端治理。

## 3. 决策摘要

采用四个相互独立、非层级关系的模型：

```text
Authorization Role
  决定能否进入、读取、编辑、审批、发布或管理

Responsibility Role
  决定某人在特定范围内负责什么

Workbench Projection
  决定进入后默认看到、聚焦和组织什么

Role Configuration
  决定可调参数、默认值、治理级别和锁定规则
```

核心结论：

1. 授权广不等于责任重；
2. 责任重不自动产生授权；
3. 工作台聚焦不产生执行能力；
4. 配置值不能绕过权限、审批和源系统最终校验；
5. 多角色工作台可以合并投影，但一个 AgentInstance 仍只绑定一个主 Expert Profile；
6. 权限键由平台代码/Registry 发布，管理员只能组合和分配。

## 4. 权威边界

### 4.1 Authorization Role

回答：

```text
该账号能否进入某模块？
能否读取、编辑、审批、发布或管理？
```

权威事实包括：

- Role Definition；
- AccountRole Assignment；
- Permission Key；
- RolePermission Effect；
- 账号和角色状态；
- 请求时有效权限。

现有 `platform_roles`、`platform_account_roles`、`platform_permissions`、`platform_role_permissions` 继续只承载授权语义。

### 4.2 Responsibility Role

回答：

```text
该账号在什么范围内承担什么责任？
```

责任分配是独立权威，不写入 `platform_roles`。

### 4.3 Workbench Projection

回答：

```text
用户进入工作台后默认显示、聚焦和组织什么？
```

Projection 是版本化发布物，不是授权权威。它可以引用角色、责任、模块和任务，但不能创造读取或写入权限。

### 4.4 Role Configuration

回答：

```text
角色相关行为使用哪些模板、阈值、通知、校验和卡点？
哪些值可由个人修改，哪些值被项目、组织或安全策略锁定？
```

Configuration 的 Schema、默认值、锁定级别和发布由 ADR-0016 约束。运行时取值仍必须经过当前授权和适用范围解析。

## 5. 责任角色独立建模

### 5.1 ResponsibilityAssignment

责任分配实体至少包含：

```text
responsibility_assignment_id
account_id
responsibility_key
scope_type: project | module | stage | global
scope_id
valid_from
valid_to?
status
assigned_by
assigned_at
revision
```

`responsibility_key` 表示稳定责任类型，例如 DRE、FO 或架构主责，不编码具体项目、模块或阶段。

### 5.2 范围

同一个账号可以：

- 在项目 A 担任 DRE；
- 在项目 B 担任电子硬件开发；
- 在项目 A 的模块 X 担任主责；
- 在阶段 Y 仅作为评审责任人。

这些关系通过 Assignment 的 Scope 表达，不创建：

```text
project-a-module-x-stage-y-dre
```

之类的新角色。

### 5.3 禁止事项

禁止：

1. 把项目 × 模块 × 阶段组合编码成 Role Definition；
2. 在 `platform_roles` 中承载责任范围；
3. 因责任分配自动授予页面、动作、资源或 Tool 权限；
4. 因授权角色自动推断项目责任；
5. 用工作台待办或 KPI 反向推断授权。

理由：否则角色数量随项目和模块数量增长，角色治理不可维护，且责任变化会错误触发权限变化。

## 6. 模块能力关系

### 6.1 RoleModuleRelation

角色与模块关系拆成四个字段：

```text
visibility: none | visible
capability: read | edit | approve | publish
focus: none | secondary | primary
requestable: true | false
```

`capability` 是集合，可以组合。未声明的能力不得根据 `focus`、图标或页面位置推导。

### 6.2 设计矩阵映射

| 矩阵符号 | visibility | capability | focus | requestable |
|---|---|---|---|---|
| ● 核心 | visible | read + edit | primary | false |
| ◐ 可编辑 | visible | read + edit | secondary | false |
| ○ 只读 | visible | read | none | false |
| — 不可见 | none | 空 | none | true |

该表是首期设计态页面符号到后端语义的映射，不表示页面已经实现对应数据模型。

### 6.3 `●` 与 `◐`

`●` 与 `◐` 的授权效果必须一致：

```text
visibility = visible
capability = read + edit
```

二者只在 `focus` 不同：

```text
● → primary
◐ → secondary
```

必须满足：

1. `●` 不得隐含 `approve`；
2. `●` 不得隐含 `publish`；
3. `◐` 不得降级为只读；
4. `●` 的“不可从工作台移除”属于 Workbench Projection；
5. Focus 不能进入最终 Authorization Decision 的 Allow/Deny 计算。

理由：否则工作台聚焦会扩大权限，违反 ADR-0009 的“Profile 不能扩大权限”和 ADR-0010 的分层授权规则。

### 6.4 申请能力

`requestable = true` 只表示允许创建持久申请。

申请流程：

```text
ModuleAccessRequest
→ current authorization check
→ approval
→ authoritative role/permission assignment
→ authorization revision changes
→ next request becomes effective
```

申请创建、审批通过或 UI 切换本身都不直接授予能力。

## 7. 工作台投影

### 7.1 内容

Workbench Projection 可以描述：

- 默认模块和导航聚焦；
- KPI 和指标卡；
- 待办、流程阶段和上游/下游视图；
- 产出物入口；
- AI 草稿工具入口；
- 配置面板布局；
- 不可移除的 Primary Focus 项。

### 7.2 多角色合并

同一成员有多个企业角色时，可以合并：

- 待办；
- KPI；
- 模块入口；
- 配置面板 Tab；
- 责任范围。

合并规则必须是确定性、版本化且可解释的。

禁止：

- 合并 Workbench Projection 时自动合并多个 ExpertProfileRelease；
- 因某个角色展示 Tool 入口而跳过当前 Tool Authorization；
- 因 Primary Focus 强制授予 Resource Scope；
- 把 Projection 存为无版本、可原地覆盖的数据库行。

## 8. 角色配置分级

配置项必须声明治理级别：

| 级别 | 含义 | 角色本人可修改 |
|---|---|---:|
| `personal_preference` | 个人显示、提醒和非安全偏好 | 是 |
| `role_default` | 角色发布的默认值 | 否 |
| `project_policy` | 项目范围模板、阈值、通知和卡点 | 否 |
| `organization_policy` | 组织治理与统一规则 | 否 |
| `security_policy` | 安全、审批、隔离和强制校验 | 否 |

服务端必须：

1. 根据配置 Schema 和治理级别校验写入；
2. 拒绝角色本人修改非 `personal_preference`；
3. 对越级写入记录审计；
4. 运行时解析适用 Release、Scope 和值；
5. 不因 UI 字段只读而省略服务端校验。

## 9. 权限键发布权威

Permission Key、Capability Key、配置 Key 和组件名由平台代码或受控 Registry 发布。

管理员允许：

- 创建业务授权角色；
- 组合已发布 Permission Key；
- 为账号分配角色；
- 为责任分配指定 Scope；
- 选择已发布 Workbench/Configuration Release。

管理员禁止：

- 在管理界面发明可执行 Permission Key；
- 创建未注册 Capability 或 Component；
- 将任意字符串直接变成后端权限判断；
- 通过 Workbench 配置增加 Tool、Resource 或外部系统权限。

## 10. 与 Expert Profile 的关系

Enterprise Role 与 Expert Profile 分离：

```text
Enterprise Role / Responsibility
  → 提供当前企业身份、职责和工作上下文事实

ProfileAssignment
  → 允许选择某个 ExpertProfileRelease

EffectiveProfileSnapshot
  → 按当前授权、资源、Tool、Plugin、Model 和 Knowledge 取交集
```

必须满足：

1. Enterprise Role 不等于 Expert Profile；
2. 一个企业成员可有多个 Role/Responsibility Assignment；
3. 一个 AgentInstance 仍只绑定一个主 Expert Profile；
4. 多角色 Workbench 合并不自动生成“混合 Profile”；
5. Profile 不得扩大 Role、Project、Resource 或源系统权限。

## 11. 永久禁止

1. 不得用角色数量表达项目/模块/阶段组合；
2. 不得把 Focus 编码成权限效果；
3. 不得允许角色本人修改 `project_policy`、`organization_policy` 或 `security_policy`；
4. 不得让 Expert Profile 扩大用户权限；
5. 不得把 Workbench Projection 存成无版本可变行；
6. 不得把页面可见性当作资源级或操作级授权；
7. 不得把企业责任角色写入 PC Principal 主键或 PC Role 权威；
8. 不得通过前端只读、隐藏按钮或矩阵符号替代服务端强制校验；
9. 不得让 AI 草稿因角色聚焦自动成为正式基线；
10. 不得在未发布 Permission Key 上建立生产授权。

## 12. 验收要求

1. 同一账号在 3 个项目 × 2 个模块承担责任时，Role Definition 数量不变；
2. 把角色从 `◐` 调到 `●`，授权判定结果完全一致；
3. 从工作台移除非 `●` 模块不触发权限变更或权限告警；
4. 越级提交 `project_policy` 配置被服务端拒绝并记录审计；
5. 申请 `—` 模块后，只有审批和权威 Permission Assignment 完成才变为 `visible`，且 Capability 不被隐式扩大；
6. 同一成员多角色 Workbench 可以合并，但一个 AgentInstance 仍只绑定一个主 Expert Profile；
7. `●` 不自动获得 `approve` 或 `publish`；
8. Responsibility Assignment 失效不会直接删除 Authorization Role；
9. Authorization Role 变化不会自动创建 Responsibility Assignment；
10. 未注册 Permission Key 无法在管理界面形成可执行授权。

## 13. 依据

### Accepted ADR

- ADR-0007：每次 Tool/MCP 调用按当前主体和授权重新判断；
- ADR-0009：Profile Assignment 不授予底层权限，Profile 不能扩权；
- ADR-0010 §2.1、§5：PC Role 边界和分层授权；
- ADR-0012：持久审批和执行时重授权；
- ADR-0014：证据等级、Traceability 和架构一致性。

### 源码证据

- `E:/shanzi_workspace/feishu-ee-agents`
- branch：`runtaozhang`
- commit：`cefa7432f966e17b41c1638e128de652b934fd20`
- `backend/platform_auth/schema.py`
- `backend/platform_auth/store.py`
- `backend/platform_auth/middleware.py`
- `backend/platform_auth/resources.py`
- `backend/platform_auth/engineering.py`
- `backend/platform_auth/service.py`
- `backend/platform_auth/api.py`
- `frontend/src/components/access-control/RolesPanel.vue`
- `frontend/src/auth/rolePermissions.js`

源码证据等级：R3。它证明现有授权角色、权限、强制点和 V1 API 事实，不证明本 ADR 新模型已经实现。

### 设计态页面证据

- `.ekko-tmp/process-copilot-feishu-role-workbench-audit-v0.1.md`
- 飞书研发角色工作台高保真设计页面

证据等级：R1-R2。只证明设计意图和页面语义，不证明后端数据模型、权限效果或运行行为。

正式证据卡见 `reference-evidence-role-model.md`。

## 14. 非目标

本 ADR 不决定：

- ResponsibilityAssignment 的物理表结构；
- Workbench 前端布局；
- 具体 Role Package API；
- 具体审批人和审批 UI；
- 配置存储产品；
- PC Role 的重构；
- Expert Profile 的新合并策略；
- 现有 8 表迁移；
- EE Claw 代码修改。

上述实现必须由独立任务授权。

