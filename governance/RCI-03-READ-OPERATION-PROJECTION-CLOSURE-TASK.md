# RCI-03：READ Operation Projection 闭环任务书

- 任务编号：`RCI-03-READ-OPERATION-PROJECTION-CLOSURE`
- 状态：`RCI-03 READ PROJECTION FIXED_PENDING_REAL_RETEST / WRITE VERIFICATION NOT EXPANDED / T1B、RCI-04、T2、T3 NOT STARTED`
- 日期：2026-11-23（Asia/Shanghai）
- 主仓库：`E:/shanzi_workspace/process-copilot-harness`
- 实现基线：`51c8fd4e0e738d18624cec8f992d90b7fd9028b0`
- 缺陷入口：`product/docs/real-ee-integration-closure-01.md` 的 RCI-03
- 架构依据：ADR-0007、ADR-0008、ADR-0011、ADR-0024、ADR-0025
- 合同依据：C22 `pc.tool-execution-result/1`、C24 `pc.external-operation-record/1`、C28 `pc.business-operation/1`、C30 `pc.reconciliation-result/1`
- 完成性质：READ Operation 的确定性投影闭环和开发者验证；不等于写操作闭环、真实 EE 最终复验或生产资格

## 1. 当前问题

真实 EE/MCP 读取曾出现以下持久化分裂：

```text
MCP response: SUCCEEDED / KNOWN_SUCCESS + real EE Trace
Gateway ExternalOperationRecord: KNOWN_SUCCESS
BusinessOperation projection: VERIFYING
```

历史证据中有 75 条 Gateway `KNOWN_SUCCESS`，但对应 Business Operation
仍为 75 条 `VERIFYING`、0 条 `SUCCEEDED`。这不是 UI 刷新问题，而是持久状态没有完成验证闭环。

现有 Gateway 按 ADR-0011 有意只把 Provider 成功推进到 `VERIFYING`，因为
ToolResult 成功不能直接等价于业务成功。缺口是：对无外部副作用的 READ，系统没有在
校验持久 Gateway 记录、结果摘要和 Provider 证据后产生 `pc.operation.verified`；重复调用
命中 Gateway 幂等结果时，也没有修复停留在 `VERIFYING` 的业务投影。

此外，现有 `POST /v1/business-operations/:operationId/verify` 接受调用方提交的
`evidence_refs` 和可选 `result_digest`，然后直接请求转为 `SUCCEEDED`。本阶段必须把它改成
“请求系统执行验证”，不能让请求方自己声明外部事实。

## 2. 冻结的状态语义

### 2.1 READ 可以完成的验证

READ Operation 只有同时满足以下条件才能从 `VERIFYING` 进入 `SUCCEEDED`：

1. C28 Business Operation 存在，tenant、principal、business task 和 operation id 一致；
2. `operation_kind === READ`；
3. 对应 C24 External Operation Record 已持久化；
4. Gateway 记录为 `dispatch_state=COMPLETED`、`outcome_state=KNOWN_SUCCESS`；
5. 对应 C22 Result 为 `status=SUCCEEDED`、`outcome_state=KNOWN_SUCCESS`；
6. Result 的 `operation_id` 与 C24/C28 完全一致；
7. C28/C24/C22 的结果摘要可重新计算且一致；
8. Provider evidence 至少包含可审计的稳定引用，例如 Provider operation/Trace 引用；
9. 当前记录不是 `OUTCOME_UNKNOWN`、`KNOWN_FAILURE`、in-progress 或缺失状态；
10. 推进事件由系统 verifier 产生，保存 verifier 版本和证据引用。

READ 没有外部写副作用，因此“持久 Gateway 结果 + 摘要一致 + Provider 证据”可以作为
本阶段的业务读取完成证据。它仍然不是把 Runtime 内存里的 ToolResult 直接当作成功。

### 2.2 WRITE/DESTRUCTIVE 不在本阶段自动成功

以下 Operation 即使 Gateway 返回 `KNOWN_SUCCESS`，本阶段也不得仅凭该结果自动标记
`SUCCEEDED`：

- `WRITE`
- `DESTRUCTIVE`
- `EXTERNAL_SIDE_EFFECT`

它们仍需 Provider-specific readback、C30 reconciliation 或明确的业务验证器。缺少回读时
保持 `VERIFYING`；结果未知时保持 `OUTCOME_UNKNOWN` 并进入既有恢复流程。

### 2.3 幂等与崩溃窗口

验证必须支持：

