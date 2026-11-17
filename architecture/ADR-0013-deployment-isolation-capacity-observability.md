# ADR-0013：部署、租户隔离、容量与可观测性

- 状态：Accepted
- 日期：2026-11-09
- 范围：T10.1 至 T10.7
- 前置决策：ADR-0001 至 ADR-0012
- 用户授权：接受本批全部推荐方案作为第一版
- 实施原则：首期可单租户部署，但所有对象和接口必须携带 tenant 边界

## 1. 决策摘要

采用：

```text
stateless PC API replicas
+ durable control-plane stores
+ partitioned worker pools
+ user-scoped Runtime Hosts
+ controlled Gateways
+ mandatory tenant context
+ admission control and quotas
+ layered health and observability
+ strict environment separation
```

核心结论：

1. PC API 可水平扩展，不保存唯一业务真相在进程内存；
2. Runtime、Job、Connector 和 Projector 使用独立 Worker Pool；
3. DSH Runtime 继续按 owner user 隔离；
4. 单租户部署也必须携带 `tenant_id`；
5. 多租户启用前必须通过跨租户安全矩阵；
6. 容量使用 Admission、Quota、Queue 和 Backpressure 管理；
7. 健康分为 Liveness、Readiness、Capability、Capacity 和 Assignment；
8. 审计独立于可能采样的遥测；
9. Dev/Test/Prod 的账号、数据、Secret、Connector 和 Release Channel 分离；
10. 具体阈值由负载和故障测试确定，不写死在 ADR。

## 2. 逻辑部署单元

```text
PC Web / API
PC Control Plane
Authorization / Principal Module
Profile / Tool / Connector Registry
Task / Approval / Operation Service
Event Inbox / Projector
Scheduler / Recovery Coordinator
Runtime Host Pool
Tool / MCP / Connector Gateway
Credential Broker
File / Resource Gateway
Durable Job Workers
Audit Writer / Exporter
Observability Pipeline
```

首期可以合并进程或 Pod，但责任接口和数据所有权保持独立。

## 3. Control Plane

Control Plane 持有：

- Runtime Registry；
- Assignment / Lease / Fencing；
- Task / Operation / Approval；
- Profile / Tool / Connector Release；
- Principal / Authorization Revision；
- Capacity Snapshot；
- Recovery Coordination。

高可用要求：

- 使用数据库 CAS、Lease 或 Leader Election；
- 同一协调职责同时只有一个有效执行权；
- 失去 Lease 的实例停止写；
- 迟到写被 Revision/Fencing 拒绝；
- 不依赖本地定时器作为唯一事实。

## 4. Data Plane

Runtime Host、Tool Worker、Connector Worker：

- 可替换；
- 不持有长期业务真相；
- 使用短期 Runtime/Credential 身份；
- 只获得当前 Assignment 和 Resource View；
- 使用 Operation ID、Idempotency Key 和 Fencing；
- 故障后由 Control Plane 恢复。

## 5. Tenant 模型

每个持久对象至少包含：

```text
tenant_id
+ object_id
+ scope/owner
+ revision
```

每个请求和事件至少携带：

- tenant_id；
- subject/actor；
- task/project；
- operation/trace。

禁止：

- 从可猜对象 ID 推断 Tenant；
- 缺少 Tenant 时查询全局数据；
- 跨 Tenant 共享 Credential；
- 跨 Tenant 共享 Stateful MCP Session；
- 跨 Tenant 复用 Resource View；
- 仅靠前端筛选隔离。

## 6. 首期单租户与未来多租户

第一版允许每个部署实例服务一个企业 Tenant，但：

- Schema 和 API 不省略 tenant；
- Secret Namespace 按 tenant；
- Object Storage Prefix/Bucket Policy 按 tenant；
- Queue/Cache Key 按 tenant；
- Audit 按 tenant；
- Connector Registration 按 tenant；
- Quota 按 tenant。

多租户模式只有在以下通过后启用：

- 数据库行级隔离测试；
- Cache/Queue/Object Storage 隔离；
- Token/Session/Connector 隔离；
- 管理员权限边界；
- 审计导出隔离；
- 故障注入。

## 7. Worker Pool

至少分离：

- Runtime Host；
- Projector；
- File Parse/Index；
- Connector/Sync；
- Tool Execution；
- Reconciliation；
- Audit Export；
- Maintenance。

分离目的：

- 防止大文件任务挤占交互 Session；
- 防止 Connector 慢调用阻塞投影；
- 防止 Reconciliation 风暴影响新任务；
- 支持不同安全和网络策略。

## 8. 容量模型

容量维度：

```text
tenant
user
project
profile
runtime profile
model route
tool/connector
job class
resource storage
```

关键计数：

- Active Runtime；
- Active Assignment；
- Running Turn/Step；
- Inflight Tool/MCP；
- Active Stream；
- Queue Depth/Age；
- Durable Job；
- Reconciliation Backlog；
- File Bytes/Objects；
- Model Tokens/Concurrency；
- Connector Rate Limit。

## 9. Admission 与 Backpressure

准入顺序：

```text
authorization
→ policy/risk
→ dependency health
→ tenant/user quota
→ pool capacity
→ external rate limit
→ accept or queue/reject
```

结果：

- ACCEPTED；
- QUEUED；
- REJECTED_QUOTA；
- REJECTED_CAPACITY；
- REJECTED_DEPENDENCY；
- RETRY_AFTER。

