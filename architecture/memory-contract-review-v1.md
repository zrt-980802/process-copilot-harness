# Process Copilot Memory Contract C43-C60 评审记录 v1

- 状态：Accepted Contract Review
- 日期：2026-11-16
- 范围：`memory-contract-catalog-v1.md` C43-C60
- 依据：ADR-0018 至 ADR-0023、Threat Model v1、Evaluation Baseline v1、DSH 无侵入审查 v1
- 结论：C43-C60 作为 Accepted Contract Extension；不授权实现或数据库变更

## 1. 评审结论

18 个 Contract 已覆盖：

- Authority Object、Revision 和 SourceEvidence；
- Capture、Candidate Decision、Revise 和 Revoke；
- Authorized Query、View、Runtime Context 和 Usage；
- Authority Change、Projection Operation/Receipt/Rebuild；
- Policy Decision；
- Context Exposure 和 Session Invalidation。

Contract 不绑定 REST、RPC、数据库表、模型、向量库或外部 Provider。

## 2. 本轮修正

### 2.1 Object State 与 Revision State 分离

原草案将 `SUPERSEDED` 与 Object Lifecycle 混用，已修正为：

```text
memory_object_state
  CANDIDATE | CONFIRMED | PUBLISHED | REVOKED | EXPIRED | REJECTED

memory_revision_state
  CURRENT | SUPERSEDED | WITHDRAWN
```

新 Revision 成为 `CURRENT` 时，旧 Revision 转为 `SUPERSEDED`，Object 保持 `CONFIRMED/PUBLISHED`。

### 2.2 Session 撤销闭环

根据 ADR-0023 增加：

- C59 `pc.memory-context-exposure/1`；
- C60 `pc.memory-session-invalidation/1`。

首期固定 `rotation_policy=FRESH_SESSION_NO_REPLAY`，避免撤销内容通过 DSH 持久 Session 继续影响回答。

### 2.3 Projection 完成语义

C56 明确区分 Provider Acceptance 与 Readback Verification。`ACCEPTED` 不代表删除、修订或重建完成。

## 3. Contract 逐组结论

| 分组 | Contract | 结论 |
| --- | --- | --- |
| Authority | C43-C45 | 稳定对象、不可变 Revision、来源引用分离，满足权威边界 |
| Write | C46-C49 | Command ID、幂等、CAS、授权和 Deadline 完整 |
| Query/Context | C50-C53 | Principal、Purpose、短期 View、类型化 Context、Usage 可追踪 |
| Event/Projection | C54-C57 | Authority Event、Provider Operation、Receipt/Readback、Rebuild 分离 |
| Policy | C58 | Capture/Query/Revoke/Context 的稳定决策可审计 |
| Runtime Revoke | C59-C60 | 暴露记录、Session fencing、rotation 和 RecoveryCase 闭环 |

## 4. 安全反向检查

| 威胁 | Contract 支撑 |
| --- | --- |
| direct-get / 跨 Scope 查询 | C50、C51、C58 |
| 自动抽取升级事实 | C46、C47、C58 |
| 静默覆盖旧事实 | C43、C44、C48、C54 |
| Memory Prompt Injection | C52、C53 |
| Provider 伪造 Scope | C50、C51、C55-C56 |
| 删除只隐藏 UI | C49、C54-C56 |
| 重建后复活 | C57 |
| 旧 DSH Session 残留 | C59、C60 |
| 数字代理混淆授权 | C58；Delegation Contract 尚未进入首期 |

## 5. 接受的不变量

1. 所有可用内容必须绑定 C43 Object、C44 Revision、C45 Evidence 和 temporal_role；默认只用 CURRENT，显式 `DECISION_RECALL + valid_at` 才能返回标记为 HISTORICAL 的 SUPERSEDED Revision；
2. 浏览器不能自由指定有效 Owner/Scope/Purpose；
3. 自动 Capture 只能生成 Candidate；
4. 所有 Query 必须带当前 Principal、AuthorizationRevision 和 Purpose；
5. C51/C52 是短期不可变快照，不是长期授权；
6. C52 不携带 Tool/Capability grant；
7. C49 Authority Revoke 先于异步 Projection 清除生效；
8. C56 未 readback 时保持 pending/unknown；
9. 每个 C52 派发必须有 C59；
10. C60 未完成时旧 Session 仍不可使用。

## 6. 留给实现决策的内容

以下不改变 Contract major，可在 Implementation Decision 中冻结：

- JSON Schema 文件布局和代码生成方式；
- REST 路径、HTTP 状态和分页游标格式；
- PostgreSQL 表、索引和事务实现；
- ID 前缀、UUID/ULID 选择；
- Context Renderer 的具体转义格式；
- FTS tokenizer、ranking 和词典；
- Outbox/Worker 的部署方式；
- 限流、配额和默认 token budget 数值。

以下变化需要 Contract major 或新 ADR：

- 允许 Provider 成为权威；
- 取消逐次 Purpose/Authorization 检查；
- 自动 Candidate 直接 Confirmed；
- 允许旧 Session 在 Revision 撤销后继续；
- Memory 直接携带 Tool/Delegation 权限；
- 删除不再要求 readback。

## 7. 下一步

- 将 C43-C60 分配到 M23-M29；
- 建立 Memory Traceability Manifest；
- 将 21 个安全测试和 60 个评测场景映射到 Contract；
- 在实施授权前形成数据库与 API Implementation Decision Pack。

