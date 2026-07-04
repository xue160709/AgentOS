# 工作区与会话技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `src/components/types.ts` | `WorkspaceProject`、`WorkspaceThread`、`ChatWorkspaceState` 等 UI 状态类型。 |
| `src/components/workspace-session.ts` | 工作区状态恢复、项目/线程生命周期、即时 durable save、防抖保存和 revision 推进规则。 |
| `src/components/AppShell.tsx` | 工作区状态在 UI 壳层中的装配；通过 `workspaceSession.stage` 提交保存，不拥有双写顺序。 |
| `src/components/AppShellSidebar.tsx` | 项目、线程、Skill 与侧栏偏好展示。 |
| `src/components/AppShellWorkspace.tsx` | 工作区主内容区协调。 |
| `src/components/project-order.ts` | 项目排序规则。 |
| `src/chat-workspace-persistence.ts` | 渲染层工作区快照归一化。 |
| `src/workspace-snapshot-resolution.ts` | 快照 freshness、revision、完整度和空快照选择规则。 |
| `electron/chat-workspace-store.ts` | 主进程 JSON/SQLite/JSONL 持久化与搜索。 |
| `electron/workspace-session.test.mjs` | 工作区状态不变量测试。 |

## 数据结构

- `WorkspaceProject`：项目 id、名称、路径、时间戳、置顶和运行时缺失标记。
- `WorkspaceThread`：线程 id、项目归属、用途、Skill/task 元数据、时间戳、归档和 `chatState`。
- `WorkspaceSidebarPrefs`：侧栏收起、项目折叠和手动顺序。
- `ChatWorkspaceState.workspaceRevision`：工作区级逻辑时钟，由 Workspace Session 在 durable 内容变化时推进。
- `WorkspaceSession`：集中维护状态转换，避免 UI 分散修改不变量。

## 调用链路

```text
用户操作项目/线程/侧栏
  -> AppShell / Sidebar 调用 WorkspaceSession
  -> 生成新的 ChatWorkspaceState
  -> WorkspaceSession.stage
  -> immediate adapter 写 renderer localStorage durable snapshot
  -> debounce flush 调用 window.desktop.saveChatWorkspace
  -> electron/chat-workspace-store.ts 落盘
```

## 日志与调试

- 工作区保存失败应观察 `saveChatWorkspace` IPC 和 `ChatWorkspaceStore.save`。
- 退出或重启后丢新对话应先检查 `WorkspaceSession.stage` 是否执行 immediate adapter、pending save 是否被 close flush、以及快照 revision 是否持续推进。
- 任务线程异常需同时看 `TaskHomePluginManager` 的 thread seed 与工作区合并逻辑。

## 测试与验收

- 自动测试：`electron/workspace-session.test.mjs`。
- 覆盖点：活动项目恢复、显式首页选择、线程归档、项目移除/排序/重定位、防抖保存、即时 durable snapshot、runtime-only 字段不触发 durable save、任务线程合并。
- 验收契约：`prd/workspace-session/acceptance.md`。

## 边界情况

- 活动线程缺失时回退到最新可见线程。
- 项目路径缺失不删除历史线程。
- 归档线程不参与默认活跃线程选择。
- `pathMissing` 不进入 durable fingerprint；仅路径、项目、线程、侧栏偏好或 transcript 等持久化内容变化时推进 `workspaceRevision`。

## TODO 对应项

- `TODO.md §14`：正式验收与产品 backlog 重整。

## 最近同步

- commit：`27851a1fcbd8e8a85b0892d8a5d30db5a17acc5f`
- 日期：`2026-06-24`
- 变化摘要：同步全量 `project-verify` 与交互流程复查结果；Workspace Session 即时 renderer durable save、防抖主进程保存和 `workspaceRevision` 已完成正式验收状态同步。
- 待确认：全页面点击式工作区 E2E 截图和产品 backlog 优先级仍可补充。
