# Evidence

## `ACC-01`

- 结果：完成。
- 证据：用户确认每次发送创建新线程、通道固定绑定项目、调用方传完整指令、是否打开线程可配置，并选择复用现有状态能力。
- 实现：`src/agent-command-channel.ts` 提供配置、发送、打开线程、状态查询与订阅；`AppShell` / `ChatPage` / `WorkspaceSession` 完成非激活线程与 Chat Run 状态桥接。

## `IMP-01` / `TST-01` / `SYNC-01` / `CHK-01`

- 结果：实现与 Codex 自检完成；Acceptance 未写正式通过状态。
- 来源仓库：`npm run typecheck -- --pretty false` 通过；`npm run test:electron` 86/86 通过；`git diff --check` 通过。
- 同步仓库：`npm run typecheck -- --pretty false` 通过；`npm run test:electron` 101/101 通过；选题入口 source audit 9/9 通过。
- 一致性：`src/agent-command-channel.ts` 与 `electron/agent-command-channel.test.mjs` 在两个仓库逐字一致；共享类型仅保留 IntelligentOS 既有 `AppViewId = 'ai'` 差异，`ChatPage` 仅保留既有 localStorage key 差异。
- 工具缺口：两个仓库都不存在规则中历史引用的 `.codex/scripts/check-acceptance.sh`，因此未运行该格式检查，也未执行正式验收。
- 剩余风险：尚未在真实 Electron 窗口中用真实 SDK 长任务逐项执行 `stay` / `open`、等待输入、成功、失败与取消场景；交由 `VER-01` 正式验收。
