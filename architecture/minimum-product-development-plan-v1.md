# Process Copilot 最小产品开发计划 v1

- 状态：Proposed Product Plan
- 日期：2026-11-09
- 目标：以最少页面和最小后端集合交付一个可真实试用的纵向闭环
- 前端原则：绿地新建，不复用旧原型页面、目录或状态模型
- 架构原则：遵守 ADR-0001 至 ADR-0017，但不在 MVP 中实现全部能力

## 1. 是否可以进入最小产品开发

可以。

当前已经具备：

- 17 份 Accepted ADR；
- DSH 无侵入实现结论；
- 模块与权威边界；
- 42 个稳定 Contract；
- Traceability 与 Compatibility 基线；
- P0-P7 实施蓝图。

MVP 不需要先实现所有模块。建议选取一个可运行、可恢复、可审计、无企业写副作用的纵向闭环。

## 2. 推荐 MVP 场景

### FO SSTS Draft Assistant

用户：

```text
登录
→ 创建一个技术规范任务
→ 上传 PRD、架构图/说明和可选通信矩阵
→ 使用固定 FO Expert Profile 对话
→ 检查输入是否齐套
→ 生成 SSTS 草稿
→ 查看引用来源和校验结果
→ 人工确认
→ 下载草稿
```

首期结果仍是：

```text
AI DRAFT
```

不直接成为 EE Claw 正式基线，不自动发布、不自动通知下游、不执行企业写操作。

### 选择该场景的原因

1. 有清晰业务输入和输出；
2. 能验证 Profile、Resource、Session、Runtime、Event 和持久状态；
3. 可展示 AI 的实际价值，不只是聊天 Demo；
4. 不依赖企业写 Gateway、Credential Broker 和复杂审批；
5. 后续可以自然升级到 ADR-0015 至 ADR-0017 的角色工作台和 Policy Artifact；
6. 可以先用上传文件，后续再接 EE Claw Resource Adapter。

## 3. MVP 用户闭环

### 3.1 必须完成

1. 用户通过一个受控登录入口进入；
2. 用户创建任务/会话；
3. 系统固定一个已发布 Expert Profile；
4. 用户上传文件，文件形成 Resource/ResourceVersion；
5. 系统创建用户作用域 Runtime 和 SessionAssignment；
6. 用户可以连续对话；
7. 系统显示 Runtime/任务当前状态；
8. 系统执行输入齐套检查；
9. 系统生成一个 SSTS Draft Resource；
10. Draft 显示引用来源和基础校验结果；
11. 用户可以确认、驳回或重新生成 Draft；
12. 页面刷新、API 重启或 Runtime 替换后，任务和文件仍可恢复；
13. 用户可以下载 Draft；
14. 基础审计记录主体、Profile、输入版本、生成结果和操作时间。

### 3.2 MVP 完成状态

```text
CREATED
→ PREPARING_RUNTIME
→ READY
→ CHECKING_INPUTS
→ INPUT_INCOMPLETE | GENERATING
→ DRAFT_CREATED
→ HUMAN_REVIEW
→ ACCEPTED | REJECTED
```

技术异常：

```text
RUNTIME_UNAVAILABLE
GENERATION_FAILED
EVENT_GAP
RECOVERY_REQUIRED
```

### 3.3 首期不做

- 不把 Draft 发布成 EE Claw 正式基线；
- 不调用企业写 Tool；
- 不建设 MCP Credential Broker；
- 不实现 DPoP/mTLS；
- 不建设完整 BusinessApproval；
- 不建设 Role/Permission 管理页面；
- 不建设 Workbench Projection 编辑器；
- 不建设 Policy Artifact 发布后台；
- 不建设 Plugin 市场；
- 不支持多个 Expert Profile 混合；
- 不建设本地目录持续同步；
- 不做多人实时协作；
- 不做移动端专属交互；
- 不迁移旧原型数据；
- 不复用旧原型 API、数据库 Schema 或前端组件。

## 4. 轻量前端规划

## 4.1 页面数量

MVP 只需要三个页面：

```text
/login
/tasks
/tasks/:taskId
```

不建设独立 Dashboard、复杂管理中心或营销首页。

### 页面一：登录

内容：

- 产品名称；
- 单一企业登录按钮；
- 登录失败状态；
- 当前环境标记。

不做：

- 注册；
- 找回密码；
- 多 IdP 选择；
- 角色申请；
- 产品介绍。

