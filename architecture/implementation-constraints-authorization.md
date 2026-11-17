# 企业角色与授权实现约束清单

- 状态：Accepted Implementation Constraints
- 日期：2026-11-09
- 适用范围：EE Claw / `feishu-ee-agents` 企业角色、授权兼容、工作台投影和策略制品
- 依据：ADR-0007、ADR-0009、ADR-0010、ADR-0015、ADR-0016、ADR-0017
- 授权边界：本清单不授权修改代码、表、数据、API、表单、迁移或部署

## 1-A：责任角色独立

### 约束内容

责任角色必须独立于 Authorization Role。项目、模块和阶段范围使用 ResponsibilityAssignment 表达，不得编码进 `platform_roles` 或 Role Key。

### 适用范围

- 企业成员/角色管理；
- 项目、模块、阶段责任分配；
- Workbench 待办和 KPI 投影；
- PC Authorization Adapter。

### 引用 ADR

- ADR-0015 §4、§5；
- ADR-0010 §2.1、§5。

### 验收点

- 同一账号在 3 个项目 × 2 个模块承担责任时，Role Definition 数量不变；
- Responsibility Assignment 变化不自动改变 RolePermission。

## 1-B：策略制品 B3 版本化

### 约束内容

策略语义由代码 Registry 定义；版本和值使用不可变 PolicyArtifactRelease；Git 仅保存发布时生成的只写 JSON 归档镜像，不作为运行时读取源。

### 适用范围

- Workbench Projection；
- Role Configuration；
- Permission/Capability Policy；
- Artifact Contract；
- Workflow Contribution。

### 引用 ADR

- ADR-0016 全文；
- ADR-0014 Compatibility/Traceability；
- ADR-0010 §5。

### 验收点

- 已发布 Release Payload 不能修改或删除；
- Published AuthorizationDecision 可以追溯到 Release Version 和 Checksum；
- Git 镜像被修改不会改变运行时解析结果。

## 1-C：模块关系四字段

### 约束内容

角色与模块关系必须拆分为：

```text
visibility
capability
focus
requestable
```

不得使用单一 `●/◐/○/—` Effect 参与服务端授权。

### 适用范围

- 角色模块矩阵；
- Workbench Projection；
- Permission/Capability Resolver；
- 模块申请。

### 引用 ADR

- ADR-0015 §6；
- ADR-0009 D2；
- ADR-0010 §5。

### 验收点

- 从 `◐` 调整为 `●` 后授权结果完全一致；
- `requestable=true` 只创建申请，不直接获得可见性或 Capability。

## 1-D：`●` 与 `◐` 只差 Focus

### 约束内容

`●` 和 `◐` 均为：

```text
visible + read + edit
```

只分别映射 `primary` 和 `secondary` Focus。`●` 不隐含 Approve/Publish；不可移除属于 Workbench Projection。

### 适用范围

- 角色工作台；
- 模块矩阵；
- Authorization Decision；
- Expert Profile Resolver。

### 引用 ADR

- ADR-0015 §6.3、§7；
- ADR-0009 D2。

### 验收点

- `●` 和 `◐` 的 `has_permission`/Authorization Decision fixture 相同；
- 从工作台移除非 `●` 模块不触发 Permission 变更。

## 2：Legacy V1 零改动兼容

### 约束内容

保持现有 8 表、V1 API、`/api/v1/auth/me`、错误结构、审计日志和现有表单合同。新模块授权继续使用现有 RolePermission 写路径。

### 适用范围

- `backend/platform_auth`；
- `/api/v1/auth/*`；
- `/api/v1/access/*`；
- Access Control 前端；
- 访问审计。

### 引用 ADR

- ADR-0017 §3、§5；
- ADR-0015 范围声明。

### 验收点

- 老账号和老角色的有效页面/权限集合不减少；
- V1 API 响应字段、错误码和审计字段保持兼容；
- 本次无 Schema 或表单变化。

## 3：分层判定与交集

### 约束内容

有效能力继续按现有 Accepted ADR 分层取交集：

```text
PC policy
∩ EE Claw authorization
∩ organization/project/task scope
∩ resource/tool/connector policy
∩ Profile requirement
∩ approval
∩ runtime capability
∩ source-system final authorization
```

本约束不新增架构决策。

### 适用范围

- Authorization Service；
- EE Claw Adapter；
- Effective Profile Resolver；
- MCP/Tool Gateway；
- Runtime Guard；
- 源系统最终校验。

### 引用 ADR

- ADR-0010 §5；
- ADR-0007 §2；
- ADR-0009 D2。

### 验收点

- Workbench Visibility/Focus 不能让被 EE Claw 或源系统拒绝的操作变为允许；
- Profile Assignment 不能授予底层 Permission、Resource 或 Connector 权限。

## 4：不做数据迁移，直接兼容

### 约束内容

不新增账号、角色或授权数据，不物化 `page:*`，不回填 Project Grant，不强制重登。兼容由 `BASELINE_PAGE_KEYS_V1`、运行时 Decision Source 和现有请求时授权完成。

### 适用范围

- `platform_auth` 数据；
- `page:*`；
- Role 创建；
- 回滚；
- Authorization Cache。

### 引用 ADR

- ADR-0017 §4、§6-§10。

### 验收点

- 新增页面不自动进入 V1 `page:*`；
- 回滚代码不需要数据回滚；
- 撤销角色后下一个请求立即失效；
- 数据库无新增 Decision Source 字段。

## 约束总体验收

- [ ] 七条约束均有对应自动化测试或可执行检查；
- [ ] 所有实现变更引用至少一份 ADR；
- [ ] 页面证据不被描述为运行时事实；
- [ ] 未经独立授权不修改 EE Claw 代码、数据库或部署；
- [ ] 任何偏离通过 Implementation Decision 或 Superseding ADR 记录。

