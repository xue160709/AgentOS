# M0-06｜完整 Project Window 与 Revision 1 Command Channel

## 目标

在 M0-05 已稳定的 snapshot controller 上复用完整 Chat UI 到独立窗口，并把 Revision 1 `agentCommandChannel` 迁到 broker。完成本单才执行 M0 Gate。

## 依赖

- `M0-05` 完成且主窗口 Chat 回归全绿。

## Write allowlist

- `src/components/chat/ProjectChatWindowPage.tsx`
- `src/components/chat/ChatPage.tsx`
- `src/components/chat/Composer.tsx`
- `src/components/chat/ChatThreadView.tsx`
- `src/components/chat/Transcript.tsx`（仅提取可复用 props 所需）
- `src/components/AppShell.tsx`（仅打开项目窗口入口/command navigation adapter）
- `src/agent-command-channel.ts`
- `src/project-chat-contract.ts`
- `src/main.tsx`
- 对应 Chat/Project Window CSS 与测试文件（回报具体路径）
- `electron/agent-command-channel.test.mjs`
- `electron/project-chat-renderer.test.mjs`
- `electron/project-chat-window-manager.test.mjs`

禁止写：broker/runner/Main/preload、workspace store、binding/deep link、Runtime。

## 实施步骤

1. 抽取最小可复用 project Chat view；Project Window 通过 M0-05 同一 snapshot controller 显示线程、Transcript、Composer、模型、权限、附件、slash、@、diff、rewind。
2. 项目窗口只保留自己的 selected thread/draft；恢复 M0-04 view state，关闭时保存但不 cancel。
3. 项目窗口不渲染项目切换、全局 Docs/Settings、Runtime Preview、日志或进程控制。
4. prompt owner 非 owner 状态只读；owner 关闭后新 snapshot 接管。
5. `sendAgentCommand` 保持 Revision 1 公共 API，内部通过 broker create+submit；`stay` 不改变 route/thread/draft，`open` 使用主窗口选择目标 thread。
6. 双窗口同 run 使用相同 snapshot，不在独立窗口另建 workspace/session/run state。

## 必测断言

- 同 run 双窗口无重复 transcript；关闭独立窗口 broker cancel 次数为 0。
- 主/独立窗口 draft 互不覆盖并跨重开恢复。
- `stay/open` Revision 1 行为保持，线程由 broker 持久化。
- 同 thread busy、prompt owner、permission sync 两窗口文案/控件正确。
- 项目窗口不存在项目切换、全局 Settings、Runtime 控件。

## 命令

```bash
npm run typecheck
node --test electron/agent-command-channel.test.mjs electron/project-chat-renderer.test.mjs electron/project-chat-window-manager.test.mjs electron/project-chat-broker.test.mjs
npm run test:electron
```

## M0 Gate

全部命令通过，真实 Electron smoke 证明双窗口同源、draft 独立、prompt owner 转移和关闭不中止后，才可默认开启 `projectChatBrokerV2` 并进入 M1/M2。

## 停止并报告

若复用完整 Chat 必须复制一套 reducer、workspace store 或 session state，停工回报；允许抽 props/controller，不允许第二套事实源。
