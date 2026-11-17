# ADR-0008：Tool / Plugin Registry 与执行治理

- 状态：Accepted
- 日期：2026-11-09
- 范围：T6.1 至 T6.7、G1 至 G6、T11.3
- 前置决策：ADR-0001 至 ADR-0007
- 用户决策：CQ-TP-01=A、CQ-TP-02=A、CQ-TP-03=A、CQ-TP-04=A、CQ-TP-05=A
- 实施原则：本 ADR 只冻结技术设计；产品设计、数据库、部署、生产 Tool/Plugin 安装、DSH 修改和代码实施均需独立任务书

## A. 本批设计目标

本批回答：

1. Tool Definition、Release、Registration、Call、Result 如何分层；
2. Plugin Definition、Release、Installation、Activation 如何分层；
3. Tool / Plugin 谁可以发布、从哪里取得、如何锁定版本和依赖；
4. Release 如何校验完整性、兼容性、来源、撤销和弃用；
5. `read`、`write`、`destructive`、`external_side_effect` 如何形成可执行策略；
6. 审批预览、参数冻结、幂等、超时、取消、重试、回读和未知结果如何串成闭环；
7. 大结果、文件、流式进度、异步 Job 和部分结果使用什么统一契约；
8. 哪些能力可映射到 DSH 现有机制，哪些必须由 Process Copilot 持有。

## B. 非目标

本批不设计：

- 最终产品页面和交互；
- Tool 市场或 Plugin 商店的产品形态；
- 现有 Demo 的迁移；
- 具体数据库表；
- 具体 REST / RPC 路径；
- 具体编程语言和部署排期；
- 直接修改 DSH；
- 直接安装任何生产 Plugin；
- 直接向企业系统执行 Tool。

## C. 本批工程结论摘要

建议采用：

```text
Process Copilot Backend
  |
  +-- Tool / Plugin Registry Module
  |     - Definition / Release
  |     - Publisher / Source
  |     - Compatibility / Dependency Lock
  |     - Risk Manifest / Revocation
  |
  +-- Effective Capability Resolver
  |     - Profile Release
  |     - User / Project / Resource Permission
  |     - Runtime Capability Manifest
  |     - Tool Policy
  |
  +-- Tool Execution Control Plane
        - ToolCall / Operation Ledger
        - Approval Snapshot
        - Admission / Fencing / Idempotency
        - Timeout / Cancel / Retry / Reconciliation
        - ToolResult / ResourceRef / JobHandle
                |
                v
        PC Tool Gateway / MCP Gateway
                |
                v
        DSH ToolRuntime / Plugin / External Provider
```

核心结论：

1. Registry 权威属于 PC Backend，首期作为模块实现并保留未来独立服务接口；
2. Definition 是稳定逻辑身份，Release 是不可变版本，Registration 是某个 Provider / Runtime 对 Release 的实际暴露；
3. Plugin Installation 与 Activation 分开；首期生产 Runtime 只允许部署期装配，不允许 Session 驱动安装、升级或卸载；
4. DSH Plugin Manager 可作为运维实现参考或受控装配工具，但不是 PC 企业发布、授权、审批和审计权威；
5. 风险不能压成单一枚举，必须使用多维 Risk Manifest，再派生兼容标签；
6. 审批必须绑定不可变参数、Tool Release、Schema Digest、资源范围和影响预览；
7. ToolCall 是一次业务意图，Execution Attempt 是一次技术派发，两者不能合并；
8. 超时和取消都不是外部副作用停止的证明；
9. 写操作继续沿用 ADR-0003 的恢复分类，未知结果必须先对账；
10. 大结果、文件和证据必须落为 ResourceRef；异步工作使用可重新鉴权的 JobHandle。

## D. 权威边界

### D1. PC Backend 权威

PC Backend 持有：

- ToolDefinition / ToolRelease；
- PluginDefinition / PluginRelease；
- Publisher、Source、Release 审核和撤销；
- Risk Manifest 和策略映射；
- Dependency Lock 和 Compatibility Matrix；
- Effective Tool Set Snapshot；
- ToolCall、Approval、Operation Ledger；
- 业务幂等、恢复、回读和审计；
- ResourceRef 和业务结果。

