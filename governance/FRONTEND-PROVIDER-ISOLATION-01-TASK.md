# FRONTEND-PROVIDER-ISOLATION-01：Provider 中立前端与 EE 场景隔离任务书

- 任务编号：`FRONTEND-PROVIDER-ISOLATION-01`
- 状态：`FRONTEND-PROVIDER-ISOLATION-01 DEVELOPER VERIFIED`
- 日期：2026-11-20（Asia/Shanghai）
- 实现基线：`main@efadcd3`（D4A 独立复验通过后的本地基线）
- 主工作仓库：`E:/shanzi_workspace/process-copilot-harness`
- 目标：让 Process Copilot 前端以 PC 能力和当前可见数据为中心；没有当前授权的外部项目数据或场景能力时，不显示 EE 项目、SSTS、EE MCP、EE 账号或演示场景痕迹
- 完成性质：本地开发者验证；不等于 D4B、完整 D4、生产发布或真实 EE 业务验收

## 1. 背景与问题定义

Process Copilot 的产品边界是公司级 Agent Harness，EE-Claw 只是首个外部业务 Provider，SSTS 只是首个纵向场景。当前前端仍把 EE/SSTS 当作默认产品信息架构：即使没有项目、Catalog 或业务数据，也会显示项目导航、EE 连接状态、EE MCP 来源、SSTS 卡片、EE 账号字段和演示项目视觉。

本任务不是简单替换文案，也不是隐藏权限错误。它要建立一套 Provider 中立的体验投影：

1. PC 个人能力始终由 PC 当前能力和数据决定；
2. 外部项目界面只有在“当前 Provider 可用 + 当前账号存在授权项目 + 对应能力/数据存在”时出现；
3. SSTS 等场景入口只有在当前项目 Catalog/Profile 明确提供该场景时出现；
4. 旧任务、缓存、URL、默认图片或 `provider_mode` 不能单独让外部项目内容重新出现；
5. Provider Health/Availability 只决定可用性和提示，不产生授权；
6. UI 隐藏不是安全控制，所有业务请求仍必须通过 PC 与源系统请求时授权。

“前端没有数据”在本任务中不是简单的 `array.length === 0`，而是缺少当前、可验证的外部项目体验证据，包括当前 Project Directory 授权、Capability Availability、Catalog/Profile 和必要业务投影。

## 2. 开始前必须读取与对齐

开始前完整读取：

1. 工作区 `AGENTS.md`、`HANDOFF.md`、`workspace.paths.json`；
2. 仓库 `AGENTS.md`、`README.md`、`SOURCE-BASELINE.md`；
3. `governance/PROCESS-COPILOT-NEXT-PHASE-ROADMAP.md`；
4. `governance/DECOUPLING-D4-EE-PROVIDER-BUNDLE-PLAN.md`；
5. `architecture/ADR-0024-pc-core-external-business-provider-decoupling.md`；
6. `architecture/external-provider-decoupling-d4a-provider-bundle-v1.md`；
7. `product/docs/decoupling-d4a-verification.md`；
8. C61-C66 合同、Capability Availability 和 Authority Route 定义；
9. `product/apps/web/src/`、`product/apps/web/tests/` 及相关 API 路由。

编码前输出对齐块，至少说明：

- 当前 HEAD、remote、git status 和本任务允许修改的文件面；
- D4A 已有 Bundle/Availability 行为与本任务只消费、不重写的合同；
- “无 Provider”“Provider 不可用”“Provider 可用但零项目”“有项目但无 SSTS”“有 EE/SSTS 数据”五类状态的区别；
- 本任务不是 EE 权限迁移、D4B、Memory 或完整前端重设计。

## 3. 已知耦合热点

下列只是起始清单，不能替代全仓扫描：

