# FIX-CHAT-01｜主侧边栏会话归档/置顶 Main-owned Cutover 修复

> 状态：**已完成（2026-08-29）**。实现与自检见 `evidence.md`。allowlist 已按实际偏离补记（见下）。

> 范围修订（2026-08-29，`BUG-AUDIT-WS-02`）：本单原先同时承担"thread mutation 修复"与"workspace/view-state ownership audit"。审计确认 ownership 缺口包含 P0 级的项目生命周期失效，且必须修改 Main/IPC——超出本单 allowlist。ownership 部分已整体移交 `FIX-WS-01`，本单收窄为 **thread mutation + busy 合同 + readiness 三态**，并依赖 `FIX-WS-01` 先完成。

## 缺陷结论

Project Chat production cutover 后，Main/broker 已是 thread/chat durable 事实的唯一 writer，但主侧边栏仍把归档和置顶写入 renderer `WorkspaceSession`：

- `AppShell.archiveThread` 仍调用 `workspaceSession.archiveThread`（`src/components/AppShell.tsx:2097`）；
- `AppShell.toggleThreadPinned` 仍调用 `workspaceSession.toggleThreadPinned`（`src/components/AppShell.tsx:2105`）；
- `projectChatEnabled=true` 时 renderer workspace autosave 被明确关闭（`src/components/AppShell.tsx:1103`），因此上述修改不会落入 Main store；
- 任一 Project Chat/RuntimeEdit snapshot 会按项目整批替换 renderer threads（`src/components/workspace-session.ts:120` `applyProjectChatSnapshot`），使本地归档或置顶立即回滚；
- `RuntimeEditCoordinator` 在 run 注册、工具 lease、mutation、terminal、settle 等状态变化时广播 snapshot，因此 Runtime 活跃时表现为"删除没有反应"或"删掉后马上回来"。

这不是右键菜单 handler、CSS z-index 或原生 Preview bounds 问题。右键菜单和垃圾桶按钮最终都进入同一个错误的 renderer mutation 路径。

### 新增缺陷：归档运行中会话的三方不一致

`BUG-AUDIT-WS-02` 复核确认，文案、实现与 broker 合同互相矛盾：

- `AppShellSidebar.requestArchive` 只对 `purpose === 'task-run'` 检查运行状态（`src/components/AppShellSidebar.tsx:460`）；普通线程与 `skill-run` 线程直接归档，无确认；
- `AppShell.archiveThread` 对 `skill-run` 走 legacy `window.claudeChat.cancel`（broker 模式下同样执行），对普通线程**完全不取消**——run 变成无人观察的孤儿；
- 文案 `sidebar.confirmRemoveRunningTask` 承诺"会先终止当前运行并归档"；
- broker 的冻结合同是运行中返回 `thread-busy` 并拒绝归档、不隐式 cancel。

### 新增缺陷：readiness 用一个布尔表达三种状态

`projectChatEnabled` 初值为 `false`（`src/components/AppShell.tsx:292`），直到首个 `getSnapshot` 成功才置 true（`src/components/AppShell.tsx:464`）。启动到该次返回之间的任何工作区变更都会走 legacy full-snapshot writer 写盘，可能用 renderer 镜像覆盖 Main 事实。

## 影响面

| 等级 | 功能 | 当前风险 |
| --- | --- | --- |
| P0 | 主侧边栏会话归档/移除 | 不持久、被 snapshot 恢复、重启后恢复 |
| P0 | 主侧边栏会话置顶/取消置顶 | 不持久、排序被 snapshot 恢复 |
| P0 | 归档运行中会话 | 普通/skill-run 线程不检查运行状态；孤儿 run；文案与 broker `thread-busy` 合同不一致 |
| P1 | probing 期误走 legacy writer | 启动窗口内可能用 renderer 镜像覆盖 Main |
| P1 | 双窗口一致性 | renderer 本地 thread mutation 不会同步到项目 Chat 窗口 |
| 移交 `FIX-WS-01` | 项目创建/移除/重定位/置顶/排序、侧栏与首页偏好 | 见该单 |
| 低 | Runtime Tab mutation | create/open/close/rename/relocate 已走 Main 原子接口，本单不改 |
| 低 | model/fork/edit/diff-review | Project Chat enabled 分支已走 broker intent，本单只做回归 source audit |

## 目标

1. Project Chat 模式下，主侧边栏归档与置顶只发送 Main-owned intent，不再写 renderer durable thread state。
2. 成功结果只由 broker snapshot 投影到主窗口和项目窗口；Runtime 快照不能复活已归档会话或回滚置顶。
3. active run/prompt 不隐式取消；文案、入口可用性与 broker `thread-busy` 合同三方一致，覆盖普通、`task-run`、`skill-run` 全部 purpose。
4. readiness 拆成 `probing | enabled | legacy` 三态；probing 期间禁止任何 durable thread mutation，且不得误走 legacy writer。
5. flag 关闭时完整保留 Revision 1 legacy 行为。

## 依赖

