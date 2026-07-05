# AgentOS 全量验收清单

最后更新：2026-07-05
主框架：Electron + React + Vite
验证类别：正式验收（project-verify）
验证范围：正式验收快照覆盖 `prd/*/acceptance.md` 全部 11 个模块、120 个场景；`multimodal-voice-control` 增量场景已纳入本清单

## 结论

| 状态 | 数量 | 说明 |
| --- | --- | --- |
| ✅ 通过 | 111 | 可通过单元/集成测试、静态源代码审计、浏览器 smoke、打包 smoke 或专用验收 smoke 证明 |
| ❌ 失败 | 0 | 无 |
| ⚠️ 跳过 | 9 | 仅限真实 Electron GUI / macOS 系统权限 / live Provider / 本机应用置前 / 默认浏览器打开场景，已写入人工验证步骤 |
| 阻塞 | 0 | 无阻塞 |

## 命令证据

| 命令 / smoke | 结果 | 摘要 |
| --- | --- | --- |
| `npm run typecheck` | ✅ | TypeScript 检查通过 |
| `npm run test:electron` | ✅ | 96/96 通过；覆盖 omni intent SDK 工具隔离、`system.openApp` 注入防护、语音窗口 IPC、speech 多窗口路由、SDK system action normalizer、配置化规则解析审计、端到端问答审计、manual-only readiness 门禁、语音窗口状态机、settings.describe 纯函数与悬浮窗回显映射、omni 控件覆盖摘要、全 TSX 原生控件与非原生交互控件语义门禁 |
| `node --test electron/omni-intent-voice.test.mjs` | ✅ | 17/17 通过；覆盖 `settings.describe` 真实规则解析、模型设置与 controls topic 摘要纯函数、端到端问答审计、manual-only readiness 门禁、悬浮窗结果映射、SDK system action normalizer、语音窗口状态机、`system.openUrl` 安全 executor、非法 URL guard、控件语义标签、全 `src/**/*.tsx` 原生控件 AST 门禁和非原生交互控件 AST 门禁 |
| `npm run audit:omni-controls` | ✅ | 输出 35 个 TSX 文件、176/176 原生控件、52/52 非原生交互控件、missing 0；与 `settings.describe.controls` 运行时摘要共用审计口径 |
| `npm run audit:omni-rules` | ✅ | 7/7 通过；直接调用 omni-ui `createConfiguredRuleResolver`，验证模型厂商统计、控件接入统计、搜索设置与 Google/谷歌安全网页问句命中预期 action，并确认 Safari 开放应用名不被本地规则误匹配 |
| `npm run audit:omni-answers` | ✅ | 3/3 通过；串联配置化规则解析、`settings.describe` 快照读取和 `voice-result` 回显映射，验证模型厂商、控件接入统计、当前页面摘要会产出安全的命令窗口答案 |
| `npm run audit:omni-manual-readiness` | ✅ | 9/9 通过；检查剩余 manual-only 场景的 acceptance 跳过状态、人工验证步骤、全量清单行与源码支撑 |
| TypeScript AST 控件审计 | ✅ | 35 个 TSX 文件中 176/176 个原生 `<button|input|select|textarea>` 控件具备 `data-mm-*` 或语义 ref 覆盖，gap 0 |
| TypeScript AST 非原生交互审计 | ✅ | 35 个 TSX 文件中 52/52 个自定义交互元素具备 `data-mm-*`、`semantic` prop 或语义 ref 覆盖，gap 0 |
| `node --test electron/claude-agent-runner-web-search.test.mjs electron/agent-mode-settings-store.test.mjs` | ✅ | 19/19 通过；覆盖 Brave/Tavily Key 池 fallback、聚合失败脱敏、Provider Test fallback 元数据和旧单 Key 到单元素池迁移 |
| WebSearch Key Pool selector/source audit | ✅ | 23 项源码核对通过；覆盖 `[data-testid="web-search-key-pool"]`、Key 池输入、保存按钮、Provider Test 状态、上移/下移/删除/添加控件和脱敏 fallback 代码路径 |
| `npm run test:home-plugin` | ✅ | 命令执行成功；当前仓库无 `.agents/home-plugins/project-home`，脚本按预期跳过 |
| `node test-results/full-acceptance-smoke.mjs` | ✅ | 覆盖 Agent Mode、runtime context、Generative UI、Home Plugin、模型设置、任务 Home Plugin |
| `bash .codex/scripts/check-acceptance.sh --all` | ✅ | 11 个 acceptance 契约结构检查通过 |
| `python3 .codex/scripts/agentic_drift_check.py` | ✅ | 11 个 acceptance 契约 inspected，无状态漂移失败 |
| `git diff --check` | ✅ | 无 whitespace 错误 |
| `./node_modules/.bin/vite build` | ✅ | renderer、Electron main/preload build 通过 |
| `npm run build:local` | ✅ | 本地 Electron 打包通过，生成 macOS app/dmg/zip blockmap；本地模式按预期跳过 notarization |
| `npm run build` | ✅ | 生成 `dist/index.html` + `dist/voice.html`，Electron main/preload build 通过，生成 macOS app/dmg/zip；notarization 因未配置选项按预期跳过 |
| `curl -I http://127.0.0.1:5181/` | ✅ | Preview server 返回 HTTP 200 |
| Chrome headless preview smoke | ✅ | 空工作区页面非空渲染，存在 `初始化工作区`、`添加你的第一个项目`、`选择文件夹` 等关键 UI |
| `npm run lint` | ⚠️ | `package.json` 未定义 `lint` script |
| `npm run test` | ⚠️ | `package.json` 未定义通用 `test` script；项目使用 `test:electron` / `test:home-plugin` |

