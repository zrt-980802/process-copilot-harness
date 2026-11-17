# ADR-0009：Expert Profile 技术模型

- 状态：Accepted
- 日期：2026-11-09
- 范围：T3.1 至 T3.7、B1 至 B7、T11.1、T11.3
- 前置决策：ADR-0001 至 ADR-0008
- 用户决策：CQ-EP-01=A、CQ-EP-02=A、CQ-EP-03=A、CQ-EP-04=A、CQ-EP-05=A、CQ-EP-06=A、CQ-EP-07=A
- 实施原则：本 ADR 只冻结技术设计；Profile 内容建设、数据库、接口、部署、代码和 DSH 修改均需独立任务书

## A. 本批设计目标

本批回答：

1. Expert Profile Definition、Draft、Release、Assignment 和 Effective Snapshot 如何分层；
2. Profile 如何声明专业指令、规则、Tool、Plugin Requirements、模型、知识和输出契约；
3. Profile 可用性与用户真实权限如何分开；
4. 用户、组、岗位、项目和任务范围如何参与 Profile 分配和有效能力计算；
5. 一个用户多个 Profile 如何选择、隔离并绑定 AgentInstance / Session；
6. Release 更新、回滚、撤销、权限变化和 Runtime 不兼容时如何处理；
7. 哪些配置允许用户个性化，哪些必须由组织锁定；
8. Business Expert Profile 如何无侵入映射到 DSH AgentPreset、Tool View 和 Capability Provider。

## B. 非目标

本批不设计：

- 最终 Profile 管理页面、卡片、搜索和推荐交互；
- 具体数据库表、索引、REST / RPC 路径；
- 具体岗位体系、部门体系和组织审批流程；
- 首批业务专家名单和业务优先级；
- 最终 Prompt 文案、知识内容和规则正文；
- 模型供应商采购、价格和配额参数；
- 现有 Demo 的 Profile 迁移；
- 直接创建生产 Expert Profile；
- 直接修改 DSH；
- 代码、数据库、部署、提交或推送。

## C. 本批工程结论摘要

建议采用：

```text
ExpertProfileDefinition
        |
        +-- ExpertProfileDraft
        |       - editable working copy
        |       - validation / review
        |
        +-- ExpertProfileRelease
                - immutable
                - exact dependency lock
                - instructions / rules / contracts
                - Tool / Plugin / Model / Knowledge requirements
                        |
                        v
ProfileAssignment
  user / group / role / project scope
  pinned release or release channel
                        |
                        v
PC Effective Profile Resolver
  Assignment
  ∩ current user authorization
  ∩ tenant / project / task policy
  ∩ Tool / Resource / Connector access
  ∩ model entitlement
  ∩ Runtime Capability Manifest
  ∩ release / dependency health
                        |
                        v
EffectiveProfileSnapshot
  exact release + exact resolved dependencies
  resolution report + authorization revisions
  immutable evidence, not an authorization token
                        |
                        v
AgentInstance / PC Session / DSH Session
  one primary Expert Profile per AgentInstance
  execution-time reauthorization remains mandatory
```

核心结论：

1. Expert Profile 是 Process Copilot 业务配置和专业契约，不是 DSH Runtime Profile；
2. Definition 是稳定身份，Draft 是可编辑工作区，Release 是不可变发布版本；
3. Assignment 只决定用户可选择哪些 Profile，不授予 Tool、数据、模型或外部系统权限；
4. 用户不需要复制一份独立 Profile；用户获得的是组织 Release 的 Assignment 和运行时 Effective Snapshot；
5. 一个用户可拥有多个 Profile，但一个 AgentInstance 只绑定一个主 Release，不自动合并多个 Profile；
6. Effective Snapshot 固定精确 Release、Dependency Lock 和解析结果，但不是长期权限凭据；
7. 必需依赖缺失、无权或不兼容时解析失败；只有显式标记 optional 的能力才允许降级；
8. Profile Release 更新只影响后续新快照；已有 Session 不原地升级，Release Revocation 除外；
9. 用户首期只允许修改非安全偏好，不得修改指令、Tool、Plugin、知识范围、模型策略、审批和输出契约；
10. Runtime Plugin 集仍由 ADR-0008 的 Runtime Profile Release 决定；Profile 只声明 Requirements；
11. DSH AgentPreset 可承载 Session 级技术组合，但不是业务 Profile 权威或安全边界；
12. Profile、Assignment、授权或依赖变化通过 Revision 和实时重授权传播。

