# Process Copilot 开发计划清单 v1

- 状态：Active Execution List
- 日期：2026-11-11
- 架构基线：ADR-0001 至 ADR-0017
- 计划基线：`greenfield-implementation-plan-v1.md`
- 产品基线：`minimum-product-development-plan-v1.md`
- 当前代码基线：本地提交 `cdfc100`
- 发布约束：先在本地构建、测试和版本控制；稳定前不推送远程仓库，不修改远端测试环境

## 1. 用途

本清单是 ADR、P0-P7 实施蓝图与当前代码进度之间的执行台账。它不替代 ADR，也不重复工作包全文，而是回答：

1. 当前已经完成什么；
2. 下一项唯一主线是什么；
3. 后续批次依赖哪些稳定边界；
4. 每项达到什么门禁才允许标记完成；
5. 完成证据记录在哪里。

状态定义：

| 状态 | 含义 |
|---|---|
| `completed` | 已有代码、自动化测试和必要的运行证据 |
| `next` | 当前唯一优先实施项 |
| `pending` | 已规划，但依赖项或进入门禁尚未满足 |
| `blocked` | 已开始但存在明确外部阻塞；必须记录阻塞原因 |

## 2. 执行顺序

```text
DEV-00 P0 工程与契约基线
  ↓
DEV-01 P1-A Stock SDK Runtime Skeleton
  ↓
DEV-02 P1-B1 Runtime Control Bridge
  ↓
DEV-03 P1-B2 Release / Revoke / Drain / Finalizers
  ↓
DEV-04 Runtime Registry / Assignment / Lease / Guard
  ├─ DEV-05 P2 Identity / Profile / Capability
  └─ DEV-06 P3 Resource / Workspace
       ↓
DEV-07 P4 Controlled Gateway / MCP / Durable Approval
  ↓
DEV-08 P5 Event / Business State / Recovery
  ↓
DEV-09 SSTS Draft 纵向产品闭环
  ↓
DEV-10 P6 Deployment / Security / Observability 收口
  ↓
DEV-11 Pilot Recovery / Isolation Hardening
  ↓
DEV-12 P7 Release Qualification
```

P2 与 P3 只有在 DEV-04 的 Runtime 权威、Assignment、Lease、Fencing 和 Guard Contract 稳定后才可并行。P6 的基础能力从 P0 持续建设，但完整收口位于业务与恢复主链之后。

## 3. 开发计划

### DEV-00：工程与契约基线

- 状态：`completed`
- 阶段：P0
- 范围：绿地 Monorepo、42 个 machine-readable Contract、golden fixtures、Traceability、Compatibility、依赖门禁、统一错误与审计基础。
- 依赖：无。
- ADR：ADR-0014，并覆盖 ADR-0001 至 ADR-0017 的可追溯入口。
- 主要模块/Contract：M22、C01-C42。
- 验收门：17/17 ADR 可追溯；42/42 Contract 可解析；lint、typecheck、test、build 和 forbidden dependency 检查通过。
- 证据：本地基线提交 `946c29e`；P0 验收时 56 个测试通过，P1-A 基线提交时全套 62 个测试通过。

### DEV-01：P1-A Stock SDK Runtime Skeleton

- 状态：`completed`
- 阶段：P1-A
- 范围：固定 DSH 源码与 Profile 构建；Runtime Host 使用官方 SDK 创建、继续和恢复 Session；规范化事件落盘；容器替换恢复。
- 依赖：DEV-00。
- ADR：ADR-0001、ADR-0002、ADR-0003、ADR-0004、ADR-0006。
- 主要模块/Contract：M15、M16、M17、C07-C11、C25、C31、C33。
- 验收门：真实模型连续三轮上下文；替换 Runtime 后显式恢复；无宿主端口；持久事件和 DSH Session 文件可核验。
- 证据：本地提交 `946c29e`；隔离 Docker 验证通过；6 个测试文件、62 个测试通过。

### DEV-02：P1-B1 Runtime Control Bridge

- 状态：`completed`
- 阶段：P1-B1
- 范围：本机私有 Bridge 握手、Session flush、精确 Turn cancel、事件 catch-up、`OBSERVED`/`DURABLE_DSH` 去重与序号冲突检测。
- 依赖：DEV-01。
- ADR：ADR-0002、ADR-0004、ADR-0006。
- 主要模块/Contract：M05、M15、M16、C08-C11、C25、C31。
- 验收门：Bridge 仅 loopback、Secret 认证、描述文件权限收紧；真实运行中可取消；替换后可补齐持久事件缺口；不发布宿主端口。
- 证据：本地提交 `1ee4159`；`docs/runtime-p1-b1-verification.md`；8 个测试文件、68 个测试通过。

