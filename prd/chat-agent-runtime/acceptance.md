# 聊天与 Agent 运行时验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：聊天提交构造完整 Agent 运行载荷
系统 SHALL 将用户文本、附件、线程 ID、项目 cwd、权限模式、模型选择、sessionId 与必要上下文构造成 `ClaudeChatSubmitPayload` 后提交给主进程。

#### 场景：用户提交有效聊天
- GIVEN 用户在项目线程中输入非空文本或选择有效附件
- WHEN 用户提交 Composer
- THEN 系统创建或复用线程，写入用户消息与模型选择，并调用 `window.claudeChat.submit`

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=textbox[name="聊天输入"]｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

#### 场景：空提交
- GIVEN Composer 文本为空且没有附件
- WHEN 用户触发提交
- THEN 系统不启动有效 Claude Agent 请求，并保持当前线程不新增空用户消息

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

### 需求：SDK 事件流转为可渲染 transcript
系统 SHALL 将 Claude Agent SDK 的 assistant、thinking、tool、activity、result、error 和 cancelled 事件标准化写入当前线程 transcript。

#### 场景：流式文本完成
- GIVEN 一次已 accepted 的 Agent 请求正在运行
- WHEN 主进程推送 session_start、assistant_delta 和 result 事件
- THEN UI 将 assistant 文本合并为 done 消息，并保存 sessionId、model、cwd 和耗时

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

#### 场景：取消请求保留部分输出
- GIVEN assistant 已产生部分流式文本
- WHEN 用户取消当前请求
- THEN transcript 保留已生成文本，并把该 assistant 消息标记为 cancelled

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

### 需求：权限与用户提问通过 UI 闸门处理
系统 SHALL 在工具执行需要用户确认时展示权限请求，并将有效 `AskUserQuestion` 转为用户输入弹窗。

#### 场景：工具请求权限
- GIVEN SDK 请求执行未默认允许的工具
- WHEN 权限事件到达 UI
- THEN 系统暂停该工具决策，并展示允许或拒绝的用户操作入口

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=dialog[name="权限请求"]｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

#### 场景：Agent 提出选择题
- GIVEN SDK 产生包含至少两个选项的 AskUserQuestion
- WHEN 事件路由到 ChatPage
- THEN 系统展示用户输入弹窗，并把用户选择返回运行时

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=dialog[name="Agent 提问"]｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

### 需求：Generative UI 在沙箱中渲染
系统 SHALL 支持 `show-widget` Markdown fence，并在无网络和无表单能力的 sandbox iframe 中渲染交互组件。

#### 场景：assistant 输出 show-widget
- GIVEN assistant 消息包含合法 `show-widget` fence
- WHEN transcript 渲染该消息
- THEN 系统渲染沙箱组件，并允许组件通过受控消息触发后续用户输入

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: iframe[title="Generative UI"]｜验证方式: node test-results/full-acceptance-smoke.mjs｜证据: TESTING_CHECKLIST.md｜

#### 场景：非法 widget 输出
- GIVEN assistant 消息包含不合法或无法解析的 widget fence
- WHEN transcript 渲染该消息
- THEN 系统显示普通消息或错误态，不允许 widget 获得网络和表单能力

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

### 需求：聊天运行时接入项目 MCP 配置
系统 SHALL 在启动 Claude Agent SDK query 时读取当前项目 MCP server 配置，并把可用工具、连接状态和权限策略反馈到 Chat。

#### 场景：启动 query 时传入 MCP servers
- GIVEN 当前项目已保存至少一个启用的 MCP server
- WHEN 用户提交聊天并启动 Claude Agent SDK query
- THEN 主进程将项目级 `mcpServers` 传入 query options，并按 tool policy 构造 `allowedTools` 或拦截禁用工具

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：MCP server 连接失败
- GIVEN 当前项目配置的 MCP server 启动失败、认证缺失或 HTTP 401
- WHEN Chat 状态面板刷新运行时状态
- THEN UI 展示对应 server 的 failed 或 needs-auth 状态、脱敏错误摘要和进入 MCP 设置的修复入口

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

#### 场景：MCP 工具请求权限
- GIVEN Claude Agent SDK 请求调用 `mcp__server__tool` 且该工具策略为每次询问
- WHEN 权限事件到达 UI
- THEN 权限弹窗展示 server 名称、tool 名称、输入摘要和允许/拒绝操作，且不泄漏密钥或完整 header

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

#### 场景：Transcript 展示 MCP 工具调用
- GIVEN assistant 调用了名称为 `mcp__github__create_issue` 的工具
- WHEN transcript 渲染该工具事件
- THEN UI 以可读形式展示 `github · create_issue`，并在详情中保留完整工具名用于排查

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

### 需求：聊天运行时按全局搜索设置路由 WebSearch
系统 SHALL 在启动 Claude Agent SDK query 时读取全局搜索设置，并据此决定是否使用 Claude Code 原生 WebSearch 或 AgentOS `web_search` Provider。

