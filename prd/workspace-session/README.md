# 工作区与会话

## 模块定位

工作区与会话模块让用户可以管理多个本地项目，并为每个项目维护独立聊天线程、任务线程、Skill 运行线程和侧栏偏好。

## 当前已实现

- 支持添加、切换、置顶、移除和重定位本地项目。
- 每个项目支持多线程，线程可置顶、归档、选择和更新标题。
- 支持 `home`、`docs`、`settings` 和聊天线程视图，未知 hash 会回到安全默认视图。
- Project Skill 运行会创建 `skill-run` 专用线程，并记录 Skill 路径、命令、标题和模型选择。
- 侧栏收起、项目折叠、项目顺序等偏好会随工作区保存。
- Workspace Session 统一处理即时 renderer durable snapshot、防抖主进程保存和关闭前 flush，React 壳层不再掌握双写顺序。
- 工作区状态持有 `workspaceRevision`，用于跨 adapter 恢复时判断新旧。

## 用户流程

```text
1. 用户选择一个项目目录
   ↓
2. 系统创建项目记录并进入项目首页
   ↓
3. 用户在项目内新建普通聊天、运行 Skill 或打开任务线程
   ↓
4. Workspace Session 写入 durable snapshot 并安排主进程 mirror 保存
   ↓
5. 工作区在重启后按 revision 恢复项目、线程和侧栏状态
```

## 还没做什么

- 工作区与会话 acceptance 已完成正式验收状态同步；后续可为全部工作区 UI 流程沉淀全页面点击式 E2E 截图。
- 项目/线程搜索体验已有持久化和索引支撑，但产品优先级仍需后续整理。

## 关键决策

- 工作区状态转换集中在 `WorkspaceSession`，React 壳层只作为 adapter 调用，避免 UI 分散持久化不变量。
- 项目路径缺失是运行时状态，不写回持久化快照。
- `pathMissing` 等 runtime-only 变化不会推进 durable revision，避免旧快照因运行时校验被误认为更新。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `persistence`：负责工作区快照与线程索引落盘。
- `chat-agent-runtime`：使用线程状态保存会话、模型和 transcript。
- `home-plugin`、`task-home-plugin`：在项目首页和专用任务线程中工作。
