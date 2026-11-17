# Process Copilot 稳定 Contract Catalog v1

- 状态：Accepted Implementation Blueprint
- 日期：2026-11-09
- 依据：ADR-0001 至 ADR-0017
- 目标：冻结首期跨模块语义，不预先绑定 REST、gRPC、队列或数据库实现

> 2026-11-16 Accepted Extension：长期记忆 C43-C60 定义于 `memory-contract-catalog-v1.md`，并由 `memory-contract-review-v1.md` 完成评审。C01-C42 的既有语义不变。

## 1. Contract 规则

### 1.1 稳定性

1. 跨模块 Contract 使用显式 `contract_name` 与 `contract_version`；
2. 首期版本采用独立整数 major，例如 `pc.runtime-command/1`；
3. 新增可选字段可以保持 major；删除、改名、改变语义或收窄枚举必须升 major；
4. 未知字段默认保留或忽略，不能导致授权扩大；
5. 未知枚举在安全路径 fail closed，在展示路径显示为 unknown；
6. DSH 内部类型、错误文本、类实例和 SessionEvent 不得直接出现在稳定 Contract；
7. 所有时间使用 UTC instant；超时同时使用绝对 deadline，不能只传本地 duration；
8. 所有写命令必须具有 `command_id` 或 `idempotency_key`；
9. 所有安全敏感命令必须绑定 `tenant_id`、`principal_id`、授权版本和审计上下文。

### 1.2 通用信封

```text
ContractEnvelope
- contract_name
- contract_version
- message_id
- occurred_at / issued_at
- tenant_id
- trace_id
- correlation_id
- causation_id?
- producer
- payload
```

事件使用 `occurred_at`，命令/快照使用 `issued_at`。时间不是排序权威；排序使用显式 sequence、generation 或 version。

### 1.3 标识和摘要

ID 为不透明字符串，不编码用户、环境或数据库分片。Digest 使用：

```text
algorithm + canonicalization + value
```

首期默认 `sha-256`，但 Contract 不把算法写死为唯一未来选项。

## 2. Contract 分类

| 分类 | 用途 |
|---|---|
| Identity/Security | 主体、授权、委托、凭据和审批 |
| Runtime/Assignment | Runtime、Session 执行权、命令、健康和能力 |
| Profile/Capability | Profile、Tool、Plugin 和解析结果 |
| Resource | Resource、Workspace View 和 Materialization |
| Execution | Tool/MCP 调用、幂等、Fencing 和外部结果 |
| Event/Business | 技术事件接入、业务操作、恢复和投影 |
| Governance | 错误、兼容、追踪和审计 |

## 3. Identity 与 Security

### C01 `pc.request-context/1`

用途：API 到应用服务的可信请求上下文。

必需字段：

```text
tenant_id
principal_id
actor_id
authentication_context_id
authorization_revision
request_id
trace_id
client_context
```

不得包含下游 Access Token。

### C02 `pc.principal-envelope/1`

用途：向 Gateway 证明本次调用的 subject、actor、Session 和授权快照。

```text
envelope_id
issuer
audience
tenant_id
subject_principal_id
actor_principal_id
pc_session_id
business_task_id?
runtime_id
runtime_epoch
assignment_generation
fencing_token?
authorization_revision
credential_generation?
allowed_actions
resource_scope_refs
issued_at
expires_at
nonce
signature
```

首期为短时签名 Envelope；DPoP/mTLS 仅通过可选 sender binding 扩展点预留。

### C03 `pc.authorization-snapshot/1`

用途：记录某个执行检查点的授权输入和结果摘要。

```text
authorization_revision
policy_model_revision
principal_id
project_id?
profile_release_id?
allowed_actions
resource_scope_digest
tool_set_digest
decision
reason_codes
issued_at
expires_at
decision_evidence_refs
```

### C04 `pc.credential-lease-ref/1`

用途：引用 Broker 管理的短期凭据，不传递 Secret。

