# Tool / Plugin Registry 与执行治理参考证据

> 状态：Accepted Evidence
> 日期：2026-11-09
> 关联决策：ADR-0008 Tool / Plugin Registry 与执行治理
> 候选仓库数量：3
> 说明：三张证据卡均达到 R2，支持 ADR-0008；外部测试套件已检查但未在本批执行，因此不提升为 R3。

## REF-TP-001：DeepSeek Harness Tool、Approval、Plugin Manager 与 MCP Bridge

```text
reference_id: REF-TP-001
product_tree_node: T6.1-T6.7
candidate_repository: deepseek-ai/deepseek-harness
repository_url: https://github.com/deepseek-ai/deepseek-harness
baseline_tag: dsh-v0.2.1-rc.3
baseline_commit: 1f81c047fc48fa190a683e469daa699857e9afe8
commit_date: 2026-10-23
license: MIT
technology_stack: TypeScript / Node.js / Cordis / pnpm
evidence_level: R2
adoption_decision: adopt / adapt / reject_as_pc_authority
```

### 检查路径

- `packages/core/tools/src/index.ts`
- `packages/core/tools/tests/tools.spec.ts`
- `packages/core/tools/tests/scoped.spec.ts`
- `packages/core/tools/tests/ptc.spec.ts`
- `packages/interaction/user-approval/src/index.ts`
- `packages/interaction/user-approval/tests/approval.spec.ts`
- `packages/boot/app-boot/src/plugin-compatibility.ts`
- `packages/boot/app-boot/src/profile.ts`
- `packages/boot/app-boot/src/profile-resolution`
- `packages/boot/app-boot/tests/compatibility-preflight.spec.ts`
- `packages/boot/app-boot/tests/config-reload.spec.ts`
- `packages/boot/app-boot/tests/user-patches.spec.ts`
- `packages/boot/plugin-manager/src`
- `packages/boot/plugin-manager/tests`
- `packages/mcp/mcp-client/src/tools.ts`
- `packages/mcp/mcp-client/src/connection.ts`
- `packages/mcp/mcp-client/tests/apply.spec.ts`
- `packages/mcp/mcp-client/tests/mcp-client.spec.ts`
- `apps/cli/src/plugin.ts`
- `apps/cli/tests/built-bin.e2e.ts`
- `docs/tool-execution-pipeline.md`
- `docs/architecture.md`

### 发布制品核对

核对 npm 发布包：

- `@deepseek-ai/dsh@0.2.1-rc.3`
- `@deepseek-ai/dsh-tools@0.2.1-rc.3`
- `@deepseek-ai/dsh-user-approval@0.2.1-rc.3`
- `@deepseek-ai/dsh-app-boot@0.2.1-rc.3`
- `@deepseek-ai/dsh-plugin-manager@0.2.1-rc.3`
- `@deepseek-ai/dsh-mcp-client@0.2.1-rc.3`

已记录 npm SRI：

- `dsh`: `sha512-H+E9HLnHf7fJqzen84Z9Bq8ggb5xbrcbyhZjXTJLE9NabHr3zteGvTRvdvGkxPl4ov80is4WLglFmSo+/olJjg==`
- `dsh-tools`: `sha512-fHmhIFaztPt9+uvOlk3p4wXMU62F+TRe0ozVPasV3seIsFcxpca74QGSK5dFHICDhKIY1T9MUh0F3itMTdMi3A==`
- `dsh-app-boot`: `sha512-Vngr+bTqXbIqS+epr8Nt7GWI9u6tsoHoxx6xcJ3ta6pCE2Oy246kiy/3xS+CDUlM/WOPB6NZoSyrANH3bCIU+g==`
- `dsh-plugin-manager`: `sha512-jmu0cUTq4EL/8XNfZ/2+KXAE8XAyWb8mCwabQJd9ueQdu6FtRKE7Kc/+PpvLM3b665A8GJD6S0snM8uJNXuI8Q==`

### 主调用链

