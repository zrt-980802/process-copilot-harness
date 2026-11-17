# DECOUPLING D3：Authority Router 与 Provider-local Degradation 计划

- 状态：Complete
- 前置：D2 Complete
- 目标：按 action namespace、resource authority 与 provider health 路由授权和能力，使 EE 中断只关闭 EE-owned 路径
- 非目标：多 Provider 生产接入、EE Provider Bundle 最终发布、生产 IAM、MEMORY-01B

## 1. 工作包

### D3-0：路由与故障基线

- 冻结 PC-only、EE-owned、mixed 与 unknown 请求矩阵；
- 增加调用计数、超时、断网、恢复和并发测试；
- 保留 D2 Standalone 与 D1 EE golden tests。

准出：测试能区分路由错误、Provider 不可达和业务 Deny。

### D3-1：Authority Router

- 以 C63 为运行时路由事实；
- 输入包含 action、resource authority、scope 与 required provider；
- `PC_ONLY` 不调用外部端口；
- `PC_AND_PROVIDER` 必须同时获得 PC 与目标 Provider Allow；
- unknown、route ambiguity 和 missing provider 全部 fail closed。

准出：没有全局遍历所有 Provider 的授权逻辑，且路由证据进入审计。

### D3-2：Provider Health 状态机

- 实现 C62 的 configured、ready、degraded、unavailable 状态；
- 区分配置错误、认证失败、超时、协议不兼容和业务 Deny；
- 设置有限探针、退避和恢复滞回，避免请求风暴；
- Health 不替代每次业务授权。

准出：测试可重复得到稳定状态转换，不把业务 Deny 误报成故障。

### D3-3：Provider-local Degradation

- EE 不可达时关闭 EE 项目、Catalog、Tool 和审批入口；
- 已登录的本地/PC Session 继续使用个人对话与 PC-owned 数据；
- EE Session 的逐请求校验失败仍 fail closed；
- 不缓存或复制 EE 权限为备用权威。

准出：断开 EE 后个人路径继续，EE-owned 路径拒绝且原因明确。

### D3-4：Capability Availability 与前端状态

- 将 C65 建成 Router + Health 的只读投影；
- 前端显示 Provider 暂不可用、可重试或未配置；
- 不把 unavailable 渲染成空数据或权限不足；
- 不建设完整运维控制台。

准出：页面不会调用已标记 unavailable 的 Provider 路径，恢复后可重新装配。

### D3-5：撤权与恢复

- Provider authority revision 变化后失效相关 Snapshot、Assignment 与 MCP Binding；
- 验证 EE 恢复不会复活旧 Credential Lease；
- 重启 Router/Health 投影后行为一致。

准出：撤权优先于缓存和恢复，旧权限不能因 Provider 恢复而继续使用。

## 2. 依赖

- D2 的 provider mode、Local Identity、可选 Workbench 依赖与 Capability 状态；
- C62 Provider Health、C63 Authority Route、C65 Capability Availability；
- 现有 Authorization Snapshot、Principal Envelope、Assignment、MCP Binding 与 Event/Audit。

## 3. 验收矩阵

1. PC-only action：零外部调用；
2. EE-owned action：PC Allow + EE Allow 才允许；
3. PC Deny + EE Allow：拒绝；
4. PC Allow + EE Deny：拒绝；
5. EE 超时：EE 路径 unavailable，个人路径继续；
6. unknown action / authority：拒绝；
7. route ambiguity：拒绝并审计；
8. EE 恢复：新请求重新判权，旧 Lease 不复活；
9. API/Router 重启：状态和安全结果一致；
10. 全量门禁、隔离 PostgreSQL、断网和多账号定向测试通过。

## 4. 风险

| 风险 | 控制 |
| --- | --- |
| Router 默认路由扩大权限 | 无默认外部 Provider；unknown/ambiguous 一律拒绝 |
| Health 结果被误当授权 | Health 只控制可用性，业务请求仍逐次判权 |
| EE 断开导致全局不可用 | 故障隔离到 EE-owned route，PC-only 不依赖探针 |
| 恢复后复用旧凭据 | revision + generation 联合失效，重新建立 Binding/Lease |
| D3 越界为多 Provider 平台 | 只实现单 EE route 与可扩展合同，多 Provider 接入留 D4/D5 |

## 5. 停止条件

- 需要复制 EE 项目成员或对象权限到 PC；
- 需要修改 EE schema、共享数据库或 DSH Core；
- 无法证明 PC-only 零外部调用；
- Health 必须绕过逐请求授权才能工作；
- 路由歧义不能稳定 fail closed。

D3 已按本计划完成。架构结果见 `architecture/external-provider-decoupling-d3-authority-router-v1.md`，开发者验证见 `product/docs/decoupling-d3-verification.md`。D4 必须由新的明确指令启动。
