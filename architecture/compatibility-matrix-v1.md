# Process Copilot Compatibility Matrix v1

- 状态：Accepted Implementation Blueprint
- 日期：2026-11-09
- 依据：ADR-0006、ADR-0008、ADR-0009、ADR-0014 至 ADR-0017
- 原则：未知组合不自动进入生产；兼容声明必须由测试证据支持

## 1. 当前首期基线

| 维度 | 首期基线 | 状态 |
|---|---|---|
| Process Copilot Architecture | ADR-0001 至 ADR-0017 | Accepted |
| Contract Catalog | `v1` / major `1` | Supported |
| Traceability Manifest | `v1` | Supported |
| DSH | `0.2.1-rc.3` | Supported |
| DSH Commit | `1f81c047fc48fa190a683e469daa699857e9afe8` | Pinned |
| Node.js for DSH | `^22.19.0 || >=24.0.0` | DSH declared range |
| pnpm for DSH build | `11.28.5` | Pinned build baseline |
| Runtime Bridge Protocol | `1` | Planned supported |
| PC Runtime Profile Schema | `1` | Planned supported |
| Effective Profile Snapshot | `pc.effective-profile-snapshot/1` | Planned supported |
| Event Envelope | `pc.event-envelope/1` | Planned supported |
| Adapter Error | `pc.adapter-error/1` | Planned supported |
| EE Claw Platform Auth Source | `runtaozhang` / `cefa7432f966e17b41c1638e128de652b934fd20` | Pinned evidence baseline |
| EE Claw V1 Contract | 8 tables + `/api/v1/*` + audit format | Frozen compatibility surface |
| Baseline Page Keys | `BASELINE_PAGE_KEYS_V1` | Planned supported |
| Policy Artifact Schema | `eeclaw.policy-artifact-release/1` | Planned supported |

首期发布前，`Planned supported` 必须由实现、fixture 和端到端测试转为 `Verified supported`。

## 2. 组合矩阵

| 组合 ID | PC Contract | Bridge | Profile Schema | DSH | Plugin/Preset 构建 | 支持状态 | 说明 |
|---|---|---|---|---|---|---|---|
| S1 | 1 | 1 | 1 | 0.2.1-rc.3 / pinned commit | 同一 release lock | Supported baseline | 首期唯一生产基线 |
| C1 | 1 | 1 | 1 | 同版本其他 commit | 重新构建并全量测试 | Candidate only | commit 变化视为候选升级，不自动兼容 |
| C2 | 1 | 1 | 1 | 后续 patch/rc | 重新构建并全量测试 | Candidate only | 必须通过 DSH contract 和行为测试 |
| C3 | 1 | 2 | 1 | 已验证 DSH | 双协议协商 | Candidate only | Host 与 Bridge 同时支持 overlap window 才可灰度 |
| C4 | 2 | 1/2 | 2 | 已验证 DSH | 新 release lock | Candidate only | 需要迁移/双读或明确停机升级 |
| U1 | 1 | 未知 | 1 | 任意 | 任意 | Unsupported | Bridge 协议未知，拒绝握手 |
| U2 | 1 | 1 | 未知 | 任意 | 任意 | Unsupported | Profile Schema 未知，拒绝启动 |
| U3 | 未知 major | 任意 | 任意 | 任意 | 任意 | Unsupported | 安全和业务 Contract 未知，fail closed |
| U4 | 1 | 1 | 1 | 未验证 DSH | 旧 lock | Unsupported | 不允许用旧产物猜测兼容 |
| U5 | 1 | 1 | 1 | 已验证 DSH | Plugin 不满足 DSH range | Unsupported | compatibility preflight 应在 import 前拒绝 |
| U6 | 1 | 1 | 1 | 已验证 DSH | 混用不同 release lock | Unsupported | 禁止同一 Runtime 漂移装配 |

### 2.1 EE Claw 授权兼容组合

| 组合 ID | V1 Schema/API | Baseline Page Set | Policy Artifact | 数据迁移 | 支持状态 | 说明 |
|---|---|---|---|---|---|---|
| EA-S1 | pinned commit 合同 | V1 | schema 1 | none | Supported baseline | 老账号/角色权限集合保持，新增页面不自动开放 |
| EA-C1 | V1 不变 | V2 candidate | schema 1 | none | Candidate only | 必须证明旧页面集合不减少且新增页面显式授权 |
| EA-C2 | V1 不变 | V1 | schema 2 | none | Candidate only | 需要 Policy Artifact fixture、双版本读取和回滚验证 |
| EA-U1 | V1 响应或错误码变化 | 任意 | 任意 | 任意 | Unsupported | 必须使用新 API major 或兼容层 |
| EA-U2 | V1 不变 | 动态全部 default_open | 任意 | none | Unsupported | 未来新增页面会被历史 `page:*` 自动授予 |
| EA-U3 | V1 不变 | V1 | 可变已发布行 | none | Unsupported | 破坏 Release 不可变和审计可追溯 |
| EA-U4 | V1 不变 | V1 | schema 1 | required | Unsupported in ADR-0017 | 超出零迁移范围，需新增决策 |

