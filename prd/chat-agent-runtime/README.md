# 聊天与 Agent 运行时

## Revision 2（Accepted / Planned，未实现）

下一轮开发把当前应用内 Agent 指令通道扩展为 Main-owned 项目 Chat 事实源，并新增两个入口：每项目唯一的独立 Chat 窗口，以及经用户配对授权的网站任务。

- 主窗口、独立窗口、应用内指令和网站任务复用现有普通项目线程、Transcript 与 Claude Agent SDK，不建立第二套 Chatbot 或任务历史。
- 一个 HTTPS Origin 最多绑定一个项目；授权网站可用 `agentos://v1` 唤醒 AgentOS，再由固定 HTTPS 一次性 Ticket 新建普通线程。
- 网站只收到 `accepted/rejected`，不能读取线程 ID、进度、Transcript、Diff、权限、提问或最终结果。
- 同一 thread 只允许一个 active run；不同 thread 可并行。Main 是 thread/run/session/diff/revision 唯一 writer，窗口只是 snapshot 投影。
- v1 权限模式保持当前 app-global 语义，由 Main 持久化和同步；每次 submit 捕获当时值，网站不能选择或提升权限。
- 发生可靠 Agent mutation 时进入共享实时预览；所有 potential write run 终态且源码稳定后，静态项目自动生成一次已保存预览。失败/取消不自动保存半成品。

完整已确认方案见 [`../../changes/active/chg-20260818-agent-command-channel/design.md`](../../changes/active/chg-20260818-agent-command-channel/design.md)，技术与网站协议见同 Change 的 `technical.md` / `protocol-v1.md`。本节描述计划状态，下面“当前已实现”仍是 as-built 事实。

## 模块定位

聊天与 Agent 运行时模块负责把用户输入、附件、模型选择、权限模式和项目上下文转成 Claude Agent SDK 请求，并把流式事件渲染为可追踪的对话时间线。

## 当前已实现

- Composer 支持文本、附件、slash command、`@` 文件搜索、子 Agent 联想和 macOS 语音输入。
- 提交聊天时会绑定线程、项目 cwd、权限模式、模型选择、sessionId 和必要上下文。
- 主进程通过 Claude Agent SDK 驱动运行，转发 assistant、thinking、tool、activity、result、error、cancelled 等事件。
- UI 可以展示权限请求、Agent 提问弹窗、工具过程、thinking、文件 diff、上下文压缩边界和运行耗时。
- 切换线程模型时支持清空旧 session，并用简短 handoff context 交接历史。
- 运行时接入项目级 MCP server 配置、tool policy、状态探测和 `mcp__server__tool` 友好展示。
- 全局搜索设置可决定 Claude Agent 使用原生 Web Search，或将 `WebSearch` 路由到 AgentOS 内部 `web_search` Provider；当前 Provider 包含 DuckDuckGo HTML Search、Brave Search 和 Tavily，并支持 Provider 连接测试、API Key 池顺序轮询与可恢复错误分类。
- 支持 `show-widget` 形式的 Generative UI 沙箱渲染。

## 用户流程

```text
1. 用户在 Composer 输入文本或添加附件
   ↓
2. UI 创建或复用项目线程并提交运行载荷
   ↓
3. 主进程启动 Claude Agent SDK 查询
   ↓
4. UI 按事件流更新 transcript、权限弹窗和运行状态
   ↓
5. 线程保存 sessionId、模型和最终消息
```

## 还没做什么

- Revision 2 的 Main broker、独立项目 Chat 窗口、Website Binding、deep link/Ticket 和 Runtime edit settle 均尚未实现；执行顺序已拆为 Change package 的 Terra work orders。
- 聊天运行时 acceptance 已完成正式验收状态同步；流式、取消、权限、Generative UI、MCP 与 WebSearch 核心路径均已有单测、source audit、selector audit 或 smoke 证据。
- 端到端 UI 流式走查、权限弹窗、Composer 语音交互和 Generative UI 截图证据仍需沉淀为全页面点击式 E2E 脚本。
- WebSearch 的真实 Provider 可用性仍受第三方网络、额度和 bot challenge 影响；API Key 池用于在 Brave/Tavily 单个 Key 认证、配额、网络或服务失败时按顺序尝试后续 Key，真实外网成功搜索可作为 live smoke 后续补充。

## 关键决策

- Chat Run seam 负责事件折叠和竞态处理，React 页面和 Electron transport 不拥有这些规则。
- 主进程日志使用脱敏摘要，不输出 API Key、Token 或用户隐私原文。
- MCP 运行时应优先复用 Claude Agent SDK 的 `mcpServers`、`mcpServerStatus()` 和现有权限闸门，不在 AgentOS 中重新实现 MCP JSON-RPC 客户端。
- WebSearch 默认可保留 Claude Code 原生能力；只有用户在全局设置切到 AgentOS Provider 时才注册内部 `agentos-web` 并 alias `WebSearch`。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `workspace-session`：提供线程生命周期和当前活动线程。
- `model-settings`：解析 provider/model 与图片能力。
- `file-context`：提供附件、预览和 `@` 搜索。
- `agent-mode`：提供项目指令、记忆、TODO 上下文、项目级 MCP server 开关覆盖与 tool policy。
- `desktop-shell-settings-release`：提供全局搜索设置页、preload/IPC seam 和 Provider Key 持久化。
