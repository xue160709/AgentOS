# AgentOS 产品文档

## 项目概览

AgentOS 是面向本地项目与长期任务的 Electron 桌面 Agent 工作台。当前产品以本地项目文件夹为工作单位，把项目、线程、Claude Agent SDK 运行、文件上下文、模型配置、Agent Mode、首页卡片和长期任务编排组织在同一个工作区内。

本轮 PRD 是 2026-06-23 基于当前代码、README、OpenSpec 基线与历史 `prd-old/` 资料做的首次 `prd/` 全量重建。文档只描述当前代码真实存在的能力；尚未正式验收的场景在各模块 `acceptance.md` 中标为待 `project-verify`。

## 模块索引

| 模块 | 状态 | 产品文档 | 技术文档 |
| --- | --- | --- | --- |
| 产品总览 | 已实现，待正式验收 | `agentos/README.md` | `agentos/technical.md` |
| 工作区与会话 | 已实现，待正式验收 | `workspace-session/README.md` | `workspace-session/technical.md` |
| 聊天与 Agent 运行时 | 已实现，待正式验收 | `chat-agent-runtime/README.md` | `chat-agent-runtime/technical.md` |
| 本地文件上下文 | 已实现，待正式验收 | `file-context/README.md` | `file-context/technical.md` |
| 模型与 Provider 设置 | 已实现，待正式验收 | `model-settings/README.md` | `model-settings/technical.md` |
| 持久化 | 已实现，待正式验收 | `persistence/README.md` | `persistence/technical.md` |
| Agent Mode | 已实现，待正式验收 | `agent-mode/README.md` | `agent-mode/technical.md` |
| Home Plugin 数据卡片 | 已实现，待正式验收 | `home-plugin/README.md` | `home-plugin/technical.md` |
| Task Home Plugin | 已实现，待正式验收 | `task-home-plugin/README.md` | `task-home-plugin/technical.md` |
| 桌面外壳、设置与发布 | 已实现，待正式验收 | `desktop-shell-settings-release/README.md` | `desktop-shell-settings-release/technical.md` |

## 当前重点

- `TODO.md` 仍以 agentic runtime 优化清单为主，本轮已新增产品 PRD 初始化记录和后续差距。
- 下一步应按模块执行 `project-verify`，把各 `acceptance.md` 的待验收状态转换为带证据的正式状态戳。
- UI 选择器与端到端验收仍需逐步沉淀，尤其是 Agent Mode、Home Plugin、Task Home Plugin 和桌面发布相关流程。

## 文档规则

- `prd/<module>/README.md` 描述产品状态和用户流程。
- `prd/<module>/technical.md` 描述实现细节、代码入口、测试与调试上下文。
- `prd/<module>/acceptance.md` 是唯一验收事实源；README 不复制验收清单。
- `TODO.md` 是继续开发入口，未完成目标、阻塞和下步动作以 TODO 为准。
