# DECOUPLING D4：EE Provider Bundle 与运行治理计划

- 状态：Planned / Not Started
- 前置：D3 Complete
- 目标：把 D3 的单进程 EE 装配收口为可版本化、可恢复、可审计的 Provider Bundle
- 非目标：第二个生产 Provider、EE 权限迁移、生产 IAM、MEMORY-01B、远端发布

## 1. D4-0：冻结 Bundle 与故障合同

- 定义 EE Bundle 版本、Registration Revision、Compatibility、Catalog Revision 和配置摘要；
- 冻结启动失败、运行中断、协议不兼容、认证失败、业务 Deny 与撤权矩阵；
- 明确哪些恢复可自动执行，哪些必须人工介入。

准出：失败分类不会回退为通用 500，也不会扩大授权。

## 2. D4-1：Provider Bundle 生命周期

- 将 Identity、Authorization、Directory、Capability、Projection 组合为一个 EE Bundle；
- 实现 `UNCONFIGURED -> STARTING -> READY/DEGRADED/UNAVAILABLE/DISABLED` 生命周期；
- 原子发布 Catalog/Profiles/Connector 引用，失败时保留上一版只读元数据但不复用过期权限；
- Bundle reload 不重启 PC Core。

准出：装配切换没有半新半旧 Tool Set。

## 3. D4-2：端口级 Health 与跨实例观察

- 将 D3 的 Provider 聚合状态细分为五类 Port Health；
- 引入短期持久观察与实例协调，避免多 API 实例同时探针；
- 增加 jitter、上限、熔断和管理员可见 evidence；
- Health 过期统一 fail closed。

准出：单个 Projection 故障不误伤仍可安全使用的 EE Port，同时任何未知状态不放行。

## 4. D4-3：可信 Operation Authority Resolver

- 从持久 Operation/Approval 读取 resource authority、provider 和目标 action；
- `approval.decide` 禁止客户端声明 Authority；
- PC-only Approval 与 EE-backed Approval 分别命中唯一 route；
- 跨 Provider write 继续拒绝。

准出：mixed action 不再依赖 action 名猜测，篡改 authority 的请求稳定拒绝。

## 5. D4-4：撤权 Fan-out

- Provider Authority Revision 变化触发相关 Snapshot、Assignment、MCP Binding 和 Credential Lease 失效；
- 区分“对象保留但不可执行”和“安全回收”；
- 恢复后必须建立新授权证据和新 generation；
- 对 UNKNOWN 外部结果只对账，不盲目重放。

准出：撤权后旧 Session/Lease/Binding 在重启和恢复后均不能继续调用。

## 6. D4-5：运行与前端收口

- 将 retry 从最小启动端点收口为有节流、审计和内部权限的 Provider operation；
- 前端消费稳定 Availability，不直接推断 Health；
- 补 Provider 状态、最后检查时间、原因与安全重试，不建设完整运维平台；
- 保持自动模式装配，不要求普通用户手动选择 SSTS/EE 模式。

准出：用户可继续 PC 工作，运维人员能定位 Provider 故障，普通用户看不到内部 Secret 或端点。

## 7. D4-6：独立故障验收

- 隔离 PostgreSQL 与本地 EE fixture 环境；
- 覆盖启动断网、运行断网、401/403、5xx、慢响应、坏合同、Catalog revision、撤权、API 重启和并发恢复；
- 验证 PC-only 零外部调用、EE 双重授权和旧 Credential 不复活；
- 形成独立验收包和恢复手册。

准出：全量门禁、故障矩阵和独立复核通过。

## 8. 停止条件

- 需要复制 EE 项目成员或业务权限到 PC；
- 需要修改 EE schema、共享数据库或 DSH Core；
- 无法从可信 Operation 解析 mixed Authority；
- 跨实例恢复必须绕过 request-time authorization；
- 任务扩展为第二 Provider 或生产发布。

D4 必须由新的明确指令启动。本计划不表示 D4 已实施。
