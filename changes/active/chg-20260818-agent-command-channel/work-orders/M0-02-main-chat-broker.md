# M0-02｜Main-owned ProjectChatBroker

## 目标

实现项目 thread/transcript/run/prompt/session 的唯一写入者与 revision-aware 串行队列。暂不开放新窗口和网站入口。

## 依赖

- `M0-01` 完成。
- 精读 `technical.md §4–5`、`§11` 中与 thread receipt 无关的 broker 规则。

## Write allowlist

- `electron/project-chat-broker.ts`（新增）
- `electron/project-chat-broker.test.mjs`（新增）
- `electron/chat-workspace-store.ts`
- `electron/chat-workspace-store.test.mjs`
- `electron/claude-agent-runner.ts`
- `electron/main.ts`
- `src/project-chat-contract.ts`
- `src/project-chat-reducer.ts`
- `src/components/types.ts`
- `src/chat-workspace-persistence.ts`

禁止写：preload、React、window manager、deep link、Runtime。

## 实施步骤

1. 注入 workspace store、runner、clock/id factory/event broadcaster，禁止 broker 内直接访问 renderer。
2. 迁移 `WorkspaceThread.creationSource` 与 SQLite `creation_source_json`；旧/null/非法值为 user，JSON/SQLite 两个恢复源往返不丢 source。
3. 建立单串行 mutation queue；成功 durable operation revision +1。
4. 实现 `getSnapshot/createThread/submitRun/cancelRun/answerPrompt` 内核；本单可以只由 `main.ts` 旧 IPC 临时调用。
5. submit 固定执行“持久化 thread/user message → submitting → runner submit → request mapping/running”；SDK submit 失败保留可见线程。
6. 同 thread active 时返回 `thread-busy`，不得调用旧隐式取消路径；不同 thread 允许并行。
7. event sink 按 request mapping 折叠 durable transcript；terminal/sequence/generation fence 严格执行。
8. 实现 prompt 单 owner 的纯 registry/重新分配逻辑；UI capability 由下一单接入。

## 必测断言

- 两个并发 mutation 不丢 thread，revision 严格递增。
- 同 thread 第二次 submit：runner submit 调用次数不增加，cancel 次数为 0。
- 不同 thread 同时 active；事件只进入归属 thread。
- terminal 后迟到 delta 不改变终态/transcript done 状态。
- runner submit throw 后 thread 可见且 failed。
- broker restart 读取 durable thread；live run 不伪恢复。
- creationSource 在 JSON/SQLite round-trip 与旧 snapshot migration 后正确。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-broker.test.mjs electron/chat-workspace-store.test.mjs electron/chat-run.test.mjs
```

## 停止并报告

如果现有 workspace save 无法原子表达 revision，不保留 renderer full snapshot workaround；先报告所需 store schema migration。
