# FIX-WS-01｜Workspace Ownership 收口（项目生命周期与偏好）

> 状态：**已完成（2026-08-29）**。实现与自检见 `evidence.md`。allowlist 已按实际偏离补记（见下）。

## 缺陷结论

`M0-05` renderer cutover 把 **thread** 事实迁给 Main 独占，同时关闭了 renderer 唯一的 durable writer，但 **project / sidebar / view** 事实仍然只由 renderer `WorkspaceSession` 写入。这是一次半迁移，不是可延后的优化项：被关闭的写手和留在 renderer 的写入路径属于同一份 `ChatWorkspaceState`。

已核实的 production 触发条件：

- `projectChatBrokerV2Enabled` 返回 `environment.AGENTOS_PROJECT_CHAT_BROKER_V2 !== '0'`（`electron/project-chat-composition.ts:7`），**broker 模式在生产里默认开启**；
- renderer `projectChatEnabled` 在首个 `getSnapshot` 成功后置 true 且不再回落（`src/components/AppShell.tsx:464`）；
- autosave 在该标志为 true 时整条跳过（`src/components/AppShell.tsx:1103` `if (projectChatEnabled) return`）。

### P0-1 新建项目既不落盘也不可用

逐跳已核对：

1. `createProject` / `createProjectFromExistingPath` 只调 `workspaceSession.addProject`（`src/components/AppShell.tsx:1446`、`src/components/AppShell.tsx:1479`）；
2. autosave 在 broker 模式跳过，该 mutation 永不进入 Main store；
3. Main 侧**不存在任何创建项目的命令**；
4. `ProjectChatBroker.getSnapshot` 对不在 Main store 的项目返回 `project-not-found`（`electron/project-chat-broker.ts:118`）；
5. `ChatPage` 在 `projectChatEnabled` 时无条件走 `api.createThread` / `api.submitRun`（`src/components/chat/ChatPage.tsx:1567`）。

后果：默认配置下，工作区只要已存在一个项目，之后新增的任何项目都会立刻进入"发消息报错 + 重启后消失"状态。此项在 `BUG-AUDIT-CHAT-01` 中被并入 P1「项目置顶、排序、移除、迁移」一行，严重度定级错误。

### P0-2 项目移除 / 重定位 / 置顶 / 排序不落盘

同一失效路径：`removeProject`（`src/components/AppShell.tsx:2131`）、`relocateProject`（`src/components/AppShell.tsx:2162`）、`toggleProjectPinned`（`src/components/AppShell.tsx:2109`）、`reorderProject`（`src/components/AppShell.tsx:2114`）。

其中 `relocateProject` 是 Main `openProjectPathRecovery`（路径丢失恢复）流程的终点，因此**恢复动作本身也不落盘**：用户重新指定路径，重启后仍是 `pathMissing`。

### P1-1 renderer 偏好不落盘

`toggleSidebar`（`src/components/AppShell.tsx:2119`）、`toggleProjectCollapsed`（`src/components/AppShell.tsx:2123`）、`setProjectHomeViewMode`（`src/components/AppShell.tsx:549`）。可观察表现是重启后侧栏折叠状态丢失、项目首页永远回到「概览」。

### P1-2 投影降级字段（本单按不变量处置，不补字段）

`projectChatThreadToWorkspaceThread`（`src/components/workspace-session.ts:137`）把 `creationSource` 硬编码为 `{ kind: 'user' }`、丢弃 `skillPath`、把 attachment `path` 置空；`src/components/chat/ProjectChatWindowPage.tsx:233` 同样。

当前不致命**只是因为 renderer 已经不回写 thread**。这是"靠另一个缺陷才没出事"的结构。本单不补投影字段（补字段会把 `creationSource.bindingId` 等 website 元数据推进主窗口投影，扩大脱敏面），而是把安全性变成结构性不变量：**新增的 workspace 命令不接受任何来自 renderer 的 `threads` / `projects` 数组，Main 只从自己的 store 派生 durable 内容**。投影因此永久是 view-only，字段保真度不再是正确性前提。

## 影响面

