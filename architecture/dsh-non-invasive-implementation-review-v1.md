# DSH 无侵入实现审查 v1

- 状态：Accepted Implementation Review
- 日期：2026-11-09
- 适用 ADR：ADR-0001 至 ADR-0017
- DSH 基线：`dsh-v0.2.1-rc.3`
- DSH Commit：`1f81c047fc48fa190a683e469daa699857e9afe8`
- 审查结论：首期没有必须修改 DSH Core 的事项

## 1. 审查目的

本审查把已接受的十七份 ADR 转化为 DSH 集成边界，回答：

1. ADR 所需行为在当前 DSH 中已有何种事实基础；
2. 首期应通过配置、Adapter、Gateway、Plugin、Capability Seam、Tool/MCP 或独立服务实现什么；
3. 哪些缺口属于 Process Copilot 自身职责；
4. 哪些增强可以未来向 DSH upstream 提议；
5. 是否存在首期必须修改 DSH Core 的证据。

本审查不授权直接修改 DSH 仓库，也不把 DSH 的 pre-stable SDK、事件格式或错误文本提升为 Process Copilot 稳定业务契约。

## 2. 证据边界

审查使用以下已核验事实：

- DSH 支持命名 Profile、Bundle、Patch、外部 Plugin 和启动时静态装配；
- Profile 组合入口具有 Plugin compatibility preflight，可在模块导入前拒绝不兼容项；
- AgentPreset 支持稳定 ID、隔离组合、Session 选择持久记录，并在首个 Turn 后拒绝切换；
- Session 使用 append-only 技术日志，`session/event` 是持久事实观察入口；
- `session.flush()` 是等待持久层完成的 durability barrier；
- `resumeWith()` 支持从持久日志恢复并修复开放 Turn/Tool；
- Tool 执行提供 `tools/pre-execute`、`tools/execute`、`tools/post-execute` 和单调拒绝 Guard；
- Approval seam 记录 `approval/asked` 与 `approval/decided`，无可用审批通道时 fail closed；
- Plugin Manager、Profile/Bundle 组合和兼容性检查可作为部署期治理基础；
- DSH 不提供 PC 所需的 Runtime Pool、Assignment、Lease、Fencing、业务状态、企业凭据、持久业务审批或外部写对账权威。

正式证据详见本目录的参考证据卡。审查不根据接口名称推断未核验能力。

## 3. 无侵入实现优先级

所有 ADR 按以下顺序寻找实现落点：

```text
1. DSH Profile / Bundle / Patch 配置
2. Process Copilot Adapter / Gateway
3. DSH Plugin
4. Capability Seam 外部实现
5. Tool / MCP Provider
6. Process Copilot 独立持久服务
7. 受控 Runtime Host 包装层
8. 最后才评估 DSH Core 修改
```

首期禁止为了统一代码位置而把 PC 控制面职责下沉到 DSH Core。

## 4. 总体模块边界

```text
Process Copilot Control Plane
  - Identity / Authorization
  - Runtime Registry / Scheduler
  - Session Assignment / Lease / Fencing
  - Profile / Tool / Plugin Registry
  - Resource / Workspace Authority
  - Event Inbox / Projection / Operation Ledger
  - Durable Approval / Audit / Recovery
        |
        | stable PC contracts
        v
Runtime Host
  - process supervision
  - bridge protocol
  - assignment cache
  - health / capacity
  - drain / teardown
        |
        v
DSH named Profile
  - PC Runtime Bridge Plugin
  - AgentPreset composition
  - Step / Tool Guards
  - Event Exporter
  - Resource and MCP Tool Providers
        |
        v
PC Gateways and external systems
```

DSH 是 Agent 执行内核和扩展宿主；PC 是身份、授权、业务、资源、调度、恢复和企业写操作的权威。

## 5. 逐 ADR 审查矩阵

