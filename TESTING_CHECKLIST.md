# AgentOS 搜索验收清单

最后更新：2026-06-24
主框架：Electron + React + Vite
验证类别：正式验收（project-verify）
验证范围：搜索相关场景：

- `prd/chat-agent-runtime/acceptance.md`：聊天运行时按全局搜索设置路由 WebSearch（6 个场景）
- `prd/desktop-shell-settings-release/acceptance.md`：全局设置提供搜索路由配置（6 个场景）

## 结论

| 状态 | 数量 | 说明 |
| --- | --- | --- |
| ✅ 通过 | 12 | 搜索 runtime 6 个场景 + 搜索设置页 6 个场景 |
| ❌ 失败 | 0 | 无 |
| ⚠️ 跳过 | 0 | 场景级无跳过 |
| 阻塞 | 0 | 无 |

## 命令证据

| 命令 / smoke | 结果 | 摘要 |
| --- | --- | --- |
| `npm run typecheck` | ✅ | TypeScript 检查通过 |
| `npm run test:electron` | ✅ | Electron 测试通过；覆盖搜索设置存储、Provider、runtime native/AgentOS 路由和 desktop seam |
| `curl -s -I http://localhost:5173/` | ✅ | Vite dev server 返回 HTTP 200 |
| Chrome CDP browser smoke | ✅ | 打开 `#settings/search`，默认原生 + DuckDuckGo；切 AgentOS + Tavily；保存 `${TAVILY_API_KEY}`；缺 bridge 时展示接口不可用；不暴露 `window.ipcRenderer` |
| Provider smoke | ✅ | Tavily 缺凭据返回可读状态；DuckDuckGo Instant Answer + HTML 均空时返回空 `results`；Tavily HTTP 432 错误不泄漏 API key |

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
    "provider": "duckduckgo-instant",
    "resultCount": 0
  },
  "tavilyHttpError": {
    "errorIncludesStatus": true,
    "keyLeaked": false
  }
}
```

## 场景映射

| 模块/场景 | 证据类型 | 结果 |
| --- | --- | --- |
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
