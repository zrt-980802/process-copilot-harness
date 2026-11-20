# DECOUPLING-D4A：主线入口收口与 EE Provider Bundle 生命周期任务书

- 任务编号：`DECOUPLING-D4A-EE-PROVIDER-BUNDLE-LIFECYCLE`
- 状态：`D4A COMPLETE / D4B NOT STARTED`（2026-11-20，本地开发者验证；非独立验收）
- 日期：2026-11-20（Asia/Shanghai）
- 前置：D0、D1、D2、D3 Complete；D3 实现基线与任务书起草时 GitHub `main` = `f9d0f26917df990bb6a657b52ab4208dfbac0b76`
- 主工作仓库：`E:/shanzi_workspace/process-copilot-harness`
- 工作区入口：`C:/Users/29557/Documents/ChatGPT/山子- PC`
- 任务目标：先把开发入口指向新的 Harness 主线，再完成 D4-0 与 D4-1，将 EE 五类 Port 收口为可版本化、可原子装配、可恢复且不拖垮 PC Core 的 Provider Bundle
- 完成性质：本地开发者验证；不等于独立验收、生产发布或 D4 全部完成

## 1. 开始前必须读取

按顺序读取并以当前文件为准：

1. 工作区 `AGENTS.md`、`HANDOFF.md`、`workspace.paths.json`、`migration/source-snapshot.json`；
2. 仓库 `AGENTS.md`、`README.md`、`SOURCE-BASELINE.md`；
3. `governance/PROCESS-COPILOT-NEXT-PHASE-ROADMAP.md`；
4. `governance/DECOUPLING-D4-EE-PROVIDER-BUNDLE-PLAN.md`；
5. `architecture/ADR-0024-pc-core-external-business-provider-decoupling.md`；
6. D0-D3 架构结果与 `product/docs/decoupling-d0-verification.md` 至 `decoupling-d3-verification.md`；
7. C61 Provider Registration、C62 Provider Health、C63 Authority Route、C65 Capability Availability 的 schema、fixture 与生成定义。

开始编码前输出一段简短对齐块，至少确认：

- 当前唯一实现仓库、分支、HEAD、remote 和工作区状态；
- 任务书的本地文档提交属于已知协调变更；除此之外若 HEAD、索引或工作树漂移，先查明来源；
- D3 已有行为与本任务允许改变的行为；
- 旧 Product/EE 工作树只作历史证据，不是本任务实现位置；
- D4A 不包含 D4-2 至 D4-6，也不包含 MEMORY-01B。

## 2. 当前基线与问题

### 2.1 已有能力

- D1 已将 EE Identity、Authorization、Directory、Capability、Projection 拆为明确 Port；
- D2 已实现 Standalone 和 PC-only 个人工作台；
- D3 已实现唯一 Authority Router、C62 进程内 Provider Health、EE 局部降级和受限恢复；
- PC-only action 对 EE 保持零调用；EE operation 仍执行 PC 与 EE 的请求时授权交集；
- EE 启动失败不会阻止 PC Core 启动。

### 2.2 D4A 要解决的问题

当前五类 EE Port 仍由启动代码分散装配，缺少一个稳定的 Bundle Revision 和原子发布边界。Catalog、Profile、Connector 与 Port 实例可能在重载过程中处于不同代际；失败分类、兼容性、配置摘要和恢复责任尚未形成一个统一合同。

D4A 只解决“Bundle 合同与生命周期”。端口级 Health、跨实例协调、可信 Operation Authority Resolver、撤权 Fan-out、完整运维 UI 和独立故障验收留给后续任务。

## 3. 工作范围与顺序

必须按 W0 -> D4A-0 -> D4A-1 -> D4A-2 -> D4A-3 顺序执行。前一工作包未通过，不得提前更新完成状态。

### W0：主线入口收口

修改工作区入口文件，但不重写历史证据：