## D. 权威边界

### D1. PC Profile Control Plane

PC Backend 持有：

- ExpertProfileDefinition；
- ExpertProfileDraft；
- ExpertProfileRelease；
- ProfileAssignment；
- UserProfilePreference；
- Profile Release Channel；
- EffectiveProfileSnapshot；
- Profile Dependency Lock；
- Profile Resolution Report；
- 发布、弃用、撤销和审计；
- Profile 与 AgentInstance / Session 的绑定事实。

### D2. Authorization 与外部权威

Authorization Service、EE Claw 和最终业务系统持有：

- 用户是否有效；
- 用户角色、组织、项目和数据范围；
- 用户是否可选择某个 Profile；
- 用户是否可访问某个 Tool、模型、连接器、知识资源和业务对象；
- 最终业务操作权限。

Profile 不能覆盖或扩大这些权限。

### D3. Registry 与 Runtime

ADR-0008 的 Registry 持有：

- ToolRelease / PluginRelease；
- Release Digest、Compatibility Matrix 和 Revocation；
- Runtime Capability Manifest 中的实际能力事实。

DSH 持有：

- 当前 Runtime 内的 AgentPreset 技术组合；
- scoped Tool / Prompt / Service 可见性；
- Agent、Session、Turn、Step 和技术事件；
- 当前进程中的 preset revision 和 mounted composition。

DSH 不持有：

- 企业 Expert Profile 发布权；
- Profile Assignment；
- 用户业务权限；
- EffectiveProfileSnapshot 权威；
- 跨进程 Release 历史；
- 业务 Profile 撤销权威。

## E. 对象模型

### E1. ExpertProfileDefinition

Definition 是稳定业务身份，不包含可运行时漂移的“当前配置”。

```text
ExpertProfileDefinition
- profile_definition_id
- canonical_key
- display_name
- purpose
- domain
- owner_ref
- publisher_policy_ref
- lifecycle_status
- default_release_channel
- created_at
- retired_at
```

同一个 Definition 可以发布多个 Release。

### E2. ExpertProfileDraft

Draft 是可编辑工作副本，不可被生产 Session 直接引用。

```text
ExpertProfileDraft
- profile_draft_id
- profile_definition_id
- based_on_release_id
- working_revision
- content
- validation_state
- review_state
- edited_by
- updated_at
```

Draft 使用乐观并发或编辑 Lease，避免后写覆盖。

### E3. ExpertProfileRelease

Release 是不可变专业能力版本。

```text
ExpertProfileRelease
- profile_release_id
- profile_definition_id
- semantic_version
- release_digest
- schema_version
- instruction_refs
- rule_refs
- tool_requirements
- plugin_requirements
- model_policy
- knowledge_policy
- input_contract
- output_contract
- completion_contract
- runtime_requirements
- dependency_lock_ref
- compatibility_matrix_ref
- published_by
- reviewed_by
- published_at
- lifecycle_status
```

Release 不保存明文 Secret、Token、Credential 或任意可执行 Plugin 代码。

### E4. ProfileAssignment

Assignment 表示某主体可以选择某 Profile。

```text
ProfileAssignment
- profile_assignment_id
- subject_type
- subject_ref
- scope_type
- scope_ref
- profile_definition_id
- release_selector
- pinned_release_id
- release_channel
- priority
- is_default
- valid_from
- valid_until
- status
- assigned_by
- assignment_revision
```

`subject_type` 首期允许 user、group、role。项目和任务通过 scope 限制，不把项目伪装成用户。

### E5. UserProfilePreference

用户偏好与组织 Release 分开。

```text
UserProfilePreference
- user_id
- profile_definition_id
- preference_schema_version
- language
- output_density
- formatting_preferences
- notification_preferences
- preference_revision
```

