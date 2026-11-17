# ADR-0016：策略制品版本化与发布治理

- 状态：Accepted
- 日期：2026-11-09
- 范围：Workbench Projection、Role Configuration、Permission/Capability Policy 和其他策略制品的版本、校验、审批、发布、回滚与归档
- 前置决策：ADR-0008、ADR-0009、ADR-0010、ADR-0014、ADR-0015
- 用户决策：1-B 选择 B3
- 实施原则：本 ADR 冻结未来实现约束，不授权本期新建表、修改数据库、运行迁移、修改 EE Claw 代码或配置发布系统

## 1. 背景

ADR-0015 将企业角色拆分为：

- Authorization Role；
- Responsibility Role；
- Workbench Projection；
- Role Configuration。

其中 Workbench Projection、Role Configuration Schema/Default、Permission Bundle 和治理规则都需要：

- 可评审；
- 可发布；
- 可回滚；
- 可跨环境晋级；
- 可追溯到授权决策；
- 不允许生产运行时原地漂移。

如果全部写死在代码中，业务调整需要重新构建部署；如果全部存为可变数据库行，则缺少类型、审查、版本和回滚保证；如果以 Git 作为运行时读取源，则会把代码仓库、部署和在线解析耦合。

## 2. 决策摘要

采用 B3：

```text
语义与实现
→ 代码

版本与取值
→ DB 不可变 PolicyArtifactRelease

归档与评审镜像
→ Git JSON Snapshot，只写不读
```

代码持有：

- Key 白名单；
- 类型系统；
- Component Registry；
- Renderer；
- Validator；
- Lock Level 枚举；
- Approval Policy；
- Runtime Resolver 实现。

数据库持有：

- 不可变 Release Payload；
- Checksum；
- Lifecycle；
- Approval Evidence；
- Environment Promotion；
- Published Pointer；
- Superseding 关系。

Git 持有：

- 发布时自动生成的规范化 JSON 快照；
- Review/Audit 归档；
- 不作为运行时读取源；
- 不作为 DB 丢失后的唯一恢复源。

## 3. Policy Artifact

### 3.1 Artifact Kind

首期至少支持：

```text
workbench_projection
role_configuration_schema
role_configuration_defaults
permission_bundle
capability_policy
workflow_contribution
artifact_contract
```

新增 Kind 必须先在代码 Registry 注册，声明：

- Schema；
- Canonicalization；
- Validator；
- Renderer/Resolver；
- Approval Policy；
- Compatibility Rule；
- Secret Classification。

### 3.2 PolicyArtifactDefinition

```text
PolicyArtifactDefinition
- artifact_definition_id
- artifact_key
- artifact_kind
- owner_ref
- registry_key
- lifecycle_status
- created_at
```

Definition 是稳定身份，不包含当前可变取值。

### 3.3 PolicyArtifactRelease

```text
PolicyArtifactRelease
- artifact_release_id
- artifact_definition_id
- release_version
- schema_version
- payload
- payload_checksum
- code_registry_revision
- compatibility_declaration_ref
- lifecycle_state
- approval_evidence_refs
- published_environment?
- supersedes_release_id?
- created_by
- created_at
- validated_at?
- approved_at?
- published_at?
```

Payload、Checksum、Schema Version 和 Code Registry Revision 在 Release 创建后不可变。

## 4. 三层权威分工

### 4.1 代码：语义权威

代码是以下内容的唯一权威：

- 哪些 Key 合法；
- 每个 Key 的类型和约束；
- 哪些 UI/Runtime Component 可引用；
- 每个 Lock Level 的含义；
- 哪些 Artifact Kind 存在；
- 如何校验、渲染和解析；
- 哪些策略需要单人、双人或安全审批；
- 哪些字段是 Secret 或禁止存储。

数据库不得通过任意字符串创造新语义。

### 4.2 DB：版本与取值权威

DB 是运行时 Release、Published Pointer 和审批事实的权威。

运行时不从 Git 查找当前版本，不根据文件时间或分支推断 Published Release。

### 4.3 Git：归档镜像

发布时自动提交规范化 JSON：

```text
artifact key
artifact kind
release version
schema version
payload
payload checksum
code registry revision
approval evidence refs
published metadata
```

Git 镜像：

