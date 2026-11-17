# EE Agent 与 MCP 全链路接入研究 v1

- 日期：2026-11-11
- 状态：Research / Proposed
- 目标：把当前 SSTS 最小验收页升级为连接 EE Agent、Process Copilot Runtime、
  Controlled Gateway、MCP、Approval、Event 与 Owner 工作台的全链路入口
- 实施授权：本研究不授权修改 EE Agent、数据库、环境变量、生产部署或远程仓库

## 1. 结论

应先建设 EE Agent 与 Process Copilot 的真实连接，再继续扩展当前前端。

正确边界不是让浏览器直接调用 EE 的大量 HTTP API，也不是把 EE 的 400 余条
Owner 路由逐条复制成 MCP Tool，而是：

```text
EE Agent 保持业务事实、Owner API、Capability Gateway 和 Workflow Runtime 权威
Process Copilot 保持 Principal、Task、Profile、Workspace、Approval、Operation 和 Recovery 权威
EE MCP Adapter 把受治理的 EE Capability / Scenario 投影为稳定 MCP 接口
PC Controlled Gateway 负责实时授权、凭据、审批、幂等、Fencing、审计和对账
PC Workbench 只调用 PC API，不直接持有 EE Cookie、长期凭据或 MCP 连接
```

建议在 DEV-10 之前插入一个独立主线：

```text
DEV-09A：EE Agent、MCP 与全链路 Workbench
```

DEV-09A 完成后再进入 DEV-10 的部署、安全和可观测性收口。

## 2. 已核对的现状

### 2.1 feishu-ee-agents

- 仓库：`E:/shanzi_workspace/feishu-ee-agents`
- 分支：`runtaozhang`
- HEAD：`5937cf6385119eb0955ccc0c88746b05c6678dc2`
- 工作树存在大量用户未跟踪的 Demo seed 文档、脚本和结果；本研究未修改。
- Flask 应用已注册约 400 条装饰器路由，覆盖项目、需求、Function、SSTS、
  法规、架构、诊断、安全、OTA、知识图谱、Agent Governance 和 Runtime。
- `backend/eea/**/tools.py` 中静态扫描到约 300 个 Tool schema 名称；
  Governance 文档记录约 200 个受治理 Capability / Tool。
- 已有 Capability Gateway、持久 Trace、Workflow Manifest、Scenario Package、
  Runtime Run、SSE Event、Resume/Cancel、Process View 和 Agent Workbench。
- 已有平台账号、Cookie Session、RBAC、CSRF、访问审计及 Process Copilot
  内部授权适配器。
- 现有 Draw.io MCP Server 是独立的本地 stdio 图编辑工具，不是 EE 业务 MCP
  Server，不能作为 PC 与 EE 的业务集成层。

### 2.2 Process Copilot

- DEV-05 已实现 EE Claw C41/C42 只读授权适配：
  `HttpEeClawAuthorizationAdapter`。
- EE 端已有：
  - `GET /api/internal/process-copilot/v1/compatibility`
  - `POST /api/internal/process-copilot/v1/authorization/decide`
- DEV-07 已实现 Connector、External Account、Credential Lease、MCP Binding、
  Durable Approval、Operation Ledger、Outcome Unknown 和 Reconciliation。
- 当前 `GatewayProviderPort` 的运行实现仍是
  `DeterministicGatewayProvider`。
- 当前 API 只接受 `PC_GATEWAY_PROVIDER=deterministic`。
- 当前产品未依赖 MCP SDK，也没有真实 Streamable HTTP MCP Client。
- 当前验收 Compose 没有 Runtime Host、MCP Gateway、EE Adapter 或 EE 服务。
- 当前前端只覆盖 SSTS Workspace，不具备项目切换、Capability Catalog、
  Scenario、Run、Trace、Approval、Tool Call、Evidence 和 Owner Deep Link。

### 2.3 当前真正可复用的能力