首期偏好不得改变：

- System / Expert Instructions；
- Tool、Plugin 和 Connector；
- 知识范围和 Resource；
- Model Policy 和 Credential；
- Approval / Risk Policy；
- Input / Output / Completion Contract；
- Runtime Requirements。

### E6. EffectiveProfileSnapshot

Effective Snapshot 是一次 AgentInstance / Session 的不可变解析结果。

```text
EffectiveProfileSnapshot
- effective_profile_snapshot_id
- profile_release_id
- profile_release_digest
- profile_assignment_id
- subject_user_id
- tenant_id
- project_id
- task_id
- preference_revision
- authorization_revision
- policy_revision
- resource_view_revision
- tool_policy_revision
- runtime_capability_digest
- resolved_tool_releases
- resolved_plugin_requirements
- resolved_model_route
- resolved_knowledge_scope
- resolved_instruction_refs
- resolved_rule_refs
- output_contract_digest
- completion_contract_digest
- dependency_lock_digest
- resolution_report
- created_at
- expires_at
- status
```

Snapshot 用于重建和审计，不是授权 Token。

### E7. ProfileResolutionReport

```text
ProfileResolutionReport
- required_satisfied
- optional_omissions
- denied_dependencies
- incompatible_dependencies
- revoked_dependencies
- fallback_decisions
- warnings
- resolver_version
```

不得只返回一个 `compatible=true/false` 而隐藏失败原因。

## F. Release 内容契约

### F1. Instructions 与 Rules

- Instructions 和 Rules 分开；
- 正文使用不可变 Resource Version / Digest；
- Prompt 不是权限规则；
- 可执行业务规则应使用结构化规则、策略或代码引用，不只写在自然语言 Prompt；
- Release 必须记录所有模型可见内容的版本。

### F2. Tool Requirements

```text
ToolRequirement
- tool_definition_ref
- version_constraint
- required_or_optional
- allowed_action_classes
- required_capabilities
- policy_ref
- fallback_policy
```

发布时解析为允许的 Release 范围；Effective Snapshot 再解析为精确 ToolRelease。

### F3. Plugin Requirements

Profile 只声明 Requirement：

```text
PluginRequirement
- plugin_definition_ref
- compatible_release_range
- required_or_optional
- required_runtime_capabilities
```

Session 不安装或激活 Plugin。Runtime 不满足必需 Requirement 时必须换 Runtime 或拒绝。

### F4. Model Policy

Model Policy 表达：

- 允许的模型能力；
- 数据驻留、上下文长度、结构化输出、视觉或 Tool Calling 要求；
- 允许的 Provider / Model Route 集；
- 成本和延迟等级；
- Fallback 是否允许。

Release 不包含 Provider Secret。Effective Snapshot 固定实际 Model Route 和 Policy Revision。

### F5. Knowledge Policy

Knowledge Policy 表达：

- 允许使用的知识集合或绑定类型；
- 必需和可选知识；
- 检索方式、引用要求和证据要求；
- 是否允许 Session 临时资源；
- 是否要求精确版本快照。

Profile 不能让用户读取其本来无权访问的知识。实际 ResourceRef 必须经过 Resource Gateway 和当前授权解析。

### F6. Output 与 Completion Contract

Output Contract 定义：

- Schema；
- 必填字段；
- Evidence / Citation 要求；
- 文件类型和 ResourceRef 约束；
- 不确定性表达；
- 敏感信息处理。

Completion Contract 定义：

- 何时可判定完成；
- 哪些检查必须通过；
- 缺少哪些输入时必须停止并请求补充；
- 哪些情形必须输出 `unable_to_determine`；
- 哪些写操作必须 Readback。

## G. 发布治理

### G1. 生命周期

```text
DRAFT
→ IN_REVIEW
→ RELEASED
→ DEPRECATED
→ RETIRED

任意 RELEASED
→ REVOKED
```

### G2. 发布门禁

发布至少验证：

