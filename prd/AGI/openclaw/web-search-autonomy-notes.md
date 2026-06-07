# OpenClaw web_search autonomy notes

本文是基于当前本地 checkout 的代码阅读笔记，重点回答两个问题：

- OpenClaw 的 `web_search` 是怎么做的。
- 什么情况下会“自主”发起 web search。

结论先说清楚：OpenClaw 里没有看到一个独立的规则引擎在用户说
`latest`、`today`、`current` 时直接替模型发起搜索。常规路径是把
`web_search` 作为工具暴露给模型，模型根据任务和工具描述自主决定是否调用。
另外有两条 provider-native 路径会把 OpenAI/Codex 的原生 `type: "web_search"`
注入到模型请求里，这时也是 provider/model 在请求内部决定何时使用搜索。

## 三种搜索路径

| 路径 | 谁发起实际搜索 | OpenClaw 做什么 | 典型入口 |
| --- | --- | --- | --- |
| Managed `web_search` | 模型先发起 `web_search` 工具调用，OpenClaw 再执行 provider HTTP 搜索 | 暴露普通函数工具，选择 provider，执行 provider `createTool().execute()`，返回标准化结果 | `src/agents/tools/web-search.ts:72` |
| Native OpenAI web search | OpenAI Responses 模型在原生工具 surface 内决定 | 对原生 OpenAI Responses 流量移除 managed function tool，注入 `{ type: "web_search" }` | `extensions/openai/native-web-search.ts:65` |
| Native Codex web search | Codex-capable Responses 模型在原生工具 surface 内决定 | 满足配置和模型条件时隐藏 managed `web_search`，再向 payload 注入 Codex native `web_search` | `src/agents/codex-native-web-search-core.ts:79` |

## Managed web_search 的工作流

1. 工具创建。

   `createWebSearchTool()` 在 `tools.web.search.enabled === false` 时返回 `null`，
   否则返回名为 `web_search` 的工具。模型侧 schema 要求 `query`，可选
   `count`、`country`、`language`、`freshness`、日期范围、Brave locale、Perplexity
   domain/token 参数。见 `src/agents/tools/web-search.ts:9` 和
   `src/agents/tools/web-search.ts:67`。

2. 工具暴露。

   `createOpenClawTools()` 会创建 managed `web_search`，并传入当前 config、
   agentDir、sandbox 状态和 runtime web search metadata。见
   `src/agents/openclaw-tools.ts:290`。

   `createOpenClawCodingTools()` 再把 OpenClaw tools 放进最终工具列表，经过
   message-provider policy、model-provider policy、tool allow/deny policy、schema
   normalization、tool hooks 和 abort wrapper 后返回给模型。见
   `src/agents/agent-tools.ts:892`、`src/agents/agent-tools.ts:1014` 和
   `src/agents/agent-tools.ts:1028`。

3. 模型提示。

   system prompt 的工具摘要只给了 provider-neutral 描述：
   `web_search: "Search the web using the configured provider"`。见
   `src/agents/system-prompt.ts:746`。这也是“模型什么时候自己搜”的主要信号：
   工具可见时，模型自己决定是否调用。

4. 执行。

   当模型真的发出 `web_search` tool call 后，`execute` 会 late-bind runtime config，
   再调用 `runWebSearch()`。执行结果会附上实际 provider id。见
   `src/agents/tools/web-search.ts:88`。

## Provider 选择与 fallback

`runWebSearch()` 负责 provider 解析和执行，核心点如下：

- `tools.web.search.enabled` 默认等价于启用；只有显式 `enabled: false` 才禁用。
  见 `src/web-search/runtime.ts:69`。
- 如果 `tools.web.search.provider` 有值，OpenClaw 尝试匹配这个 provider id。
  显式 provider 会限制 plugin 加载范围，避免无关 provider 热路径加载。见
  `src/web-search/runtime.ts:203` 和 `src/web-search/runtime.ts:252`。
- 如果没有 provider，OpenClaw 按 `autoDetectOrder` 排序，然后优先找有凭据的
  API provider。凭据来源包括 plugin config、fallback config、env var、以及
  provider auth profile。见 `src/web-search/runtime.ts:82` 和
  `src/web-search/runtime.ts:153`。
- 如果没有可用凭据，会记录第一个 keyless provider 作为 fallback。见
  `src/web-search/runtime.ts:177`。
- 执行时会构造候选 provider 列表。未显式选择 provider 时允许 fallback；显式选择
  provider 或 runtime configured provider 时不 fallback。见
  `src/web-search/runtime.ts:384` 和 `src/web-search/runtime.ts:424`。
- 自动选择路径下，provider 抛错或返回 `missing_*_api_key` 结构化错误时会尝试下一个
  candidate；普通 validation error 不会被当作 provider 不可用。见
  `src/web-search/runtime.ts:416` 和 `src/web-search/runtime.ts:449`。