| ADR | 所需行为 | 当前 DSH 事实 | 首期无侵入实现 | 剩余缺口与归属 | 必须改 DSH Core | 未来 upstream 候选 |
|---|---|---|---|---|---|---|
| ADR-0001 | 用户作用域 Runtime Pool、多 Runtime、多 Profile、Session 固定 Profile | DSH 支持命名 Profile、Bundle、Plugin、AgentPreset；Preset 可按 Session 绑定并锁定 | PC Runtime Registry/Scheduler + 用户专属 Runtime Host；部署期生成命名 Profile；EffectiveProfileSnapshot 映射到 DshPresetRef | Runtime 归属、容量、调度和 Profile 权威均由 PC 实现 | 否 | 标准 capability/health manifest 查询 |
| ADR-0002 | Assignment、Lease、Generation、Epoch、Fencing、幂等 | DSH Tool Guard 可单调拒绝；Session/Tool 有技术身份，但没有跨 Runtime Fencing 权威 | PC Assignment Service 发放租约和 fencing token；Host 前置校验；Bridge Step Guard；Tool Guard；企业写 Gateway 最终校验 | 权威 Assignment、CAS、幂等记录和旧执行者拒绝属于 PC | 否 | 在技术事件中标准携带外部 fencing metadata |
| ADR-0003 | Runtime 故障恢复、稳定恢复点、工作分类、外部结果对账 | Session 持久日志、`flush()`、`resumeWith()` 和开放 Turn/Tool 修复可复用 | PC Recovery Coordinator 驱动重新分配；恢复前重新鉴权；Operation Ledger 分类 retry/reconcile/manual；Host 调用 DSH resume | 外部副作用、Outcome Unknown、Durable Job 和业务恢复状态属于 PC | 否 | 显式 durable resume handle 与恢复诊断 |
| ADR-0004 | DRAINING、Registry、健康、Finalizer、持久 Workspace | DSH 有取消、等待、dispose、flush 和进程 teardown 基础 | Runtime Host 实现 drain gate、分阶段 finalizer、心跳和分层健康；Workspace 独立于进程；DSH cwd 仅为物化路径 | Registry、Tombstone、容量、健康权威和 Workspace 生命周期属于 PC | 否 | 标准化 quiescence/health/capability introspection |
| ADR-0005 | Resource 身份、版本、作用域、Materialization、Provenance | DSH 可使用工作目录和 Tool/Plugin，但不提供 PC Resource 权威模型 | PC Resource Service/Gateway；受控 Materializer 将允许的 ResourceView 投影到 Session 工作目录；Plugin 只接收 ResourceRef | ResourceVersion、Binding、ACL、TTL、删除与 Provenance 属于 PC | 否 | Resource provider capability seam 标准化 |
| ADR-0006 | 稳定 DshAdapterPort、版本化 Bridge、错误归一化、事件补齐 | DSH SDK/API 能力可参考；Profile、Plugin、Session、Agent、Tool seam 足够承载 Bridge | PC Runtime Host + 本地版本化协议 + PC Runtime Bridge Plugin；禁止业务模块直连 DSH SDK | PC 稳定协议、Assignment/Fencing、catch-up cursor 和业务错误码需自建 | 否 | 稳定 event cursor/backfill API；结构化 host protocol |
| ADR-0007 | Principal Envelope、动态用户委托、MCP 隔离、撤权、Token Binding 预留 | 通用 MCP Client 偏静态 Server 配置；Tool Provider 可取得每次 ToolExecution 上下文 | PC MCP Tool Provider Plugin 每次调用构造 Envelope；PC MCP Gateway/Credential Broker 做 OBO、缓存隔离、撤权和最终授权 | 用户 Token、协议 Session、DPoP/mTLS、重试和对账属于 PC Gateway | 否 | 动态 AuthProvider；sender-constrained token hook |
| ADR-0008 | Tool/Plugin Registry、发布、依赖锁、风险、撤销、执行治理 | DSH Plugin/Profile/Bundle、Plugin Manager、兼容 preflight、Tool Registry 和 Guard 可复用 | PC Registry 保存不可变 Release；CI 构建锁文件和 Profile；部署期激活；运行期 Effective Capability Resolver + Tool Guard | 发布审批、供应链、风险、撤销和企业级 Rollout 属于 PC | 否 | 签名/来源/能力 manifest 的标准元数据 |
| ADR-0009 | Expert Profile Release、Assignment、解析、不可变快照 | AgentPreset 支持稳定声明、组合清单、Session 选择事件和首 Turn 后锁定 | PC Profile Resolver 生成 EffectiveProfileSnapshot；映射已批准的 Tool/Plugin/Model/Knowledge 到 DSH AgentPreset | Profile 发布治理、用户分配、授权和知识策略属于 PC | 否 | Preset 远程诊断、版本句柄和更完整 composition report |
| ADR-0010 | 稳定 Principal、外部身份链接、授权、Connector/Account/Credential 分离 | DSH 不应成为企业身份和授权权威；Tool/Plugin 可消费短期上下文 | PC IAM、Authorization、Integration Registry、Credential Broker 和 Connector Gateway 独立实现；Runtime 只收短期引用 | 全部核心能力均为 PC/企业集成职责 | 否 | 无首期必要项 |
| ADR-0011 | 技术事件接入、Event Inbox、幂等投影、Operation Ledger、重建 | `session/event` 可观察技术事实；Session 有局部序列和持久日志 | Event Exporter Plugin 输出版本化 EventEnvelope；PC Inbox 去重、排序、缺口检测并投影业务状态 | 跨 Runtime cursor、业务事件、Projection、Checkpoint 和 Ledger 属于 PC | 否 | 稳定 cursor/backfill、事件 schema version 和 replay API |
| ADR-0012 | 持久审批、不可变快照、审计链、Sandbox、Egress、凭据代理 | DSH Approval seam 可暂停并审计 asked/decided；Tool ask 无通道时 fail closed | Approval Bridge 将 DSH 请求映射到 PC BusinessApproval；恢复时重新校验；Sandbox/Egress/Credential 在 Host、Gateway 和基础设施层执行 | 长期审批状态、审计防篡改、网络策略和密钥托管属于 PC | 否 | 外部 durable approval/resume handle |
| ADR-0013 | 部署隔离、容量、Admission、健康、可观测性、DR | DSH 可作为被监督进程运行；Profile/Plugin 可提供本地指标和状态 | Stateless PC API + durable stores + partitioned worker pools + user-scoped Host；OpenTelemetry 贯穿 PC/Host/Bridge/Gateway | Tenant、Quota、Admission、SLO、DR 和环境隔离属于平台层 | 否 | 统一 runtime telemetry/capability export |
| ADR-0014 | Contract、Traceability、Compatibility、测试矩阵、架构一致性 | DSH 有兼容 preflight 和可测试的 Plugin/Tool/Preset seam | PC 建立稳定 Contract 包、Manifest、Compatibility Matrix、fixtures、隔离/恢复/安全测试和 CI 架构门禁 | PC 自身治理和发布证据链需建设 | 否 | 机器可读 DSH capability/compatibility manifest |
| ADR-0015 | 企业角色、责任、工作台投影、配置分级 | DSH 不应成为 EE Claw 企业角色或责任权威；AgentPreset 不能替代 Authorization/Profile 边界 | EE Claw E01-E03 持有角色/责任/投影/策略事实；PC Adapter 读取版本化 Contract；DSH 只消费 Effective Profile 和当前授权结果 | 角色与策略模型属于 EE Claw/PC Control Plane 外部权威 | 否 | 无 DSH upstream 必要项 |
| ADR-0016 | Policy Artifact 不可变 Release、审批、发布、回滚 | DSH Profile/Plugin Release 可作为相似治理参考，但不承载企业 Policy Artifact 权威 | EE Claw Policy Artifact Authority + PC Compatibility/Traceability；Runtime 只接收解析结果和 Revision | DB/Git/审批/跨环境发布属于企业控制面 | 否 | 无 DSH upstream 必要项 |
| ADR-0017 | EE Claw V1 Contract Freeze、Baseline、零迁移、即时撤权 | 与 DSH Core 无关；Runtime 仍通过 PC Gateway/Adapter 获得当前授权 | EE Claw Legacy Compatibility Layer 固定 8 表/V1 API/Baseline；PC 每次执行继续重新授权 | Legacy 兼容与数据策略属于 EE Claw | 否 | 无 DSH upstream 必要项 |

