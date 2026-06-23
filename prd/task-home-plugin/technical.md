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

- `HomePluginTaskConfig`：slug、title、mode、skillSteps、todoEnabled、runCount、schedule、enabled。
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

- 当前缺专门的 Task Home Plugin 单元测试。
- 建议补充：保存任务 fixture、Skills 空步骤、stopTask、reconcileInterruptedRuntime、interval nextRunAt。
- 验收契约：`prd/task-home-plugin/acceptance.md`。

## 边界情况

- runCount 被限制在 1 到 100。
- 应用重启后 queued/running/waiting 会被标记为 cancelled。
- 定时任务依赖 Electron 进程存活，不是系统级后台守护。
- 删除任务卡前会清理 timer、active session 和 request mapping。

## TODO 对应项

- `TODO.md §14`：补任务卡单测与正式验收。

## 最近同步

- commit：`bb8d2b04de464f1a09decc875f2e869afe8885fb`
- 日期：`2026-06-23`
- 变化摘要：按任务卡管理器和项目首页任务 UI 补齐 as-built PRD。
- 待确认：长期定时任务的用户承诺需继续明确为 Electron 存活期间有效。