当前 docs 记录的 auto-detect 顺序是：

1. Brave, order 10
2. MiniMax Search, order 15
3. Gemini, order 20
4. Grok, order 30
5. Kimi, order 40
6. Perplexity, order 50
7. Firecrawl, order 60
8. Exa, order 65
9. Tavily, order 70
10. DuckDuckGo, order 100
11. Ollama Web Search, order 110
12. SearXNG, order 200

来源：`docs/tools/web.md:168`。

## API key 与无 key 搜索

多数搜索 provider 需要 API key 或账号凭据。Brave、Tavily、Exa、Firecrawl、
Perplexity、Gemini、Grok、Kimi、MiniMax 这类 provider 通常会从
`plugins.entries.<plugin>.config.webSearch.*`、环境变量、fallback model config、
或 auth profile 里取凭据。runtime 的 credential 判断会检查这些来源；如果 provider
声明 `requiresCredential !== false` 且找不到可用凭据，该 provider 就不会成为
auto-detect 的首选。见 `src/web/provider-runtime-shared.ts:31` 和
`src/web-search/runtime.ts:82`。

没有 API key 时，OpenClaw 仍可能搜索，靠的是 keyless/self-hosted 路径：

- **DuckDuckGo**：声明 `requiresCredential: false`，没有 env var，也没有 credential
  path；提示是 “Free web search fallback with no API key required”。见
  `extensions/duckduckgo/src/ddg-search-provider.shared.ts:5`。
- **SearXNG**：不需要商业 API key，但需要一个 SearXNG base URL。它把
  `plugins.entries.searxng.config.webSearch.baseUrl` / `SEARXNG_BASE_URL` 当作
  credential-like 配置，因为没有实例地址就无法调用。见
  `extensions/searxng/src/searxng-search-provider.ts:7` 和
  `extensions/searxng/src/searxng-search-provider.ts:41`。
- **Ollama Web Search**：可以走本地 Ollama web-search proxy 或 hosted Ollama。
  本地路径可能依赖本地 Ollama 登录状态；hosted `https://ollama.com` 路径可用
  `OLLAMA_API_KEY`。见 `extensions/ollama/src/web-search-provider.ts:33` 和
  `extensions/ollama/src/web-search-provider.ts:101`。

auto-detect 的行为是：先按顺序找有凭据的 API-backed provider；如果都没有，会记住
第一个 `requiresCredential: false` 的 keyless provider 作为 fallback。见
`src/web-search/runtime.ts:177`。因此，在默认 bundled provider 可用且没有 API key
的情况下，最常见的搜索路径是 DuckDuckGo fallback；如果连 keyless provider 也不可用，
`runWebSearch()` 会报 `web_search is disabled or no provider is available.` 或后续
provider-specific 错误。见 `src/web-search/runtime.ts:437`。

这和 `web_fetch` 不同：`web_fetch` 默认不需要任何搜索 API key，它是普通 HTTP GET
加可读内容提取。它只在 Readability 失败且配置了 Firecrawl fallback 时才会调用
Firecrawl API。见 `docs/tools/web-fetch.md:11` 和 `docs/tools/web-fetch.md:47`。

## “自主发起 websearch”的条件

### 1. Managed web_search

Managed `web_search` 的自主性来自模型 tool choice，不是 OpenClaw 运行时的硬编码判断。
需要同时满足：

- `tools.web.search.enabled` 没有设为 `false`。
- `web_search` 被工具构造计划包含。它是 `createOpenClawTools()` 直接产出的
  OpenClaw tool 名称之一，见
  `src/agents/embedded-agent-runner/run/attempt-tool-construction-plan.ts:16`。
- 最终工具政策没有把它过滤掉。`coding` profile 包含 `web_search`、`web_fetch`、
  `x_search`，见 `src/agents/tool-catalog.ts:104`。
- 当前 model-provider policy 没有因为 Codex native search active 而移除 managed
  `web_search`，见 `src/agents/agent-tools.ts:230`。
- 模型在本轮请求里实际选择调用 `web_search`。

也就是说，用户问“今天的天气”“最新版本”“最近新闻”这类需要实时信息的问题时，
模型可能会调用 `web_search`，但触发点是模型根据上下文和工具说明做出的 tool call，
不是 OpenClaw 在进入模型前先做关键词匹配。

### 2. Native OpenAI web search

OpenAI plugin 会在更早的 provider wrapper 层处理 native search。
它的启用条件是：

- `tools.web.search.enabled !== false`。
- `tools.web.search.provider` 未设置，或为空、`auto`、`openai`。
- 当前模型是 `api: "openai-responses"` 且 provider 规范化后是 `openai`。
- baseUrl 为空或是 OpenAI 官方 API base URL；OpenAI-compatible proxy 和 Azure 路由不走这条路径。

