# PC Core / 外部 Provider 解耦 D2 Standalone v1

- 状态：Complete
- 日期：2026-11-17
- 依据：ADR-0024、C61-C65、D0 调用清单、D1 Port 拆分
- 范围：PC Core Standalone、本地开发身份、个人 Workbench、最小 Capability Availability

## 1. 结果

D2 将 PC Core 启动与 EE Provider 装配分开。完全不提供 EE 配置时，API 可以使用受控本地身份和个人对话；EE-connected 保持原登录、项目目录、Catalog、MCP、审批和外部授权交集语义。

| 能力 | Standalone | EE-connected |
| --- | --- | --- |
| 登录 | `LocalIdentityProvider`，仅受控本地/开发账号 | `EeLogin` 票据交换与逐请求校验 |
| 个人对话 | 可用；`user:{principal_id}`；空外部 Tool Set | 可用；行为保持 |
| 项目目录与 SSTS | 明确不可用 | EE Project Directory 与 Workbench Projection |
| EE Tool / MCP | 不装配，不创建绑定或凭据 | 行为保持 |
| 外部授权调用 | 个人 `conversation.run` 为零 | EE action 继续 PC Allow 与 EE Allow 取交集 |

## 2. 启动配置

`provider-bootstrap.ts` 将配置严格分成两类：

1. EE Login、Authorization、MCP 和 Gateway 全部缺失：`standalone`；
2. 上述配置全部存在：`ee-connected`。

任何部分配置都在网络调用前稳定失败，不生成半配置能力。D2 不处理“已完整配置但运行中断”的 provider-local degradation；该能力留给 D3。

## 3. 身份与 Session

- `LocalIdentityProvider` 只接受 `local_credentials`，调用 PC 自有 `signInPilot`；
- 本地 Provider 不创建 External Identity Link、EE account binding 或企业权限；
- EE Session Validator 只校验 `ee:` authentication context；
- 本地 Session 不经过 EE `/login/validate`；
- 前端根据 `/health.provider_mode` 选择本地登录或 EE 统一登录。

本地 Provider 是开发和受控本地环境能力，不是生产 IAM。

## 4. 授权边界

D2 引入最小 Core Authority 分类：只有同时满足以下条件的请求是 `PC_ONLY`：

- action 为 `conversation.run`；
- scope 精确为当前 Principal 的 `user:{principal_id}`；
- Tool Set 为空。

该路径只执行 PC 显式 Deny 与 active-principal policy，不遍历 `EnterpriseAuthorizationPort`。未知 action、项目 scope、混合 scope 或任何 Tool 请求都不进入此短路。

## 5. Workbench 边界

个人 Workbench 的 Core 依赖是 Identity、Profile、Runtime Registry、Resource、Event、SSTS 与 Runtime。Gateway、Gateway Repository、Connector、Project Directory 和 Workbench Projection 只在项目路径读取。

个人会话的 Principal Envelope：

- audience 为 `runtime:personal-conversation`；
- allowed action 只有 `conversation.run`；
- resource scope 为当前用户；
- Tool Set 为空；
- 不含 EE credential generation；
- 自动上下文资源使用 PC-owned 的 `Personal conversation context.json`，不标记为 EE project binding。

Runtime 只有在 Tool Set 非空时才必须声明 `pc-controlled-gateway`。无 EE 时创建项目/SSTS、读取 Catalog 或执行 Tool 会明确拒绝，不自动扩大权限。

## 6. Capability Availability

`/health` 新增：

- `provider_mode`；
- `capabilities.core`；
- `capabilities.personal_workbench`；
- `capabilities.ee_provider`；
- `capabilities.project_workbench`。

这些字段只表达装配可用性，不是 Authorization Decision。前端在 Standalone 下不请求 EE 登录、项目目录、Catalog、Capability Chain 或审批列表。

## 7. 明确未完成

1. 完整 Authority Router 与多 Provider 歧义处理；
2. EE 已配置但运行中断时的 provider-local degradation；
3. Provider Health 状态机、探针和恢复滞回；
4. EE Provider Bundle 的版本与注册收口；
5. 生产 IdP、生产部署与发布资格；
6. MEMORY-01B。

## 8. 准出

- [x] Standalone 本地登录与 `/v1/identity/me`；
- [x] 个人 CHAT 使用空外部 Tool Set；
- [x] PC-only 授权零 EE 判权调用；
- [x] Standalone 无 EE Project/Tool 装配；
- [x] 部分 EE 配置 fail closed；
- [x] EE D1 golden tests 保持；
- [x] 全量 `pnpm check` 通过；
- [x] D2 完成后停止，D3 未实施。
