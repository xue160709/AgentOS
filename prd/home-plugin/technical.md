# Home Plugin 数据卡片技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `electron/home-plugin-runner.ts` | Home Plugin 发现、只读沙箱运行、A2UI 输出归一化和布局保存。 |
| `src/desktop-types.ts` | Home Plugin manifest、run result、layout、task 类型。 |
| `src/components/chat/ProjectHomeSurface.tsx` | 项目首页卡片渲染、刷新、排序、设置和定制入口。 |
| `src/components/project-order.ts` | 项目/首页排序辅助。 |
| `electron/main.ts` | Home Plugin IPC handlers。 |
| `package.json` | `test:home-plugin` 校验脚本入口。 |

## 数据结构

- `HomePluginManifest`：id、name、version、entry、outputFormat、kind、preferredSize、threadId、order 等。
- `HomePluginRunItem`：单卡运行结果、outputHash、messages、variants、diagnostics。
- `HomePluginRunResult`：项目首页所有插件运行结果与排序。
- 内置 TODO card：从 `TODO.md` 的首页卡片表格生成 A2UI data model。

## 调用链路

```text
项目首页打开/刷新
  -> window.desktop.runHomePlugin
  -> runProjectHomePlugin
  -> 扫描内置 TODO 卡 + .agents/home-plugins
  -> VM 沙箱 run(host)
  -> 规范化 A2UI messages/variants
  -> ProjectHomeSurface 渲染卡片
```

## 日志与调试

- extractor 的 `console.log/warn` 会进入 diagnostics。
- 禁用 API、运行超时、输出非 object 会作为卡片 diagnostics 返回。
- host API 不应读取项目外路径。

## 测试与验收

- 自动校验：`npm run test:home-plugin`。
- 建议补充：针对 `runExtractor` 禁用能力、read limit、SQLite readonly 的单元测试。
- 验收契约：`prd/home-plugin/acceptance.md`。

## 边界情况

- `extractor.js` 禁止 `import`、`require`、`process`、`fetch`、`XMLHttpRequest`、`WebSocket`。
- 单次 run 有 5s timeout、单文件 256KB、总读取 2MB、文件列表 1200 项上限。
- SQLite 仅允许 SELECT/WITH 和少量 PRAGMA 元数据查询。
- 删除卡片前会通知任务管理器清理任务态。

## TODO 对应项

- `TODO.md §14`：补沙箱安全和 A2UI UI 正式验收。

## 最近同步

- commit：`bb8d2b04de464f1a09decc875f2e869afe8885fb`
- 日期：`2026-06-23`
- 变化摘要：按 Home Plugin runner 和项目首页卡片实现补齐 as-built PRD。
- 待确认：`test:home-plugin` 依赖 `.agents/skills/a2ui-project-home-panel`，缺失时脚本使用 `--allow-missing`。