## 6. 首期结论

### 6.1 Core 修改判定

```text
首期必须修改 DSH Core：0 项
首期可通过无侵入方式实现：17/17 ADR
```

判定理由：

1. DSH 已提供足够的应用组合和运行期扩展点；
2. 缺失能力主要是 PC 的控制面、企业安全和业务权威，不应进入 DSH Core；
3. Runtime Host 和 Bridge 可以隔离 DSH pre-stable 接口；
4. Tool Guard、Approval seam、AgentPreset 和 Session 事件足以建立首期闭环；
5. 所有外部写操作仍由 PC Gateway 做最终授权、Fencing 和幂等校验。

### 6.2 Adopt / Adapt / Build

| 分类 | 首期选择 |
|---|---|
| Adopt | DSH Profile/Bundle、Plugin、AgentPreset、Session persistence、Tool pipeline、Approval seam、compatibility preflight |
| Adapt | Runtime Host、Bridge Plugin、Event Exporter、Resource/MCP Tool Provider、Step/Tool Guard |
| Build | PC Control Plane、Registry、IAM、Authorization、Resource、Approval、Audit、Projection、Recovery、Gateway |
| Reject as stable contract | DSH SDK wire、DSH 错误文本、原始 SessionEvent、Runtime 本地内存状态 |
| Fork | 不采用 |
| Core patch | 首期不采用 |

