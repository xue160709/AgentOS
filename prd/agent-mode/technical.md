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
| `electron/main.ts` | Agent Mode 相关 IPC handlers。 |

## 数据结构

- `AgentModeProjectSettings`：enabled、todoEnabled、user、identity、projectModelPick、skillModelOverrides。
- `AgentModeFilesResult`：一次文件补齐的 created/updated/exists 结果。
- `AgentContextCatalog`：Skills、commands、agents、instructionFiles。
- AgentOS 标记块：`AgentOS Agent Mode`、`AgentOS TODO Mode`、`AgentOS Claude Context`。

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

## TODO 对应项

- `TODO.md §14`：补 Agent Mode 文件 fixture 与 UI 正式验收。

## 最近同步

- commit：`bb8d2b04de464f1a09decc875f2e869afe8885fb`
- 日期：`2026-06-23`
- 变化摘要：按 Agent Mode 文件、设置、上下文注入和项目首页设置面板补齐 as-built PRD。
- 待确认：`AGENT.md`/`AGENTS.md` 用户口径需产品层统一。

