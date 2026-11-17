# Process Copilot 绿地实施计划 v1

- 状态：Accepted Implementation Blueprint
- 日期：2026-11-09
- 依据：ADR-0001 至 ADR-0017
- 前置：DSH 无侵入审查、模块责任矩阵、Contract Catalog、Traceability Manifest、Compatibility Matrix
- 实施原则：先纵向闭环，再扩展能力；首期不修改 DSH Core

## 1. 目标

本计划把第一版 ADR 转化为可执行批次。目标不是迁移现有 Demo，而是建立新的、可验证的 Process Copilot 技术基线。

首个可运行闭环：

```text
可信 RequestContext
→ EffectiveProfileSnapshot
→ 用户作用域 Runtime
→ SessionAssignment + Lease + Fencing
→ DSH Session 执行
→ PcEventEnvelope
→ Event Inbox / Projection
→ API 查询结果
```

在该闭环稳定后再加入 Resource、MCP、企业写、持久审批和恢复。

## 2. 执行约束

1. 不修改 DSH Core；
2. 不复用 Demo 数据库 Schema 或目录作为目标基线；
3. 跨模块实现前先提交对应 Contract schema 和 fixture；
4. 每个批次必须包含测试、遥测、审计和回滚说明；
5. 不允许以 TODO、自由文本错误或临时共享表替代稳定边界；
6. 企业写操作在 Controlled Execution Gateway 完成前不得直连；
7. 安全敏感能力缺失时 fail closed；
8. 每个实现 PR/变更集必须引用 ADR、Module、Contract 和 Test ID；
9. DSH 升级必须更新 Compatibility Matrix；
10. 新需求通过新增或 Superseding ADR 进入，不静默改写已接受语义。

## 3. 实施流

```text
P0 工程与契约基线
  ↓
P1 Runtime Walking Skeleton
  ↓
P2 Identity / Profile / Capability
  ↓
P3 Resource / Workspace
  ↓
P4 Controlled Execution / MCP / Approval
  ↓
P5 Event / Business State / Recovery
  ↓
P6 Deployment / Security / Observability
  ↓
P7 Release Qualification
```

P2 和 P3 可以在 P1 核心 Contract 稳定后并行；P4 依赖 P2、P3；P5 依赖 P1 和 P4 的事件/操作语义；P6 从 P0 开始持续建设，在 P5 后收口。

## 4. P0：工程与契约基线

### 目标

创建可持续演进的绿地工程，先让架构规则能够被 CI 执行。

### 工作包

| WP | 内容 | 主要模块/Contract | 交付物 |
|---|---|---|---|
| WP-0001 | 初始化绿地仓库与模块边界 | M01-M22 | workspace、构建、测试、lint、格式化 |
| WP-0002 | 建立 machine-readable Contract schemas | C01-C42 | schema 包、版本规则、canonical digest |
| WP-0003 | 建立 golden fixtures 和 compatibility runner | M22、C33、C34 | fixture runner、consumer tests |
| WP-0004 | 建立 Traceability CI | M22、C34 | ADR/module/contract/test 缺失检查 |
| WP-0005 | 建立 forbidden dependency rules | M22 | 禁止业务模块依赖 DSH internal package |
| WP-0006 | 建立统一 ID、时间、错误、幂等和审计库 | C01、C31、C32 | shared kernel，仅含稳定基础类型 |
| WP-0007 | 固定 DSH source/profile build input | M17 | pinned commit、lock、可重复构建脚本 |
| WP-0008 | 建立本地开发和 CI secrets discipline | M11、M21 | secret scan、日志脱敏、fixture secrets |

### 退出条件

- Contract schemas 可解析并生成 fixture；
- Traceability JSON 在 CI 中校验 17/17 ADR；
- forbidden dependency 测试能阻止 Control Plane 引用 DSH internal package；
- DSH pinned source 和 Profile 构建输入可重复获取；
- 所有服务具备统一 health、trace、audit stub；
- 没有生产 Secret 进入本地配置或测试数据。

