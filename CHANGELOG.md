# CHANGELOG

本文件记录已经完成、值得后续用户或 Agent 知道的变更。修补 bug 后必须追加到 `Unreleased / Bug Fixes`。

## Unreleased

### Bug Fixes

- 2026-06-24: 修复项目 MCP 设置在切换项目、关闭面板或自动测试期间的状态串台。处理：项目 MCP 设置加载、保存和探测增加项目路径与请求代际 guard，并拆分项目 MCP 的保存/测试 operation，自动测试不再显示为保存中；验证：`npm run typecheck`、`node --test electron/agent-mode-settings-store.test.mjs electron/claude-agent-runner-mcp.test.mjs electron/chat-run.test.mjs electron/desktop-seam.test.mjs`、`npm run test:electron`、`git diff --check`；范围：项目 MCP 设置面板。
- 2026-06-24: 修复进入全局 MCP 设置页时自动连接测试误显示“正在保存 MCP 设置”。处理：拆分全局 MCP 设置页的保存/测试事务状态，自动测试只展示测试中，保存按钮仅在真实保存时显示保存中；验证：`npm run typecheck`、`node --test electron/desktop-seam.test.mjs`、`npm run test:electron`；范围：全局 MCP 设置页。

### Process

- 2026-06-24: 新增协作约定：后续 bugfix 完成后必须写入本文件，并保留症状、处理方式和验证方式。
