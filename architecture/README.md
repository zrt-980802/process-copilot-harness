# Process Copilot Architecture Decision Records

本目录保存 Process Copilot 已确认的技术架构决策。架构活文档负责浏览、版本比较和开放问题；ADR 是后续代码、测试、任务书和架构说明的正式依据。

## 使用规则

1. 每项重要技术决策使用稳定编号，例如 `ADR-0001`；
2. 状态只能是 `Proposed`、`Accepted`、`Superseded`、`Rejected` 或 `Deprecated`；
3. 已接受 ADR 不直接改写历史结论；需要变化时新增 ADR，并在旧 ADR 标注被哪个新 ADR 替代；
4. 实施任务书必须引用适用 ADR 编号；
5. 代码、配置、Schema 和测试应能追溯到 ADR 中的约束；
6. GitHub 参考仓库只在经过证据门禁后写入“依据”；
7. ADR 记录为什么这样设计、禁止什么、实现必须满足什么，不替代详细接口文档。

## 索引

| ADR | 标题 | 状态 | 适用范围 |
|---|---|---|---|
| [ADR-0001](ADR-0001-user-scoped-dsh-runtime-pool.md) | 用户作用域 DSH Runtime Pool、生命周期、多 Runtime 与多 Profile 装配 | Accepted | Runtime-1 至 Runtime-4 |
| [ADR-0002](ADR-0002-session-assignment-lease-fencing.md) | Session Assignment、Lease、Fencing 与幂等执行 | Accepted | Runtime-5 |
| [ADR-0003](ADR-0003-runtime-failure-recovery.md) | Runtime 故障恢复、工作分类与外部结果对账 | Accepted | Runtime-6 |
| [ADR-0004](ADR-0004-runtime-draining-registry-health-workspace.md) | Runtime 安全回收、Registry、健康、可观测性与持久 Workspace | Accepted | Runtime-7、T7.3、T10.4、T10.5 |
| [ADR-0005](ADR-0005-workspace-resource-model.md) | Workspace Resource、版本、作用域与 Materialization | Accepted | T7.1 至 T7.7 |
| [ADR-0006](ADR-0006-dsh-adapter-runtime-bridge.md) | DSH Adapter、Runtime Host 与 PC Runtime Bridge | Accepted | T1.1 至 T1.5、T2.1 至 T2.5、T11.1、T11.3 |
| [ADR-0007](ADR-0007-mcp-principal-delegation-isolation.md) | MCP Principal Envelope、用户委托与多 Session 隔离 | Accepted | T4.3 至 T4.6、T5.1 至 T5.8、T9.3 至 T9.4、T11.2 |
| [ADR-0008](ADR-0008-tool-plugin-registry-execution-governance.md) | Tool / Plugin Registry 与执行治理 | Accepted | T6.1 至 T6.7、G1 至 G6、T11.3 |
| [ADR-0009](ADR-0009-expert-profile-technical-model.md) | Expert Profile 技术模型 | Accepted | T3.1 至 T3.7、B1 至 B7、T11.1、T11.3 |
| [ADR-0010](ADR-0010-identity-authorization-external-system-registration.md) | Identity、Authorization 与 External-System Registration | Accepted | T4.1、T4.2、T4.7、H1 至 H5 |
| [ADR-0011](ADR-0011-business-state-event-projection-recovery.md) | 业务状态、事件投影、Operation Ledger 与恢复 | Accepted | T8.1 至 T8.7 |
| [ADR-0012](ADR-0012-durable-approval-audit-sandbox-security.md) | 持久审批、审计链、Sandbox 与执行安全 | Accepted | T9.1 至 T9.7 |
| [ADR-0013](ADR-0013-deployment-isolation-capacity-observability.md) | 部署、租户隔离、容量与可观测性 | Accepted | T10.1 至 T10.7 |
| [ADR-0014](ADR-0014-testing-compatibility-architecture-consistency.md) | 测试、版本兼容与架构一致性治理 | Accepted | T11.1 至 T11.8 |
| [ADR-0015](ADR-0015-enterprise-role-model-and-module-capability.md) | 企业角色模型与模块能力关系 | Accepted | EE Claw 企业角色、责任、工作台与配置 |
| [ADR-0016](ADR-0016-policy-artifact-versioning-and-release-governance.md) | 策略制品版本化与发布治理 | Accepted | Workbench/Role Config/Policy Artifact |
| [ADR-0017](ADR-0017-legacy-authorization-compatibility-and-no-migration.md) | Legacy 授权兼容与零迁移 | Accepted | EE Claw Platform Auth V1 |
| [ADR-0018](ADR-0018-memory-authority-domain-boundaries.md) | 长期记忆权威与领域边界 | Accepted | Personal / Project / System Memory、Runtime Context |
| [ADR-0019](ADR-0019-memory-lifecycle-revision-and-deletion.md) | 记忆生命周期、不可变修订、双时间与删除 | Accepted | Capture、Revision、Supersession、Revoke、Delete |
| [ADR-0020](ADR-0020-memory-scope-authorization-and-context-injection.md) | 记忆 Scope、动态授权与上下文注入 | Accepted | Authorized Query、Source Revalidation、Context Injection |
| [ADR-0021](ADR-0021-memory-projection-provider-and-recovery.md) | 记忆 Projection、Provider、缓存与恢复 | Accepted | Keyword / Vector / Graph、Provider Adapter、Rebuild |
| [ADR-0022](ADR-0022-digital-impression-delegation-separation.md) | 数字印象、长期记忆与委托授权分离 | Accepted | DigitalImpression、Delegation、Digital Delegate |
| [ADR-0023](ADR-0023-memory-context-exposure-session-rotation.md) | 记忆上下文暴露记录与 DSH Session 轮换 | Accepted | Memory Revoke、Session Persistence、Rotation |
| [ADR-0024](ADR-0024-pc-core-external-business-provider-decoupling.md) | PC Core 与外部业务平台解耦 | Accepted | Identity、Authorization、Project Directory、Business Capability、Workbench Projection |
| [ADR-0025](ADR-0025-thin-session-authorization-legacy-provider-compatibility.md) | 薄 Session、薄授权与旧 Provider 权限兼容 | Accepted | PC Session、PC-only Authorization、Legacy Provider Compatibility |