## 5. P1：Runtime Walking Skeleton

### 目标

打通无企业写能力的最小 DSH 纵向闭环。

### 工作包

| WP | 内容 | 模块 | Contract/Test |
|---|---|---|---|
| WP-0101 | Runtime Registry 最小权威模型 | M04 | C06、TS-RUNTIME-001 |
| WP-0102 | SessionAssignment、Generation、Lease、Fencing | M05 | C08、TS-RUNTIME-003/004 |
| WP-0103 | Runtime Host 进程监督与状态机 | M15 | C09-C11、C31 |
| WP-0104 | `process-copilot-runtime` DSH Profile/Bundle | M17 | C07、C33 |
| WP-0105 | PC Runtime Bridge Plugin 骨架 | M16 | RuntimeBridgePort |
| WP-0106 | Bridge handshake、version、capability manifest | M15、M16 | C07、TS-RUNTIME-009 |
| WP-0107 | Session create/resume/flush/cancel 映射 | M15、M16 | C09、C10 |
| WP-0108 | Step Guard 与 Tool Guard 接入 Assignment cache | M05、M16 | C08、TS-RUNTIME-004 |
| WP-0109 | Event Exporter 最小链路 | M13、M16 | C25、C26 |
| WP-0110 | API 查询 Runtime/Session/事件投影视图 | M01、M13 | read DTO |
| WP-0111 | DRAINING 与安全 teardown | M04、M15 | C09-C11、TS-RUNTIME-007 |
| WP-0112 | Walking Skeleton E2E | 全链路 | 一个只读/无副作用 Agent Turn |

### Walking Skeleton 验收

1. 创建一个用户作用域 Runtime；
2. 产生唯一 Runtime Epoch；
3. 为 PC Session 创建 ACTIVE Assignment；
4. Host 与 Bridge 完成 protocol/capability handshake；
5. 创建或恢复 DSH Session；
6. 执行一个不需要企业权限的 Turn；
7. Tool Guard 能拒绝过期 Lease；
8. DSH 技术事件进入 PC Event Inbox；
9. 重复事件不重复投影；
10. Runtime drain 后完成 flush、Session release 和进程退出；
11. 使用旧 Generation/Fencing 的命令被拒绝；
12. 全流程无业务模块直接依赖 DSH 内部类型。

## 6. P2：Identity、Profile 与 Capability

### 目标

让每个 Session 在启动前获得可信主体、授权版本和不可变 Effective Profile。

### 工作包

| WP | 内容 | 模块 | Contract |
|---|---|---|---|
| WP-0201 | PCPrincipal 与可信身份映射 | M02 | C01 |
| WP-0202 | Authorization Policy/Revision 最小模型 | M03 | C02、C03 |
| WP-0203 | ExpertProfile Definition/Draft/Release | M06 | C12 |
| WP-0204 | Tool/Plugin Registry Release 模型 | M07 | C15、C16 |
| WP-0205 | Effective Capability Resolver | M08 | C13、C14 |
| WP-0206 | Profile/Bundle Builder | M17 | C33 |
| WP-0207 | AgentPreset 生成、绑定和 digest | M16、M17 | C13 |
| WP-0208 | Runtime capability compatibility admission | M04、M05、M08 | C07、C08、C33 |
| WP-0209 | Profile revoke/rollback 对新 Session 生效 | M06、M08 | C12-C14 |
| WP-0210 | Profile/Tool/Plugin 安全矩阵 | M22 | TS-PROFILE、TS-ARCH |
| WP-0211 | EE Claw Enterprise Role Adapter Contract | M03、E01、E02 | C35-C39、C41 |
| WP-0212 | Policy Artifact Release 与 Policy Model Revision | M03、M22、E03 | C38-C41 |
| WP-0213 | Legacy V1 Contract/Baseline Compatibility Fixture | M03、M22、E04 | C42、TS-LEGACY |

### 退出条件

