# 性能优化交接说明

面向接手的 session。本文记录已完成的改动、必须守住的不变量、剩余待办的具体做法，以及验证方式。

- 基线审查报告（含全部实测图表）：https://claude.ai/code/artifact/f55781c6-b89c-4d13-a982-aef20070dde8
- 测量日期：2026-09-02，分支 `homepage-test`
- 全部改动尚未提交

---

## 1. 已完成，请勿重做

### 1.1 流式路径不再落盘（最大的一项）

**问题。** 主进程 broker 对每一个合并后的 delta 事件（合并窗口 50ms，最高约 20 次/秒）都执行一整轮全量工作区操作：同步读 5MB JSON 两次、重写全部会话 rollout 文件、同步 spawn 三次 `sqlite3` 并整表重建搜索索引、写回整份 JSON。成本与当前对话无关，只与工作区总量成正比。

**做法。** mid-run 事件只提交到内存投影，落盘交给运行的终止事件与节流。

| 文件 | 改动 |
| --- | --- |
| `electron/chat-workspace-store.ts` | 新增 `stage()`（内存提交 + 节流落盘，默认 5s）、`flushPending()`、`hasPendingDurableWrite()`，以及串行化的durable 写队列 `enqueueDurable()` |
| `electron/chat-broker-core.ts:380` | 计算 `terminalEvent`，通过 `saveThreadChatState(..., { durable })` 下传 |
| `electron/project-chat-broker.ts` | `readThread`、`saveThreadChatState`、`broadcastProjectSnapshot` 改用 `workspaceProjection()`；`saveMutation` 接受 `{ durable }` |
| `electron/main.ts` | 退出前 `flushPending()` |

**实测（`scripts/perf-bench-workspace-store.mjs`，真实 store 类 + 真实工作区）。**

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 单个 delta 事件 | 68.9 ms | 0.38 ms |
| 主线程占用率（20 事件/秒） | 137.8% | 0.77% |
| 一次 40 delta 回答合计 | 2756.9 ms | 83.7 ms |

修复前占用率超过 100%，意味着主进程追不上 Agent 输出速度。

### 1.2 附件缩略图化

**问题。** `ClaudeChatAttachment.dataUrl` 的定义是「UI 缩略图」，只渲染进 42px 的 `.attachment-thumb`，但两个录入路径都写入了原图。它是唯一能通过 `normalizeMessageAttachments` 进入持久化工作区的附件字段（`base64`/`text` 已被丢弃），所以一张截图会给之后每一次工作区读写和 broker 快照都加上几 MB。

**做法。**

| 文件 | 改动 |
| --- | --- |
| `src/chat-attachment-thumbnail.ts` | 新增。共享策略：`ATTACHMENT_THUMBNAIL_MAX_EDGE = 160`、`ATTACHMENT_THUMBNAIL_MAX_CHARS = 48000`、`thumbnailSizeFor()` |
| `electron/chat-attachment-thumbnail.ts` | 新增。`shrinkAttachmentThumbnail()`（`nativeImage`）与 `migrateAttachmentThumbnails()` |
| `electron/main.ts` | 文件选择器录入时缩略图化；启动时跑一次 `runAttachmentThumbnailMigration()` |
| `src/components/chat/ChatPage.tsx` | 剪贴板粘贴路径用 canvas 生成缩略图 |

**真实验证。** 迁移已在运行中的应用里实际执行：

| 附件 | 迁移前 | 迁移后 |
| --- | --- | --- |
| 截屏2026-04-23.png | 661,938 B | 6,594 B |
| MiniMax_TokenPlan_UsageReport.png | 576,730 B | 24,046 B |
| image.png | 1,016,478 B | 19,690 B |
| **工作区合计** | **3,636,257 B** | **1,433,066 B（−60.6%）** |

### 1.3 首屏体积

| 资源 | 修复前 | 修复后 |
| --- | --- | --- |
| `index.js` | 1345.0 KB | 1090.9 KB |
| `index.css` | 294.3 KB | 259.1 KB |

移出首屏、改为按需加载的四块：A2UI 运行时 160.6 KB（`src/components/chat/A2uiCardSurface.tsx`，新增）、设置页 70.2 KB、搜索弹层 18.3 KB、KaTeX 样式 28.2 KB（首次真正渲染公式时注入，见 `src/components/chat/markdown.ts` 的 `ensureKatexStyles`）。

### 1.4 渲染端两处