```text
EE Agent
  Owner 数据与 Owner API
  Capability Catalog
  Capability Gateway
  Workflow / Scenario Runtime
  Agent Workbench
  Runtime Event / Process View / Trace
  平台账号与授权

Process Copilot
  Principal / Identity Link
  Authorization Snapshot
  Profile / Tool Release
  Resource / Workspace / Materialization
  Runtime Registry / Assignment / Lease / Fencing
  Controlled Gateway
  Approval / Operation Ledger / Recovery
  Business Task / Event Projection
```

缺少的是两边之间的真实协议实现和产品编排，不是重新建设上述能力。

## 3. 目标服务拓扑

```text
Browser
  |
  v
PC Workbench Web
  |
  v
PC API / BFF
  |-- Principal / Task / Profile / Resource / Approval / Event
  |
  v
PC Runtime Host / DSH Adapter
  |
  v
PC MCP Tool Provider
  |
  v
PC Controlled Gateway / Credential Broker
  |
  | short-lived Principal Envelope
  | exact Tool Release + schema digest
  | Assignment / Lease / Fencing
  | Approval / idempotency / operation_id
  v
EE MCP Adapter Server
  |
  |-- EE Capability Gateway
  |-- EE Runtime Entry / Scenario Registry
  |-- EE Owner read APIs
  |-- EE Owner confirmed write APIs
  v
EE MySQL / Neo4j / Feishu / Model Provider
```

### 3.1 浏览器边界

浏览器只调用 PC API。禁止：

- 浏览器直接连接 MCP Server；
- 浏览器持有 `X-PC-Adapter-Secret`；
- 浏览器透传 EE Session Cookie 给 Runtime；
- 浏览器构造可信 `account_id`、Principal Envelope、Approval 或 Fencing；
- 浏览器直接调用 EE Owner 写接口绕过 PC Gateway。

### 3.2 EE MCP Adapter 的位置

EE MCP Adapter 应属于 `feishu-ee-agents` 仓库中的独立应用/服务，而不是放在
某个 M1-M10 Owner 模块中。它只负责协议投影和调用治理，不成为第二业务权威。

建议目录边界：

```text
apps/process-copilot-mcp-adapter/
```

该服务读取 EE Governance Catalog，并调用现有 Capability Gateway、Runtime Entry
和 Owner Service。新增此服务属于跨模块共享集成，必须走 EE 仓库的
`docs/tasks/integration-requests/INT-*.md` 流程。

## 4. MCP 接口设计原则

### 4.1 不把全部 REST 路由机械转换为 Tool

EE 当前 HTTP 路由数量很大，直接一对一暴露会导致：

- Tool Catalog 过大；
- Profile 和模型上下文膨胀；
- 相同业务动作出现多套入口；
- 写操作绕过 Workflow、Approval 和 Owner 状态机；
- API 路径变化直接破坏模型合同。

MCP 应投影稳定的业务任务、Capability 和 Scenario，而不是数据库 CRUD。

### 4.2 首批接口分组

#### A. Catalog 与上下文

```text
ee.list_projects
ee.get_project_context
ee.list_capabilities
ee.get_capability_schema
ee.list_scenarios
ee.get_scenario
```

#### B. 全链路只读事实

```text
ee.list_requirements
ee.get_requirement
ee.get_requirement_trace

ee.list_functions
ee.get_function
ee.get_function_tree
ee.get_function_trace

ee.list_ssts
ee.get_ssts
ee.get_ssts_sections
ee.get_ssts_quality
ee.get_ssts_trace

ee.get_project_regulations
ee.get_project_signals
ee.get_project_architecture
ee.get_project_diagnostics
ee.get_project_safety
ee.get_project_ota
ee.query_knowledge_graph
```

#### C. Runtime 与 Workflow

```text
ee.start_scenario
ee.get_run
ee.list_run_events
ee.get_process_view
ee.cancel_run
ee.resume_run
ee.retry_run
ee.get_trace
```

#### D. SSTS 纵向闭环