| 等级 | 功能 | 当前风险 |
| --- | --- | --- |
| P0 | 新建/添加项目 | 不落盘；broker 返回 `project-not-found`，该项目无法创建线程或提交；重启后消失 |
| P0 | 移除项目 | 不落盘，重启后复活 |
| P0 | 重定位项目 | 不落盘；路径丢失恢复流程无效 |
| P0 | 项目置顶/排序 | 不落盘，重启后回滚 |
| P1 | 侧栏收起 / 项目折叠 / 项目首页页签 | 不落盘 |
| P1 | 投影 thread 字段降级 | 当前潜伏；任何恢复 renderer 回写的修复都会激活为数据污染 |
| 不在本单 | thread 归档/置顶、busy 合同、readiness 三态 | 归 `FIX-CHAT-01` |
| 不在本单 | `workspaceTabs` / `runtimeDefinitions` | 已是 Main 原子接口，不改 |

## 目标

1. 项目生命周期（创建、移除、重定位、置顶、排序）成为 Main-owned durable 命令，**不按 `projectChatEnabled` 分支**：legacy 与 broker 模式走同一条权威路径。
2. 侧栏与项目首页偏好同样由 Main 持久化，使用同一命令通道的独立 variant。
3. renderer 在这些操作上不再产生本地 durable mutation；成功结果只来自 Main 回读后的权威快照。
4. 命令 DTO 在结构上无法承载 thread/transcript，使 P1-2 的投影降级永远不能污染 durable 数据。
5. 关闭 `ATDD-WS-201` ownership audit：列出全部剩余 renderer workspace 写路径并逐项归类，无遗留"待定"。

## 依赖

- `M0-05C`：broker 与 Main 已共用唯一 `runChatWorkspaceOperation` read-transform-save 调度器。
- `M0-06`：`createWorkspaceTab` / `openWorkspaceTab` / `renameWorkspaceTab` / `closeWorkspaceTab` 已确立"`expectedRevision` 门槛 → 保存 → 回读校验 → 返回权威 `workspace`"的既有模式；本单复用该模式，不发明新的一致性机制。

## 冻结行为合同

### 单一命令通道，不做逐方法镜像

新增**一个** Main-owned invoke 通道，承载判别联合，而不是为 6 个操作各建一套 `contract → port → router → preload → seam` 镜像：

```text
applyWorkspaceCommand(command, expectedRevision)
  -> { ok: true, workspace }
   | { ok: false, code, message }
```

`command` 的判别联合固定为：

| variant | 载荷 | 语义 |
| --- | --- | --- |
| `project.create` | `{ name, path }` | Main 生成 id 与时间戳；renderer 不得传入 id |
| `project.remove` | `{ projectId }` | 连同该项目 threads 一并由 Main 处理 |
| `project.relocate` | `{ projectId, path }` | Main 负责规范化与 `pathMissing` 复核 |
| `project.setPinned` | `{ projectId, pinned }` | 显式 boolean，不使用 toggle |
| `project.reorder` | `{ projectId, targetProjectId, position }` | `position` 为 `before \| after` |
| `preferences.set` | `{ sidebarCollapsed?, collapsedProjectIds?, projectHomeViewModes? }` | 部分更新；未出现的键保持不变 |

约束：

- DTO **不得**包含 `threads`、`projects`、`chatState`、`transcript`、`runtimeDefinitions`、`workspaceTabs` 或 `workspaceRevision` 之外的任何快照字段。Main 收到未知键即拒绝，返回 `invalid-command`，不做宽松忽略。
- `project.create` 的 id 由 Main 生成；renderer 传入 id 视为非法命令。
- 所有 variant 走既有 `runChatWorkspaceOperation`，以 `expectedRevision` 为门槛，保存后**回读校验**目标字段，失败返回可读错误并保留重试路径。
- 成功返回持久化后的完整 `ChatWorkspaceState`；renderer 用它整体替换 `chatWorkspace`，不做本地合并。这与 `createWorkspaceTab` 现有回写方式一致。

### renderer 行为

