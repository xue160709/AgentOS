# Hermes Web Search 行为说明

本文梳理 Hermes Agent 当前代码中 `web_search` 的暴露、后端选择、执行链路，以及“什么时候会自主发起 websearch”。结论基于本仓库源码，不包含外部产品文档。

## 结论摘要

Hermes 没有一个 Python 规则引擎在收到用户消息后直接判断“该搜索了”并强制调用 `web_search`。自主 websearch 主要来自三件事叠加：

1. 会话把 `web_search` 的 tool schema 暴露给模型。
2. system prompt 明确要求模型在当前事实类问题上使用工具，尤其是 `web_search`。
3. 模型在下一轮 API 响应中主动返回 `tool_calls`，Hermes 再负责校验、分发并把结果追加回对话。

也就是说，“自主发起”发生在模型侧；Hermes 代码侧负责让搜索工具可见、把提示词写清楚、执行工具调用，并在工具不可用时尽量不让模型看见它。

## 工具是如何暴露给模型的

默认配置中 `toolsets` 是 `["hermes-cli"]`，见 `hermes_cli/config.py:581-587`。`hermes-cli` toolset 使用 `_HERMES_CORE_TOOLS`，其中直接包含 `web_search` 和 `web_extract`，见 `toolsets.py:31-34`、`toolsets.py:393-396`。

实际暴露前还会经过平台工具集解析和可用性过滤：

- CLI 没有显式传 `--toolsets` 时，会通过 `_get_platform_tools(CLI_CONFIG, "cli")` 解析平台默认工具集，见 `cli.py:14865-14882`。
- `_get_platform_tools()` 会把平台默认 composite toolset 反推成可配置 toolset，并去掉默认关闭的集合，见 `hermes_cli/tools_config.py:1114-1241`。
- `AIAgent` 初始化时调用 `get_tool_definitions()`，并保存 `agent.tools` 与 `agent.valid_tool_names`，见 `agent/agent_init.py:909-920`。
- `get_tool_definitions()` 最后调用 `registry.get_definitions()`，只有 `check_fn()` 通过的工具才进入 schema，见 `model_tools.py:391-398` 和 `tools/registry.py:337-383`。

`web_search` 和 `web_extract` 的注册在 `tools/web_tools.py:1540-1560`。二者共用 `check_web_api_key()` 作为门禁。这个门禁要求当前至少有可用 web 后端，见 `tools/web_tools.py:1367-1375`。

## 后端与 provider 注册

Hermes 的 web 后端是插件式的。`model_tools.py` 导入时会触发 built-in tool discovery 和 plugin discovery，见 `model_tools.py:176-200`。内置 `plugins/web/*` 的 manifest `kind: backend` 会自动加载，见 `hermes_cli/plugins.py:230-251` 和 `hermes_cli/plugins.py:1156-1166`。

provider 通过 `ctx.register_web_search_provider(...)` 注册到 `agent.web_search_registry`，见 `hermes_cli/plugins.py:625-649`。例如 Firecrawl 和 Exa 分别在 `plugins/web/firecrawl/__init__.py:23-28`、`plugins/web/exa/__init__.py:10-15` 注册。

主要内置后端能力：

| 后端 | 能力 |
| --- | --- |
| `firecrawl` | search、extract |
| `parallel` | search、extract |
| `tavily` | search、extract、crawl |
| `exa` | search、extract |
| `searxng` | search only |
| `brave-free` | search only |
| `ddgs` | search only |
| `xai` | search only，通过 xAI Responses API 的 server-side web_search |

当前实现有一个值得注意的边界：`_is_backend_available()` 支持 `"xai"`，`_get_backend()` 也接受配置为 `"xai"`，见 `tools/web_tools.py:143-144`、`tools/web_tools.py:221-230`；但 `check_web_api_key()` 的候选列表当前没有包含 `"xai"`，见 `tools/web_tools.py:1367-1375`。因此如果只有 xAI web provider 凭证，普通 `web_search` schema 可能不会被顶层门禁暴露，除非后续代码补齐这一门禁。

## 没有 API key 时如何搜索和 fetch

大多数商业 provider 都需要 API key：`firecrawl`、`parallel`、`tavily`、`exa` 分别依赖对应环境变量；`brave-free` 虽然是免费 tier，但也需要 `BRAVE_SEARCH_API_KEY`，见 `tools/web_tools.py:151-158`、`tools/web_tools.py:205-220`。

当前 Hermes 里不需要传统搜索 API key 的路径主要有：

