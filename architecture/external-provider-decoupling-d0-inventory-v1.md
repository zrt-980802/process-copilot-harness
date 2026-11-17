# PC Core / 外部 Provider 解耦 D0 调用清单 v1

- 状态：D0 Baseline
- 日期：2026-11-17
- 依据：ADR-0024、C61-C65
- 范围：只冻结当前耦合与目标路由输入；不改变登录、授权、API、Workbench 或 EE 行为

## 1. D0 结论

当前 Product 已拥有 PC Principal、Session、Policy、Task、Conversation、Memory、Runtime、Approval 与 Audit，但运行装配仍把 EE 同时当作登录 Provider、全局外部授权端口、项目目录、MCP Catalog 和 Workbench 数据源。D0 不拆代码，只把这些依赖变成可逐项迁移、可验收的清单。

目标边界是：PC Core 能独立启动和处理 `resource_authority=pc` 的能力；EE 仅处理 `resource_authority=eeclaw` 的身份或业务能力。目录可见性、Catalog 可发现性和 Workbench 投影均不是执行授权。

## 2. 当前 EE 耦合调用清单

| ID | 链路 | 当前入口与调用 | 当前故障影响 | D1-D4 目标 Port | D0 判定 |
| --- | --- | --- | --- | --- | --- |
| EE-C01 | 启动兼容校验 | `apps/api/src/main.ts` 启动时调用 `HttpEeClawAuthorizationAdapter.fetchCompatibility()` | EE 不可达可阻止 API 启动 | Provider Health + EE Provider Bundle | 全局启动耦合 |
| EE-C02 | 登录票据交换 | `apps/api/src/ee-login.ts` 调用 `/login/exchange`，再建立 PC Session 与 ExternalIdentityLink | EE 登录不可用时无法建立该类 Session | `IdentityProviderPort` | 合法 Provider 依赖，但不是 Core 固定前提 |
| EE-C03 | 逐请求 Session 校验 | `EeLogin.validate()` 调用 `/login/validate`；`main.ts` 注册为全局 Session Validator | EE 短时故障可影响所有使用该 Session 的请求 | `IdentityProviderPort` + provider-scoped authentication context | 当前只支持 EE Session |
| EE-C04 | 外部业务授权 | `identity-authorization.ts` 对每个已获得 PC allow 的 action 遍历全部 `ExternalAuthorizationPort` | PC-only action 也可能调用 EE；新增 Provider 后形成全局交集 | `EnterpriseAuthorizationPort` + Authority Router | 关键路由耦合 |
| EE-C05 | Permission 映射 | `main.ts` 将 `draft.*`、`ee.ssts.review.request`、`approval.decide` 映射到 EE page/operation | action 名称承担了隐式 Authority；`approval.decide` 语义混合 | C63 Authority Route | 必须显式化 |
| EE-C06 | 项目目录 | `main.ts` 直接 POST `/projects/accessible`；Workbench 多处调用 `projects()` | 目录故障阻断项目 Workbench；返回结构是 EE 专用 | `ProjectDirectoryPort` + C64 | 目录不是对象授权 |
| EE-C07 | MCP Catalog 同步 | `EeMcpGatewayProvider.discover()` + `synchronizeEeMcpCatalog()` 在启动阶段读取 EE Catalog 并注册 Connector/Tool | Catalog 不可用可阻止 Gateway/Workbench 装配 | `BusinessCapabilityProviderPort` + C65 | Provider-local 可用性缺失 |
| EE-C08 | 外部账号绑定与凭据 | Workbench `ensureExternalAccount` 固定解析 `eeclaw`，创建 `ee_mcp` binding 和 EE secret ref | 非 EE Provider 无法装配；EE 绑定缺失会拒绝 | Identity Link + Business Capability Provider | 固定 Provider key |
| EE-C09 | MCP 执行与 readback | `EeMcpGatewayProvider.dispatch/reconcile` 固定校验 `ee_mcp`、调用 EE Tool，写操作再调用 `ee.get_ssts` readback | 行为已 fail closed，但类型和注册固定为 EE | `BusinessCapabilityProviderPort` | 保留 EE 业务语义 |
| EE-C10 | Workbench 工具选择 | Workbench 通过 EE 项目目录和逐 Tool 授权生成 Catalog/Profile/Effective Tool Set | 目录、授权、Catalog 三种事实混在同一工作流 | Project Directory + Authorization + Capability Availability | 必须保持三者分离 |
| EE-C11 | Workbench Projection | `RuntimeWorkbench.projection()` 聚合 PC Session/Operation 与 EE Tool evidence | 当前没有独立 Provider Projection 契约 | `WorkbenchProjectionPort` | D0 不新增投影数据契约 |
| EE-C12 | SSTS Draft 证据 | `RuntimeSstsDraftEngine` 要求 EE Tool coverage 与 `eea://traces/` | SSTS 本身应继续依赖 EE；不应扩大为 Harness 总前提 | EE Provider Bundle | 垂直场景依赖，非 Core 依赖 |

## 3. Action Namespace 与 Resource Authority 路由表

