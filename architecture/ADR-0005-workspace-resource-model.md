# ADR-0005：Workspace Resource、版本、作用域与 Materialization

- 状态：Accepted
- 日期：2026-11-06
- 范围：T7.1 至 T7.7
- 前置决策：ADR-0001、ADR-0002、ADR-0003、ADR-0004
- 用户决策：CQ-W-01=A、CQ-W-02=A、CQ-W-03=A
- 实施原则：目标行为已冻结；是否修改 DSH 延后到全量 ADR 后统一审查

## 1. 背景

ADR-0004 已接受 Workspace 方案 C：

```text
User Workspace Root
├─ shared
├─ Session 子空间
└─ artifacts
```

本 ADR 定义其中的 Resource 身份、版本、作用域、访问、存储、Materialization、上传、派生、归档和删除边界。

现有 Process Copilot 原型仅作为流程和风险观察样本，不作为目标系统迁移基线。目标系统采用绿地重建。

## 2. Resource 的具体含义

Resource 是由 Process Copilot 管理的一份“文件或内容对象记录”。

它拥有：

- 稳定 ID；
- 类型；
- 权限和作用域；
- 内容版本；
- 来源；
- 生命周期；
- 审计记录。

实际内容可以存放在：

- 对象存储；
- EE Claw；
- 飞书；
- 其他企业系统；
- 解析或索引存储；
- Runtime / Worker 临时目录。

例如：

- 用户上传的 PDF；
- EE Claw 项目附件引用；
- Agent 生成的报告；
- PDF 解析文本；
- 审批时冻结的证据快照。

Resource 不是：

- 服务器绝对路径；
- Runtime `cwd`；
- 对象存储 Key；
- 长期下载 URL；
- 浏览器可复用凭据；
- 前端 “Agent Workspace” 页面。

## 3. 总体决策

采用：

```text
Resource
→ ResourceVersion
→ ResourceBinding
→ WorkspaceViewSnapshot
→ Materialization
```

Process Copilot Resource Service 持有资源元数据、版本、作用域、授权和生命周期权威。

Runtime 只获得当前 Session 的受控资源视图和短期 Materialization，不持有持久资源权威。

## 4. 核心对象

### 4.1 Resource

逻辑资源身份。至少表达：

```text
resource_id
kind
current_version_id
owner_scope
classification
lifecycle_status
created_by
created_at
```

字段是概念要求，不冻结数据库 Schema。

### 4.2 ResourceVersion

不可变内容版本：

```text
version_id
resource_id
version_seq
content_hash
bytes
media_type
storage_ref / external_ref
provenance
created_by
created_at
```

内容变化产生新版本，不原地覆盖旧版本。

### 4.3 ResourceBinding

将 Resource 关联到业务作用域：

```text
USER_ROOT
USER_SHARED
SESSION
PROJECT
TASK
BUSINESS_OBJECT
```

一个 Resource 可以有多个 Binding。Binding 的删除只撤销该作用域关系，不自动删除内容。

### 4.4 WorkspaceViewSnapshot

一个 Session 在某一时点可见的资源和允许操作：

```text
session_id
workspace_revision
authorization_revision
resource bindings
allowed actions
materialization policy
created_at
```

Snapshot 不保存真实密钥、服务器路径或永久 URL。

### 4.5 Materialization

ResourceVersion 在 Runtime、Worker 或浏览器任务中的临时形态，例如：

- 临时文件；
- 只读挂载；
- 短期下载流；
- 解压目录；
- 模型附件；
- 浏览器任务输入。

Materialization 有独立 TTL、owner、purpose 和 cleanup 状态，不改变 Resource 身份。

### 4.6 DerivedResource

解析或转换产物，例如：

- OCR 文本；
- PDF 页图；
- Office 预览；
- 文本切片；
- 向量索引；
- 元数据；
- 差异报告。

派生资源通过 `derived_from` 指向精确原始版本，不能替代原件。

## 5. ResourceRef

业务 API、SessionEvent、ToolCall、Approval 和审计只传：

```text
ResourceRef
- resource_id
- version_id（可选）
```

ResourceRef 是稳定身份，不是访问凭据。

引用中不信任：

- tenant_id；
- user_id；
- project_id；
- 路径；
- bucket/key；
- 下载 URL。

实际访问通过：

