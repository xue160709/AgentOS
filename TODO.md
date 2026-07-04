# AgentOS 产品 TODO

> 2026-07-05 重整：原 agentic runtime 优化清单（§1–§13，全部完成）已归档到 `docs/archive/TODO-agentic-runtime-2026-06.md`。
> 本 TODO 以 AgentOS 产品 backlog 为主线；验收标准只写在 `prd/<模块>/acceptance.md`，本文件只放任务 checkbox + 指针。

## §1 项目概览

- 工具形态：Electron 桌面应用（macOS 优先）+ Vite 5 + React 19 + TypeScript。
- 产品名称：AgentOS —— 面向本地项目与长期任务的桌面 Agent 工作台。
- 现状：10 个 prd 模块、98 个验收场景中 95 ✅ / 0 ❌ / 3 ⚠️（`desktop-shell-settings-release` 的真实托盘与 macOS 语音权限人工项）。
- 当前主线：**omni-ui 多模态组件融合 + 语音输入悬浮窗控制主窗口**（§2）。

## §2 开发任务

### 2.1 P0｜omni-ui 多模态融合与语音控制主窗口

> 验收契约 → `prd/multimodal-voice-control/acceptance.md`
> 融合设计与工作量评估 → `docs/omni-ui-integration.md`
> 依赖方式：安装 npm 包 `@xue160709/omni-ui-core` / `@xue160709/omni-ui-react` / `@xue160709/omni-ui-shadcn`（当前均为 `0.1.0`），**不在本仓库重写运行时**。

**阶段 A｜omni-ui 运行时接入主窗口（约 2–3 天）**

- [ ] 安装依赖：`npm install @xue160709/omni-ui-core@0.1.0 @xue160709/omni-ui-react@0.1.0 @xue160709/omni-ui-shadcn@0.1.0`；入口引入 `@xue160709/omni-ui-react/styles.css`（shadcn 包为 registry 源码，运行时可选，按用户要求一并安装）。
- [ ] 在 `src/main.tsx` / `AppShell` 外层挂 `MultimodalProvider`，配置 `defineMultimodalConfig`（本地规则 resolver 先行）。
- [ ] 用 `MultimodalPage` 标注主要页面：项目首页、Chat 会话页、全局设置页。
- [ ] 用 `MultimodalGroup` 标注首批实体：侧栏项目列表项（entity `project`）、会话列表项（entity `thread`）、项目首页任务卡（entity `task-card`）。
- [ ] `defineAction` + `useActionExecutor` 注册首批低风险 action：`project.switch`、`thread.new`、`settings.open`、`composer.setText`、`composer.send`。
- [ ] 临时挂 `CommandInput`（开发验证入口，可藏在设置或快捷键后）打通「文本命令 → 规则解析 → executor 执行」全链路。
- [ ] 大 DOM 快照性能实测：在真实项目工作区连续输入/切换页面，确认 Provider 重渲染与快照重建次数符合 omni-ui benchmark 口径。

**阶段 B｜LLM 意图识别（走 Claude Agent SDK，约 1–1.5 天）**

- [ ] 主进程新增 `intent:resolve` IPC（走 Desktop Seam）：renderer 传入 omni-ui resolver prompt，主进程用 Claude Agent SDK 执行一次性意图识别 query（复用 `ClaudeAgentSettingsStore.resolve()` 的 Provider 解析与 `buildSdkEnv`），返回意图 JSON；API Key 不进 renderer。
- [ ] 意图识别 query 隔离：不挂 MCP server、文件、Bash 等任何业务工具，最大 turn 数为 1，模型只能返回意图 JSON，无副作用。
- [ ] renderer 侧用 `createLlmResolver({ complete: ipc 代理 })` 注册 model resolver，与规则 resolver 融合（`rule-first` 模式）。
- [ ] 意图识别调用记录脱敏日志：provider 名称、模型、utterance 长度/hash、耗时、结果状态；禁止输出 Key 与用户语句原文以外的敏感头。
- [ ] Provider 未配置或调用失败时的降级：返回 `unsupported`，UI 提示「无法识别，请在设置中配置模型」或回退纯规则解析。

**阶段 C｜语音输入悬浮窗（约 3–4 天，难点）**

- [ ] 新建语音命令窗（Voice Command Window）：无边框、置顶、小面板、不抢主窗口焦点的第二个 `BrowserWindow`，独立 HTML 入口（vite 多页）。
- [ ] 全局快捷键（`globalShortcut`，默认可配）唤起/隐藏悬浮窗；托盘或菜单补充入口。
- [ ] 改造 `MacSpeechRecognitionService` 支持多窗口事件路由：语音会话由悬浮窗发起时，partial/final/status/error 事件发往悬浮窗，不再单播主窗口；与 Composer 语音输入互斥（同一时间仅一个消费者）。
- [ ] 悬浮窗 UI（参考苹果听写）：手动点击开始/停止录音按钮、partial 实时文字、可编辑的 final 文本、提交按钮、执行状态回显（成功 / 失败 / 需澄清 / 需确认）。
- [ ] IPC 链路：悬浮窗提交 utterance → 主进程转发主窗口 → 主窗口 omni-ui `useSubmitUtterance` 提交 → 解析执行 → 结果（含澄清候选/确认请求）回传悬浮窗。
- [ ] 权限与错误路径：麦克风/语音权限拒绝时悬浮窗展示恢复提示；helper 进程退出时状态落回 idle 并可重试。

**阶段 D｜命令面扩展与安全交互（约 2–3 天）**

