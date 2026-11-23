# ADR-0025 T1A：PC Session 与数据源实时验证拆分任务书

- 任务编号：`ADR-0025-T1A-PC-SESSION-SOURCE-VALIDATION-SPLIT`
- 状态：`READY FOR IMPLEMENTATION / T1A NOT STARTED / T1B NOT AUTHORIZED`
- 日期：2026-11-23（Asia/Shanghai）
- 架构依据：ADR-0024、ADR-0025（Accepted）
- 合同依据：C67 `pc.session-assurance/1`、C68 `pc.authority-decision/1`、C69 `pc.provider-compatibility-mapping/1`
- 业务基线：`e594699d67f3f3e24c06fb688a2322ae70730dda`；任务书提交位于该基线之后，不得为匹配哈希而回退
- 主仓库：`E:/shanzi_workspace/process-copilot-harness`
- 目标缺陷：`product/docs/real-ee-integration-closure-01.md` 的 RCI-02
- 完成性质：T1A 运行边界开发者验证；不等于 T1 全部完成、T2 权限交集完成、真实 EE 最终验收或生产资格

## 1. 本阶段要解决的问题

当前每个 Bearer 请求执行：

```text
IdentityAuthorizationService.authenticate()
  -> global sessionValidator
  -> eeBundle.identity.validate()
  -> live EE API
```

`/v1/identity/me` 在完成上述认证后又调用一次 Provider `validate()`。因此 EE API/MCP 不可达时，一个仍在 PC 固定有效期内、未撤销的 PC Session 也无法访问个人对话、个人任务和其他 PC-owned 能力。

T1A 将请求分为两个不同问题：

1. 当前 PC Session 是否仍由 PC 信任；
2. 当前请求是否需要数据源的实时身份/业务授权。

PC-owned 请求只回答第一个问题。Provider-owned 请求必须继续回答两个问题，并取得当前 Provider Allow。

## 2. 冻结的授权模型

### 2.1 PC 自有授权

PC 是以下对象和行为的权威：

- PC Principal、PC Session 及本地生命周期；
- 个人 Conversation、Task、Memory；
- Profile、Plugin 和 Tool/MCP 的 PC 使用资格；
- PC Approval、Audit 和 Harness 管理 action；
- PC Policy 的 action、scope、Deny 和 revision。

T1A 不建设完整 IAM、组织 RBAC 或管理 UI，只拆分 Session 信任边界。

### 2.2 外部数据源授权绑定

“数据源授权给 PC”在本项目中的精确定义是：

```text
verified PC Principal
  + verified ExternalIdentityLink
  + active ExternalAccountBinding / Connector binding when execution needs it
  + exact Provider authority route
  + current source authorization
```

这些对象允许 PC 代表已绑定主体请求数据源，但不是 PC Grant，也不是 Provider Allow 缓存。

T1A 只保留并验证现有绑定边界，不新增通用 Binding 表或复制 EE 权限。T2 才把该模型正式接入 C68/C69 交集决策。

### 2.3 最终决策

| 请求类型 | T1A 要求 |
| --- | --- |
| PC-owned | 有效 PC Session + active PC Principal + PC scope/policy；零 Provider 网络调用 |
| Provider-owned | 有效 PC Session + PC Allow + exact route/binding + 当前 Provider Allow |
| 未知/歧义 | Deny，不回退 PC-only |

## 3. 开始前必须读取

按顺序完整读取：

1. `C:/Users/29557/Documents/ChatGPT/山子- PC/AGENTS.md`、`HANDOFF.md`、`workspace.paths.json`、`migration/source-snapshot.json`；
2. 仓库 `AGENTS.md`、`README.md`、`SOURCE-BASELINE.md`；
3. `governance/PROCESS-COPILOT-NEXT-PHASE-ROADMAP.md`；
4. ADR-0010、ADR-0017、ADR-0024、ADR-0025；
5. T0 任务书、`architecture/adr-0025-t0-contract-and-compatibility-v1.md`、T0 verification；
6. `product/docs/real-ee-integration-closure-01.md` 的 RCI-02、RCI-03、RCI-04；
7. `product/packages/domain/src/identity-authorization.ts`；
8. `product/packages/application/src/identity-authorization.ts`；
9. memory/PostgreSQL Identity Authorization repositories 和相关测试；
10. `product/apps/api/src/main.ts`、`server.ts`、`ee-login.ts`、`ee-provider-bundle.ts`、`workbench.ts`；
11. Authority Router、Gateway、External Account Binding 和 Provider Health 现有实现。

