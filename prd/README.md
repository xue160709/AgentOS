# AgentOS 产品文档

## 项目概览

AgentOS 是面向本地项目与长期任务的 Electron 桌面 Agent 工作台。当前产品以本地项目文件夹为工作单位，把项目、线程、Claude Agent SDK 运行、文件上下文、模型配置、Agent Mode、首页卡片和长期任务编排组织在同一个工作区内。

本轮 PRD 是 2026-06-23 基于当前代码、README、OpenSpec 基线与历史 `prd-old/` 资料做的首次 `prd/` 全量重建。2026-07-05 已同步 omni-ui 多模态融合与语音控制首版正式验收结果；当前 11 个模块共 118 个验收场景，108 个已通过、0 个失败、8 个保留为真实 Electron GUI / macOS 系统权限 / live Provider / 本机应用置前人工确认项，2 个新增网页打开场景待正式验收。文档只描述当前代码真实存在的能力；验收事实源仍以各模块 `acceptance.md` 为准。

## 模块索引

| 模块 | 状态 | 产品文档 | 技术文档 |
| --- | --- | --- | --- |
| 产品总览 | 已实现，正式验收通过 | `agentos/README.md` | `agentos/technical.md` |
| 工作区与会话 | 已实现，正式验收通过 | `workspace-session/README.md` | `workspace-session/technical.md` |
| 聊天与 Agent 运行时 | 已实现，正式验收通过 | `chat-agent-runtime/README.md` | `chat-agent-runtime/technical.md` |
| 本地文件上下文 | 已实现，正式验收通过 | `file-context/README.md` | `file-context/technical.md` |
| 模型与 Provider 设置 | 已实现，正式验收通过 | `model-settings/README.md` | `model-settings/technical.md` |
| 持久化 | 已实现，正式验收通过 | `persistence/README.md` | `persistence/technical.md` |
| Agent Mode | 已实现，正式验收通过 | `agent-mode/README.md` | `agent-mode/technical.md` |
| Home Plugin 数据卡片 | 已实现，正式验收通过 | `home-plugin/README.md` | `home-plugin/technical.md` |
| Task Home Plugin | 已实现，正式验收通过 | `task-home-plugin/README.md` | `task-home-plugin/technical.md` |
| 桌面外壳、设置与发布 | 已实现，18/21 通过，3 项人工确认 | `desktop-shell-settings-release/README.md` | `desktop-shell-settings-release/technical.md` |
| omni-ui 多模态融合与语音控制 | 已实现首版，13/20 通过，5 项人工确认，2 项待正式验收 | `multimodal-voice-control/README.md` | `multimodal-voice-control/technical.md` |

## 当前重点

- 2026-07-05：`TODO.md` 已重整为 AgentOS 产品 backlog（旧 agentic runtime 清单归档到 `docs/archive/TODO-agentic-runtime-2026-06.md`）；omni-ui 多模态融合与语音控制主窗口首版已实现并完成正式验收回写（`TODO.md §2.1`，契约 `prd/multimodal-voice-control/acceptance.md`）。
- 全量正式验收已执行并回写 `acceptance.md`：当前剩余 `desktop-shell-settings-release` 的 close-to-tray、macOS 语音授权成功、macOS 语音权限拒绝 3 项人工确认，以及 `multimodal-voice-control` 的 live Provider、真实语音悬浮窗、权限拒绝、helper 异常恢复、真实打开应用 5 项人工确认。
- 交互流程复查未发现新的阻断级状态机缺陷；剩余工作是把 Composer 语音/提交、权限弹窗、Generative UI、状态面板跳转、项目首页任务卡等全页面点击路径沉淀成可重复 E2E 脚本证据。
- Workspace 持久化已完成本轮架构加固：Snapshot Resolution、Workspace Session durability timing、History Search Index internal seam 和 workspace revision clock 已落地并通过正式验收状态同步。
- MCP 与 WebSearch 接入已完成主要实现与正式验收；真实 Brave/Tavily 外网成功搜索、真实 MCP server 进程/网络连通仍属于可选 live smoke，不作为当前通过门槛。

## 文档规则

- `prd/<module>/README.md` 描述产品状态和用户流程。
- `prd/<module>/technical.md` 描述实现细节、代码入口、测试与调试上下文。
- `prd/<module>/acceptance.md` 是唯一验收事实源；README 不复制验收清单。
- `TODO.md` 是继续开发入口，未完成目标、阻塞和下步动作以 TODO 为准。
