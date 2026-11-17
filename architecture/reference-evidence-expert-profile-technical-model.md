# Expert Profile 技术模型参考证据

> 状态：Accepted Evidence
> 日期：2026-11-09
> 关联决策：ADR-0009 Expert Profile 技术模型
> 新增候选仓库数量：3
> 说明：本批锁定精确 Commit、许可证、源码路径和测试；外部测试未执行，因此新增证据保持 R2。DSH rc.3 复用 ADR-0006 已接受证据。

## REF-EP-001：Dify Agent Draft、Immutable Snapshot 与运行绑定

```text
reference_id: REF-EP-001
product_tree_node: T3.1-T3.6
candidate_repository: langgenius/dify
repository_url: https://github.com/langgenius/dify
baseline_commit: cc53107f820130ee3283e5680b6762ef6cde8d47
commit_date: 2026-11-09
license: Modified Apache-2.0
technology_stack: Python / TypeScript / SQLAlchemy / Pydantic
evidence_level: R2
adoption_decision: adapt / compare_only
```

### 许可证边界

Dify 许可证允许部分商业使用，但对多租户服务和前端 Logo / Copyright 有附加限制。

本批只借鉴技术概念和调用链，不复制其前端、数据库模型或受限制代码。

### 检查路径

- `api/models/agent.py`
- `api/models/agent_config_entities.py`
- `api/services/agent_config_service.py`
- `api/services/agent/composer_service.py`
- `api/services/agent/workflow_publish_service.py`
- `api/services/rbac_agent_access_service.py`
- `api/core/app/public_runtime.py`
- `api/core/app/entities/app_invoke_entities.py`
- `api/tests/unit_tests/services/agent/test_roster_service.py`
- `api/tests/unit_tests/services/agent/test_workflow_publish_service.py`
- `api/tests/unit_tests/clients/agent_backend/test_request_builder.py`

### 主调用链

```text
Agent stable identity
→ shared AgentConfigDraft or per-user Build Draft
→ publish validation
→ immutable AgentConfigSnapshot
→ active_config_snapshot_id
→ WorkflowAgentNodeBinding.current_snapshot_id
→ AgentWorkspaceBinding.agent_config_version_id / kind
→ runtime request with snapshot / draft / build_draft selector
```

### 对象确认

Dify 当前源码显式区分：

- `Agent`：稳定 Agent 身份和当前 active snapshot 指针；
- `AgentConfigDraft`：可编辑 Draft；
- `AgentConfigSnapshot`：不可变版本；
- `AgentConfigRevision`：版本切换和保存审计边；
- `WorkflowAgentNodeBinding`：Workflow 版本和 Agent Snapshot 的绑定；
- `AgentWorkspaceBinding`：运行参与者、配置版本和 Session Snapshot；
- `AgentHomeSnapshot`：不可变 Home 内容引用。

`AgentConfigSnapshot` 使用 `(agent_id, version)` 唯一约束。配置可以保存 Secret Reference，但明确禁止明文 Secret。

### 配置确认

`AgentSoulConfig` 包含：

- Prompt；
- Tool；
- Knowledge；
- Human；
- Environment / Secret Ref；
- Config Skills / Files；
- Sandbox；
- Memory；
- Model；
- App Features；
- App Variables。

Tool 配置使用 Provider / Plugin / Tool 身份和 CredentialRef；Knowledge 使用显式 Dataset / Set；Model 使用 Provider、Model 和 CredentialRef。

### Draft 与运行版本

源码区分：

```text
snapshot
draft
build_draft
```

- Snapshot 只读；
- Shared Draft 由 Console 编辑；
- Build Draft 绑定具体 Account，可用于用户隔离的调试构建；
- 非 Draft 目标的写入被拒绝；
- Tenant、Agent、Version Kind 和 Account 同时参与查询条件。

### 发布与绑定

