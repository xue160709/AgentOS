# 产品总览技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `package.json` | 应用元数据、脚本、Electron/Vite/React 依赖。 |
| `README.md` | 当前用户侧产品介绍与功能清单。 |
| `src/main.tsx` | 渲染进程入口。 |
| `src/components/AppShell.tsx` | 应用壳层与主视图组织。 |
| `src/components/AppShellWorkspace.tsx` | 工作区级 UI 编排。 |
| `src/desktop-seam.ts` | 渲染层可访问桌面能力的命名 seam。 |
| `src/desktop-api.ts` | `window.desktop` 类型契约。 |
| `electron/main.ts` | Electron 主进程、窗口、IPC、Agent runner 和桌面能力。 |
| `electron/preload.ts` | 受控 preload 桥接。 |
| `src/i18n/i18n.tsx`、`src/locales/zh.json`、`src/locales/en.json` | 双语 UI 与文案回退。 |
| `src/app-metadata.ts` | 产品名、作者、仓库等共享元数据。 |

## 数据结构

- `DesktopAPI`：渲染层可调用的桌面能力集合。
- `DESKTOP_INVOKE_CHANNELS` / `DESKTOP_EVENT_CHANNELS`：能力名到 IPC channel 的唯一映射。
- `AppUiLocale`：UI 语言规范化为 `zh` / `en`。

## 调用链路

```text
React renderer
  -> window.desktop / window.claudeChat
  -> electron/preload.ts
  -> electron/main.ts IPC handlers
  -> 文件、Agent SDK、设置、语音、更新等主进程能力
```

## 日志与调试

- 主进程日志集中在 runner、settings、speech、update 等模块，必须脱敏。
- 桌面 seam 变更先检查 `desktop-seam.test.mjs`，避免 preload/main 注册漂移。

## 测试与验收

- 自动测试：`electron/desktop-seam.test.mjs`、`electron/window-chrome.test.mjs`。
- 建议自检：`npm run typecheck`、`npm run test:electron`。
- 验收契约：`prd/agentos/acceptance.md`。

## 边界情况

- 渲染层不得暴露通用 `ipcRenderer`。
- 外链只允许 HTTP(S) 走系统浏览器。
- 产品文档不能把历史 `prd-old/` 目标直接写成当前事实。

## TODO 对应项

- `TODO.md §14`：产品 PRD 初始化与后续差距。

## 最近同步

- commit：`bb8d2b04de464f1a09decc875f2e869afe8885fb`
- 日期：`2026-06-23`
- 变化摘要：首次创建 `prd/` 产品文档体系。
- 待确认：正式验收尚未执行。

