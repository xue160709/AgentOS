# AgentOS 搜索与 MCP 验收清单

最后更新：2026-06-24
主框架：Electron + React + Vite
验证类别：正式验收（project-verify）
验证范围：

- `prd/chat-agent-runtime/acceptance.md`：聊天运行时按全局搜索设置路由 WebSearch（6 个场景）
- `prd/desktop-shell-settings-release/acceptance.md`：全局设置提供搜索路由配置（6 个场景）
- `prd/agent-mode/acceptance.md`：项目 Agent 设置提供 MCP 配置面板（5 个场景）
- `prd/chat-agent-runtime/acceptance.md`：聊天运行时接入项目 MCP 配置（4 个场景）
- `prd/desktop-shell-settings-release/acceptance.md`：设置导航提供 MCP 入口与恢复路径（2 个场景）
- `prd/model-settings/acceptance.md`：模型设置页与 MCP 设置保持边界（4 个场景）

## 结论

| 状态 | 数量 | 说明 |
| --- | --- | --- |
| ✅ 通过 | 27 | 搜索 12 个场景 + MCP 15 个场景 |
| ❌ 失败 | 0 | 无 |
| ⚠️ 跳过 | 0 | 场景级无跳过 |
| 阻塞 | 0 | 无 |

## 命令证据

| 命令 / smoke | 结果 | 摘要 |
| --- | --- | --- |
| `npm run typecheck` | ✅ | TypeScript 检查通过 |
| `npm run test:electron` | ✅ | 69/69 通过；覆盖 MCP settings store、runtime query options、tool name 展示、搜索设置存储、Provider、runtime native/AgentOS 路由和 desktop seam |
| `npm run build` | ✅ | Vite renderer、Electron main/preload 和 electron-builder 打包通过 |
| `curl -s -I http://localhost:5173/` | ✅ | Vite dev server 返回 HTTP 200 |
| Chrome CDP browser smoke | ✅ | 打开 `#settings/search`，默认原生 + DuckDuckGo；切 AgentOS + Tavily；保存 `${TAVILY_API_KEY}`；缺 bridge 时展示接口不可用；不暴露 `window.ipcRenderer` |
| Provider smoke | ✅ | Tavily 缺凭据返回可读状态；DuckDuckGo HTML 搜索失败时返回空 `results`；Tavily HTTP 432 错误不泄漏 API key |
| MCP selector audit | ✅ | 代码中存在 MCP 全局设置、项目设置、状态面板、权限/Transcript、空态、恢复提示、风险标注和 session 生效提示 selector |

## Browser Smoke 关键断言

```json
{
  "initial": {
    "hasPage": true,
    "hasModeGroup": true,
    "hasProviderGroup": true,
    "nativeChecked": true,
    "duckChecked": true,
    "tavilyDisabledBeforeAgentOs": true,
    "ipcRendererExposed": false
  },
  "saved": {
    "mode": "agentos",
    "provider": "tavily",
    "maxResults": 7,
    "tavilyApiKey": "${TAVILY_API_KEY}",
    "leakedTavilyKey": false
  },
  "bridgeUnavailable": {
    "hasPage": true,
    "unavailableMessageShown": true,
    "ipcRendererExposed": false
  }
}
```

## Provider Smoke 关键断言

```json
{
  "missingTavily": {
    "id": "tavily",
    "available": false,
    "reason": "TAVILY_API_KEY is not configured."
  },
  "duckDuckGoEmpty": {
    "provider": "duckduckgo",
    "resultCount": 0
  },
  "tavilyHttpError": {
    "errorIncludesStatus": true,
    "keyLeaked": false
  }
}
```

## MCP Selector 关键断言