```text
Plugin / Provider
→ ctx.tools.register(ToolDefinition)
→ scoped Tool view / restrict
→ tools/pre-execute
→ Approval seam when ask
→ monotonic Tool Guard
→ tools/execute
→ Tool body
→ output schema validation and canonical value
→ tools/post-execute
→ final materialization
→ tools/result
```

### Tool Registry 确认

- Global 和 scoped registration 分层；
- scoped Tool 可以遮蔽 Global Tool；
- 同一层重复名字拒绝；
- Registration 返回精确 disposer；
- dispose 后 Tool 从 Registry 移除；
- `tools/change` 通知 Tool Set 变化；
- restriction 使用交集；
- monotonic Guard 只能拒绝，不能强制允许；
- Unknown / hidden Tool 在执行边界失败；
- 参数经过 lossless JSON 快照和冻结；
- Output 必须声明 Schema；
- 成功值先通过 Schema 验证，再投影为模型内容；
- Tool、Policy 和 Projection 失败被规范化为结果；
- `AbortSignal` 是合作式取消，已启动 Promise 仍需收敛；
- started work 被取消后仍等待 quiescence。

### Approval 确认

- `ApprovalPolicy` 为 `ask | never`；
- 缺少 Answerer 时 Fail Closed；
- grant 只有 `allowed-once`；
- asked / decided 成对写入 DSH Session；
- 取消会返回 `cancelled` 并丢弃迟到回答；
- Approval 绑定 Tool Name、Call ID 和 Reason；
- 不保存 PC 业务审批对象、参数 Hash、业务对象版本或跨 Runtime 状态。

### Plugin / Package Manager 确认

- Profile 使用 package.json、pnpm lockfile 和 Bundle Patch；
- Package 操作使用文件锁；
- 检测上一次遗留 pnpm 进程；
- 安装、移除和更新可回滚 package.json / lockfile；
- 兼容性预检支持 `engines.dsh` 和 DSH peer dependencies；
- 不兼容版本默认拒绝；
- 风险豁免绑定精确 plugin version + DSH version；
- 可保存精确版本；
- 可区分 integrity、network、timeout、build-blocked 等失败；
- 私有 Registry 不自动回退公共 Registry；
- 安装可取消，取消后等待文件恢复；
- Plugin Manager 返回 `applied`、`restart-required`、`overridden`、`failed`、`cancelled`；
- HMR 不可用、Package 移动或 Host Module 变化时要求重启；
- Loader Entry / Fiber dispose 负责资源回收。

### MCP Bridge 确认

- Tool 身份使用稳定 `(serverName, rawName)`；
- public name 使用 Server-qualified namespace；
- 新一代 Tool 先完整构造，再替换旧一代；
- 重同步失败保留旧一代；
- 注册冲突回滚整个新一代，避免部分暴露；
- Call 传递 ToolExecution signal 和 timeout；
- MCP 结果转为 DSH canonical value；
- DSH MCP Bridge 不能替代 PC Tool Release、Risk、Approval 和 Operation Ledger。

### 关键测试证据

- duplicate registration、scope shadow、restriction intersection；
- disposer / HMR safety；
- pre / guard / execute / post 顺序；
- output schema mismatch；
- approval missing / rejection / cancellation；
- caller cancellation before and after dispatch；
- MCP generation atomic swap 和 conflict rollback；
- Plugin compatibility preflight before import；
- package files restore after failure or cancellation；
- removed Plugin waits for resource release；
- runtime reload 与 restart-required 分流。

### 可采用

1. Tool registration disposer；
2. scoped Tool View；
3. monotonic Guard；
4. pre / around / post pipeline；
5. canonical output validation；
6. cooperative cancellation；
7. Loader Entry / Fiber 生命周期；
8. Profile Bundle、Dependency Lock、Compatibility Preflight；
9. Package operation lock / rollback / cancellation；
10. MCP Tool generation 原子替换。

### 必须适配

1. DSH ToolDefinition 映射 PC ToolRelease；
2. DSH ToolExecution 映射 PC ToolCall / Attempt；
3. DSH Approval 映射 PC 持久审批暂停点；
4. DSH Plugin Manager 只能由受控运维或构建流程使用；
5. DSH Result 映射 PC ToolResultEnvelope 和 ResourceRef。