1. Schema；
2. Instruction / Rule Resource Digest；
3. Tool / Plugin Release 可解析性；
4. Model Policy 可满足性；
5. Knowledge 引用存在且发布者有权引用；
6. Required / Optional 标记完整；
7. Output / Completion Contract；
8. 风险和审批策略；
9. Compatibility Matrix；
10. Secret 扫描；
11. 静态测试和样例；
12. 发布者与审核者权限。

### G3. Release Channel

Release Channel 例如 `stable`、`pilot`，只用于 Assignment 选择新 Session 的版本。

运行快照永远保存精确 Release ID 和 Digest，不保存“stable”作为运行身份。

### G4. 回滚

回滚是：

```text
将 Release Channel 重新指向旧的已发布 Release
```

不是修改新 Release，也不改变已有 Session。

### G5. 撤销

Release 或依赖被撤销时：

- 新 Snapshot 禁止解析；
- 未派发调用立即拒绝；
- 活跃 Snapshot 标记 `REAUTH_REQUIRED` 或 `REVOKED`；
- 在途读取、写入和 Durable Job 按 ADR-0007 分类处理；
- 已产生业务副作用进入 Operation Ledger 和对账；
- 历史 Release 和审计证据保留。

## H. Assignment 与可见性

### H1. 可见不等于可执行

```text
Profile Assignment
→ 可在目录中选择

Effective Resolution
→ 当前任务可否创建有效快照

Execution Authorization
→ 当前操作此刻可否执行
```

三者必须分开。

### H2. 多 Assignment

用户可以通过 user、group、role 获得多个 Profile Assignment。

Assignment 的集合使用并集形成“可选择目录”，但不同 Profile 的能力不做并集合并。

### H3. 默认 Profile

默认项必须通过确定性规则选出：

1. 当前 scope 内显式 user default；
2. 当前 scope 内最高优先级 Assignment；
3. tenant default；
4. 无默认时要求显式选择。

同优先级冲突必须报配置错误，不按数据库返回顺序选择。

## I. Effective Profile Resolver

### I1. 输入

Resolver 输入至少包括：

- subject / actor；
- tenant / project / task；
- Profile Assignment；
- exact or channel-selected Profile Release；
- Authorization Revision；
- Tool / Resource / Model / Connector Policy；
- Runtime Capability Manifest；
- Release Revocation 和 Dependency Health；
- UserProfilePreference。

### I2. 分域解析

```text
Effective Tools
= Profile Tool Requirements
∩ User Tool Permission
∩ Project / Task Scope
∩ Tool Risk Policy
∩ Connector Availability
∩ Runtime Capability

Effective Knowledge
= Profile Knowledge Policy
∩ User Resource Permission
∩ Project / Task Scope
∩ Session Resource View

Effective Model Route
= Profile Model Policy
∩ Tenant Model Entitlement
∩ Data Residency / Risk Policy
∩ Runtime Adapter Capability
```

### I3. Required 与 Optional

- required 依赖无权、缺失、撤销或不兼容：解析失败；
- optional 依赖可省略，但必须写入 Resolution Report；
- 不允许把 required 自动降为 optional；
- Fallback 必须由 Release 显式声明；
- 解析失败不得创建“半有效”生产 Session。

### I4. 解析结果

```text
READY
UNAUTHORIZED
MISSING_DEPENDENCY
INCOMPATIBLE_RUNTIME
REVOKED
REAUTH_REQUIRED
POLICY_CONFLICT
```

## J. 用户个性化

首期只允许非安全偏好：

- 语言；
- 输出详略；
- 格式偏好；
- 通知偏好；
- Release 明确开放的枚举型展示参数。

禁止用户个性化：

- 任意 Prompt 追加；
- Tool / Plugin 增删；
- 知识资源增删；
- Model Provider / Credential；
- 审批、风险、网络、文件和 Sandbox；
- 输出 Schema 和完成条件。

未来如允许受控 Overlay，必须：

1. 使用独立 Schema；
2. 字段 allowlist；
3. 重新发布或形成独立 Overlay Release；
4. 重新计算 Digest；
5. 重新走安全校验；
6. 不得扩权。

## K. AgentInstance、Session 与 Runtime

### K1. 主 Profile