```json
{
  "globalSettings": {
    "page": "[data-testid=\"global-mcp-settings-page\"]",
    "list": "[data-testid=\"global-mcp-server-list\"]",
    "add": "[data-testid=\"global-mcp-add-server\"]",
    "editor": "[data-testid=\"global-mcp-server-editor\"]",
    "serverInfo": "[data-testid=\"mcp-server-info-detail\"]",
    "envStatus": "[data-testid=\"mcp-env-resolution-error\"]",
    "noProject": "[data-testid=\"mcp-settings-no-project-empty\"]"
  },
  "projectSettings": {
    "tab": "[data-testid=\"agent-settings-mcp-tab\"]",
    "servers": "[data-testid=\"mcp-installed-server-list\"]",
    "discoveredTools": "[data-testid=\"mcp-discovered-tool-policy-list\"]",
    "manualPolicies": "[data-testid=\"mcp-tool-policy-list\"]",
    "risk": "[data-testid=\"mcp-tool-risk-annotation\"]",
    "policySource": "[data-testid=\"mcp-policy-source-hint\"]",
    "sessionHint": "[data-testid=\"mcp-session-effect-hint\"]"
  },
  "chatRuntime": {
    "statusPanel": "[data-testid=\"agent-status-mcp-list\"]",
    "openSettings": "[data-testid=\"agent-status-open-mcp-settings\"]",
    "transcriptTool": "[data-testid=\"transcript-mcp-tool-call\"]"
  }
}
```

## 场景映射

| 模块/场景 | 证据类型 | 结果 |
| --- | --- | --- |
| `agent-mode` / 项目独立启用或关闭全局 MCP server | unit/integration + selector audit | ✅ |
| `agent-mode` / 展示已配置服务状态与启用开关 | unit/integration + selector audit | ✅ |
| `agent-mode` / 全局关闭后项目隐藏 MCP server | unit/integration + selector audit | ✅ |
| `agent-mode` / 环境变量未解析 | selector audit + build | ✅ |
| `agent-mode` / 配置工具权限策略 | unit/integration + selector audit | ✅ |
| `chat-agent-runtime` / 启动 query 时传入 MCP servers | unit/integration | ✅ |
| `chat-agent-runtime` / MCP server 连接失败 | selector audit + unit/integration | ✅ |
| `chat-agent-runtime` / MCP 工具请求权限 | unit/integration + selector audit | ✅ |
| `chat-agent-runtime` / Transcript 展示 MCP 工具调用 | unit/integration + selector audit | ✅ |
| `desktop-shell-settings-release` / 从 Chat 状态面板进入当前项目 MCP 设置 | selector audit + build | ✅ |
| `desktop-shell-settings-release` / 无活动项目时进入 MCP 设置 | selector audit + build | ✅ |
| `model-settings` / 模型设置页不出现 MCP server 编辑字段 | build + selector audit | ✅ |
| `model-settings` / 全局设置侧栏进入 MCP Tab | selector audit + build | ✅ |
| `model-settings` / 添加全局 MCP server | selector audit + build | ✅ |
| `model-settings` / 保存并测试全局 MCP server | unit/integration + selector audit | ✅ |
| `chat-agent-runtime` / 使用原生 Web Search | unit/integration | ✅ |
| `chat-agent-runtime` / 使用 AgentOS 搜索 Provider | unit/integration | ✅ |
| `chat-agent-runtime` / Provider 缺少凭据 | provider smoke | ✅ |
| `chat-agent-runtime` / DuckDuckGo 普通网页搜索回退 | provider smoke + unit/integration | ✅ |
| `chat-agent-runtime` / Tavily 请求映射 | unit/integration | ✅ |
| `chat-agent-runtime` / Provider HTTP 错误脱敏返回 | provider smoke | ✅ |
| `desktop-shell-settings-release` / 打开全局搜索设置 | browser smoke | ✅ |
| `desktop-shell-settings-release` / 配置 AgentOS 搜索 Provider | browser smoke | ✅ |
| `desktop-shell-settings-release` / 保存搜索设置 | browser smoke | ✅ |
| `desktop-shell-settings-release` / 重新加载搜索设置 | unit/integration | ✅ |
| `desktop-shell-settings-release` / 搜索设置 bridge 不可用 | browser smoke | ✅ |
| `desktop-shell-settings-release` / Provider Key 使用环境变量引用 | browser smoke + unit/integration | ✅ |

## 未覆盖项

- 真实 Brave/Tavily 外网成功搜索未作为本轮通过条件；请求映射、缺凭据和 HTTP 错误脱敏使用本地 mock 验证。
- Chrome CDP smoke 尚未沉淀为仓库内 Playwright/node:test 自动回归。
- MCP 设置页本轮使用 selector audit + typecheck/build + Electron runtime/store 单测验收，尚未沉淀为端到端点击式 Playwright 自动回归。