### D2. DSH 权威

DSH 只持有当前 Runtime 内的技术事实：

- Plugin Fiber 和 Loader Entry；
- Runtime Tool Registry；
- Scoped Tool View；
- `tools/pre-execute`、Guard、`tools/execute`、`tools/post-execute`；
- ToolExecution 和规范化技术结果；
- DSH Approval 暂停点；
- Runtime 内取消、清理、HMR 或重启事实。

DSH 不持有：

- 企业 Tool 发布权；
- PC 用户、项目和资源授权权威；
- 持久业务审批；
- Operation Ledger；
- 外部写操作业务幂等权威；
- Release 撤销权威；
- 跨 Runtime Registry。

### D3. Provider 与 Gateway 权威

Tool Provider 或最终业务系统负责：

- 实际执行；
- 最终业务权限校验；
- 外部幂等和业务唯一性；
- 可查询的 external_ref；
- 业务成功事实；
- 回读结果和对账能力。

PC Gateway 是最后一个由 PC 控制的执行门禁，但不能替代最终系统自身的授权和完整性约束。

## E. 对象模型

### E1. ToolDefinition

`ToolDefinition` 是稳定逻辑能力，不包含可执行代码。

建议字段：

```text
ToolDefinition
- tool_definition_id
- canonical_name
- namespace
- display_name
- purpose
- owner_ref
- publisher_policy_ref
- capability_category
- lifecycle_status
- created_at
- retired_at
```

同一个 Definition 可以有多个 Release。逻辑身份不因实现版本变化。

### E2. ToolRelease

`ToolRelease` 是不可变、可执行、可审计的版本。

```text
ToolRelease
- tool_release_id
- tool_definition_id
- semantic_version
- release_digest
- input_schema
- input_schema_digest
- output_schema
- output_schema_digest
- execution_binding
- provider_requirements
- risk_manifest
- recovery_class
- approval_policy_ref
- readback_policy
- timeout_policy
- dependency_lock_ref
- compatibility_matrix_ref
- artifact_ref
- provenance_ref
- published_by
- published_at
```

Release 发布后不可原地修改。修正必须发布新版本。

### E3. ToolRegistration

`ToolRegistration` 表示某个 Provider、Connector、Plugin 或 Runtime 实际暴露的 Tool。

```text
ToolRegistration
- tool_registration_id
- tool_release_id
- registration_kind
- provider_release_ref
- runtime_id
- runtime_epoch
- provider_instance_ref
- raw_tool_name
- public_tool_name
- observed_schema_digest
- registration_scope
- capability_requirements
- health_status
- registered_at
- expires_at
```

Registration 是运行事实，可以变化；Release 不可变。

MCP Tool 的稳定身份继续使用 ADR-0007 的：

```text
mcp_server_id
+ raw_tool_name
+ provider_release
+ schema_digest
```

### E4. ToolCall

`ToolCall` 表示一次经 PC 接纳的业务调用意图。

```text
ToolCall
- tool_call_id
- operation_id
- tool_release_id
- tool_registration_id
- effective_profile_snapshot_id
- subject_user_id
- actor_service_id
- session_id
- task_id
- project_id
- authorization_revision
- assignment_generation
- fencing_token
- request_payload_ref
- request_hash
- approval_ref
- approval_payload_hash
- idempotency_key
- status
- created_at
- admitted_at
- completed_at
```

ToolCall 不因技术重试而创建新业务意图。

### E5. ToolExecutionAttempt

一次 ToolCall 可以有多个技术 Attempt：

```text
ToolExecutionAttempt
- attempt_id
- tool_call_id
- attempt_no
- runtime_id
- runtime_epoch
- provider_instance_ref
- dispatch_started_at
- execution_started_at
- settled_at
- timeout_class
- cancellation_requested_at
- provider_request_id
- external_ref
- technical_status
- error_class
```

Attempt 不能被误当成业务幂等边界。