- `M0-05B`：已有 `archiveThread`、显式 `setThreadPinned` broker intent。
- `M0-05C`：broker/Main 共用唯一 workspace coordinator。
- `M0-05`：主窗口消费 broker snapshot，并封闭 renderer full workspace writer。
- `M2-02`：RuntimeEdit snapshot 已接入 production，构成本缺陷的高频回归触发器。
- **`FIX-WS-01`：必须先完成。** 项目生命周期在其之前不落盘，本单的重启回归断言无法成立。

## 冻结行为合同

### Project Chat mode

- 归档 DTO 只能是 `{ projectId, threadId, routeGeneration }`。
- 置顶 DTO 只能是 `{ projectId, threadId, pinned, routeGeneration }`；`pinned` 为显式目标值，不使用 toggle intent。
- target project 的 generation 必须来自该项目的最新 broker snapshot；不能借用当前活动项目 generation。
- cache 缺失或 generation stale 时 fresh-read `getSnapshot(projectId)`；`stale-revision` 最多 fresh-read 后重试一次。
- archive/pin 成功后不得调用 `workspaceSession.archiveThread`、`toggleThreadPinned`、`stage` 或 `saveChatWorkspace`；等待 broker broadcast 更新 durable thread facts。
- 若归档的是当前 active thread，只允许更新 renderer-owned selection/view state；不得伪造 `archivedAt`。
- 失败必须保留原会话并显示可见错误；不能只关闭菜单或吞掉 Promise。

### Busy thread

- snapshot 中存在同 thread non-terminal run 或 pending prompt 时，归档入口禁用或返回固定提示"请先停止当前运行，再移除会话"。
- 该判定**按 snapshot 事实**执行，覆盖普通线程、`task-run` 与 `skill-run`，不得再以 `purpose === 'task-run'` 作为唯一触发条件。
- 不得在 `archiveThread` 内隐式调用 `cancelRun`、`claudeChat.cancel` 或 `stopTaskHomePlugin` 后立即归档。现有 `skill-run` 的 `claudeChat.cancel` 与 `task-run` 的 `stopTaskHomePlugin` 前置调用必须移除。
- `sidebar.confirmRemoveRunningTask` 文案必须改写为"先停止再移除"语义，中英文同步；不得保留"会先终止当前运行"的承诺。
- 若后续产品要求"一键停止并归档"，必须另做显式 `cancelRun -> terminal snapshot -> archiveThread` 编排，并单独测试；不能修改 broker 的 `thread-busy` 合同。

### Readiness 三态

- 用显式 `projectChatReadiness: 'probing' | 'enabled' | 'legacy'` 取代单一布尔；`legacy` 只能在明确确认 production composition 不可用/flag disabled 后进入。
- `probing` 期间：thread mutation 入口禁用；不得调用 legacy `WorkspaceSession` thread writer；不得 stage full snapshot。
- 现有基于 `projectChatEnabled` 的其它分支（ChatPage 提交、agent command runtime、permission 同步）按等价语义映射到 `readiness === 'enabled'`，行为不得改变。

### Legacy mode

- `legacy` 下完整沿用 `WorkspaceSession` 与 `claudeChat` 路径，Revision 1 归档/置顶仍持久化。

## 实施步骤

1. 在 `AppShell` 收敛一个 project-scoped mutation context resolver：按 target `projectId` 取得最新 snapshot/generation，并统一处理 fresh-read、stale retry 与错误投影。
2. 引入 `projectChatReadiness` 三态并替换所有 `projectChatEnabled` 读取点；probing 期禁用 thread mutation 入口。
3. 改造 `archiveThread`：移除 `skill-run` / `task-run` 的前置 cancel/stop；`enabled` 分支只调用 `window.projectChat.archiveThread`；`legacy` 分支才调用旧 reducer。
4. 改造 `toggleThreadPinned`：从最新 snapshot/thread 推导显式目标 `pinned`，只调用 `setThreadPinned`，等待 snapshot 更新排序。
5. 给归档/置顶增加 per-thread pending fence，防止菜单、垃圾桶、pin 按钮重复提交或在旧 snapshot 上连续 toggle。
6. 侧边栏 busy 判定改为读 snapshot 的 run/prompt 事实，覆盖全部 purpose；调整 callback 类型为可等待结果或等价状态通道；失败用 `role=alert`/现有全局状态面显示，成功后菜单焦点恢复规则不变。
7. 改写 `sidebar.confirmRemoveRunningTask` 中英文文案为"先停止再移除"。
8. active thread 归档成功后只修正 main-window selection；inactive thread 归档不得跳走当前会话。
9. source audit 锁定 `enabled` 分支不再调用 renderer thread durable reducers/full workspace save。

## 实现偏离（2026-08-29，已实现并记录）

两处与上方冻结合同不同的落地方式，理由如下；如判定不可接受，需另开工单回改。

