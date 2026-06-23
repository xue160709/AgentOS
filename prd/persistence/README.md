# 持久化

## 模块定位

持久化模块负责保存和恢复项目、线程、聊天 transcript、模型选择、Agent Mode 设置、桌面偏好和 Provider 设置，让 AgentOS 能跨重启延续长期工作。

## 当前已实现

- 工作区状态会归一化后保存到渲染层 localStorage 和 Electron 主进程 mirror。
- 主进程保存 `chat-workspace.json`，并在 `sqlite3` CLI 可用时维护 SQLite 索引。
- 每个线程的聊天 rollout 会按线程和日期写入 JSONL。
- 工作区恢复时会修正无效活动项目、活动线程和旧结构。
- 线程模型选择、sessionId、cwd、归档、置顶和特殊线程元数据会进入持久化结构。
- Agent Mode 设置、Claude Provider 设置、桌面偏好分别保存在独立 store。

## 用户流程

```text
1. 用户创建项目、线程或修改设置
   ↓
2. UI 防抖保存工作区，主进程写 JSON/SQLite/JSONL
   ↓
3. 应用重启后恢复项目、线程和偏好
   ↓
4. 缺失路径被标为运行时状态，历史记录仍保留
```

## 还没做什么

- SQLite 可用性和 JSON fallback 已有代码路径，但仍缺正式验收证据。
- 数据迁移策略需要随后续格式变化持续补 technical 与测试。

## 关键决策

- JSON 快照保留兼容与迁移入口，SQLite 作为紧凑索引和搜索加速。
- 独立设置 store 避免开发者清理工作区时误删模型、Agent Mode 或桌面偏好。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `workspace-session`：提供状态转换与防抖保存。
- `chat-agent-runtime`：保存 thread chatState、sessionId 和模型。
- `model-settings`、`agent-mode`、`desktop-shell-settings-release`：使用独立 store。