### E6. ToolResult

`ToolResult` 是 ToolCall 的权威业务结果封装。

```text
ToolResult
- tool_result_id
- tool_call_id
- outcome
- inline_data
- resource_refs
- artifact_refs
- job_handle
- external_refs
- observed_effects
- verification
- error
- partial
- completed_at
```

一个 ToolCall 最终只有一个当前权威结果状态；修复和对账通过结果版本或 Ledger 事件推进，不覆盖历史 Attempt。

### E7. PluginDefinition

`PluginDefinition` 是稳定插件产品身份：

```text
PluginDefinition
- plugin_definition_id
- canonical_name
- owner_ref
- publisher_policy_ref
- purpose
- capability_namespace
- plugin_kind
- lifecycle_status
```

### E8. PluginRelease

```text
PluginRelease
- plugin_release_id
- plugin_definition_id
- semantic_version
- release_digest
- package_name
- package_version
- artifact_ref
- entrypoints
- declared_capabilities
- provided_tool_releases
- required_services
- required_plugins
- forbidden_plugins
- dsh_version_range
- runtime_requirements
- config_schema_digest
- dependency_lock_ref
- provenance_ref
- published_at
```

### E9. PluginInstallation

Installation 表示制品已进入某个受控 Runtime Profile、镜像或节点缓存：

```text
PluginInstallation
- plugin_installation_id
- plugin_release_id
- installation_target
- target_revision
- installed_digest
- dependency_lock_digest
- installed_at
- installed_by
- installation_status
```

### E10. PluginActivation

Activation 表示安装的 Plugin Release 被某个 Runtime Profile Release 选择：

```text
PluginActivation
- plugin_activation_id
- plugin_installation_id
- runtime_profile_release_id
- activation_config_ref
- activation_config_digest
- desired_state
- observed_state
- activated_at
- deactivated_at
```

Session 不创建 Runtime 级 Activation。Session 只选择已发布 Expert Profile，并通过 Requirements 匹配已有 Runtime Capability。

## F. Registry 与发布治理

### F1. Registry 首期形态

首期建议作为 PC Backend 模块实现：

```text
ToolPluginRegistryPort
- publishDefinition
- publishRelease
- deprecateRelease
- revokeRelease
- resolveExactRelease
- resolveDependencyLock
- evaluateCompatibility
- listEffectiveCandidates
- getReleaseEvidence
```

内部可以使用关系数据库和对象存储。接口不得把数据库 Schema 暴露给其他模块，以便未来拆为独立服务。

### F2. Source 与 Publisher

建议分开记录：

```text
Source
  制品从哪里取得

Publisher
  谁声明并负责这个 Release

Owner
  谁对业务用途、风险分类和维护负责
```

三者不能用一个 `created_by` 替代。

### F3. 发布流水线

```text
Submission
→ Source Allowlist
→ Manifest Parse
→ Schema Validation
→ Dependency Resolution
→ Compatibility Check
→ Risk Review
→ Artifact Digest
→ Optional Signature / Provenance Verification
→ Release Approval
→ Immutable Publication
```

发布失败不得产生可解析为 ACTIVE 的半成品 Release。

### F4. 版本与依赖

每个 Runtime Profile Release 和 Expert Profile Release 最终引用：

- 精确 Tool Release；
- 精确 Plugin Release；
- 精确依赖锁；
- 精确 Schema Digest；
- 精确 Runtime Capability 要求。

禁止在有效快照中使用：

- `latest`；
- 未解析 SemVer Range；
- 漂移 Git Branch；
- 无 Digest URL；
- 运行时临时下载的未知制品。

### F5. 冲突

冲突处理建议：

1. 同一作用域重复 public tool name：拒绝；
2. 同一 Definition + Version 不同 Digest：拒绝并告警；
3. 依赖版本无法同时满足：发布或装配失败；
4. Provider 报告 Schema 与 Release Digest 不同：Registration 不健康且不可进入 Effective Tool Set；
5. Plugin 声明互斥：装配失败，不按加载顺序取胜；
6. 同一 Capability 多 Provider：只有显式 Selection Policy 才能选择。

