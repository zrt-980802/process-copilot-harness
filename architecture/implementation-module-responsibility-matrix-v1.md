# Process Copilot 模块责任矩阵 v1

- 状态：Accepted Implementation Blueprint
- 日期：2026-11-09
- 依据：ADR-0001 至 ADR-0017
- 目标：定义首期绿地实现的模块边界、权威数据、依赖方向和部署归属

> 2026-11-16 Accepted Extension：长期记忆 M23-M29 定义于 `memory-module-responsibility-matrix-v1.md`。M01-M22 的既有责任不变。

## 1. 划分原则

1. 按权威来源和一致性边界划分，不按页面、现有 Demo 目录或数据库表划分；
2. 控制面不依赖 DSH 内部类型，Runtime 集成统一经过 `DshAdapterPort`；
3. 企业写操作统一经过受控 Gateway，Runtime Plugin 不直连企业系统；
4. 模块可以首期同进程部署，但逻辑责任、Contract 和数据所有权必须保持分离；
5. 只有拥有模块可以修改其权威记录，其他模块通过命令、查询或事件访问；
6. Projection、缓存和 Runtime 本地状态都不是业务权威；
7. 跨模块写入使用显式命令、幂等键和审计上下文，禁止共享数据库表写入。

## 2. 逻辑分层

```text
Experience/API
  ↓
Application Orchestration
  ↓
Control Plane Authorities
  ↓
Runtime Integration / Gateways
  ↓
DSH Runtime and External Systems
  ↓
Projection / Audit / Observability
```

首期允许模块合并部署，但不允许责任回流。例如 Runtime Host 可以与 Bridge Sidecar 同进程，却不能成为 Assignment 或 BusinessApproval 权威。

## 3. 模块责任矩阵