编码前输出对齐块，至少确认：

- 当前分支、HEAD、remote、工作树和与 `origin/main` 的关系；
- T0 已完成，C67-C69 不允许在 T1A 改 major 语义；
- 当前全局 `sessionValidator` 和 `/v1/identity/me` 的 Provider 调用位置；
- 当前 `expires_at` 继续按固定 absolute expiry 使用；
- 本任务不改 PC/EE 数据库 schema，不改 EE 或 DSH Core；
- RCI-03、RCI-04、T1B、T2、D4B、MEMORY-01B 不在本任务内。

## 4. 工作包与执行顺序

必须按 T1A-0 至 T1A-5 顺序执行。先建立失败证据，再修改实现。

### T1A-0：调用清单和失败测试

1. 列出所有由 Bearer Session 保护的 API，并按 `PC_ONLY`、`PC_AND_PROVIDER`、`DENY_UNKNOWN` 分类；
2. 明确哪些路由当前因为 `authenticate()` 间接调用 EE；
3. 增加失败测试，复现有效 EE-backed PC Session 在 Provider unavailable 时：
   - `/v1/identity/me` 失败；
   - personal task/list/read 或个人 conversation 路径失败；
4. 增加 Provider 调用 spy/counter，证明失败来自每请求源验证；
5. 记录修改前失败数量和错误码，不提交大型临时日志。
6. 确认 `check-adr0025-t0.mjs` 使用长期兼容模式：保护 T0 合同、Oracle 和 golden 基线，但不把后续已授权 Runtime 变化误判为 T0 越界。

准出：RCI-02 在确定性测试中稳定复现，且未用 mock 绕过真实运行调用边界。测试 double 只能用于记录 Port 调用和故障注入，不能冒充真实 EE 验收。

### T1A-1：拆分 PC Session 验证

1. `IdentityAuthorizationService.authenticate()` 只验证 PC 持有的事实：
   - token digest 对应的 Session 存在；
   - 当前时间早于现有固定 `expires_at`；
   - Session 未撤销；
   - PC Principal 存在且 active；
   - Provider-backed Session 对应的本地 Identity Link 仍为 verified；
2. 普通 PC Session 认证禁止发起 Provider 网络请求；
3. 移除或重构全局 live-source `sessionValidator`，不得只是捕获并忽略 EE 错误；
4. 不滑动、延长或重签 `expires_at`；
5. 不在 Provider unavailable 时签发、续期或重新认证 Provider-backed Session；
6. 不把 EE-backed Session 转换为 Local/Standalone Session；
7. 不新增 Provider Cookie、Token、Secret 或可复用 Allow。

由于 T1A 禁止 schema 变更，现有 `expires_at` 继续承担 absolute expiry 语义。完整 C67 字段持久化和 session-bound revision 比较属于 T1B；不得在本阶段声称完成。

### T1A-2：PC-owned 与 Provider-owned 请求分流

1. `/v1/identity/me` 只返回 PC 本地可证明的 Principal、login provider 标识、PC authentication context 和 fixed expiry；
2. `/v1/identity/me` 不得为了展示外部账号详情实时调用 Provider；Provider 账号详情不可用时应省略，而不是阻断 PC identity；
3. personal Conversation/Task/Memory/Profile 等 PC-owned 路径不得调用 EE Identity、Directory、Catalog、Authorization、Projection 或 MCP Port；
4. project、EE Tool/MCP、EE business object 和 Provider-backed Approval 仍通过 exact authority route、Binding 和当前 Provider Authorization；
5. Provider unavailable、Binding missing/revoked、route missing/ambiguous 或 Provider Deny 时稳定拒绝；
6. 不允许 Provider-owned 路径因 Bundle 不可执行而回退到 PC_ONLY；
7. 保持 Standalone 行为和既有 EE healthy 行为兼容。

准出：PC-owned 网络断言为零 Provider 调用；Provider-owned 请求仍至少一次取得当前源授权，且无跨请求 Allow 复用。

### T1A-3：Session 生命周期和安全回归

至少覆盖：