### F6. 弃用、撤销和删除

```text
DEPRECATED
  不阻止已固定任务，阻止新 Profile 默认选择

REVOKED
  新调用立即拒绝；现有调用按风险进入取消、等待或对账

RETIRED
  不再发布和选择，但历史引用可读
```

Release 记录和审计证据不得物理删除。制品保留由合规和存储策略控制。

## G. Plugin 生命周期

### G1. 首期生产策略

建议首期采用：

```text
开发 / CI
→ 解析并锁定依赖
→ 构建或取得制品
→ 完整性与兼容性检查
→ 发布 Runtime Profile Release
→ 创建或替换 Runtime
```

生产 Runtime 启动后 Plugin 集稳定。

### G2. 安装、启用和运行分离

```text
AVAILABLE
→ APPROVED
→ INSTALLED
→ SELECTED_IN_RUNTIME_PROFILE
→ ACTIVE_ON_RUNTIME
→ DRAINING
→ INACTIVE
→ REMOVED
```

安装成功不等于已激活；激活成功不等于业务 Tool 已授权。

### G3. 变更方式

首期：

- 新安装、升级、降级、卸载通过新 Runtime Profile Release；
- 已运行 Runtime 不热更新生产 Plugin；
- 通过新 Runtime 替换旧 Runtime；
- 旧 Runtime 先 DRAINING；
- Session 只迁移到兼容 Runtime；
- 失败可回滚到上一 Runtime Profile Release。

### G4. DSH Plugin Manager 的定位

DSH rc.3 已支持：

- Profile 级 pnpm 安装和移除；
- package.json / lockfile 回滚；
- 文件锁和遗留进程检测；
- 精确版本兼容预检和风险豁免；
- Registry fallback；
- 安装取消；
- HMR 或 restart-required 结果；
- Plugin / Bundle 启用和禁用。

PC 首期不直接把这些接口暴露为租户或 Session 能力。可选用途：

- CI / 构建节点的受控装配实现；
- 管理员离线维护；
- 未来受控 Runtime 管理接口的底层候选；
- DSH 无侵入实现审查的证据。

## H. 风险模型

### H1. 不使用单一风险枚举

建议 Risk Manifest：

```text
ToolRiskManifest
- data_access
- side_effect_scope
- reversibility
- recovery_class
- approval_requirement
- readback_requirement
- network_access
- filesystem_access
- credential_use
- human_impact
- concurrency_policy
- timeout_policy
```

### H2. 维度

```text
data_access:
  NONE | METADATA | READ | READ_SENSITIVE | WRITE

side_effect_scope:
  NONE | PC_INTERNAL | EXTERNAL_SYSTEM | PHYSICAL_OR_HUMAN

reversibility:
  NONE | REVERSIBLE | COMPENSATABLE | DESTRUCTIVE

approval_requirement:
  NONE | POLICY_DECIDES | ALWAYS | DUAL_CONTROL

readback_requirement:
  NONE | BEST_EFFORT | REQUIRED
```

恢复分类沿用：

```text
REPLAY_SAFE
IDEMPOTENT_RETRY
RECONCILE_BEFORE_RETRY
NON_RECOVERABLE
EXTERNAL_DURABLE_JOB
```

### H3. 兼容标签

为兼容讨论和 UI，可派生：

```text
read
write
destructive
external_side_effect
```

这些是标签，不是互斥状态。一个 Tool 可以同时是：

```text
write + destructive + external_side_effect
```

### H4. 默认策略

- 未分类 Tool 不进入生产 Effective Tool Set；
- 未声明恢复分类的写 Tool 默认 `RECONCILE_BEFORE_RETRY`；
- 未声明审批策略的外部写 Tool默认拒绝；
- 未声明回读策略的 destructive Tool 默认拒绝；
- Schema、Risk Manifest 或执行绑定变化必须发布新 Tool Release。

## I. 执行治理

### I1. 调用流水线

