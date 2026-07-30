# AgentOS 产品 TODO

> 2026-07-05 重整：原 agentic runtime 优化清单（§1–§13，全部完成）已归档到 `docs/archive/TODO-agentic-runtime-2026-06.md`。
> 本 TODO 以 AgentOS 产品 backlog 为主线；验收标准只写在 `prd/<模块>/acceptance.md`，本文件只放任务 checkbox + 指针。

## §1 项目概览

- 工具形态：Electron 桌面应用（macOS 优先）+ Vite 5 + React 19 + TypeScript。
- 产品名称：AgentOS —— 面向本地项目与长期任务的桌面 Agent 工作台。
- 现状：11 个 prd 模块、124 个验收场景中 115 ✅ / 0 ❌ / 9 ⚠️ / 0 ⬜（`desktop-shell-settings-release` 的真实托盘/macOS 语音权限人工项；`multimodal-voice-control` 的 live Provider、真实语音悬浮窗、helper 异常恢复、真实打开应用与默认浏览器打开人工项）。
- 当前主线：**omni-ui 多模态组件融合 + 语音输入悬浮窗控制主窗口**（§2）。

## §2 开发任务

### 2.1 P0｜omni-ui 多模态融合与语音控制主窗口

> 验收契约 → `prd/multimodal-voice-control/acceptance.md`
> 融合设计与工作量评估 → `docs/omni-ui-integration.md`
> 依赖方式：安装 npm 包 `@xue160709/omni-ui-core` / `@xue160709/omni-ui-react` / `@xue160709/omni-ui-shadcn`（当前均为 `0.1.0`），**不在本仓库重写运行时**。

**阶段 A｜omni-ui 运行时接入主窗口（约 2–3 天）**

- [x] 安装依赖：`npm install @xue160709/omni-ui-core@0.1.0 @xue160709/omni-ui-react@0.1.0 @xue160709/omni-ui-shadcn@0.1.0`；入口引入 `@xue160709/omni-ui-react/styles.css`（shadcn 包为 registry 源码，运行时可选，按用户要求一并安装）。
- [x] 在 `src/main.tsx` / `AppShell` 外层挂 `MultimodalProvider`，配置 `defineMultimodalConfig`（本地规则 resolver 先行）。
- [x] 用 `MultimodalPage` 标注主要页面：项目首页、Chat 会话页、全局设置页。
- [x] 用 `MultimodalGroup` 标注首批实体：侧栏项目列表项（entity `project`）、会话列表项（entity `thread`）、项目首页任务卡（entity `task-card`）。
- [x] 用 `useInteractionNode` / `useInteractionObject` 为高价值控件补显式语义：侧栏导航/项目/对话/Skill 控件、工作区文件面板、Composer 输入/发送/模型/权限/语音、项目首页卡片与 Skill 卡片；语义 label/alias 走 i18n。
- [x] `defineAction` + `useActionExecutor` 注册首批低风险 action：`project.switch`、`thread.new`、`settings.open`、`composer.setText`、`composer.send`。
- [x] 用独立命令窗口打通「文本命令 → 规则解析 → executor 执行」全链路；主窗口只保留 headless executor，不覆盖 Composer。
- [x] 大 DOM 快照性能实测：在真实项目工作区连续输入/切换页面，确认 Provider 重渲染与快照重建次数符合 omni-ui benchmark 口径。

**阶段 B｜LLM 意图识别（走 Claude Agent SDK，约 1–1.5 天）**

- [x] 主进程新增 `intent:resolve` IPC（走 Desktop Seam）：renderer 传入 omni-ui resolver prompt，主进程用 Claude Agent SDK 执行一次性意图识别 query（复用 `ClaudeAgentSettingsStore.resolve()` 的 Provider 解析与 `buildSdkEnv`），返回意图 JSON；API Key 不进 renderer。
- [x] 意图识别 query 隔离：不挂 MCP server、文件、Bash 等任何业务工具，最大 turn 数为 1，模型只能返回意图 JSON，无副作用。
- [x] renderer 侧用 `createLlmResolver({ complete: ipc 代理 })` 注册 model resolver，与规则 resolver 融合（`rule-first` 模式）。
- [x] 意图识别调用记录脱敏日志：provider 名称、模型、utterance 长度/hash、耗时、结果状态；禁止输出 Key 与用户语句原文以外的敏感头。
- [x] Provider 未配置或调用失败时的降级：返回 `unsupported`，UI 提示「无法识别，请在设置中配置模型」或回退纯规则解析。

