# ADR-0022：数字印象、长期记忆与委托授权分离

- 状态：Accepted
- 日期：2026-11-16
- 范围：DigitalImpression、DelegationGrant、DelegateDecision、未来员工数字代理
- 前置决策：ADR-0009、ADR-0010、ADR-0012、ADR-0015、ADR-0018 至 ADR-0021
- 用户决策：2026-11-16 按推荐方案持续推进；确认三域分离、本人明确授权、逐次决策、L4 排除和代理身份披露
- 实施原则：本 ADR 只冻结未来边界；不授权开发数字印象、数字代理、员工代答或业务行动

## A. 决策问题

1. 员工长期记忆能否直接形成“数字人”；
2. DigitalImpression 是否等于员工本人事实；
3. 谁可以授权数字代理代表员工回答；
4. 代理答复需要哪些逐次判断和披露；
5. 哪些行为即使有历史记忆也必须禁止。

## B. 建议决策

采用三个完全独立的领域：

```text
Memory Domain
  stores governed evidence and confirmed/published memories
              |
              v
DigitalImpression Domain
  derives employee-controlled facts/views/method/style summaries
              |
              X  no automatic authority conversion
              |
Delegation Domain
  explicit grant + per-request decision + response constraints
```

知识提炼不产生代表权。任何代表员工向他人答复的能力都必须来自员工本人明确、可撤销、有限期的 DelegationGrant。

## C. DigitalImpression

DigitalImpression 是员工本人可查看和纠正的派生数据产品，至少区分：

- confirmed fact；
- confirmed viewpoint；
- historical decision；
- verified method；
- communication preference；
- model inference；
- unknown；
- forbidden inference。

规则：

- 每项回链 Memory Revision 和 SourceEvidence；
- 员工可接受、修改、拒绝、过期和禁止某类推断；
- 模型推断不能展示为员工确认事实；
- 敏感属性和人格评价默认禁止；
- DigitalImpression 不能作为身份、Role、Capability 或 Delegation 凭证。

## D. Delegation 模型

未来至少分离：

- `DelegationGrant`：员工明确授权的稳定对象；
- `DelegationPolicy`：组织允许的边界；
- `DelegationDecision`：每次请求的动态 Allow/Deny/Escalate；
- `DelegateResponse`：本次答复及证据、限制和披露。

Grant 至少限定：

- 委托人和接收者；
- Tenant/Project/Topic/Purpose；
- 可使用的数据源和 Memory 类型；
- 允许的答复等级；
- 有效期、撤销、通知和追认要求；
- 禁止行为和人工升级条件。

## E. 答复等级

| 等级 | 能力 | 架构状态 |
| --- | --- | --- |
| L0 | 提供本人预先批准的材料 | 未来试点候选 |
| L1 | 转述本人确认且仍有效的事实/观点 | 未来试点候选 |
| L2 | 组合多个证据生成新解释 | 后置，必须声明未实时确认 |
| L3 | 在明确对象、主题和期限内正式代答 | 单独 Release Decision |
| L4 | 承诺、审批、人事评价、业务写操作 | 默认排除 |

## F. 逐次决策

即使存在有效 Grant，每次请求仍需判断：

```text
current identity
AND recipient
AND purpose
AND topic/project
AND grant validity
AND current policy
AND evidence authorization
AND answer level
AND conflict/freshness/confidence
```

输出只能是 `ANSWER | DRAFT_FOR_OWNER | REFUSE | ESCALATE`。Grant 不是永久 Allow。

## G. 披露与可追溯性

未来数字代理答复必须：

- 明确说明是数字代理而非员工本人实时回复；
- 区分本人原话、事实转述和模型综合；
- 展示来源、有效时间和适用范围；
- 记录 Grant Revision、DelegationDecision 和 Memory Revision；
- 支持员工事后查看、纠正和撤销。

具体 UI 文案后续设计，但不得通过“无缝体验”隐藏代理身份。

## H. 禁止转换

- Memory -> DelegationGrant：禁止；
- DigitalImpression -> DelegationGrant：禁止；
- Profile/Role -> DelegationGrant：禁止；
- 管理员权限 -> 员工个人代表权：禁止；
- 历史上曾回答过 -> 未来持续授权：禁止；
- 项目成员关系 -> 代表其他成员发言：禁止。

## I. 否决方案

- 训练或提示一个“像员工”的人格即视为数字人：缺少事实、授权和责任边界；
- 只要答案有来源就允许代答：来源权不等于代表权；
- 管理员为效率统一开启代答：绕过员工本人授权；
- 代理隐去身份以追求无缝：造成冒充和责任混淆。

## J. 后果

正面：

- Personal Memory 可以先独立落地；
- 员工对数字印象拥有控制权；
- 代表权具备清晰撤销、审计和逐次判定；
- L0/L1 可在未来低风险试点，不自动滑向 L4。

成本：

- 数字代理需要独立领域和产品治理；
- 不能仅靠记忆框架快速拼装代答 Demo；
- 组织 Policy、法务、安全和员工接受度成为正式前置门。

## K. 接受门

- 三域分离和禁止转换规则得到确认；
- 代表权只能来自本人明确 Grant 得到确认；
- 每次答复重新决策得到确认；
- L4 默认排除得到确认；
- 数字代理身份必须披露得到确认。