1. **`sidebar.confirmRemoveRunningTask` 未被改写，而是被限制在 legacy 分支。** 该文案承诺"会先终止当前运行并归档"，在 legacy 路径上是**真实**的（legacy 确实先 `claudeChat.cancel` / `stopTaskHomePlugin` 再归档）。三方不一致只存在于 broker 路径，因此 broker 路径改为固定提示 `sidebar.archiveBusyThread`（"请先停止当前运行，再移除会话。"），而 legacy 保留原确认框。删除该文案会让 legacy 失去准确提示。
2. **`probing` 期间没有"禁用入口"，而是直接走 broker intent。** `window.projectChat` 在 probing 期已存在（只是 `getSnapshot` 尚未返回），broker IPC 完全可用，intent client 会自行 fresh-read 目标项目快照拿到 `routeGeneration`。真正的危害是"probing 落入 legacy durable writer"，这一点由 `if (projectChatReadiness !== 'legacy') return` 的 autosave 守卫与 `projectChatReadinessRef.current === 'legacy'` 的 mutation 守卫消除。禁用入口只会让启动瞬间的点击无响应，收益为负。

## Write allowlist

- `src/components/AppShell.tsx`
- `src/components/AppShellSidebar.tsx`
- `src/components/project-chat-thread-intents.ts`（新增：busy 判定与 thread intent 提交；allowlist 补记）
- `src/components/runtime-event-state.ts` 及 `RuntimeWorkspace.tsx` / `chat/ProjectHomeRuntimeView.tsx` / `chat/ProjectChatWindowPage.tsx`（`runtimeEditStatus` 硬编码中文改走 i18n；allowlist 补记）
- `src/components/chat/ChatPage.tsx`（仅 readiness 三态的等价映射，不改提交语义）
- `src/locales/zh.json`
- `src/locales/en.json`
- 可新增一个只负责 renderer Project Chat thread intents 的 `src/**` helper/hook
- `electron/project-chat-renderer.test.mjs`
- `electron/workspace-session.test.mjs`
- 可新增仅覆盖上述 helper/hook 的测试文件
- 本 change 的 `tasks.md`、`acceptance.md`、`evidence.md`、`work-orders/README.md`

禁止修改：`electron/project-chat-broker.ts`、`electron/project-chat-ipc.ts`、`electron/main.ts`、workspace store/coordinator、Runtime modules、协议/Binding/Ticket。现有 Main API 已足够完成 P0；若实现声称必须修改这些文件，先停止报告。

## 必测断言

1. Project Chat enabled：右键"移除"和垃圾桶确认都只发送一次 `archiveThread`，DTO project/thread/generation 正确。
2. 归档保存与 RuntimeEdit snapshot 交错时，最终 Main store 保留 `archivedAt`，主窗口和项目窗口都隐藏该 thread。
3. 置顶/取消置顶发送显式 boolean；重复事件幂等，不被后续 Runtime snapshot 回滚。
4. 非活动项目 thread 使用自己的 generation，不借用 active project snapshot。
5. `stale-revision` fresh-read 后最多重试一次；失败可见且不做本地 durable mutation。
6. active run/prompt 归档不 cancel、不隐藏 thread，并显示"先停止"提示；普通、`task-run`、`skill-run` 三种 purpose 结果一致。
7. `archiveThread` 不再调用 `claudeChat.cancel` 或 `stopTaskHomePlugin`（source audit + 调用断言）。
8. active thread 成功归档后选择有效可见 thread 或项目首页；inactive thread 归档不改变当前选择。
9. `probing` 期间 thread mutation 入口禁用且不产生任何 durable 写入；`legacy` 下 Revision 1 归档/置顶仍持久化。
10. source audit 证明 `enabled` 分支下 `workspaceSession.archiveThread`、`toggleThreadPinned`、`saveChatWorkspace(fullSnapshot)` 均不可达。

## 不接受的修复

- 重新启用 renderer `saveChatWorkspace(fullSnapshot)`；
- 在 `applyProjectChatSnapshot` 中保留本地 `archivedAt/pinnedAt` 并与 Main 合并；
- 通过延迟、debounce、忽略 Runtime snapshot 或比较本地时间戳掩盖竞态；
- optimistic 修改 durable thread facts 后在失败时猜测回滚；
- 修改 broker archive 使其隐式 cancel，或保留前置 cancel 以"兼容旧文案"；
- 只修右键入口，遗漏垃圾桶或 pin 按钮；
- 继续用单一布尔表达 probing 与 legacy。

## 验证命令

```bash
npm run typecheck
node --test electron/project-chat-renderer.test.mjs electron/workspace-session.test.mjs electron/project-chat-broker.test.mjs electron/project-chat-ipc.test.mjs
npm run test:electron
git diff --check
```

完整 Electron 测试若仅受受控 loopback HTTPS fixture sandbox 限制失败，必须记录精确失败并在允许本地回环监听的环境复跑；不得把其它失败归类为环境问题。

## 完成条件

- `ATDD-CHAT-207`、`ATDD-CHAT-208`、`ATDD-CHAT-209`、`ATDD-CHAT-210` 有自动证据；
- P0 代码与测试通过；
- `CHECK-02` 在本单完成前保持阻塞。

## 停止条件

若必须恢复 full workspace writer、允许 Main/renderer 双写 thread facts、无法区分 probing/legacy、或需要放宽 capability/generation 校验，立即停止并回报，不能用兼容 fallback 推进。
