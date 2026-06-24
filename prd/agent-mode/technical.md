# Agent Mode 技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `electron/agent-mode-files.ts` | Agent Mode 文件检测、创建、标记块更新和 TODO 模式切换。 |
| `electron/agent-mode-settings-store.ts` | per-project Agent Mode 设置持久化。 |
| `electron/agent-context.ts` | 发现 `.claude`/`.agent`/`.agents`/`.cursor` 上下文并构建运行时 system prompt。 |
| `src/components/useWorkspaceAgentMode.ts` | UI 侧读取和保存 Agent Mode 状态。 |
| `src/components/AgentModeControls.tsx` | Agent Mode 控制入口。 |
| `src/components/chat/ProjectHomeSurface.tsx` | 项目首页 Agent 设置模态。 |
| `src/components/setting/AgentModeSettingsPage.tsx` | 全局 Agent Mode USER/IDENTITY 设置页。 |
| `src/desktop-types.ts`、`src/desktop-api.ts` | Agent Mode、MCP server、项目覆盖、tool policy 和 renderer/main IPC seam 类型。 |
| `src/components/setting/ClaudeAgentSettingsPage.tsx` | 全局 MCP 设置页；保存 server 定义、总开关和连接测试缓存。 |
| `electron/main.ts` | Agent Mode 相关 IPC handlers。 |

## 数据结构

- `AgentModeProjectSettings`：enabled、todoEnabled、user、identity、projectModelPick、skillModelOverrides、有效 MCP server、项目级开关覆盖、tool policy 和连接测试缓存。
- `AgentModeFilesResult`：一次文件补齐的 created/updated/exists 结果。
- `AgentContextCatalog`：Skills、commands、agents、instructionFiles。
- AgentOS 标记块：`AgentOS Agent Mode`、`AgentOS TODO Mode`、`AgentOS Claude Context`。
- MCP 设置结构：全局保存 `globalMcpServers` 与 `globalMcpServerProbeCache`；项目保存 `mcpServerOverrides` 与 `mcpToolPolicies`。有效 server 由全局定义叠加项目覆盖得到，支持 stdio、HTTP、SSE 三类 transport，密钥优先使用 `${ENV_NAME}` 引用，不在日志或 UI 摘要中输出明文。

## 调用链路

```text
用户启用 Agent Mode
  -> window.desktop.setAgentModeState / ensureAgentModeFiles
  -> electron/agent-mode-files.ts
  -> 写入项目文件和 userData 设置
  -> 后续聊天 ClaudeAgentRunner 调用 buildRuntimeContext
  -> agent-context 拼装 system prompt 与 host skills/agents

全局 MCP 设置
  -> #settings/mcp
  -> GlobalMcpSettingsPage
  -> desktop:get-global-mcp-settings / save-global-mcp-settings / test-global-mcp-server
  -> AgentModeSettingsStore.globalMcpServers + probe cache

项目 MCP 设置
  -> ProjectHomeSurface Agent 设置 MCP 面板
  -> 保存 mcpServerOverrides / mcpToolPolicies
  -> ClaudeAgentRunner buildMcpRuntimeOptions
```

## 日志与调试

- 文件补齐失败返回结构化 result，不应覆盖用户自定义内容。
- 上下文注入问题优先看 `AgentModeSettingsStore.resolve` 和 `buildRuntimeContext` 的 catalog。

## 测试与验收

- 当前缺直接针对 Agent Mode 文件写入的单元测试；建议补 `agent-mode-files` fixture。
- 间接测试：`electron/model-pick.test.mjs` 覆盖 Skill 模型覆盖候选。
- 验收契约：`prd/agent-mode/acceptance.md`。

## 边界情况

- `~` 路径会展开到用户 home。
- 重复启用只更新标记块或缺失文件。
- TODO 模式关闭会移除 AgentOS 管理的 TODO 块和 `TODO.md`。
- Project Skill 模型覆盖按 `skill.path` 保存，路径移动视为新 Skill。
- MCP server 名称需要稳定、可用于 SDK tool name 前缀；重命名 server 会影响已保存的 tool policy。
- 全局关闭的 server 不会出现在项目 MCP 面板，也不会传入 SDK runtime options。
- 连接测试缓存按 server 配置签名过滤；server 修改后旧工具列表不再作为当前事实。
- MCP 保存前后仍需继续补强删除确认、字段级环境变量修复提示和失败恢复引导。

## TODO 对应项

- `TODO.md §14`：补 Agent Mode 文件 fixture 与 UI 正式验收。
- `TODO.md §15`：补 MCP 字段级修复提示、tool policy 分组/风险标注、失败恢复文案、无项目空态和交互验收。

## 最近同步

- commit：`a45dc7d89a7985e2f80903c9338f827ed58dd345`
- 日期：`2026-06-24`
- 变化摘要：增量同步，包含未提交代码观察：项目 MCP 面板已消费全局启用 server，保存项目级 `mcpServerOverrides` 与 `mcpToolPolicies`，显示运行状态和连接测试缓存工具；全局定义和连接测试留在 `#settings/mcp`。
- 待确认：正式 `project-verify` 尚未执行；字段级未解析提示、tool policy 分组/风险标注和失败恢复文案仍待增强。