- 同一 Operation 多次验证只产生一个有效终态；
- Gateway 已持久化成功、但 API 在投影前崩溃时，重试可补齐 `VERIFYING -> SUCCEEDED`；
- Gateway 幂等命中已知结果时仍会运行验证，而不是直接返回并永久留下旧投影；
- 多实例并发验证使用现有 revision/event 幂等机制，不覆盖更晚状态；
- 已经 `SUCCEEDED` 的同一事实返回当前结果，不追加冲突事件；
- 任何 scope、digest、evidence 或状态不一致均 fail closed，不猜测成功。

## 3. W0：T1A 状态收口

在 RCI-03 编码前完成两个小收口，不扩大到 T1B/T2：

1. 将 README、路线图和必要索引从 `T1A READY` 更新为
   `T1A COMPLETE / RCI-02 FIXED_PENDING_REAL_RETEST`；
2. 将 Workbench 结束后重授权中对 `project:` 字符串前缀的判断替换为与
   Authority Router 相同的精确 route classification；unknown/ambiguous 继续 Deny；
3. 增加当前 project route、PC-only route、unknown route 的回归测试；
4. 不改变 C67-C69 major 语义，不新增 Session schema。

W0 只能修正状态漂移和未来 Provider scope 的安全扩展点，不能顺带实施 T1B/T2。

## 4. 工作包与顺序

### RCI03-0：先建立失败证据

1. 使用真实 `ControlledExecutionGatewayService`、`EventProjectionService`、memory repository
   和现有 Gateway event publisher 建立集成测试；
2. 执行一个 READ Tool，证明 C22/C24 已为 `SUCCEEDED/KNOWN_SUCCESS`，而 C28 仍为
   `VERIFYING`；
3. 覆盖 Gateway 幂等结果重放后 C28 仍不闭环；
4. 记录修改前失败数量、状态和 operation id，不提交大型日志；
5. 不使用直接调用 `transitionOperation(...SUCCEEDED)` 的测试辅助绕过缺陷。

准出：能够稳定复现 RCI-03，且失败来自真实服务接线而不是 UI 或测试 fixture。

### RCI03-1：建立 READ verifier

1. 在既有模块责任边界内增加最小 READ Operation verifier；
2. verifier 只读取 PC 持久化权威：C28、C24、C22 和必要审计证据；
3. 按第 2.1 节逐项验证关联关系、状态、摘要和证据；
4. 验证通过后通过 EventProjection 产生 `pc.operation.verified`，不得直接改 projection row；
5. 验证失败返回稳定错误码和 reason，不把失败伪装成 Provider unavailable；
6. 不保存 Provider Allow、Credential、响应正文或 Secret；
7. verifier 版本和 evidence refs 必须可审计。

如现有 C22/C24 无法提供稳定 Trace/evidence，请先报告合同缺口并停止，不得用随机字符串
或测试专用字段冒充证据。

### RCI03-2：接入执行与幂等恢复

1. READ Gateway 执行返回后调用系统 verifier；
2. Gateway 首次执行和幂等命中已有结果两条路径都必须触发 verifier；
3. Runtime 内部 Tool endpoint 和直接 Gateway endpoint 最终使用同一闭环逻辑；
4. 验证失败时 Tool 结果可以保留，但 Business Operation 不得显示 `SUCCEEDED`；
5. 对已持久 Gateway 成功、C28 仍 `VERIFYING` 的 READ，提供受控重验路径；
6. 重验前重新检查租户、主体、Operation 关联和当前可见性；重验不重新派发 MCP 请求；
7. 不为修复投影重复执行外部读取，更不能重复执行外部写入。

### RCI03-3：收紧 verify API

保留或调整现有路径时必须满足：

1. Bearer 调用方只能请求系统验证，不能提交任意 evidence 作为成功事实；
2. 服务端根据 operation id 查询 C28/C24/C22 并运行同一 verifier；
3. 只允许 owner/tenant 范围内的 Operation；
4. READ 之外返回明确的“不支持自动验证”，保持原状态；
5. 不允许从 `PLANNED`、`FAILED`、`OUTCOME_UNKNOWN` 等非法状态跳到 `SUCCEEDED`；
6. API 返回验证前后状态、reason codes 和安全的 evidence refs，不返回凭据或业务正文。

如果兼容性允许，删除请求体中的 `evidence_refs/result_digest`；若必须暂时接受旧字段，也必须
忽略其事实含义并由服务端重新计算，同时用测试证明伪造值不能影响结果。

### RCI03-4：恢复、持久化与回归

至少覆盖：

