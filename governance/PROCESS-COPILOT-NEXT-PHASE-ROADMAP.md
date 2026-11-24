# Process Copilot 下一阶段主线

> 状态：`SOURCE-BASELINE-01 COMPLETE / D0-D4A COMPLETE / ADR-0025 T0-T1A COMPLETE / T1B AND T2A-T2C LOCAL COMPLETE / RCI-02 AND RCI-03 REAL EE RETEST PENDING / T3 AND D4B NOT STARTED`
> 日期：2026-11-24（Asia/Shanghai）
> 前置状态：MEMORY-01A 已通过独立复核；MEMORY-01B 保持暂停。  
> 主线：建立新的可追溯源码基线，然后实施 PC 与 EE-Claw 的身份、权限及业务能力解耦。

## 1. 顺序

```text
MEMORY-01A closure
  -> SOURCE-BASELINE-01
  -> D0-D4A Provider decoupling
  -> ADR-0025 T0 contracts
  -> T1A PC Session / source validation split
  -> RCI-03 READ Operation Projection closure (developer verified)
  -> T1B Session Assurance and T2A-T2C authorization intersection (local complete)
  -> real EE READ retest (pending; separate authorization)
  -> T3 real outage/revocation/multi-account acceptance
  -> evaluate D4B and MEMORY-01B
```

不并行启动 MEMORY-01B，避免同时改动 Memory Authorization Port、身份来源和外部授权路由。

## 2. SOURCE-BASELINE-01：新仓库与 GitHub 基线

状态：`COMPLETE`。私有仓库：`https://github.com/zrt-980802/process-copilot-harness`；基线根提交：`935b84165d2d8a61c4af08036edc18a344422cb8`。

目标不是直接复制当前脏工作树，而是形成一份来源清晰、可复现、无凭据的新主仓库。

必须完成：

- 明确 Product、Architecture 和必要迁移文档的归属；
- 保留 Product 与相邻 Architecture 的检查关系，或同步修改检查入口；
- 排除测试报告、临时构建物、真实凭据、`.env`、数据库和 Runtime 状态卷；
- 记录当前基线 HEAD、未提交来源、文件清单和敏感信息扫描结果；
- 在本地新目录完成全量 `pnpm check`；
- 创建新的 GitHub 私有仓库并上传首个可验证基线；
- 核对远端提交哈希，不改写或清理现有 Product、EE 工作树。

GitHub 建仓是外部状态变更。执行时需要确定仓库名称，并确认当前 `gh` 或 SSH 身份可用；不复用或覆盖现有 `process-copilot-dev` 仓库。

## 3. DECOUPLING-ADR-01：先冻结边界

状态：`ACCEPTED`。见 `architecture/ADR-0024-pc-core-external-business-provider-decoupling.md`。当前只授权 D0 Contract 与调用清单，不授权 D1 运行时重构。

新增 Superseding ADR，定义：

- PC Identity and Authorization Authority；
- `IdentityProviderPort`；
- `EnterpriseAuthorizationPort`；
- `ProjectDirectoryPort`；
- `BusinessCapabilityProviderPort`；
- `WorkbenchProjectionPort`；
- Provider 路由、版本、撤权和审计证据；
- EE 不可用时的降级和 Fail Closed 规则；
- Standalone、EE-connected 和 multi-provider 三种运行模式。

权威边界固定为：PC 管 PC Principal、Session、对话、Memory、Task、Plugin、Tool、Approval 和 Audit；EE 继续管理 EE 账号状态、项目成员、业务对象与最终业务授权。

### 3.1 D0：合同与调用清单

状态：`COMPLETE`。验证见 `product/docs/decoupling-d0-verification.md`；D1 尚未开始。

- 冻结现有 EE 登录、逐请求 Session 校验、外部授权、项目目录、MCP Catalog、执行与 Workbench 投影调用；
- 建立 action namespace、resource authority 与 Provider route 表；
- 新增 C61-C65 Provider Registration、Health、Authority Route、Project Directory Snapshot 与 Capability Availability；
- 只生成 Contract、fixture、TypeScript 和追踪证据，不改变登录、授权、API 或 Workbench 行为；
- D0 门禁通过后停止，D1 必须另行启动。

### 3.2 D1：行为保持的 Port 拆分

状态：`COMPLETE`。设计与边界见 `architecture/external-provider-decoupling-d1-port-split-v1.md`，验证见 `product/docs/decoupling-d1-verification.md`。