- `product/apps/web/src/WorkbenchShell.vue` 中静态“项目总览/工程/需求/资料/成果/任务”导航；
- `providerMode === "ee-connected"` 直接控制界面，而不是实际数据/能力；
- 顶栏“EE 已连接 / EE 暂不可用”；
- `ee.list_requirements`、`ee.list_functions`、`ee.get_function_ssts_matrix`、`ee.list_ssts`、`ee.get_ssts` 等协议键直接进入页面逻辑；
- “EE MCP”“EE 技术规范”“SSTS 草稿”等固定来源和场景文案；
- `principal.ee_account`、EE 登录名、EE 账号 ID 的默认展示；
- 没有实际项目数据时仍展示项目导航、项目空态、项目刷新入口；
- `/assets/project-car.jpg`、合成工程演示数据等场景资产；
- App 初始化、恢复和 retry 后对 projects/tasks/catalog/approvals 的请求条件；
- `product/apps/web/src/PersonalHome.vue`、`product/apps/web/src/ExecutionWorkbench.vue`、`product/apps/web/src/App.vue`、类型定义和测试 fixture 中的隐式 EE/SSTS 假设；
- 深链接、刷新、项目撤权或 Provider 从 READY 变为 UNAVAILABLE 后残留的项目名称、代码、任务、Catalog 和详情抽屉。

内部 Adapter、合同、Tool definition 和测试协议中的 `ee.*` 名称不要求删除。必须区分“内部协议标识”和“用户默认体验泄漏”。

## 4. 强制体验状态矩阵

先冻结矩阵与测试，再改实现：

| 状态 | 默认体验 | 项目导航 | Provider 品牌/账号 | SSTS/EE 工具 | 网络请求 |
| --- | --- | --- | --- | --- | --- |
| Standalone / Provider 未配置 | 个人 PC 首页与对话 | 不显示 | 不显示 | 不显示 | 零 EE/项目请求 |
| Provider 已配置但不可用 | 个人体验；必要时显示 Provider 中立的能力不可用提示 | 不显示或禁入，不显示项目内容 | 默认不显示 EE 名称；诊断详情除外 | 不显示 | 不请求项目目录以外的业务数据，不循环重试 |
| Provider 可用、当前授权项目为零 | 个人体验 | 不显示 | 不显示项目型 EE 内容 | 不显示 | 只完成确定零项目所需请求，不请求 Catalog/项目资料 |
| 有授权项目、无 SSTS/工程能力 | Provider 中立项目体验 | 只显示实际支持的项目入口 | 可在实际数据来源处显示 Provider display name | 不显示 SSTS/EE 专用入口 | 只请求项目实际能力 |
| 有授权项目且 Catalog 提供 SSTS/工程能力 | 对应纵向场景体验 | 显示受支持入口 | 来源标签可显示 EE | 显示已授权、已装配能力 | 请求当前项目已授权接口 |
| READY -> UNAVAILABLE / 撤权 / 零项目 | 立即回到个人体验或安全空态 | 清除 | 清除外部项目标识 | 清除 Tool/Catalog/详情 | 停止后续项目请求，旧数据不得继续渲染 |

补充规则：

- “暂无授权项目”不是 EE 页面存在的理由；零项目时整个项目体验应退出默认信息架构；
- Provider 不可用与零授权项目必须保持语义不同，但普通用户提示应 Provider 中立；
- 技术诊断可以保留 `provider_id`，默认页面、导航和普通账号面板不显示内部 Provider 名称；
- 如果用户从有效项目页面失去访问，必须关闭详情抽屉、清空 project selection、facts、tools、Catalog、SSTS 和项目任务投影；
- URL 深链接不能绕过体验投影恢复隐藏内容。

## 5. 工作包与执行顺序

必须按 FPI-0 至 FPI-6 顺序执行。不得先批量替换字符串再补设计。

### FPI-0：全仓踪迹盘点

1. 扫描 `product/apps/web`、前端 API/type、API presentation、测试和演示资产；
2. 生成 `product/docs/frontend-provider-isolation-inventory.md`；
3. 每个命中分类为：
   - 用户可见品牌/文案；
   - 静态导航或布局；
   - 场景能力判断；
   - 内部协议键；
   - Provider 身份字段；
   - 测试 fixture；
   - 演示资产；
   - 文档或诊断信息；
4. 对每项标记 `REMOVE`、`GATE`、`ADAPT`、`KEEP_INTERNAL` 或 `KEEP_DIAGNOSTIC`；
5. 记录当前网络请求图：启动、登录、首页、项目页、retry、撤权/故障转换。

准出：没有“只扫描 `EE` 大写字符串”的假盘点；`ee.*`、SSTS、项目默认值、资产和隐式布尔判断均覆盖。