| 场景 | 必须结果 |
| --- | --- |
| READ + persisted KNOWN_SUCCESS + digest/evidence 一致 | VERIFYING -> SUCCEEDED |
| READ 幂等重放 | 不重复派发；补齐或保持唯一 SUCCEEDED |
| API 在 Gateway success 后、projection 前中断 | 重试验证可收口 |
| C24/C22 operation id 不一致 | Deny，保持 VERIFYING |
| result digest 不一致 | Deny，保持 VERIFYING |
| Provider evidence 缺失 | Deny，保持 VERIFYING |
| KNOWN_FAILURE | FAILED，不可 verify 为成功 |
| OUTCOME_UNKNOWN | 保持未知，走 reconciliation |
| WRITE/DESTRUCTIVE/EXTERNAL_SIDE_EFFECT KNOWN_SUCCESS | 不自动成功 |
| 跨 tenant/principal verify | Deny |
| 并发 verify | 一个终态，无冲突覆盖 |
| PostgreSQL 重启后重验 | 使用持久记录闭环，不重新派发 Provider |
| Projection rebuild | 仍为同一 SUCCEEDED 结果和 digest |

PostgreSQL 验证只允许任务自有隔离实例；不连接共享数据库、旧演示数据库或
`192.168.31.95`。如果当前没有可安全使用的隔离环境，明确记录未执行，不能用 memory 测试
声称持久化验收通过。

### RCI03-5：验证与收口

形成 `product/docs/rci-03-read-operation-projection-verification.md`，至少记录：

- 修改前稳定复现；
- READ verification 规则和调用图；
- 首次执行、幂等命中、崩溃窗口和重验结果；
- forged verify evidence 被拒绝的证据；
- WRITE/UNKNOWN 保持原状态的证据；
- memory/PostgreSQL/closed-port/真实 EE 各自执行与未执行边界；
- 全量测试、跳过项、工作树、远端和进程状态；
- RCI-02 仍待真实复验，RCI-04、T1B、T2、T3 仍未完成。

完成后只允许报告：

```text
RCI-03 READ PROJECTION FIXED_PENDING_REAL_RETEST
WRITE VERIFICATION NOT EXPANDED
T1B / RCI-04 / T2 / T3 NOT STARTED
```

不得报告整个 REAL-EE-INTEGRATION-CLOSURE-01 已完成。

## 5. 允许修改范围

- Gateway/Event Projection/Workbench 之间与 READ verification 直接相关的应用接线；
- 最小 verifier 及其接口、错误码和测试；
- `business-operations/:operationId/verify` 的安全收紧；
- memory/PostgreSQL repository 查询或 CAS 行为，但不得改变 schema；
- T1A W0 的状态文档和 Workbench route classification；
- 对应验证文档、README、路线图和必要索引。

## 6. 禁止范围

- PC/EE 数据库 schema、migration、表和索引；
- EE 源码、EE 权限、业务数据或 MCP 实现；
- DSH Core、Runtime 协议、模型和前端视觉改造；
- 把任意 ToolResult 或 `KNOWN_SUCCESS` 通用映射为 Business `SUCCEEDED`；
- 为 WRITE/DESTRUCTIVE 伪造 readback；
- 重放 Provider 写操作来修复投影；
- C67-C69 major 语义、T1B、T2、RCI-04、D4B、MEMORY-01B；
- `.env`、端口、技术版本、共享服务或生产设置；
- push、部署、合并、清理历史证据或删除数据卷。

## 7. 停止条件

出现以下任一情况立即停止并报告：

1. READ 成功无法从现有 C22/C24/C28 和 Provider evidence 确定性验证；
2. 必须修改数据库 schema 或合同 major 才能安全闭环；
3. 唯一方案是把 Gateway `KNOWN_SUCCESS` 直接当成所有业务成功；
4. 需要重新派发 Provider 请求才能修复既有投影；
5. 修复 READ 会改变 WRITE/OUTCOME_UNKNOWN 的恢复语义；
6. 幂等命中无法关联同一 Business Operation；
7. 必须连接共享数据库、生产 EE 或远端部署才能开发；
8. T1A、D3/D4A、C22/C24/C28/C30 或全量门禁回归失败；
9. 发现未知工作树改动且无法安全隔离。

## 8. 准出条件

只有以下全部满足才能标记本阶段完成：

