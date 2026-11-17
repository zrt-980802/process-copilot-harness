# DECOUPLING D3 Authority Router 验证

- 日期：2026-11-17
- 结论：`D3_COMPLETE`
- 性质：本地开发者验证，不代表生产发布或独立验收

## 已验证

- Authorization 不再遍历全部外部端口；
- PC-only action 对全部 Provider 保持零调用；
- EE action 只调用 `provider:eeclaw`；
- PC explicit Deny 在 Provider 调用前结束；
- missing Provider、unknown action、route ambiguity 全部 fail closed；
- EE business Deny 保持授权拒绝，不改变 Provider Health；
- 网络、超时、适配器认证和协议不兼容进入稳定故障分类；
- `UNAVAILABLE` 使用指数退避、single probe 和两次成功恢复滞回；
- Workbench 在 EE unavailable 时拒绝 Project/Catalog，个人 Runtime admission 继续；
- `/health` 同时表达 Core healthy 与 EE unavailable；
- C65 Capability Availability 不被当作执行授权；
- 前端 unavailable 不请求项目目录，提供受限重试并保留个人入口；
- D1 EE adapter、D2 Standalone、Gateway、Runtime、SSTS 与旧合同回归保持。

## 门禁结果

```text
pnpm check
Generated contract inventory: pass
Architecture / Traceability / Compatibility: pass (24 ADR / 65 Contract)
ESLint: pass
TypeScript / Vue typecheck: pass
Vitest: 38 files passed / 7 conditional skips
Tests: 233 passed / 8 conditional skips
All workspace builds: pass
```

## EE 不可达真实启动烟测

实际启动完整 EE-connected 本地配置，但把 EE Authorization、EE MCP 和 Runtime URL 指向三个未监听的 loopback 端口。所有 Product Store 使用内存实现，未连接共享数据库。

```text
API listen: http://127.0.0.1:18791
GET /health: HTTP 200
service status: ok
provider_mode: ee-connected
capabilities.core: configured
capabilities.personal_workbench: available
capabilities.ee_provider: unavailable
capabilities.project_workbench: unavailable
provider_health.provider_state: UNAVAILABLE
provider_health.compatibility_status: UNKNOWN
POST /v1/providers/eeclaw/retry: HTTP 503 PC_PROVIDER_UNAVAILABLE
```

烟测进程已停止。该烟测证明 API 启动和 Provider-local failure contract；个人对话在同一故障状态下的继续能力由 Workbench 定向测试验证。EE Session 本身仍依赖逐请求 EE validate，断网时不会绕过认证。

## 撤权与恢复

- PC Authorization Revision 变化后，旧 Snapshot 不能签发新的 Principal Envelope；
- Gateway 继续在 dispatch/reconcile 前重新执行当前授权；
- Provider 恢复只重建 Catalog/Workbench 装配，不恢复已撤销 Binding；
- Health recovery 从不产生 Authorization Allow；
- 未实现跨实例 Health 持久化或 mixed Approval Operation Resolver。

## 边界

- 未修改 EE 源码、EE schema、共享数据库、DSH Core、`.env`、既有端口或生产配置；
- 未连接 `192.168.31.95`；
- 未实施多 Provider 生产接入、生产 IAM 或 MEMORY-01B；
- 未 push 或远程部署。