## 关联文档

- 架构活文档：`process-copilot-architecture-living-spec.html`
- 技术未完成清单：`process-copilot-technical-architecture-open-list.md`
- 参考仓库治理：`process-copilot-reference-repository-governance.md`
- Runtime 收尾参考证据：`reference-evidence-runtime-closure.md`
- Workspace 资源模型参考证据：`reference-evidence-workspace-resource-model.md`
- DSH Adapter 参考证据：`reference-evidence-dsh-adapter.md`
- MCP 多 Session 鉴权参考证据：`reference-evidence-mcp-multisession-auth.md`
- Tool / Plugin Registry 参考证据：`reference-evidence-tool-plugin-governance.md`
- Expert Profile 技术模型参考证据：`reference-evidence-expert-profile-technical-model.md`
- Identity、Authorization 与外部系统注册参考证据：`reference-evidence-identity-authorization-external-registration.md`
- 最终架构域参考证据：`reference-evidence-final-architecture-domains.md`
- 企业角色与 Legacy 授权参考证据：`reference-evidence-role-model.md`
- 企业角色与授权实现约束：`implementation-constraints-authorization.md`
- DSH 无侵入实现审查：`dsh-non-invasive-implementation-review-v1.md`
- 实施模块责任矩阵：`implementation-module-responsibility-matrix-v1.md`
- 稳定 Contract Catalog：`stable-contract-catalog-v1.md`
- Traceability Manifest：`traceability-manifest-v1.json`
- Compatibility Matrix：`compatibility-matrix-v1.md`
- 绿地实施计划：`greenfield-implementation-plan-v1.md`
- 开发计划执行清单：`development-plan-list-v1.md`
- EE Agent 与 MCP 全链路接入研究：`ee-agent-mcp-full-chain-integration-research-v1.md`
- 最小产品开发计划：`minimum-product-development-plan-v1.md`
- MVP Implementation Decision Pack：`implementation-decision-pack-v1.md`
- Runtime Walking Skeleton 调研：`runtime-walking-skeleton-research-v1.md`
- MVP P0 测试环境部署验收：`mvp-p0-test-deployment-verification-v1.md`
- Runtime P1-B2 本地最终镜像验收：`../product/docs/runtime-p1-b2-verification.md`
- Runtime DEV-04 Registry/Lease/Guard 验收：`../product/docs/runtime-dev04-verification.md`
- DEV-05 Identity/Profile/Capability 验收：`../product/docs/dev05-verification.md`
- DEV-06 Resource/Workspace 验收：`../product/docs/dev06-verification.md`
- DEV-07 Controlled Gateway/MCP/Approval 验收：`../product/docs/dev07-verification.md`
- DEV-08 Event/Business State/Recovery 验收：`../product/docs/dev08-verification.md`
- DEV-09 SSTS Draft 后端纵向闭环验收：`../product/docs/dev09-verification.md`
- 技术架构工作方法：`ARCHITECTURE-WORKING-METHOD.md`
- 长期记忆端到端流程与 ADR 决策地图：`memory-end-to-end-flow-v1.md`
- 长期记忆 ADR 集中接受记录：`memory-adr-acceptance-record-2026-11-16.md`
- Memory Contract Catalog Accepted Extension：`memory-contract-catalog-v1.md`
- Memory Contract C43-C60 评审记录：`memory-contract-review-v1.md`
- 长期记忆威胁模型：`memory-threat-model-v1.md`
- 长期记忆评测基线：`memory-evaluation-baseline-v1.md`
- 长期记忆 DSH 无侵入实现审查：`memory-dsh-non-invasive-review-v1.md`
- Memory 模块责任矩阵 M23-M29：`memory-module-responsibility-matrix-v1.md`
- Memory Traceability Manifest：`memory-traceability-manifest-v1.json`
- PersonalMemoryEval-v0 60 场景目录：`memory-evaluation-scenario-catalog-v0.md`
- Memory Implementation Decision Pack：`memory-implementation-decision-pack-v1.md`
- MEMORY-01A Authority 与 Contract 开发者验证：`../product/docs/memory-01a-verification.md`
- PC Core 与外部业务平台解耦 ADR：`ADR-0024-pc-core-external-business-provider-decoupling.md`
- 薄 Session、薄授权与旧 Provider 权限兼容 ADR：`ADR-0025-thin-session-authorization-legacy-provider-compatibility.md`
- 外部 Provider 解耦 D0 调用清单与权威路由表：`external-provider-decoupling-d0-inventory-v1.md`
- 外部 Provider Contract C61-C66：`external-provider-contract-catalog-v1.md`
- ADR-0025 T0 C67-C69 contract/matrix: `adr-0025-t0-contract-and-compatibility-v1.md` (69 contracts total; T1B and T2A-T2C implemented locally; targeted real EE RCI-02/RCI-03 evidence, a developer-pass hardened model rerun and A1 cross-Principal data-isolation plus denial-audit evidence exist; the remaining adversarial matrix and T3 remain pending; not production ready).
- ADR-0025 T1A Session/source boundary developer verification: `../product/docs/adr-0025-t1a-verification.md`.
- RCI-03 READ projection developer verification and bounded real EE evidence (full adversarial acceptance pending): `../product/docs/rci-03-read-operation-projection-verification.md`.
- 外部 Provider 解耦 D1 Port 拆分：`external-provider-decoupling-d1-port-split-v1.md`
- 外部 Provider 解耦 D2 Standalone：`external-provider-decoupling-d2-standalone-v1.md`
- 外部 Provider 解耦 D3 Authority Router：`external-provider-decoupling-d3-authority-router-v1.md`
- DECOUPLING D3 开发者验证：`../product/docs/decoupling-d3-verification.md`
- 外部 Provider 解耦 D4A Bundle 生命周期：`external-provider-decoupling-d4a-provider-bundle-v1.md`
- DECOUPLING D4A 开发者验证：`../product/docs/decoupling-d4a-verification.md`
- Provider 中立前端体验：`frontend-provider-neutral-experience-v1.md`
- 前端 Provider 隔离开发者验证：`../product/docs/frontend-provider-isolation-01-verification.md`