| 场景 | 必须结果 |
| --- | --- |
| EE-backed PC Session 有效、EE unavailable、PC_ONLY | Allow；零 EE 调用 |
| 同一 Session 请求 EE project/tool | Deny/Unavailable；不使用历史 Allow |
| Provider unavailable 时新 EE 登录 | Deny |
| Provider unavailable 时续期/重认证 | Deny；绝对到期不变 |
| fixed expiry 到达 | PC Session Deny |
| PC Session revoke/sign-out | Deny |
| PC Principal disabled | Deny |
| 本地 Identity Link revoked/missing | EE-backed PC Session Deny，不请求 EE |
| authorization revision 变化 | 后续 Snapshot/Envelope 使用当前 revision，旧执行证据不得继续 |
| Provider 恢复 | 新 Provider-owned 请求重新实时授权；旧 Allow 不复用 |
| Standalone Session | 行为不变且零 EE 装配 |

T1A 不得声称已完成跨实例即时撤权或完整 session-bound revision 持久化。

### T1A-4：隔离验证

依次执行：

1. Identity/Application/API 定向单元测试；
2. T0 C67-C69 合同与 compatibility baseline 检查；
3. 全量 `pnpm check`；
4. 在任务自有的本地隔离条件下做 closed-port/source-unavailable 启动烟测；
5. 如已存在可安全复用的任务专属 Compose，可做隔离 PostgreSQL 重启验证；禁止连接共享数据库、旧演示数据库或 `192.168.31.95`；
6. 检查任务进程全部停止，保留失败证据，不清理用户数据卷。

本阶段不要求启动真实 EE 业务环境。若使用 fake/closed port，只能声称边界和故障行为验证，不能声称真实 EE 集成通过。

### T1A-5：状态收口

形成 `product/docs/adr-0025-t1a-verification.md`，记录：

- 修改前 RCI-02 复现；
- API 分类清单；
- Session 验证拆分后的调用图；
- PC_ONLY 零 Provider 调用证据；
- Provider-owned fail-closed 证据；
- fixed expiry、撤销、恢复和 Standalone 回归；
- 测试通过/跳过数及未执行项；
- T1B、RCI-03、RCI-04、T2 的剩余边界；
- 服务、数据库、Docker、EE、远端和工作树状态。

完成后只允许标记：

```text
T1A COMPLETE / T1B NOT STARTED / RCI-02 FIXED_PENDING_REAL_RETEST
```

不得标记 T1 全部完成或 REAL-EE-INTEGRATION-CLOSURE-01 通过。

## 5. 允许修改范围

- Identity Authorization domain/application 的 Session 验证边界；
- API `main.ts`、`server.ts`、`ee-login.ts` 中与本任务直接相关的接线；
- 必要的 Provider/Workbench 路由分类与测试辅助；
- memory/PostgreSQL repository 的查询行为或测试，但不得改变表结构；
- 对应单元、API、兼容和故障测试；
- T1A verification、README 和路线图状态。

## 6. 禁止修改范围

- PC 或 EE 数据库 schema、migration、表、索引和共享数据；
- EE 源码、EE V1 API、Role/Page/Action、账号、项目成员或业务数据；
- DSH Core、Runtime 协议、模型配置和生产设置；
- C67-C69 major 语义、EE V1 零迁移兼容或现有 Deny 规则；
- `.env`、端口、技术版本、共享服务或 `192.168.31.95`；
- RCI-03 Operation Projection、RCI-04 UI 文案、T1B、T2、D4B、MEMORY-01B；
- push、部署、合并、清理历史证据或删除数据卷。

## 7. 停止条件

出现以下情况停止并报告，不自行扩大范围：

1. 必须修改数据库 schema 才能安全解除 RCI-02；
2. 无法区分 PC-owned 与 Provider-owned 请求；
3. Provider-owned 请求只能依赖缓存 Allow 才能工作；
4. 必须复制 EE Role/Page/Action、项目成员或业务权限到 PC；
5. 移除全局源验证会让 Provider-owned 请求绕过当前授权；
6. fixed expiry 会被滑动或 Provider unavailable 时能续期；
7. 发现未知工作树改动且无法安全隔离；
8. 需要共享数据库、生产服务或远端部署才能验证；
9. T0 合同、D4A generation fencing 或 Standalone 回归失败。

## 8. 全量准出条件

只有以下全部满足才能标记 T1A COMPLETE：