### DEV-03：P1-B2 Release、Revoke、Drain 与 Finalizers

- 状态：`completed`
- 阶段：P1-B2
- 范围：`pc.bridge/session.release`、`REVOKE_SESSION`、`DRAIN_RUNTIME`、Lease refresh、Finalizer 聚合、Cleanup Report 和失败分类。
- 依赖：DEV-02。
- ADR：ADR-0002、ADR-0003、ADR-0004、ADR-0006。
- 主要模块/Contract：M04、M05、M15、M16、C08-C11、C29、C31。
- 验收门：Drain 后拒绝新工作；活动 Session 按策略 flush/release/revoke；Finalizer 可重入且有超时；部分清理失败形成结构化报告；旧 Generation/Fencing 命令继续被拒绝。
- 证据：本地提交 `358bcb0`；
  `product/docs/runtime-p1-b2-verification.md`；最终镜像
  `process-copilot-p1a-local-runtime-host:p1b2-20261110-0857`，摘要
  `sha256:8776a5fd669a8c32ad8dfa1d172c25e33b1f8789508983b3320954f0831ca51c`；
  8 个测试文件、73 个测试通过；最终镜像在无网络、无宿主端口、无源码
  bind mount 条件下完成 5 Session resume、单 Session revoke、4 Session
  drain、22 个 finalizer 和 Tombstone 重启验证；证据卷
  `process-copilot-p1b2-final-verify-20261110_runtime-data` 保留。

### DEV-04：Runtime Registry、Assignment、Lease 与 Guard

- 状态：`completed`
- 阶段：P1 收口
- 范围：持久 Runtime Registry 权威模型、SessionAssignment、Lease 续租与过期、Generation/Fencing、Step Guard、Tool Guard、Runtime/Session 查询投影。
- 依赖：DEV-03；C06-C11 的行为语义保持稳定。
- ADR：ADR-0001、ADR-0002、ADR-0004、ADR-0006。
- 主要模块/Contract：M04、M05、M15、M16、M18、C06-C11。
- 验收门：Registry 是唯一写入权威；过期 Lease 和旧 Fencing 在 DSH/Tool dispatch 前拒绝；Runtime 替换不复用旧 Epoch；Assignment 可恢复、可查询、可审计。
- 证据：本地提交 `7e980eb`；`product/docs/runtime-dev04-verification.md`；
  11 个测试文件、81 个测试通过；隔离 Docker/PostgreSQL 完成同 Session
  并发 201/409、Lease CAS 与过期、API/Host/Bridge Guard、API/PostgreSQL
  重启恢复及 Runtime Epoch 1→2 替换；API 与两个 Runtime Host 均无宿主端口。

### DEV-05：P2 Identity、Profile 与 Capability

- 状态：`completed`
- 阶段：P2
- 范围：可信 PCPrincipal、Authorization Revision、ExpertProfile Release、EffectiveProfileSnapshot、Runtime capability admission、EE Claw Role/Policy Adapter Contract。
- 依赖：DEV-04；可与 DEV-06 并行。
- ADR：ADR-0009、ADR-0010、ADR-0015、ADR-0016、ADR-0017。
- 主要模块/Contract：M02、M03、M06-M08、M17、E01-E04、C01-C03、C12-C16、C35-C42。
- 验收门：未验证身份不能创建 Session；Snapshot 不可变且可重现；Focus/责任/工作台不扩权；Profile/Runtime 不兼容在 Assignment 前拒绝；Legacy V1 零迁移兼容 fixture 通过。
- 证据：产品提交 `0039abf`；EE Claw `runtaozhang` 提交 `5937cf63`；
  `product/docs/dev05-verification.md`；产品全量门禁 16 个测试文件、98 个测试
  通过，2 个 PostgreSQL 文件按默认配置跳过后在内部 Docker 网络单独 2/2
  通过；EE 后端真实 MySQL 40 个测试、前端权限 6 个测试和生产构建通过；
  API/PostgreSQL 重启恢复 Pilot Session、Grant、Profile Release 与 Snapshot；
  真实 HTTP C41/C42 联调通过；全部验证环境无固定宿主端口。

### DEV-06：P3 Resource 与 Workspace