1. 在 `HANDOFF.md` 顶部新增 2026-11-20 当前主线区块，声明：
   - 当前实现主仓库为 `E:/shanzi_workspace/process-copilot-harness`；
   - `main` 当前基线为任务开始时实际核对的 HEAD；
   - 原 Product 与 EE 工作树保留为历史来源和证据，未经新任务不得继续在其中实现；
   - 旧演示候选与新 Harness 源码是不同交付面，运行状态不得互相推断。
2. 在 `workspace.paths.json` 中追加而不是替换：
   - `harnessRepository`；
   - `expectedHarnessHead`；
   - 必要时增加简短的 current-mainline 标识。
3. 不修改 `migration/source-snapshot.json` 的历史事实；如需补充当前状态，新增独立的 current-state 文件或在 `HANDOFF.md` 引用。
4. 验证 JSON 可解析，所有路径存在。

W0 准出：新参与者只读入口文件即可找到唯一开发主线，同时仍能追溯旧来源。

### D4A-0：冻结 Bundle 与故障合同

先测试和文档，后实现：

1. 定义最小 Bundle Descriptor，至少包含：
   - `provider_id`；
   - `bundle_version`；
   - `registration_revision`；
   - `compatibility_status`；
   - `catalog_revision`；
   - 不含 Secret 的 `configuration_digest`；
   - Bundle generation、状态和观察时间。
2. 固定生命周期：
   - `UNCONFIGURED`；
   - `STARTING`；
   - `READY`；
   - `DEGRADED`；
   - `UNAVAILABLE`；
   - `DISABLED`。
3. 冻结故障分类与恢复策略：
   - 完全未配置；
   - 部分配置；
   - 兼容性不匹配；
   - Adapter authentication failure；
   - transport/timeout；
   - protocol/contract failure；
   - Catalog revision 或配置代际变化；
   - EE business Deny；
   - authority/revocation 变化。
4. 对每类故障明确：是否影响 PC Core、是否允许自动探针、是否需要人工介入、是否保留只读元数据、是否允许继续执行。
5. 优先复用 C61/C62/C65。若现有合同无法表达 Bundle 边界，必须使用版本化扩展并同步生成器、fixture、schema、traceability 和 compatibility；禁止静默改变既有合同语义。

D4A-0 准出：故障不会退化为通用 500；Health/Availability 不会被误当授权；配置摘要不泄漏 URL credential、token 或 Secret。

### D4A-1：Provider Bundle 生命周期实现

1. 建立唯一 `EeProviderBundle` 或等价的 application/API 边界，统一持有：
   - Identity Provider Port；
   - Enterprise Authorization Port；
   - Project Directory Port；
   - Business Capability Provider Port；
   - Workbench Projection Port。
2. Bundle 构建必须先在不可见的新 generation 中完成配置解析、兼容性检查、Catalog/Profile/Connector 组装和必要验证。
3. 只有完整候选通过后才能原子发布为 active generation；调用方不得观察到半新半旧 Tool Set。
4. 并发 reload 必须 single-flight 或使用 generation/fencing 保证旧完成结果不能覆盖新 generation。
5. reload 失败时：
   - PC Core 和 PC-only Workbench 继续；
   - EE executable capability fail closed；
   - 可保留上一版只读描述元数据用于诊断；
   - 不得复用过期 Authorization、Snapshot、Binding、Credential Lease 或可执行 Connector；
   - 不得把旧 metadata 映射为新的 Authorization Allow。
6. Bundle reload 不重启 PC Core，不修改 D3 Authority Router 的逐请求判权语义。
7. `DEGRADED` 的可执行范围必须有明确、保守的规则；无法证明安全的 Port 一律不可执行。端口级独立降级留给 D4-2，不在 D4A 猜测实现。

D4A-1 准出：任意失败和并发顺序下都只能看到一个完整 active generation，或看到 EE capability 不可用。

### D4A-2：API、Workbench 与恢复接线