| ID | 模块 | 首期责任 | 权威数据 | 禁止承担 | 主要依赖 | 关联 ADR |
|---|---|---|---|---|---|---|
| M01 | API / Application Facade | 接收 UI/调用方请求；建立 RequestContext；编排应用用例；返回稳定 DTO | 无长期权威，仅 request/idempotency 上下文 | 直接驱动 DSH、直接写外部系统、持有业务真相 | M02-M12、M21 | 0010-0014 |
| M02 | Principal & Identity | 管理 PCPrincipal、ExternalIdentityLink、主体状态和登录映射 | Principal、IdentityLink | 按邮箱/显示名自动链接；保存下游业务凭据 | 企业 IdP、M03、M11 | 0007、0010、0012 |
| M03 | Authorization | 计算角色、项目、资源、Profile、Tool 和动作授权；签发短期 AuthorizationSnapshot/PrincipalEnvelope；消费外部 Policy Model Revision | Policy、Grant、AuthorizationRevision | 把 UI 可见性、Focus 或责任关系当执行授权；签发长期企业 Token | M02、M06、M07、M09、M11、E01-E04 | 0001、0007-0010、0012、0015-0017 |
| M04 | Runtime Registry & Scheduler | Runtime 生命周期、用户归属、容量、调度、健康、Tombstone、创建/回收决策 | RuntimeRecord、RuntimeEpoch、CapacityRecord | 保存 Session/业务状态；自行扩大 Runtime 权限 | M05、M15、M18、M20 | 0001、0004、0013 |
| M05 | Session Assignment & Lease | Session 到 Runtime 的唯一分配；Generation、Lease、Fencing、迁移和 CAS | SessionAssignment、Lease、FencingToken | 根据 Runtime 自报覆盖权威记录；重试外部写 | M04、M10、M15、M16 | 0001-0004、0006 |
| M06 | Expert Profile Control Plane | Profile Definition/Draft/Release、Assignment、偏好、发布、撤销和回滚 | ExpertProfileRelease、ProfileAssignment | 直接安装 DSH Plugin；绕过授权生成 Profile | M03、M07、M08、M17 | 0001、0008、0009、0014 |
| M07 | Tool & Plugin Registry | Tool/Plugin Definition、Release、来源、依赖锁、风险、兼容、撤销 | ToolRelease、PluginRelease、Artifact/Source metadata | 运行用户 Tool；动态修改生产 Runtime | M03、M06、M14、M17 | 0007-0009、0012、0014 |
| M08 | Effective Capability Resolver | 解析 Profile、授权、Runtime 能力、Tool/Plugin/Model/Knowledge 要求，生成不可变快照 | EffectiveProfileSnapshot、ResolutionReport | 成为 Profile 或授权权威；隐式降级安全要求 | M03、M04、M06、M07、M09 | 0001、0007-0009 |
| M09 | Resource & Workspace | Resource、Version、Binding、WorkspaceView、Materialization、Provenance、归档和删除 | Resource、ResourceVersion、WorkspaceViewSnapshot、Materialization | 把路径当 Resource ID；允许 Runtime 任意读共享存储 | M03、M15、M16、对象存储 | 0004-0006、0012 |
| M10 | Business Task & Operation | BusinessTask/Subtask、BusinessOperation、Operation Ledger、恢复分类和补偿 | 业务任务、操作状态、幂等和对账记录 | 把单条 DSH 事件直接当业务状态；假定 exactly-once | M05、M12、M13、M19 | 0002、0003、0011、0012 |
| M11 | Integration Registration & Credential Broker | Connector、ExternalAccount、CredentialBinding、短期 CredentialLease、撤权 | Integration registration、Credential metadata、lease state | 向 Runtime 暴露长期 Secret；Token passthrough | M02、M03、M14、Secret Store | 0007、0010、0012 |
| M12 | Durable Approval | BusinessApproval、ApprovalSnapshot、决策、过期、撤销和恢复 | Approval、ApprovalDecision、ApprovalSnapshot | 仅依赖 DSH 内存等待；批准后永久放行 | M03、M10、M14、M16 | 0003、0007、0012 |
| M13 | Event Inbox & Projection | 接纳 PcEventEnvelope、去重、顺序/缺口检测、Normalizer、Projection 和重建 | Event Inbox、Projection checkpoint；业务事件写入由 M10 规则决定 | 把 Projection 当命令权威；按时间戳覆盖顺序 | M10、M12、M16、M21 | 0003、0006、0011、0014 |
| M14 | Controlled Execution Gateway | 企业 Tool/MCP/Connector 写入；实时授权、Fencing、Approval、Schema、幂等和对账 | Gateway admission/audit records；外部结果证据 | 信任 Runtime 的最终授权；无条件重放写操作 | M03、M05、M07、M10-M12 | 0002、0003、0007、0008、0010-0012 |
| M15 | Runtime Host | 启停 DSH；进程监督；Bridge Transport；容量、健康、DRAINING、finalizer；本地命令校验 | 仅 Runtime 本地操作状态和缓存 | 成为 Runtime/Assignment/Profile/Resource 权威 | M04、M05、M08、M09、M16 | 0001-0006、0013 |
| M16 | PC Runtime Bridge Plugin | 将稳定命令映射到 DSH；Session create/resume；Step/Tool Guard；事件导出；Approval Bridge | 无 PC 业务权威；只持 Session scoped runtime state | 直接读取 PC 数据库；暴露 DSH 内部错误/类型 | M05、M08、M09、M12-M15 | 0002-0009、0011、0012 |
| M17 | Profile/Bundle Builder & Release Pipeline | 根据批准 Release 生成 DSH Profile/Bundle/Preset、lock、digest、SBOM 和兼容证据 | 构建产物和 release evidence | 在 Runtime 中临时安装未知代码；绕过 Registry | M06-M08、M22、制品库 | 0001、0006、0008、0009、0014 |
| M18 | Runtime Provisioner / Worker Manager | 创建隔离执行环境；注入固定产物与配置；销毁 Runtime；环境/池分区 | Provision request/result、worker observation | 改变业务分配；在镜像中烘焙用户凭据 | M04、M15、基础设施平台 | 0001、0004、0013 |
| M19 | Recovery Coordinator | 检测失联/缺口/Outcome Unknown；选择恢复策略；驱动迁移、对账和人工介入 | RecoveryCase、RecoveryDecision | 自行猜测外部结果；复用旧授权或 Token | M03-M05、M10-M14 | 0002-0004、0011、0012 |
| M20 | Observability & Health | 指标、Trace、日志、SLO、告警、分层健康聚合和容量视图 | 遥测数据；不拥有业务事实 | 通过日志文本驱动业务状态；记录 Secret/正文 | 全部模块 | 0004、0012-0014 |
| M21 | Audit & Evidence | 追加式安全审计、证据引用、决策链、导出与保留策略 | AuditEntry、EvidenceRecord、chain/checkpoint | 替代业务数据库；记录 Token、私钥或完整敏感正文 | 全部写模块 | 0002、0003、0007-0014 |
| M22 | Architecture & Compatibility Governance | Contract、Traceability、Compatibility Matrix、fixtures、策略制品兼容、Legacy 合同门禁和 ADR 演进 | Governance manifests、test evidence | 运行生产业务；静默修改 Accepted ADR | 全部模块、E01-E04、CI | 0014-0017 |

### 3.1 外部权威实现单元

以下单元属于 EE Claw / 外部企业系统，不成为 PC Control Plane 的数据权威：

