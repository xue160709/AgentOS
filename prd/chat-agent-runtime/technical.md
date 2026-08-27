# 聊天与 Agent 运行时技术文档

## Revision 2 计划合同（Accepted / Planned）

Revision 2 将 renderer-local Chat 写入路径迁移为 Main-owned `ProjectChatBroker`。该计划尚未落地；完整冻结合同见 [`../../changes/active/chg-20260818-agent-command-channel/technical.md`](../../changes/active/chg-20260818-agent-command-channel/technical.md)，网站线协议见同目录 `protocol-v1.md`。

计划新增的关键边界：

| 边界 | 冻结决定 |
| --- | --- |
| 事实源 | Main 串行写 thread/transcript/run/session/diff/workspace revision；renderer 只消费完整项目 snapshot |
| Runner | `ClaudeAgentRunner` 通过 event sink 向 broker 发事件，不直接持有单个 renderer `WebContents` |
| 并发 | 同 thread active 时第二次 submit 返回 `thread-busy`，不隐式取消；不同 thread 可并行 |
| 窗口 | 每项目一个 BrowserWindow，固定 project capability；关闭视图不 cancel run |
| IPC | `window.projectChat` typed bridge；Main 校验 sender、main frame、renderer URL 与固定 project capability |
| 权限 | app-global Main preference，缺省 `auto`；submit 线性化时捕获，网站协议无权限字段 |
| 网站 | safeStorage 加密 Binding credential；fixed HTTPS well-known Ticket；accepted 只表示 thread durable + runner 返回 requestId |
| Runtime | 可靠 before-tool lease/actual diff 才记 mutation；三条件 settle，1,500ms stable / 30,000ms max；旧 generation 不切 last-good |

迁移必须按 `M0 contracts/broker/window` → `M1 binding/deep-link` 与 `M2 runtime settle` 执行。M0 完成前不得让旧 renderer writer 与 broker 同时写 workspace；Revision 2 完成后，下面“同一线程新请求会取消前一个活跃请求”的 as-built 行为将改为 `thread-busy`。

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `src/claude-chat-types.ts` | 聊天提交、附件、权限、事件、模型和搜索相关共享类型。 |
| `src/agent-command-channel.ts` | 无 UI 的全局 Agent 指令通道；配置阶段绑定项目，发送时创建独立线程并返回 `threadId`。 |
| `src/components/chat/ChatPage.tsx` | Composer、模型/权限选择、Agent IPC 事件和线程状态同步。 |
| `src/components/chat/chat-run.ts` | Chat Run 事件折叠、竞态处理和 transcript 更新。 |
| `src/components/chat/Composer.tsx` | 输入框、命令、提及、附件和提交交互。 |
| `src/components/chat/ChatThreadView.tsx`、`src/components/chat/Transcript.tsx` | 对话时间线渲染。 |
| `src/components/chat/AgentInputPromptModal.tsx` | Agent 选择题/用户输入弹窗。 |
| `src/components/chat/GenerativeWidget.tsx`、`src/components/chat/generative-ui.ts` | `show-widget` 沙箱渲染。 |
| `src/components/AppAgentStatusPopover.tsx` | Agent 状态面板；展示 MCP server 状态、失败摘要、工具数量和进入项目 MCP 设置的跳转。 |
| `electron/claude-agent-runner.ts` | Claude Agent SDK query 封装、权限闸门、session 与事件转发。 |
| `electron/claude-agent-runner/mcp.ts` | 项目级 MCP server、tool policy、环境变量模板和 runtime options 合成。 |
| `electron/claude-agent-runner/web-search.ts` | 按全局搜索设置生成 native 或 AgentOS Provider WebSearch runtime options，并提供 Provider 连接测试入口。 |
| `electron/claude-agent-runner/web-search-provider.ts` | DuckDuckGo HTML Search、Brave Search、Tavily Provider registry、请求归一化、结果格式化和 Provider 错误分类。 |
| `electron/claude-agent-runner/*` | SDK 消息路由、输入归一化、配置、diff、事件合并等子模块。 |
| `electron/claude-sdk-message-router.test.mjs`、`electron/chat-run.test.mjs`、`electron/claude-agent-runner-mcp.test.mjs`、`electron/claude-agent-runner-web-search.test.mjs` | 运行时关键测试。 |

## 数据结构

- `ClaudeChatSubmitPayload`：文本、附件、threadId、modelPick、sessionId、cwd、permissionMode 和 promptMode。
- `ClaudeChatEvent`：主进程推送给 UI 的流式事件联合类型。
- `ChatState.items`：message、tool、thinking、activity、context_compaction、file_diff 的 transcript 联合。
- `ThreadRunState`：UI 侧进行中、等待中和提问中状态。
- `McpRuntimeOptions`：合成 `mcpServers`、`allowedTools`、`disallowedTools`、`toolAliases`、配置签名和未解析环境变量。
- `AgentWebSearchSettings`：全局搜索模式、Provider、Brave/Tavily API Key 池或 `${ENV_NAME}` 引用；旧单 Key 字段会兼容迁移为单元素池。
- `AgentWebSearchProviderTestResult`：Provider 测试结果、凭据状态、错误分类和恢复提示。
- `WebSearchRequest` / `WebSearchResponse`：内部 `agentos-web` MCP 工具的请求和 JSON 输出结构。
- `AgentCommandResult`：一次通道发送的 `commandId`、固定 `projectId` 与新建 `threadId`。
- `AgentCommandEvent`：通道线程复用的 `creating`、`running`、`waiting`、`asking`、`succeeded`、`failed`、`cancelled` 状态。

## 全局 Agent 指令通道