## 3. 兼容维度与验证

| 维度 | 兼容输入 | 最低验证 |
|---|---|---|
| Contract | major、required fields、enum、canonical digest | schema tests、golden fixtures、consumer tests |
| Bridge | protocol version、handshake、command/error/event semantics | Host/Bridge bidirectional contract tests |
| DSH | commit、公开/内部 seam 行为、Session/Tool/Approval/Preset 语义 | pinned source tests、PC adapter integration tests |
| Profile | Profile schema、Bundle lock、Plugin release、Preset composition | build reproducibility、compatibility preflight、startup smoke |
| Tool/Plugin | schema digest、risk、permissions、DSH range、artifact digest | registry validation、signature/SBOM policy、execution fixture |
| Event | event schema、cursor、sequence、durability | replay、duplicate、out-of-order、gap and catch-up tests |
| Persistence | schema version、migration、projection rebuild | migration rehearsal、backup/restore、rebuild comparison |
| Security | authorization revision、credential generation、approval snapshot | revocation、stale token/fence、cross-user isolation tests |
| Deployment | image digest、environment、worker pool、feature flags | canary、rollback、health/SLO gates |
| Enterprise Role | Authorization/Responsibility/Projection/Configuration 分离 | role count、focus neutrality、profile non-escalation tests |
| Policy Artifact | code registry、release schema、checksum、approval、published pointer | immutable release、unknown key、dual approval、rollback fixtures |
| Legacy Auth | 8 表、V1 API、auth/me、audit、baseline pages | contract snapshots、no migration、immediate revocation tests |

## 4. DSH 升级门禁

升级 DSH 时必须：

1. 固定候选 tag 和 commit；
2. 重新运行 DSH 证据测试；
3. 重新构建 PC Runtime Profile、Bundle 和 Plugin lock；
4. 比较 Session、Tool、Approval、AgentPreset、Plugin preflight 和 SDK/API 行为；
5. 运行 Bridge command/error/event contract tests；
6. 运行持久 Session 恢复和 Event catch-up fixtures；
7. 运行跨用户、跨 Session、撤权、Fencing 和审批安全矩阵；
8. 更新本兼容矩阵和 `pc.compatibility-declaration/1`；
9. 通过灰度 Runtime Pool 验证；
10. 保留上一已验证组合用于回滚。

以下变化即使 semver 未变，也视为潜在不兼容：

- Session event 类型、顺序或持久语义改变；
- `flush()` 或 resume 行为改变；
- Tool pre/post/guard 顺序改变；
- Approval fail-closed 行为改变；
- AgentPreset 选择、锁定或 composition 语义改变；
- Profile/Bundle patch 顺序改变；
- Plugin compatibility preflight 改变；
- SDK/API 错误结构、取消或事件过滤改变。

## 5. Contract 升级规则

### 同 major

允许：

- 新增可选字段；
- 新增不扩大授权的枚举值；
- 新增诊断信息；
- 增加消费者可以忽略的事件类型。

要求：

- 旧消费者安全忽略；
- canonical digest 规则保持稳定；
- 新字段缺失时语义明确；
- 安全路径未知值 fail closed。

### 升 major

必须升 major：

- 删除或重命名字段；
- 改变字段单位、身份或时序语义；
- 将可选字段变为必需；
- 改变幂等、Fencing、授权或审批解释；
- 改变 Event sequence/cursor 语义；
- 改变错误 code 的业务含义。

major 升级需要：

- Superseding ADR 或实施决策；
- 双读/双写/转换策略或明确停机窗口；
- Fixture 覆盖旧版本；
- 回滚可行性说明。

## 6. Plugin 与 Profile 规则

1. 每个 PluginRelease 声明精确 artifact digest 和 DSH compatibility range；
2. 每个 Runtime Profile 具有不可变 bundle lock digest；
3. Runtime 启动后禁止在线安装未知 Plugin；
4. AgentPreset 只引用已批准 PluginRelease；
5. EffectiveProfileSnapshot 绑定 ProfileRelease、ToolRelease、PluginRelease 和 runtime requirements；
6. Runtime capability 不满足时拒绝 Assignment，不做静默降级；
7. compatibility exemption 必须精确到 package/version/runtime，并有期限、责任人和测试证据；
8. exemption 文件损坏时按不授权处理。