- Publish 创建新 Snapshot，而不是原地改写旧 Snapshot；
- `active_config_snapshot_id` 指向当前发布版本；
- Workflow 发布复制并冻结 Node Binding；
- Roster Agent 使用当前 active snapshot；
- Inline Agent 可以复制为独立 Snapshot；
- 发布时验证 Agent Node、Composer Config 和未解析 Skill / Asset 引用；
- Public Runtime 只暴露存在有效 Published Artifact 的 App / Agent。

### 测试证据

已检查测试覆盖：

- Draft 与 Snapshot 读取差异；
- per-user Build Draft；
- publish / save new version / restore version；
- Workflow 发布复制当前 Snapshot；
- 发布只冻结复制行，不修改 Draft Binding；
- 缺失 Snapshot 拒绝；
- Agent Soul Prompt、Knowledge 和 Model Layer 构造；
- Snapshot 与 Draft 请求保持不同版本语义。

测试未在本机执行。

### 可借鉴

1. 稳定身份、Draft、Immutable Snapshot、Revision 分层；
2. Shared Draft 与 per-user debug Draft 分离；
3. Workflow / Runtime Binding 固定 Snapshot ID；
4. 配置包含 Prompt、Tool、Knowledge、Model、Skill、File 和 Sandbox；
5. Secret 只保存 Reference；
6. 发布前检查未解析依赖；
7. Public Runtime 只使用 Published Artifact。

### 不可直接照搬

- Dify Agent Soul 是其自身产品模型，不等于 Process Copilot Business Expert Profile；
- Dify Snapshot 未表达我方 Assignment、Authorization Revision、Runtime Epoch、Fencing 和 Tool Release；
- Dify 的 Draft / Build Draft 产品流程不自动满足企业 Profile 发布审核；
- Dify 数据库表和 API 不形成我方实现约束；
- 修改版许可证不适合作为直接代码复用默认来源。

## REF-EP-002：Open WebUI Model Preset、Access Grants 与 History

```text
reference_id: REF-EP-002
product_tree_node: T3.2-T3.6
candidate_repository: open-webui/open-webui
repository_url: https://github.com/open-webui/open-webui
baseline_commit: b0e6098e940942281d9c83f3529ea117287a3a22
commit_date: 2026-11-09
license: Open WebUI License with branding restriction
technology_stack: Python / FastAPI / SQLAlchemy / Pydantic / Svelte
evidence_level: R2
adoption_decision: compare_only / adapt_concepts
```

### 许可证边界

当前许可证包含 Open WebUI 品牌保留限制，超过许可证阈值的部署若移除或替换品牌需要额外许可。

本批仅比较设计，不复制代码或界面。

### 检查路径

- `backend/open_webui/models/models.py`
- `backend/open_webui/models/model_history.py`
- `backend/open_webui/models/access_grants.py`
- `backend/open_webui/routers/models.py`
- `backend/open_webui/models/knowledge.py`
- `backend/open_webui/models/tools.py`
- `backend/open_webui/utils/access_control/__init__.py`

### 主调用链

```text
Workspace Model Preset
  base_model_id + params + meta + knowledge + access grants
→ creator permission check
→ referenced file access check
→ sharing audience filter
→ immutable ModelHistory snapshot
→ optimistic version_id update
→ user model access check
→ chained base-model access check
→ provider invocation
```

### Profile-like 配置确认

`Model` 是 Workspace 中包装上游 LLM 的配置项：

- `base_model_id`；
- `params`；
- `meta`；
- `knowledge`；
- capabilities；
- access grants；
- active / hidden 等运行状态。

这说明“专家预设”可以由基础模型、系统参数、知识和能力组合形成，而不是复制模型本身。

### 版本确认

- 每次配置变化创建 `ModelHistory` Snapshot；
- History 保存 parent、author、commit message 和 created_at；
- Production Row 保存当前 `version_id`；
- 恢复旧 History 时切换 Production；
- 当前 Production Version 不能删除；
- 更新使用 `where current.version_id == expected.version_id`，冲突返回 409。

### 权限确认

