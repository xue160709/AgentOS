# Task Home Plugin 技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `electron/task-home-plugin-manager.ts` | 任务卡保存、读取、运行、停止、调度和 runtime 同步。 |
| `electron/home-plugin-runner.ts` | 任务卡目录与删除协作。 |
| `electron/claude-agent-runner.ts` | 任务运行实际提交到 Claude Agent SDK。 |
| `src/desktop-types.ts` | 任务配置、runtime、event、result 类型。 |
| `src/components/chat/ProjectHomeSurface.tsx` | 任务卡 UI、创建/编辑/运行/停止入口。 |
| `src/components/workspace-session.ts` | `task-run` 线程合并。 |
| `electron/main.ts` | Task Home Plugin IPC handlers。 |

## 数据结构

- `HomePluginTaskConfig`：slug、title、mode、sessionMode（independent/shared）、skillSteps、todoEnabled、runCount、schedule、enabled。
- `HomePluginTaskRuntime`：projectPath、threadId、status、requestId、run/step 进度、结果、错误、nextRunAt。
- `HomePluginTaskEvent`：推送给渲染层的任务状态和可选 thread seed。

## 调用链路

```text
用户保存任务卡
  -> saveTaskHomePlugin
  -> TaskHomePluginManager.saveTask
  -> 写 manifest/task/runtime/extractor

用户运行任务
  -> runTaskHomePlugin
  -> TaskHomePluginManager.startTask
  -> 创建 task-run thread seed
  -> ClaudeAgentRunner.submit
  -> ClaudeChatEvent 回流更新 runtime
```

## 日志与调试

- 任务运行问题优先看 `runtime.json` 的 status/detail/lastError/requestId。
- Skills 模式必须至少一个有效 step；否则保存或运行应被拒绝。
- 停止任务需要同时 cancel runner request 和更新 runtime。

## 测试与验收

- Task Home Plugin acceptance 已完成正式验收状态同步；会话配置读写、串行调度和停止当前步骤见 `electron/task-home-plugin-manager.test.mjs`。
- 建议补充：保存任务 fixture、Skills 空步骤、stopTask、reconcileInterruptedRuntime、interval nextRunAt。
- 验收契约：`prd/task-home-plugin/acceptance.md`。

## 边界情况

- runCount 被限制在 1 到 100。
- 应用重启后 queued/running/waiting 会被标记为 cancelled。
- 定时任务依赖 Electron 进程存活，不是系统级后台守护。
- 删除任务卡前会清理 timer、active session 和 request mapping。

## TODO 对应项

- `TODO.md §14`：补任务卡专项单测、真实长链路 GUI/E2E 和 Electron 存活期间定时任务回归证据。

## 最近同步

- commit：`27851a1fcbd8e8a85b0892d8a5d30db5a17acc5f`
- 日期：`2026-06-24`
- 变化摘要：同步全量 `project-verify` 与交互流程复查结果；Task Home Plugin acceptance 已通过，任务卡运行、停止、重启清理和定时递推均已纳入正式验收状态。
- 待确认：长期定时任务的用户承诺仍限定为 Electron 进程存活期间有效，后续可补专项单测和真实 GUI/E2E。