### FPI-1：Provider 中立 Experience Projection

建立单一、可测试的前端体验策略模块，名称可按现有风格确定，例如 `experience-policy.ts`。输入只能来自受信的当前状态：

- Core/Personal/Project Capability Availability；
- 当前 Project Directory 结果及其有效性；
- 当前 Catalog/Profile/Tool 能力；
- 当前选中项目是否仍在授权目录；
- 当前任务/业务投影是否属于可见项目；
- Provider display metadata，仅用于真实数据来源展示。

输出至少包括：

- `showProjectSurface`；
- `visibleNavigationItems`；
- `showProviderStatus`；
- `showEngineeringExperience`；
- `showSstsExperience`；
- `showProviderIdentityDetails`；
- `projectSelectionValid`；
- `clearExternalStateReason`；
- 允许执行的项目请求集合。

禁止继续让多个 Vue 组件分别根据 `providerMode`、项目数组和任务字段猜测体验状态。若现有 C65/Project Directory/Catalog 足够，不新增合同；确实不足时只能做最小、版本化、Provider 中立的 additive projection，并同步 schema、fixture、traceability 和 compatibility。

准出：矩阵中每个状态都能由纯函数测试稳定得到唯一体验结果。

### FPI-2：应用壳、导航与账号隔离

1. 左侧导航由 Experience Projection 生成，零项目/无项目能力时不出现项目总览、工程、需求、资料、成果、项目任务等入口；
2. 顶栏默认只显示 PC/个人状态，不硬编码“EE 已连接/暂不可用”；
3. Provider 不可用时使用 Provider 中立文案，例如“企业项目能力暂不可用”，不得把具体 Provider 当产品身份；
4. 账号面板默认显示 PC Principal/登录账号；仅在存在当前可用的 Provider identity evidence 且用户展开诊断详情时显示 Provider 身份；
5. 零项目时不显示“EE 登录名”“EE 账号 ID”“可访问项目：暂无授权项目”等无意义 Provider 痕迹；
6. 删除或严格 gate 演示车辆图片、合成工程标记和固定场景视觉；没有真实项目数据时不得渲染。

准出：Standalone、Provider unavailable 和 ready-zero-projects 三种页面首屏均看不到 EE/SSTS/演示项目痕迹。

### FPI-3：项目与纵向场景按能力装配

1. 项目存在不等于 SSTS 存在；根据当前 Catalog/Profile/Tool capability 装配工程、需求、SSTS、资料和成果入口；
2. 将 `ee.*` facts 解析集中到 Provider/场景 adapter，模板不直接读取协议键；
3. “EE MCP”“EE 技术规范”只在真实 EE 数据已经显示时作为来源标签出现；无数据时不显示空表标题；
4. 没有 SSTS capability 时，不显示 SSTS 草稿、规范矩阵、规范详情或 SSTS 空态；
5. Tool/Catalog 中没有对应能力时，不显示不可执行按钮；
6. 任何项目页面仍需请求时授权，前端 capability 只用于发现和装配。

准出：同一个项目可在“通用项目”“工程项目”“SSTS 项目”间按能力组合，页面不再假定 EE 项目必然等于 SSTS。

### FPI-4：状态转换、深链接与陈旧数据清理

覆盖：

- Standalone -> Provider READY；
- READY -> UNAVAILABLE；
- READY -> 零授权项目；
- 项目 A -> 项目 B；
- 当前项目被撤权；
- Catalog revision 删除 SSTS capability；
- retry 失败与成功；
- 页面刷新和直接深链接隐藏路由。

转换时必须原子清理项目选择、facts、tools、Catalog、SSTS、详情抽屉、项目任务和 Provider identity display。不得短暂显示旧项目名称或旧数据。异步旧请求结果必须使用 generation/request token 丢弃。

准出：撤权或不可用后，DOM、可访问名称、ARIA 文本和浏览器 history 中都不能继续恢复外部项目内容。

### FPI-5：请求控制与错误语义

