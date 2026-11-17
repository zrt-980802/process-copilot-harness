# PC Core / 外部 Provider 解耦 D1 Port 拆分 v1

- 状态：Complete
- 日期：2026-11-17
- 依据：ADR-0024、C61-C65、D0 调用清单
- 范围：行为保持的 Port 拆分；EE 仍是唯一已配置外部 Provider

## 1. 结果

D1 将当前 EE-connected 实现拆成五类明确 Port，并把 API/Workbench 的依赖改为 Port。没有引入 Authority Router、Standalone 启动、Provider Health 降级或多 Provider 行为。

| Port | 所有者 | 当前 EE 实现 | 当前消费者 |
| --- | --- | --- | --- |
| `IdentityProviderPort` | Application | `EeLogin` | API Server、Session Validator |
| `EnterpriseAuthorizationPort` | Application | `HttpEeClawAuthorizationAdapter` | `IdentityAuthorizationService` 既有外部授权交集 |
| `ProjectDirectoryPort` | Application | `EeClawProjectDirectoryAdapter` | `RuntimeWorkbench` |
| `BusinessCapabilityProviderPort` | Gateway | `EeMcpGatewayProvider` | Catalog 同步、Controlled Gateway |
| `WorkbenchProjectionPort` | Application | `EeClawWorkbenchProjectionAdapter` | `RuntimeWorkbench.capabilityChain` |

## 2. 依赖变化

```text
ApiServer -> IdentityProviderPort
RuntimeWorkbench -> ProjectDirectoryPort + WorkbenchProjectionPort
Catalog Synchronizer -> BusinessCapabilityProviderPort
IdentityAuthorizationService -> existing ExternalAuthorizationPort behavior

EE adapters implement the ports
main.ts only assembles the selected EE implementations
```

项目目录的 `/projects/accessible` HTTP 逻辑已从 `main.ts` 移入 `EeClawProjectDirectoryAdapter`。EE scope、Tool Set 和 trace projection 已从 Workbench 核心逻辑移入 `EeClawWorkbenchProjectionAdapter`。

## 3. 行为保持

D1 冻结并验证：

- EE login exchange/validate 路径、请求体、PC Session 建立和 bindings 响应字段不变；
- C41/C42 授权请求、项目 operation 映射和 fail-closed 语义不变；
- accessible-projects 的 URL、secret header、permission key、operation 和 digest 校验不变；
- EE MCP Catalog、Tool Release、dispatch、readback 和 reconciliation 不变；
- Workbench scope source、Tool Set、operation trace refs 和项目撤权拒绝不变；
- `PC_LOGIN_MODE=ee`、Gateway 配置要求和启动失败语义不变。

## 4. 明确未完成

1. `IdentityAuthorizationService` 仍遍历全局 External Authorization Port；D3 才替换为 Authority Router；
2. EE Compatibility/Catalog 失败仍可能阻止当前 EE-connected API 启动；
3. 没有 EE 时个人 Workbench 尚未独立装配；
4. Pilot login 尚未正式实现为非 EE `IdentityProviderPort`；
5. Capability Availability/Provider Health 目前只有 Contract，没有运行时状态；
6. EE Provider Bundle 的正式注册、版本和健康收口属于 D4；
7. D1 不能宣称 Standalone、Provider-local degradation 或 multi-provider 已实现。

## 5. D1 准出

- [x] 五类 Port 均有稳定 TypeScript 边界；
- [x] EE 实现显式实现对应 Port；
- [x] Server/Workbench/Catalog 同步消费 Port；
- [x] `main.ts` 不再内嵌项目目录 HTTP 调用；
- [x] Golden tests 覆盖登录、授权、目录、MCP 和投影；
- [x] 项目成员撤销仍在 Runtime 分配前拒绝；
- [x] 全量 `pnpm check` 通过；
- [x] D1 完成后停止，D2 未自动执行。
