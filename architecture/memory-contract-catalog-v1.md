# Process Copilot Memory Contract Catalog v1

- 状态：Accepted Contract Extension
- 日期：2026-11-16
- 依据：ADR-0018 至 ADR-0023（Accepted）
- 编号：延续现有 C01-C42，使用 C43-C60
- 目标：冻结 Memory 跨模块语义，不绑定 REST、RPC、数据库表、模型或 Provider
- 实施边界：不授权编码、Schema 变更、Provider 安装、历史数据导入或部署

## 1. Contract 通用规则

沿用 `stable-contract-catalog-v1.md` 的 ContractEnvelope、版本、时间、Digest 和兼容规则，并增加：

1. 所有 Memory 写命令必须携带 `command_id` 和 `idempotency_key`；
2. 所有查询必须携带 `principal_id`、`authorization_revision` 和 `purpose`；
3. 所有返回内容必须绑定 `memory_id + revision_id`；
4. Provider ID 只能是 Projection 引用，不能成为 PC 对象 ID、幂等键或授权主键；
5. Object 非 `CONFIRMED/PUBLISHED` 时不得进入生产 Context；Revision 默认仅允许 `CURRENT`，只有显式历史查询可受控读取 `SUPERSEDED`；
6. 未知 Scope、Object State、Revision State、Sensitivity、Purpose 或授权状态必须 fail closed；
7. 所有时间为 UTC instant；Valid Time 与 Recorded Time 分开；
8. Contract 不传递密码、Token、API Key、私钥、模型隐藏推理或完整 Prompt；
9. 删除/Projection 回执只有 readback 后才能变成 verified；
10. DSH、Mem0、OpenViking、Graphiti 和具体数据库类型不得泄漏进稳定领域 Contract。

## 2. 枚举语义

### 2.1 `memory_scope_type`

```text
PERSONAL
PROJECT
SYSTEM
```

### 2.2 `memory_object_state`

```text
CANDIDATE
CONFIRMED
PUBLISHED
REVOKED
EXPIRED
REJECTED
```

只有 `CONFIRMED` 和 `PUBLISHED` Object 可进入授权检索。

### 2.3 `memory_revision_state`

```text
CURRENT
SUPERSEDED
WITHDRAWN
```

默认只有 `CURRENT` Revision 可进入授权检索。创建新 Revision 时，旧 `CURRENT` 通过同一 Authority 事务转为 `SUPERSEDED`；Object 本身保持 `CONFIRMED/PUBLISHED`。

`SUPERSEDED` 只有同时满足以下条件才可进入受控历史 View：

- `purpose=DECISION_RECALL`；
- Query 明确提供过去的 `valid_at`；
- Revision 的 Valid Time 覆盖该时点；
- 当前 Principal 仍有 SourceEvidence 访问权；
- C51 Item 标记 `temporal_role=HISTORICAL`；
- Context/回答明确说明这是历史状态，不得作为当前事实使用。

`WITHDRAWN` 在任何 Purpose 下都不可返回正文。

### 2.4 `memory_kind`

首期稳定值：

```text
EXPLICIT_PREFERENCE
CONFIRMED_FACT
ONGOING_GOAL
DECISION_HISTORY
PROJECT_FACT
RUNBOOK
FAILURE_GOTCHA
```

未知 Kind 可存储为 Candidate，但在没有策略声明时不得进入 Context。

### 2.5 `memory_sensitivity`

```text
INTERNAL
CONFIDENTIAL
RESTRICTED
```

不提供 `PUBLIC`，避免个人记忆因默认值被跨用户公开。

### 2.6 `memory_purpose`

首期稳定值：

```text
PERSONALIZATION
TASK_CONTINUITY
DECISION_RECALL
PROJECT_ASSISTANCE
RUNBOOK_ASSISTANCE
EMPLOYEE_REVIEW
DELEGATE_RESPONSE
```

首期 Personal Memory 只允许前三项。`DELEGATE_RESPONSE` 预留但在 Delegation Domain 未实现前必须拒绝。

## 3. Authority Contracts

### C43 `pc.memory-object/1`

用途：长期记忆稳定逻辑身份和当前权威状态。

```text
memory_id
tenant_id
owner_principal_id
subject_principal_id?
scope_type
scope_id
memory_kind
sensitivity
object_state
current_revision_id?
policy_revision
created_at
updated_at
version
```

约束：

- `PERSONAL` 的 `scope_id` 必须由 PC 根据 Owner 生成，不能由客户端自由指定；
- `PROJECT` 必须绑定现有 Project Authority；
- `SYSTEM` 必须绑定发布 Owner 和环境/产品适用范围；
- `version` 用于 Authority CAS，不等于 Revision ID。

