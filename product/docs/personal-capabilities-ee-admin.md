# 个人能力与本地 EE 账号权限入口

后续更新：两端已接入 EE 统一登录，PC 历史账号显示为 EE 账号的关联别名。
当前入口、账号和验证见 [unified-ee-login.md](unified-ee-login.md)；下文保留前一阶段记录。

2026-11-12，桌面版本地开发与验证。代码保持未提交，EE 源码本轮未修改。

## 页面与账号

- PC：<http://127.0.0.1:18091/>，进入「首页 → 我的能力」。原全局“能力”项已移入个人首页；工作总览快捷入口带当前项目筛选跳转。跨项目合并同一工具，详情列出授权项目、只读/精确审批、审批与恢复策略及参数。按项目实际 Catalog 显示，搜索和筛选不会调用模型或准备 Runtime。
- EE：<http://127.0.0.1:18092/access-control>，管理员 `demo.admin` / `LocalDemoAdminSecret123`。这是独立演示库的本地账号。
- EE 管理页「账号」每行提供编辑、分配角色、重置普通账号密码、退出全部设备；「角色权限」查看/分配页面和管理动作权限；「访问记录」查看实际审计数据。
- EE 工程师 `demo.engineer` / `LocalAcceptanceSecret123`，评审人 `demo.reviewer` / `LocalReviewerSecret123`。它们不同于 PC 登录账号 `pilot.acceptance`、`reviewer.acceptance`。

启动的是现有真实 EE 前端的账号、角色权限及审计功能，对接现有 platform_auth API。其他 EE 业务模块 API、飞书机器人、webhook、Neo4j 和企业部署不属于这个本地入口，不能把前端菜单存在视为所有服务均已运行。

## 当前权限关系

实际数据库与 ProjectScopeAuthority 回读结果：

| EE 账号 | 平台角色 | EP37 / EP38 显式项目角色 | 项目操作 |
| --- | --- | --- | --- |
| demo.admin | system_admin | 未授予成员 | 无项目操作权 |
| demo.engineer | pc_demo_engineer | editor | read / candidate / edit |
| demo.reviewer | pc_demo_reviewer | reviewer | read / review |

平台账号启用状态、角色的页面/动作权限、显式项目成员角色及请求 operation 必须同时允许。系统管理员可管理平台账号，但不能绕过显式项目成员权威。管理页的“分配角色”修改平台角色；它不等于授予项目成员资格。当前账号管理入口未接入项目成员编辑器。PC 工程师实际可见 9 项能力，评审人可见 4 项；执行时仍由 EE 重新判权，受控命令继续要求 PC 精确审批。

## 启动与数据边界

Compose 项目仍为 `pc-workbench-demo`。`deploy/start-workbench-demo.py` 自动组合原工作台 Compose 与新增 `deploy/docker-compose.ee-admin.yml`，自动解析 Product/隔离 EE 路径，沿用已有本机模型配置。新增端口仅为 loopback 18092；18091 和所有内部服务端口保持原配置。

```powershell
E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe deploy/start-workbench-demo.py up -d --build
```

EE 前端在 Docker 中用原 package-lock 执行 npm ci 和构建，不复制 `.env`，不启用认证绕过，不在 EE 工作树安装依赖或修改共享源码。nginx 保留浏览器 Host 以维持 Origin/CSRF 检查，拒绝浏览器访问 `/api/internal/`。EE 只连接独立 MySQL `ee_pc_demo`，PC 继续连接独立 PostgreSQL `pc_demo`；均未发布数据库端口。

`deploy/bootstrap-ee-demo-admin.py` 仅在通过既有隔离库 guard 的 ee-api 容器中运行，以真实 AuthService 创建首个管理员；不初始化 schema、不重置现有账号、不分配项目权。演示密码通过进程环境提供。重复运行已确认不会重建或重置管理员。

## Docker 清理记录

通过 `deploy/cleanup-workbench-demo.py` 核对 Compose 标签后停止并删除：

- pc-dev09a-complete-verifier-1
- pc-dev09a-complete-web-1
- pc-dev09a-complete-postgres-1
- pc-dev09a-complete-mysql-1
- pc-workbench-demo-seed-1（已成功退出的单次种子容器）

旧 18090 入口已停用，历史证据及旧数据库卷仍保留。当前有 8 个运行容器。清理前后全部 68 个数据卷名称一致；没有全局 prune、卷删除或无关资源清理。保留镜像与构建缓存，因为工作台镜像依次依赖 DEV-09A-complete、DEV-09A3-verifier 和固定 DSH 基础镜像；不把 Docker 报告的 reclaimable 空间直接等同于可安全删除资源。完整记录见 `reports/docker-cleanup/{before,result}.json`。下次完整 up 可重新创建幂等 seed 容器。

## 验证及恢复修复

- Product `pnpm check`：146 passed / 6 conditional skipped；架构、生成文件、lint、类型及构建通过。
- `node deploy/verify-personal-capabilities-ee-admin.mjs`：实际工程师/评审人 Catalog 对照、跨项目合并、筛选/搜索、详情、总览快捷入口、1440/1100布局；真实 EE 登录、账号表、角色分配窗口、权限页、访问日志；普通工程师管理 API 返回403，浏览器内部服务入口返回403。没有使用模拟业务响应，也没有在此检查中保存角色修改。
- `node deploy/verify-personal-home.mjs`：实际首页数据、任务/项目跳转、已保存对话、密度隔离等回归通过；该既有脚本的错误/待审批展示仍使用仅浏览器内的界面测试数据，不作为真实审批验收。
- `node deploy/verify-workbench-admission.mjs`：对无上传输入的实际任务并发执行6次真实项目读取/会话恢复，Assignment、generation及物化视图保持相同，未调用模型。
- 证据：`reports/personal-capabilities-ee-admin/`、`reports/personal-home/`、`reports/workbench-admission/`。

回归发现现有无上传输入任务每次准备都会新建项目上下文，导致反复释放；同时 SDK 恢复晚返回可能把已经释放的本地执行状态改回 IDLE。修复为同会话准备串行、仅复用摘要/来源/账号/当前版本完全匹配的不可变上下文，在剩余租期超过5分钟时直接复用当前 Assignment，并在异步恢复后复核有效权限。增加3个回归测试。对已污染的一条旧 Runtime Assignment，仅使用其原 generation/fence 再执行真实 REVOKE_SESSION 完成既有释放，未改库表、历史或 DSH Core。真实首页和并发读取已复测通过。本轮未重新进行模型生成或独立 EE 全模块验收。
