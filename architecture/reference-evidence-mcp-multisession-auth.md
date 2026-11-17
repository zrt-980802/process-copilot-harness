# MCP 多 Session 鉴权参考证据

> 状态：Accepted Evidence
> 日期：2026-11-06
> 关联决策：ADR-0007
> 用户决策：CQ-M-01=A、CQ-M-02=A、CQ-M-03=A、CQ-M-04=A

## REF-MCP-001：MCP 2026-07-28 Authorization 与 Transport

```text
reference_id: REF-MCP-001
source: Model Context Protocol Specification 2026-07-28
evidence_level: R4
adoption_decision: adopt
```

核实页面：

- `specification/2026-07-28/basic/authorization`
- `specification/2026-07-28/basic/transports`
- `specification/2026-07-28/basic/security_best_practices`

确认：

- HTTP 传输的授权建立在 OAuth 2.1 相关规范上；
- MCP Server 是 OAuth Protected Resource；
- Server 通过 Protected Resource Metadata 公布 Authorization Server；
- Client 使用 Resource Indicator 取得面向目标 Server 的 Token；
- Server 必须验证 Token 是否专门签发给自己；
- Token Passthrough 被明确禁止；
- Streamable HTTP 可以无状态运行，且无状态是当前推荐；
- `Mcp-Session-Id` 是可选协议状态，不是用户授权身份；
- Stateful Session 必须防止会话劫持和错误绑定；
- Local/stdio Server 仍应从环境取得凭据，不经过 HTTP OAuth 流。

采用：

- Stateless 优先；
- Protected Resource Metadata；
- Audience / Resource 限制；
- 每请求授权；
- Token Passthrough 禁止；
- 协议 Session 与业务 Session 分离。

## REF-MCP-002：MCP Authorization Extensions

```text
reference_id: REF-MCP-002
repository: modelcontextprotocol/ext-auth
commit: 15ca394e00a66434520b9ade26294999295a43ae
evidence_level: R3-R4
adoption_decision: adopt / adapt
```

核实：

- Stable Enterprise-Managed Authorization；
- Stable OAuth Client Credentials；
- 版本与 MCP 2026-07-28 对齐；
- Enterprise 模式把企业 IdP、MCP Client 和 MCP Resource Authorization Server 纳入同一信任链；
- Enterprise 模式通过用户身份断言取得面向目标 MCP Server 的访问 Token；
- `audience` 指向 Resource Authorization Server；
- `resource` 指向 MCP Server；
- IdP 可以按用户、客户端、Server 和 Scope 执行企业策略；
- Client Credentials 是 App-only 模式，不携带用户授权语义。

采用：

- 用户委托与 App-only 凭据分开；
- Enterprise Managed Authorization 作为未来兼容方向；
- Client Credentials 只能用于明确服务能力；
- Authorization Server 能力通过元数据协商。

边界：

- Process Copilot 不应假设所有 EE Claw 或第三方 MCP Server 首期支持扩展；
- 遗留系统仍需要 Credential Broker 适配。

## REF-MCP-003：OAuth Token Exchange 与资源限制

```text
reference_id: REF-MCP-003
source:
  - RFC 8693 OAuth 2.0 Token Exchange
  - RFC 8707 Resource Indicators
  - RFC 8705 OAuth Mutual-TLS Client Authentication and Certificate-Bound Access Tokens
  - RFC 9728 OAuth Protected Resource Metadata
  - RFC 9449 DPoP
  - RFC 7009 Token Revocation
  - RFC 7662 Token Introspection
evidence_level: R4
adoption_decision: adopt / adapt
```

确认：

- Token Exchange 区分 Subject 与 Actor；
- JWT `act` Claim 可以表示当前代理主体和委托链；
- Token Exchange 请求可以使用 `audience`、`resource` 和 `scope` 限制结果；
- 委托 Token 应使用短生命周期和最小 Scope；
- Protected Resource Metadata 为 Client 提供资源标识和 Authorization Server；
- DPoP 可以把 Token 绑定到 Client 密钥；
- mTLS 可以把 Token 绑定到客户端证书；
- Revocation 与 Introspection 提供 Token 失效和在线状态检查机制。

采用：

- Principal Envelope 显式区分 Subject 与 Actor；
- 下游 Token 按 Resource / Audience 限制；
- Token Cache 按 Issuer、Subject、Resource、Scope 和 Credential Generation 隔离；
- 预留 DPoP / mTLS Sender Constraint；
- 撤权事件和 Revision 检查不能只依赖 Token 自然过期。

## REF-MCP-004：MCP TypeScript Client SDK v2

```text
reference_id: REF-MCP-004
package: @modelcontextprotocol/client@2.2.0
spec: MCP 2026-07-28
package_sha1: 95ccc22cccf717d23263a69fb66bb3035b9da8a4
evidence_level: R3
adoption_decision: adopt / adapt
```

核实：

- `AuthProvider.token()` 在每次请求前调用；
- 401 可调用 `onUnauthorized()` 并只重试一次；
- `OAuthClientProvider` 保存 Token、Client 信息、PKCE 和 Discovery State；
- 凭据可以按 Authorization Server Issuer 隔离；
- 支持 Protected Resource Metadata、Resource Indicator 和 Scope Step-up；
- 403 `insufficient_scope` 可以触发显式重新授权；
- 支持 DPoP；
- 支持 Client Credentials、Private Key JWT 和 Cross-App Access；
- Cross-App Access 使用 RFC 8693 Token Exchange；
- Streamable HTTP Transport 可保存、恢复和终止协议 Session；
- `authProvider` 与静态 `requestInit.headers` 是不同能力层。

