# PC Core / 外部 Provider 解耦 D3 Authority Router v1

- 状态：Complete
- 日期：2026-11-17
- 依据：ADR-0024、C62、C63、C65、D0 路由表、D1 Port、D2 Standalone
- 范围：唯一授权路由、Provider Health、EE 局部降级、Capability Availability 与受限恢复

## 1. 结果

D3 删除授权阶段“遍历全部 External Authorization Port”的行为。每个 action 先由 PC Policy 判定，再由 Authority Router 唯一解析为 `PC_ONLY` 或 `PC_AND_PROVIDER`。外部路径只调用路由指定的 Provider；未知、缺失、重复或不匹配的 route 全部拒绝。

EE 已完整配置但启动或运行中不可达时，PC API 不再随 EE 一起退出。C62 报告 EE `UNAVAILABLE`，项目目录、Catalog、Tool、审批与 EE Gateway 路径关闭；本地 PC Session 的个人对话、PC-owned Resource/Task 与 Core 健康状态不依赖 EE。EE Session 仍逐请求向 EE 校验，失败时保持 fail closed。

## 2. 授权流水线

```text
Principal active
  -> PC explicit Deny
  -> PC matching Allow / personal-conversation policy
  -> C63-derived unique Authority Route
  -> PC_ONLY: finish
  -> PC_AND_PROVIDER: selected Provider Health gate
  -> selected Provider request-time decision
  -> intersection result + route/provider evidence
```

固定规则：

1. PC Deny 在 Provider 调用前结束，外部调用次数为零；
2. `conversation.run + user:self + empty Tool Set` 是个人 `PC_ONLY`；
3. `memory.*`、`task.*`、`runtime.*`、`resource.*`、`profile.*`、`plugin.*`、`tool.*` 属于 PC Authority，但仍需要各自 PC grant；
4. `page:*`、`draft.generate`、`draft.read`、`ee.*` 只路由 `provider:eeclaw`；
5. `approval.decide` 在没有受信 Operation Authority 时不猜测 Provider，保持拒绝；
6. 跨 Provider 写入和未知 namespace 保持拒绝。

Route ID、Provider ID 和源端 evidence 会进入 Authorization Snapshot 的 reason/evidence。Capability Availability 和 Project Directory 仍不构成 Authorization Allow。

## 3. Provider Health

`ProviderHealthRegistry` 产生 C62 形状的短期观察，支持：

- `STARTING -> HEALTHY`；
- 超时、网络、适配器认证或协议失败进入 `UNAVAILABLE`；
- 指数退避限制恢复探针；
- `UNAVAILABLE` 同一时刻只允许一个恢复探针；
- 首次成功进入 `DEGRADED`，再次成功进入 `HEALTHY`；
- Provider 返回业务 `DENY` 表示通信成功，不会被误报为健康故障；
- `INCOMPATIBLE` 保持关闭，不能通过业务请求自动放行。

Health 只缩减能力，不授予权限。即使状态恢复为 `HEALTHY`，每个 EE 请求仍重新执行 PC Policy 与 EE request-time authorization。

## 4. Provider-local Degradation

启动流程先注册 EE Authorization Port 和全部已配置 Port，再做兼容性与 Catalog 装配。兼容性或 Catalog 网络失败只更新 C62 并跳过 EE Workbench 装配，Core API、Registry、Resource、Event、SSTS Repository 和个人 Workbench 继续启动。

Workbench 的项目依赖保持可选：

- `hasProjectProvider()` 同时要求依赖已装配且 C62 可用；
- 项目目录失败返回 `PC_WORKBENCH_PROVIDER_UNAVAILABLE`，不伪装成空项目；
- `/v1/ssts-tasks` 在 EE 不可用时只返回个人任务，不触发 Provider；
- Catalog、Capability Chain 与项目执行在 Health gate 前关闭；
- 个人 Tool Set 为空，不创建 EE External Account Binding 或 Credential Lease。

## 5. Availability 与恢复

`/health` 保持服务级 `status=ok`，并增加 C62 `provider_health`。前端区分 `healthy`、`degraded`、`unavailable` 与 `unconfigured`，不会在 unavailable 时自动读取项目目录。

`/v1/workbench/capability-availability` 产生 C65 形状的只读投影。`POST /v1/providers/eeclaw/retry` 只执行配置兼容性、Catalog 同步与 Workbench 重装配，不执行 EE 业务写入；恢复探针受退避与 single-flight 约束。恢复后项目能力重新装配，但所有操作仍逐次判权。

撤权安全沿用已有三层事实：PC Authorization Revision 使旧 Snapshot/Envelope 失效；Gateway 执行前重新请求 PC 与 EE 授权；已撤销 External Account Binding/Credential Generation 不会因 Health 恢复变回 ACTIVE。D3 不复制 EE 权限作为离线备用权威。

## 6. 明确边界

1. 当前只有 `provider:eeclaw`，不是生产多 Provider 平台；
2. Health 是进程内短期观察，跨实例持久化和协调留给 D4；
3. 当前 C62 采用保守的 Provider 聚合状态，任一关键 EE 启动能力失败会关闭全部 EE-owned 路径；
4. mixed `approval.decide` 缺少受信 Operation Authority 时保持拒绝，D4 再接 Operation Resolver；
5. 不包含生产 IAM、远端部署、EE schema、DSH Core 或 MEMORY-01B。

## 7. 准出

- [x] PC-only route 零 Provider 调用；
- [x] EE route 只调用 `provider:eeclaw`；
- [x] missing / unknown / ambiguous route fail closed；
- [x] PC Deny 不调用 Provider，EE Deny 覆盖 PC Allow；
- [x] Provider transport failure 与业务 Deny 可区分；
- [x] 退避、单探针和恢复滞回可确定测试；
- [x] EE unavailable 时个人 admission 继续、项目路径关闭；
- [x] C62/C65 与前端状态可见；
- [x] 真实 EE 断网启动烟测与全量 `pnpm check` 通过；
- [x] D3 完成后停止，D4 未实施。