## 7. 可选 upstream 增强

以下项目可以降低 PC Adapter 复杂度，但不是首期阻塞：

1. **稳定 Event Cursor 与 Backfill API**  
   支持按 Session cursor 获取持久事件、检测缺口、声明 schema version，并从 live stream 平滑切换。

2. **Capability 与 Health Manifest**  
   以机器可读形式暴露 Profile、Plugin、Preset、Tool、模型、持久层和协议能力，不依赖自由文本或内部对象。

3. **外部持久审批句柄**  
   Approval request 可返回稳定 handle，允许 Runtime 重启后由外部审批系统恢复等待，不把业务审批状态放入 DSH。

4. **Fencing Metadata 传播**  
   允许宿主为 Session、Turn、Tool 和事件附加不透明 execution metadata，便于端到端审计和拒绝旧执行者。

5. **AgentPreset 远程控制与诊断**  
   增加稳定 revision identity、composition digest、兼容诊断和只读 inventory。

任何 upstream 提议都必须：

- 不把 PC 特定业务对象写入通用 DSH Core；
- 有独立测试和向后兼容策略；
- 允许 PC Adapter 在能力缺失时继续工作；
- 通过新 ADR 或实施决策记录 adopt/upstream 结果。

## 8. 首期实施门禁

### 8.1 必须先固定的 Contract

- `DshAdapterPort`
- `RuntimeBridgeProtocol`
- `RuntimeCapabilityManifest`
- `SessionAssignmentSnapshot`
- `EffectiveProfileSnapshot`
- `WorkspaceViewSnapshotRef`
- `PrincipalEnvelope`
- `ToolExecutionEnvelope`
- `PcEventEnvelope`
- `BusinessApprovalSnapshot`
- `OperationRecord`
- `AdapterError`

这些 Contract 由 PC 版本控制，不直接导出 DSH 内部类型。

### 8.2 禁止事项

1. 业务模块直接依赖 DSH SDK 或内部包；
2. Runtime 自行改变 Assignment、用户归属或业务状态；
3. 把 DSH cwd 当作 Resource 身份；
4. Runtime 持有企业长期凭据；
5. 把 DSH Approval 当作持久业务审批；
6. 把 `session/event` 回调当作 PC 已持久接纳；
7. 因集成方便绕过企业写 Gateway；
8. 为实现 PC 控制面而修改 DSH Core；
9. 直接 fork DSH；
10. 在没有 Traceability 和 Compatibility 证据时发布。

## 9. 验收检查

本审查只有在以下检查均成立时可用于开发：

- [x] ADR-0001 至 ADR-0017 均有明确无侵入落点；
- [x] 每项均区分 DSH 技术事实和 PC 权威职责；
- [x] 没有把 DSH pre-stable API 暴露为业务 Contract；
- [x] 企业写操作仍由 PC Gateway 最终校验；
- [x] Approval、Resource、Identity、Authorization 和 Business State 权威位于 Runtime 外；
- [x] 可选 upstream 能力未成为首期阻塞；
- [x] DSH Core 必改项为零；
- [x] DSH 源码基线 commit 已固定；
- [x] 模块责任矩阵与稳定 Contract 目录已发布；
- [x] Traceability Manifest 与 Compatibility Matrix 已发布；
- [x] 分阶段绿地开发计划已发布。

## 10. 下一步

执行 P0 工程与契约基线、P1 Runtime Walking Skeleton；ADR-0015 至 ADR-0017 的 EE Claw 实现需独立代码/数据库任务授权。

