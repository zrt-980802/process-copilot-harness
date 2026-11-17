# CHAT-003 独立验收缺陷整改

原独立运行：`reports/dev09-candidate/20261112T115153Z-af012f-verify/`，候选 `20261112T110152Z-259f9b`，RUN-001/P1。原报告、失败结果与现场不覆盖。

## 现场核对

失败 workspace：`ssts_workspace_5c09fda9-3e7b-4408-aada-e245bb793aec`；业务任务 `task_ecb7f5a1-ee3d-4ff3-a1a1-faf4f4f68c16`；本轮 `0e8eb7b9-3ba4-4fc4-b4e2-ba3ed9a21809`。

数据库保留了两条真实工具操作，状态均为 KNOWN_FAILURE/FAILED。模型给本应使用 `{}` 的 `ee.get_project_context` 和 `ee.list_projects` 多传了 `name` 字段，EE按严格schema拒绝，返回 `PC_MCP_TOOL_REJECTED`。没有发现成功操作丢失或投影延迟。

Runtime事件中的最终回答明确说明读取失败、项目名不可用、trace为空。原测试的 `includes("eea://traces/")` 恰好匹配到了这段失败说明；它不能证明模型输出包含真实项目名或成功trace。随后成功账本断言正确阻断了测试。P1的核心是请求读取却无法稳定成功，不能通过修改测试为通过来关闭。

## 修改

- 保留发布工具名、schema、权限、项目绑定和DSH Core；补充模型可见的直接调用说明、精确参数字段和无参数工具的 `{}` 用法。
- Runtime适配层在网络发送前拒绝非法对象、MCP包装或未知身份/项目字段，返回可纠正的schema说明，不丢弃错误字段、不扩大授权。EE仍为完整schema和权限的最终权威。
- 实际工具失败原样保留，不能转成成功或制造trace。模型可根据本地拒绝信息纠正参数。
- CHAT-003保存响应、workspace、Catalog和ledger，再检查当前turn的成功operation、授权tool、principal、business task、project scope及回答中的精确trace。旧轮次成功、URI前缀和失败说明均不能通过。

  业务operation投影按既有Gateway合约可为VERIFYING；外部操作必须COMPLETED/KNOWN_SUCCESS，结果必须SUCCEEDED，摘要须与投影一致且有审计。第一次定向尝试已真实成功并引用精确trace，但新增脚本曾错误要求业务投影SUCCEEDED而误报失败；现场保留在targeted-1，随后按原Gateway合约修正测试，不更改产品状态机或把失败工具改成成功。
- 新增3项自动回归：拒绝包装/身份字段且不发送网络请求、正确参数使用当前turn并保留失败、带参数工具与过期上下文边界。Product门禁由169变为172，原7项PostgreSQL条件用例仍需真实补跑。

## 复验要求

先执行真实模型CHAT-003定向复测，再冻结新候选并完整执行T0-T7和全门禁。业务源码的两项变更必须由 `candidate.ps1 freeze -ChangeRecord ...` 精确匹配前后SHA256，不放宽未审阅漂移检查。原数据卷和历史保留。

本轮现场与整改证据在 `reports/dev09-remediation/20261112-chat003-01/`。最终候选和完整复测目录见迁移入口 `migration/DEV-09-CHAT003-REMEDIATION-HANDOFF.md`。开发者只标记修复复测，独立P1关闭和T8-T10必须交回独立测试人员，不在此处冒签PASS。
