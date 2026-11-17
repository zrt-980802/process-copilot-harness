# DECOUPLING D0 验证记录

- 日期：2026-11-17
- 状态：D0 COMPLETE / D1 NOT STARTED
- ADR：ADR-0024
- 范围：调用清单、Authority 路由表、C61-C65；无运行时行为变更

## 交付物

- `architecture/external-provider-decoupling-d0-inventory-v1.md`
- `architecture/external-provider-contract-catalog-v1.md`
- C61 `pc.provider-registration/1`
- C62 `pc.provider-health/1`
- C63 `pc.authority-route/1`
- C64 `pc.project-directory-snapshot/1`
- C65 `pc.capability-availability/1`

## 验证结果

从 `product/` 执行：

```text
pnpm generate:contracts
pnpm exec vitest run packages/contracts/tests/contracts.test.ts
pnpm check
```

结果：

- 65 份 Schema、valid fixture、required-field invalid fixture 和 TypeScript interface 可重复生成；
- Contract 定向测试 69 passed；
- Architecture dependency boundary 通过；
- Traceability 通过：24 ADR / 65 contracts；
- Compatibility baseline 通过；
- lint、17 个 workspace typecheck 和 build 通过；
- 全量测试 216 passed / 8 skipped；跳过项为既有条件测试，不由 D0 新增。

## 边界确认

D0 未修改 `apps/api`、`packages/application`、`packages/gateway` 或 EE 源码；未改变登录、Session 校验、授权、项目目录、MCP Catalog、Workbench 或启动行为。当前全局 EE 耦合仍存在，必须由后续 D1-D3 按 ADR-0024 分阶段移除。