1. `ddgs`。它通过 `ddgs` Python 包查询 DuckDuckGo，provider 注释明确写了 no API key needed，且 `is_available()` 只检查包是否可导入，见 `plugins/web/ddgs/provider.py:23-29`、`plugins/web/ddgs/provider.py:39-51`。它是 search-only，只返回搜索结果列表；如果包没装，会返回提示安装 `ddgs` 的错误，见 `plugins/web/ddgs/provider.py:59-67`。
2. `searxng`。它不需要搜索 API key，但需要 `SEARXNG_URL` 指向一个 SearXNG 实例，见 `plugins/web/searxng/provider.py:18-21`、`plugins/web/searxng/provider.py:45-61`。这通常意味着用户自己搭一个，或配置可用实例。它同样是 search-only。
3. Nous 托管网关。Firecrawl 可以走 Hermes/Nous 的 managed tool gateway；这不要求用户自己提供 `FIRECRAWL_API_KEY`，但本质上仍依赖 Nous 认证/订阅侧能力，不是匿名免费网络搜索，见 `tools/web_tools.py:146-152`。
4. 浏览器工具。没有 web provider 时，模型仍可能使用 `browser_*` 打开搜索引擎网页并读取页面，但这是 browser automation 路径，不是 `web_search` / `web_extract`。它更慢、更贵，适合交互式页面；简单信息检索仍优先 web 工具，见 `tools/browser_tool.py:1471-1474`。

`fetch`/正文抽取要单独看。`ddgs`、`searxng`、`brave-free` 都是 search-only provider，只能找结果，不能抓 URL 正文。`web_extract_tool()` 在配置到 search-only provider 时会返回明确错误，提示改用 `firecrawl`、`tavily`、`exa` 或 `parallel` 作为 `web.extract_backend`，见 `tools/web_tools.py:943-963`。

因此可以把无 key 情况理解为：

```text
无商业 API key 搜索:
  ddgs 可用时用 DuckDuckGo 包搜索。
  或配置 SEARXNG_URL 走 SearXNG 实例。
  或有 Nous 托管能力时走 managed Firecrawl。
  或退到 browser_* 操作搜索网页。

无商业 API key fetch 正文:
  web_extract 通常不可用。
  search-only provider 只能返回 URL/标题/摘要。
  要抓正文需要 extract-capable provider，或退到 browser_* 读页面。
```

本仓库中出现的 `OpenClaw` 大多是迁移、兼容性或移植注释，不是独立的 websearch 实现。因此不能仅从 Hermes 仓库断言 OpenClaw 的完整搜索策略；如果讨论 Hermes 当前代码，可以确认的是上面这些路径。

## `web_search` 执行链路

`web_search` 的 schema 定义在 `tools/web_tools.py:1501-1521`。参数是：

- `query`: 搜索字符串。
- `limit`: 结果上限，默认 5，schema 上限 100。

执行函数是 `web_search_tool(query, limit)`，见 `tools/web_tools.py:746-849`。它会：

1. 把 `limit` 转成整数，并限制在 1 到 100。
2. 检查是否被 interrupt。
3. 通过 `_get_search_backend()` 解析搜索后端。
4. 从 `agent.web_search_registry` 获取对应 provider。
5. 调用 `provider.search(query, limit)`。
6. 返回 JSON 字符串，典型结构是：

```json
{
  "success": true,
  "data": {
    "web": [
      {
        "title": "Result title",
        "url": "https://example.com",
        "description": "Snippet",
        "position": 1
      }
    ]
  }
}
```

注意：`web_search` 只返回搜索结果元数据，不抓取页面全文。工具说明也明确说如果需要页面内容，应继续用 `web_extract`，见 `tools/web_tools.py:753-754`。

## 后端选择规则

搜索后端解析由 `_get_search_backend()` 转到 `_get_capability_backend("search")`，见 `tools/web_tools.py:167-202`。优先级是：

1. `web.search_backend`，如果配置且当前可用。
2. `web.backend`，作为 shared fallback。
3. 按环境变量和可用性自动选择。

自动选择的顺序在 `_get_backend()` 里是：

1. `firecrawl`
2. `parallel`
3. `tavily`
4. `exa`
5. `searxng`
6. `brave-free`
7. `ddgs`

见 `tools/web_tools.py:135-164`。

registry 层还有一套 active provider resolution，文档化在 `agent/web_search_registry.py:10-30`，实现见 `agent/web_search_registry.py:133-221`。它的语义是按能力过滤 provider，并在没有明确配置时按 legacy preference 选择可用 provider。

## `web_extract` 与搜索的关系

`web_extract` schema 在 `tools/web_tools.py:1523-1538`，工具注册在 `tools/web_tools.py:1550-1560`。它接收最多 5 个 URL，并返回页面 markdown 内容。

`web_extract_tool()` 会做几类保护和压缩：

- 阻止 URL 中嵌入疑似 API key 或 token，见 `tools/web_tools.py:881-891`。
- 通过 `is_safe_url()` 阻止 private/internal network 地址，见 `tools/web_tools.py:913-927`。
- 对长内容使用辅助模型做摘要，默认 5000 字符以上触发，2M 字符以上拒绝处理，见 `tools/web_tools.py:296-427`。
- 输出时只保留 `url/title/content/error/blocked_by_policy` 等精简字段，见 `tools/web_tools.py:1090-1101`。