```text
credential_lease_id
connector_id
external_account_id
credential_subject
audience
scope_digest
generation
expires_at
binding_mode
```

`binding_mode` 首期允许 `bearer`，并预留 `dpop`、`mtls`；未知模式拒绝执行。

### C05 `pc.business-approval-snapshot/1`

用途：企业写操作执行前绑定不可变审批事实。

```text
approval_id
approval_version
status
subject_principal_id
actor_principal_id
operation_kind
target_digest
argument_digest
risk_class
authorization_revision
requested_at
decided_at?
expires_at?
decision
decision_evidence_refs
snapshot_digest
```

## 4. Runtime 与 Assignment

### C06 `pc.runtime-record/1`

```text
runtime_id
runtime_epoch
tenant_id
owner_user_id
worker_pool_id
state
profile_bundle_digest
capability_manifest_digest
capacity
health_summary
created_at
last_heartbeat_at
version
```

### C07 `pc.runtime-capability-manifest/1`

```text
runtime_id
runtime_epoch
dsh_version
bridge_protocol_versions
profile_digest
bundle_lock_digest
plugin_releases
agent_presets
tool_provider_capabilities
persistence_capabilities
event_export_capabilities
approval_capabilities
resource_capabilities
limits
generated_at
manifest_digest
```

### C08 `pc.session-assignment-snapshot/1`

```text
assignment_id
pc_session_id
runtime_id
runtime_epoch
assignment_generation
fencing_token
lease_id
lease_expires_at
state
effective_profile_snapshot_id
workspace_view_snapshot_id
authorization_revision
version
```

### C09 `pc.runtime-command/1`

命令枚举首期包括：

```text
ASSIGN_SESSION
REVOKE_SESSION
START_TURN
CANCEL_TURN
RESUME_SESSION
FLUSH_SESSION
DRAIN_RUNTIME
TERMINATE_RUNTIME
QUERY_HEALTH
QUERY_CAPABILITIES
CATCH_UP_EVENTS
```

通用字段：

```text
command_id
command_type
deadline
runtime_id
runtime_epoch
pc_session_id?
assignment_generation?
fencing_token?
expected_state_version?
payload
```

### C10 `pc.runtime-command-result/1`

```text
command_id
accepted
committed
outcome_state
runtime_observation
adapter_error?
event_cursor?
completed_at
```

`outcome_state` 至少支持 `KNOWN_SUCCESS`、`KNOWN_FAILURE`、`NOT_STARTED`、`OUTCOME_UNKNOWN`。

### C11 `pc.runtime-health-report/1`

```text
runtime_id
runtime_epoch
report_seq
liveness
readiness
capability_health
capacity_health
assignment_health
active_sessions
active_turns
inflight_tools
pending_flushes
observed_at
```

健康报告是观察，不得直接改变权威状态。

## 5. Profile、Tool 与 Plugin

### C12 `pc.expert-profile-release/1`

```text
profile_release_id
profile_definition_id
release_version
status
instructions_ref
rules_ref
tool_requirements
plugin_requirements
model_policy
knowledge_policy
output_contract
completion_contract
dependency_lock_digest
published_at
release_digest
```

### C13 `pc.effective-profile-snapshot/1`

```text
effective_profile_snapshot_id
pc_session_id
profile_release_id
profile_assignment_ids
authorization_revision
tool_release_ids
plugin_release_ids
model_selection
knowledge_view_refs
dsh_preset_ref
runtime_requirements
resolution_report_id
created_at
snapshot_digest
```

Session 首个 Turn 后保持固定；变更创建新 Session 或显式迁移流程。

### C14 `pc.profile-resolution-report/1`

```text
resolution_report_id
requested_profile_release_id
inputs
selected
omitted
conflicts
warnings
hard_failures
runtime_compatibility
created_at
```

安全要求缺失必须进入 `hard_failures`，禁止静默降级。

