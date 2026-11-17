# DSH Adapter 参考证据卡

- 状态：Accepted Evidence
- 日期：2026-11-06
- 关联决策：ADR-0006
- DSH 基线：`dsh-v0.2.1-rc.3`
- DSH Commit：`1f81c047fc48fa190a683e469daa699857e9afe8`

## REF-ADAPTER-001：DSH Profile、Bundle 与应用启动

```text
reference_id: REF-ADAPTER-001
candidate_repository: DeepSeek Harness
evidence_level: R2-R3
adoption_decision: adopt / adapt
```

关键证据：

- `docs/architecture.md`
- `packages/boot/app-boot/README.md`
- `packages/bundle/base/cordis.patch.yml`
- `packages/bundle/sdk-app/cordis.patch.yml`
- `packages/bundle/headless/cordis.patch.yml`
- `packages/sdk/client/src/launch.ts`

确认：

- 产品应用通过命名 `dsh --profile <name>` 启动；
- Profile 按 Bundle、Profile Patch、Home Patch、启动 Patch 叠加；
- 自定义 Bundle 和外部 Plugin 是受支持扩展方式；
- Profile 可声明 DSH 兼容范围；
- SDK Client 可以指定 Profile、Patch、DSH_HOME、环境和超时；
- HMR 可由 Profile 关闭；
- 业务调用者绕过 launcher 直接构造完整产品插件树不是受支持应用入口。

运行：

```text
pnpm dsh --profile sdk --dump-config
```

观察：

- SDK Profile 由 `dsh-base + dsh-sdk-app` 构成；
- HMR 关闭；
- 包含 SDK JSON-RPC Server；
- 不包含 AgentPreset Registry 和 Session Controller；
- 包含 Agent Loop、Session、Tools、Persistence、Approval 和 Typert Gateway。

采用：

- 专用命名 PC Runtime Profile；
- 外部 Bundle / Patch；
- 启动时静态装配；
- Profile Digest 和兼容矩阵。

边界：

- 默认 SDK Profile 不能直接满足 PC Assignment、Fencing、Profile 和 Resource 约束。

## REF-ADAPTER-002：DSH SDK Protocol、Server 与 Client

```text
reference_id: REF-ADAPTER-002
candidate_repository: DeepSeek Harness
evidence_level: R3
adoption_decision: adapt / reject_as_business_contract
```

关键源码：

- `packages/sdk/protocol/src/types.ts`
- `packages/sdk/protocol/src/transport.ts`
- `packages/sdk/server/src/server.ts`
- `packages/sdk/server/src/index.ts`
- `packages/sdk/client/src/client.ts`
- `packages/sdk/client/src/launch.ts`
- `packages/sdk/client/src/dispose.ts`

确认：

- newline-delimited JSON-RPC stdio；
- initialize、prompt、resume、wait、working directory、shutdown；
- SessionEvent、Agent status、Subagent 通知；
- 多 Session 共用同一 Runtime；
- Session 创建并发去重；
- Session 恢复和开放 Turn 修复；
- Client timeout 只放弃等待，Server 工作不自动取消；
- Client teardown 使用 shutdown、EOF、SIGTERM、SIGKILL；
- SDK Server 默认不组合 AgentPreset；
- 通知覆盖 Runtime 中所有 Session，Client 侧过滤；
- 协议没有 Assignment、Epoch、Fencing、Lease、Cancel、Session Close、Catch-up 和兼容协商；
- handler 错误统一变为 `-32603` 文本。

运行：

```text
pnpm exec vitest run
  packages/sdk/protocol/tests/transport.spec.ts
  packages/sdk/server/tests/server.spec.ts
  packages/sdk/server/tests/resume.spec.ts
  packages/sdk/server/tests/wait.spec.ts
  packages/sdk/server/tests/plugin-apply.spec.ts
  packages/sdk/client/tests/launch.spec.ts
  packages/sdk/client/tests/dispose.spec.ts
  packages/bundle/sdk-app/tests/sdk-app.spec.ts
  packages/preset/agent-preset-registry/tests/registry.spec.ts

9 test files passed
143 tests passed
```

采用：

- 本机 stdio；
- JSON-RPC framing 参考；
- process ownership；
- timeout 和 typed client error；
- cooperative + forced teardown；
- Session resume / wait 语义参考。

拒绝：

- 将现有 SDK Wire 暴露为 PC 稳定业务契约。

未来：

- `RuntimeBridgeTransport` 保留兼容实现入口；DSH upstream SDK 能力成熟后可替换自定义 Transport。

## REF-ADAPTER-003：AgentPreset 与 Session 级装配

```text
reference_id: REF-ADAPTER-003
candidate_repository: DeepSeek Harness
evidence_level: R2-R3
adoption_decision: adopt / adapt
```

关键源码：

- `packages/preset/agent-preset-registry/src/index.ts`
- `packages/preset/agent-preset-registry/src/mount.ts`
- `packages/preset/agent-preset/src/index.ts`
- `packages/core/agent-loop/src/index.ts`

确认：