## 模块映射

| 模块 | 场景数 | 结果 | 主要证据 |
| --- | ---: | --- | --- |
| `prd/agent-mode/acceptance.md` | 11 | 11 ✅ | `full-acceptance-smoke`、`test:electron`、MCP selector audit |
| `prd/agentos/acceptance.md` | 4 | 4 ✅ | `test:electron`、Chrome preview screenshot |
| `prd/chat-agent-runtime/acceptance.md` | 20 | 20 ✅ | `test:electron`、`full-acceptance-smoke`、Provider smoke、MCP selector audit、WebSearch Key Pool tests |
| `prd/desktop-shell-settings-release/acceptance.md` | 21 | 18 ✅ / 3 ⚠️ | `typecheck`、`test:electron`、`build:local`、browser smoke、manual-only notes、manual readiness audit、WebSearch Key Pool selector/source audit |
| `prd/file-context/acceptance.md` | 6 | 6 ✅ | `test:electron` project-content coverage |
| `prd/home-plugin/acceptance.md` | 6 | 6 ✅ | `full-acceptance-smoke` Home Plugin runner coverage |
| `prd/model-settings/acceptance.md` | 10 | 10 ✅ | `full-acceptance-smoke`、`test:electron`、MCP selector audit |
| `prd/multimodal-voice-control/acceptance.md` | 22 | 16 ✅ / 6 ⚠️ | `typecheck`、`test:electron`、`node --test electron/omni-intent-voice.test.mjs`、TypeScript AST 控件审计、source audit、manual-only notes、manual readiness audit |
| `prd/persistence/acceptance.md` | 6 | 6 ✅ | `test:electron` workspace-session coverage、source audit |
| `prd/task-home-plugin/acceptance.md` | 8 | 8 ✅ | `full-acceptance-smoke` Task Home Plugin coverage |
| `prd/workspace-session/acceptance.md` | 6 | 6 ✅ | `test:electron` workspace-session coverage、Chrome preview screenshot |

## 跳过项