### C44 `pc.memory-revision/1`

用途：不可变 Memory 内容修订。

```text
revision_id
memory_id
revision_no
revision_state
structured_content
retrieval_summary
source_evidence_ids[]
confidence
valid_from
valid_to?
recorded_at
created_by_principal_id
creation_reason
supersedes_revision_id?
content_digest
schema_revision
```

发布后不可原地修改。修正必须创建新 Revision。

### C45 `pc.memory-source-evidence/1`

用途：把 Memory Revision 回链到原权威来源。

```text
source_evidence_id
tenant_id
source_kind
source_authority
source_object_id
source_version_id?
source_fragment_ref?
source_subject_principal_id?
captured_by_principal_id
captured_at
observed_at
sensitivity
displayability
evidence_digest
access_revalidation_policy
```

`source_kind` 首期支持 `CONVERSATION_MESSAGE | RESOURCE_VERSION | BUSINESS_EVENT | TOOL_RESULT`。

不得在此 Contract 中嵌入完整 Secret、Tool 回执或大文件内容。

## 4. Write Command Contracts

### C46 `pc.memory-capture-command/1`

用途：从明确保存意图或受控来源创建 Memory/Candidate。

```text
command_id
idempotency_key
request_context_ref
capture_mode
owner_principal_id
scope_request
memory_kind
content
source_evidence_inputs[]
valid_time
sensitivity_hint?
capture_policy_revision
expected_result_state
issued_at
deadline
```

`capture_mode`：

```text
EXPLICIT_USER_SAVE
AUTOMATIC_CANDIDATE
PROJECT_CANDIDATE
SYSTEM_CANDIDATE
```

只有 `EXPLICIT_USER_SAVE` 在通过政策和来源校验后可以直接产生 `CONFIRMED` Personal Memory。

### C47 `pc.memory-candidate-decision-command/1`

用途：Owner 或发布策略确认/拒绝 Candidate。

```text
command_id
idempotency_key
candidate_memory_id
expected_object_version
decision
decided_by_principal_id
authorization_revision
policy_revision
decision_reason_codes[]
content_adjustment?
scope_adjustment?
sensitivity_adjustment?
issued_at
deadline
```

`decision = CONFIRM | PUBLISH | REJECT`。任何 adjustment 都必须形成新的 Revision 输入，不静默修改 Candidate 内容。

### C48 `pc.memory-revise-command/1`

用途：纠错、时间变化、内容更新或 Scope/Sensitivity 调整。

```text
command_id
idempotency_key
memory_id
expected_object_version
expected_current_revision_id
revision_reason
new_content
new_source_evidence_inputs[]
new_valid_time
scope_adjustment?
sensitivity_adjustment?
principal_id
authorization_revision
policy_revision
issued_at
deadline
```

`revision_reason = CORRECTION | TEMPORAL_CHANGE | CONTENT_UPDATE | SCOPE_CHANGE | SENSITIVITY_CHANGE`。

### C49 `pc.memory-revoke-command/1`

用途：立即阻止读取并启动派生副本清除。

```text
command_id
idempotency_key
memory_id
expected_object_version
expected_current_revision_id?
principal_id
authorization_revision
revoke_reason
propagation_targets[]
retention_policy_ref
issued_at
deadline
```

Authority Commit 成功即禁止新读取；Projection 清除异步验证。

## 5. Query and View Contracts

### C50 `pc.authorized-memory-query/1`

用途：请求与当前 Turn/任务相关的授权记忆。

```text
query_id
tenant_id
principal_id
actor_principal_id
authorization_revision
purpose
conversation_id?
task_id?
project_id?
profile_release_id?
query_text
allowed_kinds[]
allowed_sensitivities[]
valid_at
max_items
max_context_tokens
projection_release_constraint?
issued_at
deadline
```

客户端不能自由扩大 `allowed_*`；它们是上层策略计算后的缩小条件。

### C51 `pc.authorized-memory-view/1`

用途：封装一次动态授权后可使用的 Memory 集合。

```text
authorized_view_id
tenant_id
principal_id
purpose
authorization_revision
policy_revision
projection_release
authority_snapshot_revision
items[]
denied_reason_summary
issued_at
expires_at
view_digest
```

每个 `items[]` 至少包含：

```text
memory_id
revision_id
memory_kind
content
source_summary
valid_time
confidence
usage_constraints[]
retrieval_reason
source_revalidation_result
temporal_role
```

`temporal_role = CURRENT | HISTORICAL`。未提供时按无效 Contract 拒绝，不能猜测。

View 是短期不可变快照，过期后必须重新查询。

### C52 `pc.runtime-memory-context/1`

用途：向 Runtime 提供类型化、不可信、不可扩权的 Memory Context。