### C15 `pc.tool-release/1`

```text
tool_release_id
tool_definition_id
version
provider_kind
input_schema
output_schema
schema_digest
risk_manifest
required_permissions
approval_policy
idempotency_class
recovery_class
compatibility
status
artifact_refs
release_digest
```

### C16 `pc.plugin-release/1`

```text
plugin_release_id
plugin_definition_id
version
source
artifact_digest
signature_refs
sbom_ref
dsh_compatibility
dependencies
declared_capabilities
risk_manifest
status
release_digest
```

## 6. Resource 与 Workspace

### C17 `pc.resource-ref/1`

```text
resource_id
resource_version_id
resource_type
tenant_id
owner_scope
content_digest
classification
provenance_ref
```

不包含本地路径。

### C18 `pc.workspace-view-snapshot/1`

```text
workspace_view_snapshot_id
pc_session_id
principal_id
authorization_revision
bindings
allowed_actions
created_at
expires_at?
snapshot_digest
```

每个 binding 指向 `ResourceRef`，并声明只读/写入/派生/上传等能力。

### C19 `pc.materialization-request/1`

```text
materialization_id
workspace_view_snapshot_id
resource_refs
purpose
target_runtime_id
target_runtime_epoch
pc_session_id
ttl
allowed_actions
requested_at
```

### C20 `pc.materialization-result/1`

```text
materialization_id
state
mount_ref
materialized_entries
failed_entries
expires_at
cleanup_state
result_digest
```

`mount_ref` 只在 Runtime Host 内解释，不能成为 Resource 身份。

## 7. Execution 与 Gateway

### C21 `pc.tool-execution-envelope/1`

```text
operation_id
idempotency_key
tool_release_id
schema_digest
arguments
argument_digest
principal_envelope
assignment_snapshot_ref
approval_snapshot_ref?
workspace_view_snapshot_ref?
deadline
recovery_class
```

企业写参数需按字段分类和脱敏；审计保存 digest 与必要证据，不默认保存完整正文。

### C22 `pc.tool-execution-result/1`

```text
operation_id
status
provider_operation_id?
result
result_digest
external_evidence_refs
retryable
outcome_state
reconciliation_required
completed_at
```

Cancel、Timeout 或 transport loss 不能自动映射为外部操作未发生。

### C23 `pc.mcp-session-binding/1`

```text
binding_id
tenant_id
principal_id
pc_session_id
connector_id
mcp_server_id
protocol_session_id?
authorization_revision
credential_generation
tool_catalog_digest
created_at
expires_at
state
```

协议 Session ID 不是身份或授权。

### C24 `pc.external-operation-record/1`

```text
operation_id
operation_kind
idempotency_key
fencing_token
request_digest
provider_operation_id?
dispatch_state
outcome_state
recovery_class
last_reconciled_at?
evidence_refs
version
```

## 8. Event、Business 与 Recovery

### C25 `pc.event-envelope/1`

```text
event_id
event_type
event_schema_version
producer
producer_version
tenant_id
principal_id
stream_kind
stream_id
stream_sequence
aggregate_revision?
business_task_id?
operation_id?
approval_id?
causation_id?
correlation_id?
runtime_id?
runtime_epoch?
pc_session_id?
dsh_session_id?
dsh_session_seq?
runtime_event_seq?
assignment_generation?
fencing_token?
durability
occurred_at
observed_at
payload
payload_digest
```

`durability` 首期支持 `EPHEMERAL`、`OBSERVED`、`DURABLE_DSH`、`DURABLE_PC`。

### C26 `pc.event-cursor/1`

```text
producer
stream_kind
stream_id
cursor
last_event_id
last_sequence
state
expected_next_sequence
gap_detected_at?
captured_at
```

不假设跨 Session 全局总序。

### C27 `pc.business-task/1`

```text
business_task_id
tenant_id
owner_principal_id
project_id?
state
current_subtask_id?
profile_release_id
source_session_ids
projection_complete
last_event_id
state_digest
created_at
updated_at
version
```

