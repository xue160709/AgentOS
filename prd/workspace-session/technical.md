# 工作区与会话技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `src/components/types.ts` | `WorkspaceProject`、`WorkspaceThread`、`ChatWorkspaceState` 等 UI 状态类型。 |
| `src/components/workspace-session.ts` | 工作区状态恢复、项目/线程生命周期和防抖保存规则。 |
| `src/components/AppShell.tsx` | 工作区状态在 UI 壳层中的装配。 |
| `src/components/AppShellSidebar.tsx` | 项目、线程、Skill 与侧栏偏好展示。 |
| `src/components/AppShellWorkspace.tsx` | 工作区主内容区协调。 |
| `src/components/project-order.ts` | 项目排序规则。 |
| `src/chat-workspace-persistence.ts` | 渲染层工作区快照归一化。 |
| `electron/chat-workspace-store.ts` | 主进程 JSON/SQLite/JSONL 持久化与搜索。 |
| `electron/workspace-session.test.mjs` | 工作区状态不变量测试。 |

## 数据结构

- `WorkspaceProject`：项目 id、名称、路径、时间戳、置顶和运行时缺失标记。
- `WorkspaceThread`：线程 id、项目归属、用途、Skill/task 元数据、时间戳、归档和 `chatState`。
- `WorkspaceSidebarPrefs`：侧栏收起、项目折叠和手动顺序。
- `WorkspaceSession`：集中维护状态转换，避免 UI 分散修改不变量。

## 调用链路

```text
用户操作项目/线程/侧栏
  -> AppShell / Sidebar 调用 WorkspaceSession
  -> 生成新的 ChatWorkspaceState
  -> 渲染层 localStorage + window.desktop.saveChatWorkspace
  -> electron/chat-workspace-store.ts 落盘
```

## 日志与调试

- 工作区保存失败应观察 `saveChatWorkspace` IPC 和 `ChatWorkspaceStore.save`。
- 任务线程异常需同时看 `TaskHomePluginManager` 的 thread seed 与工作区合并逻辑。

## 测试与验收

- 自动测试：`electron/workspace-session.test.mjs`。
- 覆盖点：活动项目恢复、显式首页选择、线程归档、项目移除/排序/重定位、防抖保存、任务线程合并。
- 验收契约：`prd/workspace-session/acceptance.md`。

## 边界情况

- 活动线程缺失时回退到最新可见线程。
- 项目路径缺失不删除历史线程。
- 归档线程不参与默认活跃线程选择。

## TODO 对应项

- `TODO.md §14`：正式验收与产品 backlog 重整。

## 最近同步

- commit：`bb8d2b04de464f1a09decc875f2e869afe8885fb`
- 日期：`2026-06-23`
- 变化摘要：根据当前工作区 seam 和测试补齐 as-built PRD。
- 待确认：UI 端端到端截图证据尚缺。

