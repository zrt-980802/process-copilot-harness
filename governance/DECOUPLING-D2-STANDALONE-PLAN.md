# DECOUPLING D2：PC Core Standalone 详细执行计划

- 状态：Complete（2026-11-17）
- 前置：D0、D1 Complete
- 目标：无 EE 配置时，PC Core 可启动并提供本地身份、个人对话、个人任务/记忆和非 EE 能力；EE-connected 现有行为保持
- 非目标：完整 Authority Router、Provider Health UI、多 Provider、EE Provider Bundle 收口、MEMORY-01B

## 1. 配置与验收矩阵

| 模式 | EE Login | EE Authorization | EE MCP | 预期 |
| --- | --- | --- | --- | --- |
| Standalone | 无 | 无 | 无 | API/Core 正常启动；只出现 PC 能力 |
| EE-connected | 有 | 有 | 有 | 当前演示账号、项目、Tool 与审批语义不变 |
| EE 配置不完整 | 部分 | 部分 | 部分 | 不产生半配置能力；稳定报配置错误或明确禁用 Provider，不扩大权限 |
| EE 运行中断 | 已配置但不可达 | 已配置但不可达 | 已配置但不可达 | D2 至少保证新启动的 PC-only 路径不依赖 EE；完整 provider-local degradation 留 D3 |

## 2. 工作包与顺序

### D2-0：冻结双模式基线

文件范围：`apps/api/tests`、部署/启动测试、D1 golden tests。

任务：

- 增加 Standalone 与 EE-connected 配置矩阵测试；
- 记录启动期间所有 EE 网络调用，断言 Standalone 为零；
- 保留现有 EE login、项目目录、授权、MCP golden tests；
- 冻结 `/health`、`/v1/identity/me` 和个人对话最小响应。

准出：测试先失败且能准确指出当前 EE 启动耦合，不修改业务实现。

### D2-1：正式化本地 Identity Provider

主要文件：

- `packages/application/src/external-provider.ts`
- `apps/api/src/server.ts`
- 新增 `apps/api/src/local-identity-provider.ts`
- `apps/api/src/main.ts`

任务：

- 将现有受控 Pilot 登录封装为 `IdentityProviderPort` 的本地实现；
- 保留现有 `/v1/pilot/sign-in` 请求和返回合同；
- 建立按配置选择 Provider 的最小注册表，不按用户名/邮箱自动合并 Principal；
- PC Session 继续由 `IdentityAuthorizationService` 签发；
- EE Session validator 只绑定 EE 建立的 authentication context。

准出：本地 Provider 可登录；EE Provider 登录行为不变；一个 Provider 的 Session 不被另一个 Provider 校验。

### D2-2：拆开 Core 与 EE 启动装配

主要文件：`apps/api/src/main.ts`，必要时新增 `provider-bootstrap.ts`。

任务：

- 先构造 PC Core 服务，再条件装配 EE Ports；
- 未配置 EE 时不创建 EE Authorization、Directory、MCP 或 Projection；
- 移出“Gateway 启用即必须存在 EE”的全局假设；
- 不吞掉半配置或格式错误，避免误以为 Provider 可用；
- 保持 EE-connected 当前初始化顺序和兼容校验。

准出：完全无 EE 环境变量时 API/Core 启动；完整 EE 配置仍通过 golden tests；半配置 fail closed。

### D2-3：PC-only 授权短路

主要文件：`packages/application/src/identity-authorization.ts`，新增 Core Authority 分类器及测试。

任务：

- 只对受信且明确的 PC action/resource 采用 `PC_ONLY`；
- 首批至少覆盖个人 `conversation.run`，并盘点实际已实现的 Task/Memory action；
- PC-only 请求不得调用任何 `EnterpriseAuthorizationPort`；
- 未知、混合、项目或 EE namespace 继续 fail closed 或沿用 EE 路径；
- 不在 D2 实现通用 multi-provider Router。

准出：调用计数证明 PC-only 为零 EE 判权；EE action 仍执行 PC Allow 与 EE Allow 的交集。

### D2-4：独立个人 Workbench 装配

主要文件：`apps/api/src/workbench.ts`、`main.ts`、Profile 装配。

任务：

- 将个人 CHAT 路径与 Project Workbench 外部依赖分离；
- 把 `profile:conversation:personal:1` 发布移出 EE MCP Catalog 分支；
- 个人对话允许空 Connector、空外部 Tool Set 和 PC-owned user scope；
- Project/SSTS 路径仍要求 Project Directory、Business Capability 和 EE 授权；
- Runtime Principal Envelope 不包含 EE action、project scope 或 EE credential lease。

准出：Standalone 个人对话可创建并运行；Project/SSTS 在无 EE 时明确不可用；不自动授予企业 Tool。

### D2-5：Capability 暴露与前端最小兼容

主要文件：`apps/api/src/server.ts`、`apps/web/src/api.ts`、相关类型与页面。

任务：

- `/health` 或 capabilities 输出区分 Core 与 EE Provider 是否配置；
- Standalone 不显示 EE Project/Tool 入口；
- 不伪造 EE unavailable 为 available；
- 本轮只做最小状态兼容，不建设 D3 Provider Health 视图。

准出：前端不会请求不存在的 EE 项目目录；个人对话入口可用；EE-connected 页面不回归。

### D2-6：安全与回归验收

测试至少覆盖：

1. 无 EE 环境变量启动；
2. Standalone 登录、identity/me、个人 CHAT；
3. Standalone 全流程 EE HTTP/MCP 调用次数为零；
4. Standalone Effective Tool Set 不包含 `ee.*`；
5. EE action 在无 Provider 时拒绝；
6. EE-connected 登录、目录、Catalog、读 Tool、审批写保持；
7. PC Deny 仍覆盖 EE Allow；
8. EE Deny 仍覆盖 PC Allow；
9. 重启后两种模式行为一致；
10. 全量 `pnpm check` 通过。

## 3. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 把现有 Pilot 测试账号误当生产 IAM | 明确仅为受控 Local/Development Provider；生产 IdP 不在 D2 |
| 个人 Workbench 复用 EE Connector 导致隐式凭据 | 个人 Profile Tool Set 为空；不创建 ExternalAccountBinding/Credential Lease |
| PC-only allowlist 过宽 | 只纳入有 owner、scope 和测试证据的 action；未知 action 拒绝 |
| 可选 EE 配置掩盖配置错误 | 区分“完全未配置”和“部分配置”；部分配置稳定失败或禁用并给出原因 |
| D2 越界提前实现 D3 Router | 仅实现单一 PC Core 短路；多 Provider、歧义路由和健康降级留 D3 |

## 4. 停止条件

出现以下任一情况时停止 D2，不继续扩大修改：

- 需要修改 EE schema、共享数据库或 DSH Core；
- 需要把 EE 权限复制为 PC 权威；
- 个人对话必须获得 EE Credential 才能运行；
- 无法在不改变 EE-connected 对外合同的前提下拆分；
- 测试无法证明 Standalone 零 EE 网络调用。

## 5. D2 完成定义

D2 只有在 Standalone 与 EE-connected 两套配置矩阵均通过，并且安全断言证明 PC-only 不触发 EE、无 EE Tool 自动授权时才能标记 Complete。D2 通过不代表 Provider outage 降级、多 Provider Router 或生产就绪；这些分别属于 D3-D5。

完成证据：`architecture/external-provider-decoupling-d2-standalone-v1.md`、`product/docs/decoupling-d2-verification.md`。D3 仅形成 `governance/DECOUPLING-D3-AUTHORITY-ROUTER-PLAN.md`，尚未实施。