### C28 `pc.business-operation/1`

```text
operation_id
business_task_id
tenant_id
owner_principal_id
operation_kind
state
recovery_class
approval_id?
external_operation_record_id?
input_digest
result_digest?
evidence_refs
projection_complete
last_event_id
updated_at
version
```

### C29 `pc.recovery-case/1`

```text
recovery_case_id
tenant_id
owner_principal_id
business_task_id?
trigger
affected_runtime_id?
affected_session_id?
affected_operation_ids
current_assignment
persistent_facts
authorization_checkpoint
decision
state
manual_action?
created_at
updated_at
version
```

### C30 `pc.reconciliation-result/1`

```text
operation_id
provider_facts
resolved_outcome_state
action
compensation_ref?
evidence_refs
reconciled_at
```

## 9. Governance、Error 与 Audit

### C31 `pc.adapter-error/1`

```text
code
message
retryable
outcome_state
recovery_action
runtime_id?
runtime_epoch?
pc_session_id?
assignment_generation?
command_id?
details
diagnostic_cause?
```

调用方只按稳定 `code` 分支；DSH 文本只能进入 `diagnostic_cause`。

### C32 `pc.audit-entry/1`

```text
audit_id
event_type
tenant_id
subject_principal_id?
actor_principal_id?
resource_refs
operation_id?
authorization_revision?
decision
evidence_refs
occurred_at
previous_hash?
entry_hash
retention_class
```

### C33 `pc.compatibility-declaration/1`

```text
component
component_version
contract_versions
dsh_version_range?
bridge_protocol_versions?
profile_schema_versions?
plugin_api_versions?
required_capabilities
known_incompatibilities
tested_combinations
generated_at
declaration_digest
```

### C34 `pc.traceability-entry/1`

```text
requirement_id
adr_ids
module_ids
contract_ids
implementation_refs
test_refs
evidence_refs
status
owner
```

## 10. 企业角色、策略制品与 Legacy 兼容

### C35 `eeclaw.enterprise-role-package/1`

```text
role_package_id
role_key
display_name
authorization_role_ref
responsibility_keys
module_relation_release_ref
workbench_projection_release_ref
role_configuration_release_ref
workflow_contribution_refs
artifact_contract_refs
tool_profile_requirement_refs
release_version
release_digest
status
```

Role Package 只组合已发布引用，不把授权、责任、投影和配置合并为一个权威对象。

### C36 `eeclaw.responsibility-assignment/1`

```text
responsibility_assignment_id
account_id
responsibility_key
scope_type
scope_id
valid_from
valid_to?
status
assigned_by
assigned_at
revision
```

责任分配不是 Permission Grant。

### C37 `eeclaw.role-module-relation/1`

```text
role_key
module_key
visibility
capabilities
focus
requestable
policy_artifact_release_id
policy_model_revision
```

`focus` 不参与 Allow/Deny；`requestable` 只允许创建申请。

### C38 `eeclaw.workbench-projection-release/1`

```text
workbench_projection_release_id
role_package_id
release_version
module_relations
navigation
metrics
work_items
workflow_views
artifact_views
component_refs
payload_checksum
policy_model_revision
status
```

Projection 是展示发布物，不是授权凭据。

### C39 `eeclaw.role-configuration-release/1`

```text
role_configuration_release_id
role_package_id
release_version
schema_version
configuration_keys
defaults
lock_levels
scope_rules
component_refs
payload_checksum
policy_model_revision
status
```

每个配置 Key 必须声明 `personal_preference`、`role_default`、`project_policy`、`organization_policy` 或 `security_policy`。

### C40 `eeclaw.policy-artifact-release/1`

```text
artifact_release_id
artifact_definition_id
artifact_kind
release_version
schema_version
payload
payload_checksum
code_registry_revision
compatibility_declaration_ref
approval_evidence_refs
lifecycle_state
published_environment?
supersedes_release_id?
created_at
published_at?
```