**阶段 C｜语音输入悬浮窗（约 3–4 天，难点）**

- [x] 新建语音命令窗（Voice Command Window）：无边框、置顶、小面板、不抢主窗口焦点的第二个 `BrowserWindow`，独立 HTML 入口（vite 多页）。
- [x] 全局快捷键（`globalShortcut`，默认可配）唤起/隐藏悬浮窗；托盘或菜单补充入口。
- [x] 改造 `MacSpeechRecognitionService` 支持多窗口事件路由：语音会话由悬浮窗发起时，partial/final/status/error 事件发往悬浮窗，不再单播主窗口；与 Composer 语音输入互斥（同一时间仅一个消费者）。
- [x] 悬浮窗 UI（参考苹果听写）：手动点击开始/停止录音按钮、partial 实时文字、可编辑的 final 文本、提交按钮、执行状态回显（成功 / 失败 / 需澄清 / 需确认）。
- [x] IPC 链路：悬浮窗提交 utterance → 主进程转发主窗口 → 主窗口 omni-ui `useSubmitUtterance` 提交 → 解析执行 → 结果（含澄清候选/确认请求）回传悬浮窗。
- [x] 权限与错误路径：麦克风/语音权限拒绝时悬浮窗展示恢复提示；helper 进程退出时状态落回 idle 并可重试。

**阶段 D｜命令面扩展与安全交互（约 2–3 天）**

- [x] 扩展 action 覆盖：任务卡操作（打开/刷新）、模型切换（`model.switch`）、MCP server 项目开关（`mcp.toggle`）、侧栏/面板显隐、会话归档/置顶。
- [x] 补齐语音/文本命令映射：主页面/文档页、设置分类、全局搜索范围、侧栏/文件面板、Agent 状态、项目/会话置顶、会话切换、任务卡刷新、项目技能运行等，修复规则解析后没有可执行 action 的路径。
- [x] 读取当前 UI 数据（`settings.describe` 首批）：命令窗口能回答设置 · 模型里的模型厂商数量、名称、当前请求模型和 API Key 配置状态，也能回答“还有多少控件没接入 omni”的静态覆盖统计；模型设置页、搜索、Transcript、项目首页、Composer、状态弹窗、文件面板、设置/开发者/更新页等原生控件已接入显式 omni 语义，API Key / Token / MCP headers/env 等敏感字段仅标记敏感不暴露明文；`project-verify` 已通过（2026-07-05），见本模块验收契约。
- [x] 打开电脑应用（`system.openApp`）：主进程新增参数化 `open -a` IPC（spawn 参数数组，禁止 shell 拼接）；应用不存在时回显「未找到应用」；覆盖应用名注入防护单测。
- [ ] 打开网页（`system.openUrl`）：语音/文本命令「打开 Google 页面」优先由本地安全规则解析为网页 action，再经默认浏览器打开网页，不再误判为本机应用，也不依赖 live Provider；`project-verify` 已覆盖 2 个新增场景，其中非法 URL 拦截 ✅，真实打开 Google 页面仍因默认浏览器副作用标 ⚠️ 跳过，待用户本机 GUI 复验后打勾。
- [x] 风险分级：读/导航类 `risk: low` 直接执行；写/状态变更类 `risk: medium` 以上走 omni-ui 确认流，在悬浮窗或主窗口展示确认卡。
- [x] 多候选澄清：解析出多个假设时在悬浮窗列出候选让用户点选。
- [x] `OmniDevTools` 开发者入口（仅 dev 或设置开关后可见），用于调试命令轨迹。

**阶段 E｜验收与证据（约 1–2 天）**