1. 隐藏的界面不得在后台继续请求 Project Directory、Catalog、project-data、approvals 或 Provider details；
2. 不可用、零项目、无能力、权限拒绝和空数据使用不同内部状态；
3. 普通用户看到 Provider 中立、可行动的提示；诊断细节保留稳定错误码；
4. retry 失败不走成功刷新路径；成功后重新计算 Experience Projection，而不是直接恢复旧项目；
5. 禁止基于缓存项目数组把 Provider 误判为可用。

准出：浏览器测试能精确断言每种状态的请求清单，隐藏状态没有无意义或越界请求。

### FPI-6：文档、验证与状态收口

1. 新增 `architecture/frontend-provider-neutral-experience-v1.md`；
2. 新增 `product/docs/frontend-provider-isolation-01-verification.md`；
3. 更新相关 README、Compatibility/Traceability（仅在合同或架构索引变化时）；
4. 任务完成只能写 `FRONTEND-PROVIDER-ISOLATION-01 DEVELOPER VERIFIED`；
5. 不得写 D4B、D4 或生产体验全部完成。

## 6. 强制测试矩阵

至少覆盖桌面 1440px 和移动 390px：

1. Standalone：无 EE、SSTS、项目导航、Provider 请求或演示资产；
2. Provider UNCONFIGURED：与 Standalone 等价的个人体验；
3. Provider UNAVAILABLE：通用不可用提示，个人对话可用，零项目业务请求；
4. Provider READY + 零项目：无项目导航、无 Provider 项目品牌、无 Catalog 请求；
5. 有通用项目但无 SSTS capability：显示项目，不显示 SSTS/EE 专用内容；
6. 有 EE 工程数据但无规范数据：只显示存在的数据，不显示空的“EE 技术规范”板块；
7. 有 EE + SSTS capability/data：显示完整场景与来源标签；
8. READY -> UNAVAILABLE：旧项目代码、名称、facts、tools、详情和账号 Provider 字段从 DOM 清除；
9. 项目撤权/零项目：不能通过深链接、后退、刷新或异步晚到响应恢复；
10. Catalog revision 删除能力：对应导航和按钮立即消失；
11. retry 配置/transport 失败：不显示成功提示，不刷新项目；
12. retry 成功但零项目：仍保持个人体验，不恢复项目导航；
13. 账号面板：无当前 Provider evidence 时不出现 EE 登录名/ID；
14. 可访问性：隐藏内容不残留在可访问树中，无重叠、横向溢出和控制台错误；
15. 网络断言：每个状态只发送矩阵允许的请求。

测试要求：

- Experience Projection 使用纯函数单测；
- Vue/DOM 测试覆盖组件状态；
- Headless Chrome 使用真实生产构建和本地合成 API fixture，明确标注不是 EE 业务验收；
- 至少对 Standalone、零项目、Unavailable、通用项目、完整 EE/SSTS 五种状态截图；
- 对最终截图进行人工视觉检查；
- 运行 `pnpm check`、前端 e2e、`git diff --check` 和敏感信息扫描；
- 测试结束停止所有任务进程，不清理无关资源。

## 7. 验收标准

只有全部满足才能交付：

1. 有完整 EE/SSTS/项目踪迹清单和处置结果；
2. 默认产品壳不再以 EE/SSTS 为信息架构；
3. 无当前授权项目数据时，DOM 和可访问树不存在 EE 项目内容；
4. Provider unavailable 与零项目语义正确且都不泄漏旧数据；
5. 项目与纵向场景按当前 Capability/Catalog 装配；
6. 内部 `ee.*` 协议已集中隔离，不直接散落在模板；
7. 当前授权丢失后旧项目内容和晚到响应均被清除；
8. 隐藏界面不会继续发送项目业务请求；
9. PC-only 首页、个人对话、个人任务和现有 D4A 故障体验不回归；
10. EE 数据存在且授权有效时，现有项目/SSTS 演示能力不回归；
11. 全量门禁、桌面/移动 e2e、截图和网络断言通过；
12. 形成验证记录、限制和独立复验入口。

## 8. 非目标

- 删除 EE Adapter、`ee.*` Tool schema 或内部 Provider 合同；
- 修改 EE 源码、EE schema、共享数据库或 DSH Core；
- 把 EE 权限复制到 PC；
- D4-2 跨实例 Health、D4-3 Operation Resolver、D4-4 撤权 Fan-out；
- MEMORY-01B；
- 第二个真实业务 Provider；
- 完整设计系统重写、全站视觉重构或营销页面；
- 生产 IAM、远程部署、旧演示环境重建；
- 用前端隐藏代替后端授权。