```text
1. Resolve exact Tool Release and Registration
2. Build current Effective Tool Set decision
3. Validate user / tenant / project / resource scope
4. Validate Runtime / Assignment / Lease / Fencing
5. Canonicalize arguments and ResourceRefs
6. Compute request_hash
7. Build impact preview
8. Validate or request Approval
9. Freeze approval_payload_hash
10. Create ToolCall and Operation Ledger row
11. Dispatch through PC Gateway
12. Execute provider attempt
13. Normalize technical result
14. Read back or reconcile when required
15. Commit ToolResult and audit
```

### I2. 参数冻结

审批 Hash 至少覆盖：

```text
tool_release_id
input_schema_digest
canonical_arguments
resource_version_refs
target_system
target_object_refs
effect_preview
authorization_revision
policy_revision
idempotency_key
```

以下变化使审批失效：

- Tool Release 或 Schema 变化；
- 参数变化；
- 目标对象或 ResourceVersion 变化；
- 风险分类或策略变化；
- 用户权限或项目范围变化；
- Credential Generation 变化；
- 审批过期或被撤回。

### I3. 幂等

企业写操作必须有：

```text
operation_id
tool_call_id
idempotency_key
request_hash
fencing_token
```

相同幂等键但不同 request_hash 必须拒绝并告警。

### I4. 超时

至少区分：

- admission_timeout；
- approval_timeout；
- queue_timeout；
- provider_connect_timeout；
- execution_timeout；
- readback_timeout；
- reconciliation_timeout。

Client Timeout 只说明调用方停止等待。

### I5. 取消

取消状态建议：

```text
CANCEL_REQUESTED
CANCEL_ACKNOWLEDGED
CANCELLED_BEFORE_DISPATCH
CANCELLED_DURING_EXECUTION
CANCEL_NOT_SUPPORTED
CANCEL_OUTCOME_UNKNOWN
```

只有 Provider 可证明未执行或已完全停止时，才能确认无副作用取消。

### I6. 重试

重试必须同时满足：

- 当前授权仍有效；
- Approval Hash 仍有效；
- Assignment / Fencing 当前有效；
- 恢复分类允许；
- 错误分类允许；
- 预算未耗尽；
- 未发现既有成功结果。

401、断线和 Timeout 不自动允许重放写操作。

### I7. 回读验证

`REQUIRED` 回读至少验证：

- 目标对象身份；
- 期望版本或状态；
- 请求影响范围；
- 关键字段；
- 外部 operation / transaction reference。

回读不一致时不得直接报告成功。

### I8. Outcome Unknown

```text
OUTCOME_UNKNOWN
→ query by operation_id / idempotency_key / external_ref
→ SUCCEEDED / FAILED / COMPENSATION_REQUIRED / MANUAL_REVIEW
```

对账本身是新的受审计 Attempt，但不创建新的业务 ToolCall。

## J. Result Contract

### J1. 统一 Envelope

```text
ToolResultEnvelope
- contract_version
- tool_call_id
- tool_release_id
- outcome
- data
- resource_refs
- artifact_refs
- progress_summary
- job_handle
- external_refs
- observed_effects
- verification
- error
- partial
- metrics
```

### J2. Outcome

```text
SUCCEEDED
FAILED
PARTIAL
CANCELLED
OUTCOME_UNKNOWN
JOB_ACCEPTED
MANUAL_REVIEW
```

### J3. Inline Data

- 只允许受 Output Schema 验证的 JSON；
- 有明确大小上限；
- 不包含长期凭据；
- 不包含不受控绝对路径；
- 不包含超出当前用户权限的原始对象。

### J4. Resource 与 Artifact

大结果、文件、图片、报告和证据使用：

```text
ResourceRef
+ exact version_id
+ media_type
+ content_digest
+ classification
```

Tool 不能返回长期可用的对象存储 URL 作为稳定业务引用。

### J5. Progress

进度使用独立事件：

```text
ToolProgressEvent
- tool_call_id
- attempt_id
- sequence
- phase
- percent
- message_code
- metrics
- emitted_at
```

