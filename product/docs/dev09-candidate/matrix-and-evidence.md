# 测试矩阵与证据索引

完整计划仍为迁移入口 `migration/DEV-09-MINIMUM-DELIVERY-TEST-PLAN.md`。自动入口不重新定义业务预期。

| 批次 | 自动入口 | 新运行证据 | 人工判断 |
| --- | --- | --- | --- |
| 冻结 | candidate.ps1 freeze | candidate.json、Compose副本、image ID、源码/index/dirty指纹、seed/账号状态 | 确认候选身份与范围 |
| 启动/准备 | candidate.ps1 start/health/prepare | health.json、seed-repeat.log、prepare/seed-idempotency.json | 真实凭据可用，现场无其他操作者 |
| T0 | minimum-delivery-snapshot.py、verify-minimum-delivery baseline | t0-t7/environment-before.json、permission-baseline.json、permission-task-baseline.json | 账号/项目是否符合预期 |
| T1 | pnpm check、EE pytest、固定Linux测试runner | product-check-final.log、ee-tests.log、postgres-tests-executed.log、postgres-real-ee-login.json | 条件skip是否被补跑、失败影响范围 |
| T2 | verify-unified-login.mjs、auth-extra | auth-final/result.json、截图、auth-extra-MIN01.json | 错误是否清晰，切换体验 |
| T3 | permissions、permission-cache、final-state | permissions-AUTHORITY_FINAL.json、permission-cache-CACHE_FINAL.json、permission-after.json | 拒绝与恢复体验、语义权限恢复 |
| T4 | mcp、真实响应故障转换器 | mcp-MIN02.json、read-catalog.json、mcp-real-faults.json | 工具结果与业务匹配、内容不泄漏 |
| T5 | multi-user、runtime-boundaries、chat-extra、chat-completion，三轮 | chat-fixed-round-N/、chat-extra-FIXED_RN.json、chat-completion-FINAL_COMPLETE_RN.json | 模型回答、上下文、并发体验 |
| T6 | regression、Markdown脚本 | regression-REG_RETEST.json、markdown/result.json、各宽度截图 | 实际页面、字号/遮挡和可用性 |
| T7 | recovery、seed-idempotency、permission-cache | recovery-COMPLETE.json、seed-idempotency.json、health-after.json | 恢复后能继续业务，错误可理解 |
| 汇总 | finalize-minimum-delivery.mjs，由candidate入口调度 | test-results.json（83项）、baseline-comparison.json、sensitive-scan.json、frozen-source.json | 只作为开发者证据，不替代独立验收 |
| T8-T10 | independent-acceptance.md，由独立人员执行 | 独立新目录的执行表、脱敏请求、截图、审计、结论 | 全部需独立签署 |

每轮顶层 `result.json` 汇总步骤退出码、日志位置、候选目录、阻断项及最终状态。`before.json` / `after.json` 记录两工作树完整状态，`data-before.json` / `data-after.json` 记录业务和语义权限变化。新账号必须停用，原账号状态与角色、项目成员和权限集合须恢复。

为兼容旧83项索引器，本轮完整 recovery 的同一份新证据会提供三个传统文件名别名；它们不是三次独立恢复运行。源文件 `recovery-COMPLETE.json` 才是该轮完整执行。任何选入汇总的 FAIL 会阻断，而非仅检查文件存在。178/7、PostgreSQL10和EE16的精确测试计数由当前候选门禁验证；原169项基础上新增3项工具参数、3项首页并发/取消和3项账号完整分页回归，数量改变需审阅后建立新基线，禁止自动放宽。

RETEST-001的页面回归在 `markdown/network.json` 中记录各阶段耗时、请求路径/状态与未完成请求；失败另保留 `failure.json`、`failure.png`。等待文档加载及真实首页完成，不以全局网络空闲代替页面就绪；30秒单项超时、真实内容/安全/移动布局断言保留。注入的Markdown恶意内容只用于浏览器渲染安全测试，不替代真实EE、MCP、数据库、Runtime或真实历史链路。

账号基线和最终核对遍历真实EE的所有20条分页，要求总量稳定、ID无重复、页数/条数完整；`account-pages-阶段-标签.json` 保留每页元数据。EE管理员页面按真实搜索定位工程师，不能假设旧账号始终在第一页。多账号和统一登录测试的账号查询同样完整分页；不清理历史账号以维持第一页假象。

历史证据 `reports/dev09-minimum-delivery/20261112-t0-t7-01/` 只作背景，不复制到新运行冒充本轮结果。日志自动脱敏但仍需独立安全审查；禁止未经处理的 HAR、Cookie 或完整敏感Payload进入交付包。