一个 AgentInstance 绑定一个主 ExpertProfileRelease 和一个 EffectiveProfileSnapshot。

用户可拥有多个 Profile，但切换主 Profile：

- 空白 Session 可在创建完成前重新选择；
- 首个 Turn 后不原地切换；
- 需要新 AgentInstance / Session 或受控 Fork。

### K2. 多专家协作

一个 Business Task 可以创建多个 AgentInstance，每个绑定不同 Profile。

多专家结果通过 Task / Subtask 协作，不通过把多个 Profile Prompt、Tool 和权限直接合并进同一个 Agent。

### K3. Runtime 兼容

Resolver 输出 Runtime Requirements：

- DSH / Adapter Protocol；
- Runtime Profile Release；
- Plugin Release；
- Provider Capability；
- Model Adapter；
- Sandbox / Resource Capability。

调度器选择兼容 Runtime。没有兼容 Runtime 时：

- 创建或等待兼容 Runtime；
- 或返回 `INCOMPATIBLE_RUNTIME`；
- 不允许 Session 在线安装 Plugin 绕过兼容判断。

### K4. DSH 映射

```text
ExpertProfileRelease / EffectiveProfileSnapshot
        |
        v
PC Profile Provider / Runtime Bridge
        |
        +-- controlled AgentPreset selection
        +-- system prompt sections
        +-- session-scoped Tool View
        +-- model route provider
        +-- Resource / Knowledge provider
        +-- output contract observer
        |
        v
DSH Agent / Session
```

DSH AgentPreset：

- 可以承载 Session 级技术组合；
- 现有 Agent 在进程内保留旧 revision；
- 首个 Turn 后拒绝切换；
- 不是安全 Sandbox；
- 旧 revision 不跨进程重启持久存在。

因此 PC 必须保存完整 Effective Snapshot，并能从精确 Release 和 Dependency Lock 重建技术组合。

## L. 失效与重新计算

以下变化使缓存失效：

- Profile Release / Channel；
- Assignment Revision；
- 用户、组、岗位或项目关系；
- Authorization Revision；
- Resource View Revision；
- Tool / Model / Connector Policy；
- Tool / Plugin / Profile Revocation；
- Runtime Epoch 或 Capability Digest；
- User Preference Revision。

失效处理：

1. 权威 Revision 先变化；
2. 新解析拒绝旧 Revision；
3. 目录、Resolution、Tool Set 和 Model Route 缓存失效；
4. 活跃 Snapshot 保留为历史证据并标记状态；
5. 下一次 Step / Tool / Resource 操作重新鉴权；
6. 不因新增权限自动扩大正在运行的 Snapshot；
7. 需要采用新增能力时创建新 Snapshot / Session。

## M. 审计与验收

至少记录：

- ProfileDraftCreated / Updated；
- ProfileReleaseValidated / Published / Deprecated / Revoked；
- ProfileAssigned / Unassigned；
- ProfileSelected；
- EffectiveProfileResolved / Rejected；
- OptionalDependencyOmitted；
- RuntimeCompatibilityChecked；
- SnapshotBoundToAgentInstance；
- SnapshotInvalidated；
- ExecutionReauthorized；
- ProfileForked / SessionRecreated。

至少验证：

- Profile 无法扩大用户权限；
- 无 Assignment 的用户不能选择 Profile；
- 有 Assignment 但缺 Tool / Resource 权限时解析失败；
- required 依赖缺失不静默降级；
- optional 依赖省略会写 Resolution Report；
- 同一 Release 解析结果可按相同 Revision 重建；
- Profile Release 更新不改变旧 Snapshot；
- Release Revocation 阻止新调用；
- 用户偏好不能修改安全字段；
- 一个 AgentInstance 不绑定多个主 Profile；
- 首个 Turn 后不能原地切换；
- Runtime 不兼容不触发 Session 动态安装 Plugin；
- Tool / Resource / Model 在执行时仍重新授权；
- Snapshot 不包含明文 Secret；
- DSH 进程重启后可由 PC 快照恢复精确组合；
- 无 DSH Core 修改时可完成最小闭环。

## N. 与 DSH 的映射结论