- 创建 Model 先检查 workspace permission；
- 非管理员必须基于已有 base model；
- Knowledge File 在保存和导入时检查当前用户 read 权限；
- Access Grant 的用户、组和 public audience 受创建者 sharing policy 过滤；
- 运行时检查 Model 本身 Access Grant；
- 继续沿 base model chain 检查每一层 read 权限；
- Shared Preset 不能绕过用户对 Base Model 或 Knowledge File 的权限。

### 可借鉴

1. 配置预设与基础模型分离；
2. 绑定知识、能力和参数；
3. 每次变更形成 History Snapshot；
4. 乐观并发；
5. 分享权限和底层资源权限分开检查；
6. 递归检查依赖链；
7. 非法 Sharing Audience 在保存前过滤或拒绝。

### 不可直接照搬

- Live Model Row 仍是可变 Production 对象，不等于严格不可变 Release；
- History 允许删除非当前版本，不满足我方永久审计要求；
- Group Permission 使用偏宽松并集，不等于我方 Profile 能力交集；
- 没有 Assignment、Effective Snapshot、Runtime Compatibility 或 Session Pinning；
- Model Preset 不等于完整业务 Expert Profile；
- 许可证限制使其更适合作为 `compare_only`。

## REF-EP-003：OpenFGA Authorization Model、Relationship Tuple 与 Contextual Check

```text
reference_id: REF-EP-003
product_tree_node: T3.3 / T3.6
candidate_repository: openfga/openfga
repository_url: https://github.com/openfga/openfga
baseline_commit: 4b09dafb027d839e6c42073e6e288f5ea6881d4d
commit_date: 2026-11-07
license: Apache-2.0
technology_stack: Go / gRPC / Relationship-based Access Control
evidence_level: R2
adoption_decision: adapt / compare_only
```

### 检查路径

- `pkg/server/commands/write_authzmodel.go`
- `pkg/server/commands/write_authzmodel_test.go`
- `pkg/server/commands/check_command.go`
- `pkg/server/commands/check_command_test.go`
- `pkg/typesystem/typesystem.go`
- `tests/check/check.go`
- `tests/check/check_test.go`
- `tests/functional_test.go`

### 主调用链

```text
Write Authorization Model
→ generate immutable AuthorizationModelId
→ schema / relation / condition / cycle validation
→ persist model

Check
→ exact AuthorizationModelId
→ user-object-relation tuple
→ persisted relationship tuples
→ request Contextual Tuples
→ condition context
→ consistency / cache invalidation choice
→ graph resolution
→ allowed / denied + resolution metadata
```

### 模型版本确认

每次写入：

- 创建新的 ULID Model ID；
- 保存 Schema Version、Type Definitions 和 Conditions；
- 执行大小、类型、关系、条件、入口和循环验证；
- Check 使用 TypeSystem 中的精确 Authorization Model ID。

这适合作为“策略模型版本固定”的参考。

### 动态关系确认

OpenFGA 将：

- 稳定 Authorization Model；
- 持久 Relationship Tuples；
- 请求级 Contextual Tuples；
- 条件 Context；

分开处理。

这与我方：

- Profile Release；
- 用户 / 组 / 项目 Assignment；
- 当前 Task Context；
- Authorization Revision；

分层方向一致。

### 交集与排除

Type System 支持：

- Union；
- Intersection；
- Difference / `but not`；
- Tuple-to-Userset；
- Conditions。

Profile 能力交集可以借鉴其关系模型表达，但不能直接把整个 Effective Profile 解析委托给 OpenFGA。

### 一致性和缓存

- Higher Consistency 可绕过普通缓存失效时间；
- 普通 Check 注入 Cache Invalidation Time；
- Contextual Tuple 使用与持久写 Tuple 相同的严格验证；
- Timeout / Throttling 保留部分解析元数据。

### 测试证据

已检查测试覆盖：

- 无效 Schema、Relation、Condition 和 Cycle；
- exact Authorization Model ID；
- Contextual Tuple；
- Union / Intersection / Difference；
- Higher Consistency；
- cache invalidation；
- invalid / missing model。

本机未安装 Go，测试未执行。

### 可借鉴

