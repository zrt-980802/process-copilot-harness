# Workspace 资源模型参考证据卡

- 状态：Accepted Evidence
- 日期：2026-11-06
- 关联决策：ADR-0005

## REF-WORKSPACE-001：DSH Workspace、Attachment 与 Filesystem

```text
reference_id: REF-WORKSPACE-001
candidate_repository: DeepSeek Harness
baseline: dsh-v0.2.1-rc.3 / 1f81c047fc48fa190a683e469daa699857e9afe8
evidence_level: R2-R3
adoption_decision: adapt
```

关键源码：

- `packages/workspace/workspace/src/*`
- `packages/attachment/attachment/src/*`
- `packages/api/workspace-files/src/*`
- `packages/fs/fs-sandbox/src/*`
- `packages/fs/fs-observation-policy/src/*`

确认：

- Workspace 使用稳定 UUID，不以路径作为引用 ID；
- Workspace 路径经过 realpath 规范化；
- Workspace 注册删除不删除目录和 Session Log；
- AttachmentRef 不透明、内容寻址且不是路径或 bearer URL；
- 图片接纳发生在 Session Event 提交前；
- FileAttachment 支持流式存取，但通用文件大小限制需要外层提供；
- Workspace Files 的目录列举限制在 Workspace；
- `read/readBytes/stat` 明确允许 Workspace 外绝对路径；
- FS Sandbox 写入前重新 canonicalize 并检查 writable roots；
- observed-state 为写入提供 create-if-absent 和 version CAS；
- FS Sandbox 是可信代码策略 fence，不是 kernel security boundary。

运行证据：

```text
170 tests
161 passed
9 blocked by Windows symlink EPERM
```

采用：

- 稳定 ID；
- AttachmentRef；
- 内容完整性；
- 流式存取；
- CAS；
- canonical path 和 containment；
- Session 工作目录能力。

不可照搬：

- DSH Workspace 是宿主目录注册，不是企业 Resource Service；
- 绝对路径读取不能作为 PC 权限边界；
- 没有 PC 所需的 Binding、Project 权限、Evidence Snapshot 和保留策略。

## REF-WORKSPACE-002：OpenHands software-agent-sdk

```text
reference_id: REF-WORKSPACE-002
candidate_repository: OpenHands/software-agent-sdk
baseline: 295b3baf71dfac1be028c5b187134ec3eb495346
evidence_level: R2
adoption_decision: compare_only / adapt
```

确认：

- BaseWorkspace 统一 Local / Remote 命令和文件操作；
- Remote Workspace 使用 conversation-scoped API prefix；
- Runtime 可以释放而 Conversation 历史保留；
- 用户选择目录、Runtime working_dir 和 Conversation persistence 分离；
- FileStore 抽象持久读写和锁；
- 本地文件锁不适用于 NFS/网络文件系统。

采用：

- Source 与 Runtime 目录分离；
- Conversation 和 Runtime 生命周期分离；
- Local / Remote 能力接口；
- conversation-scoped 访问。

不可照搬：

- 路径型 API；
- LocalWorkspace 直接宿主访问；
- Session API Key 作为企业资源默认边界；
- 共享 Sandbox 模式。

## REF-WORKSPACE-003：OpenHands 前端

```text
reference_id: REF-WORKSPACE-003
candidate_repository: OpenHands/OpenHands
baseline: 149865db71e172c928e2a1fce2c37e9132bc1e02
evidence_level: R2
adoption_decision: compare_only
```

确认：

- `selected_workspace` 与 Runtime `working_dir` 显式分离；
- Runtime `working_dir` 可以是 per-conversation worktree；
- 静态文件访问通过 scoped workspace session；
- 相对路径逐段 URL 编码；
- Saved Workspace 由服务端持久化。

采用：

- 用户来源和 Runtime 路径分离；
- 短期静态资源访问；
- 本地与云端不同文件传输路径。

不可照搬：

- 暴露宿主绝对路径；
- 浏览器直达 Runtime；
- 用 Session Key 替代 ResourceRef。

## REF-WORKSPACE-004：OpenHands Automation

```text
reference_id: REF-WORKSPACE-004
candidate_repository: OpenHands/automation
baseline: 3ddfee594d2177ab368772bc03c25f2dda103c9b
evidence_level: R3
adoption_decision: adapt
```

确认：

- 每个 Automation Run 使用 UUID 独立目录；
- 删除目标由类型化 UUID 构造；
- 清理拒绝 symlink / Windows junction；
- 删除前要求目标为根的直接子目录；
- 扫描不跟随链接；
- 支持 retention、批量回收、结果分类和 reclaimed bytes；
- FileStore 支持 Local、GCS、S3 和流式大小限制；
- LocalFileStore 使用 resolve + relative_to 阻止路径穿越。

运行证据：

```text
tests/test_backends.py
54 passed
```

采用：

- 类型化 ID；
- 安全删除；
- retention / GC；
- 存储后端抽象；
- 流式接纳上限；
- 清理审计。

不可照搬：

- Run 目录是短期执行目录，不是持久用户 Workspace；
- 目录删除不能替代 Resource 引用和 Legal Hold。

## REF-WORKSPACE-005：现有 Process Copilot Demo

```text
reference_id: REF-WORKSPACE-005
source: E:\shanzi_workspace\process-copilot-m1
evidence_level: R2 current-state observation
adoption_decision: compare_only
```

确认：

- Runtime 共用一个 `COPILOT_DSH_WORKSPACE`；
- `cwd` 与 `runtime_cwd` 使用同一全局目录；
- 没有上传、Attachment、ResourceRef 或 Session Resource View；
- 前端 Agent Workspace 是业务驾驶舱，不是文件 Workspace。

用途：

- 观察流程和风险；
- 提供验收场景。

禁止用途：

- 不作为目标 Schema、模块、API、部署或迁移依据；
- 不产生兼容义务。

## 综合结论

Process Copilot 需要独立 Resource Service 和 Resource Gateway。DSH 提供执行期 Workspace、Attachment、FS 和 Plugin 能力，但是否需要修改 DSH 必须在全量 ADR 后通过无侵入实现审查决定。