## 9. 停止与升级条件

出现以下任一情况立即停止并报告：

1. 必须修改 EE/DSH/schema/共享数据库或生产配置；
2. 需要复制外部权限或缓存源系统 Allow 才能渲染；
3. 当前 API 无法区分 unavailable、零项目和无能力，且需要破坏性合同变更；
4. 无法在不泄漏旧项目数据的前提下处理异步晚到响应；
5. 任务扩展为通用插件市场、第二 Provider 或 D4B；
6. 发现未知用户改动与任务范围重叠，无法安全区分；
7. 为了保留演示页面必须伪造项目、Catalog 或 Provider 数据。

如确需最小 additive API/contract，先在交付报告中明确理由、兼容性和影响面；不得静默把 `provider_mode` 改成授权或体验真相。

## 10. 交付报告格式

完成时报告：

1. 全部 EE/SSTS/项目踪迹分类与最终处置；
2. Experience Projection 输入、输出和状态矩阵；
3. 导航、账号、项目、SSTS、来源标签和演示资产的变化；
4. 状态转换和陈旧数据清理证据；
5. 网络请求矩阵；
6. 桌面/移动截图路径与人工检查结论；
7. 完整测试命令、通过/跳过数；
8. 已知限制和独立复验建议；
9. 本地提交哈希、工作区状态、是否 push/部署/触碰外部仓库。

验证全部通过后允许创建一个本地提交。不得 push、部署或自动进入 D4B/MEMORY-01B，除非用户另行明确授权。

## 11. 可直接发送给主力开发的开场 Prompt

```text
执行任务 FRONTEND-PROVIDER-ISOLATION-01。

唯一任务书：
E:/shanzi_workspace/process-copilot-harness/governance/FRONTEND-PROVIDER-ISOLATION-01-TASK.md

主实现仓库：
E:/shanzi_workspace/process-copilot-harness

先完整读取任务书、仓库 AGENTS.md、README.md、SOURCE-BASELINE.md、ADR-0024、D4A 架构/验证记录和 C61-C66，再核对当前 HEAD、remote 与工作区状态并输出开始前对齐块。当前 HEAD 应包含本任务书的本地治理提交；`efadcd3` 是本任务开始前的业务实现基线，不要为匹配该哈希而回退任务书提交。

任务目标不是批量删除 EE 文案，而是建立 Provider 中立、由当前授权数据和 Capability/Catalog 驱动的前端体验。没有当前授权项目或对应场景能力时，不得显示 EE 项目、SSTS、EE MCP、EE 账号、演示项目资产或静态项目导航；EE/SSTS 数据真实存在且当前授权有效时，现有纵向能力必须保留。

严格按 FPI-0 到 FPI-6 执行。先形成全仓踪迹清单和体验状态矩阵，再写测试、实现 Experience Projection、改造应用壳/导航/账号/项目与场景装配，最后完成桌面和移动浏览器验收。必须覆盖 Standalone、Unavailable、READY 零项目、通用项目无 SSTS、完整 EE/SSTS、撤权/故障转换、深链接和异步晚到响应。

内部 EE Adapter、ee.* Tool 协议和合同可以保留，但必须隔离在 adapter/view-model 后，不得成为默认产品体验。前端隐藏不能替代 PC+源系统请求时授权，不得复制 EE 权限或缓存 Allow。

不得进入 D4B、MEMORY-01B、第二 Provider、完整视觉重构；不得修改 EE、DSH Core、共享数据库、schema、.env、生产设置、旧 Product/EE 工作树或 192.168.31.95。若现有 API 无法安全表达体验状态，只允许提出最小 additive Provider 中立合同并说明兼容性，不能自行扩大范围。

完成后运行 pnpm check、全部相关前端测试、桌面/移动生产构建 e2e、git diff --check 和敏感信息扫描；停止所有任务进程。状态只能写 FRONTEND-PROVIDER-ISOLATION-01 DEVELOPER VERIFIED，创建本地提交但不要 push、部署或自动继续下一任务。
```
