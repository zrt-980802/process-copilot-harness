# ADR-0025：薄 Session、薄授权与旧 Provider 权限兼容

- 状态：Proposed
- 日期：2026-11-21
- 范围：PC Session Authority、PC-owned Action 授权、Provider-owned Action 交集授权、Legacy Provider Compatibility Adapter
- 前置决策：ADR-0007、ADR-0010、ADR-0014、ADR-0017、ADR-0024
- 触发证据：`product/docs/real-ee-integration-closure-01.md` 的 RCI-02
- 拟调整：ADR-0010 中“外部身份来源不可达时，所有关联 PC Session 请求均需实时源 Session 校验”的实现解释；不改变外部业务权限最终由源系统判定的结论
- 实施原则：本 ADR 先冻结边界，不授权直接编码、修改 EE schema、迁移 EE 权限、进入 D4B 或建设完整 IAM

## 1. 背景

Process Copilot 是公司级 Agent Harness，EE-Claw 是首个外部业务 Provider，不是 PC Core 的身份、会话和权限运行前提。

ADR-0024 已确定 PC 持有 PC Principal、Session、Conversation、Memory、Task、Plugin、Tool、Approval 和 Audit 权威；EE 继续持有 EE Account、项目成员、Role/Page/Action 和业务对象的最终授权。但真实隔离联调暴露出一个尚未闭合的实现边界：

```text
EE 登录建立 PC Session
→ 每个 ee: authentication context 请求仍实时验证 EE Session
→ EE 不可达
→ 个人对话、个人任务和个人工作台同时不可用
```

该行为对 EE 业务对象是正确的 fail closed，但对 PC-owned 资源形成结构性耦合。另一方面，直接跳过 EE 校验或缓存 EE Allow 会延迟账号停用和撤权，形成第二权限权威。

因此需要一个薄的过渡层：让 PC Session 和 PC-owned 权限独立成立，同时通过兼容适配器保留现有 EE V1 权限和源系统逐请求判权。

## 2. 决策摘要

采用：

```text
PC-owned Principal and Session Authority
+ thin PC Authorization
+ versioned Legacy Provider Compatibility Adapter
+ authority-routed decision intersection
+ provider fail closed for provider-owned resources
```

核心结论：

1. PC Session 是 PC 权威对象；已建立的 PC Session 不因 Provider Health 变化而自动失效；
2. PC-owned Action 只校验当前 PC Session、PC Principal 状态、PC Policy 和资源 Scope，不实时调用 EE；
3. Provider-owned Action 必须同时满足 PC Policy 与当前 Provider Authorization，任何一侧 Deny/Unknown/Unavailable 均拒绝；
4. Provider 登录只负责验证外部身份并建立或更新 `ExternalIdentityLink`，不能把外部 Session 变成 PC Session 的持续运行依赖；
5. Provider-backed PC Session 到期后的续期或重新登录必须重新验证身份来源；不得在 Provider 不可达时无限续期；
6. EE Role/Page/Action 和项目成员权限不复制到 PC，通过版本化 Compatibility Adapter 转换为 Provider 授权请求；
7. Compatibility Mapping 是路由和协议转换，不是 Allow 缓存、权限同步或第二权威；
8. Standalone、PC-native Identity 和未来企业 IdP 使用相同 PC Session/薄授权边界；
9. 未知 Action、未知 Resource Authority、缺失 Mapping 或歧义 Mapping 一律 fail closed；
10. 本 ADR 不解决 Business Operation 停在 `VERIFYING` 的 RCI-03；该问题必须单独整改和验收。

## 3. 权威边界

### 3.1 PC Principal 与 Session Authority

PC 持有：

- `PCPrincipal` 及其 lifecycle status；
- `PCSession`、绝对到期时间、空闲到期时间和撤销状态；
- `ExternalIdentityLink` 及其 link revision/status；
- PC 身份和授权 revision；
- PC-owned resource 的 Policy/Grant；
- Session 创建、续期、撤销和审计记录。

PC 不持有：

- EE 账号当前 Session；
- EE Role/Page/Action 的权威副本；
- EE 项目成员或业务对象 Allow；
- 可离线复用的 EE Authorization Decision；
- Provider 长期凭据。

### 3.2 Provider Authority

EE 或其他 Provider 继续持有：

- 外部账号状态和源 Session；
- 组织、项目成员及业务对象权限；
- Legacy Role/Page/Action；
- Provider-owned Action 的最终授权；
- 源系统撤权和访问审计。

Provider Health、Project Directory、Catalog、Profile 和 Capability Availability 只能缩减发现或可用能力，不能产生 Allow。