- 后端流式代理；
- 一次性 Materialization Token；
- 短期签名 URL；
- Session-scoped Runtime Mount。

## 6. 资源类型

第一版至少支持：

```text
UPLOAD
ATTACHMENT
WORKSPACE_FILE
ARTIFACT
EXTERNAL_REFERENCE
EVIDENCE_SNAPSHOT
DERIVED
```

- `UPLOAD`：已接纳但尚未绑定业务用途的原始资源；
- `ATTACHMENT`：绑定消息、审批、任务或业务对象的不可变附件；
- `WORKSPACE_FILE`：允许版本化修改的逻辑文件；
- `ARTIFACT`：Agent、Tool、Job 或用户产生的结果；
- `EXTERNAL_REFERENCE`：企业系统中的权威对象引用；
- `EVIDENCE_SNAPSHOT`：为判断、审批和审计冻结的内容版本；
- `DERIVED`：解析、索引、预览或转换产物。

## 7. 外部资源

EE Claw、飞书和其他系统中的资源默认保存外部引用：

```text
source_system
external_resource_type
external_resource_id
external_version / etag
source_ref
observed_at
```

只有在以下情况创建内部不可变快照：

- 专家判断证据；
- 审批输入；
- 外部版本可能变化；
- 业务要求离线保留；
- 恢复必须复现当时输入。

## 8. 作用域与方案 C

逻辑组织：

```text
User Workspace Root
├─ shared
├─ sessions/{session_id}
└─ artifacts
```

该结构表达所有权和默认组织，不强制成为物理目录或对象存储 Key。

### 8.1 Session 白名单视图

Session 的有效资源视图是：

```text
Session 自有 Binding
+ 显式选择的 USER_SHARED Binding
+ 当前 Project / Task / Business Object 授权资源
+ Expert Profile 允许资源
+ Tool Policy 允许动作
- 当前撤销和隔离规则
```

用户根中的资源不自动暴露给每个 Session。

### 8.2 用户决策 CQ-W-02

Session 上传资源默认私有。只有显式操作才能提升到 `USER_SHARED`。

### 8.3 项目作用域

项目、任务和业务对象使用 ResourceBinding，不复制进每个用户根。

用户决策 CQ-W-03：

- 第一版 Schema 和 API 支持 Project / Business Object Binding；
- 第一版不建设完整 Project Shared Workspace UI；
- 必须预留未来升级到完整项目共享空间的接口、权限和生命周期边界。

## 9. 版本与并发

- Blob 和 ResourceVersion 不可变；
- WORKSPACE_FILE 修改必须提供 `expected_version_id`；
- 版本冲突拒绝写入；
- Artifact 默认不可变，修订生成新版本；
- 内容寻址用于完整性和物理去重，不自动共享权限；
- 专家判断、审批和正式报告必须引用精确 `version_id`。

## 10. 存储分层

当前技术默认：

```text
1. Metadata Store
2. Blob / Object Store
3. Derived Store / Index
4. Runtime / Worker Temporary Store
```

- Metadata Store：Resource、Version、Binding、View、Job、Audit；
- Blob Store：原始文件和不可变内容；
- Derived Store：解析、预览、全文和向量；
- Temporary Store：Materialization 和中间文件。

临时路径不得成为持久业务引用。

该分层不锁定具体产品和部署形态。后续业务、合规、规模、成本或性能证据变化时，通过新 ADR 调整。

## 11. 上传和接纳

```text
Create Upload Intent
→ Stream to Quarantine
→ Size / type / magic / hash validation
→ Malware / policy / DLP checks
→ Commit immutable Blob + ResourceVersion
→ Create Binding
→ Emit Resource Available
→ Start optional parsing Job
```

上传、解析和生命周期状态分开：

```text
PENDING_UPLOAD → QUARANTINED → AVAILABLE / REJECTED / FAILED
NOT_REQUESTED → QUEUED → PROCESSING → READY / FAILED / PARTIAL
ACTIVE → ARCHIVED → DELETION_REQUESTED → DELETED
```

必须限制：

- 单文件大小；
- 文件数量和总字节；
- MIME / magic；
- 解压总大小和压缩比；
- 页数、像素和文本量；
- 配额；
- 解析时间和资源预算。

## 12. Runtime 和 DSH 边界

PC Backend 向 Runtime 下发：

