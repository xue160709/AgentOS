# R3-FIX-USER-01｜项目首页选中态回退与 Runtime 文案命名空间

> 来源：2026-08-30 用户在真实应用内使用后报告两处 `R3-06` 缺陷。`R3-CHECK-02` 的 `PASS_WITH_RISK` 未能发现它们，因为两条都只在真实渲染路径出现，而现有断言是 source-grep 与纯 Main 契约测试。补记单：实现先于任务单落盘，按执行规则 5 在同轮补齐单据与证据。

## 问题与目标

**缺陷 1（P0，违反 `C-RDS-302` / `ATDD-RDS-301`）** 项目首页仍会异步跳到工作台。入口本身是干净的：项目首页只发 `{projectId,mountId}`，不调 `openWorkspaceTab`。跳转来自选中态被 Main 的陈旧值覆盖：

- broker mode 下 renderer 不再持久化选中态（`src/components/AppShell.tsx` autosave 仅 `legacy`），`WorkspaceCommand` 也没有 selection variant，所以用户离开工作台 Tab 时 Main 永远不会被告知，`activeWorkspaceTabId` 长期停留在上一次打开的 Tab。
- `adoptAuthoritativeWorkspace` 把空 `activeThreadId`/`activeWorkspaceTabId` 当作"本地没有意见"：`next.workspaceTabs.some(id === '')` 恒为 false，于是回退到 Main 的旧 Tab。
- 项目首页切到"运行时"页签会发 `preferences.set`（`projectHomeViewModes`），命令回包立刻触发上述合并；`ensureTrustedProjectRuntime` 另有一处整份 `setChatWorkspace(authoritative)` 且把结果写入 localStorage，使跳转跨重启保留。
- `AppShellWorkspace` 中 `isRuntimeActive` 只要 `activeWorkspaceTabId` 非空就隐藏 `ChatPage`，因此覆盖发生时项目首页被工作台顶掉。

**缺陷 2（P0，违反 `C-RDS-309` / `ATDD-RDS-309`）** 工作台、侧栏 Runtime 行、项目首页 Runtime 头部的全部开发文案显示为原始 key。`R3-06` 新增的 25 条文案写进了旧的 `localApp` 段，而 `runtime-event-state.ts` 与 `AppShell.tsx` 读的是 `runtime.*`；`translate()` 找不到即原样返回路径。冻结文案"用 AI 修改/结束修改"因此从未真正显示过。另有既有遗留：`previewNavigation` 一直只在 `localApp` 段，`AppShellWorkspace` 按 `runtime.previewNavigation` 读取。

目标：让空选中态成为受尊重的渲染层事实，让 `R3-06` 的冻结文案真正解析；不扩大 selection 的所有权改造范围。

## 派发与 allowlist

- `write_mode=writer`，`attempt=1`；补记单，implementation 由主任务在用户授权下直接执行。
- 仅允许修改：
  - `src/components/workspace-command-client.ts`
  - `src/components/AppShell.tsx`
  - `src/locales/en.json`
  - `src/locales/zh.json`
  - `electron/workspace-command-client.test.mjs`
  - `electron/ui-locale-keys.test.mjs`（新增）

不得改动：Main selection 所有权、`WorkspaceCommand` DTO、workspace store、Runtime coordinator/window/registry、`localApp` 段中仍被 `LocalAppPreview.tsx` / `LocalAppWorkspace.tsx` 使用的旧键。

## 必测

- 空选中态：项目首页（`activeThreadId=''`、`activeWorkspaceTabId=''`）合并 Main 快照后仍为空，`activeLocalAppTabId` 同步；已存在的"保留当前选择"与"选择消失时回退 Main"两条断言不得改变语义。
- 文案：源码内全部静态 `t('a.b')` 键在 zh/en 两份目录都解析为字符串；`runtime.modifyWithAi`、`runtime.endModification`、`runtime.development*`、`runtime.switchToActiveRuntime`、`runtime.previewNavigation` 必须位于渲染层实际读取的命名空间。

```bash
npm run typecheck
node --test electron/ui-locale-keys.test.mjs electron/workspace-command-client.test.mjs
npm run test:electron
npx vite build
git diff --check
```

若必须改 Main 的 selection 权威、为项目首页新增导航副作用，或用兼容 fallback（例如同时在两个命名空间保留同一条文案）绕过命名空间问题，立即停止报告。

## 已知遗留（不在本单范围）

冷启动仍按 Main 记录的 `activeWorkspaceTabId` 直接进入工作台：`restoreWorkspaceSessionState` 在项目首页分支保留该字段，而 Main 的值依旧陈旧。彻底收口需要新增 `selection.set` 命令让 Main 跟随，或在 adopt/restore 时整体剥离 Main 的 selection 字段——两者都要改 workspace 契约与持久化，另开工单。