采用：

- 动态 AuthProvider；
- Issuer 绑定；
- 每请求 Token 获取；
- 401 和 403 分流；
- DPoP 接口预留；
- 协议 Session 显式终止。

边界：

- SDK 的自动 401 重试不能绕过 PC 对非幂等写操作的恢复分类；
- SDK Token Storage 不是 PC 权限、审批和撤权权威；
- PC Gateway 仍需 Operation Ledger 和实时授权。

## REF-MCP-005：DSH MCP Client 0.2.1-rc.3

```text
reference_id: REF-MCP-005
package: @deepseek-ai/dsh-mcp-client@0.2.1-rc.3
package_sha1: b342cac5e0aa3e621c1771a100c9e9c897721d97
mcp_sdk: @modelcontextprotocol/client@2.2.0
evidence_level: R3
adoption_decision: adapt / reject_as_enterprise_auth_boundary
```

核实：

- 一个 Plugin 实例连接一个 MCP Server；
- Server 使用稳定本地 `serverName`，不信任远端 `serverInfo.name`；
- Tool 使用稳定 `(serverName, rawName)` 身份；
- Streamable HTTP 配置只暴露静态 `headers`；
- 传输构建时把 Header 写入 `requestInit`；
- 连接监督器负责重连和 Tool Generation 原子同步；
- Tool Call 传递 raw name、args、AbortSignal 和 timeout；
- Generic Client 不把每次 `ToolExecution` 转换成动态 Authorization Header；
- `createMcpToolDefinition()` 是公开导出；
- 其 `call(args, execution)` 回调可获得完整 `ToolExecution`，包括 Agent 和取消信号；
- Agent Session Header 已被包内部用于解析当前模型路由，证明按调用读取 Session Context 可行。

采用：

- 稳定 Server-qualified Tool Identity；
- Tool Generation 原子替换；
- 重连后 Tool 重同步；
- `createMcpToolDefinition()` 结果投影能力；
- 自定义 PC MCP Tool Provider 读取 `ToolExecution`。

拒绝：

- 用静态 Header 配置承载多用户企业委托；
- 把一个通用连接直接作为用户、Session 或项目权限边界。

无侵入结论：

```text
PC Runtime Bridge Plugin
+ PC MCP Tool Provider
+ createMcpToolDefinition()
+ ToolExecution Context
+ External PC MCP Gateway
```

可以先完成用户作用域 MCP 调用，不要求修改 DSH Core。

## REF-MCP-006：IBM ContextForge

```text
reference_id: REF-MCP-006
repository: IBM/mcp-context-forge
commit: fe828977a44646e92e72daaab31d4d344f2a7191
evidence_level: R2-R3
adoption_decision: compare_only / adapt
```

核实：

- Token Scoping 和 RBAC 是两层独立策略；
- Session Token 的团队范围从数据库实时解析，JWT 只允许进一步收窄；
- Token Revocation 使用 JTI、数据库、Redis 和本地缓存；
- Token Exchange 使用 RFC 8693；
- 用户 Subject Token 不直接转发到下游；
- Exchanged Token Cache Key 包含 Gateway、User、Audience 和 Subject Token Hash；
- Token Exchange 使用 Single-flight、负缓存和过期前安全窗口；
- Token Exchange 事件记录 Correlation ID，但不记录 Token；
- Stateful Streamable HTTP Session 保存 Owner，并在后续请求校验；
- Session Owner 缺失时默认拒绝；
- Gateway 对 Raw Catalog、Team Visibility 和 RBAC 分别执行过滤与动作检查。

可借鉴：

- 授权可见性和动作权限分层；
- Token Exchange Cache 完整键；
- Subject Token Hash；
- Single-flight；
- Revocation Invalidation；
- Stateful Session Owner Binding；
- Token Exchange 独立审计。

不能照搬：

- 其 Team、Admin 和 Public Scope 语义属于该产品；
- 部分路径包含不同的失效降级策略，PC 必须统一为自己的 Fail Closed 规则；
- ContextForge 的 Gateway、Virtual Server 和 Session 模型不等于 PC Session、Assignment 和 Profile；
- 不能把 ContextForge 作为 PC 授权权威。

## 综合证据结论

### 可以直接采用

1. Stateless MCP 优先；
2. Token Passthrough 禁止；
3. Protected Resource Metadata；
4. Audience / Resource 绑定；
5. Subject / Actor 分离；
6. Token Exchange / OBO；
7. App-only Client Credentials 分流；
8. Token Cache 完整隔离键；
9. Stateful Session Owner Binding；
10. Tool Discovery 与执行授权分离；
11. 401、403、撤权和未知结果分开处理；
12. 每请求动态 Credential Provider。

### 需要 PC 自己补齐

1. Principal Envelope；
2. Authorization Revision；
3. Assignment Generation 和 Fencing；
4. Expert Profile 与 Project Scope；
5. Approval Parameter Hash；
6. Effective Tool Set Snapshot；
7. Operation Ledger；
8. 业务撤权传播；
9. Durable Job 重新鉴权；
10. DSH ToolExecution 到 MCP Gateway 的调用上下文映射。

### 不能外推

1. MCP Protocol Session 不等于 PC Session；
2. OAuth Token 不等于完整业务权限；
3. Tool 未展示不等于无法越权调用；
4. 连接关闭不等于 Token 已撤销；
5. Token 刷新不等于写操作可以重试；
6. 外部 Server 返回取消不等于副作用不存在；
7. 参考 Gateway 的 RBAC 不能替代 EE Claw 最终权限校验。

