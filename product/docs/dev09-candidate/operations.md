# 环境启动与恢复手册

## 前置条件

本机 Docker Desktop 为 Linux 容器模式；保留当前两个工作树、相邻 Architecture、现有依赖和模型配置。Product Node/pnpm、Python 及 Chrome 路径以候选快照为准。Python 入口使用 `E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe`，浏览器脚本使用本机 Chrome。

这不是可脱离当前机器的数据迁移安装包。源码、EE 只读挂载位置、数据卷、模型凭据和已存在的隔离测试数据库必须保留。首次冻结会构建单独的测试工具镜像，固定当前 Vitest 版本；不升级业务技术栈。后续复跑使用已冻结镜像，不在线拉取或重建业务镜像。

## 冻结和启动

1. 开发者完成脚本/文档后运行 `./deploy/candidate.ps1 freeze`，记录输出的候选目录。

   修复独立缺陷而改变业务源码时，必须加 `-ChangeRecord '已审阅变更记录.json'`。记录包含缺陷ID、原因、原候选路径及manifest SHA256，以及相对最初T0-T7源码清单的完整变化文件与before/after SHA256。冻结逐项匹配，不接受遗漏或额外的授权文件；记录复制到新候选，原候选保留。没有记录的源码漂移仍拒绝冻结。
2. 检查该目录 `candidate.json`：Product/EE HEAD、完整 dirty/index 状态、所有非忽略源码 SHA256、`.env*` 仅哈希、固定镜像 ID、挂载和种子摘要。
3. 测试组使用 `./deploy/candidate.ps1 start -Candidate '候选目录'`。它校验源码/索引、包哈希及Compose管理的运行环境配置摘要，以固定镜像、`--no-build --pull never --no-recreate` 启动既有栈并等待健康；不会拉取新版本。首次收口若发现旧EE/静态页的镜像ID已不可寻址，会从保留容器导出文件系统并保留tar，导入独立镜像，记录原容器/原镜像与新镜像关系；不导出挂载卷，也不把容器运行环境中的Secret写入导入配置。启动只对这种已记录的保全镜像逐服务重建，恢复原挂载，随后完整复测。普通镜像漂移一律拒绝。
4. `health` 检查两个入口、API ready、Compose 服务/镜像、数据库/MCP健康及用户 Runtime 归属镜像和空闲状态。seed 正常状态为退出码 0，其余服务必须运行。
5. `prepare` 重复执行真实 EE/PC seed 并比较 13 张 EE、5 张 PC 表的前后摘要；它不清库，不重置密码，不自动授予项目成员。
6. `verify` 自动执行上述启动/准备，额外重复启动一次，验证保留数据未变化，再完整执行 T0-T7 与门禁。

```powershell
./deploy/candidate.ps1 prepare -Candidate '候选目录'
./deploy/candidate.ps1 verify -Candidate '候选目录'
```

每次操作独立创建证据目录。`result.json` 的 `action_completed` 表示操作完成，只有完整 `verify` 成功才能输出 `READY_FOR_INDEPENDENT_ACCEPTANCE`；其他操作不产生准入结论。T8-T10 始终保持待独立执行。

## 失败诊断

失败后停止后续批次，保留 `result.json`、失败步骤日志、`failure-containers.json`、各服务末尾日志和测试 runner 名称。日志落盘前脱敏；Markdown脚本同时保留阶段、未完成请求、页面状态、截图与 `network.json`，不记录请求凭据/正文。其独立调用也要求空的新证据目录。超时也保留已收集输出。不要删容器、卷或失败证据后重跑来掩盖问题。

账号状态核对读取全部20条分页，并保存 `account-pages-阶段-标签.json`。账号超过一页时，不能从第一页缺失判定账号丢失，也不能删账号来让门禁通过；页缺失、重复ID、总量变化仍阻断。管理员页面通过既有搜索定位旧账号。

- 真实模型 401/超时：在本机现有凭据配置中处理；不把 Key 发到聊天或报告。若配置/模型发生变化，必须记录变更并重新冻结/验证。
- 源码或索引漂移：先核对人为修改。禁止脚本自动还原用户文件；确认修改后冻结新候选，旧候选/证据保留。
- 镜像缺失/变化：`status`/`start` 会拒绝。不要让 mutable `local` 标签覆盖候选。镜像已被删除时必须重新准备和验证新候选。
- 恢复测试中断留下停止/paused 服务：先记录现场；解除**明确命名**的本地暂停容器，再运行 `start`、`health`。不要操作共享或远程服务。
- 锁残留：确认锁内 PID 已结束且没有测试在运行，记录后移除 `reports/dev09-candidate/.operator.lock`；活跃锁不能强行删除。

## 停止、恢复、回滚

```powershell
# 仅停止当前本地演示服务和用户 Runtime；保留容器、卷和数据。
./deploy/candidate.ps1 stop -Candidate '候选目录'
# 原数据恢复启动。
./deploy/candidate.ps1 start -Candidate '候选目录'
# 明确需要重建服务容器时，使用冻结镜像和原数据卷。
./deploy/candidate.ps1 rollback -Candidate '候选目录'
```

停止前应无人生成、无权限变更测试进行中。`rollback` 会中断本地业务服务并强制按候选镜像重建 Compose 容器，但不会回滚数据库、消息、任务或权限。EE 源码是宿主只读挂载，源码漂移必须人工核对；脚本拒绝自动回滚文件。原卷继续挂载，不执行 `down -v`、volume rm、全局 prune、reset 或删除历史。

测试后的权限恢复属于测试 teardown，不是数据回滚。不要用 seed“修复”权限。若测试者中断了 teardown，按变更前保存的账号/角色/成员语义恢复，然后重新核对；未恢复前是阻断项。

重新执行使用原候选、新证据目录。修复了源码或换了镜像则建立新候选，完整重跑；不得覆盖此前运行或直接把失败改为 PASS。
