# Task Home Plugin 验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：用户可以创建长期任务卡片
系统 SHALL 允许用户创建 Task Home Plugin 卡片，并写入 manifest、task 配置和 runtime 状态。

#### 场景：创建任务卡片
- GIVEN 当前项目在工作区中
- WHEN 用户输入任务标题、选择运行模式并保存
- THEN 系统创建任务 slug，写入卡片 manifest、任务配置和初始 runtime

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=button[name="保存任务"]｜验证方式: node test-results/full-acceptance-smoke.mjs｜证据: TESTING_CHECKLIST.md｜

#### 场景：当前项目不在工作区
- GIVEN UI 或外部调用传入的项目路径不属于当前工作区
- WHEN 保存任务卡片
- THEN 系统拒绝保存并返回“当前项目不在工作区中”

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

### 需求：任务支持 Agent 模式和 Skills 模式运行
系统 SHALL 支持按项目 `AGENT.md` 执行的 Agent 模式，以及按选定 Skill Steps 顺序执行的 Skills 模式。

#### 场景：Agent 模式运行任务
- GIVEN 已保存的任务卡使用 Agent 模式
- WHEN 用户启动该任务
- THEN 系统构造包含任务标题、运行序号和 TODO 模式说明的 Agent prompt

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=button[name="运行任务"]｜验证方式: node test-results/full-acceptance-smoke.mjs｜证据: TESTING_CHECKLIST.md｜

#### 场景：Skills 模式缺少步骤
- GIVEN 已保存或待保存的任务卡使用 Skills 模式但没有有效步骤
- WHEN 用户尝试保存或运行
- THEN 系统拒绝该操作并提示至少需要一个有效 Skill step

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

### 需求：任务运行状态同步到 UI
系统 SHALL 维护 `idle`、`queued`、`running`、`waiting`、`done`、`error` 和 `cancelled` runtime 状态，并推送状态变化刷新项目首页。

#### 场景：任务开始运行
- GIVEN 用户手动触发任务或定时任务到期
- WHEN `TaskHomePluginManager.startTask` 启动任务
- THEN 系统更新 runtime 为 queued/running，并向项目首页推送任务事件和 task-run 线程 seed

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

#### 场景：用户停止运行中任务
- GIVEN 任务已关联一个活跃 Claude Agent request
- WHEN 用户点击停止操作
- THEN 系统取消该 request，将 runtime 置为 cancelled，并刷新项目首页

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=button[name="停止任务"]｜验证方式: node test-results/full-acceptance-smoke.mjs｜证据: TESTING_CHECKLIST.md｜

### 需求：任务支持运行次数和定时策略
系统 SHALL 支持 1 到 100 次运行限制，并支持未启用、指定时间和 interval 策略。

#### 场景：interval 定时任务完成
- GIVEN 任务启用了 interval 定时策略
- WHEN 任务完成一次运行
- THEN 系统按完成时间或计划时间递推计算下一次 `nextRunAt`

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

#### 场景：应用重启后恢复任务状态
- GIVEN 应用启动时读取到上次未完成的任务 runtime
- WHEN 任务管理器刷新工作区任务
- THEN 系统将该 runtime 标记为 cancelled，避免误认为后台任务仍在运行

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

## 平台专项验证（Electron + React）

- 验证后台任务只在 Electron 进程存活期间调度。
- 验证任务 prompt 不泄漏到普通聊天线程。
- 验证删除任务卡会清理 timer、session 和 request mapping。

## 建议验证命令

```bash
npm run typecheck
# 建议补充 task-home-plugin-manager 单元测试后纳入 npm run test:electron
```