不能接受后无限等待。

Queue 必须有：

- priority；
- enqueue time；
- deadline；
- tenant/user fairness；
- max attempts；
- cancellation；
- dead-letter/review。

## 10. Runtime Capacity

继续遵守 ADR-0001：

- Runtime 不跨用户；
- 用户可有多个 Runtime；
- 每个 Runtime 有 Profile/Capability；
- 调度按资源和依赖匹配。

调度必须考虑：

- CPU/Memory/Disk；
- Active Step/Tool/Stream；
- Capability；
- Model/Connector availability；
- Workspace materialization；
- cold start；
- draining；
- per-user hard limit。

## 11. 环境隔离

Dev/Test/Prod 分离：

- IdP Client；
- Account/Role；
- Database；
- Object Storage；
- Queue/Cache；
- Secret/KMS Key；
- Connector Registration；
- Credential；
- Domain/Certificate；
- Runtime Profile Release；
- Tool/Plugin/Profile Channel；
- Audit Store；
- Observability Project。

禁止：

- 测试环境使用生产 Credential；
- 生产读取测试 Bucket；
- 通过环境变量默认为生产；
- 未经发布门禁把 Draft Release 引入生产；
- 共享管理员 Cookie/Session。

## 12. 配置与发布

运行配置使用：

```text
EnvironmentConfigRelease
+ RuntimeProfileRelease
+ Tool/Plugin/Profile Releases
+ ConnectorRegistrationRevision
+ PolicyRevision
```

部署记录精确 Digest。配置变化：

- 通过新 Release；
- 灰度；
- 健康验证；
- 回滚；
- 不原地修改历史任务快照。

Secret 变化使用 Credential Generation，不进入 Config Digest 正文。

## 13. 健康模型

### Liveness

进程和基本控制通道。

### Readiness

必要依赖、配置、Registry、Event Bridge、Gateway 和持久化。

### Capability Health

每项模型、Tool、Connector、文件服务独立。

### Capacity Health

是否还有准入空间。

### Assignment Health

Lease、进度、Checkpoint、Active Work、Recovery。

一个布尔 `/healthz` 不能代表全部。

## 14. 可观测性

统一关联：

```text
tenant_id
subject_user_id
actor_service_id
task_id
agent_instance_id
runtime_id
runtime_epoch
session_id
assignment_generation
operation_id
approval_id
tool_call_id
connector_registration_id
trace_id
```

Logs：

- 结构化；
- Schema Version；
- Secret Redaction；
- 不依赖自由文本解析关键状态。

Metrics：

- RED/USE；
- Queue Age；
- Runtime lifecycle；
- Authorization/Approval latency；
- Tool/Connector outcome；
- Recovery/Reconciliation；
- Quota rejection；
- Projector lag；
- Resource usage。

Trace：

- 用户请求到 Task；
- Agent/LLM；
- Tool/MCP/Connector；
- Source System；
- Readback/Reconciliation。

## 15. SLO 与告警

SLO 维度：

- 交互请求；
- 后台任务；
- Runtime 准备；
- Authorization；
- Tool/Connector；
- Event Projection；
- Recovery；
- Audit durability。

告警至少覆盖：

- Runtime LOST；
- Lease 续租失败；
- Projector Lag；
- Queue Age；
- Reconciliation Backlog；
- Credential Refresh Exhausted；
- Audit Write Failure；
- Cross-tenant Deny；
- Capacity Hard Limit；
- DRAINING Timeout；
- Resource Leak。

阈值进入实现任务书和容量测试，不在 ADR 写死。

## 16. 灾难恢复

必须定义：

- RPO/RTO 分类；
- Backup/Restore；
- Event Store/Operation Ledger 一致恢复点；
- Object Store Version；
- Secret/KMS 恢复；
- Runtime 全量重建；
- Connector Credential Revalidation；
- Projection Rebuild；
- Audit Export 完整性。

Runtime 本身不纳入持久恢复对象。

## 17. 验收要求

至少验证：

1. API 实例重启不丢业务状态；
2. 双 Scheduler 只有一个有效 Lease；
3. 迟到协调写被 Fencing 拒绝；
4. 大文件任务不阻塞交互 Worker；
5. 用户达到 Runtime 上限后明确拒绝或排队；
6. Queue 有公平性和 Deadline；
7. Tenant A 无法读取 Tenant B 数据、Cache、Object 或 Audit；
8. 测试 Credential 不能进入生产；
9. Liveness=true、Readiness=false 时不准入；
10. Capability 失败只影响依赖它的任务；
11. Capacity=false 时返回明确结果；
12. Trace 可贯穿 Gateway 到源系统；
13. Audit 不因 Trace Sampling 丢失；
14. 配置回滚不改变旧任务快照；
15. 从 Backup 和 Event 重建关键 Projection。

## 18. 依据

- ADR-0001 至 ADR-0004；
- `reference-evidence-runtime-closure.md`；
- `reference-evidence-final-architecture-domains.md`。

## 19. 非目标

不冻结：

- Kubernetes 或具体编排产品；
- 云厂商；
- 具体数据库/Queue/Cache；
- Pod 数量；
- CPU/Memory 数值；
- SLO 数值；
- 生产拓扑数量；
- 多 Region 启用时间。