### 3.3 Compatibility Adapter

Compatibility Adapter 负责：

- 将稳定 PC Action/Resource 转换为 Provider 当前协议；
- 绑定 `provider_registration_id`、mapping version、action namespace 和 resource authority；
- 调用现有 EE V1 Role/Page/Action、项目成员和业务对象判权；
- 将 Provider Decision、revision、reason 和 evidence 归一化；
- 保持既有 EE V1 请求时撤权语义。

Compatibility Adapter 禁止：

- 把 Provider Allow 写成 PC Grant；
- 把页面可见、Catalog、Project Directory 或 Capability Availability 当作执行授权；
- 在 Provider 不可达时返回上一次 Allow；
- 猜测或遍历多个 Provider 寻找 Allow；
- 修改 EE V1 API、8 张授权表、`page:*` 或 `BASELINE_PAGE_KEYS_V1` 语义。

## 4. Session 模型

### 4.1 Provider 登录

```text
Provider authentication succeeds
→ verify issuer / external subject / tenant
→ resolve or create verified ExternalIdentityLink
→ load current PCPrincipal
→ issue PCSession with PC-owned expiry and revisions
```

PC Session 至少绑定：

```text
pc_session_id
principal_id
tenant_id
authentication_method
identity_link_id?
identity_revision
authorization_revision
issued_at
idle_expires_at
absolute_expires_at
revoked_at?
```

不得把 Provider Cookie、Provider Session ID 或访问令牌作为 PC Session 的主键或持续校验前提。

### 4.2 Provider 不可达

当 Provider 不可达时：

- 当前未过期、未撤销的 PC Session 继续访问 PC-owned Action；
- Provider-owned Action、项目目录刷新、Catalog、MCP 和业务对象访问 fail closed；
- 不延长 Provider-backed PC Session 的绝对到期时间；
- 不创建新的 Provider-backed PC Session；
- 不把关联 Session 静默转换成 Standalone/Local 身份；
- UI 使用 Provider 中立提示，不暴露内部 Bundle/Connector 错误。

PC Session 本身的既有绝对到期时间就是离线继续的上界，不新增无限或隐藏的 `offline_allow`。Session 续期必须重新满足其 authentication method 的身份验证要求。

### 4.3 撤权

PC 收到可信账号停用、Identity Link 撤销或 Identity Revision 变化时，必须立即：

- 撤销相关 PC Session；
- 失效 Principal Envelope、Authorization Decision 和 Runtime Assignment；
- 失效 MCP Binding、Credential Lease 和外部 Tool Set；
- 写入关联 Subject、Provider 和 evidence 的审计事件。

Provider 不可达且撤权事件尚未送达时，PC 无法证明源端最新账号状态。该风险由 PC Session 的绝对到期上界限制；任何 Provider-owned Action 仍然实时 fail closed。实现不得声称这是即时跨实例撤权。

## 5. 薄授权模型

薄授权只回答稳定问题：

```text
当前 PC Principal
是否可在当前 PC Session 中
对声明 Authority 的 Resource
执行声明的 Action
```

它不建设完整组织 RBAC、关系图权限或 Provider 权限管理 UI。

### 5.1 决策类型

| Decision Mode | 适用资源 | 最终决策 |
| --- | --- | --- |
| `PC_ONLY` | 个人对话、个人任务、个人记忆、PC Session、PC-owned Profile/Plugin 使用权 | 有效 PC Session ∩ PC Policy ∩ Resource Scope |
| `PC_AND_PROVIDER` | EE 项目、Requirement、Function、SSTS、EE Tool/MCP、Provider-backed Approval | PC Allow ∩ 当前 Provider Allow ∩ 执行时其他门禁 |
| `DENY_UNKNOWN` | 未知 Action、未知 Authority、缺失/歧义 Mapping | Deny |

外部写操作还必须继续满足 Approval、Fencing、Idempotency、Credential Generation、Runtime Capability 和源系统最终校验。

### 5.2 稳定 Action Namespace

首期至少区分：

```text
conversation.run
personal_task.read
personal_task.write
memory.personal.read
memory.personal.write
profile.use
plugin.use
project.read
requirement.read
function.read
ssts.read
ssts.generate
ssts.review.request
ssts.review.decide
tool.execute
```

Action 名称表达 PC 侧意图，不直接等同于 EE Permission Key。具体 Provider Permission、API 或 Tool 映射由版本化 Compatibility Mapping 决定。

### 5.3 最小决策证据

每次决策至少关联：

