# 性能优化交接说明

面向接手的 session。本文记录已完成的改动、必须守住的不变量、剩余待办的具体做法，以及验证方式。

- 基线审查报告（含全部实测图表）：https://claude.ai/code/artifact/f55781c6-b89c-4d13-a982-aef20070dde8
- 测量日期：2026-09-02，分支 `homepage-test`
- 本轮 1.1–1.5 与 1.6 的一部分已在 `a12252a` 落进 `homepage-test`；其余仍在工作区

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

### 1.6 线程对话状态移出 AppShell（原 TODO-1）

**问题。** `chatWorkspace` 整个对象放在 `AppShell` 的 `useState` 里，broker 每条 delta 都会经
`acceptProjectChatSnapshot` 触发三次壳层 `setState`（`projectChatSnapshots`、`chatWorkspace`、
`threadRunStates`），于是 AppShell、AppShellSidebar、AppShellWorkspace、ChatPage、Composer
按 delta 频率整棵树重算。只加 `memo` 无效：`chatWorkspace` 每条 delta 都换新引用。

**做法。** 把「每条线程的对话内容」和「broker 快照」都移到渲染进程的外部 store，
AppShell 的 React state 只保留工作区元数据。

| 文件 | 改动 |
| --- | --- |
| `src/components/chat/thread-chat-state-store.ts` | 新增。`ThreadChatStateStore`（按 threadId 分桶订阅）+ `useThreadChatState` / `useThreadChatSelector` + `adoptWorkspaceChatStates()` / `hydrateWorkspaceChatStates()` |
| `src/components/chat/broker-snapshot-source.ts` | 新增。`BrokerSnapshotStore` 与 `useBrokerSnapshotSelector`，让 ChatPage 只订阅它真正渲染的快照片段 |
| `src/components/types.ts` | 新增 `ThreadMetadata = Omit<WorkspaceThread, 'chatState'>` 与 `WorkspaceMetadataState`。`WorkspaceThread` 可赋给前者、反之不行，所以每个仍需要对话内容的读取点都在编译期暴露 |
| `src/components/workspace-session.ts` | 元数据类方法泛型化为 `<S extends WorkspaceMetadataState>`；`applyProjectChatSnapshot` 接受 `{ store, deferTimestampOnlyUpdates }` |
| `src/workspace-commands.ts` / `workspace-command-client.ts` | 同样泛型化（不读 `chatState`，主进程调用方零变化） |
| `src/components/AppShell.tsx` | state 改为 `WorkspaceMetadataState`；新增 `adoptAuthoritativeSnapshot()` 作为权威快照的唯一入口；`updateThreadChatState` 只写 store |
| `src/components/chat/ChatThreadView.tsx` | 新增 `ThreadTranscript`：唯一订阅 transcript 的组件，位置在 `ChatPage` 之下 |
| `ChatPage` / `AppShellWorkspace` / `AppSearchModal` / `ProjectHomeSurface` / 两个聊天子窗口 | 改为从 store 读取；子窗口用 `usePublishedThreadChatStates` 把本地快照投影进同一个 store |

**磁盘格式不变。** `ChatWorkspaceState` 与所有主进程契约原样保留；壳层与耐久形态之间由
`adoptWorkspaceChatStates()` / `hydrateWorkspaceChatStates()` 显式转换，Revision 1 落盘前装配回去。

**实测（`perf-harness/`，真实组件树 + 40 条合成 delta）。**

| 组件 | 修复前 | 修复后 |
| --- | --- | --- |
| `AppShellSidebar` | 61 | **0** |
| `Composer` | 60 | **0** |
| `AppShellWorkspace` | 61 | 0 |
| `ChatThreadView` | 60 | 0 |
| `SettingsPage` | 40 | 0 |
| `IconInline` | 1482 | 280 |
| `ProcessTraceBlock`（transcript 内，应当渲染） | 40 | 40 |

对比基线是 `5a254a2`（本轮改动之前）的 git worktree，两侧跑同一份探针，各连跑两次、数字完全一致。
计数窗口只覆盖 40 条 delta：run 开始与终止各自应该重渲染一次壳层，被刻意排除在窗口外。
终止快照仍然提交一次元数据 + 一次 run 状态，于是 `AppShellSidebar` 在整次回答里共 2 次、
`Composer` 1 次——都发生在回答结束时，不再随 delta 增长。

`memo()` / `forwardRef()` 包装的组件（`Transcript`、`ChatPage`）在探针里不可见，因为它们不是函数；
判断 `ChatPage` 有没有重渲染，看它渲染体里创建的 `Composer`。

### 1.7 拆分 `src/style.css`（原 TODO-2）

