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

## 数据结构

- `DesktopPreferences`：closeToTray、openAtLogin、eyeComfortMode、locale。
- `AppUpdaterState`：更新阶段、版本、release notes、进度和错误。
- `SpeechRecognitionSnapshot` / `SpeechRecognitionEvent`：语音状态、partial/final/error。
- `DESKTOP_SEAM_CAPABILITIES`：所有命名桌面能力。

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
```

## 日志与调试

- 自动更新错误写入 `AppUpdaterState.errorMessage`，UI 通过状态展示。
- Speech helper stderr 进入 warn；helper 事件通过 Unix socket NDJSON 转 IPC。
- 剪贴板 SVG/PNG 有大小与尺寸限制，避免异常大数据写入系统剪贴板。

## 测试与验收

- 自动测试：`electron/desktop-seam.test.mjs`、`electron/window-chrome.test.mjs`。
- 构建验证按需运行：`npm run build:local` 或 `npm run build`，不作为日常默认自检。
- 验收契约：`prd/desktop-shell-settings-release/acceptance.md`。

## 边界情况

- 开发环境 `updatesSupported: false`。
- close-to-tray 开启时窗口关闭会隐藏而不是退出。
- 第二个实例启动会聚焦已有窗口。
- 非 macOS 语音状态为 unsupported。
- Apple 凭据缺 Team ID 时 notarization 被禁用并输出警告。

## TODO 对应项

- `TODO.md §14`：补 release、自动更新、语音 helper 和打包验证证据。

## 最近同步

- commit：`bb8d2b04de464f1a09decc875f2e869afe8885fb`
- 日期：`2026-06-23`
- 变化摘要：按 Electron 主进程、preload、更新、语音和发布配置补齐 as-built PRD。
- 待确认：真实 packaged 更新和 notarization 需 release 环境验收。