- 只写不读；
- 不参与运行时授权；
- 不允许人工修改后反向覆盖 DB；
- 用于 Review、Diff、归档和外部审计。

## 5. Release 不可变

允许：

- Insert 新 Definition；
- Insert 新 Release；
- 记录校验、审批和发布事件；
- 移动 Published Pointer；
- 将旧 Release 标记为 Superseded；
- 回滚 Published Pointer 到旧 Release。

禁止：

- Update 已创建 Release 的 Payload；
- Update Payload Checksum；
- Delete Release；
- 复用版本号写入不同内容；
- 用原地修改模拟回滚。

Lifecycle：

```text
DRAFT
→ VALIDATED
→ APPROVED
→ PUBLISHED
→ SUPERSEDED
```

实现可以使用受控状态字段或追加式 Lifecycle Event，但任何状态变化都不得改变 Release Payload。

失败状态可以记录：

```text
VALIDATION_FAILED
APPROVAL_REJECTED
PUBLISH_FAILED
ARCHIVE_FAILED
```

失败不删除历史 Release。

## 6. 发布管线

```text
DRAFT
→ VALIDATE
→ APPROVAL
→ PUBLISH
→ ARCHIVE
```

### 6.1 Draft

Draft 是编辑工作副本，不被生产 Resolver 引用。

### 6.2 Validate

Validator 固定：

- Artifact Kind；
- Schema Version；
- Code Registry Revision；
- Key 和 Component；
- 类型和值域；
- Lock Level；
- Compatibility；
- Secret 扫描；
- 存量引用影响。

### 6.3 Approval

审批策略：

| 内容 | 最低审批 |
|---|---|
| 仅 `personal_preference` Schema/默认值 | 单人发布审批 |
| `role_default` | 业务 Owner + 发布者分离 |
| 包含 `project_policy` | 项目治理审批 |
| 包含 `organization_policy` | 强制双人审批 |
| 包含 `security_policy` | 强制双人审批，至少一人为安全责任人 |

同一主体不能完成双人审批的两个独立席位。

### 6.4 Publish

Publish 必须原子地：

1. 校验目标环境；
2. 再次校验 Checksum；
3. 再次确认 Approval Evidence；
4. 更新 Published Pointer；
5. 递增 Policy Model Revision；
6. 写审计；
7. 发出失效事件；
8. 触发 Git Archive。

Git Archive 失败不能静默忽略。是否阻断 Published Pointer 由 Artifact Kind 的风险策略决定，并必须产生可见状态。

### 6.5 Archive

Archive 生成规范化 JSON。禁止把 Secret、Token、私钥或 Credential 写入快照。

## 7. 校验器

Validator 必须拒绝：

1. 未在代码 Registry 注册的 Key；
2. 未在 Component Registry 注册的组件名；
3. 超出声明类型、范围或枚举的值；
4. 删除仍有存量取值或引用的 Key，除非同时提供已批准迁移计划。

还必须拒绝：

- 未注册 Artifact Kind；
- 未知 Lock Level；
- Payload 中的 Secret；
- Schema Version 与 Runtime 不兼容；
- Checksum 不一致；
- 使用已撤销依赖；
- 未满足 Approval Policy。

删除 Key 的迁移计划至少声明：

```text
affected_artifacts
affected_values
replacement_key?
transform
validation
rollback
deadline
owner
```

## 8. 运行时解析

运行时使用：

```text
resolve(artifact_kind, scope, environment)
→ current published PolicyArtifactRelease
```

Resolver 返回：

```text
artifact_release_id
release_version
schema_version
payload_checksum
policy_model_revision
resolved_scope
resolved_at
```

运行时禁止：

- 读取 Draft；
- 读取 Git 决定当前版本；
- 自动选择最新 `created_at`；
- 在无 Published Pointer 时猜测；
- 因解析失败使用未审查默认值执行敏感写操作。

敏感策略解析失败时 Fail Closed。

## 9. 回滚

回滚定义为：

```text
Published Pointer
→ 指向一个已验证、已批准、兼容的旧 Release
```

回滚不是修改当前 Release。

回滚必须：

- 生成新的审计事件；
- 递增 Policy Model Revision；
- 触发缓存和决策失效；
- 保留被回滚 Release；
- 验证旧 Release 与当前代码 Registry/Runtime 兼容；
- 保留回滚原因和批准者。