**问题。** 单文件 10881 行 / 281 KB，构建后首屏 CSS 265.4 KB，且没有任何区域边界。

**做法分两步，两步都可验证。**

1. **纯搬运。** 按区域切成 `src/styles/` 下 15 个文件，`style.css` 只剩 `@import` 顺序。
   切点全部落在顶层块之间（脚本会校验），顺序与原单文件完全一致，因此构建产物
   **逐字节相同**（内容哈希文件名都没变：`index-C2WDNjzu.css`，265,358 B）。
2. **跟着路由懒加载。** 只有能证明级联结果不变的区域才允许搬进懒加载块：
   - `styles/app-search.css` → `AppSearchModal`（本来就是 `lazy()`）。
   - `styles/settings.css` 按消费方拆成 `settings-controls.css`（首次启动向导与项目首页也在用，留首屏）
     与 `settings-page.css`（只有 `src/components/setting/` 用，随 `SettingsPage` 懒加载）。

**为什么 `agent-settings.css`（33.6 KB）没有搬。** 它 126 个类里只有 19 个是设置页专有，
其余由项目首页的 Agent 设置抽屉（eager）消费，搬走就会散架。

**判定「可以搬」的三个条件**（脚本逐条检查，全部为 0 才动手）：

- 该区域每条规则被赋样式的元素都带着「只有那个路由才有的类」；
- 拆分后会跨到前面去的同区域规则里，没有「同特异性 + 同属性 + 可能命中同一元素」的；
- 后加载的 eager 区域文件里同样没有这种规则。

**结果。**

| 产物 | 拆分前 | 拆分后 |
| --- | --- | --- |
| `index.css`（首屏） | 265.36 kB / gzip 34.70 | **243.20 kB / gzip 32.02** |
| `SettingsPage.css`（随路由） | — | 14.45 kB |
| `AppSearchModal.css`（随路由） | — | 7.71 kB |

**语义等价核对。** 构建产物拍平成「@上下文 ‖ 选择器 ‖ 声明」再做多重集比对：
前后都是 **1831 条规则，0 缺失、0 新增**——只是落在了不同文件里。
（handoff 原来建议的 `shasum` 只在第 1 步适用；第 2 步规则跨文件重新分配，哈希必然变，
所以改用规则集比对，这是更强的核对。）

**防回归。** `electron/style-layering.test.mjs` 守住四条：`style.css` 只有 `@import`；
每个区域文件要么被入口引入、要么恰好被一个组件引入；懒加载样式表不与首屏样式表争抢同一个类；
`src/components/setting/` 只能经由那一处 `lazy()` 进入。

---

### 1.8 清理 `release/`（原 TODO-3，已获用户确认）

本地 `release/` 原有 14 个版本共 12 GB（目录在 `.gitignore` 中，与仓库无关）。
按用户确认删除到只留最近两个版本：**0.1.17**（当前 `package.json` 版本）与 **0.1.15**。
**12 GB → 1.9 GB。**

原来记在这里的一行命令是错的，不要再用：

```bash
ls -d release/*/ | head -n -2 | xargs rm -rf   # ✗ 会删掉最新的两个
```

`ls -d release/*/` 按字典序排，`0.1.9` 排在 `0.1.15` / `0.1.17` 之后，
`head -n -2` 保留的恰恰是最旧的两个。要按修改时间取：

```bash
cd release && KEEP=$(ls -dt */ | head -2 | tr -d '/' | tr '\n' ' ')
for d in */; do name="${d%/}"; case " $KEEP " in *" $name "*) ;; *) rm -rf "$name";; esac; done
```

---

---

## 2. 必须守住的不变量

改动上述模块时，以下几条一旦破坏会造成数据丢失或性能回归，且不一定会被现有测试之外的路径发现。

1. **`ChatWorkspaceStore.read()` 在有未落盘暂存时必须返回内存投影**（`chat-workspace-store.ts:178`）。否则每个事件都调用它的广播路径会把流式内容回滚到上一次落盘状态，并覆盖下一次 fold 依赖的投影。这是本轮我自己引入又修掉的缺陷，回归测试见 `chat-workspace-store.test.mjs` 的「streaming stages in memory, survives reads, and flushes the newest delta」。**验证方法：临时移除该守卫，那条测试必须失败。**

2. **终止事件必须 durable。** `chat-broker-core.ts` 只对 `result` / `error` / `cancelled` 传 `durable: true`。若改成全部 staged，崩溃会丢掉整段已完成的回答。

3. **不实现 `stage()` 的 store 必须退回逐次 durable 保存。** `project-chat-broker.ts:470` 的 `options?.durable === false && this.options.store.stage` 双重判断保证 Runtime facade 与测试替身不受影响，对应测试「a store without the staging seam keeps saving durably on every event」。

