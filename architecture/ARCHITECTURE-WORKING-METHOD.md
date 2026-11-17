# Process Copilot 技术架构工作方法

- 状态：Active
- 日期：2026-11-06
- 名称：证据门禁式、ADR 驱动的架构先行开发
- 英文：Evidence-Gated ADR-Driven Architecture-First Development

## 1. 方法定位

这套方法组合了：

- Architecture-First Development；
- ADR-Driven Architecture；
- Contract-First Design；
- Evolutionary Architecture；
- Greenfield Development。

它不是一次性 Big Design Up Front。

区别在于：

- 每个技术域分批设计；
- 每批先调研和核查源码证据；
- 用户集中确认后才写 Accepted ADR；
- ADR 可通过新 ADR 被替代，不静默修改历史；
- 代码实施延后到技术边界和模块契约完整之后。

## 2. 当前总流程

```text
技术问题域
→ 现状与源码证据核查
→ Draft 工程结论
→ 集中确认队列
→ 用户确认
→ Accepted ADR
→ 架构活文档 / 图 / 证据库同步
→ 下一个技术问题域
```

全部技术 ADR 完成后：

```text
全量 ADR 一致性审查
→ DSH 无侵入实现审查
→ 模块划分
→ 稳定契约和接口
→ 分阶段开发计划
→ 绿地实现
→ 架构验收
```

## 3. 现有 Demo 的角色

现有 Process Copilot 原型是 Demo，不是目标系统基线。

可以参考：

- 业务流程顺序；
- 对话、审批和回读闭环；
- 异常和恢复场景；
- 验收经验；
- 已暴露的技术风险。

不得形成约束：

- 现有目录结构；
- 现有前后端模块；
- 数据库 Schema；
- API 形式；
- 全局 DSH Workspace；
- 部署拓扑；
- 兼容迁移要求。

目标系统采用绿地重建。技术设计和模块契约完成后，再决定实现技术和开发切分。

## 4. 技术优先边界

当前阶段只设计：

- 系统责任边界；
- 权威来源；
- 身份、权限和隔离；
- 数据、事件和状态；
- Resource、Tool、Plugin、Profile 和 MCP 契约；
- 生命周期、恢复、审计和安全；
- 部署与可观测性；
- 测试和验收要求。

当前阶段不设计：

- 最终产品交互；
- 页面布局；
- 业务优先级；
- 具体视觉方案；
- 实施排期；
- 现有 Demo 的迁移步骤。

产品需求只有在影响技术约束时作为输入。

## 5. DSH 修改纪律

单个 ADR 可以定义 Process Copilot 所需行为，但不直接推导“必须修改 DSH”。

所有技术 ADR 完成后，统一执行 DSH 无侵入实现审查：

```text
1. DSH Runtime Profile / Bundle 配置
2. Process Copilot Adapter
3. DSH Plugin
4. Capability Seam 的外部实现
5. Tool / MCP / Gateway
6. 独立持久服务
7. 受控 Runtime 包装层
8. 最后才评估 DSH Core 修改
```

每项疑似 DSH 修改必须给出：

- 所属 ADR；
- 需要的行为；
- DSH 当前事实；
- 至少一个无侵入候选；
- 候选的能力缺口；
- 修改 DSH 的必要性证据；
- 升级、维护和回归成本；
- adopt / adapt / fork / upstream 建议。

默认优先级：

```text
配置
> Adapter / Gateway
> Plugin / Capability 实现
> 独立服务
> 外部补丁
> DSH Core 修改
```

## 6. 可调整决策

架构默认不是永久不变。

例如 Workspace 存储分层可以因以下证据调整：

- 业务对象和协作方式；
- 合规与数据驻留；
- 文件规模和访问模式；
- 成本；
- 性能；
- 多租户部署；
- 外部系统能力。

调整必须：

1. 新增 ADR；
2. 标明替代关系；
3. 说明变化证据；
4. 更新验收要求；
5. 不覆盖旧版本。

## 7. 当前技术批次顺序

1. Runtime Pool、Lease、恢复和回收：已完成；
2. Workspace 资源模型：已完成；
3. DSH Adapter：已完成；
4. MCP 多 Session 鉴权：已完成；
5. Tool / Plugin 治理：已完成；
6. Expert Profile 技术模型：已完成；
7. 身份、权限和外部系统注册：已完成；
8. 状态、审批和审计：已完成；
9. 部署、容量和可观测性补全：已完成；
10. 测试、版本兼容和架构一致性：已完成；
11. 企业角色、策略制品与 Legacy 授权兼容：已完成 ADR-0015 至 ADR-0017；
12. 全量 DSH 无侵入实现审查：已完成，首期 DSH Core 必改项为 0；
13. 模块责任矩阵、稳定 Contract、Traceability 与 Compatibility：已完成；
14. P0-P7 绿地开发计划：已完成；
15. 下一阶段：执行 P0 工程与契约基线、P1 Runtime Walking Skeleton。

## 8. 实施授权边界

Accepted ADR 只表示技术设计可作为依据，不自动授权：

- 修改 DSH；
- 修改 Process Copilot 代码；
- 修改数据库；
- 引入基础设施；
- 部署；
- 提交或推送；
- 写入企业系统。

实施必须在全量架构和模块契约完成后，通过独立任务书授权。