`AppShell` 负责把 `agentCommandChannel` 配置到当前目标项目，并注入创建线程、提交 Chat Run 和打开线程的运行时能力。业务模块只传完整指令，不传项目 ID：

```ts
import { sendAgentCommand } from '../agent-command-channel'

const { threadId } = await sendAgentCommand(fullPrompt, {
  navigation: 'stay', // 改为 open 可立即打开新线程
  threadTitle: '选题写作',
})
```

需要观察长任务时，可通过 `agentCommandChannel.subscribeThread(threadId, listener)` 订阅状态，或用 `getThreadStatus(threadId)` 读取最新状态。`stay` 不会切换当前路由、活动线程或清空 Composer 草稿；新线程仍出现在普通线程列表中，用户可随时打开查看。

## 调用链路

```text
Composer submit
  -> ChatPage 创建用户消息和 pending request
  -> window.claudeChat.submit(payload)
  -> ClaudeAgentRunner.submit
  -> buildMcpRuntimeOptions + buildWebSearchRuntimeOptions
  -> @anthropic-ai/claude-agent-sdk query(options.mcpServers / toolAliases / allowedTools / disallowedTools)
  -> ClaudeSdkMessageRouter / EventCoalescer
  -> claude-chat:event
  -> ChatRun.handleEvent 更新线程 chatState
```

```text
sendAgentCommand(fullPrompt)
  -> Workspace Session 创建非激活普通线程
  -> ChatPage.submitPromptInThread
  -> 既有 Claude Agent SDK Chat Run
  -> 通道按 threadId 转发运行态与终态
```

## 日志与调试

- `ClaudeAgentSettingsStore` 和 `ClaudeAgentRunner` 只记录配置摘要、模型名、endpoint host、工具/状态摘要，不记录密钥和用户隐私原文。
- `[AgentOS/WebSearch]` 日志只记录 provider、queryLength、结果数、耗时和脱敏错误摘要，不记录查询原文、API Key 或完整 header。
- 运行失败优先看 `ClaudeAgentRunner.getStatus` 脱敏快照、`lastError`、sessionId 和 permissionMode。
- 文件 diff 问题优先看 `electron/claude-agent-runner/file-diff.ts`。

## 测试与验收

- 自动测试：`electron/chat-run.test.mjs`、`electron/claude-sdk-message-router.test.mjs`、`electron/claude-agent-runner-executable.test.mjs`、`electron/claude-agent-runner-mcp.test.mjs`、`electron/claude-agent-runner-web-search.test.mjs`。
- 指令通道测试：`electron/agent-command-channel.test.mjs`、`electron/workspace-session.test.mjs`。
- 关键覆盖：流式文本、result-only、cancel、orphan event、thinking/tool/activity/task/prompt、context compaction、file diff、并发提交阻止。
- WebSearch 覆盖：native 模式不注册 `agentos-web`；AgentOS 模式注册内部 MCP、alias `WebSearch`、禁用内置 `WebSearch`；Tavily POST 请求、DuckDuckGo 结果归一化、provider 状态、域名过滤、HTTP 错误分类、Brave/Tavily API Key 池顺序轮询、Provider Test 的 env-resolved/env-missing 分支。
- 交互流程复查：`ChatRun` 维护 request/thread ownership 与 terminal cleanup；`ClaudeAgentRunner` 在取消、拒绝权限和异常退出时清理 pending request；`ChatPage` 的语音输入使用 generation guard、draft range 和 submit 前 finalize，降低 late event 污染当前输入的风险。
- 验收契约：`prd/chat-agent-runtime/acceptance.md`。

## 边界情况

- 空提交不会启动有效 Agent 请求。
- 同一线程新请求会取消前一个活跃请求。
- stale session 报错时 UI 会清理旧 session。
- 图片附件受模型能力限制。
- MCP 或全局搜索设置变化会进入 runtime config signature，下一轮请求会重建 SDK session。
- MCP server 失败、需要认证、命令不存在、环境变量缺失或 HTTP 401 时，Chat 侧应提供可恢复入口而不是只显示通用运行错误。
- MCP tool 权限默认应走询问或显式 policy，不应因开启 Agent 权限绕过而全量自动允许。
- DuckDuckGo Search 直接读取 DuckDuckGo HTML 搜索结果；HTML 集成是实验性能力，可能遇到 bot challenge 或网络不可达，此时返回空结果而不是工具错误。
- Tavily/Brave 的认证、额度或套餐错误会映射为 `auth` / `quota` / `service` 等 Provider 错误；当 Provider 配置了多个 API Key 时，运行时会对可恢复错误按用户排序尝试后续 Key，并在 `web_search` 工具输出与设置页测试结果中给出脱敏恢复建议。

## TODO 对应项

- `TODO.md §14`：全页面点击式 E2E、Composer 语音 GUI 路径、真实 Provider live smoke 和交互流程专项证据补齐。
- `TODO.md §15`：MCP 与 WebSearch 接入 backlog，包括设置入口、SDK 参数接入、状态展示、工具权限、错误恢复、Provider 空结果/配额体验和测试。

## 最近同步

- commit：`27851a1fcbd8e8a85b0892d8a5d30db5a17acc5f`
- 日期：`2026-06-24`
- 变化摘要：同步全量 `project-verify`、WebSearch API Key 池增量验收与交互流程复查结果；Chat 运行时 acceptance 已全部通过，MCP/WebSearch 核心路径完成正式验收。
- 待确认：完整 Chat 全页面点击式 E2E、Composer 语音 GUI 路径、真实 Brave/Tavily 外网成功搜索和真实 MCP server live smoke 仍可补充。