- 上述六类操作的 renderer 分支**只**调用新命令；不得再调用 `workspaceSession.addProject`、`removeProject`、`relocateProject`、`toggleProjectPinned`、`reorderProject`、`toggleSidebar`、`toggleProjectCollapsed`、`setProjectHomeViewMode`，也不得调用 `stage` 或 `saveChatWorkspace`。
- `WorkspaceSession` 上对应的 reducer 方法保留为纯函数供 Main 与测试复用，但不得再从 `AppShell` 的这些入口调用。
- 偏好类操作（侧栏折叠、项目首页页签）必须在 renderer 侧合并去抖后再发命令，避免每次点击一次全量快照往返；去抖窗口固定 300ms，组件卸载与窗口关闭前必须 flush。
- 失败必须可见（复用现有 `WorkspaceSaveErrorNotice` 与重试入口），不得吞掉 Promise 或只关闭菜单。
- `project.create` 成功后才允许切换 active project；失败时不得留下一个只存在于 renderer 的项目。

### 与 Project Chat 的边界

- 本单**不**改 `ProjectChatBroker`、`project-chat-ipc`、Project Chat 的任何 DTO 或 snapshot 形状。
- 本单**不**恢复 renderer 的 full workspace autosave。`AppShell.tsx:1103` 的跳过保持不变。
- `project.remove` 与 `project.relocate` 若影响正在运行的 run，沿用现有行为：Main 不隐式取消 run；renderer 侧既有的 Runtime consumer 释放逻辑保持不变。

### 归属矩阵（`ATDD-WS-201` 的关单形式）

实现必须在 `evidence.md` 落盘下表并逐项给出代码位置，不允许"其余待后续工单"这类笼统结论：

| mutation | 归属 | 介质 |
| --- | --- | --- |
| 项目创建/移除/重定位/置顶/排序 | Main durable command | `ChatWorkspaceStore` |
| 侧栏收起 / 项目折叠 / 项目首页页签 | Main durable command（`preferences.set`） | `ChatWorkspaceStore` |
| thread 归档/置顶 | Main broker intent | `FIX-CHAT-01` |
| task-run thread seed | Main（`runPort.ensureThread` 已存在） | broker |
| workspaceTabs / runtimeDefinitions | Main 原子接口（既有） | `ChatWorkspaceStore` |
| hidden skill paths | renderer-local | `localStorage`（既有） |
| 主窗口 selected project/thread | renderer-local selection | 内存 + 既有恢复逻辑 |
| 项目窗口 selected thread / draft / bounds | Main view-state（既有） | `ProjectChatViewStateStore` |

## 实施步骤

1. 在 `src/desktop-api.ts` 与 `src/desktop-seam.ts` 定义命令判别联合、结果类型与单一通道常量；不新增第二个通道。
2. `electron/preload.ts` 增加一个 typed 方法转发该通道。
3. `electron/main.ts` 注册 handler：严格校验 variant 与未知键 → `runChatWorkspaceOperation` → `withNextWorkspaceRevision` → `save` → 回读校验 → 返回权威快照。项目 id 与时间戳在 Main 生成。
4. 改造 `AppShell` 六个入口，统一经一个 renderer helper 提交命令、处理 `stale-revision` 重试（最多一次 fresh-read 后重试）与错误投影。
5. 偏好类入口接入 300ms 去抖合并器，并在卸载/关闭前 flush。
6. 补 `electron/chat-workspace-store.test.mjs` / 新增命令测试：六个 variant 的成功、回读失败、revision 冲突、未知键拒绝、id 注入拒绝。
7. 补 renderer 侧回归：命令失败时不产生本地 durable mutation；`project.create` 成功后新项目可立即 `getSnapshot` 成功并提交。
8. source audit：证明 `AppShell` 的这六个入口不再可达 `workspaceSession` 的对应 reducer。
9. 在 `evidence.md` 写入归属矩阵与代码位置，关闭 `ATDD-WS-201`。

## Write allowlist