Progress 不是最终 Result，不进入模型历史时必须有明确投影策略。

### J6. JobHandle

```text
JobHandle
- job_id
- provider_job_ref
- operation_id
- tool_release_id
- status_endpoint_ref
- cancel_capability
- next_poll_after
- expires_at
```

JobHandle 不是授权凭据。Poll、Cancel、Resume 和 Result Fetch 每次重新鉴权。

### J7. Error

```text
ToolError
- code
- class
- message
- retryable
- recovery_class
- provider_code
- details_ref
- correlation_ref
```

原始敏感错误正文只进入受控诊断，不直接返回模型或普通用户。

### J8. Partial Result

Partial 必须声明：

- 哪些子项成功；
- 哪些失败；
- 是否产生外部副作用；
- 是否可重试；
- 是否需要补偿；
- 结果是否仍可作为业务证据。

## K. 与 DSH 的映射

| PC 概念 | DSH 机制 | 结论 |
|---|---|---|
| Runtime Tool Registration | `ctx.tools.register()` + disposer | 可适配 |
| Session Tool View | scoped registration / restrict | 可适配 |
| Final deny guard | monotonic Tool Guard | 可采用 |
| Pre / around / post policy | Tool pipeline | 可采用 |
| Canonical technical result | Tool output schema + normalized result | 可适配 |
| Cooperative cancel | `AbortSignal` | 可采用，但不能推导外部停止 |
| Runtime approval pause | `ctx.approval` | 只作执行暂停点 |
| Plugin lifecycle | Loader Entry / Fiber / dispose / HMR | 可适配 |
| Profile package management | DSH Plugin Manager | 只作装配候选 |
| Enterprise Release Registry | 无 | PC 持有 |
| Persistent business Approval | 无 | PC 持有 |
| Operation Ledger / idempotency | 无 | PC 持有 |
| Release revocation authority | 无 | PC 持有 |

## L. 未来升级接口

首期保留：

1. `ArtifactVerifier`：未来接入 Sigstore / Cosign；
2. `ProvenanceVerifier`：未来接入 SLSA / in-toto；
3. `RegistryBackend`：未来从 Backend 模块拆独立服务；
4. `PublisherPolicy`：未来允许受治理业务团队发布；
5. `RuntimePluginApplier`：未来受控热更新或滚动替换；
6. `DependencySolver`：未来支持多生态制品；
7. `RevocationFeed`：未来接入外部安全公告和信任根；
8. `DualControlApprovalPolicy`：未来高危双人审批；
9. `CompensationHandler`：未来自动补偿工作流；
10. `ToolResultAdapter`：兼容 MCP、DSH、本地 Plugin 和独立服务。

## M. 工程默认决策

### 对象与权威

- **ED-TP-001**：PC Backend 是 Tool / Plugin 企业 Registry 权威。
- **ED-TP-002**：Definition 与 Release 必须分离。
- **ED-TP-003**：Release 发布后不可原地修改。
- **ED-TP-004**：ToolRegistration 是运行事实，不是 Release。
- **ED-TP-005**：ToolCall 是业务意图，ExecutionAttempt 是技术派发。
- **ED-TP-006**：ToolResult 是业务结果封装，DSH ToolResult 只是技术输入。
- **ED-TP-007**：Plugin Installation 与 Activation 分离。
- **ED-TP-008**：Source、Publisher、Owner 分开记录。
- **ED-TP-009**：历史 Release 和撤销证据不可物理覆盖。
- **ED-TP-010**：首期 Registry 作为 Backend 模块，接口按未来拆分设计。

### 发布、版本和依赖

- **ED-TP-011**：有效快照只引用精确 Release 和 Digest。
- **ED-TP-012**：禁止 `latest`、漂移 Branch 和未解析版本范围进入运行快照。
- **ED-TP-013**：每个 Release 必须有 Input / Output Schema Digest。
- **ED-TP-014**：每个可执行制品必须有内容 Digest。
- **ED-TP-015**：首期只允许 Allowlist Source。
- **ED-TP-016**：依赖解析结果必须形成不可变 Lock。
- **ED-TP-017**：相同版本不同 Digest 必须拒绝。
- **ED-TP-018**：依赖冲突在发布或装配期失败，不按加载顺序取胜。
- **ED-TP-019**：Compatibility Matrix 同时覆盖 DSH、Runtime Profile、Plugin 和 Provider。
- **ED-TP-020**：Deprecation 不影响已固定任务，Revocation 立即影响新调用。

