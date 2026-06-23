# 持久化验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：启动时恢复并归一化工作区状态
系统 SHALL 在启动时恢复项目、线程、活动状态、聊天状态和侧栏偏好，并对旧字段、缺失引用和无效结构执行归一化。

#### 场景：活动线程不存在
- GIVEN 恢复的工作区状态引用了不存在的活动线程
- WHEN `WorkspaceSession.load` 恢复快照
- THEN 系统自动修正活动线程引用，避免 UI 进入无效状态

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/workspace-session.test.mjs

#### 场景：显式项目首页选择
- GIVEN 用户上次停留在项目首页而不是线程
- WHEN 应用恢复工作区
- THEN 系统保留项目首页选择，不强制跳到最新线程

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/workspace-session.test.mjs

### 需求：工作区状态防抖保存到渲染层和主进程
系统 SHALL 在渲染层状态变化后防抖保存到 localStorage，并同步写入 Electron 主进程 mirror。

#### 场景：连续状态变化
- GIVEN 用户连续切换项目或更新线程
- WHEN 防抖保存触发
- THEN 系统只保存最新快照，并取消较旧的待保存任务

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/workspace-session.test.mjs

#### 场景：关闭前仍有新快照
- GIVEN 上一次保存仍在进行且用户又产生了新状态
- WHEN `WorkspaceSession.close` 被调用
- THEN 系统等待并保存最新快照后再关闭 session

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/workspace-session.test.mjs

### 需求：主进程持久化支持 JSON、SQLite 和 JSONL
系统 SHALL 将工作区镜像写入 JSON，并在 sqlite3 CLI 可用时写入紧凑线程索引；聊天 rollout SHALL 按线程和日期写入 JSONL。

#### 场景：SQLite 不可用
- GIVEN 当前环境无法使用 sqlite3 写入索引
- WHEN 主进程保存工作区
- THEN 系统继续保存 JSON 和 JSONL，并不阻塞主流程

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: npm run typecheck

#### 场景：清理工作区快照
- GIVEN 开发者在设置中确认清理工作区数据
- WHEN 清理操作执行
- THEN 系统删除工作区和聊天记录存储，但不删除模型 Provider、Agent Mode 设置或用户项目目录

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=button[name="清理工作区数据"]

## 平台专项验证（Electron + Node）

- 验证 userData 写入失败时不会静默标记成功。
- 验证 SQLite fallback 不阻断 JSON 快照。
- 验证清理操作不会误删独立 settings store。

## 建议验证命令

```bash
npm run typecheck
node --test electron/workspace-session.test.mjs
```