## 6.1 Enterprise Role 与 Policy Artifact 规则

1. Authorization Role、Responsibility、Workbench Projection 和 Role Configuration 独立版本；
2. `focus` 不进入 Allow/Deny；
3. Policy Artifact Payload 只能引用代码 Registry 已发布 Key/Component；
4. Published Release Payload 和 Checksum 不可变；
5. Git Archive 只写不读；
6. `AuthorizationDecision.policy_model_revision` 可追溯到具体 Release；
7. V1 `page:*` 只展开固定 Baseline；
8. 新增页面和新角色入口必须有独立兼容 fixture。

## 7. 数据与事件升级

1. 权威数据迁移必须前向可恢复，并在发布前演练；
2. Projection 可以重建，不能成为不可逆迁移的唯一来源；
3. Event payload 使用独立 schema version；
4. Normalizer 保留旧版本 fixture；
5. 未识别事件进入 quarantine，不推进业务状态；
6. Event gap 未修复前，不假定后续状态完整；
7. 回滚不能删除新版本已写入的权威事实。

## 8. 灰度与回滚

灰度单位：

```text
environment
→ worker pool
→ runtime profile release
→ user cohort
→ new session
```

默认不在活动 Session 中途切换 DSH、Bridge、Profile 或 Plugin release。

回滚要求：

- 新 Assignment 只进入上一已验证组合；
- 既有 Session 按兼容声明继续、迁移或排空；
- 旧 Bridge 不读取未知 major；
- 外部 Operation Ledger 和 BusinessApproval 不随 Runtime 回滚丢失；
- 回滚后继续拒绝旧 Fencing Token 和旧 Credential Generation。

## 9. 紧急豁免

紧急豁免只能用于已知、受限且可回滚的兼容冲突，不能用于：

- 绕过身份或授权；
- 接受未知 Contract major；
- 关闭 Fencing、Approval 或 Gateway 校验；
- 使用未校验 Plugin artifact；
- 暴露长期凭据；
- 忽略 Event gap 或 Outcome Unknown。

豁免记录至少包含：

```text
exemption_id
exact component/version
exact runtime version
reason
risk
owner
approved_by
created_at
expires_at
test_evidence
rollback_plan
```

## 10. 发布判定

只有同时满足以下条件，组合才能标记为 `Verified supported`：

- [ ] 所有适用 Contract schema/golden tests 通过；
- [ ] DSH 行为证据测试通过；
- [ ] Runtime Host/Bridge 双向 contract tests 通过；
- [ ] Profile/Bundle 可重复构建且 digest 一致；
- [ ] Plugin compatibility preflight 通过；
- [ ] Session 恢复、Event replay/catch-up 通过；
- [ ] Fencing、撤权、审批和跨用户隔离测试通过；
- [ ] 灰度 SLO 和错误预算满足门禁；
- [ ] Traceability Manifest 无缺失项；
- [ ] 回滚演练通过。
- [x] ADR-0015 角色/Focus/Profile 非扩权矩阵通过，证据见 `product/packages/authorization/tests/enterprise-authorization.test.ts`；
- [x] ADR-0016 Release 不可变、双人审批、Checksum 和回滚测试通过，证据见 `product/packages/authorization/tests/enterprise-authorization.test.ts`；
- [x] ADR-0017 V1 Contract、零迁移、Baseline 和即时撤权测试通过，证据见 `product/packages/authorization/tests/enterprise-authorization.test.ts`。

## 11. D4A Provider Bundle 兼容扩展

- 2026-11-20：新增 C66 `pc.provider-bundle/1`；未知 major、未知字段和凭据字段拒绝。
- C61 Registration、C62 Health、C63 Authority Route 和 C65 Availability 的 v1 schema 与语义不变。
- C66 `READY` 映射到 C62 `HEALTHY`；C65 用既有 `evidence_refs` 表达 generation/registration revision，不附加未版本化字段。
- D4A 的 `DEGRADED` 只允许诊断，五类 EE Port 均不可执行。Health/Availability 不产生授权 Allow。
- Connector registration key 绑定进程 epoch 和 generation；旧 Principal Envelope audience、Binding、Credential Lease 不能在重载/重启后成为当前 Connector。
- D1-D3、Gateway、Runtime、SSTS、MEMORY-01A 既有测试保持；无需 EE/schema/DSH 迁移。
- 验证：`product/packages/contracts/tests/provider-bundle.test.ts`、`product/apps/api/tests/ee-provider-bundle.test.ts`、`product/apps/api/tests/ee-provider-bundle-startup.test.ts`。
- 结论仅为 `D4A COMPLETE / D4B NOT STARTED`，不是独立验收或发布资格；完整结果见 `product/docs/decoupling-d4a-verification.md`。

