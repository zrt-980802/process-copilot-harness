# FE-DEMO-01

2026-11-13. Status: FE_DEMO_READY_FOR_ACCEPTANCE. DEVELOPMENT PREVIEW.
执行者定向验证完成，不代表独立验收 PASS 或发布资格。

Entry: latest desktop HANDOFF.md and DEMO-RC-01-HANDOFF.md. Earlier tasks remain
historical; no continuation of their regression/publication/cleanup plans.

Scope: PC information hierarchy, actual EE platform-role display, personal vs
project labels, 1440/1100/390; EE global PC link migration explicitly added by user.
Only frontend source/tests and task documents. No backend contract, authority,
EE business logic, schema, MCP, Runtime, deployment configuration or candidate
business-data changes; no commit, push, deployment or Docker cleanup.

PC roles use the existing real EE /auth/me response for presentation only.
Role names cannot grant project access. Do not infer roles from usernames.
EE navigation uses the ordinary link and existing unified-login cookie/ticket
exchange. The old literal URL had no independent frontend URL configuration;
the new frontend reader uses VITE_PROCESS_COPILOT_URL without a fallback.
Preview supplies it through process environment only. Frozen 18091/18092 pages
remain unchanged because deployment is outside this task.

Validation: frontend lint/typecheck/build, focused account/URL tests; one combined
real E2E DEMO-GATE for Engineer, Reviewer, Admin, two authenticated EE routes,
global/removed entry, cookie login, three widths, personal/project/history UI,
actual authorized project/MCP reads and no-project admin. No mock and no new
business records, permissions/accounts/seed changes, or fault injection.
Compare retained business-table digests before/after. Fresh evidence directory
per run; do not overwrite failed evidence. Stop after core paths pass or P0/P1.

Known out-of-scope finding: no pre-existing PC frontend URL setting was found.
Deployment integration of VITE_PROCESS_COPILOT_URL is not performed here.
The task screenshot is not attached in the current workspace; the explicit
left-of-account/menu positioning requirements define the implementation.

## 本轮交付

- PC 顶栏展示真实 EE 显示名与平台角色，账号面板分别列出角色、授权项目、
  登录名；技术身份 ID 收入折叠区。角色展示不参与权限计算。
- 首页、历史任务、最近对话、当前工作区与新建对话表单明确个人/项目范围。
  保留首页、项目总览、工程、对话和原工作台，不实施统一 Workspace。
- 1440/1100 保留完整账号信息；390 精简顶栏，账号详情仍可打开。
  手机对话标题最多两行，全文保留 title，消息记录内部滚动，发送区完整可见。
- EE 已登录全局壳顶部提供唯一 PC 主入口，390 改为头像菜单项；删除
  AccountsPanel 原入口，沿用普通链接、真实 EE cookie 和原 PKCE 交换。
  链接有 accessible name、tooltip、焦点样式；Tooltip 不再吞掉 Enter。

## 验证与证据

Product 根目录下的相对路径：

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| PC 定向 ESLint | PASS | reports/fe-demo-01/checks-20261113T0818/pc-lint.log |
| PC vue-tsc | PASS | 同目录 pc-typecheck.log |
| PC Vue/TS 构建 | PASS | 同目录 pc-build.log |
| 角色/范围、首页记录最小回归 | 6/6 | 同目录 pc-tests.log |
| EE Vue 构建 | PASS | 同目录 ee-build.log |
| EE URL 配置定向测试 | 3/3 | 同目录 ee-tests.log |
| 最终精简真实 DEMO-GATE | 46/46 | reports/fe-demo-01/2026-11-13T08-15-29-000Z/result.json |
| 三视口截图 | 48 张 | 同一门禁目录 *.png |
| 业务数据/账号状态/成员权限前后比对 | 一致 | 同一目录 data-before.json、data-after.json |
| 冻结源码基线范围审计 | PASS | reports/fe-demo-01/audit-*/source-audit.json，以最后一份为准 |

现有 Product ESLint 配置不解析 .vue；本次沿用其 TS/测试脚本 lint，Vue 模板
与脚本由 vue-tsc 和构建验证。EE 是 JS/Vue，当前没有独立 lint/typecheck 命令；
EE 构建通过，无新增 TS。EE 构建保留既有大 chunk、CJS API 等非阻断警告。

