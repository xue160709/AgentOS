# Task Home Plugin

## 模块定位

Task Home Plugin 模块把项目首页卡片升级为可长期运行的任务：用户可以创建 Agent 模式或 Skills 编排模式任务，手动或定时运行，并按会话设置执行任务。

## 当前已实现

- 支持创建或更新任务卡，写入 `manifest.json`、`task.json`、`runtime.json` 和任务 extractor。
- 任务模式包括基于项目 `AGENT.md` 的 Agent 模式，以及按步骤顺序执行的 Skills 模式。
- 任务运行态覆盖 `idle`、`queued`、`running`、`waiting`、`done`、`error`、`cancelled`。
- Skills 默认每轮每步新建任务会话，旧配置缺少该字段时同样默认独立。编辑表单可选共用会话，同一次启动的所有步骤和轮次将复用一条任务线程。
- 支持 1 到 100 次运行次数，以及 off/1h/2h/3h/6h/12h/1d interval 定时策略。
- 支持手动停止运行，并取消关联 Claude Agent 请求。
- 应用重启后会把未完成 runtime 标记为 cancelled，避免误认为后台任务仍在运行。

## 用户流程

```text
1. 用户在项目首页创建任务卡
   ↓
2. 选择 Agent 模式或 Skills 编排模式，并配置次数/定时
   ↓
3. 手动或定时启动任务
   ↓
4. 系统创建 task-run 线程并同步任务 runtime
   ↓
5. 任务完成、失败或被停止后更新卡片状态
```

## 还没做什么

- Task Home Plugin acceptance 已完成正式验收状态同步；Skills 缺步骤、手动停止、重启清理和定时递推均已有验收证据。
- 长周期后台执行依赖 Electron 进程存活，不是系统级守护进程。

## 关键决策

- 任务配置和运行态落在项目 `.agents/home-plugins/<slug>/` 下，方便项目级迁移和审阅。
- 任务会话使用 task-run 类型，避免与普通聊天混在一起。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `home-plugin`：共享首页卡片展示与目录协议。
- `chat-agent-runtime`：负责真正执行 Agent/Skills prompt。
- `workspace-session`：接收并合并 `task-run` 线程。
