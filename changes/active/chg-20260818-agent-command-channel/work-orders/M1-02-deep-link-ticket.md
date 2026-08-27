# M1-02｜平台 Deep Link、HTTPS Ticket 与外部任务提交

## 目标

接通 cold/warm `agentos://` 生命周期、固定 HTTPS client 和 broker 外部任务线性化；暂不做完整配对/Settings 视觉。

## 依赖

- `M1-01` 完成。
- 精读 `protocol-v1.md §2–6`、`technical.md §10–11`。

## Write allowlist

- `electron/agentos-deep-link.ts`
- `electron/agentos-ticket-client.ts`（新增）
- `electron/agentos-ticket-client.test.mjs`（新增）
- `electron/agentos-external-task.ts`（新增，可选 orchestration）
- `electron/agentos-external-task.test.mjs`（新增）
- `electron/main.ts`
- `electron/project-chat-broker.ts`
- `electron/project-chat-broker.test.mjs`
- `electron/website-binding-store.ts`
- `electron/external-task-receipt-store.ts`
- `electron-builder.json5`
- `electron-builder.config.cjs`（仅协议注册兼容需要时）

禁止写：preload、React、Preview、Runtime。

## 实施步骤

1. 注册 `agentos` scheme；统一处理 initial argv、second-instance argv、mac open-url。
2. app ready 前 cold queue 最多 32/5min，按 action+origin+request 去重；使用注入 clock 测试。
3. HTTPS client 固定 endpoint、独立 Main session/no cookie、无 redirect、5s connect/10s total、64KiB、JSON content type。
4. Task orchestration：binding auth → GET/validate → receipt lookup → broker thread+receipt → runner requestId → accepted → POST receipt。
5. 回执失败不 cancel；重复相同 key 重发 terminal receipt；不同 payload conflict。
6. 所有网络/异常日志通过 redaction helper；测试扫描 credential/task/path 不出现。
7. 使用本地受控 HTTPS fixture 覆盖成功、timeout、redirect、401、404/410、429/5xx、oversize。

## 必测断言

- cold/warm 同请求仅处理一次。
- accepted 时 thread durable 且有 local request mapping；POST 失败 run 继续。
- SDK submit 失败保留 thread 并 rejected；同 key 不新建。
- deep link/Ticket 注入项目/permission/session 不到 broker。
- second-instance 不只是聚焦主窗口，而是把合法 URL 排队；非法 argv 无副作用。

## 命令

```bash
npm run typecheck
node --test electron/agentos-deep-link.test.mjs electron/agentos-ticket-client.test.mjs electron/agentos-external-task.test.mjs electron/project-chat-broker.test.mjs
npm run build
```

## 停止并报告

若 Electron 网络 API 不支持独立无 cookie client 或 connect timeout，先记录实际能力并修规格；不得改用 renderer fetch。