### 不可作为 PC 权威

- 企业 Publisher Registry；
- 用户 / 项目授权；
- 业务 Approval；
- Operation Ledger；
- Release Revocation；
- 外部写幂等；
- 跨 Runtime 兼容和调度；
- 供应链信任根。

## REF-TP-002：Backstage Software Catalog

```text
reference_id: REF-TP-002
product_tree_node: T6.1 / T6.3
problem_statement: 来源、所有权、生命周期、关系和 Provider 状态收敛
candidate_repository: backstage/backstage
repository_url: https://github.com/backstage/backstage
baseline_commit: 453e51585aee6663d4e4030955d0459d5c564cf2
commit_date: 2026-11-08
license: Apache-2.0
technology_stack: TypeScript / Node.js / PostgreSQL
evidence_level: R2
adoption_decision: adapt / compare_only
```

### 检查路径

- `packages/catalog-model/src/entity/Entity.ts`
- `packages/catalog-model/src/schema/kinds/Component.v1alpha1.schema.json`
- `plugins/catalog-backend/src/processing/connectEntityProviders.ts`
- `plugins/catalog-backend/src/database/DefaultProviderDatabase.ts`
- `plugins/catalog-backend/src/database/tables.ts`
- `plugins/catalog-backend/src/database/DefaultProviderDatabase.test.ts`
- `plugins/catalog-backend/src/processing/connectEntityProviders.test.ts`
- `plugins/catalog-backend/src/processing/evictEntitiesFromOrphanedProviders.ts`
- `plugins/catalog-backend/src/processing/evictEntitiesFromOrphanedProviders.test.ts`

### 主调用链

```text
EntityProvider
→ EntityProviderConnection.applyMutation(full | delta)
→ envelope validation
→ sourceKey attribution
→ prepare mutation
→ database transaction
→ replace / add / remove raw entities
→ processing / stitching
→ final entity + relations + etag
```

### 确认

- Entity 使用 stable ref、server-assigned uid 和 etag；
- Component 强制 owner 和 lifecycle；
- Provider 使用稳定 provider name 作为 sourceKey；
- Full Mutation 表示一个来源的完整当前集合；
- Delta Mutation 表示增量增加和移除；
- 来源冲突被显式检测和记录；
- Provider 消失可以识别 orphaned source；
- 数据库事务发生在预处理之后；
- deadlock 可重试，但事务回调禁止外部副作用；
- 测试覆盖 full replacement、delta、source references、冲突和 orphan eviction。

### 可借鉴

1. Source、Owner、Lifecycle 分离；
2. Provider 作为来源权威；
3. Full / Delta 两种 Registry 同步方式；
4. stable ref + uid + etag；
5. 来源冲突和 orphan source 显式治理；
6. 预处理与事务提交分离。

### 不可直接照搬

- Backstage Entity 是可变 Catalog 视图，不是不可变可执行 Release；
- Catalog owner 不等于安全 Publisher；
- etag 不等于制品 Digest；
- Catalog Processor 不执行 Tool；
- Catalog 权限模型不能替代 PC Tool Call 实时授权；
- Backstage 不提供 PC 所需 Approval、Fencing、Idempotency 和 Outcome Unknown。

## REF-TP-003：Sigstore Cosign

```text
reference_id: REF-TP-003
product_tree_node: T6.3
problem_statement: 制品 Digest、签名身份、透明日志和 Provenance 验证
candidate_repository: sigstore/cosign
repository_url: https://github.com/sigstore/cosign
baseline_commit: 92514f9fedfabaf562f4946469a29b18c1ea68e7
commit_date: 2026-11-04
license: Apache-2.0
technology_stack: Go / OCI / Sigstore
evidence_level: R2
adoption_decision: adapt / future_extension
```

### 检查路径

- `pkg/cosign/verify.go`
- `pkg/cosign/verifiers.go`
- `pkg/cosign/verify_bundle.go`
- `pkg/cosign/verify_test.go`
- `pkg/cosign/verify_bundle_test.go`
- `cmd/cosign/cli/verify/verify.go`
- `cmd/cosign/cli/verify/common.go`
- `cmd/cosign/cli/verify/verify_test.go`
- `test/e2e_test.go`