| 模块/场景 | 原因 | 本地人工验证步骤 |
| --- | --- | --- |
| `desktop-shell-settings-release` / 启用 close-to-tray | 需真实 Electron 托盘与窗口关闭事件 | 打开 Electron 应用，开启“关闭到托盘”，点击窗口关闭按钮，确认主窗口隐藏且托盘图标可恢复窗口 |
| `desktop-shell-settings-release` / 用户开始语音输入 | 需真实 macOS 语音/麦克风权限与 speech helper 事件 | 打开 Electron 应用，点击“语音输入”，授权麦克风/语音识别，确认输入框收到转写文本 |
| `desktop-shell-settings-release` / 用户拒绝语音权限 | 需真实 macOS 权限拒绝状态 | 在系统设置中拒绝应用麦克风/语音识别权限，点击“语音输入”，确认页面显示权限恢复提示 |
| `multimodal-voice-control` / 规则未命中时由 SDK 解析执行 | 需真实可用模型 Provider 与 live SDK 调用 | 配置 Provider，提交规则无法命中的口语命令，确认 `[omni-intent] start/done` 日志与主窗口 action 执行 |
| `multimodal-voice-control` / 快捷键唤起悬浮窗并完成一次语音命令 | 需真实 Electron GUI、全局快捷键、麦克风与语音识别授权 | 按 Option+Space 或托盘入口打开悬浮窗，录音“新建对话”，停止并提交，确认主窗口新建 thread |
| `multimodal-voice-control` / 语音权限拒绝 | 需真实 macOS 权限拒绝状态 | 在系统设置中拒绝麦克风或语音识别权限，悬浮窗点击开始，确认恢复提示与可重试状态 |
| `multimodal-voice-control` / helper 进程异常退出可恢复 | 需真实 speech helper 进程与窗口状态观察 | 录音中 kill `AgentOS Speech Helper`，确认悬浮窗错误提示且再次开始可恢复 |
| `multimodal-voice-control` / 打开常用应用 | 会真实启动本机应用并依赖 live Provider + GUI 回显 | 配置可用 Provider 后提交“打开 Safari 应用”，确认 SDK 解析、Safari 置前且悬浮窗/命令入口回显“已打开 Safari” |
| `multimodal-voice-control` / 打开 Google 页面 | 需真实 Electron GUI 与默认浏览器副作用 | 提交“打开 Google 页面”，确认默认浏览器打开 `https://www.google.com` 且命令入口回显“已打开 Google 页面” |

## 证据文件

| 文件 | 说明 |
| --- | --- |
| `test-results/verification-summary.md` | 本轮正式验收汇总 |
| `test-results/full-acceptance-smoke.mjs` | 全量补充 smoke 脚本 |
| `test-results/full-acceptance-smoke-output.json` | smoke 输出 JSON |
| `test-results/agentos-preview-empty-workspace.png` | Chrome headless 空工作区截图 |
| `test-results/multimodal-voice-control-verification.md` | omni-ui 多模态融合与语音控制正式验收细证据 |

## 增量验收：omni 控件语义与 settings.describe（2026-07-05）

