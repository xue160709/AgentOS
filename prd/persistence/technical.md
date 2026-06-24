# 持久化技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `src/chat-workspace-persistence.ts` | 渲染层工作区状态归一化与 localStorage key。 |
| `src/workspace-snapshot-resolution.ts` | Workspace Snapshot Resolution：统一 revision、savedAt、完整度、空快照和 adapter 候选选择规则。 |
| `src/components/workspace-session.ts` | 即时 durable save、防抖保存、flush、clear、close 和 revision 推进时序。 |
| `electron/chat-workspace-store.ts` | JSON 快照、SQLite metadata、JSONL rollout、History Search Index internal seam。 |
| `electron/claude-agent-settings.ts` | Provider 设置独立 store。 |
| `electron/agent-mode-settings-store.ts` | Agent Mode 项目设置独立 store。 |
| `electron/desktop-preferences-store.ts` | 桌面偏好独立 store。 |
| `electron/main.ts` | 清理工作区/设置数据 IPC。 |
| `electron/workspace-session.test.mjs` | Workspace Session 保存时序、即时 durable snapshot 和 runtime-only 字段测试。 |
| `electron/chat-workspace-store.test.mjs` | SQLite/JSON 快照选择、revision 优先级、空快照和聊天历史搜索索引测试。 |

## 数据结构

- `ChatWorkspaceState`：项目、线程、活动选择、侧栏偏好和 `workspaceRevision`。
- `workspaceRevision`：跨 renderer localStorage、Electron JSON 和 SQLite metadata 比较快照新旧的逻辑时钟；旧快照缺 revision 时降级到 `savedAt` 与状态更新时间。
- `ThreadRow` / `ProjectRow`：SQLite 索引中的线程和项目摘要。
- `workspace_meta.workspace_revision`：SQLite metadata 中的工作区 revision。
- rollout JSONL：每条线程 transcript 的事件流持久化。
- `search_documents` / `search_documents_fts`：History Search Index 的 SQLite 普通表与 FTS 表，只服务聊天历史搜索。
- 独立 store 文件：`claude-agent-settings.json`、`agent-mode-settings.json`、desktop preferences 文件。

## 调用链路

```text
React 状态变化
  -> WorkspaceSession.stage
  -> 立即写 renderer localStorage durable snapshot
  -> 防抖 flush
  -> window.desktop.saveChatWorkspace
  -> ChatWorkspaceStore.save
  -> JSON + JSONL + workspace_meta SQLite
  -> History Search Index 刷新 search_documents / FTS
```

```text
应用启动
  -> loadChatWorkspaceState
  -> renderer localStorage candidate + Electron mirror candidate
  -> Workspace Snapshot Resolution
  -> finalizeChatWorkspaceState / restoreWorkspaceSessionState
  -> WorkspaceSession.load 暴露给 AppShell
```

## 日志与调试

- SQLite 不可用时应静默 fallback 到 JSON/JSONL，不阻塞主流程。
- 清理工作区数据会取消当前 Agent 请求并移除 workspace artifacts，但不删除 Provider/Agent Mode/桌面偏好。
- 快照新旧判断优先看 `workspaceRevision`；仅旧快照缺 revision 时使用 `savedAt`、mtime 和嵌套更新时间排查。
- 搜索结果异常优先看 History Search Index；恢复丢失优先看 Workspace Snapshot Resolution 与 `ChatWorkspaceStore.read`。

## 测试与验收

- 自动测试：`electron/workspace-session.test.mjs`、`electron/chat-workspace-store.test.mjs`。
- 间接覆盖：`electron/chat-run.test.mjs` 验证 chatState 中 session/model/diff 等状态更新。
- 本轮回归覆盖：新 JSON 快照覆盖旧 SQLite、revision 优先于 savedAt、空工作区保存不复活旧 SQLite、即时 durable snapshot、`pathMissing` runtime-only 变化不 bump durable snapshot、聊天历史搜索索引可替换。
- 验收契约：`prd/persistence/acceptance.md`。

## 边界情况

- 活动引用缺失时恢复为有效项目和线程。
- 保存前剥离 `pathMissing`，恢复后重新计算。
- JSON 仍是兼容快照和迁移输入。
- 空工作区快照保留 revision；带更新 revision 的清空快照不会被旧 SQLite 行复活。
- Workspace Session 只在剥离 runtime-only 字段后的 durable fingerprint 改变时推进 revision。
- 搜索优先 SQLite，失败后 fallback 到 JSON/rollout 扫描。

## TODO 对应项

- `TODO.md §14`：正式验收剩余人工场景、产品 backlog 重整和本轮持久化加固记录。

## 最近同步

- commit：`fe05e462a76283b9c314ab22f68fdc24f9f199d0`
- 日期：`2026-06-24`
- 变化摘要：增量同步未提交代码观察：新增 Workspace Snapshot Resolution module、workspace revision clock、Workspace Session 即时 durable save、主进程 SQLite `workspace_revision` metadata、History Search Index internal seam 与持久化回归测试。
- 待确认：本轮为 Codex 自检与单测覆盖，未执行正式 `project-verify` 重新盖戳。