| ID | 外部单元 | 权威责任 | PC 使用方式 | 禁止事项 | 关联 ADR |
|---|---|---|---|---|---|
| E01 | EE Claw Authorization Role Registry | Account、Authorization Role、Permission Key、RolePermission 和请求级授权 | M03 通过 EeClawAuthorizationAdapter 读取当前事实与 Revision | PC 复制后成为第二授权权威 | 0010、0015、0017 |
| E02 | EE Claw Responsibility & Workbench | ResponsibilityAssignment、RoleModuleRelation、Workbench Projection | M01/M03/M06 消费版本化 Projection 和责任事实 | 用 Focus/责任关系扩大权限或自动合并 Profile | 0015 |
| E03 | EE Claw Policy Artifact Release Authority | 不可变 PolicyArtifactRelease、Published Pointer、Approval、Checksum、Environment Promotion | M03/M22 消费 Policy Model Revision、Release Ref 和兼容声明 | DB Payload 创造未注册代码语义；Git 作为运行时权威 | 0016 |
| E04 | EE Claw Legacy V1 Compatibility Layer | 8 表、V1 API、BASELINE_PAGE_KEYS、请求时撤权和审计兼容 | M03 Adapter 保持旧合同并读取 Decision Source | 为兼容新增账号直授、数据迁移或延迟撤权缓存 | 0017 |

## 4. 数据写入所有权

| 权威对象 | 唯一写入模块 | 可读取模块 |
|---|---|---|
| PCPrincipal / ExternalIdentityLink | M02 | M01、M03、M11、M21 |
| Authorization Policy / Revision | M03 | M01、M05-M12、M14-M16、M19 |
| RuntimeRecord / RuntimeEpoch | M04 | M05、M08、M15、M18-M20 |
| SessionAssignment / Lease / FencingToken | M05 | M04、M10、M14-M16、M19 |
| ExpertProfileRelease / Assignment | M06 | M03、M08、M17、M21 |
| ToolRelease / PluginRelease | M07 | M03、M06、M08、M14、M17 |
| EffectiveProfileSnapshot | M08 | M05、M10、M15-M17 |
| Resource / WorkspaceView / Materialization | M09 | M03、M10、M14-M16、M21 |
| BusinessTask / Operation Ledger | M10 | M01、M12-M14、M19-M21 |
| Connector / CredentialLease metadata | M11 | M03、M14、M21 |
| BusinessApproval / ApprovalSnapshot | M12 | M01、M03、M10、M14、M16、M19 |
| Event Inbox / Projection checkpoint | M13 | M01、M10、M19-M21 |
| Gateway admission and external result evidence | M14 | M10、M12、M19-M21 |
| RecoveryCase / Decision | M19 | M01、M05、M10、M13、M21 |
| AuditEntry / EvidenceRecord | M21 | 授权审计读取方 |
| Contract / Compatibility / Traceability manifest | M22 | 全部模块、CI |
| EE Claw Authorization Role / Permission | E01 | M02、M03、M14、M21 |
| Responsibility / Workbench Projection | E02 | M01、M03、M06、M08、M21 |
| PolicyArtifactRelease / Published Pointer | E03 | M03、M06、M22 |
| Legacy V1 Contract / Baseline Page Set | E04 | M03、M22 |

## 5. 依赖规则

允许：

```text
API → Control Plane
Control Plane → Stable Ports
Runtime Host → DshAdapterPort
Bridge Plugin → PC Gateway Ports
Projection → accepted EventEnvelope
CI → Registry/Contract metadata
```

禁止：

```text
Control Plane → DSH internal package
Business module → Runtime local database
Runtime Plugin → PC control-plane database
External system → Runtime direct callback with authority
Module A → Module B owned tables
Projection → authoritative command mutation
UI → DSH Runtime
```

## 6. 首期部署组合

逻辑模块不等于首期独立服务。建议首期部署为：

| 部署单元 | 包含逻辑模块 | 说明 |
|---|---|---|
| PC API / Control Plane | M01-M08、M10、M12、M19 | 可先模块化单体；数据所有权保持 schema/repository 边界 |
| Resource Service | M09 | 需要独立存储与 Materialization 生命周期，可同集群部署 |
| Integration Gateway | M11、M14 | 与企业网络、Secret Store 和外部系统邻近 |
| Event / Projection Worker | M13 | 独立消费、重放和扩缩容 |
| Runtime Host | M15 | 每个用户作用域 Runtime 执行单元内运行 |
| DSH Process | M16 的 Plugin 组合 | 由固定 Profile/Bundle 启动 |
| Build / Release Worker | M17、M22 的构建门禁 | 不进入 Runtime 在线路径 |
| Runtime Provisioner | M18 | 对接容器/VM/进程平台 |
| Observability / Audit | M20、M21 | 使用独立耐久存储与访问控制 |

## 7. 边界验收

- [x] 每个权威对象只有一个写入模块；
- [x] DSH Runtime 不拥有 PC 业务权威；
- [x] 企业写操作只有一个受控 Gateway 边界；
- [x] Profile、Tool、Plugin 和授权解析职责分离；
- [x] Event Inbox 与业务 Operation Ledger 分离；
- [x] Runtime Host 与 Runtime Registry 分离；
- [x] 首期允许模块化单体，不破坏未来服务拆分；
- [x] 所有模块均能追溯到至少一份 Accepted ADR。
- [x] EE Claw 企业角色与策略事实保持外部权威，不回流为 PC Role 或 Profile 权威。