本表同时记录当前事实与目标路由。`PC_ONLY` 表示只执行 PC Policy；`PC_AND_PROVIDER` 表示 PC Allow 与指定 Provider Allow 的交集。Authority 必须来自可信 Resource/Connector/Tool 元数据，不接受客户端自由声明。

| Action / Namespace | 资源示例 | Resource Authority | 目标授权模式 | Provider | 当前状态与迁移要求 |
| --- | --- | --- | --- | --- | --- |
| `conversation.run` | `user:{principal_id}` | `pc` | `PC_ONLY` | 无 | 当前授权逻辑已有个人对话特例，但 EE 登录 Session 仍会逐请求校验；D2 才解开身份前提 |
| `memory.*` | `memory:{id}`、个人/项目 Memory scope | `pc` | `PC_ONLY` | 无 | Memory 只消费 PC Authorization Port，不得直接调用 EE |
| `task.*`、`runtime.*`、`resource.*` | PC Task、Session、Runtime、Resource | `pc` | `PC_ONLY` | 无 | D1/D2 需补齐稳定 namespace，不得默认发往 EE |
| `profile.*`、`plugin.*`、`tool.*` | PC Release/Assignment | `pc` | `PC_ONLY` | 无 | 仅表示 PC 使用权；不能替代外部业务执行授权 |
| `page:*` | EE 页面/模块 | `eeclaw` | `PC_AND_PROVIDER` | EE Provider | 当前由 EE Adapter直接解析；D3 改为显式 route |
| `draft.generate`、`draft.read` | EE 项目范围 SSTS Draft | `eeclaw` | `PC_AND_PROVIDER` | EE Provider | 当前映射 `page:architecture/read`；保留语义但显式声明 Authority |
| `ee.*` 读 Tool permission | `project:{project_code}`、EE 对象 ref | `eeclaw` | `PC_AND_PROVIDER` | EE Provider | Tool Release 必须声明 action namespace 与 resource authority |
| `ee.ssts.review.request` | EE SSTS Review | `eeclaw` | `PC_AND_PROVIDER` | EE Provider | 当前映射 `page:architecture/edit`；仍需 Approval 与源端最终授权 |
| `approval.decide` | PC Approval 对象 | 由 Approval 的目标 Operation 决定 | `PC_ONLY` 或 `PC_AND_PROVIDER` | 可选 | 当前无条件映射 EE review，存在混合 Authority；D3 必须由受信 Operation 解析，歧义则拒绝 |
| 未知 namespace 或缺失 Authority | 任意 | 未知 | `DENY` | 无 | 禁止遍历所有 Provider 猜测 |
| 多 Authority 聚合读取 | 多个 provider-owned 分片 | 每分片独立 | 分片判权后聚合 | 多 Provider | 一个 Provider 的 Allow 不覆盖另一个 Provider 的 Deny |
| 跨 Provider 写入 | 多 Authority | 多个 | 首期 `DENY` | 多 Provider | 未来需 Durable Approval、Operation Ledger、对账与补偿 |

## 4. 五类 Port 与 C61-C65 的关系

| Port | 注册/路由契约 | 运行事实契约 | 不具备的权力 |
| --- | --- | --- | --- |
| `IdentityProviderPort` | C61 | C62；既有 ExternalIdentityLink / PC Session | 不授予 PC Tool 或业务数据权限 |
| `EnterpriseAuthorizationPort` | C61、C63 | C62；Provider Decision 继续使用 C41 或后续 Provider-specific Contract | 不处理未路由给自己的 action |
| `ProjectDirectoryPort` | C61、C63 | C64 | 项目可见不等于对象读写允许 |
| `BusinessCapabilityProviderPort` | C61、C63 | C62、C65；执行继续使用 C21-C24 | Catalog 可见不等于执行允许 |
| `WorkbenchProjectionPort` | C61、C63 | C62、C65 和后续 Projection Contract | 投影不能增加 Tool、Scope 或业务权限 |

## 5. D0 冻结规则

1. Provider 用稳定 `provider_registration_id` 注册，`provider_key` 只用于人类可读定位；
2. 每个 action route 必须唯一命中 action namespace 与 resource authority；缺失、重复或歧义一律拒绝；
3. `resource_authority=pc` 的 route 不得含外部 Provider；
4. 外部 Authority route 必须绑定一个 ACTIVE Provider Registration；
5. Provider Health 只能缩减可用能力，不能授予权限；
6. C64 Project Directory Snapshot 是短期可见性快照，不是 Authorization Snapshot；
7. C65 Capability Availability 是呈现和装配事实，不是 Authorization Decision；
8. D0 不修改现有 `ExternalAuthorizationPort[]` 遍历、不改变 EE Login、不改变 API 启动逻辑；这些属于 D1-D3。

## 6. D0 准出

- [x] 当前 EE 耦合按七条链路和十二个调用点冻结；
- [x] action namespace / resource authority / provider route 表已建立；
- [x] C61-C65 具有严格 JSON Schema、valid/invalid fixture 与 TypeScript 生成物；
- [x] ADR-0024 与 Traceability 指向 C61-C65；
- [x] 全量 `pnpm check` 通过；
- [x] D0 完成后停止，不自动进入 D1。