| 模块/场景 | 验证步骤 | 预期结果 | 状态 | 证据类型 | 证据 | 可回归 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `multimodal-voice-control` / 命令窗口读取模型设置页安全摘要 | 运行 `npm run audit:omni-answers`、`npm run audit:omni-rules`、`node --test electron/omni-intent-voice.test.mjs`、`npm run test:electron` 和 TypeScript AST 控件审计 | 「现在设置了多少模型厂商」经真实配置化规则解析命中 `settings.describe`，回显 provider 数量/名称/当前模型/API Key 配置状态摘要，不泄露 Key 明文 | ✅ | unit/integration + static | 17/17 targeted；96/96 electron；answer audit 3/3；rule audit 7/7；176/176 native AST；52/52 custom AST | 是 | 真实 GUI 回显由独立命令窗口 selector 提供，本轮不启动 Electron 窗口 |
| `multimodal-voice-control` / 命令窗口读取 omni 控件接入统计 | 运行 `npm run audit:omni-answers`、`npm run audit:omni-rules`、`node --test electron/omni-intent-voice.test.mjs` 与 `npm run audit:omni-controls`，校验 controls topic 真实规则解析、悬浮窗结果映射和 `coverage-summary` 与 AST 审计对账 | 「还有多少控件没有实现」命中 `settings.describe.controls`，回显静态缺口、原生/非原生覆盖数、当前页面对象数，并说明 manual-only 不等于控件缺口 | ✅ | unit/integration + static | 17/17 targeted；96/96 electron；answer audit 3/3；rule audit 7/7；audit missing 0 | 是 | 运行时可回答控件接入数量，真实 GUI 回显仍由独立命令窗口 selector 复验 |
| AgentOS 全 TSX 原生控件 omni 显式语义 | TypeScript AST 遍历 `src/**/*.tsx` 中的 `<button>`、`<input>`、`<select>`、`<textarea>` | 每个控件具备 `data-mm-*` 或语义 ref；敏感字段只标记 sensitive | ✅ | static + unit/integration | 35 个 TSX 文件，176/176，gap 0 | 是 | 覆盖主窗口、设置页、项目首页、Composer、状态、文件面板、独立语音命令窗口与侧栏上下文菜单 |
| AgentOS 非原生交互元素 omni 显式语义 | TypeScript AST 遍历 `src/**/*.tsx` 中的链接、summary、role button/menuitem/option/separator 与自定义点击控件 | 每个自定义交互控件具备 `data-mm-*`、`semantic` prop 或语义 ref；纯 dialog/listbox 容器和 backdrop/panel 容器不计入控件 | ✅ | static + unit/integration | 35 个 TSX 文件，52/52，gap 0 | 是 | 覆盖 API Key 获取链接、关于页链接、侧栏分隔条、TODO 卡片、file diff/status summary 等 |
| `multimodal-voice-control` / 语音悬浮窗状态机自动化部分 | 运行 `node --test electron/omni-intent-voice.test.mjs` 并导入 `src/voice-state.ts` 纯状态模块 | final 文本优先提交；`speech_denied` 产生权限恢复提示；`helper_exited` 进入错误但可重试状态；过期执行结果不污染当前命令 | ✅ | unit/integration | targeted state reducer test | 是 | 真实 macOS 权限、全局快捷键、speech helper 进程和 GUI 回显仍按上方 ⚠️ 人工项复验 |
| `multimodal-voice-control` / 非法网页地址不执行 | 运行 `node --test electron/omni-intent-voice.test.mjs` 并审计 `normalizeExternalUrl` / `openExternal` IPC | 非 HTTP/HTTPS 或无有效 host 的 URL 被拒绝，返回 `invalid_url`，不调用默认浏览器 | ✅ | unit/integration + static | targeted test + source audit | 是 | 不依赖真实浏览器 |
| `multimodal-voice-control` / 打开 Google 页面 | 运行配置化规则审计、SDK system action normalizer 测试并复查 `system.openUrl` executor；真实打开留给用户本机 GUI | Google/谷歌本地安全规则会直接命中 `system.openUrl`，SDK 输出也会绑定回当前 page target，安全 executor 存在；默认浏览器真实打开需人工确认 | ⚠️ | skipped + unit/integration + static | targeted test + 用户本地步骤 | 否 | 需真实 Electron GUI 与默认浏览器副作用 |
| AgentOS 剩余 manual-only 场景 readiness 门禁 | 运行 `npm run audit:omni-manual-readiness` | 9 个跳过场景均保留 acceptance 跳过状态、人工验证步骤、全量清单行和源码支撑；manual-only 不被误计为控件接入缺口 | ✅ | static + docs + source audit | 9/9 readiness | 是 | 这些场景仍需真实 GUI / macOS 权限 / live Provider / 默认浏览器副作用才能盖 ✅ |

## 增量验收：WebSearch API Key 池（2026-06-24）