```text
principal_id
pc_session_id
tenant_id
action
resource_ref
resource_authority
decision_mode
pc_policy_revision
identity_revision
provider_registration_id?
provider_mapping_revision?
provider_decision_ref?
decision
reason_codes
observed_at
expires_at
```

Provider Decision 的 TTL 只允许覆盖单次请求或明确的极短读路径；不能跨请求续期 Provider Allow，写操作必须重新判权。

## 6. Legacy Provider Compatibility

### 6.1 EE V1 保持

首期 EE Compatibility Adapter 继续消费现有：

- `/api/v1/auth/me` 账号、角色和 Session 事实；
- Role/Page/Action Permission；
- `page:*` 与 `BASELINE_PAGE_KEYS_V1`；
- 项目成员和业务对象授权；
- 当前请求时 Deny 和访问审计。

不修改 EE schema、V1 API、角色数据或历史账号，不做权限数据迁移。

### 6.2 Mapping Release

兼容映射必须是版本化、可测试、可回滚的代码或不可变制品，至少声明：

```text
mapping_release_id
provider_registration_id or provider_type
pc_action_pattern
resource_authority
provider_permission/action/tool mapping
decision_mode
compatibility_version
artifact_digest
status
```

首期允许使用代码 Registry 和 fixture，不要求新增数据库表。新增或改变 Mapping 不得扩大旧角色的有效权限；涉及授权语义变化时必须更新兼容矩阵和 golden fixture。

### 6.3 兼容规则

1. 健康 EE 下，既有 EE-connected Action 的 Allow/Deny 结果保持；
2. `page:*` 不因 PC Action 新增而自动获得新业务能力；
3. Provider 映射缺失或版本不兼容时拒绝，不回退为通用 EE Allow；
4. PC Allow 不能覆盖 EE Deny；EE Allow 不能覆盖 PC Deny；
5. Standalone 不装配 EE Mapping，也不产生 EE 请求；
6. 第二 Provider 只能增加新的 Adapter/Mapping，不修改 PC Core Decision Mode；
7. Provider 错误码可以进入诊断和审计，普通用户提示必须 Provider 中立。

## 7. 请求流程

### 7.1 PC-owned Action

```text
authenticate PC Session
→ validate PC Principal / revisions / expiry
→ resolve resource_authority = pc
→ evaluate PC Policy and scope
→ execute PC-owned use case
→ audit
```

该路径禁止调用 EE Identity、Authorization、Directory、Catalog、Projection 或 MCP Port。

### 7.2 Provider-owned Action

```text
authenticate PC Session
→ validate PC Policy and declared scope
→ resolve one authority route
→ load exact Compatibility Mapping
→ live Provider authorization
→ approval / fencing / credential / runtime guards
→ source-system final authorization and execution
→ Operation Ledger / audit / evidence
```

任何未知、过期、不可达或歧义状态均不得退回 PC-only 路径。

## 8. 与既有 ADR 的关系

- ADR-0007：继续要求 Principal Envelope、Audience、Credential 和 Session 隔离；
- ADR-0010：保留 PC Principal、ExternalIdentityLink、分层授权和执行时重授权；本 ADR 澄清 PC Session 不以 Provider 在线状态为持续运行前提；
- ADR-0014：Mapping、Session 语义和错误码变化必须纳入兼容门禁；
- ADR-0017：EE V1、零迁移、`page:*`、Deny 优先和请求时撤权保持；
- ADR-0024：落实 PC Core 与 Provider 的身份/授权解耦，不改变 Provider-owned 业务最终授权；
- D4A：Provider Bundle 仍可整体 fail closed；Bundle 不可执行只关闭 Provider-owned 路径，不撤销有效 PC Session；
- D4B：端口级 Health、跨实例撤权 Fan-out 和管理员运维仍未授权，本 ADR 不声称完成。

## 9. 实施分期建议

本 ADR Accepted 后仍需独立任务书逐阶段授权：

### T0：合同与兼容 Fixture

- 冻结 PC Session assurance、Decision Mode 和 Compatibility Mapping；
- 建立 PC_ONLY / PC_AND_PROVIDER / unknown route fixture；
- 冻结 EE V1 行为 golden tests；
- 不改变运行行为。

### T1：PC Session 验证拆分

- 将 PC Session 验证与 Provider Session revalidation 分开；
- PC-owned Action 不再调用 EE Identity Port；
- Session 续期、撤销和 revision 失效保持 fail closed。

### T2：薄授权与兼容映射

- 建立稳定 Action/Resource/Authority 输入；
- EE Legacy Adapter 消费版本化 Mapping；
- 外部 Action 保持 PC/EE 交集授权。

### T3：真实故障验收

