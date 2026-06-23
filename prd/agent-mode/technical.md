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
| `src/desktop-types.ts`、`src/desktop-api.ts` | Agent Mode 设置共享类型和 renderer/main IPC seam；后续 MCP 配置字段应从这里进入。 |
| `electron/main.ts` | Agent Mode 相关 IPC handlers。 |

## 数据结构

- `AgentModeProjectSettings`：enabled、todoEnabled、user、identity、projectModelPick、skillModelOverrides。
- `AgentModeFilesResult`：一次文件补齐的 created/updated/exists 结果。
- `AgentContextCatalog`：Skills、commands、agents、instructionFiles。
- AgentOS 标记块：`AgentOS Agent Mode`、`AgentOS TODO Mode`、`AgentOS Claude Context`。
- MCP 规划结构：后续在 `AgentModeProjectSettings` 或独立项目设置 store 中保存 `mcpServers` 与 `mcpToolPolicies`，支持 stdio、HTTP、SSE 三类 transport；密钥优先使用 `${ENV_NAME}` 引用，不在日志或 UI 摘要中输出明文。

## 调用链路

```text
用户启用 Agent Mode
  -> window.desktop.setAgentModeState / ensureAgentModeFiles
  -> electron/agent-mode-files.ts
  -> 写入项目文件和 userData 设置
  -> 后续聊天 ClaudeAgentRunner 调用 buildRuntimeContext
  -> agent-context 拼装 system prompt 与 host skills/agents
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
- MCP 保存前后需要处理未保存更改、连接测试中的禁用态、环境变量未解析和删除 server 的确认。

## TODO 对应项

- `TODO.md §14`：补 Agent Mode 文件 fixture 与 UI 正式验收。
- `TODO.md §15`：新增项目级 MCP 设置面板、持久化、连接测试、tool policy 和交互验收。

## 最近同步

- commit：`3d41483b2fe8edaa5b9068e0ec952da5cb05bce7`
- 日期：`2026-06-23`
- 变化摘要：补充项目级 MCP 设置规划，明确 MCP 配置归属 Agent 设置而非全局 Provider 设置。
- 待确认：MCP 配置是否与 Agent Mode 启停强绑定，或允许在 Agent Mode 关闭时仍作为 Chat 工具能力使用。
