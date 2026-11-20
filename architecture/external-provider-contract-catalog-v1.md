# Process Copilot 外部 Provider Contract Catalog v1

- 状态：Accepted Extension
- 日期：2026-11-20
- 编号：延续 C01-C60，使用 C61-C66（D4A 新增 C66）
- 依据：ADR-0024、`external-provider-decoupling-d0-inventory-v1.md`
- 边界：冻结 Provider 注册、健康、路由、目录与可用性；不改变当前运行行为

## 1. 通用规则

1. 所有 Contract 使用稳定名称和 major version；
2. `provider_registration_id` 是 PC 签发的稳定标识，不能由 endpoint URL、secret ref 或外部 account id 代替；
3. Authority 和 namespace 使用小写、点分隔或冒号限定的稳定字符串；
4. Health、Directory 和 Availability 都有观察时间与过期时间，过期后 fail closed；
5. Directory/Availability 不能被当作 Authorization Decision；
6. 未知、重复或歧义 route 不得回退到全 Provider 遍历；
7. Contract 不携带长期 Credential、Cookie、Token 或 secret value。

## 2. Contract Catalog

### C61 `pc.provider-registration/1`

用途：注册一个可替换 Provider 及其可实现 Port、namespace 和 Authority 边界。

```text
provider_registration_id
provider_key
display_name
provider_kind
tenant_scope
port_kinds[]
action_namespaces[]
resource_authorities[]
connector_registration_refs[]
identity_provider_refs[]
registration_revision
configuration_digest
registration_state
registered_at
updated_at
```

`provider_kind = EXTERNAL_BUSINESS | LOCAL | IDENTITY_ONLY`。`registration_state = ACTIVE | DISABLED | SUPERSEDED`。注册只声明可路由边界，不代表健康或授权。

### C62 `pc.provider-health/1`

用途：记录 Provider 及各 Port 的短期健康和兼容性观察。

```text
health_observation_id
provider_registration_id
configuration_revision
provider_state
compatibility_status
port_health
reason_codes[]
evidence_refs[]
checked_at
expires_at
```

`provider_state = UNCONFIGURED | STARTING | HEALTHY | DEGRADED | UNAVAILABLE | DISABLED`。任何健康状态都不能产生 Authorization Allow；`expires_at` 后按不可用处理。

### C63 `pc.authority-route/1`

用途：把 action namespace 与资源 Authority 唯一路由到 PC-only 或指定 Provider 授权链。

```text
route_id
route_revision
action_namespace
action_pattern
resource_authority
resource_scope_pattern
authorization_mode
provider_registration_id?
capability_provider_required
ambiguity_policy
route_state
route_digest
effective_from
effective_to?
```

`authorization_mode = PC_ONLY | PC_AND_PROVIDER`，`ambiguity_policy` 首期固定为 `DENY`。`PC_ONLY` 禁止设置 Provider；外部 Authority 必须由运行时额外校验 Provider Registration 状态和唯一性。

### C64 `pc.project-directory-snapshot/1`

用途：返回某 Principal 在一个 Provider 下短期可见的最小项目目录。

```text
snapshot_id
provider_registration_id
tenant_id
principal_id
identity_link_ref
resource_authority
projects[]
source_revision
source_digest
evidence_refs[]
observed_at
expires_at
```

每个 project 只包含稳定 `project_ref`、可展示 code/name 与可选 organization ref。该快照不能作为对象读写授权，也不能替代执行时 Provider Decision。

### C65 `pc.capability-availability/1`

用途：提供某 Provider 的能力呈现与 Effective Tool Set 装配输入。

```text
availability_id
provider_registration_id
tenant_id
principal_id?
health_observation_id
catalog_revision
capabilities[]
reason_codes[]
evidence_refs[]
observed_at
expires_at
```

每个 capability 声明 capability/tool ref、action namespace、resource authority、operation class、approval requirement 与 availability state。`AVAILABLE` 只表示可发现和可装配，执行仍需 C03、C21-C24 和源系统最终授权。

### C66 `pc.provider-bundle/1`

Versioned D4A lifecycle descriptor, supplemental to unchanged C61/C62/C65. No credentials, endpoint values, executable Port or Authorization Allow are serialized. READY maps to the existing C62 HEALTHY state. Generation includes a process epoch; retained diagnostic metadata is not an active capability.

```text
provider_id
bundle_version
registration_revision
compatibility_status
catalog_revision
configuration_digest
bundle_generation
bundle_state
reason_codes[]
observed_at
expires_at
```

Lifecycle/failure semantics: `external-provider-decoupling-d4a-provider-bundle-v1.md`.

## 3. Port Catalog

| Port | 注册输入 | 运行输入/输出 | 既有执行 Contract |
| --- | --- | --- | --- |
| `IdentityProviderPort` | C61 | C62、ExternalIdentityLink | C01-C03 |
| `EnterpriseAuthorizationPort` | C61、C63 | C62、Provider Decision | C03、C41 |
| `ProjectDirectoryPort` | C61、C63 | C64 | C01、C03 |
| `BusinessCapabilityProviderPort` | C61、C63 | C62、C65 | C15、C21-C24 |
| `WorkbenchProjectionPort` | C61、C63 | C62、C65、后续 Projection Contract | C13、C14、C32 |

## 4. D0 Contract 验收

- [x] Provider Registration 与 Health 分离；
- [x] Route 显式包含 action namespace 和 resource authority；
- [x] PC-only route 与外部 Provider route 可区分；
- [x] 歧义 route 固定 fail closed；
- [x] Project Directory Snapshot 不表达对象操作 Allow；
- [x] Capability Availability 不表达执行授权；
- [x] 所有短期观察具有 expiry；
- [x] Contract 不包含长期 secret；
- [x] C61-C65 可映射到本地接口、REST 或事件而不改变领域语义。