- 五类 Port 已形成 TypeScript 边界；
- EE 登录、授权、项目目录、MCP 能力和 Workbench 投影已成为明确实现；
- Server、Workbench 与 Catalog 同步改为消费 Port；
- EE-connected 现有对外行为由 golden tests 冻结；
- 未引入 Standalone、Authority Router、Provider Health 或多 Provider。

D2 的详细执行计划见 `governance/DECOUPLING-D2-STANDALONE-PLAN.md`。

### 3.3 D2：PC Core Standalone

状态：`COMPLETE`。架构结果见 `architecture/external-provider-decoupling-d2-standalone-v1.md`，验证见 `product/docs/decoupling-d2-verification.md`。

- 无 EE 配置时可装配本地身份与个人 Workbench；
- 个人 `conversation.run` 不调用 EE Authorization；
- 个人 Profile 的外部 Tool Set 为空；
- 部分 EE 配置稳定 fail closed；
- `/health` 暴露最小 Capability Availability；
- 前端 Standalone 不请求 EE 登录、项目目录、Catalog 或审批；
- EE-connected 的 D1 golden behavior 保持。

### 3.4 D3：Authority Router 与 Provider-local Degradation

状态：`COMPLETE`。架构结果见 `architecture/external-provider-decoupling-d3-authority-router-v1.md`，验证见 `product/docs/decoupling-d3-verification.md`。

- 外部授权不再遍历所有 Provider，按 action、scope 与 authority 唯一路由；
- unknown、missing、ambiguous 与 cross-authority 保持 fail closed；
- C62 Health 区分业务 Deny 与 transport/contract failure；
- EE 不可达只关闭 EE-owned Workbench/Gateway 路径；
- C65 Availability 与前端状态不替代执行授权；
- 受退避和 single-flight 控制的恢复可重新装配 EE Catalog/Workbench。

### 3.5 D4A：EE Provider Bundle 生命周期

状态：`D4A COMPLETE / D4B NOT STARTED`。仅完成 W0、D4-0/D4-1 及所需 API/Workbench 接线、本地开发者验证。
五类 Port、Catalog/Profile/Connector 通过同一 generation 原子发布；失败关闭 EE 执行，保留 Core 个人工作台。
合同新增 C66，C61/C62/C65 语义不变；single-flight、旧 generation fencing、实际 API 不可达启动及前端状态检查通过。
结果见 `architecture/external-provider-decoupling-d4a-provider-bundle-v1.md`、`product/docs/decoupling-d4a-verification.md`。
D4 总计划见 `governance/DECOUPLING-D4-EE-PROVIDER-BUNDLE-PLAN.md`；D4-2 至 D4-6 未实施，须新任务授权，不自动进入 D4B。

### 3.6 ADR-0025：薄 Session、薄授权与旧 Provider 权限兼容

状态：`ADR ACCEPTED / T0-T1A COMPLETE / T1B AND T2A-T2C LOCAL COMPLETE / RCI-02 AND RCI-03 REAL EE RETEST PENDING / T3 NOT STARTED`。

ADR-0025 已明确 PC Session 的固定绝对到期、PC-owned Action 独立授权、Provider-owned Action 的 PC 与当前 Provider 交集授权，以及 EE V1 零迁移兼容。T1B、T2A-T2C 已完成本地实现和开发者验证；RCI-02/03 仍待真实 EE 复验，T3 未启动，不代表生产就绪。

T0 任务书：`governance/ADR-0025-T0-CONTRACT-AND-COMPATIBILITY-FIXTURE-TASK.md`。
T1A 任务书：`governance/ADR-0025-T1A-PC-SESSION-SOURCE-VALIDATION-SPLIT-TASK.md`。
T1A 已解除 PC-owned 请求认证对数据源实时在线状态的依赖，不改数据库 schema；T1B 的 PC 自有 schema 经单独批准后实现 C67 持久化、revision 绑定及旧 Session 重新认证。开发者验证见 `product/docs/adr-0025-t1a-verification.md` 和 `product/docs/pc-authorization-mvp-01-verification.md`，真实 EE 复验仍未完成。

T0 已冻结 C67-C69、Session/Decision/Mapping golden matrix 和兼容门禁；本地开发者验证见
`product/docs/adr-0025-t0-verification.md`。T1A 已完成运行边界拆分，RCI-02 待真实复验；
RCI-03 READ 投影已完成开发者验证，报告见 `product/docs/rci-03-read-operation-projection-verification.md`；任务书见
`governance/RCI-03-READ-OPERATION-PROJECTION-CLOSURE-TASK.md`。

### 3.7 PC 自有授权与外部数据源授权绑定

PC 的权限系统与数据源权限系统是两个独立权威，不互相复制：