```text
ee.check_ssts_readiness
ee.start_ssts_generation
ee.get_ssts_generation
ee.get_ssts_generation_trace
ee.cancel_ssts_generation
ee.get_ssts_candidate
```

#### E. 受控写入

写入不能在第一批全部开放。只允许已经满足以下条件的 Capability：

```text
Owner 状态机已定义
Tool Release 已发布
输入 Schema 已冻结
风险等级与恢复分类已声明
Approval Policy 已声明
operation_id / idempotency_key 已支持
回读或对账接口已存在
EE 最终权限校验已存在
```

候选接口：

```text
ee.apply_candidate
ee.submit_review
ee.publish_artifact
ee.update_owner_record
```

这些名称表示稳定意图，不直接映射任意 Owner CRUD。

### 4.3 MCP Resources

大型只读正文和证据不应全部放入 Tool 结果。建议使用资源 URI：

```text
eea://projects/{project_code}
eea://requirements/{requirement_code}
eea://functions/{function_code}
eea://ssts/{ssts_code}
eea://ssts/{ssts_code}/sections/{section_number}
eea://runtime/runs/{run_id}/process-view
eea://traces/{trace_id}
```

Tool 返回受控摘要、版本、hash、定位和 Resource URI；PC Resource 层再决定是否
复制为 ResourceVersion 或保持外部引用。

### 4.4 MCP Prompts

Prompt 只用于提供受版本控制的 Scenario 使用指导，不携带权限或 Secret：

```text
eea.project_review
eea.ssts_generation
eea.change_impact
eea.release_readiness
```

真实可执行范围仍由 Profile、Workflow allowlist 和 Gateway 决定。

## 5. 身份、授权与凭据流

### 5.1 已有最小连接

当前 Pilot 模式可以通过：

```text
PC Principal
  -> verified ExternalIdentityLink(eeclaw account_id)
  -> EE internal authorization/decide
```

完成 EE 页面级权限的实时只读判断。

当前缺口：

- Project Scope 在 EE Adapter 中仍 fail closed；
- Pilot 账号与 EE Account 的绑定依赖部署配置；
- 没有正式登录联邦或一次性 Launch Ticket；
- 没有 EE MCP Credential Issuer；
- 没有真实 MCP Provider。

### 5.2 阶段性 Demo 身份方案

第一阶段保留 PC Pilot 登录，但必须使用已验证的 EE Account Binding。PC 只保存
外部账号引用，不保存 EE 密码或 Cookie。

```text
Pilot sign-in
  -> PCPrincipal
  -> verified EE Account Binding
  -> PC Authorization Snapshot
  -> per-call EE authorization decision
```

### 5.3 正式入口方案

后续改为同域 EE Launch Ticket：

```text
用户已登录 EE
  -> EE 生成短 TTL、单次使用 Launch Ticket
  -> PC Backend 兑换 Ticket
  -> 创建/确认 ExternalIdentityLink
  -> PC 签发自己的 Session
```

禁止把 EE Cookie 或 PC Token作为 MCP 下游凭据。

### 5.4 MCP 调用

```text
PC Runtime
  -> Principal Envelope
  -> Controlled Gateway 实时校验
  -> 短期 Credential Lease
  -> EE MCP Adapter
  -> EE 再次校验 Account / Project / Action
  -> Capability Gateway / Runtime / Owner Service
```

PC Allow 不能强迫 EE Allow。

## 6. MCP 协议兼容策略

实现必须固定并协商 MCP Protocol Version，首批优先 Streamable HTTP。

当前 PC 的 `McpSessionBinding` 继续作为安全绑定、审计和缓存隔离记录，但不能把
协议 Session ID 当作身份或业务状态。实现应允许：

```text
protocol_session_id = absent
```

并以每请求 Authorization、Principal Envelope、operation_id、idempotency_key 和
PC Operation Ledger 为权威。