- `src/components/chat/Transcript.tsx`：每秒定时器从列表根节点下沉到 `LiveProcessDuration` 叶子组件。此前运行期间每秒重渲染整个记录列表，只为更新一个时长标签。
- `src/components/chat/RichCodeBlock.tsx`：`useSettledValue` 让 mermaid 等图表源码稳定 320ms 后再渲染。此前流式中每个 delta 都会拿未闭合的中间态跑一遍解析和修复重试。

### 1.5 测试稳健性

`electron/local-app-runtime.test.mjs` 的 `waitForPath` / `waitForPidGone` / `waitForChildExit` 原本用 5 秒上限等待真实子进程退出。这些是「进程最终退出」的正确性断言而非性能断言，在并行负载下会误报。已统一为 `PROCESS_WAIT_TIMEOUT_MS = 20_000`。

---

## 2. 必须守住的不变量

改动上述模块时，以下几条一旦破坏会造成数据丢失或性能回归，且不一定会被现有测试之外的路径发现。

1. **`ChatWorkspaceStore.read()` 在有未落盘暂存时必须返回内存投影**（`chat-workspace-store.ts:178`）。否则每个事件都调用它的广播路径会把流式内容回滚到上一次落盘状态，并覆盖下一次 fold 依赖的投影。这是本轮我自己引入又修掉的缺陷，回归测试见 `chat-workspace-store.test.mjs` 的「streaming stages in memory, survives reads, and flushes the newest delta」。**验证方法：临时移除该守卫，那条测试必须失败。**

2. **终止事件必须 durable。** `chat-broker-core.ts` 只对 `result` / `error` / `cancelled` 传 `durable: true`。若改成全部 staged，崩溃会丢掉整段已完成的回答。

3. **不实现 `stage()` 的 store 必须退回逐次 durable 保存。** `project-chat-broker.ts:470` 的 `options?.durable === false && this.options.store.stage` 双重判断保证 Runtime facade 与测试替身不受影响，对应测试「a store without the staging seam keeps saving durably on every event」。

4. **热路径不得调用 `store.read()`。** 用 `workspaceProjection()`。新增每事件都会走到的代码时尤其注意。

5. **附件的 `dataUrl` 只放缩略图。** 新增任何附件录入路径都要经过缩略图化，否则 1.2 的收益会被重新吃掉。`base64` / `text` 仍然只用于送 Agent，不进持久化。

---

## 3. 待办

### TODO-1：把线程对话状态移出 AppShell（高价值 / 高风险）

**问题。** `src/components/AppShell.tsx` 是 3314 行的单体组件，`chatWorkspace` 整个对象放在它的 `useState` 里（`AppShell.tsx:333`）。每个 delta 经 `updateThreadChatState`（`:1365`）→ `updateChatWorkspace`（`:422`）→ `setChatWorkspace` 触发整棵树重渲染：AppShell 自身、ChatPage、AppShellSidebar、AppShellWorkspace、Composer 全部重算。

**为什么不能只加 `memo`。** 试过评估：`chatWorkspace` 每个 delta 都换新引用，任何从它派生的 prop 也随之变化，`memo` 在这些组件上不会命中。必须先把「每条线程的对话内容」从「工作区元数据」里分出来。

**建议做法。**

1. 新增 `src/components/chat/thread-chat-state-store.ts`：一个外部 store，`getSnapshot(threadId)` / `subscribe(threadId, cb)` / `setThreadChatState(threadId, update)`，内部按 threadId 分桶，只通知订阅了该 threadId 的组件。
2. `AppShell` 的 `chatWorkspace` 只保留元数据：`projects`、`threads`（不含 `chatState`）、`activeProjectId`、`activeThreadId`、`sidebarPrefs`、`workspaceTabs` 等。
3. `ChatPage` / `Transcript` 用 `useSyncExternalStore` 订阅当前活动线程的 `chatState`。
4. `applyProjectChatSnapshot`（`src/components/workspace-session.ts`）在应用 broker 快照时同时写元数据与 store。
5. legacy 回退路径（`projectChatReadiness === 'legacy'`）仍需要完整 `thread.chatState` 才能持久化，落盘前从 store 组装回去。

**注意点。**