- 状态：`completed`
- 阶段：P3
- 范围：Resource/Version、Binding、WorkspaceViewSnapshot、上传与扫描、Runtime Materialization、TTL cleanup、Provenance 和访问控制。
- 依赖：DEV-04；可与 DEV-05 并行。
- ADR：ADR-0005、ADR-0010、ADR-0012。
- 主要模块/Contract：M03、M09、M15、M16、M21、C03、C17-C20、C32。
- 验收门：稳定 API 不暴露服务器路径；Runtime 只看到 Session 白名单；跨用户/Session/项目不串用；替换 Runtime 可重新物化同一版本；过期内容安全清理。
- 证据：产品提交 `623b0d9`；`product/docs/dev06-verification.md`；
  全量门禁 18 个测试文件、104 个测试通过，3 个 PostgreSQL 条件测试按
  默认配置跳过；双用户/Session 隔离、项目范围 fail closed、版本 CAS、
  派生 Provenance、路径穿越和 Runtime admission 自动化测试通过；无宿主
  端口 Docker 完成 Materialization/TTL cleanup、API/PostgreSQL 重启、
  Runtime Epoch 1→2 替换和同一 ResourceVersion 重物化；Linux symlink
  cleanup 保留根外 marker。

### DEV-07：P4 Controlled Gateway、MCP 与 Durable Approval

- 状态：`completed`
- 阶段：P4
- 范围：Integration/Account 注册、Credential Broker、PrincipalEnvelope、Controlled Execution Gateway、MCP Tool Provider、Durable BusinessApproval、幂等与撤权。
- 依赖：DEV-05、DEV-06。
- ADR：ADR-0007、ADR-0008、ADR-0010、ADR-0012。
- 主要模块/Contract：M03、M07、M08、M11、M12、M14、M16、C02-C05、C15-C16、C21-C24。
- 验收门：企业写只有 Gateway 一个出口；用户间不共享 Token/Credential/MCP Session；审批绑定参数与目标 digest；旧 Revision/Generation/Fencing 拒绝；Unknown Outcome 进入 Ledger。
- 证据：产品提交 `06e637e`；`product/docs/dev07-verification.md`；
  全量门禁 20 个测试文件、113 个测试通过，4 个 PostgreSQL 条件测试按
  默认配置跳过；双用户/双 Session MCP 隔离、旧 Credential Generation、
  隐藏 Tool、Schema/Recovery 元数据、Runtime Guard、Approval 参数绑定、
  自批准、并发幂等、Unknown Outcome reconciliation、Audit fail closed 和
  API 脱敏自动化测试通过；独立 PostgreSQL 17 重启恢复 `CONSUMED`
  Approval、`ACTIVE` MCP Binding 和 `OUTCOME_UNKNOWN` Operation，并收敛为
  `KNOWN_SUCCESS`；无宿主端口 DEV-07 Compose 完成 API/PostgreSQL 重启和
  Approval 恢复。

### DEV-08：P5 Event、Business State 与 Recovery

- 状态：`completed`
- 阶段：P5
- 范围：Durable Event Inbox、Normalizer、gap/quarantine、BusinessTask/Operation Ledger、Projection/rebuild、RecoveryCase、External Reconciliation 和 Runtime migration。
- 依赖：DEV-04、DEV-07。
- ADR：ADR-0003、ADR-0011、ADR-0012。
- 主要模块/Contract：M10、M13、M14、M19、M22、C24-C30。
- 验收门：重复、乱序、缺口和迟到事件不污染业务状态；Projection 可重建；Runtime 崩溃后使用新 Epoch/Generation 恢复；未完成 Tool 明确归类为 retry/reconcile/manual。
- 证据：产品提交 `85f974c`；`product/docs/dev08-verification.md`；
  全量门禁 22 个测试文件、123 个测试通过，5 个 PostgreSQL 条件测试按
  默认配置跳过；重复、乱序、gap drain、late/quarantine、stale Runtime
  authority、BusinessTask/Operation 状态机、Gateway event publication、
  provider success 与业务 verification 分离、deterministic rebuild、
  Approval wait、Outcome Unknown reconciliation、Runtime migration 和
  exporter prefix replay 自动化测试通过；独立 PostgreSQL 17 恢复 Inbox、
  Cursor、Projection、Checkpoint、RecoveryCase 与 ReconciliationResult；
  无宿主端口 DEV-08 Compose 完成 ingest 鉴权、gap/quarantine、9 条源事件
  rebuild、API 重启及 PostgreSQL 重启后的恢复验证。

### DEV-09：SSTS Draft 纵向产品闭环