- 未验证身份不能创建 Session；
- Profile 可见性与可执行性分离；
- EffectiveProfileSnapshot 完全可重现且有 digest；
- 缺失安全要求或 Runtime capability 时拒绝 Assignment；
- Session 首个 Turn 后不能静默切换 Profile；
- Plugin 不兼容时在 import 前拒绝；
- Runtime 只加载批准且锁定的 Profile/Bundle/Plugin 组合。

## 7. P3：Resource 与 Workspace

### 目标

建立路径之外的 Resource 身份和受控 Runtime Materialization。

### 工作包

| WP | 内容 | 模块 | Contract |
|---|---|---|---|
| WP-0301 | Resource/ResourceVersion 权威模型 | M09 | C17 |
| WP-0302 | ResourceBinding 与 WorkspaceViewSnapshot | M09 | C18 |
| WP-0303 | 上传、接纳、扫描和分类状态机 | M09 | C17 |
| WP-0304 | Materialization 请求/结果和 TTL | M09、M15 | C19、C20 |
| WP-0305 | Runtime 路径安全与 cleanup finalizer | M09、M15 | C20 |
| WP-0306 | DerivedResource 与 Provenance | M09、M21 | C17、C32 |
| WP-0307 | Resource authorization enforcement | M03、M09、M16 | C03、C18 |
| WP-0308 | 并发版本、归档与删除 | M09 | Resource tests |
| WP-0309 | Resource isolation/security matrix | M22 | TS-RESOURCE、TS-SECURITY |

### 退出条件

- Runtime 只看到 WorkspaceView 白名单；
- 本地路径不能反向充当 Resource ID；
- 不同用户、Session、项目的物化内容不串用；
- Materialization 过期后可安全清理；
- 删除、归档和派生保留明确 Provenance；
- 恢复到新 Runtime 时可重新物化同一 ResourceVersion；
- 审计不默认记录完整敏感正文。

## 8. P4：Controlled Execution、MCP 与 Durable Approval

### 目标

建立企业写操作的唯一受控出口。

### 工作包

| WP | 内容 | 模块 | Contract |
|---|---|---|---|
| WP-0401 | Integration/Connector/Account 注册模型 | M11 | C04、C23 |
| WP-0402 | Credential Broker 和短期 CredentialLease | M11 | C04 |
| WP-0403 | PrincipalEnvelope 签发与验证 | M03、M14 | C02 |
| WP-0404 | Controlled Execution Gateway admission pipeline | M14 | C21-C24 |
| WP-0405 | Schema、授权、Fencing、幂等校验 | M05、M07、M14 | C08、C15、C21 |
| WP-0406 | PC MCP Tool Provider Plugin | M16 | C21、C23 |
| WP-0407 | MCP Tool Catalog 过滤与 digest | M07、M08、M14 | C13、C15、C23 |
| WP-0408 | Durable BusinessApproval | M12 | C05 |
| WP-0409 | DSH Approval Bridge | M12、M16 | C05、C25 |
| WP-0410 | 撤权、Token cache 隔离和 generation | M03、M11、M14 | C02-C04、C23 |
| WP-0411 | Cancel/Timeout/401/403 恢复分类 | M10、M14、M19 | C22、C24、C29 |
| WP-0412 | 企业写 E2E 与对账 stub | 全链路 | TS-GATEWAY、TS-SECURITY |

### 首期明确不做

- DPoP 实际签发与验证；
- mTLS certificate-bound token；
- Runtime 直接持有长期 Token；
- 通用 DSH MCP Client 承担用户委托；
- 未经 Gateway 的企业写 Tool；
- Cancel 后宣称外部操作一定停止。

### 退出条件

- 不同用户不能共享 Token、CredentialLease 或 stateful MCP Session；
- 旧 AuthorizationRevision、CredentialGeneration、AssignmentGeneration 和 Fencing 被拒绝；
- 隐藏 Tool 被直接调用时 Gateway 仍拒绝；
- 审批绑定 operation/argument/target digest；
- 企业写重复请求按 idempotency key 收敛；
- Outcome Unknown 进入 Operation Ledger，而非伪造失败或成功；
- Token、Secret、私钥不进入日志和事件。