- [x] 为 `multimodal-voice-control` 全部场景补稳定 selector 与自动化/人工验收路径。
- [x] 语音链路（依赖真实 macOS 权限）沉淀人工验收步骤；文本/LLM 链路沉淀可复现自动化测试。
- [x] 为剩余 9 个 manual-only 场景补 readiness 门禁：`npm run audit:omni-manual-readiness` 检查 acceptance 跳过状态、人工步骤、`TESTING_CHECKLIST.md` 行与源码支撑，防止人工项被误当成控件缺口。
- [x] 正式验收：按 `project-verify` 回写状态戳，同步本节 checkbox（2026-07-05：22 个场景中 16 ✅ / 6 ⚠️，详见 `TESTING_CHECKLIST.md`）。

### 2.2 P0｜命令窗口命令 + 聊天混合入口

> 验收契约 → `prd/multimodal-voice-control/acceptance.md`

- [x] 接入独立命令窗口的「自动 / 命令 / 聊天」模式：自动模式中 AgentOS 内部命令直接走 omni action，系统级任务（如打开蓝牙设置、截屏、音量、窗口控制）交给当前 Chat 的 Claude Agent SDK，普通问题/总结/解释进入当前聊天并返回内容。
  - 验收：2026-07-05，`project-verify` 已回写新增 4 个场景状态戳；`npm run audit:voice-command-bdd` 覆盖 50/50 条 BDD（18 command / 30 agent_task / 2 answer）。

### 2.3 遗留正式验收收口（沿自旧 §14）

- [ ] 人工确认 close-to-tray：真实 Electron 托盘与窗口关闭事件下，关闭主窗口应隐藏到托盘且可恢复窗口。
- [ ] 人工确认 macOS 语音授权成功：真实授权后 Composer 语音输入把 partial/final 写入当前选区 draft range。
- [ ] 人工确认 macOS 语音权限拒绝：系统权限拒绝时页面展示恢复提示，主进程语音状态落到 error。
  - 验收契约 → `prd/desktop-shell-settings-release/acceptance.md`（3 个 ⚠️ 场景）

## §3 交互流程（语音命令窗）

```text
全局快捷键 / 托盘
  -> 语音命令悬浮窗（置顶、不抢焦点）
  -> [模式] 自动 / 命令 / 聊天
  -> [点击开始] Apple Speech helper 录音
  -> partial 实时上屏（可随时点击停止）
  -> [点击停止] final 文本可编辑
  -> [点击提交] IPC -> 主窗口混合路由
  -> 自动模式：AgentOS 内部命令走 omni runtime；系统级任务走当前 Chat 的 Claude Agent SDK；问答/总结/解释走当前 Chat
  -> 命令模式：强制走规则 resolver + LLM resolver（主进程 Claude Agent SDK 一次性 query）融合
  -> 聊天模式：跳过命令解析，直接提交当前 Chat
  -> 低风险：直接执行主窗口 action，悬浮窗回显“已执行”
  -> 系统级：除已知安全本地规则外，交给当前 Chat 的 Claude Agent SDK 并复用权限模式
  -> 多候选：悬浮窗列出候选点选
  -> 高风险：确认卡，确认后执行
  -> 失败/无法识别：悬浮窗提示原因与建议说法
```

## §4 架构决策要点