- [ ] 扩展 action 覆盖：任务卡操作（打开/刷新）、模型切换（`model.switch`）、MCP server 项目开关（`mcp.toggle`）、侧栏/面板显隐、会话归档/置顶。
- [ ] 打开电脑应用（`system.openApp`）：主进程新增参数化 `open -a` IPC（spawn 参数数组，禁止 shell 拼接）；应用不存在时回显「未找到应用」；覆盖应用名注入防护单测。
- [ ] 风险分级：读/导航类 `risk: low` 直接执行；写/状态变更类 `risk: medium` 以上走 omni-ui 确认流，在悬浮窗或主窗口展示确认卡。
- [ ] 多候选澄清：解析出多个假设时在悬浮窗列出候选让用户点选。
- [ ] `OmniDevTools` 开发者入口（仅 dev 或设置开关后可见），用于调试命令轨迹。

**阶段 E｜验收与证据（约 1–2 天）**

- [ ] 为 `prd/multimodal-voice-control/acceptance.md` 全部场景补稳定 selector 与自动化/人工验收路径。
- [ ] 语音链路（依赖真实 macOS 权限）沉淀人工验收步骤；文本/LLM 链路沉淀可复现自动化测试。
- [ ] 正式验收：按 `project-verify` 回写状态戳，同步本节 checkbox。

### 2.2 遗留正式验收收口（沿自旧 §14）

- [ ] 人工确认 close-to-tray：真实 Electron 托盘与窗口关闭事件下，关闭主窗口应隐藏到托盘且可恢复窗口。
- [ ] 人工确认 macOS 语音授权成功：真实授权后 Composer 语音输入把 partial/final 写入当前选区 draft range。
- [ ] 人工确认 macOS 语音权限拒绝：系统权限拒绝时页面展示恢复提示，主进程语音状态落到 error。
  - 验收契约 → `prd/desktop-shell-settings-release/acceptance.md`（3 个 ⚠️ 场景）

## §3 交互流程（语音命令窗）

```text
全局快捷键 / 托盘
  -> 语音命令悬浮窗（置顶、不抢焦点）
  -> [点击开始] Apple Speech helper 录音
  -> partial 实时上屏（可随时点击停止）
  -> [点击停止] final 文本可编辑
  -> [点击提交] IPC -> 主窗口 omni-ui runtime
  -> 规则 resolver + LLM resolver（主进程 Claude Agent SDK 一次性 query）融合
  -> 低风险：直接执行主窗口 action，悬浮窗回显“已执行”
  -> 系统级：打开电脑应用（主进程参数化 open -a）
  -> 多候选：悬浮窗列出候选点选
  -> 高风险：确认卡，确认后执行
  -> 失败/无法识别：悬浮窗提示原因与建议说法
```

## §4 架构决策要点

- omni-ui 以 npm 依赖接入，不 fork、不复制源码进本仓库；升级走版本号。
- 模型永远不直接调用业务代码：omni-ui 只提议命令，所有 executor 由 AgentOS 页面注册并持有。
- LLM 意图识别走 Claude Agent SDK：主进程一次性 query、不挂任何业务工具（无 MCP/文件/Bash），复用模型设置 active Provider；renderer 经 Desktop Seam IPC 调用，Key 不外泄到 renderer。
- 打开电脑应用是唯一的系统级 action：主进程参数化 `open -a`，禁止任意 shell 命令执行。
- 语音识别复用现有 Swift Apple Speech helper（NDJSON/unix socket），不引入 Web Speech API。
- 悬浮窗与主窗口通过主进程中转 utterance / 结果事件；主窗口是唯一的命令执行方。

## §10 Backlog（暂不排期）

- 手机语音遥控：经 PeerJS 把手机端语音/文本命令接入同一 omni-ui 命令链（见 `prd/mobile-peerjs-remote.md` 草案）。
- 全页面点击式 Playwright/Electron GUI 脚本补齐（项目首页、Composer、Agent 设置、Home Plugin 卡片、任务卡、设置页、更新页）。
- 交互流程专项 E2E：Composer 语音 start/partial/final/error/cancel/submit、权限弹窗、Generative UI 沙箱、late async event 隔离的可重复证据。
- 测试补齐：`agent-mode-files` fixture、真实 Home Plugin action 回归、`task-home-plugin-manager` 专项单测、真实 release/updater smoke、真实 MCP server 进程/网络连通。
- golden fixtures 异常/边界场景扩充，并把「正常 + 异常路径」从文档规范升级为脚本门禁（沿自旧 §13）。
- CommandInput 常驻化：若语音命令窗验证成功，评估在主窗口顶部提供常驻自然语言命令入口。

## 产品发现记录

### 2026-07-05

- 想法：把 omni-ui（github.com/xue160709/omni-ui，npm `@xue160709/omni-ui-*` 0.1.0）完全融合进 AgentOS；新增苹果听写风格语音悬浮窗，语音 → LLM 意图识别 → 操控主窗口。
- 决策：意图识别复用模型设置 Provider（主进程代理）；命令面尽量全（导航/会话/Composer/任务卡/模型/MCP）；悬浮窗手动点击开始/结束/提交；TODO 重整为产品 backlog。
- 结论：进 §2.1，新建 `prd/multimodal-voice-control/` 模块与验收契约；融合设计写入 `docs/omni-ui-integration.md`。
- 下步：`project-iterate` 按阶段 A 开始实现。
- 增量（同日）：意图识别从直调 Messages API 改为走 Claude Agent SDK 一次性 query（不挂业务工具）；新增「打开电脑应用」usecase（参数化 `open -a` + 注入防护），契约已 sync 3 个场景。

## 验证记录

### 2026-07-05

- 本轮：TODO 重整为产品 backlog；新建 `prd/multimodal-voice-control/acceptance.md` 与 `docs/omni-ui-integration.md`；未写业务代码。
- 验证类别：Codex 自检（文档/契约规划）。