### 页面二：任务列表

左侧或主区域显示：

- 新建任务；
- 任务标题；
- 当前状态；
- 最后更新时间；
- 使用的 Profile；
- 错误/待人工处理标识。

操作：

- 新建任务；
- 打开任务；
- 归档任务。

不做：

- 项目管理；
- KPI；
- 多维筛选；
- 批量操作；
- 复杂表格配置。

### 页面三：任务工作区

采用安静、工作型布局：

```text
左侧：任务/会话导航
中间：对话与 Draft
右侧抽屉：文件、引用、状态、校验结果
```

#### 顶部栏

- 任务标题；
- 固定 Expert Profile 名称；
- Runtime 状态；
- 更多菜单。

首期 Profile 只读展示，不提供随意切换。

#### 对话区

- 用户消息；
- Agent 消息；
- 引用来源；
- Tool/Job 状态；
- 错误及恢复操作；
- 输入框；
- 上传按钮；
- 发送/停止按钮。

#### 文件与来源

- 已上传文件；
- Resource Version；
- 解析状态；
- 是否满足生成条件；
- 删除/替换；
- 引用定位。

不显示服务器路径、对象存储 Key 或长期 URL。

#### Draft 结果

- Draft 内容；
- 输入版本摘要；
- 来源引用；
- 校验结果；
- “确认草稿”“驳回”“重新生成”“下载”。

确认只表示 PC 内部人工评审完成，不发布到外部系统。

## 4.2 前端状态

必须明确实现：

- Empty；
- Loading；
- Uploading；
- Runtime Starting；
- Streaming；
- Generating；
- Awaiting Review；
- Recovering；
- Partial Failure；
- Permission Denied；
- Session Expired；
- Completed。

错误必须可操作：

```text
重试
重新连接
重新上传
返回任务
查看失败原因
```

不能只显示通用 Toast。

## 4.3 前端技术建议

推荐：

```text
Vue 3
+ TypeScript
+ Vite
+ Vue Router
+ Pinia（仅保存客户端视图状态）
+ 轻量组件库
```

可以沿用团队熟悉的 Vue 技术栈，但不复制旧原型页面、状态对象、API Client 或样式。

设计要求：

- 首屏直接是任务产品，不做 Landing Page；
- 不使用大 Hero、装饰性卡片和营销布局；
- 页面以扫描、对话、文件和结果操作为中心；
- 桌面优先，同时保证 390px 无横向溢出；
- 无权限按钮不出现，但服务端仍必须拒绝直接调用；
- 流式内容不能推动工具栏和固定控件跳动。

## 5. MVP 后端范围

## 5.1 部署单元

首期建议四个进程/单元：

```text
Web
PC API / Control Plane
Runtime Host
DSH Process + PC Runtime Bridge Plugin
```

事件投影 Worker 首期可与 PC API 同部署，但保持独立模块边界。

## 5.2 必须实现的逻辑模块

| 模块 | MVP 范围 |
|---|---|
| M01 API/Application Facade | 登录后 API、任务、会话、文件、消息和 Draft |
| M02 Principal/Identity | 单一企业身份入口和 PCPrincipal |
| M03 Authorization | 登录用户、任务、Resource 和 Session 基础校验 |
| M04 Runtime Registry | 用户作用域 Runtime 最小状态机 |
| M05 Assignment/Lease | SessionAssignment、Generation、Lease、Fencing |
| M06 Expert Profile | 一个固定 ProfileRelease |
| M08 Capability Resolver | 生成最小 EffectiveProfileSnapshot |
| M09 Resource/Workspace | 上传、版本、Session View、Materialization |
| M10 Business Task | Task、Draft Job 和 Review 状态 |
| M13 Event Inbox/Projection | DSH Event 接入、去重和任务状态投影 |
| M15 Runtime Host | 启停、健康、Drain、Session create/resume |
| M16 Runtime Bridge | Session/Turn、Guard、Event Exporter |
| M19 Recovery | Runtime 断开后的最小恢复 |
| M20 Observability | 结构化日志、基础指标和 Trace ID |
| M21 Audit | 登录、任务、文件、Profile、生成和人工决定 |
| M22 Governance | Contract/Traceability/Compatibility CI |

其余模块只保留接口，不进入 MVP 主路径。

## 5.3 MVP Contract 子集

优先实现：