浏览器工具也会引导模型优先使用 web 工具：`browser_navigate` 的说明写着简单信息检索优先 `web_search` 或 `web_extract`，因为更快更便宜，见 `tools/browser_tool.py:1471-1474`。如果 web 工具不可用，`model_tools.py` 会把这个交叉引用从 browser schema 中删掉，避免模型调用不存在的工具，见 `model_tools.py:442-460`。

## 什么时候会自主发起 websearch

最关键的提示词来自 `agent/prompt_builder.py`。

`TOOL_USE_ENFORCEMENT_MODELS` 包含 `gpt`、`codex`、`gemini`、`gemma`、`grok`、`glm`、`qwen`、`deepseek`，见 `agent/prompt_builder.py:261-263`。当 `agent.tool_use_enforcement` 是默认 `"auto"` 时，`agent/system_prompt.py` 会对这些模型注入工具使用指导，见 `agent/system_prompt.py:133-167`。配置默认值见 `hermes_cli/config.py:612-619`，初始化读取见 `agent/agent_init.py:1197-1202`。

其中 `OPENAI_MODEL_EXECUTION_GUIDANCE` 包含强制工具使用规则，明确写道：

- 当前时间、日期、时区用 terminal。
- 文件、git、系统状态用对应工具。
- “Current facts (weather, news, versions) -> use web_search”。

见 `agent/prompt_builder.py:284-296`。同一段还要求缺少上下文时优先用可检索工具，例如 `search_files`、`web_search`、`read_file`，见 `agent/prompt_builder.py:324-329`。

因此，模型会倾向于在这些情况下自主发起 `web_search`：

1. 用户显式要求搜索、查最新信息、看新闻、查版本、查天气等当前事实。
2. 用户问的问题明显依赖最近变化的信息，例如软件版本、新闻、市场状态、法规、活动安排。
3. 模型判断从记忆回答风险较高，而缺失信息可以通过 web 查到。
4. 浏览网页前只是做简单信息检索或找 URL，schema 提示会引导它先用 `web_search/web_extract` 而不是 browser。
5. tool-use enforcement 打开时，模型刚说“我会搜索/我去查”，系统提示要求它在同一响应里立刻发出工具调用，而不是只承诺。

这些都是提示词和 schema 诱导的自主行为，不是 `run_agent.py` 里针对用户文本的硬编码搜索触发。

## 对话循环如何处理模型发出的搜索调用

会话循环把 `agent.tools` 作为 tool schema 传给模型，见 `agent/conversation_loop.py:964-990`、`agent/conversation_loop.py:1085-1127`。如果模型返回 `assistant_message.tool_calls`：

1. Hermes 校验工具名是否在 `agent.valid_tool_names` 中，见 `agent/conversation_loop.py:3345-3374`。
2. 校验工具参数 JSON，见 `agent/conversation_loop.py:3406-3497`。
3. 追加 assistant tool-call 消息。
4. 调用 `agent._execute_tool_calls(...)`，见 `agent/conversation_loop.py:3562-3578`。
5. 最终走 `model_tools.handle_function_call()` 和 `registry.dispatch()`，见 `agent/tool_executor.py:749-775`、`model_tools.py:741-847`。
6. 工具结果以 `role: tool` 追加回 messages，模型再基于搜索结果继续下一轮。

这个机制意味着：只要 `web_search` schema 可见，模型可以在任意一轮自主选择调用；Hermes 不需要额外判断“是否搜索”。

## `execute_code` 里的搜索旁路

`execute_code` 沙箱也可以生成 `web_search()` 和 `web_extract()` 的 Python stub，但只在这些工具已经是当前会话可用工具时才会出现在 schema 文档里。

- 沙箱允许的工具列表包含 `web_search` 和 `web_extract`，见 `tools/code_execution_tool.py:58-68`。
- stub 定义见 `tools/code_execution_tool.py:167-181`。
- `build_execute_code_schema()` 会只列出 enabled sandbox tools，避免 web 工具关闭时模型仍以为可用，见 `tools/code_execution_tool.py:1659-1688`。
- `model_tools.py` 会用实际通过门禁的 `available_tool_names` 重建 `execute_code` schema，见 `model_tools.py:400-411`。

所以通过 `execute_code` 搜索不是绕过门禁，而是受同一个可用工具集合约束。

## 实现上的关键判断

可以把 Hermes websearch 的控制面分成三层：

1. 能不能搜：由 toolset、provider 凭证、`check_web_api_key()`、registry 共同决定。
2. 用哪个后端搜：由 `web.search_backend`、`web.backend` 和自动探测顺序决定。
3. 什么时候搜：主要由模型根据 system prompt、tool schema、用户请求和上下文判断。

如果要调整“自主搜索”的积极程度，优先看：

- `agent.tool_use_enforcement` 配置和 `agent/system_prompt.py:133-167`。
- `OPENAI_MODEL_EXECUTION_GUIDANCE` 中关于 current facts 和 missing context 的规则。
- `web_search`、`browser_navigate`、`execute_code` 的 schema 描述。
- `check_web_api_key()` 是否正确覆盖所有想暴露的 provider。
