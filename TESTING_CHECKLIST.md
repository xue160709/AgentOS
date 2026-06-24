# AgentOS 全量验收清单

最后更新：2026-06-24
主框架：Electron + React + Vite
验证类别：正式验收（project-verify）
验证范围：`prd/*/acceptance.md` 全部 10 个模块、93 个场景

## 结论

| 状态 | 数量 | 说明 |
| --- | --- | --- |
| ✅ 通过 | 90 | 可通过单元/集成测试、静态源代码审计、浏览器 smoke、打包 smoke 或专用验收 smoke 证明 |
| ❌ 失败 | 0 | 无 |
| ⚠️ 跳过 | 3 | 仅限真实 Electron GUI / macOS 系统权限场景，已写入人工验证步骤 |
| 阻塞 | 0 | 无阻塞 |

## 命令证据

| 命令 / smoke | 结果 | 摘要 |
| --- | --- | --- |
| `npm run typecheck` | ✅ | TypeScript 检查通过 |
| `npm run test:electron` | ✅ | 69/69 通过；覆盖 workspace session、chat runtime、project content、desktop seam、window chrome、model pick、MCP、WebSearch 等 |
| `npm run test:home-plugin` | ✅ | 命令执行成功；当前仓库无 `.agents/home-plugins/project-home`，脚本按预期跳过 |
| `node test-results/full-acceptance-smoke.mjs` | ✅ | 覆盖 Agent Mode、runtime context、Generative UI、Home Plugin、模型设置、任务 Home Plugin |
| `bash .codex/scripts/check-acceptance.sh --all` | ✅ | 10 个 acceptance 契约结构检查通过 |
| `./node_modules/.bin/vite build` | ✅ | renderer、Electron main/preload build 通过 |
| `npm run build:local` | ✅ | 本地 Electron 打包通过，生成 macOS app/dmg/zip blockmap；本地模式按预期跳过 notarization |
| `curl -I http://127.0.0.1:5181/` | ✅ | Preview server 返回 HTTP 200 |
| Chrome headless preview smoke | ✅ | 空工作区页面非空渲染，存在 `初始化工作区`、`添加你的第一个项目`、`选择文件夹` 等关键 UI |
| `npm run lint` | ⚠️ | `package.json` 未定义 `lint` script |
| `npm run test` | ⚠️ | `package.json` 未定义通用 `test` script；项目使用 `test:electron` / `test:home-plugin` |

## 模块映射

| 模块 | 场景数 | 结果 | 主要证据 |
| --- | ---: | --- | --- |
| `prd/agent-mode/acceptance.md` | 11 | 11 ✅ | `full-acceptance-smoke`、`test:electron`、MCP selector audit |
| `prd/agentos/acceptance.md` | 4 | 4 ✅ | `test:electron`、Chrome preview screenshot |
| `prd/chat-agent-runtime/acceptance.md` | 18 | 18 ✅ | `test:electron`、`full-acceptance-smoke`、Provider smoke、MCP selector audit |
| `prd/desktop-shell-settings-release/acceptance.md` | 18 | 15 ✅ / 3 ⚠️ | `typecheck`、`test:electron`、`build:local`、browser smoke、manual-only notes |
| `prd/file-context/acceptance.md` | 6 | 6 ✅ | `test:electron` project-content coverage |
| `prd/home-plugin/acceptance.md` | 6 | 6 ✅ | `full-acceptance-smoke` Home Plugin runner coverage |
| `prd/model-settings/acceptance.md` | 10 | 10 ✅ | `full-acceptance-smoke`、`test:electron`、MCP selector audit |
| `prd/persistence/acceptance.md` | 6 | 6 ✅ | `test:electron` workspace-session coverage、source audit |
| `prd/task-home-plugin/acceptance.md` | 8 | 8 ✅ | `full-acceptance-smoke` Task Home Plugin coverage |
| `prd/workspace-session/acceptance.md` | 6 | 6 ✅ | `test:electron` workspace-session coverage、Chrome preview screenshot |

## 跳过项

| 模块/场景 | 原因 | 本地人工验证步骤 |
| --- | --- | --- |
| `desktop-shell-settings-release` / 启用 close-to-tray | 需真实 Electron 托盘与窗口关闭事件 | 打开 Electron 应用，开启“关闭到托盘”，点击窗口关闭按钮，确认主窗口隐藏且托盘图标可恢复窗口 |
| `desktop-shell-settings-release` / 用户开始语音输入 | 需真实 macOS 语音/麦克风权限与 speech helper 事件 | 打开 Electron 应用，点击“语音输入”，授权麦克风/语音识别，确认输入框收到转写文本 |
| `desktop-shell-settings-release` / 用户拒绝语音权限 | 需真实 macOS 权限拒绝状态 | 在系统设置中拒绝应用麦克风/语音识别权限，点击“语音输入”，确认页面显示权限恢复提示 |

## 证据文件

| 文件 | 说明 |
| --- | --- |
| `test-results/verification-summary.md` | 本轮正式验收汇总 |
| `test-results/full-acceptance-smoke.mjs` | 全量补充 smoke 脚本 |
| `test-results/full-acceptance-smoke-output.json` | smoke 输出 JSON |
| `test-results/agentos-preview-empty-workspace.png` | Chrome headless 空工作区截图 |

## 未覆盖项

- 真实 Brave/Tavily 外网成功搜索不作为本轮通过条件；请求映射、缺凭据、HTTP 错误分类与脱敏通过本地测试和 Provider smoke 验证。
- Electron 托盘和 macOS 语音/麦克风权限必须在用户本机 GUI 中人工确认，已在对应 acceptance 场景标记为 `⚠️`。
- 全页面点击式 Playwright E2E 尚未沉淀为仓库脚本；本轮以 Electron 单元/集成测试、selector audit、浏览器 smoke 和专用 Node smoke 组合验收。
