# M0-04｜Project Chat Window 与 View State

## 目标

实现每项目唯一的独立原生 Chat 窗口 manager、固定项目 capability、跨关闭/重启 view state 与同 bundle 的最小页面壳。和 M0-03 一样，本单仍是 **disabled seam**：只允许测试直接构造 manager；不得从 `main.ts` 打开窗口或注册 production IPC。

## 依赖

- `M0-03` 完成。
- 精读 `design.md §6`、`technical.md §7`。

## Write allowlist

- `electron/project-chat-window-manager.ts`（新增）
- `electron/project-chat-window-manager.test.mjs`（新增）
- `electron/project-chat-view-state-store.ts`（新增）
- `electron/project-chat-view-state-store.test.mjs`（新增）
- `electron/project-chat-ipc.ts`（只允许补 window collaborator 所需的类型/adapter，不注册 IPC）
- `electron/project-chat-ipc.test.mjs`
- `electron/project-chat-broker.ts`（只允许补 snapshot 的最小项目摘要）
- `electron/project-chat-broker.test.mjs`
- `src/project-chat-contract.ts`
- `electron/project-chat-contract.test.mjs`
- `src/main.tsx`
- `src/components/chat/ProjectChatWindowPage.tsx`（新增最小壳）
- 与新壳直接对应的 CSS 文件（必须在回报中列出具体路径）

禁止写：`electron/main.ts`、`electron/preload.ts`、runner、`ChatPage.tsx`、workspace session、binding/deep link、Runtime。除上述 snapshot 项目摘要外不得改变 broker mutation/run/prompt 语义。禁止让窗口从 production UI/IPC 可达；M0-05 才做互斥 Main composition 与主 renderer cutover。

## 实施步骤

1. Manager 用 `Map<projectId, BrowserWindow>`；构造时注入 BrowserWindow factory、renderer entry、preload path、capability registry、route-generation getter、view-state store、display/bounds seam 与 `onWebContentsUnavailable(webContentsId)` callback，避免测试启动真实 Electron。重复 open 只 `show/focus`，不得新建第二窗。
2. 创建窗口必须保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox` 与当前主窗口安全基线一致，并由 manager 固定传入 `webPreferences.additionalArguments: ['--agentos-window-kind=project-chat']`（或在保留其它受控参数时包含该精确值）；query/renderer 不能改变 profile。BrowserWindow 创建后、load 前登记固定 `{projectId, routeGeneration}` capability。load reject、`closed`、webContents destroyed 任一发生都幂等清理 registry 与 map。本单不改 preload；M0-05 才按该参数收窄暴露。
3. dev 用同一 `VITE_DEV_SERVER_URL` document、packaged 用同一 `index.html`；只增加 query/route 选择 `ProjectChatWindowPage`。query 中 projectId 只用于页面发起 typed IPC，manager registry 才是授权事实；测试篡改 query 后仍不能越过 M0-03 wrong-project 校验。
4. view-state store 严格按 `technical.md §7.1`：schema v1；按 projectId 隔离；temp + rename 原子替换；解析失败把原文件改名为 `.corrupt-<timestamp>` 后从空状态恢复；draft 超过 100,000 UTF-16 code units 整次拒绝、不截断；patch 未提供字段保持原值；updatedAt 由 Main seam 写。
5. bounds 默认 1024×760、最小 720×560；保存/恢复都与注入的 display workArea 求可见交集，无交集或非法值时使用主 display 居中默认值。不得信任 renderer 给出的 display id。
6. manager/view controller 对 draft/selectedThreadId/externalTaskSeenAt/bounds 300ms debounce；blur 和 close 必须 flush。close/destroy 只保存 view state、注销 capability、幂等调用一次 `onWebContentsUnavailable` 供 M0-05 触发 Prompt owner failover、销毁视图；测试 runner/broker cancel 调用次数为 0。本单不直接实现 owner 选择或生产 broadcaster wiring。
7. 先按 `technical.md §4` 给 `ProjectChatSnapshot` 增加精确 `project: {id, name, pathMissing}`；broker 从 durable project 逐字段投影，绝不暴露 `path`。`src/main.tsx` 只按受限 window-kind route 选择最小 `ProjectChatWindowPage` 或既有 `AppShell`；普通主窗口行为不变。最小壳通过 `window.projectChat.getSnapshot(projectId)` 显示项目名/加载/项目移除/路径丢失/关闭入口；不得复制 reducer、WorkspaceSession 或完整 Chat 控件。
8. 本单测试必须 source-audit `electron/main.ts` 未 import/构造 manager、未注册 `project-chat:*`；`openProjectWindow` collaborator 仍只有测试注入，防止提前出现一半走 broker、一半走 Revision 1 的窗口。

## 必测断言

- 同 project 连续 open 只创建一次并 focus；不同 project 可各有一窗。
- BrowserWindow 安全选项和固定 project-chat additionalArgument 精确；register 在 load 前，load failure/destroy/close 均清理且幂等。
- close/destroy/load failure 对同一 webContents 只通知一次 unavailable，给后续 owner failover 使用。
- wrong-project/query 篡改仍由 capability 拒绝；Preview 不登记。
- view-state round-trip、字段 merge、draft 100,000/100,001 边界、corrupt backup、原子 rename、bounds clamp/居中、300ms debounce 与 blur/close flush。
- close 不调用 cancel；`main.ts`/旧 production Chat 路径零改动。
- 普通入口仍渲染 `AppShell`，project-window 入口只渲染最小壳。
- snapshot 项目摘要来自 durable project，路径正常/丢失均正确且不含本地 `path`；删除项目返回 `project-not-found`。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-window-manager.test.mjs electron/project-chat-view-state-store.test.mjs electron/project-chat-ipc.test.mjs electron/project-chat-broker.test.mjs electron/project-chat-contract.test.mjs electron/desktop-seam.test.mjs
```

## 停止并报告

如果独立入口必须复制一套 Vite bundle/config，或必须修改 `main.ts`/注册 production handler 才能测试，立即停止报告；不得提前做 M0-05 composition。若 Electron window/load lifecycle 无法用注入 seam 确定清理顺序，也停止，不用 timeout 猜测。