4. **热路径不得调用 `store.read()`。** 用 `workspaceProjection()`。新增每事件都会走到的代码时尤其注意。

5. **附件的 `dataUrl` 只放缩略图。** 新增任何附件录入路径都要经过缩略图化，否则 1.2 的收益会被重新吃掉。`base64` / `text` 仍然只用于送 Agent，不进持久化。

6. **壳层 React state 不得持有 `chatState`。** AppShell 的工作区类型是 `WorkspaceMetadataState`；
   主进程权威快照一律经 `adoptAuthoritativeSnapshot()` 进入，落盘一律经 `hydrateWorkspaceChatStates()`
   出去。绕开任一侧就等于把整份 transcript 重新塞回按 delta 变化的 React state，1.6 的收益立刻消失。
   回归测试见 `thread-chat-state-store.test.mjs` 的「workspace adoption strips chat content…」。

7. **run 活跃期间，只有时间戳变化的 broker 快照不得提交到壳层 state。**
   `acceptProjectChatSnapshot` 按 `snapshot.runs` 是否还有活跃 run 决定 `deferTimestampOnlyUpdates`。
   终止快照里 run 已是 `succeeded/failed/cancelled`，精确时间戳照常落地，因此排序语义不变。
   `setThreadRunStates` 的 `sameThreadRunStates` 相等判断是同一件事的另一半——它原本每条 delta
   都返回新对象。回归测试见「running deltas that only move timestamps…」。

8. **懒加载样式表不得与首屏样式表给同一个类上样式。** 懒加载块在 `index.css` 之后到达，
   谁赢取决于用户什么时候打开那个路由——这类回归在开发机上几乎看不见。
   新增区域文件或调整 `style.css` 的 `@import` 顺序后跑一次 `style-layering.test.mjs`。

---

## 3. 待办

无。1.1–1.8 之后 handoff 上原有的三项待办都已完成。

再往下要继续压首屏，剩下的量在 `index.js`（1122.9 KB）而不是 CSS：
`agent-settings.css`（33.6 KB）与它对应的 Agent 设置抽屉现在是 eager 的，
如果把抽屉本身改成 `lazy()`，样式可以跟着一起走——但那要先把项目首页对这批类的复用理清楚。

---

## 4. 验证

```bash
npx tsc --noEmit -p tsconfig.json
node --test electron/*.test.mjs
npx vite build
node scripts/perf-bench-workspace-store.mjs
npx vite --config perf-harness/vite.config.ts   # render 计数探针，见 perf-harness/README.md
```

当前基线：`tsc` 通过；458 项测试全部通过（原 449 + `thread-chat-state-store.test.mjs` 5 项
+ `style-layering.test.mjs` 4 项）；构建 3.3 秒；`index.js` 1122.9 KB / `index.css` 243.2 KB。

**两个坑。**

1. `node --test` 并行执行测试文件。如果新增了做真实磁盘或 `sqlite3` I/O 的测试，可能把 `local-app-runtime.test.mjs` 里等待真实子进程的用例挤到超时。判定方法：`node --test --test-concurrency=1 electron/*.test.mjs` 若全绿，则是负载干扰而非逻辑错误。（本轮新增的 `thread-chat-state-store.test.mjs` 是纯内存用例，默认并行下 454 项直接全绿，没有触发这条。）
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
新增  src/components/chat/thread-chat-state-store.ts
新增  src/components/chat/broker-snapshot-source.ts
新增  electron/thread-chat-state-store.test.mjs
新增  perf-harness/（render 计数探针，不进产品构建）
新增  src/styles/（15 个区域样式文件，其中 app-search / settings-page 随路由懒加载）
新增  electron/style-layering.test.mjs
改动  src/style.css（只剩 @import 顺序）
改动  src/components/AppSearchModal.tsx / setting/SettingsPage.tsx（各自 import 自己的样式）
改动  electron/window-chrome.test.mjs（断言改为跟随 style.css 的 @import 链）
改动  electron/chat-workspace-store.ts / .test.mjs
改动  electron/desktop-seam.test.mjs
改动  src/components/types.ts
改动  src/components/workspace-session.ts
改动  src/components/workspace-command-client.ts
改动  src/workspace-commands.ts
改动  src/components/AppShell.tsx
改动  src/components/AppShellSidebar.tsx
改动  src/components/AppSearchModal.tsx
改动  src/components/chat/ChatThreadView.tsx
改动  src/components/chat/ChatStartView.tsx
改动  src/components/chat/ProjectChatWindowPage.tsx
改动  src/components/chat/RuntimeDevelopmentWindowPage.tsx
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
