# 桌面外壳、设置与发布技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `electron/main.ts` | BrowserWindow、托盘、single instance、IPC、偏好、文件/聊天桥接。 |
| `electron/preload.ts` | `desktop` 与 `claudeChat` 受控桥接。 |
| `electron/window-chrome.ts` | 平台窗口 chrome。 |
| `electron/app-menu.ts`、`electron/about-panel.ts` | 应用菜单与 About 面板。 |
| `electron/desktop-preferences-store.ts` | 桌面偏好读写。 |
| `electron/app-updater.ts` | GitHub Releases 自动更新。 |
| `electron/speech-recognition.ts` | macOS Apple Speech helper 管理。 |
| `native/speech-cli/SpeechCLI.swift` | Swift 语音 helper。 |
| `electron-builder.config.cjs`、`electron-builder.json5` | 打包、发布和平台资源配置。 |
| `docs/RELEASE.md`、`docs/release.sh` | 发布流程文档和脚本。 |
| `electron/desktop-seam.test.mjs`、`electron/window-chrome.test.mjs` | 桌面 seam 与窗口 chrome 测试。 |
| `src/components/setting/ClaudeAgentSettingsPage.tsx` | 全局模型、MCP 与搜索设置页的渲染入口；搜索页承载 native/AgentOS 模式、Provider、结果数、Provider Key 输入和 Provider Test 状态。 |
| `src/components/setting/SettingsPage.tsx`、`src/components/app-shell-constants.ts` | 设置分类路由、侧栏入口和 `#settings/search` 解析。 |
| `src/desktop-types.ts`、`src/desktop-api.ts`、`src/desktop-seam.ts` | 全局搜索设置与 Provider Test 类型、受控 desktop adapter 和 IPC channel 契约。 |
| `electron/agent-mode-settings-store.ts`、`electron/agent-mode-settings-store.test.mjs` | 全局 MCP 与全局 WebSearch 设置持久化、归一化和 store 单测。 |
| `src/components/chat/ProjectHomeSurface.tsx`、`src/components/AppAgentStatusPopover.tsx` | 项目 MCP 开关覆盖与状态面板跳转的主要 UI seam。 |

## 数据结构

- `DesktopPreferences`：closeToTray、openAtLogin、eyeComfortMode、locale。
- `AppUpdaterState`：更新阶段、版本、release notes、进度和错误。
- `SpeechRecognitionSnapshot` / `SpeechRecognitionEvent`：语音状态、partial/final/error。
- `DESKTOP_SEAM_CAPABILITIES`：所有命名桌面能力。
- MCP 设置入口：全局设置页管理 MCP server 定义、全局开关和连接测试缓存；项目 Agent 设置模态只保存当前项目开关覆盖和 tool policy；Chat 状态面板可跳转到当前项目 MCP 面板。
- `AgentWebSearchSettings`：`mode` 为 `native` 或 `agentos`，`provider` 为 `duckduckgo` / `brave` / `tavily`，并保存默认结果数、Brave/Tavily Key 或环境变量引用；旧值 `duckduckgo-instant` 会归一化为 `duckduckgo`。
- `AgentWebSearchProviderTestResult`：搜索 Provider 连接测试的成功/失败、凭据状态、错误分类和恢复建议。

## 调用链路

```text
Electron app ready
  -> install menu/about/preferences/updater
  -> createWindow + preload
  -> register desktop/claude IPC
  -> renderer 通过 window.desktop / window.claudeChat 调用

packaged update
  -> appUpdaterService.scheduleUpdateChecks
  -> electron-updater
  -> app-updater:event 推送 UI

search settings
  -> #settings/search
  -> GlobalWebSearchSettingsPage
  -> window.desktop.getGlobalWebSearchSettings / saveGlobalWebSearchSettings / testGlobalWebSearchProvider
  -> desktop:get-global-web-search-settings / desktop:save-global-web-search-settings / desktop:test-global-web-search-provider
  -> AgentModeSettingsStore.globalWebSearchSettings
  -> ClaudeAgentRunner.resolveWebSearchSettings
```

## 日志与调试

- 自动更新错误写入 `AppUpdaterState.errorMessage`，UI 通过状态展示。
- Speech helper stderr 进入 warn；helper 事件通过 Unix socket NDJSON 转 IPC。
- 剪贴板 SVG/PNG 有大小与尺寸限制，避免异常大数据写入系统剪贴板。
- 搜索设置页和主进程只记录是否保存、Provider id、结果数等摘要；Brave/Tavily API Key 不应进入日志、状态面板或错误摘要明文。

## 测试与验收

- 自动测试：`electron/desktop-seam.test.mjs`、`electron/window-chrome.test.mjs`、`electron/agent-mode-settings-store.test.mjs`。
- 搜索设置选择器：`[data-testid="global-web-search-settings-page"]`、`[data-testid="web-search-mode-options"]`、`[data-testid="web-search-provider-options"]`、`[data-testid="web-search-provider-test"]`、`[data-testid="web-search-provider-test-status"]`、`[data-testid="web-search-key-status"]`、`[data-testid="web-search-settings-save"]`。
- 构建验证按需运行：`npm run build:local` 或 `npm run build`，不作为日常默认自检。
- 验收契约：`prd/desktop-shell-settings-release/acceptance.md`。

## 边界情况

- 开发环境 `updatesSupported: false`。
- close-to-tray 开启时窗口关闭会隐藏而不是退出。
- 第二个实例启动会聚焦已有窗口。
- 非 macOS 语音状态为 unsupported。
- Apple 凭据缺 Team ID 时 notarization 被禁用并输出警告。
- MCP 设置跳转依赖当前项目；没有活动项目或项目路径失效时，入口应禁用或展示恢复路径。
- MCP 连接测试可能启动子进程或访问网络，设置页应有加载、取消/超时、禁用和错误状态。
- 搜索设置 bridge 不存在时页面展示可读错误；保存时会归一化 Provider、结果数和 Key 字段。
- DuckDuckGo 不需要 Key，普通 query 会直接读取 HTML 搜索结果；若遇到 bot challenge 或网络不可达，运行时返回空结果而不是工具错误。Brave/Tavily 需要 Key 或 `${ENV_NAME}` 引用，设置页 Provider Test 会展示 `configured / env-resolved / env-missing` 凭据状态和 auth/quota/bot-challenge/network/service 恢复提示。

## TODO 对应项

- `TODO.md §14`：补 release、自动更新、语音 helper 和打包验证证据。
- `TODO.md §15`：MCP 复制、删除确认、字段级修复提示、无项目空态、设置导航和搜索 Provider 连接测试/恢复文案均已补齐并完成正式验收。

## 最近同步

- commit：`a45dc7d89a7985e2f80903c9338f827ed58dd345`
- 日期：`2026-06-24`
- 变化摘要：同步未提交代码观察：全局设置新增 Search 分类和页面，preload/IPC/store 增加全局 WebSearch 设置读写与 Provider Test，运行时通过 resolver 读取该设置并影响 Agent 搜索路由；设置页可测试 DuckDuckGo/Brave/Tavily 并显示字段级凭据状态和恢复文案。
- 已确认：搜索与 MCP 相关 `project-verify` 已执行。
- 待确认：release/packaged 更新、语音 helper 仍待补证据。
