# AgentOS 全量验收清单

最后更新：2026-06-24
主框架：Electron + React + Vite
验证类别：正式验收（project-verify）
验证范围：`prd/*/acceptance.md` 全部 10 个模块、98 个场景；本轮增量覆盖 WebSearch API Key 池 5 个新增场景

## 结论

| 状态 | 数量 | 说明 |
| --- | --- | --- |
| ✅ 通过 | 95 | 可通过单元/集成测试、静态源代码审计、浏览器 smoke、打包 smoke 或专用验收 smoke 证明 |
| ❌ 失败 | 0 | 无 |
| ⚠️ 跳过 | 3 | 仅限真实 Electron GUI / macOS 系统权限场景，已写入人工验证步骤 |
| 阻塞 | 0 | 无阻塞 |

## 命令证据

| 命令 / smoke | 结果 | 摘要 |
| --- | --- | --- |
| `npm run typecheck` | ✅ | TypeScript 检查通过 |
| `npm run test:electron` | ✅ | 78/78 通过；覆盖 workspace session、chat runtime、project content、desktop seam、window chrome、model pick、MCP、WebSearch API Key 池等 |
| `node --test electron/claude-agent-runner-web-search.test.mjs electron/agent-mode-settings-store.test.mjs` | ✅ | 19/19 通过；覆盖 Brave/Tavily Key 池 fallback、聚合失败脱敏、Provider Test fallback 元数据和旧单 Key 到单元素池迁移 |
| WebSearch Key Pool selector/source audit | ✅ | 23 项源码核对通过；覆盖 `[data-testid="web-search-key-pool"]`、Key 池输入、保存按钮、Provider Test 状态、上移/下移/删除/添加控件和脱敏 fallback 代码路径 |
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
| `prd/chat-agent-runtime/acceptance.md` | 20 | 20 ✅ | `test:electron`、`full-acceptance-smoke`、Provider smoke、MCP selector audit、WebSearch Key Pool tests |
| `prd/desktop-shell-settings-release/acceptance.md` | 21 | 18 ✅ / 3 ⚠️ | `typecheck`、`test:electron`、`build:local`、browser smoke、manual-only notes、WebSearch Key Pool selector/source audit |
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
- Electron 托盘和 macOS 语音/麦克风权限必须在用户本机 GUI 中人工确认，已在对应 acceptance 场景标记为 `⚠️`。
- 全页面点击式 Playwright E2E 尚未沉淀为仓库脚本；本轮以 Electron 单元/集成测试、selector audit、浏览器 smoke 和专用 Node smoke 组合验收。