## 10. AuthorizationDecision 绑定

ADR-0010 §5 的：

```text
AuthorizationDecision.policy_model_revision
```

取值来源是当前参与授权计算的 Published Policy Artifact Release 集合。

建议表示：

```text
policy_model_revision
- aggregate_revision
- artifact_release_refs
- release_checksums
- resolved_at
```

Authorization Decision 至少可追溯到：

- Permission/Capability Policy Release；
- Workbench/Role Config Release 中影响授权的部分；
- Code Registry Revision；
- 当前授权和身份 Revision。

Workbench Focus、纯展示字段和 Personal Preference 不得进入 Allow/Deny 语义；即使它们共享发布管线，也必须在 Artifact Kind 和字段分类中区分。

## 11. 跨环境晋级

支持：

```text
dev
→ test
→ prod
```

Release Export 必须包含：

- Definition Key；
- Version；
- Schema Version；
- Payload；
- Checksum；
- Code Registry Revision；
- Dependency/Compatibility；
- Approval Evidence 摘要；
- Source Environment。

Import 必须：

1. 校验 Checksum；
2. 校验目标环境 Registry；
3. 校验 Compatibility；
4. 不复用目标环境 Secret；
5. 不自动 Publish；
6. 生成目标环境独立审批和发布记录。

同一 Release 在不同环境的规范化 Payload Checksum 必须一致。

## 12. 降级为纯制品库

当连续 12 个月同时满足：

- 策略变更少于 20 次；
- 仅工程师发布；
- 无业务管理员自助发布需求；
- 无运行时动态 Scope/Value 需求；
- 审批和回滚频率低；

可以通过新实施决策将 DB Release Authority 退化为纯制品库模式 B1。

退化不得改变：

- 不可变 Release；
- Checksum；
- Approval Evidence；
- Published Pointer；
- AuthorizationDecision 可追溯；
- 跨环境一致性。

## 13. 永久禁止

1. 不得原地修改已发布 Release；
2. 不得删除 Release；
3. 不得让 Payload 引用代码未注册的 Key 或 Component；
4. 不得把 Secret 写入 Payload 或 Git Archive；
5. 不得跳过审批发布包含 `security_policy` 的版本；
6. 不得用 DB 行替代 Renderer、Validator 或计算逻辑；
7. 不得把 Git 当运行时权威；
8. 不得通过修改旧 JSON 快照改变历史；
9. 不得用最新时间戳替代 Published Pointer；
10. 不得在 Policy 解析失败时对敏感操作 Fail Open。

## 14. 验收要求

1. 修改已发布 Release Payload 被服务端拒绝；
2. 引用未注册 Key 的 Payload 发布失败；
3. 引用未注册 Component 的 Payload 发布失败；
4. 删除仍有存量值的 Key 被拦截，除非存在已批准迁移计划；
5. 包含 `security_policy` 的版本未完成双人审批无法发布；
6. 切回旧 Release 后，解析行为与该旧 Release 的 fixture 一致；
7. Published AuthorizationDecision 可回溯到具体 Release Version 和 Checksum；
8. Git 镜像规范化内容与 DB Payload 逐字节一致；
9. 跨环境 Import 后 Payload Checksum 一致；
10. Git Archive 被人工修改不会改变运行时结果；
11. Rollback 后 Policy Model Revision 递增并使旧 Decision 失效；
12. Payload 中包含 Secret 模式时校验失败。

## 15. 依据

- ADR-0008：不可变 Tool/Plugin Release 和 Registry 发布治理；
- ADR-0009：ExpertProfileRelease、EffectiveProfileSnapshot 和 Revision；
- ADR-0010：AuthorizationDecision.policy_model_revision；
- ADR-0014：Compatibility、Traceability、Fixture 和变更治理；
- ADR-0015：Workbench Projection 与 Role Configuration 是发布物；
- `reference-evidence-role-model.md`。

## 16. 非目标

本 ADR 不决定：

- DB 产品和物理表；
- Git Provider；
- 发布 UI；
- 审批 UI；
- CI/CD 产品；
- Payload 的最终 JSON Schema；
- 本期数据库迁移；
- 本期 EE Claw 代码变更。

实现必须经过独立任务授权。