原因：公开 MCP 规范正在从有状态协议 Session 向更无状态的 Streamable HTTP 演进。
因此首批不能把安全模型绑定到 `Mcp-Session-Id` 是否存在。

## 7. 前端应如何重构

当前 SSTS 页面应保留为一个业务视图，但不再是整个应用。

目标 Workbench 至少包含：

```text
应用外壳
  - 当前用户 / EE Identity Link
  - Tenant / Project / Task
  - Profile / Effective Tool Set
  - Connector 与服务健康

任务与会话
  - Business Task
  - PC Session
  - 消息
  - Runtime Assignment / Run

执行
  - Scenario / Workflow
  - Agent / Capability / Tool Call
  - MCP Call 状态
  - Streaming Event / Process View
  - Cancel / Resume / Retry

证据
  - Resource / ResourceVersion
  - EE Resource URI
  - Citation / Validation
  - Trace / Audit / Operation Ledger

人工控制
  - Input Required
  - Approval
  - Candidate Review
  - Accept / Reject / Publish

业务视图
  - Requirement
  - Function
  - SSTS / CTS
  - Architecture / Signal
  - Diagnostic / Safety / OTA
  - Knowledge Graph
```

前端不维护 Tool 白名单。菜单、Scenario、Tool 和输入表单应消费 Catalog、Profile
和 Schema 投影。

## 8. 本地启动拓扑

阶段性本地 Demo 建议使用一个新的独立 Compose，不修改现有端口和版本：

```text
pc-web
pc-api
pc-runtime-host
pc-postgres
pc-mcp-gateway
ee-mcp-adapter
ee-app
ee-mysql
ee-neo4j (仅需要 KG 时)
```

宿主机只发布一个 Loopback Web 入口。API、Runtime、Gateway、MCP、MySQL 和
Neo4j 全部只在 Docker 网络中可见。

不连接共享 EE MySQL，不修改 UAT/生产，不复用生产 Secret。

## 9. 建议开发拆分

### DEV-09A-1：连接与身份基线

- 启用现有 C41/C42 Adapter；
- 建立已验证 EE Account Binding；
- 增加 Connector Health 和 Compatibility 投影；
- 完成页面级与项目级授权决策；
- 不接 MCP，不做业务写入。

验收：PC 能列出当前 EE 用户可访问项目，并在撤权后立即拒绝。

### DEV-09A-2：EE MCP Adapter Server

- 新建独立 EE MCP Adapter；
- 从 Governance Catalog 投影首批只读 Tool；
- 提供 Resources、Tool Schema、Health 和 Capability Digest；
- 调用现有 Capability Gateway / Runtime / Owner Service；
- 不修改 M1-M10 业务权威。

验收：真实 `tools/list` 和首批只读 `tools/call` 返回 EE 数据、版本和 Trace。

### DEV-09A-3：PC 真实 MCP Provider

- 使用正式 MCP SDK 实现 `GatewayProviderPort`；
- 支持 Streamable HTTP、Protocol Version、deadline、cancel 和错误分类；
- Connector Registration 与 Tool Release 由 EE Catalog 生成；
- 替换 `DeterministicGatewayProvider`；
- 保留确定性 Provider 仅用于单元测试。

验收：PC Gateway 经真实 MCP 调用 EE，只读结果进入 Operation Ledger 和 Event。

### DEV-09A-4：Runtime Tool Provider

- DSH AgentPreset 注入当前 Effective Tool Set；
- Tool Call 转为 Principal Envelope；
- 绑定 Assignment、Lease、Fencing、Profile、Workspace 和授权版本；
- 支持 Event、Cancel、Resume 和 Runtime 替换。

验收：真实模型通过 MCP 查询 EE Requirement、Function、SSTS 和 Trace。

### DEV-09A-5：全链路 Workbench

- 把当前 SSTS 页面改为可组合业务视图；
- 增加 Project、Task、Session、Run、Tool、Evidence、Approval 和 Trace；
- Catalog/Schema 驱动菜单、表单和 Tool Call 卡片；
- 保留 Owner Deep Link，不复制 EE 复杂编辑器。