| PC 概念 | DSH 机制 | 结论 |
|---|---|---|
| Profile Definition / Release | 无企业对象 | PC 持有 |
| Draft / Review / Publish | 无 | PC 持有 |
| Profile Assignment | 无 | PC 持有 |
| Effective Snapshot | Session header / event 可记录部分技术选择 | PC 持有完整权威 |
| Session composition | AgentPreset Registry | 可适配 |
| Tool View | scoped Tool registry / restrictions | 可适配 |
| Prompt | system prompt sections | 可适配 |
| Model route | LLM Adapter / Provider | 可适配 |
| Runtime requirements | Profile / Bundle / Capability Manifest | 可适配 |
| Permission intersection | monotonic Guard 只负责本地最终拒绝 | PC Authorization 持有 |
| Release history across restart | 不保证旧 preset revision | PC 必须持久化并重建 |

## O. 未来升级接口

首期保留：

1. `ProfilePublisherPolicy`：扩展发布主体和双人审核；
2. `ProfileOverlayPolicy`：未来受控用户或项目 Overlay；
3. `ProfileAssignmentResolver`：扩展组织、岗位、项目和 ABAC；
4. `ProfilePolicyEvaluator`：接入 OpenFGA / OPA / Cedar 类引擎；
5. `ModelRouteResolver`：动态成本、区域和能力调度；
6. `KnowledgeScopeResolver`：动态知识集合和版本冻结；
7. `ProfileCompatibilityEvaluator`：跨 Runtime / DSH 版本兼容；
8. `ProfileMigrationPlan`：新 Release 的显式迁移；
9. `MultiExpertOrchestrator`：多 AgentInstance 协作；
10. `ProfileEvaluationSuite`：离线评测、回归和灰度门禁。

## P. 工程默认决策

### 对象与权威

- **ED-EP-001**：Business Expert Profile 属于 PC Backend，不属于 DSH。
- **ED-EP-002**：Definition、Draft、Release、Assignment、Effective Snapshot 必须分离。
- **ED-EP-003**：Release 发布后不可原地修改。
- **ED-EP-004**：Draft 不得被生产 Session 直接引用。
- **ED-EP-005**：Assignment 只授予 Profile 可选择性，不授予底层资源权限。
- **ED-EP-006**：Effective Snapshot 是运行与审计事实，不是授权凭据。
- **ED-EP-007**：一个 AgentInstance 只绑定一个主 Profile Release。
- **ED-EP-008**：多个专家通过多个 AgentInstance 协作，不直接合并 Profile。

### Release 内容

- **ED-EP-009**：Release 固定 Schema Version 和 Release Digest。
- **ED-EP-010**：Instruction、Rule 和静态知识引用精确 Resource Version / Digest。
- **ED-EP-011**：Tool Requirement 最终解析为精确 ToolRelease。
- **ED-EP-012**：Plugin Requirement 只声明兼容需求，不触发 Session 安装。
- **ED-EP-013**：Model Policy 不保存 Credential 或明文 Secret。
- **ED-EP-014**：Knowledge Policy 不绕过 Resource Gateway 和源系统权限。
- **ED-EP-015**：Output Contract 和 Completion Contract 进入 Release Digest。
- **ED-EP-016**：业务规则不能只存在于自然语言 Prompt。
- **ED-EP-017**：required / optional 必须逐依赖声明。
- **ED-EP-018**：Fallback 必须由 Release 显式声明。

### 发布与版本

- **ED-EP-019**：发布前执行依赖、权限、Secret、兼容和契约校验。
- **ED-EP-020**：Release Channel 只影响新 Snapshot。
- **ED-EP-021**：运行身份只使用精确 Release ID 和 Digest。
- **ED-EP-022**：回滚是 Channel 指针切回旧 Release。
- **ED-EP-023**：已有 Session 不因新 Release 自动升级。
- **ED-EP-024**：Revocation 可阻止旧 Release 的新操作。
- **ED-EP-025**：历史 Release、Revision 和审计证据不可物理覆盖。
- **ED-EP-026**：Profile 发布和底层 Tool / Plugin 发布是独立门禁。