### Plugin 生命周期

- **ED-TP-021**：生产 Runtime 启动后 Runtime 级 Plugin 集稳定。
- **ED-TP-022**：Session 不得安装、升级、启用或卸载 Runtime Plugin。
- **ED-TP-023**：首期 Plugin 变更通过新 Runtime Profile Release 和 Runtime 替换。
- **ED-TP-024**：卸载前必须 DRAINING 并等待受控资源释放。
- **ED-TP-025**：安装成功不等于激活成功。
- **ED-TP-026**：激活成功不等于业务 Tool 已授权。
- **ED-TP-027**：生产制品不得依赖运行时临时构建脚本。
- **ED-TP-028**：DSH Plugin Manager 不作为 PC Registry 或租户发布接口。
- **ED-TP-029**：DSH HMR 只作为开发、运维或未来能力，不作为首期生产一致性基础。
- **ED-TP-030**：Runtime Capability Manifest 必须上报实际 Plugin、Provider 和 Tool 能力。

### 风险与授权

- **ED-TP-031**：风险使用多维 Manifest，不使用单一互斥枚举。
- **ED-TP-032**：`read/write/destructive/external_side_effect` 是派生标签。
- **ED-TP-033**：未分类 Tool 不进入生产 Effective Tool Set。
- **ED-TP-034**：未分类写 Tool 默认 `RECONCILE_BEFORE_RETRY`。
- **ED-TP-035**：外部写 Tool 未声明审批策略时默认拒绝。
- **ED-TP-036**：Destructive Tool 首期默认禁用。
- **ED-TP-037**：Risk Manifest 变化必须发布新 Tool Release。
- **ED-TP-038**：Tool Discovery 过滤不能替代执行时重新授权。

### 执行治理

- **ED-TP-039**：参数在审批前进行规范化和不可变快照。
- **ED-TP-040**：Approval Hash 绑定 Release、Schema、参数、资源版本和影响预览。
- **ED-TP-041**：任何授权、参数、目标或策略变化使旧审批失效。
- **ED-TP-042**：企业写必须携带 operation_id、idempotency_key、request_hash 和 fencing_token。
- **ED-TP-043**：相同幂等键不同 request_hash 必须拒绝。
- **ED-TP-044**：超时只表示等待边界，不证明外部操作停止。
- **ED-TP-045**：取消是请求，Provider 事实决定最终状态。
- **ED-TP-046**：401、断线和 Timeout 不自动重放写操作。
- **ED-TP-047**：Required Readback 未通过时不得报告业务成功。
- **ED-TP-048**：Outcome Unknown 必须先对账，再决定补记、重试或人工介入。

### 结果与审计

- **ED-TP-049**：Inline Result 只允许有界、Schema 验证的 JSON。
- **ED-TP-050**：大结果、文件和证据使用精确版本 ResourceRef。
- **ED-TP-051**：Progress Event 与最终 ToolResult 分离。
- **ED-TP-052**：JobHandle 不是授权凭据，每次操作重新鉴权。
- **ED-TP-053**：Partial Result 必须声明已产生的副作用和补偿要求。
- **ED-TP-054**：敏感 Provider Error 通过受控 details_ref 保存。
- **ED-TP-055**：ToolCall、Attempt、Approval、Readback 和 Reconciliation 全链路关联。
- **ED-TP-056**：所有结果都记录 Tool Release、Provider Release、Schema Digest 和 Runtime Epoch。

## N. 与既有 ADR 的一致性

