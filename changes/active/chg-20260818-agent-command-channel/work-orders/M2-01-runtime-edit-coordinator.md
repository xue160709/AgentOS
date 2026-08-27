# M2-01｜RuntimeEditCoordinator 与 Runner Hooks

## 目标

实现 Main 内存态 edit session：可靠写入前 lease、实际 mutation、potential runs、三条件 settle 和 generation fence。此单不改用户 UI。

## 依赖

- `M0-06` 的 M0 Gate 通过；可与 M1-01 并行，但不得改 M1 文件。
- 精读 `design.md §8`、`technical.md §12`。

## Write allowlist

- `electron/runtime-edit-coordinator.ts`（新增）
- `electron/runtime-edit-coordinator.test.mjs`（新增）
- `electron/claude-agent-runner.ts`
- `electron/claude-agent-runner/file-diff.ts`
- 与 before/post tool hook 直接相关的现有 `electron/claude-agent-runner/*` 文件（开始前列出，未列出不得写）
- `electron/project-chat-broker.ts`
- `electron/project-chat-broker.test.mjs`
- `src/project-chat-contract.ts`（仅 runtime edit snapshot 类型）

禁止写：React、Runtime implementation、deep link/binding、workspace store schema。

## 实施步骤

1. 依赖注入 clock/timer/fingerprint/runtime intent；测试使用 fake timer。
2. 非 plan runner accepted 登记 potential；terminal 清理。
3. `Edit/Write/NotebookEdit` before-tool acquire lease；工具失败释放且不记 mutation，成功根据可靠结果记 mutation。
4. 其它工具只在 PostToolUse successful 且 file-diff 返回项目根内非空 diff 时记 mutation；不解析 Bash。
5. mutation + all potential terminal + fingerprint stable 1500ms 后产生一次 settle intent；30s 超时 failure。
6. failed/cancelled after mutation 设置 no-auto-build；无 mutation 失败不污染后续 generation。
7. settle/build 期间新 potential/mutation 提升 generation；旧结果拒绝。
8. manual lease/manual stop fence 与 Agent lease 分开；stop fence 阻止自动拉起直到显式恢复。

## 必测断言

- read/search/explain 不 acquire、不启动 Runtime。
- 三个明确写工具 before-tool 触发；Bash 文本含 `>`/`sed` 不触发，只有 diff 触发。
- 多 thread potential 未全 terminal 不 settle。
- 每 generation 最多一个 settle/build；旧结果不切换。
- failed/cancel matrix 符合 design。

## 命令

```bash
npm run typecheck
node --test electron/runtime-edit-coordinator.test.mjs electron/project-chat-broker.test.mjs electron/chat-run.test.mjs
```

## 停止并报告

若 SDK 没有可靠 before-tool hook，禁止退化为 Bash/prompt 猜测；报告可观察事件与最小合同修订选项。