- 复跑 REAL-EE-INTEGRATION-CLOSURE-01；
- 验证 EE 断连时个人对话继续、外部能力关闭；
- 验证账号停用、Session 到期、恢复、重登、多账号和审计。

RCI-03 Operation Projection Closure 必须作为独立任务处理，不得把其通过伪装成本 ADR 的 Session/Authorization 验收。

## 10. 验收要求

只有以下全部满足，实施才能声称符合本 ADR：

1. EE 登录成功后建立独立 PC Session，PC Session ID 不等于 EE Session ID；
2. EE API/MCP 不可达时，当前有效 PC Session 的个人对话、个人任务和个人记忆继续工作；
3. 同一故障下，项目目录、Catalog、EE Tool/MCP 和 EE 业务对象稳定拒绝；
4. PC-owned Action 的网络断言为零 EE 调用；
5. Provider-backed Session 到期后不能在 EE 不可达时续期；
6. 可信 Identity Link 撤销或 revision 变化会撤销相关 PC Session；
7. PC Allow 不能覆盖 EE Deny，EE Allow 不能覆盖 PC Deny；
8. Mapping 缺失、歧义、未知版本和未知 Authority 全部拒绝；
9. EE V1 API、8 张表、`page:*`、Deny 和旧角色有效权限保持兼容；
10. Standalone 与 PC-native Identity 不加载 EE Adapter；
11. 默认 UI 不显示 Provider 内部错误；诊断和审计保留稳定错误码；
12. 审计能关联 PC Session、PC Decision、Mapping Release、Provider Decision 和最终结果；
13. 多账号、项目撤权、断连恢复、API 重启和旧 Session 重放测试通过；
14. 全量门禁、隔离 PostgreSQL/真实 EE 联调和独立复验通过。

## 11. 安全不变量

1. 不缓存或复制 Provider Allow 为 PC Grant；
2. 不允许 Provider Health、目录、Catalog 或前端可见性产生授权；
3. 不允许 Provider 不可达时执行 Provider-owned Action；
4. 不允许未知 Action/Authority/Mapping 自动降级；
5. 不允许 PC Session 自动变成 Provider Session 或相反；
6. 不允许 Provider-backed Session 在无法重新认证时无限续期；
7. 不允许 Runtime、Plugin 或 UI 绕过薄授权入口；
8. 不允许 Compatibility Adapter 改写 EE 权限数据；
9. 不允许把本 ADR 当作完整 IAM、跨实例撤权或 D4B 已完成；
10. 不允许以修复个人对话为由放宽 EE 项目或 Tool 的 fail closed。

## 12. 决策后果

### 正面

- EE 故障局部化，PC Core 个人能力不再随 EE 一起失效；
- 保留 EE 的现有权限权威和零迁移兼容；
- PC Action/Resource 语义稳定，未来 Provider 通过 Adapter 接入；
- 不需要先建设完整 IAM、权限管理 UI 或关系图引擎；
- 为后续公司统一 IdP 替换 EE 登录来源保留边界。

### 代价与风险

- Provider 撤权事件未到达且 Provider 不可达时，PC-only Session 最长持续到其绝对到期；
- Session、Identity Link、Authorization Revision 和 Provider Revision 的审计关联更复杂；
- Legacy Permission 到 PC Action 的 Mapping 成为需要发布治理的安全制品；
- 现有 `ee:` authentication context 的实时校验位置需要拆分，错误实现可能扩大权限；
- 真正的即时跨实例撤权仍需要后续可信事件和 Fan-out。

## 13. 明确非目标

- 完整企业 IAM、SCIM、OpenFGA 或统一组织目录；
- EE 权限数据迁移、镜像或双写到 PC；
- 修改 EE V1 API、schema、角色或历史账号；
- 第二个生产 Provider；
- D4B 端口级 Health、跨实例协调或撤权 Fan-out；
- MEMORY-01B；
- 修复 RCI-03 Business Operation Projection；
- 生产部署、远程发布或现有演示环境迁移。

## 14. 接受前必须确认

本 ADR 从 Proposed 转为 Accepted 前必须明确确认：

1. Provider-backed PC Session 在 Provider 断连时，PC-only 能力可继续到当前 PC Session 的绝对到期；
2. Provider 不可达时不允许续期或新建 Provider-backed PC Session；
3. Provider-owned Action 始终需要实时 Provider Authorization，不使用离线 Allow；
4. 首期 Compatibility Mapping 使用版本化代码 Registry/fixture，不新增 EE 表或迁移权限数据；
5. RCI-03 由独立任务处理，不作为接受本 ADR 的前置实现。