```text
C01 request-context
C03 authorization-snapshot
C06 runtime-record
C07 runtime-capability-manifest
C08 session-assignment-snapshot
C09 runtime-command
C10 runtime-command-result
C11 runtime-health-report
C12 expert-profile-release
C13 effective-profile-snapshot
C14 profile-resolution-report
C17 resource-ref
C18 workspace-view-snapshot
C19 materialization-request
C20 materialization-result
C25 event-envelope
C26 event-cursor
C27 business-task
C28 business-operation
C29 recovery-case
C31 adapter-error
C32 audit-entry
C33 compatibility-declaration
C34 traceability-entry
```

暂不实现主路径：

```text
C04-C05 Credential / Durable Approval
C15-C16 完整 Tool/Plugin Registry
C21-C24 企业写与 MCP
C30 外部 Reconciliation
C35-C42 企业角色、Policy Artifact 与 Legacy Compatibility
```

C35-C42 先做 Schema/fixture，后续单独授权 EE Claw 实现。

## 5.4 最小持久数据

MVP 需要持久化：

- Principal；
- BusinessTask；
- PC Session；
- RuntimeRecord；
- SessionAssignment；
- ExpertProfileRelease；
- EffectiveProfileSnapshot；
- Resource；
- ResourceVersion；
- WorkspaceViewSnapshot；
- Event Inbox；
- Projection Checkpoint；
- Draft/BusinessOperation；
- AuditEntry。

禁止把唯一业务真相放在：

- 浏览器；
- Runtime 内存；
- DSH Session Event 回调；
- 本地临时目录。

## 6. 推荐工程技术栈

以下是加速 MVP 的推荐，不属于 Accepted ADR：

```text
Monorepo: pnpm workspace
Language: TypeScript
Frontend: Vue 3 + Vite
API: Fastify modular monolith
Runtime Host: Node.js / TypeScript
Contract: JSON Schema + generated TypeScript types
Database: PostgreSQL
Blob: S3-compatible interface，开发期可用本地实现
Event/Job: PostgreSQL Inbox/Outbox + worker polling
Observability: OpenTelemetry
Testing: Vitest + Playwright + contract fixtures
```

选择理由：

- 与 DSH Node/TypeScript 生态接近；
- Contract 类型可以共享生成；
- 单一语言降低 MVP 团队切换成本；
- Fastify 足够轻量，不强迫过早服务拆分；
- PostgreSQL 可以同时承载权威数据、Inbox/Outbox 和最小 Job；
- 后续可把 Worker、Gateway 和 Resource Service 独立拆出。

这些选择应记录为 Implementation Decision，而不是新增 ADR。

## 7. 推荐仓库结构

```text
apps/
  web/
  api/
  runtime-host/

packages/
  contracts/
  domain/
  application/
  persistence/
  authorization/
  resource/
  runtime-adapter/
  dsh-bridge/
  event-projection/
  observability/
  testing/

profiles/
  process-copilot-runtime/

infra/
  dev/
  test/

architecture/
```

禁止：

- Web 直接引用 Persistence；
- API 业务模块直接引用 DSH 包；
- Bridge 直接连接 PC 数据库；
- 共享一个 `utils` 包承载无边界业务逻辑。

## 8. 开发批次

## M0：产品与工程冻结

交付：

- MVP Scope；
- Implementation Decision；
- Monorepo；
- C01-C42 Schema 骨架；
- CI、lint、test、Traceability；
- 本地开发环境。

验收：

- 一条命令启动 Web/API；
- Contract fixture 可运行；
- Forbidden dependency test 生效。

## M1：最小任务与前端骨架

交付：

- 登录；
- 任务列表；
- 创建/归档任务；
- 任务工作区静态结构；
- BusinessTask、PC Session、基础审计；
- API error model。

验收：

- 用户只能看到自己的任务；
- 刷新后任务仍存在；
- 空态、加载态和错误态完整。

## M2：Resource 与文件

交付：

- 文件上传；
- Resource/Version；
- Workspace View；
- 文件列表和解析状态；
- Materialization stub；
- 文件隔离测试。

验收：

- 两个用户不能读取对方 Resource；
- 文件路径不进入稳定 API；
- 替换文件产生新 Version。

## M3：Runtime Walking Skeleton

交付：

- Runtime Registry；
- SessionAssignment/Lease/Fencing；
- Runtime Host；
- DSH Profile/Bridge；
- Session create/resume/flush/cancel；
- Event Exporter/Inbox；
- 前端 Runtime/Streaming 状态。