### 主调用链

```text
Artifact reference
→ resolve immutable digest
→ fetch signature / attestation / bundle
→ load trusted material
→ cryptographic signature verification
→ certificate chain / identity / issuer policy
→ transparency log or signed timestamp verification
→ claim subject digest verification
→ verified result
```

### 确认

- Verification 可以绑定公钥或证书身份；
- certificate subject 和 issuer 可精确或正则匹配；
- ClaimVerifier 校验签名声明中的 Artifact Digest；
- in-toto Subject 必须包含匹配 Digest；
- 新 Bundle Format 需要 Trusted Root；
- 默认可验证透明日志、集成时间、SCT 或签名时间戳；
- 支持离线 Bundle 验证；
- 没有匹配签名时整体失败；
- 测试覆盖错误 Identity、Issuer、Digest、Bundle 和 Trust Material。

### 可借鉴

1. Release 以 Digest 而非 Tag 作为稳定制品身份；
2. Signature Identity 与 Artifact Digest 同时验证；
3. Trust Root 与验证策略分离；
4. Provenance / Attestation 绑定 Subject Digest；
5. 离线 Bundle 适合受限网络环境；
6. 验证失败必须 Fail Closed。

### 首期不建议强制

Process Copilot 首期若强制完整 Sigstore，需要同时建设：

- 发布身份；
- CI 签名；
- Trust Root 分发和轮换；
- 透明日志可达性或离线 Bundle；
- Keyless / Key-based 策略；
- 撤销和历史验证；
- 构建 Provenance。

因此首期建议保存 `signature_ref`、`provenance_ref` 和 `ArtifactVerifier` 接口，但以 Allowlist Source、Digest、Dependency Lock、Compatibility Matrix 和 PC Revocation 为最低门槛。

## 标准补充

### OCI Distribution Specification v1.1.1

```text
tag: v1.1.1
commit: a139cc423184af6078077b9b7ee336eddbd03f8f
role: supplemental standard
```

借鉴：

- Manifest / Blob 使用 Content Digest；
- Tag 是可变引用，Digest 是内容身份；
- 制品、签名和 Attestation 可通过 OCI Artifact / Referrer 关系组织。

### SLSA / in-toto Provenance

借鉴：

- Provenance 作为独立可验证声明；
- Subject 使用 Artifact Digest；
- Build Identity、Source 和 Parameters 不与业务 Registry 对象混为一体。

### TUF 风格信任更新

未来借鉴：

- Trust Root 轮换；
- 元数据过期；
- Rollback 和 Freeze 防护；
- 分角色签名；
- 撤销传播。

首期不要求完整实现 TUF Repository。

## 综合证据结论

### 可直接采用的机制

1. DSH scoped Tool Registry、disposer 和 monotonic Guard；
2. DSH canonical output validation；
3. DSH Plugin compatibility preflight、lock、rollback 和 cancellation；
4. Backstage Source / Owner / Lifecycle / Full-Delta sync；
5. Digest 作为 Release Artifact Identity；
6. Signature / Attestation 作为可插拔验证层。

### 必须由 PC 自行设计

1. ToolDefinition / Release / Registration；
2. PluginDefinition / Release / Installation / Activation；
3. Publisher Policy；
4. Risk Manifest；
5. Approval Payload Hash；
6. Operation Ledger；
7. Idempotency 和 Fencing；
8. Readback / Reconciliation；
9. ResultEnvelope / ResourceRef / JobHandle；
10. Release Revocation 与 Effective Tool Set Invalidation。

### 排除

- 把 DSH Plugin Manager 直接当作租户 Tool 市场；
- 把 Backstage Catalog Entity 当作可执行 Release；
- 把 npm Version 或 Tag 当作不可变身份；
- 只验 checksum，不记录 Publisher、Owner 和 PC 审核；
- 首期因供应链完整性而强制建设全部 Sigstore 基础设施；
- 允许 Session 动态改变 Runtime Plugin 集。

