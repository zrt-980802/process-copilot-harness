# Process Copilot 下一阶段主线

> 状态：`SOURCE-BASELINE-01 COMPLETE / DECOUPLING-ADR-01 ACCEPTED / D0 COMPLETE / D1 PORT-SPLIT COMPLETE / D2 PLANNED NOT STARTED`
> 日期：2026-11-17（Asia/Shanghai）  
> 前置状态：MEMORY-01A 已通过独立复核；MEMORY-01B 保持暂停。  
> 主线：建立新的可追溯源码基线，然后实施 PC 与 EE-Claw 的身份、权限及业务能力解耦。

## 1. 顺序

```text
MEMORY-01A closure
  -> SOURCE-BASELINE-01
  -> DECOUPLING-ADR-01
  -> DECOUPLING-CORE-01
  -> EE-PROVIDER-ADAPTER-01
  -> STANDALONE-ACCEPTANCE-01
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

## 4. DECOUPLING-CORE-01：PC 独立控制面

- 将 EE Session 从唯一登录前提改为一种 `IdentityProvider`；
- 将全局 `ExternalAuthorizationPort[]` 改成按 Provider、action namespace 和 resource authority 路由；
- 个人对话、个人记忆及纯 PC 能力不再调用 EE；
- PC 的角色、能力和 Tool/MCP 使用权由 PC Policy 决定；
- 外部系统的业务数据访问仍与源系统最终授权取交集；
- 撤权递增 Authorization Revision，并失效 Session、Snapshot、Runtime Assignment 和 MCP Binding。

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
- 生产部署、远端环境修改或现有仓库历史改写。