1. RCI-03 在修改前由真实服务边界测试稳定复现；
2. READ 首次执行和幂等命中均能形成唯一 `pc.operation.verified`；
3. C28 最终 `SUCCEEDED` 与 C22/C24 operation id、digest 和 evidence 一致；
4. 崩溃窗口可通过重验收口且不重新派发 Provider；
5. forged evidence、跨租户/主体和非法状态全部拒绝；
6. WRITE/DESTRUCTIVE/OUTCOME_UNKNOWN 未被错误推进；
7. Projection rebuild 结果一致；
8. T1A W0 状态和 route classification 收口完成；
9. 定向测试、合同检查、`pnpm check`、`git diff --check` 和敏感扫描通过；
10. 没有修改 schema、EE、DSH、Runtime、环境和远端；
11. 验证文档准确声明真实 EE 复验和其余阶段未完成；
12. 创建一个本地提交后工作树干净，不 push。

## 9. 后续顺序

```text
RCI-03 READ projection closure
  -> real EE READ retest for RCI-02/RCI-03
  -> decide T1B schema authorization or continue T2 preparation
  -> T2A/T2B/T2C authorization intersection
  -> T3 outage/revocation/multi-account acceptance
```

真实 EE 复验只在当前开发任务完成后单独启动，不能由 synthetic/memory 测试替代。

## 10. 可直接发送给主力开发的启动 Prompt

```text
执行任务 RCI-03-READ-OPERATION-PROJECTION-CLOSURE。

唯一任务书：
E:/shanzi_workspace/process-copilot-harness/governance/RCI-03-READ-OPERATION-PROJECTION-CLOSURE-TASK.md

主仓库：
E:/shanzi_workspace/process-copilot-harness

先完整读取仓库 AGENTS.md、README.md、SOURCE-BASELINE.md、下一阶段路线图、任务书、
ADR-0007/0008/0011/0024/0025、real-ee-integration-closure-01.md 的 RCI-03、
Gateway/Event Projection/Workbench 当前实现及相关测试。核对 branch、HEAD、origin/main、
工作树和本地未提交任务书状态，再输出开始前对齐块。实现基线是 51c8fd4；任务书和状态文档
位于该基线后的未提交规划改动中，不要回退或覆盖它们。

严格按 W0、RCI03-0 至 RCI03-5 执行。先用真实 ControlledExecutionGatewayService、
EventProjectionService 和现有 event publisher 建立红测试，稳定复现 READ 的 Gateway
ExternalOperationRecord 已为 KNOWN_SUCCESS、C22 已为 SUCCEEDED，但 C28 BusinessOperation
仍停在 VERIFYING。不得用直接 transitionOperation(...SUCCEEDED) 的测试辅助绕过缺陷。

实现范围只关闭 READ Operation：系统 verifier 必须从持久 C28/C24/C22 重新核对 tenant、
principal、business task、operation id、READ kind、dispatch/outcome/status、result digest 和
Provider evidence，验证通过后通过 EventProjection 产生 pc.operation.verified。首次执行、
Gateway 幂等命中和“Gateway 成功后投影前崩溃”的重验都必须闭环，且不得重新派发 Provider。

严禁把任意 ToolResult 或 KNOWN_SUCCESS 通用映射为业务 SUCCEEDED。WRITE、DESTRUCTIVE、
EXTERNAL_SIDE_EFFECT 仍需 Provider-specific readback/C30 reconciliation；OUTCOME_UNKNOWN
保持未知。现有 POST /v1/business-operations/:operationId/verify 只能触发服务端验证，调用方
提交的 evidence_refs/result_digest 不能成为成功事实，伪造值必须被测试拒绝。

W0 同时完成两项小收口：更新 T1A 状态文档；将 Workbench 结束后重授权的 project: 前缀
判断改成与 Authority Router 一致的 exact route classification，并覆盖 PC-only、Provider、
unknown/ambiguous 测试。不要实施 T1B/T2，不改 C67-C69 major 语义。

本任务禁止修改任何 PC/EE schema、EE 源码、DSH Core、Runtime 协议、前端视觉、.env、
端口、技术版本、共享环境和 192.168.31.95；禁止 push、部署、合并或清理历史证据。真实依赖
不能用 mock 冒充验收。PostgreSQL 只能使用任务自有隔离实例，不可安全执行时明确记录未执行。

完成定向失败/修复测试、幂等/并发/非法 evidence/WRITE/UNKNOWN 回归、Projection rebuild、
可用时的隔离 PostgreSQL 重启、合同门禁和 product/pnpm check。形成
product/docs/rci-03-read-operation-projection-verification.md。全部通过后创建一个本地提交，
保持工作树干净，但不要 push。

最终只能报告：
RCI-03 READ PROJECTION FIXED_PENDING_REAL_RETEST / WRITE VERIFICATION NOT EXPANDED /
T1B、RCI-04、T2、T3 NOT STARTED。
遇到任务书停止条件立即停止并报告，不自行扩大范围。
```