| 前置 ADR | 本批保持的约束 |
|---|---|
| ADR-0001 | Runtime Plugin 集稳定；Session Tool View；三层 Tool 隔离 |
| ADR-0002 | Assignment、Lease、Fencing、幂等和最终 Gateway 门禁 |
| ADR-0003 | 恢复分类、Outcome Unknown、重新鉴权和审批 Hash |
| ADR-0004 | DRAINING、Plugin / Tool Executor Close、Runtime Registry |
| ADR-0005 | ResourceRef、Version、Materialization 和受控文件边界 |
| ADR-0006 | PC Backend 权威；DSH 技术事实；Adapter / Plugin / Gateway 优先 |
| ADR-0007 | Raw Catalog 与 Effective Tool Set 分离；执行时重授权；MCP ToolRef |

## O. 首期用户决策

用户已确认五项均采用方案 A。以下保留备选方案，用于说明首期取舍和未来演进边界。

### CQ-TP-01：首期谁可以发布 Tool / Plugin Release？

**首期选择 A：仅平台团队发布。**

- 业务团队提交需求或制品；
- 平台完成风险、兼容和发布审核；
- 未来通过 PublisherPolicy 开放受治理业务发布。

**B｜平台和经过授权的业务团队均可发布。**

- 灵活性更高；
- 首期需要更完整的组织、审批、隔离和追责模型。

**C｜租户可自助发布。**

- 当前安全、兼容和供应链治理成本过高，不建议。

### CQ-TP-02：首期生产 Plugin 如何安装和激活？

**首期选择 A：只允许部署期预批准 Bundle，通过新 Runtime Profile Release 和 Runtime 替换生效。**

- 与 ADR-0001 的 Plugin 稳定性一致；
- 回滚和兼容判断最清晰；
- 保留未来 RuntimePluginApplier 接口。

**B｜允许管理员对 DRAINING Runtime 执行受控在线安装和重载。**

- 发布速度更快；
- 需要更复杂的状态、回滚、连接和 Session 兼容验证。

**C｜允许活动 Runtime HMR。**

- 灵活性最高；
- 首期不建议作为生产一致性基础。

### CQ-TP-03：首期制品信任基线？

**首期选择 A：Allowlist Source + 精确 Digest + Dependency Lock + Compatibility Matrix + Revocation。**

- 首期可落地；
- 保存 signature / provenance 接口和字段；
- 后续可升级到强制签名和透明日志。

**B｜首期强制 Sigstore / Cosign 签名和 Provenance。**

- 供应链保证更强；
- 对构建、密钥、信任根和离线环境要求更高。

**C｜只依赖包管理器 checksum。**

- 不足以表达发布者身份、PC 审核和撤销，不建议。

### CQ-TP-04：Destructive Tool 首期策略？

**首期选择 A：默认禁用；显式启用时必须 ALWAYS Approval、精确预览、Required Readback 和 Reconciliation。**

**B｜默认允许，但要求强审批。**

**C｜按普通 Write Tool 处理。**

不建议 C。

### CQ-TP-05：Registry 首期部署形态？

**首期选择 A：PC Backend 内部模块，使用稳定 Port，未来可拆独立服务。**

- 避免首期过早分布式化；
- 不牺牲未来独立部署。

**B｜立即建设独立 Registry Service。**

- 边界更物理化；
- 增加一致性、部署、鉴权和运维成本。

## P. 已接受首期基线

```text
CQ-TP-01 = A
CQ-TP-02 = A
CQ-TP-03 = A
CQ-TP-04 = A
CQ-TP-05 = A
```

## Q. 实施授权

本 ADR 只冻结技术设计，不自动授权：

1. 建设或拆分 Registry Service；
2. 设计数据库表、迁移或具体 REST / RPC 接口；
3. 安装、升级、启用或卸载生产 Tool / Plugin；
4. 修改 DSH Core；
5. 建设 Sigstore、Cosign、SLSA、TUF 或供应链信任基础设施；
6. 部署、提交或推送；
7. 直接向企业系统执行 Tool。

实施必须等待全部技术 ADR、统一 DSH 无侵入审查和独立任务书。下一批进入 Expert Profile 技术模型。

