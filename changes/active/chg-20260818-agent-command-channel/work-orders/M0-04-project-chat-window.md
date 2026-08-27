# M0-04｜Project Chat Window 与 View State

## 目标

实现每项目唯一的独立原生 Chat 窗口、固定项目 capability 和跨关闭/重启 view state。此单只提供最小窗口壳，不迁移完整 Chat UI。

## 依赖

- `M0-03` 完成。
- 精读 `design.md §6`、`technical.md §7`。

## Write allowlist

- `electron/project-chat-window-manager.ts`（新增）
- `electron/project-chat-window-manager.test.mjs`（新增）
- `electron/project-chat-view-state-store.ts`（新增）
- `electron/project-chat-view-state-store.test.mjs`（新增）
- `electron/main.ts`
- `electron/preload.ts`
- `electron/project-chat-ipc.ts`（若已存在）
- `src/project-chat-contract.ts`
- `src/main.tsx`
- `src/components/chat/ProjectChatWindowPage.tsx`（新增最小壳）
- 与新壳直接对应的 CSS 文件（必须在回报中列出具体路径）

禁止写：`ChatPage.tsx`、workspace session、binding/deep link、Runtime。

## 实施步骤

1. Manager 用 `Map<projectId, BrowserWindow>`；重复 open 只 show/focus。
2. 创建安全 BrowserWindow，登记固定 project capability；load/destroy/close 均正确清理。
3. query/route 参数只选择 `ProjectChatWindowPage`，不作为授权。
4. view state store 按 schema v1 原子写、corrupt recovery、300ms debounce + blur/close flush、draft 上限、externalTaskSeenAt 与 bounds display clamp。
5. close 保存 state 且只销毁视图；测试 broker cancel 调用次数为 0。
6. 最小壳显示项目名、加载/项目移除/路径丢失状态和关闭入口，暂不复制完整 Chat。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-window-manager.test.mjs electron/project-chat-view-state-store.test.mjs electron/project-chat-ipc.test.mjs
```

## 停止并报告

如果独立入口必须复制一套 Vite bundle/config，先报告；优先同 bundle 条件渲染。
