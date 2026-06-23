# 持久化技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `src/chat-workspace-persistence.ts` | 渲染层工作区状态归一化与 localStorage key。 |
| `src/components/workspace-session.ts` | 防抖保存、flush、clear 和 close 时序。 |
| `electron/chat-workspace-store.ts` | JSON 快照、SQLite 索引、JSONL rollout、聊天历史搜索。 |
| `electron/claude-agent-settings.ts` | Provider 设置独立 store。 |
| `electron/agent-mode-settings-store.ts` | Agent Mode 项目设置独立 store。 |
| `electron/desktop-preferences-store.ts` | 桌面偏好独立 store。 |
| `electron/main.ts` | 清理工作区/设置数据 IPC。 |
| `electron/workspace-session.test.mjs` | 工作区保存与恢复测试。 |

## 数据结构

- `ChatWorkspaceState`：项目、线程、活动选择和侧栏偏好。
- `ThreadRow` / `ProjectRow`：SQLite 索引中的线程和项目摘要。
- rollout JSONL：每条线程 transcript 的事件流持久化。
- 独立 store 文件：`claude-agent-settings.json`、`agent-mode-settings.json`、desktop preferences 文件。

## 调用链路

```text
React 状态变化
  -> WorkspaceSession.stage
  -> 防抖 flush
  -> window.desktop.saveChatWorkspace
  -> ChatWorkspaceStore.save
  -> JSON + JSONL + 可选 SQLite
```

## 日志与调试

- SQLite 不可用时应静默 fallback 到 JSON/JSONL，不阻塞主流程。
- 清理工作区数据会取消当前 Agent 请求并移除 workspace artifacts，但不删除 Provider/Agent Mode/桌面偏好。

## 测试与验收

- 自动测试：`electron/workspace-session.test.mjs`。
- 间接覆盖：`electron/chat-run.test.mjs` 验证 chatState 中 session/model/diff 等状态更新。
- 验收契约：`prd/persistence/acceptance.md`。

## 边界情况

- 活动引用缺失时恢复为有效项目和线程。
- 保存前剥离 `pathMissing`，恢复后重新计算。
- JSON 仍是兼容快照和迁移输入。
- 搜索优先 SQLite，失败后 fallback 到 JSON/rollout 扫描。

## TODO 对应项

- `TODO.md §14`：补 SQLite fallback、rollout 文件和清理数据正式验收。

## 最近同步

- commit：`bb8d2b04de464f1a09decc875f2e869afe8885fb`
- 日期：`2026-06-23`
- 变化摘要：按工作区持久化、独立 store 和搜索实现补齐 as-built PRD。
- 待确认：SQLite CLI 缺失场景需在 project-verify 中显式覆盖。