1. `main.ts`、Workbench、Catalog 和 EE Adapter 统一从 Bundle active snapshot 获取依赖，删除新增的旁路装配；
2. `/health` 和 C65 Availability 表达 Bundle 状态、generation、revision 和稳定原因，但不输出 Secret 或内部 credential；
3. 保持 D3 `POST /v1/providers/eeclaw/retry` 的最小语义，可将其内部实现委托给 Bundle reload；
4. 不在本任务建设 D4-5 的管理员操作、完整审计权限或运维控制台；
5. 前端只做维持现有 D3 状态兼容所需的最小修改，不进行页面重设计。

D4A-2 准出：EE reload 成功后 Catalog/Workbench 同时切换；失败时项目能力关闭而个人路径继续。

### D4A-3：文档与状态收口

完成实现和全部验证后再执行：

1. 新增 `architecture/external-provider-decoupling-d4a-provider-bundle-v1.md`；
2. 新增 `product/docs/decoupling-d4a-verification.md`；
3. 更新 `architecture/README.md`、根 `README.md`、Traceability 和 Compatibility；
4. 更新路线图为 `D4A COMPLETE / D4B NOT STARTED`，不得写成 `D4 COMPLETE`；
5. 在 D4 总计划中记录 D4-0/D4-1 的实际结果和剩余边界。

## 4. 必须先写或补齐的测试

至少覆盖以下矩阵：

| 场景 | 必须结果 |
| --- | --- |
| EE 完全未配置 | Bundle `UNCONFIGURED`；PC Core/个人工作台可用；EE 调用为零 |
| EE 部分配置 | fail closed；不发布半 Bundle |
| 完整兼容配置 | 单一 generation `READY`；五类 Port 属于同一 revision |
| 启动 transport failure | Bundle `UNAVAILABLE`；API Core 仍健康 |
| authentication failure | 稳定分类；不得自动扩大权限 |
| protocol/contract incompatible | 不发布可执行 Bundle；不能用业务请求自动恢复 |
| EE business Deny | 保持授权拒绝，不误报为 Bundle 故障 |
| Catalog revision 变化 | 新 Tool/Profile/Connector 原子发布 |
| reload 中途失败 | active generation 不出现混合状态；EE 执行关闭或保持安全的完整旧只读描述 |
| 两次并发 reload | 旧完成结果不能覆盖较新的 generation |
| reload 后 PC-only 请求 | EE Port 调用次数仍为零 |
| reload 后 EE 请求 | 仍执行 PC Policy + request-time EE authorization |
| API 重启 | 安全结果一致；不得复活旧 Credential/Binding |
| 前端不可用状态 | 不把故障显示为空项目或权限不足；个人入口保留 |

测试要求：

- 单元测试使用确定性 fake/spy 验证状态机、代际和调用次数；
- 集成声明必须使用真实本地 HTTP 边界或隔离依赖，不得用 mock 冒充真实 EE；
- 不连接共享数据库、生产服务或 `192.168.31.95`；
- 至少完成一次 EE 端口不可达的真实 API 启动烟测；
- 烟测结束后停止本任务启动的进程和容器，不清理无关资源。

## 5. 全量准出条件

只有同时满足以下条件才能标记 `D4A_COMPLETE`：

1. W0 入口收口通过，历史快照未被覆盖；
2. Bundle Descriptor、故障矩阵和自动/人工恢复边界有文档与测试；
3. 五类 EE Port 通过一个 Bundle generation 原子发布；
4. 任意失败不会停止 PC Core，也不会放行 EE operation；
5. 并发 reload 不产生混合 Tool Set 或旧 generation 回写；
6. PC-only action 始终零 EE 调用；
7. EE operation 始终执行 PC 与 EE 的请求时授权交集；
8. D1-D3、Gateway、Runtime、SSTS、Memory 01A 既有测试不回归；
9. 从 `product/` 执行 `pnpm check` 全部通过；
10. `git diff --check` 通过，敏感信息扫描无新增命中；
11. 形成架构结果、验证记录、限制和下一阶段 D4B 交接；
12. 工作区只包含本任务明确文件，不清理或覆盖用户已有改动。