1. 策略模型不可变版本 ID；
2. 模型、关系数据和请求上下文分离；
3. Union / Intersection / Difference；
4. Contextual Tuple；
5. 条件策略；
6. 一致性和缓存失效选择；
7. Fail Closed 的模型校验。

### 不可直接照搬

- OpenFGA 只回答关系授权，不生成 Expert Profile Snapshot；
- 不管理 Prompt、ToolRelease、Plugin Requirements、Model Route 或 Knowledge；
- 不处理 Runtime Compatibility、Session Binding 和 Output Contract；
- Contextual Tuple 不是长期 Assignment；
- 授权允许不代表业务系统最终操作一定允许。

## 复用的 DSH 已接受证据

复用：

- `REF-ADAPTER-001`：Profile、Bundle 与静态装配；
- `REF-ADAPTER-003`：AgentPreset 与 Session 级装配；
- `REF-ADAPTER-004`：Agent / Tool Guard；
- `REF-TP-001`：Tool Registry、Approval、Plugin Manager 与 MCP Bridge。

本批额外核对 DSH `dsh-v0.2.1-rc.3`：

- `packages/preset/agent-preset/README.md`
- `packages/preset/agent-preset/src/index.ts`
- `packages/preset/agent-preset-registry/README.md`
- `packages/preset/agent-preset-registry/src/definition.ts`
- `packages/preset/agent-preset-registry/src/session.ts`
- `packages/preset/agent-preset-registry/tests/registry.spec.ts`

确认：

1. Preset 是普通 Cordis Plugin 子树；
2. 一个进程可同时运行多个 Preset Composition；
3. 更新 Definition 后，已有 Agent 在进程内保留旧 Revision；
4. 新 Agent 使用新 Revision；
5. 空白 Session 可选择 Preset；
6. 首个 Turn 后拒绝切换；
7. Session Event 记录 Preset Selection；
8. Duplicate ID、Broken Definition、Missing Service 和 Global Service Leak 被拒绝；
9. Preset 不是安全 Sandbox；
10. 旧 Revision 实现不跨进程重启保留。

因此：

- 可把 Effective Profile 映射到受控 AgentPreset 和 Session Tool View；
- 不可只保存 Preset ID 作为业务 Profile 快照；
- PC 必须保存 Release、Dependency Lock 和完整 Effective Snapshot；
- 用户不得提交任意 Preset Plugin Tree。

## 综合证据结论

### 可采用的结构

1. 稳定 Definition + Editable Draft + Immutable Release；
2. Release Revision 和运行 Binding 分开；
3. Profile 内容覆盖 Prompt、Rule、Tool、Knowledge、Model、Skill / File 和 Output Contract；
4. Secret 只保存 Reference；
5. Assignment、当前请求上下文和授权模型版本分层；
6. Effective Snapshot 固定精确版本；
7. 底层资源访问独立复核；
8. 乐观并发和版本冲突；
9. 必需依赖发布前验证；
10. Session 首个 Turn 后不原地切换。

### 必须由 PC 自行设计

1. ExpertProfileDefinition / Draft / Release；
2. ProfileAssignment；
3. UserProfilePreference；
4. EffectiveProfileSnapshot；
5. Tool / Plugin / Model / Knowledge 分域解析；
6. Required / Optional / Fallback；
7. Runtime Requirements 和调度；
8. Authorization / Policy / Resource Revision；
9. Release Channel、Deprecation 和 Revocation；
10. Output / Completion Contract；
11. AgentInstance / Session 绑定；
12. Profile 全链路审计。

### 排除

- 为每个用户默认复制一份 Profile；
- 把 Profile Assignment 当成底层权限；
- 把 DSH AgentPreset 当成企业 Expert Profile；
- 把 Profile 当成任意 Plugin YAML；
- 把 Open WebUI Model History 当成永久不可变 Release；
- 把 OpenFGA Check 当成完整 Profile Resolver；
- 允许活动 Session 自动跟随最新 Release；
- 允许用户通过个性化扩大 Tool、知识、模型或外部系统权限。