Payload 和 Checksum 创建后不可变；Git 镜像只写不读。

### C41 `eeclaw.authorization-decision/1`

```text
subject_account_id
actor_service_id?
permission_key
scope
decision
reason_codes
source
role_refs
authorization_revision?
authorization_version_digest
policy_model_revision
policy_artifact_release_refs
decided_at
observed_at
expires_at?
```

`source` 为运行时派生的 `baseline | role | deny | system_admin`，不要求落库。
当 EE Claw 尚无统一单调 Revision 时，Adapter 必须返回
`authorization_version_digest` 与 `observed_at`；不得伪造
`authorization_revision`。PC Authorization Service 仍负责生成自己的聚合
Authorization Revision。

### C42 `eeclaw.legacy-auth-compatibility/1`

```text
contract_version
source_commit
schema_fingerprint
api_fingerprint
auth_me_fingerprint
audit_fingerprint
baseline_page_keys_version
baseline_page_keys_digest
revocation_mode
data_migration_required
declared_at
```

首期 `data_migration_required=false`，新增页面不自动进入既有 Baseline。

## 11. Port Catalog

以下 Port 是逻辑接口，不预设网络协议：

| Port | 提供者 | 消费者 | 核心 Contract |
|---|---|---|---|
| `IdentityPort` | M02 | M01、M03 | C01 |
| `AuthorizationPort` | M03 | M01、M05-M16 | C02、C03 |
| `RuntimeRegistryPort` | M04 | M01、M05、M18、M19 | C06、C07、C11 |
| `AssignmentPort` | M05 | M01、M10、M15、M19 | C08 |
| `ProfileCatalogPort` | M06 | M01、M08、M17 | C12 |
| `CapabilityResolutionPort` | M08 | M01、M05、M15、M17 | C13、C14 |
| `ResourcePort` | M09 | M01、M10、M15、M16 | C17-C20 |
| `OperationLedgerPort` | M10 | M01、M14、M19 | C24、C27、C28 |
| `CredentialBrokerPort` | M11 | M14 | C04 |
| `ApprovalPort` | M12 | M01、M10、M14、M16 | C05 |
| `EventIngestionPort` | M13 | M16 | C25、C26 |
| `ControlledExecutionPort` | M14 | M10、M16 | C21-C24 |
| `DshAdapterPort` | M15 | M04、M05、M10、M19 | C07-C11、C31 |
| `RuntimeBridgePort` | M16 | M15 | C08-C11、C13、C18、C25、C31 |
| `RecoveryPort` | M19 | M01、M04、M10、M13 | C29、C30 |
| `AuditPort` | M21 | 所有写模块 | C32 |
| `EnterpriseRoleAdapterPort` | E01/E02 | M03、M06、M08 | C35-C39、C41 |
| `PolicyArtifactPort` | E03 | M03、M22 | C38-C41 |
| `LegacyAuthorizationCompatibilityPort` | E04 | M03、M22 | C41、C42 |

## 12. 契约验收

- [x] 首期关键对象具有稳定名称和 major version；
- [x] DSH 内部类型未成为稳定 Contract；
- [x] 身份、授权、Assignment、Approval 和 Resource 均可独立版本；
- [x] 所有写执行具有 operation/idempotency/fencing 语义；
- [x] Cancel/Timeout 与外部结果事实分离；
- [x] Event 使用局部序列，不假设全局顺序；
- [x] 错误具有稳定 code 和 outcome state；
- [x] DPoP/mTLS、Transport 和部署方式保留扩展点但非首期义务；
- [x] Contract 可以映射到 REST、RPC 或消息协议而不改变业务语义。
- [x] 企业责任、Focus、Workbench 与授权效果保持分离。
- [x] Policy Artifact Release、Policy Model Revision 和 Legacy Baseline 可被稳定追踪。