1. `authenticate()` 对 PC Session 的正常请求不调用 Provider；
2. `/v1/identity/me` 不因 EE unavailable 失败；
3. 有效 EE-backed PC Session 在 EE unavailable 时可使用至少一条真实 PC personal conversation 路径和 personal task 路径；
4. PC_ONLY 路径的 Provider 调用计数为 0；
5. 同一故障下所有 Provider-owned 读取、Tool/MCP 和写入口稳定 fail closed；
6. Provider unavailable 时不能新登录、续期或重认证；
7. fixed expiry、sign-out/revoke、principal disabled 和本地 link revoked/missing 均拒绝；
8. EE healthy 现有登录和外部请求行为保持；
9. Standalone 行为保持；
10. C67-C69、C41/C42、D3/D4A 兼容门禁通过；
11. `pnpm check`、`git diff --check`、敏感信息扫描通过；
12. 没有修改 schema、EE、DSH、Runtime、环境和远端；
13. 验证文档准确声明 T1B、RCI-03/04、T2 和真实 EE 复验未完成；
14. 创建一个本地提交后工作树干净，不 push。

## 9. 后续阶段

- T1B：经单独授权后持久化完整 C67 assurance、identity/authorization revision、idle/absolute expiry 和旧 Session 迁移；
- RCI-03：独立修复 Gateway KNOWN_SUCCESS 到 Business Operation SUCCEEDED 的投影闭环；
- T2A：PC Policy action/scope 统一生成 C68；
- T2B：解析 ExternalIdentityLink、ExternalAccountBinding 和 authority route，形成 External Authority Binding；
- T2C：C69 Mapping + 当前 Provider Authorization + PC Decision 交集；
- T3：真实 EE 断连、恢复、撤权、到期、重登、多账号和审计验收。

## 10. 可直接发送给主力开发的 Prompt

```text
执行任务 ADR-0025-T1A-PC-SESSION-SOURCE-VALIDATION-SPLIT。

唯一任务书：
E:/shanzi_workspace/process-copilot-harness/governance/ADR-0025-T1A-PC-SESSION-SOURCE-VALIDATION-SPLIT-TASK.md

主仓库：
E:/shanzi_workspace/process-copilot-harness

先完整读取任务书以及“开始前必须读取”的全部文件，核对当前 branch、HEAD、origin/main 和工作树，再输出开始前对齐块。业务基线是 e594699，但任务书提交位于其后；不要为匹配基线回退任务书或任何合法提交。

严格按 T1A-0 到 T1A-5 执行。先用失败测试复现：当前 EE-backed PC Session 会因为每请求调用 eeBundle.identity.validate 而在 EE unavailable 时阻断 /v1/identity/me、personal task 和 personal conversation。然后拆分 PC Session 本地验证与数据源实时验证。

完成后，PC-owned 请求只依赖有效 PC Session、active Principal、本地 verified identity link 和 PC policy/scope，且 Provider 网络调用必须为 0；Provider-owned project、Tool/MCP、business object 和写操作仍必须经过 exact authority route、有效绑定及当前 Provider Authorization，任何 unavailable、missing、revoked、unknown 或 ambiguous 都 fail closed。

保持现有 expires_at 的固定 absolute-expiry 语义，不得滑动延长；Provider unavailable 时不得新登录、续期或重认证，不得把 EE-backed Session 转为 Local/Standalone。/v1/identity/me 不得为展示外部账号详情实时调用 Provider，无法本地证明的账号详情应省略而不是阻断 PC identity。

本任务禁止修改任何 PC/EE 数据库 schema、EE 源码、DSH Core、Runtime 协议、C67-C69 major 语义、.env、端口、技术版本、共享环境和 192.168.31.95；禁止处理 RCI-03、RCI-04、T1B、T2、D4B 或 MEMORY-01B。测试 double 只能做调用计数和故障注入，不能冒充真实 EE 验收。

完成定向测试、PC_ONLY 零 Provider 调用断言、Provider-owned fail-closed 回归、fixed expiry/revoke/link/Standalone 回归、T0/no-touch 兼容门禁和 product/pnpm check。形成 product/docs/adr-0025-t1a-verification.md。

全部通过后创建一个本地提交，但不要 push、部署或自动进入下一阶段。最终只能报告 T1A COMPLETE / T1B NOT STARTED / RCI-02 FIXED_PENDING_REAL_RETEST，并明确 RCI-03、RCI-04、T2 和真实 EE 最终验收未完成。遇到任务书停止条件立即停止并报告，不自行扩大范围。
```
