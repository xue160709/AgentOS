# 聊天与 Agent 运行时技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `src/claude-chat-types.ts` | 聊天提交、附件、权限、事件、模型和搜索相关共享类型。 |
| `src/components/chat/ChatPage.tsx` | Composer、模型/权限选择、Agent IPC 事件和线程状态同步。 |
| `src/components/chat/chat-run.ts` | Chat Run 事件折叠、竞态处理和 transcript 更新。 |
| `src/components/chat/Composer.tsx` | 输入框、命令、提及、附件和提交交互。 |
| `src/components/chat/ChatThreadView.tsx`、`src/components/chat/Transcript.tsx` | 对话时间线渲染。 |
| `src/components/chat/AgentInputPromptModal.tsx` | Agent 选择题/用户输入弹窗。 |
| `src/components/chat/GenerativeWidget.tsx`、`src/components/chat/generative-ui.ts` | `show-widget` 沙箱渲染。 |
| `electron/claude-agent-runner.ts` | Claude Agent SDK query 封装、权限闸门、session 与事件转发。 |
| `electron/claude-agent-runner/*` | SDK 消息路由、输入归一化、配置、diff、事件合并等子模块。 |
| `electron/claude-sdk-message-router.test.mjs`、`electron/chat-run.test.mjs` | 运行时关键测试。 |

## 数据结构

- `ClaudeChatSubmitPayload`：文本、附件、threadId、modelPick、sessionId、cwd、permissionMode 和 promptMode。
- `ClaudeChatEvent`：主进程推送给 UI 的流式事件联合类型。
- `ChatState.items`：message、tool、thinking、activity、context_compaction、file_diff 的 transcript 联合。
- `ThreadRunState`：UI 侧进行中、等待中和提问中状态。

## 调用链路

```text
Composer submit
  -> ChatPage 创建用户消息和 pending request
  -> window.claudeChat.submit(payload)
  -> ClaudeAgentRunner.submit
  -> @anthropic-ai/claude-agent-sdk query
  -> ClaudeSdkMessageRouter / EventCoalescer
  -> claude-chat:event
  -> ChatRun.handleEvent 更新线程 chatState
```

## 日志与调试

- `ClaudeAgentSettingsStore` 和 `ClaudeAgentRunner` 只记录配置摘要、模型名、endpoint host、工具/状态摘要，不记录密钥和用户隐私原文。
- 运行失败优先看 `ClaudeAgentRunner.getStatus` 脱敏快照、`lastError`、sessionId 和 permissionMode。
- 文件 diff 问题优先看 `electron/claude-agent-runner/file-diff.ts`。

## 测试与验收

- 自动测试：`electron/chat-run.test.mjs`、`electron/claude-sdk-message-router.test.mjs`、`electron/claude-agent-runner-executable.test.mjs`。
- 关键覆盖：流式文本、result-only、cancel、orphan event、thinking/tool/activity/task/prompt、context compaction、file diff、并发提交阻止。
- 验收契约：`prd/chat-agent-runtime/acceptance.md`。

## 边界情况

- 空提交不会启动有效 Agent 请求。
- 同一线程新请求会取消前一个活跃请求。
- stale session 报错时 UI 会清理旧 session。
- 图片附件受模型能力限制。

## TODO 对应项

- `TODO.md §14`：正式验收、UI 选择器和 e2e 证据补齐。

## 最近同步

- commit：`bb8d2b04de464f1a09decc875f2e869afe8885fb`
- 日期：`2026-06-23`
- 变化摘要：按 Chat Run seam 和 Claude Agent runner 当前实现补齐 as-built PRD。
- 待确认：真实 SDK 运行和权限弹窗需在本机环境正式验收。

