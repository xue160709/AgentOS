# Evidence

## 规划证据

- `2026-08-25`：用户确认先开发左侧 `New Tab` 机制，并接入 CodeNow Wiki；AgentOS 负责自动运行 `npm run dev`，用户不手动启动。
- `/Volumes/macOS/Github/codenow.wiki/package.json`：已核实项目名为 `codenow-wiki`，`dev` 脚本为 `next dev`。
- `src/components/AppShellSidebar.tsx`：当前侧栏已有新建线程、项目和线程列表入口，可作为 New Tab 接入 seam。
- `src/components/workspace-session.ts`、`src/chat-workspace-persistence.ts`：当前已有 Workspace Session durable snapshot 与恢复机制，可扩展但尚无 Local App 对象。
- `electron/main.ts`、`electron/preload.ts`、`src/desktop-seam.ts`：当前已有类型化 Desktop Seam，但尚无开发服务器、端口、进程树和预览运行时管理。

## 状态

- 产品、体验、技术与 ATDD 正式 PRD 同步：已完成（2026-08-25）。
- 业务代码实现：未开始。
- 正式验收：未开始。

## 文档同步证据

- 产品摘要：`prd/local-app-runtime/README.md`。
- Planned 产品设计：`prd/local-app-runtime/design.md`。
- Current/Planned 技术边界：`prd/local-app-runtime/technical.md`。
- 唯一验收契约：`prd/local-app-runtime/acceptance.md`，全部场景保持 `⬜ 未实现`。
- 开发入口：根 `TODO.md` 的 §1.1；Later 见 §2。
- 模块索引：`prd/README.md`。

## 剩余风险

- 生产级 Sandbox Provider 尚未确认和验证；在此之前只能运行用户显式信任的本地项目，不能宣称项目外访问被强制阻断。
- CodeNow Wiki live smoke 会启动外部项目进程，需在后续实现/验证阶段获得相应执行授权；本轮文档任务不启动。
