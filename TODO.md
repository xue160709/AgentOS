# AgentOS TODO

## 0. 首页卡片

| 字段 | 内容 |
| --- | --- |
| 当前阶段 | 架构深化：全部完成 |
| 总进度 | 5 / 5（100%） |
| 当前主任务 | T01–T05 全部完成 |
| 下一步 | 无 |
| 阻塞项 | 无 |
| 最近更新 | 2026-06-14 |

## 1. 当前任务

- [x] T01. 深化 Chat Run 提交流程
  - 状态：done
  - 优先级：P0
  - 范围：pending request 创建、真实 request 对齐、bridge 不可用、submit 失败、Session 失效清理、terminal transcript row
  - 完成标准：`ChatPage` 不再直接编排 `beginSubmission` / `acceptSubmission` / `rejectSubmission`；提交失败与 bridge 失败可通过 `ChatRun` interface 测试；`npm run typecheck` 与 `npm run test:electron` 通过
  - 结果：新增 `ChatRun.submit()` interface，`ChatPage` 不再直接持有 pending request id；新增 2 组 submit interface 测试；`npm run typecheck` 与 `npm run test:electron`（33 项）通过

## 2. 后续顺序

- [x] T02. 统一 Workspace Session restore rules
  - 状态：done
  - 优先级：P0
  - 范围：restore-time reconciliation、active project/thread fallback、latest visible thread 规则去重
  - 完成标准：persistence adapter 只读写 snapshot；Workspace Session 统一决定恢复后的 active project/thread
  - 结果：新增 `WorkspaceSession.restore()` 与 `restoreWorkspaceSessionState()`；`normalizeChatWorkspaceState` 不再挑选 active thread；移除旧 `reconcileActiveProject`；新增 3 组 restore interface 测试；`npm run typecheck` 与 `npm run test:electron`（36 项）通过
- [x] T03. 收拢 Project Content desktop implementation
  - 状态：done
  - 优先级：P1
  - 范围：tree、preview、search、watch、ignore policy、path normalization、event emission
  - 完成标准：Electron `main.ts` 主要注册 Desktop Seam；Project Content 文件规则集中在一个 implementation module
  - 结果：新增 Electron-side `project-content` implementation，统一承接 tree、preview、search、watch 与 path rules；`main.ts` 仅保留 IPC 注册与事件转发；`agent-context` 不再持有项目文件搜索；新增 2 组 desktop implementation 测试；`npm run typecheck` 与 `npm run test:electron`（38 项）通过
- [x] T04. 深化 Project Content search lifecycle
  - 状态：done
  - 优先级：P1
  - 范围：stale-safe search、stable unavailable result、error normalization
  - 完成标准：搜索调用方不再重复底层不可用/过期结果规则
  - 结果：`ProjectContent.search()` 统一返回稳定搜索结果并归一化底层不可用/异常；新增 `ProjectContentSearchSession` 丢弃过期结果；`AppSearchModal` 与 `ChatPage` 不再重复 catch/null/stale 规则；新增 3 组 search lifecycle 测试
- [x] T05. 深化 Desktop Seam contract
  - 状态：done
  - 优先级：P2
  - 范围：capability 清单、channel name、event channel、preload forwarding、main registration verification
  - 完成标准：Desktop Seam contract 成为单一事实来源，测试验证声明能力端到端对齐
  - 结果：新增 `desktop-seam` contract，集中声明 static/invoke/event capabilities 与 channel；preload、main、app-updater、speech-recognition 均从 contract 取 channel；新增 Desktop Seam contract 测试；`npm run typecheck` 与 `npm run test:electron`（41 项）通过