| 模块/场景 | 验证步骤 | 预期结果 | 状态 | 证据类型 | 证据 | 可回归 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `chat-agent-runtime` / API Key 池按顺序轮询 | 运行 `node --test electron/claude-agent-runner-web-search.test.mjs electron/agent-mode-settings-store.test.mjs` 与 `npm run test:electron` | Brave/Tavily 在前置 Key 认证/配额失败时尝试后续 Key，成功结果带脱敏 `credential` 元数据 | ✅ | unit/integration | 19/19 targeted；78/78 electron | 是 | 不调用真实外网 Key，使用 mock fetch |
| `chat-agent-runtime` / API Key 池全部失败时脱敏汇总 | 运行同上 targeted/electron 测试 | 聚合错误包含失败类型数量和恢复建议，不包含 API Key、Bearer、完整 header | ✅ | unit/integration | 19/19 targeted；78/78 electron | 是 | 覆盖 auth + quota 组合失败 |
| `desktop-shell-settings-release` / 配置 Provider API Key 池 | 执行 WebSearch Key Pool selector/source audit | 设置页存在 Key 池列表、输入、添加、删除、上移、下移稳定控件，且保留池顺序逻辑 | ✅ | static | 23 项 selector/source audit | 是 | Electron GUI 点击未单独启动，使用源码与测试证据 |
| `desktop-shell-settings-release` / 保存并重载 Provider API Key 池 | 运行 `electron/agent-mode-settings-store.test.mjs` 与 source audit | 受控设置保存数组字段，旧单 Key 迁移为单元素池，空白条目被归一化移除且不泄漏明文 | ✅ | unit/integration | 19/19 targeted；78/78 electron | 是 | 覆盖 store 持久化与归一化 |
| `desktop-shell-settings-release` / 测试 Provider API Key 池 | 运行 `electron/claude-agent-runner-web-search.test.mjs` 与 source audit | Provider Test 按池顺序 fallback，成功状态显示 fallback 尝试元数据，不展示 Key 明文 | ✅ | unit/integration + static | 19/19 targeted；23 项 selector/source audit | 是 | 使用 mock fetch，不依赖真实 Provider |

## 未覆盖项

- 真实 Brave/Tavily 外网成功搜索不作为本轮通过条件；请求映射、缺凭据、HTTP 错误分类与脱敏通过本地测试和 Provider smoke 验证。
- Electron 托盘、macOS 语音/麦克风权限、全局快捷键、live Provider 意图识别、真实打开本机应用和默认浏览器网页打开必须在用户本机 GUI 中人工确认，已在对应 acceptance 场景标记为 `⚠️`。
- 全页面点击式 Playwright E2E 尚未沉淀为仓库脚本；本轮以 Electron 单元/集成测试、selector audit、浏览器 smoke 和专用 Node smoke 组合验收。

## 剩余 manual-only 场景复验（2026-06-24）

| 模块/场景 | 本轮动作 | 状态 | 证据类型 | 结论 |
| --- | --- | --- | --- | --- |
| `desktop-shell-settings-release` / 启用 close-to-tray | 复查 `electron/main.ts` close handler、托盘恢复入口；运行 `npm run typecheck`、`npm run test:electron`、`check-acceptance --all`、drift check | ⚠️ | skipped + static | 代码路径存在，但仍需真实 Electron 托盘与窗口关闭事件确认，不能无 GUI 证据盖 ✅ |
| `desktop-shell-settings-release` / 用户开始语音输入 | 复查 `electron/speech-recognition.ts` status/partial/final 转发；运行当前集成测试 | ⚠️ | skipped + static | 事件桥接代码存在，但需真实 macOS Speech/Microphone 授权和 speech helper 事件，不能无系统权限证据盖 ✅ |
| `desktop-shell-settings-release` / 用户拒绝语音权限 | 复查 speech helper error 转发与状态置错路径；运行当前集成测试 | ⚠️ | skipped + static | 错误事件路径存在，但需真实 macOS 权限拒绝状态，不能无系统权限证据盖 ✅ |