- omni-ui 以 npm 依赖接入，不 fork、不复制源码进本仓库；升级走版本号。
- 模型永远不直接调用业务代码：omni-ui 只提议命令，所有 executor 由 AgentOS 页面注册并持有。
- LLM 意图识别走 Claude Agent SDK：主进程一次性 query、不挂任何业务工具（无 MCP/文件/Bash），复用模型设置 active Provider；renderer 经 Desktop Seam IPC 调用，Key 不外泄到 renderer。
- 开放名词系统命令中，`Google/谷歌` 等已知安全网页可走窄范围本地 rules；任意应用名与其它开放网页名不配置泛化本地短语 rules，只保留 allowlisted `system.openApp` / `system.openUrl` executor 和安全校验，意图理解交给 Claude Agent SDK。
- 系统级 action 目前仅覆盖打开本机应用与打开明确网页：`system.openApp` 在主进程参数化 `open -a`，禁止任意 shell 命令执行；`system.openUrl` 复用 `desktop.openExternal`，只允许 HTTP/HTTPS 网页。
- 命令窗口的自动路由只直接执行 AgentOS 内部命令和已知安全网页规则；macOS 设置深链、窗口/音量/截图/文件夹/开放网页搜索等系统级长尾任务不在本地继续硬编码，发送到当前 Chat 的 Claude Agent SDK，由既有权限模式和工具审查兜底。
- 语音识别复用现有 Swift Apple Speech helper（NDJSON/unix socket），不引入 Web Speech API。
- 悬浮窗与主窗口通过主进程中转 utterance / 结果事件；主窗口是唯一的命令执行方。

## §10 Backlog（暂不排期）

- 手机语音遥控：经 PeerJS 把手机端语音/文本命令接入同一 omni-ui 命令链（见 `prd/mobile-peerjs-remote.md` 草案）。
- 全页面点击式 Playwright/Electron GUI 脚本补齐（项目首页、Composer、Agent 设置、Home Plugin 卡片、任务卡、设置页、更新页）。
- 交互流程专项 E2E：Composer 语音 start/partial/final/error/cancel/submit、权限弹窗、Generative UI 沙箱、late async event 隔离的可重复证据。
- 测试补齐：`agent-mode-files` fixture、真实 Home Plugin action 回归、`task-home-plugin-manager` 专项单测、真实 release/updater smoke、真实 MCP server 进程/网络连通。
- golden fixtures 异常/边界场景扩充，并把「正常 + 异常路径」从文档规范升级为脚本门禁（沿自旧 §13）。
- 独立命令窗口体验增强：若真实语音链路验证成功，继续评估是否增加可配置快捷键、窗口尺寸记忆和更接近 Composer 的附件/上下文提示。
- 常用系统级语音命令复验：基于 `prd/multimodal-voice-control/voice-command-bdd.md`，对 macOS 设置深链、Safari/百度、常用 macOS 应用、截图/音量/专注模式/窗口/文件夹快捷入口做真实 GUI smoke；默认不再补成本地硬编码规则，除非后续确认某个高频命令值得进入 allowlist。

## 产品发现记录

### 2026-07-05

- 想法：把 omni-ui（github.com/xue160709/omni-ui，npm `@xue160709/omni-ui-*` 0.1.0）完全融合进 AgentOS；新增苹果听写风格语音悬浮窗，语音 → LLM 意图识别 → 操控主窗口。
- 决策：意图识别复用模型设置 Provider（主进程代理）；命令面尽量全（导航/会话/Composer/任务卡/模型/MCP）；悬浮窗手动点击开始/结束/提交；TODO 重整为产品 backlog。
- 结论：进 §2.1，新建 `prd/multimodal-voice-control/` 模块与验收契约；融合设计写入 `docs/omni-ui-integration.md`。
- 下步：`project-iterate` 按阶段 A 开始实现。
- 增量（同日）：意图识别从直调 Messages API 改为走 Claude Agent SDK 一次性 query（不挂业务工具）；新增「打开电脑应用」usecase（参数化 `open -a` + 注入防护），契约已 sync 3 个场景。
- 增量（同日）：确认命令窗口升级为「自动 / 命令 / 聊天」混合入口；AgentOS 内部命令直接执行，系统级长尾任务交给当前 Chat 的 Claude Agent SDK，普通问题与总结解释返回内容。`voice-command-bdd.md` 已按直接执行 / SDK 执行 / 返回内容分级。

## 验证记录

### 2026-07-05

