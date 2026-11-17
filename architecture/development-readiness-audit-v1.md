# Process Copilot 开发准入审查 v1

- 日期：2026-11-09
- 审查范围：ADR-0001 至 ADR-0017 及配套实施蓝图
- 结论：**CONDITIONAL PASS（仅允许进入 P0 工程与契约基线；P1 及业务功能开发暂不准入）**

## 1. 结论解释

架构阶段已经完成到可以启动“开发准备工程”的程度，但还不能把 ADR 直接发给开发人员后并行实现 Runtime、Profile、Gateway、数据库和业务功能。

允许立即开始：

```text
P0 工程与契约基线
- 绿地 workspace / repository
- 模块边界与 forbidden dependency
- C01-C42 machine-readable schema
- golden fixtures / compatibility runner
- traceability CI
- 统一 ID / 时间 / 错误 / 审计基础类型
- 固定 DSH commit/profile 构建输入
- secret scan / fixture discipline
```

暂不允许开始：

```text
P1 Runtime Walking Skeleton
P2 Identity/Profile/Capability
P3 Resource/Workspace
P4 企业写、MCP、审批
P5 恢复与业务状态
生产集成、数据库迁移、部署
```

## 2. 已满足的准入条件

1. ADR-0001～ADR-0017 全部为 Accepted；
2. ADR 依赖链连续，未发现足以否决架构的跨 ADR 冲突；
3. 已有 22 个 PC 模块 + 4 个外部权威单元的责任矩阵；
4. 已有 C01-C42 稳定 Contract Catalog；
5. 已有 17/17 ADR 的 Traceability Manifest；
6. 已固定 DSH `0.2.1-rc.3` / commit `1f81c047...`；
7. 无侵入审查结论为首期不修改 DSH Core；
8. 已有 P0-P7 实施蓝图和 Compatibility Matrix；
9. 已存在 Living Spec 与 Technical Open List；
10. ADR-0015～0017 已覆盖企业角色、策略制品和 legacy 零迁移兼容。

## 3. 为什么不是完全 PASS

### G-01：Contract 仍是文档，不是机器可执行 Schema

Catalog 已冻结语义，但尚无 JSON Schema / protobuf / OpenAPI 等实际 schema 文件、golden fixture 和 consumer contract tests。

风险：不同开发窗口会独立解释字段必填性、枚举、时间格式和错误码。

### G-02：Traceability 中 17/17 实现状态均为 planned

目前只有映射关系，没有 implementation、automated test 或 runtime evidence。Compatibility Matrix 中 Bridge、Profile、Event 和 Error 仍为 `Planned supported`。

### G-03：IMP-0001～IMP-0012 仍只是任务标题

`greenfield-implementation-plan-v1.md` 明确写着实际依赖仍需按 producer/consumer 精化。尚缺逐任务：

```text
允许/禁止修改路径
输入/输出 Contract
producer / consumer
验收用例
验证命令
回滚与失败处理
```

### G-04：ADR-0002 仍有正确性关键开放项

```text
- Fencing Token 的持久化和原子分配机制
- EE Claw / MCP Gateway 的幂等、Fencing、回读和对账能力
- Lease / heartbeat / lost 的时间模型
```

其中具体秒数可以延后到实现决策，但 Token 分配机制和下游能力不能由编码人员临场决定。

### G-05：开发仓库和 CI 基线尚未建立

当前工作区保存的是设计资产，不是可构建、可测试、可合流的绿地实现仓库。建立该仓库本身正是 P0 的第一项工作。

## 4. P0 退出门（进入 P1 前必须全部通过）

| Gate | 要求 | 判定 |
|---|---|---|
| P0-G1 | C01-C42 有 machine-readable schema，且可解析 | 必须 |
| P0-G2 | 每个跨模块 Contract 至少有一个 golden fixture | 必须 |
| P0-G3 | producer/consumer compatibility runner 在 CI 运行 | 必须 |
| P0-G4 | Traceability CI 验证 17/17 ADR、Module、Contract、Test 引用 | 必须 |
| P0-G5 | forbidden dependency 阻止业务模块依赖 DSH internal package | 必须 |
| P0-G6 | DSH pinned commit、lock 与 Profile 构建可重复 | 必须 |
| P0-G7 | Fencing Token 分配/持久化形成 Implementation Decision | 必须 |
| P0-G8 | Lease 时间模型使用可测试时钟，阈值有默认值 | 必须 |
| P0-G9 | EE Claw/MCP 下游幂等、Fencing、回读能力调查完成 | 必须 |
| P0-G10 | IMP-0001～IMP-0012 转为可执行任务书 | 必须 |
| P0-G11 | secret scan、日志脱敏、fixture 无生产 Secret | 必须 |
| P0-G12 | P1 Walking Skeleton 的 12 项验收测试已先写成可执行测试计划 | 必须 |

任一未通过，不进入 P1。

## 5. 建议首批开发任务

首批只发 4 个任务，其他任务等 schema 稳定后再开：

1. `IMP-0001`：初始化绿地 workspace、模块目录、构建/测试/lint、依赖规则；
2. `IMP-0002`：将 C01-C42 落为 machine-readable schemas；
3. `IMP-0003`：建立 Traceability / Compatibility CI；
4. `IMP-0004`：固定 DSH source/profile 构建输入并验证可重复构建。

并行建议：

```text
窗口 A：IMP-0001 + IMP-0003（工程治理）
窗口 B：IMP-0002（Contract schemas）
窗口 C：IMP-0004（DSH build baseline）
主控窗口：只做 Contract ownership、审查和独立验收
```

当前不建议直接把 `IMP-0005～IMP-0012` 全部并行派发，因为它们依赖 Contract Schema 与 Fencing Implementation Decision。

## 6. 最终准入判定

```text
架构设计完整性：PASS
P0 开发准备阶段：PASS
P1 Runtime/功能开发：BLOCKED
生产实现与外部写：BLOCKED
```

因此准确表达是：

> **现在适合进入开发阶段，但只能进入 P0“工程与契约基线”阶段。完成 P0 退出门后，才适合进入 Runtime Walking Skeleton 和功能开发。**