### Assignment 与个性化

- **ED-EP-027**：首期使用组织 Release + Assignment，不为每个用户复制 Definition。
- **ED-EP-028**：用户可以拥有多个 Profile Assignment。
- **ED-EP-029**：不同 Profile Assignment 的能力不做自动并集合并。
- **ED-EP-030**：Assignment 冲突必须按显式优先级处理。
- **ED-EP-031**：同优先级默认冲突必须报错。
- **ED-EP-032**：UserProfilePreference 与 Release 分开存储。
- **ED-EP-033**：首期用户偏好只允许非安全展示字段。
- **ED-EP-034**：任何可改变能力或安全语义的 Overlay 都需要独立版本和审核。

### Effective Resolution

- **ED-EP-035**：Profile Resolver 位于 PC 控制面。
- **ED-EP-036**：Tool、Knowledge、Model 和 Runtime 分域解析。
- **ED-EP-037**：required 依赖无权、缺失、撤销或不兼容时解析失败。
- **ED-EP-038**：optional 省略必须记录原因。
- **ED-EP-039**：不得静默把 required 改为 optional。
- **ED-EP-040**：Effective Snapshot 固定解析器版本和全部权威 Revision。
- **ED-EP-041**：Snapshot 不包含长期 Token、Secret 或明文 Credential。
- **ED-EP-042**：Profile 解析失败不得创建半有效生产 Session。
- **ED-EP-043**：Snapshot 可重建，但执行时仍实时重新授权。
- **ED-EP-044**：新增权限不自动扩大已有 Snapshot。

### Runtime 与 Session

- **ED-EP-045**：Runtime Plugin 集继续由 Runtime Profile Release 决定。
- **ED-EP-046**：Profile 不携带任意可执行 Plugin 配置或代码。
- **ED-EP-047**：调度器只选择满足 Runtime Requirements 的 Runtime。
- **ED-EP-048**：没有兼容 Runtime 时创建替代 Runtime 或拒绝，不在线安装 Plugin。
- **ED-EP-049**：空白 Session 可在首个 Turn 前重新选择 Profile。
- **ED-EP-050**：首个 Turn 后切换 Profile 需要新 AgentInstance / Session 或 Fork。
- **ED-EP-051**：DSH AgentPreset 是技术组合，不是业务 Profile 权威。
- **ED-EP-052**：PC 必须能在 DSH 重启后从 Release 和 Lock 重建组合。

### 失效、审计与测试

- **ED-EP-053**：权威 Revision 先变化，再清理缓存。
- **ED-EP-054**：Assignment、Authorization、Policy、Resource、Release 和 Capability 变化均可使快照过期。
- **ED-EP-055**：失效 Snapshot 保留历史内容并更新状态，不原地改写。
- **ED-EP-056**：Profile、Assignment、Resolution、Runtime Binding 和执行重授权必须全链路审计。

## Q. 与既有 ADR 的一致性

| 前置 ADR | 本批保持的约束 |
|---|---|
| ADR-0001 | Runtime Plugin 集稳定；Session 级能力通过兼容 Runtime 和受控装配获得 |
| ADR-0002 | Session Assignment、Generation、Fencing 与 Profile Snapshot 关联 |
| ADR-0003 | 故障恢复重新鉴权；旧 Snapshot 不直接作为恢复授权 |
| ADR-0004 | Runtime Registry 和 Capability Health 参与 Profile 解析 |
| ADR-0005 | Knowledge 和配置文件使用 ResourceRef / Version / View |
| ADR-0006 | PC Backend 持有业务权威；通过 Adapter / AgentPreset / Provider 映射 DSH |
| ADR-0007 | Profile 不能扩大用户权限；每次 MCP / Tool 调用重新授权 |
| ADR-0008 | Tool / Plugin 使用精确 Release、Digest、Risk、Revocation 和 Compatibility |

## R. 首期用户决策

用户已确认七项均采用方案 A。以下保留备选方案，用于说明首期取舍和未来演进边界。

### CQ-EP-01：首期 Profile 的个人化形态？

**首期选择 A：组织发布 Definition / Release，按用户、组或岗位 Assignment，运行时生成个人 Effective Snapshot。**