- `src/workspace-commands.ts`（新增：命令联合、严格 parser 与纯转换的唯一定义；allowlist 补记）
- `src/components/workspace-session.ts`（改为委托上述纯函数，消除 Main/renderer 双实现；allowlist 补记）
- `src/desktop-api.ts`
- `src/desktop-seam.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `src/components/AppShell.tsx`
- 可新增一个只负责 renderer workspace 命令提交/去抖/重试的 `src/**` helper
- `electron/chat-workspace-store.test.mjs`
- `electron/workspace-session.test.mjs`
- `electron/desktop-seam.test.mjs`
- 可新增仅覆盖上述 helper 与新命令的测试文件
- 本 change 的 `tasks.md`、`acceptance.md`、`evidence.md`、`work-orders/README.md`

禁止修改：`electron/project-chat-broker.ts`、`electron/project-chat-ipc.ts`、`electron/project-chat-*.ts` 其余模块、`src/project-chat-contract.ts`、Runtime 模块、协议/Binding/Ticket。若实现声称必须修改这些文件才能完成 P0，先停止报告。

## 必测断言

1. `project.create` 后 Main store 立即包含该项目；随后 `getSnapshot(newProjectId)` 返回 ok；重启后项目仍在。
2. `project.create` 保存失败时 renderer 不留下任何本地项目，错误可见且可重试。
3. `project.remove` / `project.relocate` / `project.setPinned` / `project.reorder` 均在回读后生效，重启后保持。
4. `project.relocate` 成功后 `pathMissing` 复核结果正确；Main `openProjectPathRecovery` 触发的恢复走同一路径并落盘。
5. `preferences.set` 部分更新不清空未传字段；连续快速切换只产生一次去抖后的命令；卸载前 flush 不丢最后一次。
6. 命令携带 `threads` / `projects` / `chatState` / 任意未知键时返回 `invalid-command`，不做部分应用。
7. `project.create` 携带 renderer 生成的 id 被拒绝。
8. `expectedRevision` 落后时返回 `stale-revision`；fresh-read 后最多重试一次；仍失败则可见且不做本地 durable mutation。
9. broker 模式与 legacy 模式下上述断言结果一致（命令路径不分支）。
10. source audit 证明六个入口不再调用对应 `workspaceSession` reducer，且 `AppShell.tsx:1103` 的 autosave 跳过未被恢复。

## 不接受的修复

- 重新开启 renderer `saveChatWorkspace(fullSnapshot)` 或移除 `if (projectChatEnabled) return`；
- 让命令 DTO 承载 threads/transcript，或让 Main 信任 renderer 传来的快照片段；
- 为六个操作各建一套独立通道与五层镜像；
- 用 `projectChatEnabled` 给项目生命周期分支，制造第二条 legacy 写路径；
- 把偏好持久化改成 renderer localStorage 私有存储从而绕过一致性问题（会与既有 `ChatWorkspaceState` schema 分裂）；
- 通过延迟、忽略 snapshot 或比较本地时间戳掩盖竞态；
- 顺手补 `projectChatThreadToWorkspaceThread` 的降级字段（本单显式不做，见 P1-2 处置）。

## 验证命令

```bash
npm run typecheck
node --test electron/chat-workspace-store.test.mjs electron/workspace-session.test.mjs electron/desktop-seam.test.mjs
npm run test:electron
git diff --check
```

完整 Electron 测试若仅受受控 loopback HTTPS fixture sandbox 限制失败，必须记录精确失败并在允许本地回环监听的环境复跑；不得把其它失败归类为环境问题。

## 完成条件

- `ATDD-WS-202`、`ATDD-WS-203`、`ATDD-WS-204` 有自动证据；
- `ATDD-WS-201` ownership audit 以归属矩阵形式落盘并关闭；
- P0 代码与测试通过；
- `FIX-CHAT-01` 在本单完成后才开始。

## 停止条件

若必须恢复 full workspace writer、必须让 Main 接受 renderer 传入的 thread 数据、必须修改 Project Chat broker/IPC 才能落地项目命令，或发现除本单列出之外的第三类 renderer durable workspace writer，立即停止并回报，不能用兼容 fallback 推进。