最终门禁真实验证：Engineer、Reviewer、Admin 各一次登录；每种角色的
1440×1000、1100×1000、390×844 入口/账号/首页/历史对话；Engineer、Reviewer
项目总览与已有项目对话；旧账号管理内容区入口删除；键盘进入 PC 后无需再次
输密码。Admin 还实际通过手机头像菜单 Enter 打开 PC，无项目成员资格，
PC 授权项目仍为空。Engineer 返回六项只读 MCP；Reviewer 按实际 Catalog
交集返回项目上下文及 SSTS 两项，不扩大到工程师权限。

已人工查看桌面首页、1100 账号/项目页、390 项目对话/管理员对话/账号面板、
EE 手机菜单和桌面入口截图；入口与头像不重叠，关闭按钮和发送按钮可见。
未发送新模型消息或创建新业务记录；此门禁不宣称新一轮模型生成验收。

## 失败记录与限制

五次未完成的定向尝试及截图均保留，未改写为 PASS：

| 证据目录（reports/fe-demo-01 下） | 原因与处置 |
| --- | --- |
| 2026-11-13T07-50-07-094Z | 测试错误依赖 opener；链接 rel=noopener，改按隔离浏览器上下文识别标签页 |
| 2026-11-13T07-52-23-049Z | 前端 Tooltip 拦截 Enter；取消其触发键，最终桌面/手机键盘 SSO 通过 |
| 2026-11-13T07-54-17-163Z | 测试误从 principal.ee_account 取身份；改读原 Contract 的 account，不改后端 |
| 2026-11-13T08-01-14-665Z | 390 发送按钮超出约 6px；调整标题/记录区高度，最终三个角色均通过 |
| 2026-11-13T08-10-32-118Z | 测试误用 Engineer 密码登录 Reviewer；使用现有 Reviewer 演示配置重测，无账号变更 |

开放 P0/P1：无。登记以下限制，不进入额外修复循环：

1. EE 原入口没有独立可复用的前端 URL 配置。新入口读取 Vite 构建参数
   VITE_PROCESS_COPILOT_URL，缺失/非法时显示未配置，不猜地址。此次本地部署
   已用 http://127.0.0.1:18091/ 构建并实装。
2. Reviewer 缺少需求/功能读取权限时，旧项目总览仍显示 0，而非权限说明。
   登记 P2 信息表达问题；权限交集正确，未顺手扩大修改。
3. 大量历史恢复仍需等待，未做性能重构、T8–T10、故障注入或多轮全量回归。
4. 冻结快照有 642 个 Workspace，最终门禁开始时有 644 个，观察到两个
   DEMO-DATA-01 任务；来源未在本任务核实，登记范围外，不修改或删除。
   本门禁自身前后 644 条及输入/消息/Draft/Review、EE 业务与权限摘要一致。

## 查看与重复执行

当前本地部署：PC http://127.0.0.1:18091/，EE http://127.0.0.1:18092/。
本轮只重建 ee-admin-web；PC、EE API、MCP、Runtime、MySQL、PostgreSQL 和数据卷
未重建。源码预览仍可用 PC18191、EE18192 作对照，URL 仅由预览进程提供。

部署证据：reports/fe-demo-01/deployment-2026-11-13T08-53-29-010Z/result.json。
ee-admin-web 容器 ID 为 17217cc06780562f4fabe732116ac60be765015481c8460e42668b5a36d6c789，
镜像为 process-copilot-ee-admin-web:local，镜像摘要
sha256:352e45afeda4033b0e6971117f50df33099cdd7f8545d7ddc6a71aaafe6f4fd5；Nginx
配置检查通过。

从 Product 根目录启动（先确认 18191/18192 空闲，已有预览时不要重复启动）：

```powershell
node apps/web/tests/fe-demo-01-preview.mjs
# 需明确要求复跑时，再执行；每次生成新证据，不覆盖历史。
node apps/web/tests/fe-demo-01.e2e.mjs
node apps/web/tests/fe-demo-01-audit.mjs
```

当前预览进程 PID 30156，日志 reports/fe-demo-01/preview-20261113T154326/。
停止预览只需停止该 Node 进程；不影响 18091/18092。源代码没有提交，若要撤回，
按最终 source-audit 的改动清单逐项回退本任务差异，保留既有未提交工作，勿全树 reset。

最终通过后停止工作，等待下一条明确指令。没有 commit、push、部署、远程仓库
操作、Docker 清理、候选重冻结或新一轮完整验收。
