# 聊天与 Agent 运行时

## 模块定位

聊天与 Agent 运行时模块负责把用户输入、附件、模型选择、权限模式和项目上下文转成 Claude Agent SDK 请求，并把流式事件渲染为可追踪的对话时间线。

## 当前已实现

- Composer 支持文本、附件、slash command、`@` 文件搜索、子 Agent 联想和 macOS 语音输入。
- 提交聊天时会绑定线程、项目 cwd、权限模式、模型选择、sessionId 和必要上下文。
- 主进程通过 Claude Agent SDK 驱动运行，转发 assistant、thinking、tool、activity、result、error、cancelled 等事件。
- UI 可以展示权限请求、Agent 提问弹窗、工具过程、thinking、文件 diff、上下文压缩边界和运行耗时。
- 切换线程模型时支持清空旧 session，并用简短 handoff context 交接历史。
- 运行时接入项目级 MCP server 配置、tool policy、状态探测和 `mcp__server__tool` 友好展示。
- 全局搜索设置可决定 Claude Agent 使用原生 Web Search，或将 `WebSearch` 路由到 AgentOS 内部 `web_search` Provider；当前 Provider 包含 DuckDuckGo HTML Search、Brave Search 和 Tavily，并支持 Provider 连接测试与可恢复错误分类。
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

- 主流程已有单元测试；WebSearch 相关运行时与搜索设置场景已完成正式验收状态戳。
- 端到端 UI 流式走查、权限弹窗和 Generative UI 截图证据仍需补齐。
- WebSearch 的真实 Provider 可用性仍受第三方网络、额度和 bot challenge 影响；后续新增 Provider 时需要补对应 smoke 与回归场景。

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