- 状态：`completed`
- 阶段：MVP M1-M4
- 范围：登录、任务列表、任务工作区、文件上传、固定 FO Profile、连续对话、输入齐套检查、SSTS Draft、引用与校验、人工确认/驳回和下载。
- 依赖：DEV-05、DEV-06、DEV-08 的最小稳定子集；不依赖企业写。
- ADR：适用 ADR-0001 至 ADR-0014；企业角色只消费已授权的只读边界。
- 主要模块/Contract：M01-M10、M13、M15、M16、M19-M22；MVP Contract 子集。
- 验收门：用户可完成完整 Draft 闭环；生成绑定精确 ResourceVersion/ProfileRelease；确认不触发 EE Claw 发布；刷新、API 重启和 Runtime 替换后状态可恢复。
- 证据：产品提交 `cdfc100`；`product/docs/dev09-verification.md`；
  全量门禁 24 个测试文件、125 个测试通过，6 个 PostgreSQL 条件测试按
  默认配置跳过；独立 PostgreSQL 17 容器恢复测试通过；双用户隔离、
  缺输入 fail closed、幂等生成、精确 ProfileRelease/ResourceVersion、
  Citation/Validation、驳回后第二修订、接受、下载授权和无企业写副作用
  自动化测试通过；无宿主端口 DEV-09 Compose 完成完整后端闭环、API
  重启及 PostgreSQL 重启加 API 容器重建后的恢复。前端和真实 Runtime/LLM
  生成引擎不在本批范围，进入条件已记录在验收文档。

### DEV-10：P6 Deployment、Security 与 Observability

- 状态：`next`
- 阶段：P6
- 范围：Stateless API、Durable Store、Worker/Runtime Pool、Quota/Backpressure、Sandbox、default-deny egress、Secret Store、OpenTelemetry、Audit、备份恢复和环境隔离。
- 依赖：从 DEV-00 持续建设；在 DEV-08、DEV-09 后完成收口。
- ADR：ADR-0012、ADR-0013、ADR-0014。
- 主要模块/Contract：M18、M20-M22，并横切全部运行模块。
- 验收门：Tenant Context 不省略；Runtime/Gateway 网络边界可验证；高风险写审计失败时 fail closed；Secret、Egress、Sandbox、RBAC、Backup/Restore 和告警测试通过。
- 完成证据要求：部署清单、威胁模型、隔离与渗透测试、SLO/告警证据、备份恢复和故障演练。

### DEV-11：Pilot Recovery 与 Isolation Hardening

- 状态：`pending`
- 阶段：MVP M5 / Pilot
- 范围：Runtime 丢失恢复、Event gap、Session 过期、两用户隔离、操作手册、故障手册和试点环境验收。
- 依赖：DEV-09、DEV-10。
- ADR：ADR-0003、ADR-0011、ADR-0013、ADR-0014。
- 主要模块/Contract：全链路恢复、隔离和运维边界。
- 验收门：API 重启不丢任务；Runtime 替换不丢 Draft/Review；跨用户数据、Session、Runtime、Credential 不串用；所有错误有可执行恢复动作。
- 完成证据要求：Pilot E2E、故障注入、隔离矩阵、操作手册演练和试点签收。

### DEV-12：P7 Release Qualification

- 状态：`pending`
- 阶段：P7
- 范围：全量 Traceability、Contract/Consumer/Replay/Security tests、Compatibility 验证、性能容量、Canary/Rollback/Drain 和发布决策。
- 依赖：DEV-00 至 DEV-11。
- ADR：ADR-0014，并验证全部适用 ADR。
- 主要模块/Contract：M22、C01-C42 及全部适用运行证据。
- 验收门：适用 Traceability 全部 `verified`；S1 Compatibility 为 `Verified supported`；无隔离、Gateway 绕过或过期授权执行缺陷；恢复、回滚和灾难演练通过；高危安全问题清零。
- 完成证据要求：Release evidence pack、Compatibility Matrix、性能与容量基线、Canary/Rollback 记录、正式 Release Decision。

## 4. 当前优先级

当前唯一主线：

```text
DEV-10 P6 Deployment、Security 与 Observability
```

DEV-09 已完成确定性后端 SSTS Draft 纵向闭环：Task Workspace、精确
ResourceVersion 输入、固定 FO Profile、消息、齐套检查、幂等 Draft、
Citation/Validation、不可变修订、人工接受/驳回、授权下载和 PostgreSQL
恢复均已落地，并验证不经过 Gateway 或 EE Claw 企业写路径。下一步进入
DEV-10 Deployment/Security/Observability 收口。最小前端可以基于当前 API
启动工作流、权限、恢复和响应式体验测试，但真实 AI 验收仍需后续接入
Runtime Assignment、EffectiveProfileSnapshot、Materialization 和
`START_TURN` 编排。

## 5. 更新规则

1. 只有同时具备代码、测试和所需运行证据时才标记 `completed`；
2. 同一时间只保留一个 `next`；
3. 完成项必须记录本地提交、测试数量和验收文档；
4. 依赖未满足的项目保持 `pending`，不得用百分比掩盖关键门禁；
5. 出现明确阻塞时改为 `blocked`，写明责任方、阻塞事实和解除条件；
6. 每次状态变化同步更新本文件和架构活文档最新版本；
7. 计划调整若改变 Accepted ADR 语义，必须先新增 Superseding ADR；
8. 本地代码稳定前不配置或推送远程代码仓库，远端测试环境变更需要单独授权。