## 9. P5：Event、Business State 与 Recovery

### 目标

把 Runtime 技术执行转化为可恢复、可重建的业务状态。

### 工作包

| WP | 内容 | 模块 | Contract |
|---|---|---|---|
| WP-0501 | Durable Event Inbox | M13 | C25 |
| WP-0502 | 去重、局部顺序、gap/quarantine | M13 | C25、C26 |
| WP-0503 | Versioned Normalizer | M13 | C25 |
| WP-0504 | BusinessTask/Subtask 状态机 | M10 | C27 |
| WP-0505 | BusinessOperation/Operation Ledger | M10 | C24、C28 |
| WP-0506 | Projection、checkpoint 和 rebuild | M13 | C26-C28 |
| WP-0507 | RecoveryCase 和恢复决策 | M19 | C29 |
| WP-0508 | External Reconciliation | M14、M19 | C30 |
| WP-0509 | Runtime loss / migration orchestration | M04、M05、M19 | C08-C11、C29 |
| WP-0510 | Approval wait recovery | M12、M19 | C05、C29 |
| WP-0511 | Replay/upgrade fixtures | M22 | TS-EVENT、TS-RUNTIME |
| WP-0512 | Chaos recovery E2E | 全链路 | crash、partition、duplicate、late event |

### 退出条件

- Event 重复、乱序和迟到不污染业务状态；
- gap 未修复时 Projection 标记不完整；
- Projection 可从权威事件重建；
- Runtime 崩溃后使用新 Epoch/Generation/Token 恢复；
- LLM 中断不伪装为 token 级继续；
- 未完成 Tool 进入 retry/reconcile/manual 明确分类；
- Approval 和长期任务不依赖旧 Runtime 存活；
- 恢复时重新鉴权和获取凭据。

## 10. P6：Deployment、Security 与 Observability

### 目标

把可运行系统提升为可隔离、可扩展、可审计和可运维系统。

### 工作包

| WP | 内容 | 模块 |
|---|---|---|
| WP-0601 | Stateless API 和 durable store 部署 | M01-M13 |
| WP-0602 | Worker Pool / Runtime Provisioner 分区 | M04、M18 |
| WP-0603 | Admission、Quota、Backpressure | M04、M10、M18 |
| WP-0604 | Runtime sandbox、filesystem、process limits | M15、M18 |
| WP-0605 | Default-deny egress 与 Gateway allowlist | M14、M15、M18 |
| WP-0606 | Secret Store/KMS 集成 | M11、M14 |
| WP-0607 | OpenTelemetry trace/metrics/log correlation | M20 |
| WP-0608 | Append-only audit/evidence storage | M21 |
| WP-0609 | SLO、告警和 error budget gates | M20 |
| WP-0610 | Backup/restore 和 disaster recovery | M04、M09-M13、M21 |
| WP-0611 | 环境隔离和发布配置 | M17、M18、M22 |
| WP-0612 | 安全威胁模型和渗透测试修复 | 全模块 |

### 退出条件

- 单租户首期仍强制携带 tenant context；
- Runtime 和 Gateway 网络边界可验证；
- API 重启不丢业务权威状态；
- Runtime 替换不丢 Session/Approval/Operation 恢复事实；
- 日志、Trace、Audit 的用途和保留策略分离；
- Secret 扫描、Egress、Sandbox、RBAC 和审计测试通过；
- Backup/restore 和区域/集群故障演练有证据。

## 11. P7：Release Qualification

### 目标

形成可发布的第一版，而不仅是功能完成。

### 工作包

| WP | 内容 |
|---|---|
| WP-0701 | 17 ADR traceability 全量检查 |
| WP-0702 | Contract/schema/golden/consumer tests |
| WP-0703 | Compatibility Matrix 基线转为 Verified supported |
| WP-0704 | DSH pinned behavior suite |
| WP-0705 | Security/isolation/revocation/fencing matrix |
| WP-0706 | Recovery/replay/chaos matrix |
| WP-0707 | Performance、capacity 和 backpressure 基线 |
| WP-0708 | Canary、rollback 和 drain 演练 |
| WP-0709 | 运维手册、故障手册和证据包 |
| WP-0710 | Release decision record |

