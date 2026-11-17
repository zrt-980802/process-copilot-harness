# DEV-09 最小交付候选执行包

本包将本机已实现的 DEV-09 能力交给独立测试人员重复验收。开发者只产生 `READY_FOR_INDEPENDENT_ACCEPTANCE` 或 `NOT_READY`；前者表示可以开始独立验收，不等于独立验收通过。

PC：<http://127.0.0.1:18091/>。EE 权限管理：<http://127.0.0.1:18092/access-control>。

所有命令在 Product 根目录运行：`C:/Users/29557/.hermes-web-ui/.ekko/workspace/default/mw1g1vskatd2r8/product`。

```powershell
# 首次收口，由开发者执行；创建新候选，不覆盖旧候选。
./deploy/candidate.ps1 freeze
# 一键启动、健康、重复 seed/启动校验、全门禁、真实 T0-T7 和汇总。
./deploy/candidate.ps1 verify
```

测试组必须使用交接中明确给出的候选目录，不依赖“最新候选”的默认选择：

```powershell
./deploy/candidate.ps1 start -Candidate '完整候选目录'
./deploy/candidate.ps1 health -Candidate '完整候选目录'
./deploy/candidate.ps1 verify -Candidate '完整候选目录'
```

候选位于 `.docker/dev09-candidates/<candidate-id>/`；每次操作证据位于 `reports/dev09-candidate/<UTC时间-随机标识-操作>/`。两者均被 Git 忽略，必须保留并随本机交接。候选目录保存源码/索引/未提交文件指纹、固定镜像、Compose 模板、种子、测试构建包和冻结时账号/权限摘要。模型 Key 只在内存中从现有本机 Runtime 读取；不复制到候选、日志或聊天。

完整操作顺序、停止、恢复和回滚见 [环境操作手册](operations.md)。独立测试人员从 [独立验收手册](independent-acceptance.md) 开始，另建证据目录，不直接沿用开发者结论。

- [交付范围](scope.md)
- [环境启动与恢复](operations.md)
- [独立验收步骤与账号预期](independent-acceptance.md)
- [测试矩阵与证据索引](matrix-and-evidence.md)
- [缺陷口径、限制与未实现能力](defects-and-limitations.md)

并发执行会被单操作锁拒绝。不要与其他测试者同时改权限或运行恢复测试。任何失败都保留原证据与容器状态，新的一轮使用新目录。开发者不填写 T8-T10 独立结论。
