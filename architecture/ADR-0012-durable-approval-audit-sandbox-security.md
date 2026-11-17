# ADR-0012：持久审批、审计链、Sandbox 与执行安全

- 状态：Accepted
- 日期：2026-11-09
- 范围：T9.1 至 T9.7
- 前置决策：ADR-0001 至 ADR-0011
- 用户授权：接受本批全部推荐方案作为第一版
- 实施原则：Approval、Authorization、Execution 和 Verification 是四个独立事实

## 1. 决策摘要

采用：

```text
PC durable BusinessApproval
+ immutable ApprovalSnapshot
+ DSH approval pause bridge
+ execution-time reauthorization
+ append-only audit chain
+ capability-based sandbox
+ default-deny egress
+ brokered credentials
```

核心结论：

1. DSH Approval 只作为执行暂停点；
2. PC BusinessApproval 是持久业务审批权威；
3. Approval 绑定精确操作、参数、资源、版本、Scope 和影响预览；
4. Approval 通过不等于操作已经执行；
5. 执行前必须重新鉴权并验证 Approval Snapshot 未变化；
6. 高风险写操作必须经过 Operation Ledger；
7. 审计与普通日志、指标、Trace 分离；
8. Sandbox 默认无宿主机权限、无长期凭据、无任意网络出口；
9. 文件访问只经过授权 Resource View 和 Materialization；
10. 网络出口只经过 Egress Gateway；
11. Cancel/Timeout 不证明外部副作用停止；
12. 安全拒绝、策略故障和未知结果必须可审计。

## 2. BusinessApproval

```text
BusinessApproval
- approval_id
- tenant_id
- task_id
- operation_id
- requested_by
- approval_policy_ref
- approval_snapshot_ref
- status
- required_approver_rule
- valid_from
- expires_at
- approval_revision
```

状态：

```text
REQUESTED
→ PENDING
→ APPROVED | REJECTED | EXPIRED | CANCELLED
APPROVED → CONSUMED | REVOKED | EXPIRED
```

Approval 只证明特定快照被批准。

## 3. ApprovalSnapshot

```text
ApprovalSnapshot
- tool_release_id
- tool_schema_digest
- connector_registration_id
- target_system
- action_class
- normalized_parameters
- parameter_hash
- resource_version_refs
- target_scope
- effect_preview
- effect_preview_digest
- profile_release_id
- authorization_revision
- policy_revision
- credential_mode
- requested_at
```

任一字段变化使旧 Approval 失效。

禁止：

- 批准模糊自然语言后执行任意参数；
- 只显示 Tool 名称，不显示目标和影响；
- 批准后替换 Tool Release；
- 批准后扩大资源范围；
- 使用过期 Authorization Revision 执行。

## 4. Approval Bridge

流程：

```text
DSH Tool pipeline requests approval
→ PC Adapter creates/loads BusinessApproval
→ persist ApprovalSnapshot
→ release Runtime when wait is durable
→ user/approver decides in PC
→ append ApprovalDecision
→ resume with new Runtime Assignment
→ reauthorize
→ verify exact snapshot
→ dispatch operation
```

DSH 不保存审批权威，只接收：

- approval_ref；
- decision；
- decision_revision；
- snapshot_digest；
- resume capability。

## 5. Approver 与职责分离

首期支持：

- requester cannot self-approve policy；
- role/group approver；
- project approver；
- explicit user approver；
- expiry；
- revoke before dispatch。

未来接口：

- quorum；
- dual control；
- sequential approval；
- conditional approval；
- break-glass。

Break-glass 必须单独审计，不能隐藏为普通 Allow。

## 6. 执行一致性

派发前依次校验：

1. Principal 和 Actor；
2. 当前 Authorization Revision；
3. 当前 Assignment/Fencing；
4. Tool/Connector Release；
5. Approval status；
6. ApprovalSnapshot Digest；
7. 参数和 ResourceVersion；
8. Credential Generation；
9. 幂等键；
10. Runtime Capability。

派发后 Approval 标记 `CONSUMED`。同一批准不能被多个非幂等 Operation 重复消费。

## 7. AuditEvent

```text
AuditEvent
- audit_event_id
- event_type
- occurred_at
- recorded_at
- tenant_id
- subject_principal_id
- actor_service_id
- runtime_id
- agent_instance_id
- profile_release_id
- task_id
- operation_id
- approval_id
- tool_call_id
- connector_registration_id
- credential_subject
- source_system
- action
- result
- reason_codes
- resource_refs
- request_id
- trace_id
- previous_event_ref
- payload_digest
- redaction_profile
```

要求：

- append-only；
- 稳定 ID；
- 时间来源和记录时间分离；
- 支持批次签名或 Tamper-evident Export；
- 审计写失败对高风险写操作 Fail Closed；
- 普通遥测失败不能伪装成审计成功。

## 8. 审计事件范围

至少覆盖：