```text
workspace_revision
resource_id / version_id
allowed_action
materialization_handle
display_name
media_type
provenance
```

不下发：

- 用户根真实路径；
- 对象存储 Key；
- 长期签名 URL；
- 其他 Session 目录；
- 跨用户存储凭据。

每次资源访问重新校验：

```text
Principal
∩ Session Assignment
∩ Workspace Revision
∩ Resource Binding
∩ Profile / Tool Policy
∩ Project / Business Permission
∩ Authorization Revision
```

DSH 的绝对路径读取能力不作为企业资源权限边界。Process Copilot 业务层只接受 ResourceRef，由 Resource Gateway 解析并生成受控 Materialization。

本 ADR 不要求立即修改 DSH。实现候选包括：

- Process Copilot Resource Gateway；
- DSH Adapter；
- Session-scoped Plugin；
- Working Directory / FS Capability 的外部实现；
- Tool / MCP 包装；
- 受控 Materialization 根。

最终选择在全量 ADR 完成后的 DSH 无侵入实现审查中决定。

## 13. 路径和删除安全

本地 Materialization 和清理必须：

- 使用类型化 ID 构造目标；
- 规范化并校验根；
- 拒绝 symlink / junction 根和目标；
- 不跟随链接递归删除；
- 删除前再次检查 containment；
- 在 Unix 和允许创建 symlink/junction 的 Windows 环境测试。

## 14. Provenance 与证据

ResourceVersion 至少保存：

```text
source_system
source_resource_id
source_version
observed_at
requested_by
acquisition_operation
request_id / trace_id
content_hash
```

专家结论保存精确输入 ResourceVersion、派生版本、Profile/规则版本和 Tool/模型版本。

## 15. 归档与删除

- Session 结束时 Session Workspace 默认归档；
- Session 私有资源不自动提升为 shared；
- Session 结束不立即物理删除；
- 删除 Binding 不等于删除 Blob；
- 被 Artifact、Evidence、Audit、Legal Hold 或其他 Binding 引用的版本继续保留；
- 无引用且满足保留策略后才进入 GC；
- 归档、撤销、删除和拒绝结果全部审计。

## 16. 用户决策 CQ-W-01

第一阶段不支持用户本地文件夹持续挂载。

支持：

- 浏览器上传；
- 外部企业系统引用；
- 后端生成 Artifact；
- 一次性选择本地文件并上传。

未来计划允许升级到桌面桥接，但必须独立设计设备注册、本地 Agent、同步、撤权、离线冲突和终端安全。

## 17. 现有 Demo

现有 Demo 只用于观察流程、异常和验收经验，不作为目标系统技术基线。

目标系统不承担：

- 目录迁移；
- Schema 兼容；
- API 兼容；
- 全局 `dsh_workspace` 兼容；
- 现有前后端模块复用义务。

## 18. 实现约束

1. ResourceRef 不包含服务器路径或长期凭据；
2. Runtime 不持有资源权威；
3. Session View 使用白名单；
4. ResourceVersion 不可变；
5. 修改必须使用 CAS；
6. 外部资源默认引用，证据使用精确快照；
7. 上传接纳成功前不发布 Resource；
8. DSH 绝对路径能力不得绕过 Resource Gateway；
9. Resource 权限和内容去重分离；
10. Project Binding 从第一版契约预留；
11. 临时目录可回收且不出现在持久 API；
12. 每次读取、修改、分享、归档和删除可审计。

## 19. 验收要求

至少验证：

- Session A 无法访问 Session B 私有资源；
- Shared 资源只有显式选择后进入 Session View；
- Project 撤权立即阻止后续访问；
- Profile 不允许的资源不进入 Tool View；
- Runtime 替换后 ResourceRef 保持稳定；
- 上传拒绝不会产生 AVAILABLE Resource；
- MIME / magic、超配额和压缩炸弹被拒绝；
- 并发修改产生版本冲突；
- DerivedResource 可追溯原始版本；
- 外部资源变化不改写 Evidence Snapshot；
- 删除 Binding 不误删仍被引用内容；
- symlink / junction 不可逃逸或造成越界删除；
- DSH 不能通过绝对路径绕过 Resource Gateway；
- 所有资源操作有 Principal、Session、版本和 Trace 审计。

## 20. 依据

正式证据卡见 `reference-evidence-workspace-resource-model.md`。

