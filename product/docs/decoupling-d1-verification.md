# DECOUPLING D1 验证记录

- 日期：2026-11-17
- 状态：D1 COMPLETE / D2 NOT STARTED
- ADR：ADR-0024
- 范围：行为保持的五类 Port 拆分

## 代码交付

- Application Port：`packages/application/src/external-provider.ts`
- EE Authorization：`packages/application/src/eeclaw-adapter.ts`
- Business Capability Port：`packages/gateway/src/types.ts`
- EE MCP Provider：`packages/gateway/src/mcp-provider.ts`
- EE Identity Provider：`apps/api/src/ee-login.ts`
- EE Project Directory / Workbench Projection：`apps/api/src/ee-provider.ts`
- Port 装配：`apps/api/src/main.ts`、`server.ts`、`workbench.ts`

## Golden tests

- `apps/api/tests/ee-login.test.ts`
- `apps/api/tests/ee-provider.test.ts`
- `apps/api/tests/workbench.test.ts`
- `packages/application/tests/eeclaw-adapter.test.ts`
- `packages/gateway/tests/mcp-provider.test.ts`

定向结果：5 files / 32 tests passed。

## 全量门禁

从 `product/` 执行 `pnpm check`：

- generated contract inventory：通过；
- architecture boundaries：通过；
- traceability：24 ADR / 65 contracts；
- compatibility baseline：通过；
- lint、17 workspace typecheck、build：通过；
- tests：35 files passed / 7 skipped，219 tests passed / 8 skipped。

跳过项为既有条件测试，不由 D1 新增。D1 未修改数据库 schema、EE 源码、DSH Core、端口、环境文件或生产配置。
