# MVP P0 测试环境部署验收 v1

- 日期：2026-11-09
- Docker Host：`tcp://192.168.31.95:2375`
- 产品目录：`product/`
- Compose：`product/deploy/docker-compose.test.yml`
- 镜像标签：`p0-20261109-1941`
- 范围：P0 工程与契约基线、Runtime Host 空骨架、ADR-0015 至 ADR-0017 首期领域规则

## 1. 发布边界

本次部署替换旧 Process Copilot 原型的运行端口，但不修改或删除旧容器、镜像和数据卷。

已停止并保留：

- `ee-demo-pc-mysql`
- `ee-demo-pc-query-mcp`
- `ee-demo-pc-backend`
- `ee-demo-pc-frontend`

保持运行且未重建：

- `ee-demo-platform-frontend`
- `ee-demo-platform-app`
- `ee-demo-platform-mysql`
- `ota281-platform-fe-frontend`

## 2. 新部署

| 容器 | 镜像 | 端口 | 最终状态 |
|---|---|---|---|
| `process-copilot-mvp-web` | `process-copilot-mvp-web:p0-20261109-1941` | `18080 -> 80` | healthy |
| `process-copilot-mvp-api` | `process-copilot-mvp-api:p0-20261109-1941` | `18011 -> 3000` | healthy |
| `process-copilot-mvp-runtime-host` | `process-copilot-mvp-runtime-host:p0-20261109-1941` | `18012 -> 3100` | healthy |

## 3. 验证结果

本地发布门禁：

- 17/17 ADR Traceability 通过；
- 42/42 Contract Schema、valid fixture、invalid fixture 通过；
- lint、typecheck、build 通过；
- 4 个测试文件、56 项测试通过；
- ADR-0015 至 ADR-0017 的角色非扩权、不可变发布、双人安全审批、Legacy Baseline、Deny 优先、零迁移和即时撤权约束均有测试覆盖。

远端 HTTP 验收：

| URL | 结果 |
|---|---|
| `http://192.168.31.95:18080/` | HTTP 200 |
| `http://192.168.31.95:18080/health` | HTTP 200 |
| `http://192.168.31.95:18080/api/health` | HTTP 200 |
| `http://192.168.31.95:18080/runtime/health` | HTTP 200 |
| `http://192.168.31.95:18011/health` | HTTP 200 |
| `http://192.168.31.95:18011/ready` | HTTP 200 |
| `http://192.168.31.95:18012/health` | HTTP 200 |
| `http://192.168.31.95:18012/capabilities` | HTTP 200 |

Studio 浏览器验收：

- 页面标题为 `Process Copilot`；
- 可访问结构包含任务工作台、任务列表、`FO SSTS Draft Assistant`、新建任务和上传资料入口；
- 浏览器控制台无错误。

## 4. 失败恢复证据

首次正式切换时，Windows `pnpm deploy` 产物包含绝对 Junction，传入 Linux 镜像后导致 `fastify` 无法解析。

处理结果：

1. Compose 启动失败后自动重新启动四个旧 PC 容器；
2. 旧前端和后端 URL 恢复 HTTP 200；
3. 清理失败的新栈；
4. 将制品生成改为 `node-linker=hoisted`，使用真实目录；
5. 在临时端口 `19011/19012` 冒烟通过后再次切换；
6. 第二次切换成功。

## 5. 回滚

旧容器和数据卷均保留。回滚顺序：

```powershell
$env:DOCKER_HOST = "tcp://192.168.31.95:2375"
docker compose -f product/deploy/docker-compose.test.yml down
docker start ee-demo-pc-mysql ee-demo-pc-query-mcp ee-demo-pc-backend ee-demo-pc-frontend
```

回滚后应重新验证：

```text
http://192.168.31.95:18080/
http://192.168.31.95:18011/healthz
```

## 6. 当前限制

- Runtime Host 当前为 `UNASSIGNED / NOT_STARTED`，DSH 集成尚未配置；
- API readiness 明确报告 database/blob `not-configured`；
- 当前页面是 M0/P0 工作台骨架，不是完整可用的 SSTS 纵向闭环；
- `2375` 为未加密 Docker API，应仅在受控测试网段开放并通过主机防火墙限制来源。

## 7. 判定

P0 工程、契约、容器化和测试环境发布基线验收通过。下一步可进入 Runtime Walking Skeleton P1-A 官方 SDK Spike，不应把当前部署描述为完整 MVP 或生产发布。

