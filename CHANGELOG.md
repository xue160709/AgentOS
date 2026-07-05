# CHANGELOG

本文件记录已经完成、值得后续用户或 Agent 知道的变更。修补 bug 后必须追加到 `Unreleased / Bug Fixes`。

## Unreleased

### Bug Fixes

- 2026-07-05: 修复语音命令「打开 Google 页面」被泛化为打开本机应用而不启动浏览器的问题，并让语音命令窗复用主 Composer 输入面板样式。处理：新增 `system.openUrl` 低风险 action，规则优先识别 Google/网页命令并经 `desktop.openExternal` 打开默认浏览器；语音窗改用 `.chat-composer` / `.chat-input` / Composer 按钮结构；验证：`npm run typecheck`、`node --test electron/omni-intent-voice.test.mjs`、`npm run test:electron`、`npx vite build --mode test`、`git diff --check`；范围：multimodal voice command rules、headless executor、voice command window UI。
- 2026-07-05: 修复语音命令悬浮窗使用错误的独立视觉 token / 墨绿色皮肤，导致与 AgentOS 主界面设计系统不一致。处理：移除 `desgin-system/DESIGN.md` 中 Voice Window 独立 token 记录，`src/voice.css` 改为引入并消费主 Design Token，窗口初始背景同步主窗口背景；验证：`npm run typecheck`、`git diff --check -- src/voice.css src/voice-main.tsx electron/main.ts desgin-system/DESIGN.md CHANGELOG.md`；范围：语音命令窗视觉样式与设计文档。
- 2026-07-05: 修复 omni 命令面板覆盖主窗口 Composer，以及 omni-ui Provider wrapper 打断主窗口高度链导致页面无法滚动、Composer 被裁掉。处理：移除主窗口可见 `omni-command-shell`，将主窗口改为 headless executor，并把文本输入、语音、确认与澄清交互迁移到独立可移动命令窗口；同时为 `div[data-mm-root]` 与 `MultimodalPage` 增加布局防护，保留语义注册但不参与主窗口排版；验证：`npm run typecheck`、`npm run test:electron`；范围：multimodal voice command runtime、AppShell 布局、Electron voice command window 与 Desktop Seam。
- 2026-06-24: 修复 release 版添加 stdio MCP 时 `spawn npx ENOENT`。处理：MCP runtime 为 stdio server 增强 release-safe PATH，优先解析用户级 Node 管理器与 Homebrew 常见命令为绝对路径，并把增强 PATH 传给连接测试与 SDK 子进程；验证：`npm run typecheck`、`node --test electron/claude-agent-runner-mcp.test.mjs`、`npm run test:electron`、`git diff --check`；范围：MCP stdio runtime 与全局连接测试。
- 2026-06-24: 修复 macOS release 公证失败时只暴露 `Unexpected token 'E'` JSON parse 噪声。处理：通过 npm overrides 将 electron-builder 间接依赖的 `@electron/notarize` 固定到 2.5.0，使 notarytool 非 JSON/HTTP 错误保留原始诊断文本；验证：`npm run typecheck`、`git diff --check`；范围：release 依赖锁与 macOS notarization 错误诊断。
- 2026-06-24: 修复 WebSearch 设置页展示无可靠生效路径的“默认结果数”。处理：移除搜索设置页、共享设置类型和持久化返回值中的默认结果数字段，保留单次 `web_search` 调用的 `max_results` 入参和固定兜底；验证：`npm run typecheck`、`node --test electron/claude-agent-runner-web-search.test.mjs electron/agent-mode-settings-store.test.mjs`、`bash .codex/scripts/check-acceptance.sh desktop-shell-settings-release`、`git diff --check`；范围：全局搜索设置页与 AgentOS WebSearch runtime。
- 2026-06-24: 修复 Agent 状态面板将 MCP runtime `pending` 误当成连接健康状态。处理：状态面板优先使用项目 MCP 连接测试缓存，连接成功显示绿灯和 tools 数，未测试/运行时 pending 显示橙灯“待检测”，仅连接失败/认证失败类状态显示红灯“未连接”；验证：`npm run typecheck`、`node --test electron/desktop-seam.test.mjs`、`git diff --check`；范围：Agent 状态面板 MCP 列表。
- 2026-06-24: 修复项目 MCP 设置在切换项目、关闭面板或自动测试期间的状态串台。处理：项目 MCP 设置加载、保存和探测增加项目路径与请求代际 guard，并拆分项目 MCP 的保存/测试 operation，自动测试不再显示为保存中；验证：`npm run typecheck`、`node --test electron/agent-mode-settings-store.test.mjs electron/claude-agent-runner-mcp.test.mjs electron/chat-run.test.mjs electron/desktop-seam.test.mjs`、`npm run test:electron`、`git diff --check`；范围：项目 MCP 设置面板。
- 2026-06-24: 修复进入全局 MCP 设置页时自动连接测试误显示“正在保存 MCP 设置”。处理：拆分全局 MCP 设置页的保存/测试事务状态，自动测试只展示测试中，保存按钮仅在真实保存时显示保存中；验证：`npm run typecheck`、`node --test electron/desktop-seam.test.mjs`、`npm run test:electron`；范围：全局 MCP 设置页。

### Process

- 2026-06-24: 新增协作约定：后续 bugfix 完成后必须写入本文件，并保留症状、处理方式和验证方式。