- 不为每个用户复制 Profile；
- 用户权限和偏好在解析时进入快照；
- 最适合版本治理和批量升级。

**B｜每个用户拥有独立 Profile 副本。**

- 个性化强；
- 容易产生配置漂移、升级困难和审计碎片。

**C｜组织模板自动 Fork 为个人 Release。**

- 兼顾模板和个人修改；
- 首期需要复杂继承、合并和冲突模型。

### CQ-EP-02：首期谁可以发布 Expert Profile Release？

**首期选择 A：领域负责人可创建 Draft；经过授权的 Profile Publisher / Reviewer 发布，用户不能发布。**

- 业务专业内容由领域方维护；
- 发布、审核和使用者分离；
- 高风险 Profile 可要求双人审核。

**B｜仅平台团队创建和发布。**

- 治理简单；
- 专业内容维护瓶颈明显。

**C｜用户可自行发布。**

- 当前风险和版本治理成本过高，不建议。

### CQ-EP-03：首期用户可修改什么？

**首期选择 A：只能修改语言、输出详略、格式和通知等非安全偏好。**

不得修改 Prompt、Tool、Plugin、知识、模型、审批和契约。

**B｜允许 Release 明确开放的受控 Prompt / 知识 Overlay。**

需要 Overlay Schema、Digest、重新校验和审计。

**C｜允许复制后自由修改。**

不建议作为首期。

### CQ-EP-04：一个用户多个 Profile 如何运行？

**首期选择 A：用户可拥有多个 Profile；一个 AgentInstance 只绑定一个主 Profile，子任务可创建其他 Profile 的 AgentInstance。**

**B｜同一 AgentInstance 合并多个 Profile。**

容易产生 Prompt、Tool、规则和完成条件冲突。

**C｜一个用户只能拥有一个 Profile。**

无法支持同一用户跨专业任务。

### CQ-EP-05：Assignment 如何跟随 Release？

**首期选择 A：Assignment 可跟随 stable / pilot Channel，但每个 Effective Snapshot 固定精确 Release；旧 Session 不自动升级。**

**B｜Assignment 永远固定精确 Release，升级必须逐条改 Assignment。**

治理清晰，但批量升级成本高。

**C｜活动 Session 自动跟随最新 Release。**

破坏可重建和审批一致性，不建议。

### CQ-EP-06：权限变化后如何处理已有 Snapshot？

**首期选择 A：Snapshot 保留为不可变历史，但不作为授权；Revision 变化后新操作重新鉴权，必要时重新解析或新建 Session。**

在途调用沿用 ADR-0007 的读取、写入和 Durable Job 分类。

**B｜Snapshot 在 Session 结束前继续拥有原权限。**

不满足撤权要求。

**C｜透明原地重写 Snapshot。**

破坏历史证据和可重建性。

### CQ-EP-07：Profile 与 Runtime 不兼容时？

**首期选择 A：调度到兼容 Runtime；不存在时创建替代 Runtime 或拒绝，不动态安装 Plugin。**

**B｜允许对 DRAINING Runtime 受控安装后继续。**

未来可通过 RuntimePluginApplier 评估。

**C｜活动 Runtime HMR。**

首期不作为一致性基础。

## S. 已接受首期基线

```text
CQ-EP-01 = A
CQ-EP-02 = A
CQ-EP-03 = A
CQ-EP-04 = A
CQ-EP-05 = A
CQ-EP-06 = A
CQ-EP-07 = A
```

## T. 实施授权

本 ADR 只冻结技术设计，不自动授权：

1. 创建生产 Expert Profile 或写入正式专业内容；
2. 建设 Profile 管理页面；
3. 设计数据库表、迁移或具体 API；
4. 建设 Profile Resolver、Assignment Service 或 Policy Engine；
5. 引入 Dify、Open WebUI、OpenFGA 或其他产品代码；
6. 修改 DSH Core；
7. 部署、提交或推送。

实施必须等待全部技术 ADR、统一 DSH 无侵入审查和独立任务书。下一批进入身份、权限和外部系统注册。
