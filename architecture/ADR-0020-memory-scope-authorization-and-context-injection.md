# ADR-0020：记忆 Scope、动态授权与上下文注入

- 状态：Accepted
- 日期：2026-11-16
- 范围：Authorized Memory Query、Source Revalidation、Context Assembly、Usage Audit
- 前置决策：ADR-0007、ADR-0010、ADR-0012、ADR-0015、ADR-0018、ADR-0019
- 用户决策：2026-11-16 按推荐方案持续推进；确认 Purpose-bound 动态判权、来源重验和类型化不可信 Context
- 实施原则：本 ADR 不授权向其他员工开放 Personal Memory，不授权数字代理代答

## A. 决策问题

1. 谁可以在什么目的下读取哪类 Memory；
2. 写入时授权能否沿用到未来读取；
3. Provider 召回前后如何执行授权；
4. 来源项目权限变化后如何处理；
5. Memory 如何进入 Prompt 而不成为指令或扩权依据。

## B. 建议决策

采用 **Purpose-bound、逐请求动态判权、召回前缩小范围、召回后再次过滤、来源访问权重新验证** 的读取流程。

任何调用方都不能直接读取底层 Memory 表或按 Provider ID 取回内容，只能请求 `AuthorizedMemoryView`。

## C. 授权交集

```text
Current Principal
AND Tenant
AND Memory Owner / Subject
AND Memory Scope
AND Current Project Membership (when applicable)
AND Lifecycle State
AND Sensitivity Policy
AND Purpose
AND Source Accessibility
AND AuthorizationRevision freshness
```

任一条件未知即 fail closed。

## D. Scope

### D1. Personal

- 默认仅 Owner 本人使用；
- 平台管理员不因管理员角色获得内容读取权；
- 系统运维只能看到必要元数据和健康状态；
- 向他人开放必须进入未来 Delegation Domain，不能修改 Scope 绕过。

### D2. Project

- 同时要求当前项目成员关系和 Memory 发布策略；
- 退出项目或权限撤销后立即失效；
- Provider 中的 project metadata 不能替代成员权威。

### D3. System

- 只允许已发布、已去敏、适用于当前产品/环境版本的 Runbook；
- 版本或环境不匹配时标记 stale 或拒绝使用。

## E. 查询流程

```text
Query Request
  -> authenticate principal
  -> validate purpose
  -> build allowed authority scope
  -> query restricted projection partition
  -> bind provider results to authority objects
  -> post-filter lifecycle/scope/source access
  -> rank freshness/conflict/relevance/budget
  -> create AuthorizedMemoryView revision
```

必须同时执行 pre-filter 和 post-filter。仅依赖向量 metadata filter 不足以构成企业授权。

## F. Source Revalidation

Memory 被本人保存，不表示来源内容永久可访问。

若记忆来源于项目材料、EE Resource 或企业 ToolResult，使用前必须验证：

- 当前用户仍有来源访问权；
- 来源 Revision 未撤销或被更正；
- 当前用途允许展示来源摘要；
- 记忆没有泄露超出来源授权范围的内容。

来源访问权无法验证时，不注入正文；可返回“存在一条当前无法验证的历史记忆”或直接忽略，具体体验后续设计。

## G. Context 注入

Memory Context 必须是独立、类型化、不可信的数据区：

```text
MemoryContextItem
- memory_id
- revision_id
- kind
- content
- source_summary
- valid_time
- confidence
- usage_constraints
```

Runtime 规则：

- Memory 不能覆盖 System/Developer Policy；
- Memory 中的命令、链接或 Tool 指令不得自动执行；
- Memory 不能添加 Tool、Plugin、MCP 或 Capability；
- Memory 与用户当前消息冲突时优先澄清，不冒充确定事实；
- Context 有稳定 token budget，超限按策略排序而非全量拼接。

## H. 使用审计

每次实际进入 Context 的 Memory 记录：

- Principal、Purpose、Conversation/Turn；
- Memory ID、Revision ID、AuthorizedView Revision；
- 授权决策和策略版本；
- 来源重验结果；
- 是否被模型引用或仅作为上下文提供；
- 不记录不必要的 Prompt 全文或秘密。

## I. 攻击面与门禁

必须覆盖：

- 已知 Memory ID 的跨用户直读；
- 搜索、向量近邻、图邻居的越权返回；
- 管理员绕过；
- Project 撤权后缓存继续使用；
- Memory Prompt Injection；
- Provider 伪造 scope/owner metadata；
- 旧 AuthorizationRevision 重放；
- 导出、审计和恢复接口侧信道。

验收门：cross-tenant/user/project leakage = 0，unauthorized memory use = 0。

## J. 否决方案

- 写入时算一次 ACL，之后永久复用：无法响应撤权和目的变化；
- 只用 Provider metadata filter：对象归属与 direct-get 可能绕过；
- 管理员默认可读全部内容：违反个人记忆控制边界；
- 把 Memory 直接拼入 System Prompt：扩大持久 Prompt Injection；
- 用 Memory 声明扩展 Tool 权限：知识不能产生权限。

## K. 接受门

- Purpose 是否为所有查询强制字段得到确认；
- Personal Memory 默认仅 Owner 可读得到确认；
- 来源权限必须逐次重验得到确认；
- 管理员无内容旁路得到确认；
- 类型化不可信 Context 与 Tool 权限完全分离得到确认。