- Preset 使用稳定 ID 和 child plugin list；
- 多个 Preset 可在同一进程中存在；
- Agent 在 setup window 绑定当前 Preset revision；
- 已绑定 Agent 保留原 revision；
- 新 revision 影响后续 Agent；
- Session 首个 Turn 后拒绝切换 Preset；
- Preset 选择可持久记录；
- Agent 创建和恢复支持 setup callback；
- 当前 SDK Server 没有 Preset composition。

采用：

- Effective Profile Snapshot 到 DshPresetRef；
- Session 创建/恢复 setup window 绑定；
- Runtime 级静态插件与 Session 级 Preset 分层。

边界：

- Preset 不是安全沙箱或 PC Profile 权威；
- 旧实现代码不会跨进程自动保留，必须使用 Bundle Lock 和兼容矩阵。

## REF-ADAPTER-004：Agent 与 Tool 执行门禁

```text
reference_id: REF-ADAPTER-004
candidate_repository: DeepSeek Harness
evidence_level: R3
adoption_decision: adopt / adapt
```

关键源码：

- `packages/core/agent/src/runtime-types.ts`
- `packages/core/agent-loop/src/agent.ts`
- `packages/core/tools/src/index.ts`
- `docs/tool-execution-pipeline.md`
- `docs/agent-lifecycle.md`

确认：

- `agent/pre-step` 可在模型请求前拒绝 Step；
- Agent `cancel()` 可中断活动 Turn；
- `tools/pre-execute` 可异步拒绝、取消或请求审批；
- monotonic Tool Guard 的拒绝不能被后续 listener 改回允许；
- Tool body 开始后取消会等待 body 收敛；
- `session/event` 是持久技术事实观察入口；
- `agent/status` 是实时状态，不是持久恢复点。

运行：

```text
pnpm exec vitest run
  packages/core/agent-loop/tests/interception.spec.ts
  packages/core/tools/tests/scoped.spec.ts
  packages/preset/agent-preset-registry/tests/registry.spec.ts

3 test files passed
86 tests passed
```

采用：

- Step Admission Guard；
- Tool Guard；
- 撤销时 Agent cancel；
- Session scoped registration；
- 企业写操作由 PC Gateway 最终校验。

边界：

- Runtime 本地 Guard 不能替代企业写 Gateway 的实时 Fencing；
- 已开始外部操作仍可能 Outcome Unknown。

## REF-ADAPTER-005：Typert API Gateway 与 Session Controller

```text
reference_id: REF-ADAPTER-005
candidate_repository: DeepSeek Harness
evidence_level: R2
adoption_decision: compare_only / capability_reference
```

关键证据：

- `packages/api/gateway/README.md`
- `packages/api/gateway/src/index.ts`
- `packages/api/remote-access/src/index.ts`
- `packages/api/session-controller/README.md`
- `packages/api/session-controller/src/index.ts`
- `docs/api-gateway.md`

确认：

- Remote 方法有严格参数、结构化 RemoteError、取消和流；
- Gateway 支持 resource-aware access；
- Session Controller 支持 create、prompt、cancel、follow、page 和 projections；
- Session 创建是 Preset-aware；
- Follow 提供 reconnect 和 gap repair；
- 体系依赖 Connection、Gateway、Remote Access、Typert 和 Client carrier；
- 主要面向 DSH Host / Client Web 架构。

可借鉴：

- RemoteError；
- resource readers；
- cancel signal；
- stream baseline + cursor + gap repair；
- preset-aware Session creation；
- non-owner access fail closed。

不作为首期主 Wire：

- 依赖面较大；
- PC Backend 需要实现 DSH Client carrier；
- 仍缺少 PC Assignment、Epoch、Fencing 和 Runtime Registry。

未来：

- 保留为 `RuntimeBridgeTransport` 的备用实现。

## REF-ADAPTER-006：Headless

```text
reference_id: REF-ADAPTER-006
candidate_repository: DeepSeek Harness
evidence_level: R2
adoption_decision: reject_as_primary_runtime / compare_only
```

关键证据：

- `packages/bundle/headless/README.md`
- `packages/bundle/headless/cordis.patch.yml`

确认：

- 一个进程执行一个任务；
- 可输出 JSON event projection；
- 可使用 session-id 恢复；
- 任务完成后退出；
- 不提供长期交互控制通道。

结论：

- 可用于离线任务、诊断和最小验收；
- 不作为用户作用域 Runtime Pool 主集成形态。

## 综合结论

DSH 已提供足够的应用组合、Agent、Session、Preset、Plugin 和 Tool 扩展点，可先通过 PC 自有 Runtime Host、Bundle 和 Bridge Plugin 构建 Adapter，而不修改 DSH Core。

现有 SDK 和 API Gateway 均保留为未来 Transport 兼容方向：

- SDK 更接近进程监督和本机协议；
- API Gateway 更接近结构化 Remote、取消、访问控制和事件补齐；
- 首期使用 PC 自有版本化 Bridge；
- 最终是否修改或 upstream DSH，留到全量 ADR 后统一审查。
