# 最小交付范围

## 包含

- PC/EE 同账号登录、退出、身份映射和账号切换；原 Pilot 别名保留历史，旧浏览器登录入口关闭。
- 平台角色、显式项目成员、Profile/Capability 与工具授权取交集；管理员无项目成员绕过。
- 个人首页、“我的能力”、原工程工作视图、SSTS 工作台和独立对话入口；保留原 harness、历史、追溯。
- Engineer、Reviewer、Admin 和测试新账号的个人对话，授权成员的项目对话，真实模型和逐请求身份校验。
- 每用户 Runtime、状态卷和资料目录隔离，同用户独立会话；取消、并发冲突、带 request_id 的持久重试冲突。
- 六项既有 MCP 读取：`ee.get_project_context`、`ee.list_requirements`、`ee.list_functions`、`ee.list_ssts`、`ee.get_function_ssts_matrix`、`ee.get_traceability_stats`。
- 同时核验另外两项已发布只读工具：`ee.list_projects`、`ee.get_ssts`。全部读取使用真实 EE/MCP/MySQL，不以假后端替代。
- 原任务/Draft 状态、21 条原会话消息、六项读取与引用、Markdown 安全渲染、1440/1100/390 布局。
- 本地 API、数据库、MCP 和 Runtime 重启恢复，生成中撤权、不确定/异常工具结果拒绝和有限租期。

## 不包含

- 统一 Workspace 前端改造、二期记忆、数字代理。
- 完整 EE 编辑器、飞书机器人完整部署、MCP 写能力的新一轮端到端交付或企业发布。
- 容量认证、高可用/灾备认证、所有业务流程和审批角色的完整覆盖。
- 远程部署、共享 EE 库、`192.168.31.95`、DSH Core 或数据库 schema 改造。

Engineer Catalog 当前共 9 项，其中 8 项为本候选读取范围；既有受控评审能力不等于无审批写权限，也不作为本次企业发布准出能力。Reviewer Catalog 为 4 项。不要用总数量判断每个账号的实际可执行权。

PC PostgreSQL `pc_demo` 与 EE MySQL `ee_pc_demo` 相互独立。`pc_unified_login_test` 是已有隔离测试库；测试 fixture 只使用隔离临时测试数据，不迁移或重置业务库 schema。模型与 MCP 均真实调用，测试会消耗模型额度并暂时重启本地服务。

候选保留所有历史任务、Draft、消息、数据卷和未提交代码。新增测试记录使用可识别标签；测试账号结束时恢复原状态，新建账号停用。权限恢复比较语义，保留 revision、更新时间和撤销审计。