```text
PC Principal + PC Session
  -> PC Policy 对 Harness action/scope 判权
  -> resolve one data-source authority route when external data is required
  -> resolve verified External Authority Binding
  -> data source performs current authorization
  -> PC Allow ∩ valid binding ∩ source Allow ∩ execution guards
  -> execute and audit
```

这里的“数据源授权给 PC”指数据源允许 PC 代表一个已绑定主体发起特定请求，不表示把数据源的 Role、成员关系或 Allow 复制成 PC Grant。

- PC 自有授权管理 `conversation.run`、个人 Task/Memory、Profile、Plugin、Tool/MCP 使用资格、Approval 和 Harness 管理能力；
- `ExternalIdentityLink` 表达 PC Principal 与外部身份的已验证关系；
- `ExternalAccountBinding` 表达某 Connector 执行时使用的外部账号/凭据绑定；
- 规划中的 `External Authority Binding` 是上述关系在授权路由中的统一视图，不要求立即新增数据库表；
- 外部项目、文档、Tool 或写操作仍由当前数据源最终判权；
- PC Deny、绑定失效、源系统 Deny/Unknown/Unavailable 任一出现，最终结果都是 Deny；
- Binding 只能缩小可执行范围，不能产生独立于数据源的离线 Allow。

实施分层：

1. T1A：PC Session 本地验证与数据源实时验证拆分，关闭 RCI-02；
2. T1B：完整持久化 C67 assurance、revision 和固定时限，需单独批准 PC schema 演进；
3. T2A：把 PC Policy 的 action/scope 决策统一接入 C68；
4. T2B：把 Identity Link、Account Binding、Provider route 组合成 External Authority Binding 解析；
5. T2C：使用 C69 Mapping 调用数据源当前授权，并形成 PC/Source 交集证据；
6. T3：在真实 EE 断连、恢复、撤权、到期、重登和多账号下验收。

## 4. DECOUPLING-CORE-01：PC 独立控制面

当前进度：D3 Authority Router 与局部降级、D4A EE Bundle 生命周期已完成；端口级 Health、可信 Operation Resolver、跨实例撤权等 D4B 范围尚未开始。

- 将 EE Session 从唯一登录前提改为一种 `IdentityProvider`；
- 将全局 `ExternalAuthorizationPort[]` 改成按 Provider、action namespace 和 resource authority 路由；
- 个人对话、个人记忆及纯 PC 能力不再调用 EE；
- PC 的角色、能力和 Tool/MCP 使用权由 PC Policy 决定；
- 外部系统的业务数据访问仍与源系统最终授权取交集；
- 撤权递增 Authorization Revision，并失效 Session、Snapshot、Runtime Assignment 和 MCP Binding。

RCI-03 的 READ 投影整改仍待单独授权的真实 EE 复验。T1B 和 T2A-T2C 已有本地实现与开发者验证，不能据此宣称真实 EE 授权交集或生产级撤权已经验收。

## 5. EE-PROVIDER-ADAPTER-01：EE 成为首个外部 Provider

- 保留现有 `HttpEeClawAuthorizationAdapter` 的业务授权语义；
- 将 EE 登录、项目目录、授权决策、业务 Tool Catalog 和 Workbench Projection 分成独立适配器；
- EE 相关读写在 EE 不可用时 Fail Closed；
- 非 EE 能力继续可用，前端只显示对应 Provider 暂不可用；
- 不复制 EE 项目成员、Role/Page/Action 或业务对象权限为 PC 的第二权威。

## 6. STANDALONE-ACCEPTANCE-01：准出条件

至少验证：

1. 不配置 EE 时，PC 可登录并使用个人对话、个人记忆、任务和非 EE Plugin；
2. EE 断开时，EE 能力拒绝但 PC Core 不受影响；
3. PC Allow 不能绕过 EE Deny；
4. EE Allow 不能绕过 PC Tool/Policy Deny；
5. 不相关 action 不调用 EE 授权端口；
6. EE 撤权后，既有 Session、Snapshot、Runtime 和 MCP 绑定不能继续调用；
7. 审计可关联 PC Subject、Provider、源系统 Decision 和最终执行结果；
8. 全量门禁及独立 PostgreSQL、断网、重启和多账号测试通过。

## 7. 暂不执行

- MEMORY-01B 和记忆 UI；
- EE 业务权限整体迁移到 PC；
- DSH Core 修改；
- EE schema 或共享数据库变更；
- 未单独授权的 PC Session schema 变更（T1B）；
- 生产部署、远端环境修改或现有仓库历史改写。