```text
context_id
authorized_view_id
pc_session_id
turn_id
principal_id
purpose
items[]
context_policy_revision
token_budget
context_digest
issued_at
expires_at
```

不得包含 Provider 凭据、授权 Token、Tool Set 变更或 System Policy 指令。

### C53 `pc.memory-usage-record/1`

用途：记录实际进入 Context 和被回答引用的 Memory。

```text
usage_id
tenant_id
principal_id
conversation_id
turn_id
purpose
authorized_view_id
memory_revision_refs[]
source_revalidation_refs[]
context_digest
provided_to_runtime_at
answer_reference_status
recorded_at
trace_id
```

`answer_reference_status = PROVIDED | REFERENCED | NOT_USED | REFUSED_DUE_TO_CONFLICT`。

## 6. Event and Projection Contracts

### C54 `pc.memory-authority-change-event/1`

用途：驱动 Projection、缓存、审计和恢复。

```text
event_id
tenant_id
memory_id
revision_id?
object_version
change_kind
object_state
revision_state?
scope_digest
sensitivity
policy_revision
occurred_at
producer_sequence
causation_command_id
```

`change_kind = CREATED | CONFIRMED | PUBLISHED | REVISED | SUPERSEDED | REVOKED | EXPIRED`。

### C55 `pc.memory-projection-operation/1`

用途：向可替换 Projection Provider 派发幂等变更。

```text
projection_operation_id
idempotency_key
projection_release
provider_namespace
authority_change_event_id
authority_snapshot_revision
scope_manifest
action
revision_refs[]
source_evidence_refs[]
content_payload?
issued_at
deadline
```

`action = UPSERT | HIDE | DELETE | REBUILD_SCOPE`。

### C56 `pc.memory-projection-receipt/1`

用途：记录 Provider 接收与 readback 结果。

```text
projection_operation_id
provider_operation_ref
provider_release
acceptance_status
accepted_at?
readback_status
readback_at?
observed_revision_refs[]
residual_match_count?
error_code?
retryability
receipt_digest
```

`acceptance_status=ACCEPTED` 不等于 `readback_status=VERIFIED`。

### C57 `pc.memory-projection-rebuild-manifest/1`

用途：从固定 Authority Snapshot 重建 Projection。

```text
rebuild_id
projection_release
authority_snapshot_revision
tenant_id
scope_manifest
memory_revision_manifest_ref
source_evidence_manifest_ref
cursor?
expected_counts
expected_digest
started_at
completed_at?
activation_status
verification_result?
```

重建不得从旧 Provider 摘要反向生成权威内容。

### C58 `pc.memory-policy-decision/1`

用途：记录 Capture、Query、Revise、Revoke 或 Context Assembly 的稳定策略结果。

```text
decision_id
decision_kind
tenant_id
principal_id
memory_id?
revision_id?
purpose?
authorization_revision
policy_revision
decision
reason_codes[]
evidence_refs[]
decided_at
expires_at?
decision_digest
```

`decision = ALLOW | DENY | REQUIRE_CONFIRMATION | REQUIRE_REDACTION | REQUIRE_ESCALATION`。

### C59 `pc.memory-context-exposure/1`

用途：保守记录哪些 Memory Revision 已进入哪个 Runtime Session。

```text
exposure_id
tenant_id
principal_id
pc_session_id
dsh_session_id
assignment_generation
turn_id
authorized_view_id
context_id
context_digest
memory_revision_refs[]
authorization_revision
policy_revision
exposed_at
session_memory_state_after_exposure
```

只要 C52 已派发即记录暴露，不以模型是否显式引用为前提。

### C60 `pc.memory-session-invalidation/1`

用途：Memory Revision 失效后冻结并轮换已暴露 Session。

```text
invalidation_id
idempotency_key
tenant_id
pc_session_id
dsh_session_id
current_assignment_generation
affected_memory_revision_refs[]
trigger_kind
authority_change_event_ids[]
target_memory_state
fencing_action
rotation_policy
invalidation_status
issued_at
deadline
completed_at?
recovery_case_id?
```

`trigger_kind = SUPERSEDED | REVOKED | EXPIRED | SOURCE_ACCESS_LOST | SCOPE_CHANGED | POLICY_REVOKED | POISONING_DETECTED`。

首期 `rotation_policy=FRESH_SESSION_NO_REPLAY`。失败不能回退旧 Session 使用权。

`invalidation_status = PENDING | FENCED | RELEASING | ROTATED | RECOVERY_REQUIRED`。只有 `ROTATED` 表示新 Session 已接管；任何非终态都不能恢复旧 Session 使用权。

## 7. Error Catalog

Memory Domain 使用稳定错误码，不暴露数据库、Provider 或模型错误文本：