验收：一个页面可观察从用户目标到 EE Owner 事实、MCP Tool、Runtime 和结果证据。

### DEV-09A-6：Runtime-backed SSTS

- 当前 SSTS Draft Engine 改为可配置 Provider；
- 走 Assignment、Materialization、`START_TURN`、MCP、Event 和 Artifact；
- Draft 绑定真实 EE Project / Function / ResourceVersion / Profile；
- 人工接受仍不自动发布 EE 正式基线。

验收：真实模型生成 SSTS Draft，引用 EE Owner 事实，可驳回、重跑、恢复和下载。

### DEV-09A-7：受控写入与审批

- 只开放经过风险、Approval、幂等和回读分类的写 Tool；
- EE 最终业务权限和 Owner 状态机再次校验；
- Unknown Outcome 必须进入 Reconciliation；
- 发布与普通 Draft 接受分离。

验收：高风险写入没有 Approval 时拒绝，批准后执行且可回读对账。

## 10. Demo 最小顺序

第一轮全链路 Demo 不需要等待 DEV-10 全部完成，最小顺序是：

```text
DEV-09A-1
  -> DEV-09A-2 首批只读 Tool
  -> DEV-09A-3 真实 MCP Provider
  -> DEV-09A-5 Workbench 观察面
  -> DEV-09A-6 Runtime-backed SSTS
```

DEV-09A-4 可与 Workbench 后半段并行，但必须在真实模型 Tool Call 演示前完成。
DEV-09A-7 不阻塞只读全链路 Demo。

## 11. 当前阻塞项

### 阻塞真实 MCP 调用

1. EE 没有统一业务 MCP Adapter Server；
2. PC 只有 Deterministic Gateway Provider；
3. PC 未安装和实现正式 MCP SDK Client；
4. Acceptance Compose 没有 Runtime/MCP/EE 服务。

### 阻塞项目级全链路

1. EE Project Grant Authority 尚未向 PC Adapter 提供；
2. 当前 C41 对项目 scope 固定 fail closed；
3. Pilot 到 EE Account Binding 仍是配置式，不是用户登录联邦；
4. Tool Release 与 EE Capability Catalog 尚未自动同步。

### 阻塞企业写 Demo

1. 首批 EE Tool 尚未逐项声明风险和恢复分类；
2. EE 写接口的幂等、回读和对账能力未统一；
3. PC Approval 尚未与 EE Owner 状态机联调；
4. 不能证明撤权后 Stateful/Legacy 调用全部失效。

## 12. 不应做的事情

- 不把 EE 的 400 余条 HTTP 路由全部转成 MCP Tool；
- 不让 PC 前端直接调用 EE 写 API；
- 不把 EE Cookie、密码或长期 Token 交给 Runtime；
- 不把 `account_id`、`open_id` 或用户名直接当 PC Principal；
- 不让模型选择任意未进入 Profile/Workflow allowlist 的 Tool；
- 不以 Tool Discovery 过滤代替执行时授权；
- 不把 Timeout/Cancel 当作外部写操作未发生；
- 不在当前有大量未跟踪文件的 EE 工作树中直接开始跨模块修改；
- 不在本地接入共享 UAT/生产数据库作为开发验证环境。

## 13. 最终判断

用户提出的方向成立，而且优先级应高于完整 DEV-10。

当前最合理的产品路线是：

```text
先完成 EE Agent + MCP + Workbench 的只读全链路
再完成 Runtime-backed SSTS
再开放少量受控写入
最后进入 DEV-10 / DEV-11 / DEV-12 收口
```

现有 SSTS 最小前端不应继续扩展为更多固定业务按钮。它应被重构为 Catalog、
Scenario、Task、Run、Tool、Evidence 和 Approval 驱动的 Process Copilot
Workbench，SSTS 只是其中一个纵向业务视图。