验收：

- 完成一个无 Tool 写操作的连续对话；
- 旧 Fencing 命令被拒绝；
- Runtime 重启后可恢复 Session；
- 重复事件不重复推进状态。

## M4：SSTS Draft 纵向闭环

交付：

- 固定 FO ExpertProfileRelease；
- 输入齐套检查；
- Draft Generation Job；
- Draft Resource；
- 引用和 Validation Report；
- 人工确认/驳回；
- 下载。

验收：

- 缺少必需输入时 Fail Closed；
- 生成绑定精确 ResourceVersion 和 ProfileRelease；
- Draft 带 AI 标记和来源；
- 确认不会触发 EE Claw 发布。

## M5：恢复、隔离与试点准备

交付：

- Runtime 丢失恢复；
- Event gap 处理；
- Session 过期；
- 结构化日志、指标、Trace；
- Audit 查询；
- 两用户隔离矩阵；
- 试点部署和操作手册。

验收：

- API 重启不丢任务；
- Runtime 替换不丢 Draft/Review；
- 390px 和桌面视口无布局溢出；
- 关键 E2E、恢复和隔离测试通过。

## 9. 团队切分建议

假设 2-3 名工程师：

| 工作流 | 责任 |
|---|---|
| A：Control Plane | Contract、Task、Identity、Resource、Persistence、Event |
| B：Runtime | Runtime Host、DSH Profile、Bridge、Session、Recovery |
| C：Product | Vue 前端、Streaming、Files、Draft/Review、E2E |

共享门禁：

- Contract 先于消费者；
- 不复制类型定义；
- 每批提供 E2E；
- 每个变更引用 ADR/Module/Contract/Test；
- 不在活动 Session 中热换 Profile/Bridge。

## 10. 粗略工期

假设：

- 2-3 名熟悉 TypeScript 的工程师；
- DSH 基线可用；
- 一个模型供应商；
- 不接企业写和复杂审批；
- 不等待外部系统改造。

建议：

| 批次 | 粗略时间 |
|---|---:|
| M0 | 3-5 个工作日 |
| M1 | 5-7 个工作日 |
| M2 | 5-7 个工作日 |
| M3 | 8-12 个工作日 |
| M4 | 7-10 个工作日 |
| M5 | 5-8 个工作日 |

整体约：

```text
5-7 周
```

如果只有 1 名工程师，建议按 8-12 周估算，并继续保持批次退出条件。

## 11. MVP 发布门禁

产品：

- 用户可完成登录、建任务、上传、对话、生成 Draft、人工确认和下载；
- 页面无死路，所有错误有恢复动作；
- 不依赖旧原型。

架构：

- 用户作用域 Runtime；
- SessionAssignment/Lease/Fencing 生效；
- Profile Snapshot 固定；
- ResourceRef 不暴露路径；
- Event Inbox 幂等；
- 任务状态可恢复；
- 无企业写路径。

安全：

- 两用户任务、文件、Session、Runtime 不串用；
- 无长期 Secret 进入 Runtime；
- 前端隐藏不替代服务端拒绝；
- 上传和下载按当前用户授权；
- 日志不记录文件正文和 Token。

工程：

- 核心 Contract fixture 通过；
- E2E 通过；
- Runtime crash/recovery fixture 通过；
- Traceability 无缺失；
- Compatibility 声明固定 DSH commit；
- 有本地启动、部署、恢复和故障手册。

## 12. MVP 后续升级

MVP 验收后建议顺序：

1. EE Claw 只读 Resource/Project Adapter；
2. C35-C42 Enterprise Role/Policy Artifact Adapter；
3. Durable BusinessApproval；
4. Controlled Execution Gateway；
5. EE Claw Draft 发布与回读验证；
6. 多 Expert Profile；
7. Role Workbench Projection；
8. 多人协作和完整项目工作台。

## 13. 需要用户确认的产品选择

开始编码前只需确认三项：

1. 首个 MVP 是否采用 **FO SSTS Draft Assistant**；
2. 是否接受 **TypeScript + Vue 3 + Fastify + PostgreSQL** 推荐栈；
3. MVP 登录使用企业真实登录，还是先使用受控 Pilot Account。

其余细节可以在不改变 ADR 的前提下作为 Implementation Decision 推进。

