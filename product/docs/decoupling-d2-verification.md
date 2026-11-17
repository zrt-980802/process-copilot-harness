# DECOUPLING D2 Standalone 验证

- 日期：2026-11-17
- 结论：`D2_COMPLETE`
- 性质：本地开发者验证，不代表生产发布或独立验收

## 已验证

- 空 EE 配置被分类为 Standalone，完整配置被分类为 EE-connected；
- 任意部分 EE Login / Authorization / MCP / Gateway 配置在装配前失败；
- `LocalIdentityProvider` 只接受本地凭据并建立 PC Session；
- EE Provider 不校验本地 authentication context；
- Standalone `/health` 暴露 Core、个人 Workbench、EE Provider 和项目 Workbench 状态；
- 个人 Workbench 在无 Gateway、Connector、Project Directory 和 Workbench Projection 时完成准入；
- 个人 Effective Tool Set 为空，Runtime 不要求 `pc-controlled-gateway`；
- 项目 Catalog 在无 Provider 时返回明确拒绝；
- 个人 `conversation.run` 对注册的 External Authorization Port 调用次数为零；
- EE 登录、授权交集、目录、Catalog、MCP 与投影 golden behavior 保持。

## 门禁结果

```text
pnpm check
Generated contract inventory: pass
Architecture / Traceability / Compatibility: pass (24 ADR / 65 Contract)
ESLint: pass
TypeScript / Vue typecheck: pass
Vitest: 37 files passed / 7 conditional skips
Tests: 224 passed / 8 conditional skips
All workspace builds: pass
```

## 真实启动烟测

使用内存 Identity/Profile/Resource/Registry/Event/SSTS、`PC_GATEWAY_STORE=disabled`、`PC_LOGIN_MODE=local`，并且不设置任何 EE URL 或 Secret 启动实际 API 进程：

```text
provider_mode: standalone
capabilities.core: configured
capabilities.personal_workbench: available
capabilities.ee_provider: unconfigured
local sign-in + /v1/identity/me: pass
personal CHAT create: HTTP 201, no project, personal profile
/v1/workbench/projects: HTTP 200, empty
project Catalog: PC_WORKBENCH_PROJECT_PROVIDER_UNAVAILABLE
```

烟测进程在验证后已关闭；未连接 EE 或 Runtime 服务，未保留数据库或 Runtime 状态。

## 边界

- 未修改 EE 源码、EE schema、共享数据库、DSH Core、端口或生产配置；
- 未连接 192.168.31.95；
- 未实现 D3 Authority Router、Provider Health 降级或多 Provider；
- 未实施 MEMORY-01B；
- 未 push 或远程部署。