- 本轮：TODO 重整为产品 backlog；新建 `prd/multimodal-voice-control/acceptance.md` 与 `docs/omni-ui-integration.md`；未写业务代码。
- 验证类别：Codex 自检（文档/契约规划）。
- 本轮：实现 `multimodal-voice-control` 首版，包括 omni-ui 运行时接入、独立命令窗口、Claude Agent SDK intent IPC、语音命令悬浮窗、speech 多窗口路由、`system.openApp` 与安全/确认/澄清 UI。
- 本轮修复：移除主窗口底部 omni 命令覆盖层，改为主窗口 headless executor + 独立可移动命令窗口；同时为 omni-ui `div[data-mm-root]` / `MultimodalPage` 补齐主窗口高度链与 `display: contents` 布局防护，恢复 Composer 可见性和底部滚动/点击区域。
- 验证类别：正式验收（project-verify）。`npm run typecheck` ✅；`npm run test:electron` ✅（83/83）；`npm run build` ✅（生成 `dist/voice.html`、macOS app/dmg/zip；notarization 因未配置选项按预期跳过）。`prd/multimodal-voice-control/acceptance.md` 已回写 13 ✅ / 5 ⚠️。
- 本轮修复：语音命令「打开 Google 页面」新增 `system.openUrl`，经默认浏览器打开 `https://www.google.com`，避免落入 `system.openApp` 的「未找到应用 Google」路径；语音窗口输入区复用主 Composer 面板样式与按钮结构。后续 `project-verify` 已覆盖 2 个新增场景：非法 URL ✅，真实打开 Google 页面因 live Provider + 默认浏览器副作用 ⚠️。
- 验证类别：Codex 自检。`npm run typecheck` ✅；`node --test electron/omni-intent-voice.test.mjs` ✅（5/5）；`npm run test:electron` ✅（84/84）；`npx vite build --mode test` ✅（生成 `dist/voice.html`，有既有大 chunk 提示）；`git diff --check` ✅（仅提示 `vite.config.ts` 既有 CRLF/LF 转换）。
- 本轮修复：补齐命令窗口对主页面/文档页、设置分类、全局搜索范围、侧栏/文件面板、Agent 状态、项目/会话置顶、会话切换、任务卡刷新和项目技能运行的语音/文本命令映射；为 page.current 的全局 action 补可执行挂载，并把 `Resolved interaction has no executable action.` 映射为可本地化提示。
- 验证类别：Codex 自检。`bash .codex/scripts/check-acceptance.sh multimodal-voice-control` ✅；`npm run typecheck` ✅；`node --test electron/omni-intent-voice.test.mjs` ✅（6/6）；`npm run test:electron` ✅（85/85）；`git diff --check` ✅。
- 本轮调整：移除 `system.openApp` / `system.openUrl` 的泛化本地短语 rules 与 local fast path，开放名词的「打开 xxx 应用 / 打开 xxx 页面」统一交给 Claude Agent SDK resolver 产出结构化 action；本地只保留安全 executor、allowlist、URL 规范化和 `open -a` 注入防护。
- 本轮修复：命令窗口运行时回显与错误提示改为 `multimodal.*` i18n key，补齐 zh/en 文案；本地规则补英文 alias（如 `open docs`、`open search settings`、`collapse sidebar`、`run {skillName} skill`）；新增 `semantic-controls` 语义辅助层，并为侧栏、工作区文件面板、Composer、项目首页/任务/Skill 卡片补 `useInteractionNode` / `useInteractionObject` 显式语义；语义 label/alias 使用 `omni.*` zh/en i18n key；补 `ProjectHomeSurface` 漏导入的 `useInteractionObject`，恢复 typecheck。
- 验证类别：Codex 自检。`bash .codex/scripts/check-acceptance.sh multimodal-voice-control` ✅；locale key 对齐检查 ✅；`npm run typecheck` ✅；`node --test electron/omni-intent-voice.test.mjs` ✅（7/7）；`npm run test:electron` ✅（86/86）；`git diff --check` ✅。
- 本轮修复：命令窗口提交「打开google」后出现「没有通过硬性校验的候选目标」；根因是 SDK JSON 选中了 `system.openUrl` 这类 page 级 action，但没有稳定绑定当前 page target，fusion 把 `google` 当成候选 UI 目标后被 hard validation 拦截。已在 SDK prompt 与 renderer 规范化层补齐 page action target，不新增本地短语 rules。后续正式验收已覆盖安全 executor；真实打开 Google 页面保留 live Provider / GUI 人工复验。
- 验证类别：Codex 自检。`npm run typecheck` ✅；`node --test electron/omni-intent-voice.test.mjs` ✅（7/7）；`npm run test:electron` ✅（86/86）；`bash .codex/scripts/check-acceptance.sh multimodal-voice-control` ✅；`git diff --check` ✅。
- 本轮修复：命令窗口询问「现在模型设置页面有几个模型厂商」时无法读取设置页数据、提示需要选择目标；已新增 `settings.describe` 读类 action，模型设置页注册 provider/字段/模型映射/关键按钮的 omni 显式语义，非敏感字段可读，API Key 仅暴露已设置/未设置状态。覆盖率粗略审计：全仓库交互控件约 181 个、显式语义/安全值暴露 74 处；模型设置页从 50/0 的显式语义缺口降到 41/22，剩余主要是全局 MCP/Search/弹窗动作和其它页面深层控件。
- 验证类别：Codex 自检。`bash .codex/scripts/check-acceptance.sh multimodal-voice-control` ✅；`npm run typecheck` ✅；`node --test electron/omni-intent-voice.test.mjs` ✅（7/7）；`npm run test:electron` ✅（86/86）；`git diff --check` ✅。新增读取设置页安全摘要场景已写入 `prd/multimodal-voice-control/acceptance.md`，后续已由 `project-verify` 正式验收通过。
- 本轮修复：命令窗口询问「现在设置了多少模型厂商」时被设置/模型目标候选抢走、提示需要选择目标；已将 `settings.describe` 读类规则前移到设置打开规则之前，并补齐「设置了多少 / 配置了几个 / 有哪些模型厂商」等表达。继续补齐搜索、Transcript、项目首页、弹窗、Composer、状态、文件面板、设置页、更新页和开发者页等控件的 `data-mm-*` 显式语义/安全值暴露；敏感字段只标记 `data-mm-sensitive`。启发式静态审计：原生 `<button|input|select|textarea>` 控件 167/167 有显式语义覆盖，粗略缺口 0。
- 验证类别：Codex 自检。`node --test electron/omni-intent-voice.test.mjs` ✅（8/8）；`npm run typecheck` ✅；`npm run test:electron` ✅（87/87）；原生控件 omni 语义静态审计 ✅（167/167，rough gap 0）。新增/扩展读取设置页安全摘要场景后续已由 `project-verify` 正式验收通过。
- 本轮正式验收：`settings.describe` 设置页安全摘要场景 ✅；`system.openUrl` 非法 URL 拦截场景 ✅；真实「打开 Google 页面」场景 ⚠️ 跳过（需 live Provider + 默认浏览器副作用，本机 GUI 复验）。正式验收中补齐 Composer 上下文入口与项目首页卡片排序按钮的 `data-mm-*` 标签；TypeScript AST 审计覆盖 166/166 个原生 `<button|input|select|textarea>` 控件，gap 0。
- 验证类别：正式验收（project-verify）。`node --test electron/omni-intent-voice.test.mjs` ✅（8/8）；`npm run typecheck` ✅；`npm run test:electron` ✅（87/87）；`bash .codex/scripts/check-acceptance.sh multimodal-voice-control` ✅；TypeScript AST 控件审计 ✅（166/166，gap 0）。证据已写入 `TESTING_CHECKLIST.md` 与 `test-results/multimodal-voice-control-verification.md`。
- 本轮补证据：将 SDK system action 的 page target 规范化逻辑抽出为 `src/multimodal/intent-normalizer.ts`，新增可执行单测证明 SDK 返回 `system.openUrl` / `system.openApp` 时会绑定当前 page target，避免把 Google/Safari 当 UI 目标。
- 验证类别：Codex 自检。`node --test electron/omni-intent-voice.test.mjs` ✅（9/9）；`npm run typecheck` ✅；`npm run test:electron` ✅（88/88）。
- 本轮接入收口：把 omni 控件审计从主要组件清单扩到全 `src/**/*.tsx`，补齐独立语音命令窗口（关闭、命令输入、录音、清空、提交、确认/取消、澄清候选）和侧栏上下文菜单的 `data-mm-*` 语义标签；新增全 TSX 原生控件 AST 门禁。
- 验证类别：Codex 自检。全 TSX AST 控件审计 ✅（35 个 TSX 文件，176/176，gap 0）；`node --test electron/omni-intent-voice.test.mjs` ✅（10/10）；`npm run typecheck` ✅；`npm run test:electron` ✅（89/89）。
- 本轮接入收口：继续覆盖非原生交互元素，补齐 API Key 获取链接、关于页邮箱/GitHub 链接、侧栏 resize separator、TODO 卡片、file diff summary 与 Agent 状态详情 summary 的 `data-mm-*` 语义；新增自定义交互控件 AST 门禁。
- 验证类别：Codex 自检。非原生交互 AST 审计 ✅（35 个 TSX 文件，52/52，gap 0）；`node --test electron/omni-intent-voice.test.mjs` ✅（11/11）；`npm run typecheck` ✅；`npm run test:electron` ✅（90/90）。
- 本轮补证据：抽出 `src/voice-state.ts` 语音悬浮窗纯状态机，自动化覆盖 final 文本优先提交、`speech_denied` 权限恢复提示、`helper_exited` 错误可重试状态和过期执行结果隔离；真实 macOS 权限、全局快捷键、speech helper 进程与 GUI 回显仍保留人工复验。
- 验证类别：Codex 自检。`node --test electron/omni-intent-voice.test.mjs` ✅（12/12）；`npm run typecheck` ✅；`npm run test:electron` ✅（91/91）。
- 本轮接入收口：新增 `settings.describe.controls` 读类命令，命令窗口可回答「还有多少控件没有实现 / 多少控件没接入 omni」，回显静态缺口、原生/非原生覆盖数、当前页面对象数，并明确 manual-only 项不是控件缺口；抽出 `electron/omni-control-audit.mjs` 和 `src/multimodal/settings-describe.ts`，`coverage-summary` 数字由同一 AST 审计 helper 对账测试守住，模型设置/控件摘要由纯函数单测直接执行验证。
- 验证类别：Codex 自检。`node --test electron/omni-intent-voice.test.mjs` ✅（14/14）；`npm run audit:omni-controls` ✅（missing 0）；`npm run typecheck` ✅；`npm run test:electron` ✅（93/93）。
- 本轮补证据：新增 `electron/omni-rule-audit.mjs` 和 `npm run audit:omni-rules`，直接导入当前 `agentOsMultimodalConfig.rules` 并用 omni-ui `createConfiguredRuleResolver` 实跑 7 个关键问句，证明「现在设置了多少模型厂商」「还有多少控件没有实现」命中 `settings.describe`；`Google/谷歌` 已知安全网页命中窄范围 `system.openUrl` 规则，而「打开 Safari」不会被本地规则误吃，仍交给 SDK 安全解析。
- 验证类别：Codex 自检。`npm run audit:omni-rules` ✅（7/7）；`node --test electron/omni-intent-voice.test.mjs` ✅（15/15）；`npm run audit:omni-controls` ✅（missing 0）；`npm run typecheck` ✅；`npm run test:electron` ✅（94/94）。
- 本轮补证据：抽出 `src/multimodal/voice-result.ts`，让命令提交结果到悬浮窗回显的映射可单测；新增断言证明 `settings.describe` 的模型厂商摘要和控件覆盖摘要会作为 `voice-window-result` 消息返回，不只停留在 action execution 的 reason/data。
- 验证类别：Codex 自检。`node --test electron/omni-intent-voice.test.mjs` ✅（15/15）；`npm run typecheck` ✅。
- 本轮补证据：新增 `electron/omni-answer-audit.mjs` 与 `npm run audit:omni-answers`，把规则解析、`settings.describe` 读快照和 `voice-result` 回显映射串成一条可运行审计链；覆盖模型厂商、控件接入统计和当前页面摘要 3 类问答，并校验不泄露 API Key 明文。
- 验证类别：Codex 自检。`npm run audit:omni-answers` ✅（3/3）；`node --test electron/omni-intent-voice.test.mjs` ✅（16/16）；`npm run typecheck` ✅。
- 本轮补证据：新增 `electron/omni-manual-readiness-audit.mjs` 与 `npm run audit:omni-manual-readiness`，把剩余 9 个 manual-only 场景的 acceptance 跳过状态、人工验证步骤、全量清单行和源码支撑做成门禁；同时显式处理 `helper_exited`，避免 helper 异常退出沿用旧权限提示。
- 验证类别：Codex 自检。`npm run audit:omni-manual-readiness` ✅（9/9）；`node --test electron/omni-intent-voice.test.mjs` ✅（17/17）；`npm run audit:omni-controls` ✅（missing 0）；`npm run audit:omni-rules` ✅（7/7）；`npm run audit:omni-answers` ✅（3/3）；`npm run typecheck` ✅；`npm run test:electron` ✅（96/96）。
- 本轮修复：真实 dev 启动时观察到「打开 Google 页面」仍会进入 live SDK 解析并在 Provider 超时后失败；已给 Google/谷歌这类已知安全网页增加窄范围本地 `system.openUrl` 规则，避免典型网页命令依赖模型可用性，任意应用名与其它开放网页名仍走 SDK。
- 验证类别：Codex 自检。`npm run audit:omni-rules` ✅（7/7，Google resolved、Safari not_found）；`node --test electron/omni-intent-voice.test.mjs` ✅（17/17）；`npm run audit:omni-answers` ✅（3/3）；`npm run audit:omni-manual-readiness` ✅（9/9）；`npm run typecheck` ✅。
- 本轮接入：命令窗口升级为「自动 / 命令 / 聊天」混合入口；自动模式下 AgentOS 内部命令直接执行，macOS 设置/截图/音量/窗口/文件夹/开放网页搜索等系统级长尾任务提交到当前 Chat 的 Claude Agent SDK，普通问题/总结/解释提交到当前 Chat 返回内容；`voice-command-bdd.md` 已按直接执行 / SDK 执行 / 返回内容分级。
- 验证类别：Codex 自检。`npm run typecheck` ✅；`npm run audit:omni-rules` ✅（8/8）；`npm run audit:omni-answers` ✅（3/3）；`npm run audit:omni-controls` ✅（native 177/177，custom 52/52，missing 0）；`node --test electron/omni-intent-voice.test.mjs` ✅（18/18）；`npm run test:electron` ✅（97/97）；`git diff --check` ✅。
- 本轮正式验收：命令窗口命令 + 聊天混合入口新增 4 个场景 ✅；新增 `npm run audit:voice-command-bdd`，直接解析 `voice-command-bdd.md` 的 50 条命令并验证自动路由，修正「关闭当前窗口」误判为内部命令的问题。
- 验证类别：正式验收（project-verify）。`npm run audit:voice-command-bdd` ✅（50/50，18 command / 30 agent_task / 2 answer）；`node --test electron/omni-intent-voice.test.mjs` ✅（18/18）；`npm run test:electron` ✅（97/97）；`npm run audit:omni-rules` ✅（8/8）；`npm run audit:omni-answers` ✅（3/3）；`npm run audit:omni-controls` ✅（native 177/177，custom 52/52，missing 0）；`npm run typecheck` ✅；`git diff --check` ✅。
- 2026-07-07：本轮调整命令窗口视觉材质：独立命令窗口优先使用 macOS `vibrancy: 'hud'` 与 Windows `backgroundMaterial: 'acrylic'`，渲染层改为透明玻璃表面与半透明控件兜底；仅改变外观材质，不改 §2 功能完成状态。
- 验证类别：Codex 自检。`npm run typecheck` ✅；`node --test electron/omni-intent-voice.test.mjs` ✅（18/18）；`git diff --check` ✅。