- 登录、退出、失败和账号停用；
- 身份链接、解绑和冲突；
- Role/Permission/Project Grant 变化；
- Profile/Tool/Plugin/Connector 发布和撤销；
- Approval Requested/Decided/Consumed/Revoked；
- Authorization Allow/Deny；
- Credential Lease/Refresh/Rotate/Revoke；
- ToolCall、Attempt、Result、Readback；
- Outcome Unknown/Reconciliation；
- Sandbox/Egress/Filesystem Deny；
- Runtime Assignment/Fencing/Recovery；
- 人工接管和 Compensation；
- Break-glass；
- 审计导出。

## 9. 脱敏与数据最小化

禁止记录：

- Access/Refresh/Subject Token；
- Client Secret；
- Cookie；
- DPoP 私钥；
- 完整 Authorization Header；
- 密码；
- 未脱敏文件正文；
- 未脱敏 Tool 大参数；
- 模型完整敏感上下文。

记录：

- stable ref；
- irreversible digest；
- schema-aware field summary；
- resource version；
- redaction reason。

## 10. Sandbox Profile

```text
SandboxProfile
- sandbox_profile_id
- runtime_profile_release_id
- filesystem_policy
- process_policy
- network_policy
- resource_limits
- allowed_capabilities
- prohibited_capabilities
- policy_revision
```

默认：

- 非特权用户；
- 只读基础镜像；
- 临时可写层；
- 无宿主机根目录；
- 无 Docker/Container Runtime Socket；
- 无云实例元数据直连；
- 无长期 Secret；
- 无任意设备；
- 有 CPU/Memory/Process/File/Time 限制。

## 11. 文件系统边界

Runtime 只能访问：

- 当前 Session Resource View；
- 受控 Materialization；
- Runtime 临时目录；
- 显式输出目录。

禁止：

- 任意绝对路径；
- 用户根 Workspace 全量挂载；
- 跨 Session 临时目录；
- 通过软链接/路径穿越逃逸；
- 把物理路径写入业务 API。

Materialization 完成后验证：

- canonical path；
- scope；
- resource version；
- digest；
- size/type；
- read/write mode。

## 12. 命令执行

命令能力必须声明：

- executable identity；
- argument schema；
- working directory policy；
- environment allowlist；
- timeout；
- output limit；
- network need；
- filesystem need；
- risk classification。

禁止将任意 shell 字符串作为普通低风险 Tool。

高风险命令：

- 使用隔离 Worker；
- 强制 Approval；
- 限制目标目录；
- 禁止继承宿主环境；
- 记录规范参数摘要；
- 需要结果验证。

## 13. Network Egress

默认拒绝外网。

所有出口经过 Egress Gateway：

```text
destination policy
+ DNS resolution policy
+ IP range policy
+ protocol/port policy
+ TLS policy
+ connector identity
+ request limits
+ audit
```

禁止：

- loopback/metadata/private range 绕过；
- 用户输入 URL 直接访问；
- DNS Rebinding；
- Redirect 扩大目标；
- Proxy 环境变量绕过；
- 未注册 Connector 自行出网。

URL Fetch Tool 必须重新校验每次 Redirect 目标。

## 14. Credential 安全

- Secret 只在 Credential Broker/Vault；
- Runtime 只获得短期 Lease；
- Secret 不写 Workspace；
- 子进程环境变量按最小集合注入；
- Lease 绑定 Subject、Actor、Audience/Resource、Scope、Generation；
- Runtime 终止立即销毁 Lease；
- 日志和异常使用 Secret Redactor；
- Crash Dump 不得包含凭据。

## 15. 安全故障

以下情况 Fail Closed：

- Authorization Service 不可用；
- Approval Store 不可用；
- Audit Store 对高风险写不可用；
- Credential Broker 不可用；
- Sandbox Policy 无法加载；
- Egress Policy 无法判断；
- Fencing/Revision 无法验证。

只读低敏操作是否允许降级必须由显式 Policy 定义，不能由异常处理默认放行。

## 16. 验收要求

至少验证：

1. 参数变化使 Approval 失效；
2. ResourceVersion 变化使 Approval 失效；
3. Approval 通过后撤权仍拒绝执行；
4. 同一 Approval 不能重复消费非幂等写；
5. WAITING_APPROVAL 可释放 Runtime；
6. DSH 重启后审批仍存在；
7. 审计不包含 Token/Secret；
8. 高风险写审计失败时不派发；
9. Runtime 无法访问其他 Session 文件；
10. 路径穿越和软链接逃逸被拒绝；
11. Docker Socket 和元数据地址不可达；
12. Redirect 到禁止目标被拒绝；
13. 未注册 Connector 不能出网；
14. Timeout 不被记录为外部已停止；
15. Credential Lease 过期或 Generation 变化后拒绝；
16. Break-glass 有独立审批和审计。

## 17. 依据

- ADR-0005、ADR-0007、ADR-0008；
- `reference-evidence-tool-plugin-governance.md`；
- `reference-evidence-mcp-multisession-auth.md`；
- `reference-evidence-final-architecture-domains.md`。

## 18. 非目标

不冻结：

- 审批 UI；
- 具体 SIEM、Vault、KMS、Sandbox 产品；
- 法定保留周期；
- 具体网络域名清单；
- 具体资源限额；
- DSH Core 修改。