#### 场景：使用原生 Web Search
- GIVEN 全局搜索设置选择原生 Web Search
- WHEN 用户提交一次可能触发联网搜索的 Agent 请求
- THEN 主进程不注册内部 `agentos-web` MCP server，不设置 `toolAliases.WebSearch`，也不把内置 `WebSearch` 加入禁用列表

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：使用 AgentOS 搜索 Provider
- GIVEN 全局搜索设置选择 AgentOS 搜索 Provider，并选择 DuckDuckGo Search、Brave Search 或 Tavily
- WHEN 用户提交一次可能触发联网搜索的 Agent 请求
- THEN 主进程注册内部 `agentos-web` MCP server，将 `toolAliases.WebSearch` 指向 `mcp__agentos-web__web_search`，并禁用内置 `WebSearch`

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：Provider 缺少凭据
- GIVEN 全局搜索设置选择 Brave Search 或 Tavily 但对应 API Key 未配置
- WHEN AgentOS `web_search` 被调用
- THEN 工具返回可读错误，并且日志和 transcript 不输出 API Key 或完整 header 明文

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: provider smoke + npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：DuckDuckGo HTML 网页搜索
- GIVEN 全局搜索设置选择 AgentOS 搜索 Provider 且 Provider 为 DuckDuckGo Search
- WHEN `web_search` 查询一个普通网页搜索词
- THEN 工具读取 DuckDuckGo HTML 搜索结果，返回合法 JSON 输出，包含 Provider 信息和归一化后的 title、url、snippet、source；若 HTML 搜索无结果、触发拦截或网络不可达则返回空 `results` 数组，不把整个工具调用标记为错误，也不伪造搜索结果

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: provider smoke + npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：Tavily 请求映射
- GIVEN 全局搜索设置选择 AgentOS 搜索 Provider 且 Provider 为 Tavily，并配置有效或可解析的 Tavily API Key
- WHEN `web_search` 携带 query、max_results、allowed_domains 和 freshness 调用
- THEN 主进程向 Tavily `/search` 发起 POST 请求，传入 Bearer 认证、`max_results`、include/exclude domains 和 time_range 映射，并将结果归一化为 title、url、snippet、source 和 publishedAt

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：Provider HTTP 错误脱敏返回
- GIVEN Brave 或 Tavily Provider 返回认证、套餐、配额或其它 HTTP 错误
- WHEN AgentOS `web_search` 被调用
- THEN 工具返回可读错误文本，日志只记录 provider、queryLength 和脱敏错误摘要，不输出 API Key、Bearer token 或完整 header

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: provider smoke｜证据: TESTING_CHECKLIST.md｜

#### 场景：API Key 池按顺序轮询
- GIVEN 全局搜索设置选择 AgentOS 搜索 Provider 且 Provider 为 Brave Search 或 Tavily，并配置多个 API Key 或 `${ENV_NAME}` 引用
- WHEN 当前优先级最高的 Key 返回认证失败、配额/套餐限制、429、网络超时或服务错误，且后续 Key 可用
- THEN `web_search` 使用同一次请求参数按顺序尝试下一个 Key，最终返回成功 Key 的归一化搜索结果；日志只记录 provider、keyIndex、errorKind、queryLength 和耗时，不输出任何 API Key 或完整 header

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: unit/integration: node --test electron/claude-agent-runner-web-search.test.mjs + npm run test:electron｜证据: test-results/verification-summary.md｜

#### 场景：API Key 池全部失败时脱敏汇总
- GIVEN Brave Search 或 Tavily 的 API Key 池中所有已解析 Key 都不可用，或所有 `${ENV_NAME}` 引用均未解析
- WHEN AgentOS `web_search` 被调用
- THEN 工具返回可读的聚合失败摘要，说明失败数量和主要错误类型，并给出恢复建议；日志和 transcript 不输出 API Key、Bearer token、完整 header 或完整请求体

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: unit/integration: node --test electron/claude-agent-runner-web-search.test.mjs + npm run test:electron｜证据: test-results/verification-summary.md｜

### 需求：开发者通过全局通道启动独立 Agent 线程

系统 SHALL 提供无 UI 的全局 Agent 指令通道。开发者在配置阶段绑定一个项目；调用方只传完整指令和可选导航策略。每次调用 MUST 创建新的普通线程、立即提交指令，并返回该线程 ID。

#### 场景：留在当前页面启动新线程

- GIVEN 通道已绑定项目，当前页面或当前聊天中存在未提交草稿
- WHEN 任意应用模块发送非空完整指令并选择 `stay`
- THEN 系统在绑定项目中创建新的可见线程并立即启动 Chat Run，返回新 `threadId`，且当前路由、活动线程和 Composer 草稿保持不变

#### 场景：创建后打开新线程

- GIVEN 通道已绑定项目
- WHEN 任意应用模块发送非空完整指令并选择 `open`
- THEN 系统创建并提交新线程后选择该线程，用户可立即查看指令和运行过程

#### 场景：通道发布线程运行终态

- GIVEN 指令通道已经创建并提交一个线程
- WHEN Chat Run 进入运行、等待权限、等待回答、成功、失败或取消状态
- THEN 通道只向该线程对应的订阅者发布 `running`、`waiting`、`asking`、`succeeded`、`failed` 或 `cancelled`，且终态不被迟到的非终态事件覆盖

#### 场景：空指令或提交失败

- GIVEN 通道已配置
- WHEN 调用方发送空白指令，或新线程无法提交到 Chat Run
- THEN 空白指令不创建线程；提交失败保留已经创建的可见线程用于排查，并向调用方抛出可读错误及发布 `failed` 状态

## 平台专项验证（Electron + React）

- 验证主进程事件只能影响归属线程。
- 验证权限响应和 AskUserQuestion 不泄漏到其它线程。
- 验证附件和模型图片能力联动。
- 验证 MCP server 状态、tool policy 和权限响应只作用于当前项目/线程；日志和 UI 摘要不得输出 MCP token、header 或连接串明文。
- 验证全局搜索设置变化会进入 runtime config signature，使下一轮 Agent 请求按最新搜索路由创建 SDK session；Provider Key 不进入日志明文。

## 建议验证命令

```bash
npm run typecheck
node --test electron/chat-run.test.mjs electron/claude-sdk-message-router.test.mjs
```