实现见 `extensions/openai/native-web-search.ts:16`、
`extensions/openai/native-web-search.ts:29` 和
`extensions/openai/native-web-search.ts:38`。

当启用时，wrapper 会：

- 从 payload tools 中移除 managed function 形式的 `web_search`。
- 如果没有 native `type: "web_search"`，追加一个 native tool。
- 如果 reasoning effort 是 `minimal`，提升到 `low`。

见 `extensions/openai/native-web-search.ts:53` 和
`extensions/openai/native-web-search.ts:65`。

这条路径看起来像“自动搜索”，但准确说是 OpenClaw 自动把原生搜索能力放进请求；
是否使用仍由 OpenAI Responses 模型决定。

### 3. Native Codex web search

Codex native search 是显式配置项，不是默认开启。配置读取见
`src/agents/codex-native-web-search.shared.ts:54`：

- `tools.web.search.openaiCodex.enabled === true` 才启用。
- `mode` 默认为 `cached`，只有显式 `live` 才会设置 `external_web_access: true`。
- 可选 `allowedDomains`、`contextSize`、`userLocation`。

activation 条件见 `src/agents/codex-native-web-search-core.ts:79`：

- 全局 web search 没有禁用。
- `openaiCodex.enabled` 为 true。
- 当前模型符合 `modelProvider === "openai-codex"` 或
  `modelApi === "openai-codex-responses"`。
- 如果是 direct `openai-codex` provider，还需要可用的 OpenAI Codex auth profile；
  `api: "openai-codex-responses"` 的兼容 provider 不要求单独 Codex auth。

active 后，`shouldSuppressManagedWebSearchTool()` 返回 true，agent tool policy 会移除
managed `web_search`。见 `src/agents/codex-native-web-search-core.ts:196` 和
`src/agents/agent-tools.ts:251`。

payload 注入发生在 OpenAI stream wrapper 的 Codex native search wrapper 中：

- code mode 已经拥有模型 tool surface 且可见 `exec`/`wait` 时跳过 native search。
- activation 为 `native_active` 时，对 payload 调用 `patchCodexNativeWebSearchPayload()`。
- patch 会追加 `{ type: "web_search", external_web_access: mode === "live" }`，并带上
  allowed domains、context size、user location 等配置。

见 `src/llm/providers/stream-wrappers/openai.ts:592`、
`src/llm/providers/stream-wrappers/openai.ts:627`、
`src/llm/providers/stream-wrappers/openai.ts:651` 和
`src/agents/codex-native-web-search-core.ts:148`。

## 不会自主搜索的情况

- `tools.web.search.enabled: false`。这会关闭 managed search，也会阻止 native OpenAI
  和 native Codex search。见 `docs/tools/web.md:119` 和 `docs/tools/web.md:129`。
- 工具 policy/allowlist 没有放行 `web_search`、`group:web` 或相关 profile。
- Managed `web_search` 被 Codex native active 状态替换掉。
- OpenAI Responses 请求走的是非 OpenAI 官方 baseUrl、Azure、或非 `openai-responses`
  API；这时 native OpenAI wrapper 不注入。
- Codex native search 未显式开启、模型不 eligible、direct Codex auth 缺失，或 code mode
  已经接管 tool surface。
- provider 显式配置但不可用时，runtime 不会静默换 provider；会抛出对应错误。

## 相关测试证据

- `src/agents/tools/web-search.test.ts`：验证 tool schema、`query` 必填、`count` 上限、
  filter normalization。
- `src/web-search/runtime.test.ts`：覆盖 provider auto-detect、auth profile、runtime
  selected provider、keyless fallback、显式 provider 不 fallback、不可用 provider 错误。
- `src/agents/codex-native-web-search.test.ts`：覆盖 Codex native activation、auth 条件、
  payload 注入、duplicate native tool 避免、managed tool suppression。
- `extensions/openai/openai-provider.test.ts`：覆盖 OpenAI native search 替换 managed
  `web_search`、disabled/proxied 不注入、配置其他 provider 时保留 managed search。
- `src/agents/agent-tools.model-provider-collision.test.ts`：覆盖 xAI/native search 兼容时
  managed `web_search` 的保留或移除边界。

## 维护观察

- Provider auto-detect 是“自动选择搜索 provider”，不是“自动决定要不要搜索”。
- Native OpenAI/Codex search 是“自动注入 provider-native 搜索工具”，不是 OpenClaw 自己
  先发 HTTP search。
- `web_search` 和默认 `web_fetch` 不是 Playwright/browser automation；需要执行 JS、
  登录态、点击、截图或交互时才应走单独的 `browser` tool。见
  `docs/tools/web-fetch.md:15` 和 `docs/tools/browser.md:11`。
- 如果要改变“遇到最新信息时必须搜索”的行为，应改 prompt/tool policy 或增加显式
  decision layer；当前代码证据显示常规路径依赖模型 tool choice。
