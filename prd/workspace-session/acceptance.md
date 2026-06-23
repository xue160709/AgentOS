# 工作区与会话验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：用户可以管理本地项目工作区
系统 SHALL 允许用户通过桌面目录选择器添加本地项目、切换活动项目，并在项目路径缺失时保留项目记录与历史线程。

#### 场景：添加本地项目
- GIVEN 用户在空工作区或已有工作区中打开添加项目入口
- WHEN 用户选择一个本地目录作为项目
- THEN 系统创建 `WorkspaceProject`，保存项目名称、路径、创建时间和更新时间，并进入该项目首页

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=button[name="添加项目"]

#### 场景：项目路径缺失
- GIVEN 已保存项目路径在启动校验时不存在
- WHEN 系统恢复工作区状态
- THEN 该项目被标记为路径缺失，但项目记录与历史线程不被删除

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/workspace-session.test.mjs

### 需求：每个项目支持独立线程生命周期
系统 SHALL 为每个项目维护多条线程，并支持新建、选择、置顶、归档、移除和更新时间维护。

#### 场景：创建普通聊天线程
- GIVEN 用户已选中一个项目
- WHEN 用户从项目首页或聊天入口创建新线程
- THEN 系统在活动项目下创建线程，并将线程绑定到当前项目 ID

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/workspace-session.test.mjs

#### 场景：归档活动线程
- GIVEN 当前活动线程属于项目 A
- WHEN 用户归档该线程
- THEN 系统保留线程历史，且活动视图回到项目 A 首页或项目内最新可见线程

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/workspace-session.test.mjs

### 需求：Skill 运行创建专用线程
系统 SHALL 在用户从项目首页或侧栏运行 Project Skill 时创建 `skill-run` 线程，并记录 Skill 路径、命令、标题和实际模型选择。

#### 场景：运行 Project Skill
- GIVEN 当前项目存在可发现的 Project Skill
- WHEN 用户点击运行该 Skill
- THEN 系统创建归属于当前项目的 `skill-run` 线程，并按覆盖规则解析模型

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=button[name="运行 Skill"]

#### 场景：侧栏偏好恢复
- GIVEN 用户折叠项目线程列表并保存工作区
- WHEN 应用重启后恢复工作区
- THEN 侧栏保持对应项目折叠状态

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/workspace-session.test.mjs

## 平台专项验证（Electron + React）

- 验证目录选择器只由主进程打开。
- 验证项目路径缺失不会删除用户历史。
- 验证 task-run 与 skill-run 线程不污染普通聊天线程。

## 建议验证命令

```bash
npm run typecheck
node --test electron/workspace-session.test.mjs
```

