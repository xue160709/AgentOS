# M0-01｜共享合同、Reducer 与 Runner Event Sink

## 目标

建立 Main broker 可用的类型与纯事件折叠 seam，把 `ClaudeAgentRunner` 从固定 `WebContents` 解耦；本单不创建 broker、不改 UI、不改提交语义。

## 依赖

- 无代码依赖；先读 `technical.md §1–5.3`。
- 基线测试：`electron/chat-run.test.mjs`、`electron/claude-sdk-message-router.test.mjs`。

## Write allowlist

- `src/project-chat-contract.ts`（新增）
- `src/project-chat-reducer.ts`（新增）
- `src/components/chat/chat-run.ts`
- `src/claude-chat-types.ts`
- `electron/claude-agent-runner.ts`
- `electron/claude-chat-web-contents-sink.ts`（新增，迁移期 adapter）
- `electron/main.ts`（只允许替换 runner sink 构造，不改 IPC）
- `electron/chat-run.test.mjs`
- `electron/claude-sdk-message-router.test.mjs`
- `electron/project-chat-contract.test.mjs`（新增）

禁止写：`electron/preload.ts`、任何 React TSX、workspace store、Runtime；`electron/main.ts` 除 runner 构造行外禁止改动。

## 实施步骤

1. 按 `technical.md §4` 定义精确合同与 `ProjectChatError` helper；无 `any`。
2. 从现有 `chat-run.ts` 提取与 React 无关的事件折叠逻辑到 `project-chat-reducer.ts`；旧 export 可薄委托新 reducer，确保旧 UI 行为不变。
3. 为 runner 定义并注入 `ClaudeChatEventSink.publish(event)`；移除 runner core 对具体 `WebContents.send` 的依赖。
4. 在独立 adapter 中把现有主窗口 `WebContents` 转成 sink，并只修改 `main.ts` 的 runner 构造；本单不得改 IPC 或 submit/cancel/newThread 语义。
5. 为 terminal fence、未知 request、sink throw 不终止 run、现有 transcript fold 写测试。

## 完成条件

- 旧测试全部通过；新 pure contract/reducer test 通过。
- Runner 代码不 import `WebContents`，或仅临时 adapter 文件 import；核心 runner 构造函数只接收 sink。
- 没有 UI/持久化行为变化。

## 命令

```bash
npm run typecheck
node --test electron/chat-run.test.mjs electron/claude-sdk-message-router.test.mjs electron/project-chat-contract.test.mjs
```

## 停止并报告

若 SDK before/post tool 事件类型不足以支持 reducer，不在本单发明 mutation 事件；记录缺口交给 M2-01。