## 6. 明确非目标

- D4-2 端口级 Health 和跨实例协调；
- D4-3 可信 Operation Authority Resolver；
- D4-4 撤权 Fan-out；
- D4-5 完整 retry operation、管理员权限和运维 UI；
- D4-6 独立故障验收；
- MEMORY-01B、记忆检索、Runtime 记忆注入或记忆 UI；
- 第二个业务 Provider 或生产 multi-provider；
- 生产 IAM、远端部署、发布资格；
- EE 源码、EE schema、共享数据库或 DSH Core 修改；
- 旧 Product/EE 工作树的提交、清理、迁移或历史改写。

## 7. 停止与升级条件

出现以下任一情况，停止实现并报告，不自行扩大范围：

1. 必须修改 EE schema、共享数据库、DSH Core 或生产配置；
2. 必须复制 EE 项目成员、Role/Page/Action 或业务对象权限到 PC；
3. 必须绕过 request-time authorization 才能恢复 Bundle；
4. 无法保证原子 generation，可能出现半新半旧 Tool Set；
5. 需要 D4-2 跨实例协调才能保证本任务单实例正确性；
6. 需要可信 Operation Resolver 才能安全启用 `approval.decide`；
7. 发现当前 HEAD、GitHub remote 或 D3 验证基线已漂移；
8. 发现与本任务重叠的未知用户改动，无法安全区分。

`approval.decide` 在缺少可信 Operation Authority Resolver 时必须继续拒绝，不得在 D4A 中用 action 名、客户端字段或默认 Provider 猜测 Authority。

## 8. 交付报告格式

完成时必须报告：

1. 实际修改文件与 Bundle 边界；
2. 生命周期和故障分类的最终规则；
3. 原子发布、并发 reload 和旧 generation fencing 的证据；
4. 完整测试命令、通过数、跳过数和真实烟测结果；
5. 未完成范围与 D4B 建议，不得笼统声称 D4 完成；
6. 本地提交哈希和工作区状态；
7. 是否 push、是否启动/停止服务、是否触碰 EE/DSH/数据库。

默认允许在验证全部通过后创建一个本地提交；不得 push、远程部署、修改 EE 工作树或自动进入 D4B，除非用户另行明确授权。

## 9. 可直接发送给主力开发的开场 Prompt

```text
执行任务 DECOUPLING-D4A-EE-PROVIDER-BUNDLE-LIFECYCLE。

唯一任务书：
E:/shanzi_workspace/process-copilot-harness/governance/DECOUPLING-D4A-EE-PROVIDER-BUNDLE-LIFECYCLE-TASK.md

主实现仓库：
E:/shanzi_workspace/process-copilot-harness

先完整读取任务书、仓库 AGENTS.md、README.md、SOURCE-BASELINE.md、下一阶段路线图、D4 总计划、ADR-0024 和 D0-D3 架构/验证记录，再输出开始前对齐块。严格按 W0、D4A-0、D4A-1、D4A-2、D4A-3 顺序执行。

本任务只允许完成主线入口收口以及 D4-0/D4-1 的 Bundle 合同、生命周期、原子装配和本地开发者验证。不得进入 D4-2 至 D4-6，不得启动 MEMORY-01B，不得修改 EE、DSH Core、共享数据库、.env、既有端口、生产设置或 192.168.31.95。旧 Product/EE 工作树只作历史证据，不得清理、提交或继续实现。

必须先补测试，证明 PC-only 零 EE 调用、EE operation 仍是 PC+EE 请求时授权交集、并发 reload 不产生半新半旧 Tool Set、失败不拖垮 PC Core、旧 generation 不能覆盖新 generation。完成真实 EE 不可达启动烟测和 product/pnpm check 后，形成架构结果与验证记录，只能标记 D4A COMPLETE / D4B NOT STARTED。

验证通过后可创建一个本地提交，但不要 push、部署或自动继续下一任务。遇到任务书停止条件时停止并报告，不要自行扩大范围。
```