- `src/chat-workspace-persistence.ts` 与 `electron/chat-workspace-store.ts` 的磁盘结构假定 `thread.chatState` 存在。**不要改磁盘格式**，只改渲染进程内的内存组织方式。
- `workspace-session.test.mjs`（596 行）覆盖了 `WorkspaceSession` 的行为，改动后必须全绿。
- 完成后应能观察到：流式期间侧栏与输入框不再重渲染。建议用 React DevTools Profiler 录一次流式回答作为前后对比证据。

**完成定义。** 一次流式回答期间，`AppShellSidebar` 与 `Composer` 的 render 次数从「每 delta 一次」降到 0；`tsc` 与全部测试通过。

### TODO-2：拆分 `src/style.css`（中价值 / 低风险但机械量大）

**现状。** 单文件 10881 行 / 281 KB，构建后首屏 CSS 259.1 KB。7815 条规则起始选择器。

**按类名前缀的规模分布（规则数）。**

| 前缀 | 规则数 | 前缀 | 规则数 |
| --- | --- | --- | --- |
| `project-home` | 177 | `app-thread` | 51 |
| `agent-status` | 99 | `app-search` | 51 |
| `agent-mcp` | 91 | `app-sidebar` | 50 |
| `app-shell` | 78 | `settings-provider` | 38 |
| `local-app` | 66 | `file-diff` | 38 |
| `chat-message` | 64 | `settings-update` | 35 |

**建议做法。** 按上表把规则搬进 `src/styles/<area>.css`，`style.css` 只保留基础层与 `@import`。真正的收益来自让这些文件跟着已经懒加载的路由走：`settings-*` 前缀的规则应随 `SettingsPage` 懒加载块加载，`app-search` 随 `AppSearchModal`，`project-home` 中 A2UI 相关部分随 `A2uiCardSurface`。做法是把对应 CSS `import` 移进那些组件模块，Vite 会自动把它们挂到对应的按需块上。

**验证方式（重要，这是纯重构）。** 拆分前后构建产物的 CSS 应当**语义等价**。用以下方式核对，避免因顺序变化改变级联结果：

```bash
npx vite build && cat dist/assets/index-*.css dist/assets/*.css | tr -d ' \n' | shasum
```

拆分前后分别记录，并逐条解释任何差异。**不要**顺手删除「源码里搜不到引用」的 126 个类：类名可能由字符串拼接或注入的 HTML/Markdown 使用，该信号不足以支撑删除。

### TODO-3：清理 `release/`（需用户确认后再做）

本地 `release/` 有 14 个版本共 12 GB，单个 DMG 约 200 MB。目录已在 `.gitignore` 中，不影响仓库。**删除不可逆，必须先得到用户明确同意**，并保留最近两个版本：

```bash
ls -d release/*/ | head -n -2 | xargs rm -rf
```

---

## 4. 验证

```bash
npx tsc --noEmit -p tsconfig.json
node --test electron/*.test.mjs
npx vite build
node scripts/perf-bench-workspace-store.mjs
```

当前基线：`tsc` 通过；449 项测试全部通过；构建 3.3 秒。

**两个坑。**

1. `node --test` 并行执行测试文件。如果新增了做真实磁盘或 `sqlite3` I/O 的测试，可能把 `local-app-runtime.test.mjs` 里等待真实子进程的用例挤到超时。判定方法：`node --test --test-concurrency=1 electron/*.test.mjs` 若全绿，则是负载干扰而非逻辑错误。
2. `scripts/perf-bench-workspace-store.mjs` 默认读当前用户真实工作区，只读不写，所有写入都在临时目录。也可传入任意 `chat-workspace.json` 路径。

---

## 5. 改动清单

```
新增  electron/chat-attachment-thumbnail.ts
新增  electron/chat-attachment-thumbnail.test.mjs
新增  src/chat-attachment-thumbnail.ts
新增  src/components/chat/A2uiCardSurface.tsx
新增  scripts/perf-bench-workspace-store.mjs
新增  PERFORMANCE-HANDOFF.md
改动  electron/chat-workspace-store.ts / .test.mjs
改动  electron/project-chat-broker.ts / .test.mjs
改动  electron/chat-broker-core.ts
改动  electron/main.ts
改动  electron/local-app-runtime.test.mjs
改动  src/main.tsx
改动  src/components/AppShellWorkspace.tsx
改动  src/components/chat/ChatPage.tsx
改动  src/components/chat/ProjectHomeSurface.tsx
改动  src/components/chat/RichCodeBlock.tsx
改动  src/components/chat/Transcript.tsx
改动  src/components/chat/markdown.ts
```
