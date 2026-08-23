# 框架支持知识

## 适用范围

适用于 `02-project-prepare` 锁定开发方向和 `03-project-develop` 执行首版时的知识级判断。本文只说明工具形态与选择依据，是共享知识，不是当前项目的 adapter 清单、自动检查机制或框架配置。

## 人读 Framework Profile

以下是当前项目可供 02/03 阅读和核对的三条映射；它们是知识级选择依据，不是 adapter ID、schema 或自动检查配置：

| 工具形态 | Framework Profile | 当前 reference |
|---|---|---|
| 网站 | Next.js App Router + TypeScript | `.codex/skills/03-project-develop/references/nextjs.md` |
| 桌面软件 | Electron + electron-vite + React + TypeScript | `.codex/skills/03-project-develop/references/electron.md` |
| 浏览器插件 | Vite + React + TypeScript + Tailwind + Manifest V3 | `.codex/skills/03-project-develop/references/vite-web-extension.md` |

Profile 只表达“工具形态 → 人读技术起点 → 当前参考资料”的关系，不承诺某个版本、依赖、脚本或最终实现已经存在；实际可用能力仍须由主 Agent 依据当前仓库事实核对。

## 选择依据

1. 先使用 `01` 已确认的工具形态；Demo 文件名、图片外观或 README 文字不足以替代用户确认。
2. `02` 选择与工具形态和当前环境相容的开发路径，记录选择理由和未覆盖限制；不能让实现者临时猜测技术栈。
3. 没有匹配路径或存在多义时暂停进入开发，交回主 Agent 澄清或补齐准备事实。
4. 根 README 可以投影已确认的支持说明，但不能反向决定项目是否支持某项能力。
5. `03` 按冻结的选择实现；`update-prd` 只在代码事实形成后记录实际 as-built，不把规划选择冒充已实现能力。

## 本轮来源

本轮只读提炼日期：2026-08-16。来源：`/Volumes/macOS/Github/CodeNow/.codex/framework-adapters.json`、`/Volumes/macOS/Github/CodeNow/.codex/rules/lifecycle.md`、`/Volumes/macOS/Github/CodeNow/.codex/rules/runtime-contract.md`。只保留经当前仓库核对后仍成立的人读映射；源中的 adapter ID、schema、配置字段、版本承诺和运行时实现细节未迁入当前项目。
