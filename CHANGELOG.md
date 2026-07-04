# CHANGELOG

本文件记录已经完成、值得后续用户或 Agent 知道的变更。修补 bug 后必须追加到 `Unreleased / Bug Fixes`。

## Unreleased

### Bug Fixes

- 2026-06-24: 修复 release 版添加 stdio MCP 时 `spawn npx ENOENT`。处理：MCP runtime 为 stdio server 增强 release-safe PATH，优先解析用户级 Node 管理器与 Homebrew 常见命令为绝对路径，并把增强 PATH 传给连接测试与 SDK 子进程；验证：`npm run typecheck`、`node --test electron/claude-agent-runner-mcp.test.mjs`、`npm run test:electron`、`git diff --check`；范围：MCP stdio runtime 与全局连接测试。
- 2026-06-24: 修复 macOS release 公证失败时只暴露 `Unexpected token 'E'` JSON parse 噪声。处理：通过 npm overrides 将 electron-builder 间接依赖的 `@electron/notarize` 固定到 2.5.0，使 notarytool 非 JSON/HTTP 错误保留原始诊断文本；验证：`npm run typecheck`、`git diff --check`；范围：release 依赖锁与 macOS notarization 错误诊断。
- 2026-06-24: 修复 WebSearch 设置页展示无可靠生效路径的“默认结果数”。处理：移除搜索设置页、共享设置类型和持久化返回值中的默认结果数字段，保留单次 `web_search` 调用的 `max_results` 入参和固定兜底；验证：`npm run typecheck`、`node --test electron/claude-agent-runner-web-search.test.mjs electron/agent-mode-settings-store.test.mjs`、`bash .codex/scripts/check-acceptance.sh desktop-shell-settings-release`、`git diff --check`；范围：全局搜索设置页与 AgentOS WebSearch runtime。
- 2026-06-24: 修复 Agent 状态面板将 MCP runtime `pending` 误当成连接健康状态。处理：状态面板优先使用项目 MCP 连接测试缓存，连接成功显示绿灯和 tools 数，未测试/运行时 pending 显示橙灯“待检测”，仅连接失败/认证失败类状态显示红灯“未连接”；验证：`npm run typecheck`、`node --test electron/desktop-seam.test.mjs`、`git diff --check`；范围：Agent 状态面板 MCP 列表。
- 2026-06-24: 修复项目 MCP 设置在切换项目、关闭面板或自动测试期间的状态串台。处理：项目 MCP 设置加载、保存和探测增加项目路径与请求代际 guard，并拆分项目 MCP 的保存/测试 operation，自动测试不再显示为保存中；验证：`npm run typecheck`、`node --test electron/agent-mode-settings-store.test.mjs electron/claude-agent-runner-mcp.test.mjs electron/chat-run.test.mjs electron/desktop-seam.test.mjs`、`npm run test:electron`、`git diff --check`；范围：项目 MCP 设置面板。
- 2026-06-24: 修复进入全局 MCP 设置页时自动连接测试误显示“正在保存 MCP 设置”。处理：拆分全局 MCP 设置页的保存/测试事务状态，自动测试只展示测试中，保存按钮仅在真实保存时显示保存中；验证：`npm run typecheck`、`node --test electron/desktop-seam.test.mjs`、`npm run test:electron`；范围：全局 MCP 设置页。

### Process

- 2026-06-24: 新增协作约定：后续 bugfix 完成后必须写入本文件，并保留症状、处理方式和验证方式。