### 发布门禁

- Traceability Manifest 中所有适用项为 implemented/verified；
- Compatibility Matrix 的 S1 组合为 `Verified supported`；
- 无跨用户、跨 Session、跨项目隔离缺陷；
- 无绕过 Gateway 的企业写路径；
- 无过期 Lease/Fencing/Authorization/Credential 可成功执行；
- Event/Projection/Recovery 关键 fixture 全部通过；
- Runtime drain、迁移、回滚和灾难恢复演练通过；
- 安全高危问题清零，中风险有明确接受记录；
- 文档、监控、告警和 On-call 操作可用。

## 12. 第一执行批次

P0 与 P1 的第一批建议直接创建以下任务：

1. `IMP-0001`：建立绿地 workspace 和模块依赖规则；
2. `IMP-0002`：将 C01-C42 落为 machine-readable schema；
3. `IMP-0003`：建立 traceability/compatibility CI；
4. `IMP-0004`：构建 pinned DSH Profile/Bundle；
5. `IMP-0005`：实现 Runtime Registry 最小状态机；
6. `IMP-0006`：实现 SessionAssignment/Lease/Fencing 内核；
7. `IMP-0007`：实现 Runtime Host 进程监督；
8. `IMP-0008`：实现 Bridge handshake/capability；
9. `IMP-0009`：实现 Session create/resume/flush/cancel；
10. `IMP-0010`：实现 Assignment Step/Tool Guard；
11. `IMP-0011`：实现 Event Exporter 与 Inbox stub；
12. `IMP-0012`：完成 Walking Skeleton E2E。

建议依赖：

```text
IMP-0001
  ├─ IMP-0002 ─ IMP-0003
  ├─ IMP-0004 ─ IMP-0008
  ├─ IMP-0005 ─ IMP-0006 ─ IMP-0007
  └─ IMP-0009 ─ IMP-0010 ─ IMP-0011 ─ IMP-0012
```

实际依赖需要在任务系统中按 Contract producer/consumer 精化；编号不表示时间估算。

## 13. 并行工作流

P1 稳定后可并行：

| 工作流 | 范围 | 合流门禁 |
|---|---|---|
| Runtime | M04、M05、M15、M16、M18 | C07-C11 contract tests |
| Profile / Enterprise Role | M03、M06-M08、M17、E01-E04 | C12-C16、C35-C42 compatibility tests |
| Resource | M09 | C17-C20 isolation tests |
| Security/Gateway | M02、M03、M11、M12、M14 | C02-C05、C21-C24 security tests |
| Event/Recovery | M10、M13、M19 | C25-C30 replay tests |
| Governance | M20-M22 | C31-C42 CI gates |

任何工作流不得通过复制 Contract 类型解决合流冲突；Contract Catalog 是唯一跨模块定义源。

## 14. 变更控制

实施中发现以下情况必须暂停对应工作包并形成决策记录：

- 首期确实无法通过无侵入方式实现某 ADR；
- DSH 行为与证据卡不一致；
- Contract major 需要改变；
- 权威数据需要跨模块共享写入；
- 安全要求只能通过 fail open 实现；
- 企业写操作无法提供幂等或对账；
- 新需求改变用户隔离、授权、审批或恢复语义。

若涉及已接受架构语义，新增 Superseding ADR；若只是实现选择且不改变架构语义，记录 Implementation Decision。

## 15. 完成定义

“ADR 已执行”不等于文档已写完，而是：

```text
ADR requirement
→ owned module
→ versioned contract
→ implementation
→ automated test
→ runtime evidence
→ traceability status verified
```

在此链路闭合前，Traceability Manifest 中的 `implementation_status` 保持 `planned` 或 `in_progress`。