```text
MEMORY_NOT_FOUND
MEMORY_SCOPE_DENIED
MEMORY_PURPOSE_DENIED
MEMORY_SOURCE_ACCESS_DENIED
MEMORY_STALE_AUTHORIZATION
MEMORY_INVALID_STATE
MEMORY_VERSION_CONFLICT
MEMORY_REVISION_CONFLICT
MEMORY_EVIDENCE_REQUIRED
MEMORY_SENSITIVE_CONTENT_REJECTED
MEMORY_CONFLICT_UNRESOLVED
MEMORY_CONTEXT_BUDGET_EXCEEDED
MEMORY_PROJECTION_UNAVAILABLE
MEMORY_PROJECTION_UNVERIFIED
MEMORY_REVOKE_PROPAGATION_PENDING
MEMORY_PROVIDER_PROTOCOL_ERROR
```

未知或不可分类的安全错误默认拒绝；不得回退到无过滤 Provider 查询。

## 8. Logical Port Catalog

| Port | 提供者 | 消费者 | 核心 Contract |
| --- | --- | --- | --- |
| `MemoryAuthorityPort` | Memory Authority | API、Capture、Query、Governance | C43-C49、C54 |
| `MemoryEvidencePort` | Conversation/Resource/Event/Tool Adapters | Capture、Authority | C45-C48 |
| `MemoryPolicyPort` | Authorization/Memory Policy | Capture、Query、Context | C50、C58 |
| `AuthorizedMemoryQueryPort` | Memory Query Service | Conversation、Runtime Adapter | C50-C51 |
| `MemoryContextPort` | Context Assembler | DSH Adapter/Runtime Bridge | C51-C53、C59-C60 |
| `MemoryProjectionPort` | Projection Adapter | Query、Recovery | C54-C57 |
| `MemoryUsageAuditPort` | Memory Governance | User Control、Audit | C53、C58、既有 C32 |
| `MemoryRecoveryPort` | Recovery | Operations/Audit | C54-C57、C59-C60、既有 C29-C30 |

## 9. 幂等与并发

- 相同 `command_id + idempotency_key + payload_digest` 返回相同业务结果；
- 相同幂等键但不同 payload 返回冲突；
- Revise/Revoke 使用 `expected_object_version` CAS；
- Revise 同时绑定 `expected_current_revision_id`，防止覆盖并发修订；
- Projection Operation 按 `projection_operation_id` 收敛；
- Provider 重试不创建新的 Authority Revision；
- Query/View 不作为长期授权凭证，过期必须重建；
- 旧 AuthorizationRevision、PolicyRevision 或 View Revision 重放必须拒绝。

## 10. Contract 验收清单

- [x] C43-C60 均具有稳定名称、major 和 Owner；
- [x] Authority、Projection、Runtime Context 没有混用 ID；
- [x] Personal/Project/System Scope 不通过客户端 metadata 自由指定；
- [x] 自动抽取只能产生 Candidate；
- [x] 所有可用内容绑定 Revision、Evidence 和 temporal_role；
- [x] 所有查询绑定 Principal、Purpose 和 AuthorizationRevision；
- [x] Memory Context 不包含 Tool 扩权或系统指令；
- [x] Revise/Revoke 具有 CAS 和幂等语义；
- [x] Projection Receipt 与 Readback 分离；
- [x] 每个 C52 都有 C59 暴露记录，失效 Revision 能生成 C60；
- [x] 受污染 Session 不可 Resume，首期新 Session 不 replay 旧上下文；
- [x] Provider 替换不改变 PC Contract；
- [x] 错误默认 fail closed；
- [x] Contract 可映射到 REST/RPC/Event 而不改变领域语义。

## 11. 已完成反向校验与后续 PoC

以下反向校验已经完成并支持本 Contract Extension 的 Accepted 状态：

1. Threat Model：已覆盖 direct-get、跨 Scope 召回、Prompt Injection、撤权竞态和旧队列重放；
2. Evaluation Baseline：已证明 Revision、时间冲突、删除和来源完整性可测，并形成 60 场景目录；
3. DSH 无侵入审查：已确认 C52 可通过 Adapter/Bridge 注入，DSH Core 必改项为 0；
4. 实现责任矩阵：C43-C60 已分配到 M23-M29 唯一 Owner/处理者；
5. Contract Review 与 Traceability：已形成正式评审记录和 ADR/Module/Contract/Security Test 映射。

Provider PoC 仍属于后续 MEMORY-04，不是 Contract Accepted 或 MEMORY-01A 的前置条件。PoC 必须验证 C55-C57 能约束 Mem0/OpenViking/Graphiti 等 Provider，而不是泄漏其内部语义。

