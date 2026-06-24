# Agentic Engineering 优化 TODO

> 本 TODO 聚焦 `.codex/`、`AGENTS.md`、hooks 与验证脚本的 agentic runtime 优化。目标是把当前偏文档契约的设计，推进到可 lint、可门禁、可自测、可隔离的运行时体系。

## §1 当前状态

- [x] 完成本 TODO 中所有 P0/P1/P2 项并逐项打勾。
  - 证据：2026-06-17，已升级 runtime contract、schema lint、分级 gate、acceptance parser、drift check、patch gate、health report、golden fixtures 和聚合验证入口；`bash .codex/scripts/verify-agentic.sh` 通过。

## §2 P0｜运行时契约收口

- [x] 统一 `.codex/agents` 的真实格式：明确当前只使用 `.toml`，清理所有 `.md` agent 引用。
  - 证据：`bash .codex/scripts/agentic-lint.sh` 检查旧 `.md` agent 引用并通过。
- [x] 明确 Codex 如何发现、加载、spawn `.codex/agents/*.toml`，写入 `.codex/rules/runtime-contract.md`。
  - 证据：`.codex/rules/runtime-contract.md` 已定义事实源、调度契约和降级规则。
- [x] 清理 Claude/Cursor 假设：所有 `Agent` / `Task` 工具名都必须改成“当前环境可用 subagent 工具；不可用则串行降级”。
  - 证据：关键 Skill 已写当前环境 fallback；`agentic-lint` 检查运行时残留并通过。
- [x] 重审 `.codex/settings.json`：去掉旧运行器项目根变量、Claude Stop hook 等单一运行器假设，定义 Codex 环境下的 hook 契约。
  - 证据：`.codex/settings.json` 调用 `.codex/scripts/agentic-gate.sh --hook stop`；lint 禁止旧运行器变量并通过。
- [x] 明确 `AGENTS.md` 是主事实源；`CLAUDE.md` 只作为可选兼容镜像，不得成为独立事实源。
  - 证据：`AGENTS.md` 与 `runtime-contract.md` 已写入口径；lint 检查 `CLAUDE.md` 若存在需同义同步。

## §3 P0｜agentic-lint 与路径漂移检查

- [x] 新增或扩展 `.codex/scripts/agentic-lint.sh`。
  - 证据：`.codex/scripts/agentic-lint.sh` 现在委托 `.codex/scripts/agentic_lint.py` 做结构化检查。
- [x] 检查 `.codex/agents/*.toml` 是否存在、字段完整、`name` 唯一。
- [x] 检查 Skill 中引用的 subagent 名称是否真实存在。
- [x] 检查 `.codex/agents/*.md`、旧 `.claude/`、旧运行器项目根变量等迁移残留。
- [x] 检查 `AGENTS.md` / 可选 `CLAUDE.md` 是否存在事实源漂移。
- [x] 检查 `TODO.md` 中指向的模块 acceptance 契约路径是否真实存在。
- [x] 检查 `.codex/settings.json` 是否含过时变量、过时 hook 名称或不可移植路径。
  - 证据：`bash .codex/scripts/agentic-lint.sh` 通过。

## §4 P0｜轻量路径 / maintenance mode

- [x] 增加 `tiny-change / maintenance-mode` 路径。
- [x] 文案、小样式、确定性 bugfix、规则脚本维护、非产品代码修改可绕过完整 PRD/ATDD 流程。
- [x] 轻量路径仍需保留相关验证、简短记录和最终说明。
- [x] 明确哪些情况不能走轻量路径：产品主流程、API、平台能力、§2 checkbox、验收状态戳变化。
- [x] 把轻量路径写入 `AGENTS.md`、`.codex/rules/lifecycle.md`、`.codex/rules/verification-levels.md`。
  - 证据：`AGENTS.md`、`lifecycle.md`、`verification-levels.md`、`agentic-gate.sh` 已覆盖轻量路径和确认口。

## §5 P0｜验收契约 enforcement

- [x] 升级 `.codex/scripts/check-acceptance.sh`，不能只 grep `系统 SHALL` 和 `GIVEN`。
- [x] 检查 `GIVEN / WHEN / THEN` 是否齐全。
- [x] 检查每个场景是否有 `实现状态：`。
- [x] 检查 Web UI 场景是否有稳定 selector 或可机器验收路径。
- [x] 检查非 UI 场景是否有 `验证方式:`。
- [x] 后续增强：判断 `THEN` 是否可观察、selector 是否真实存在、证据是否有效。
  - 证据：`.codex/scripts/check_acceptance.py` 逐场景解析；fixture test 已覆盖 selector 和 THEN 检查。

## §6 P0｜分级门禁

- [x] 将 `check-todo-sync.sh` 从纯 advisory hook 升级为分级门禁策略。
- [x] 只读评估、纯讨论、纯规划：不阻断。
- [x] 源码/API/主流程变更但 TODO/acceptance 未同步：强提醒或要求显式确认。
- [x] 声称完成 §2 功能但没有 `project-verify` 证据：阻断或要求显式确认。
- [x] 验证失败、跳过、阻塞：必须写回 TODO 或最终回复明确说明。
- [x] 保留 escape hatch：允许用户明确要求跳过，但必须留下记录。
  - 证据：`.codex/scripts/agentic-gate.sh` 支持 advisory/strong/blocking 和 `CODENOW_GATE_CONFIRM=1`。

## §7 P1｜子代理真实隔离

- [x] 为每个 worker 定义机器可读写入白名单。
- [x] `module-developer` 只能写 prompt 指派文件，不能改共享单点文件。
- [x] `prd-module-writer` 只能写对应模块目录下的 `README.md`、`technical.md`、`sync.json`。
- [x] `acceptance-verifier` 只能回写对应 acceptance 状态戳和验证记录。
- [x] 增加 patch review / 文件白名单 gate，发现越界写入直接失败。
- [x] 可选增强：使用 worktree + patch 合并，而不是所有 worker 直接写主工作区。
  - 决策：本轮选择 patch gate 路线作为真实隔离；worktree 保留为可选运行方式，不作为当前必需实现。
- [x] 明确所有 worker 是叶子 worker，不允许再 spawn 子代理。
  - 证据：`.codex/agents/*.toml` 含 `leaf_worker`、`can_spawn_subagents`、`write_allowlist`、`deny_write`；`agentic_patch_gate.py` 验证通过。

## §8 P1｜状态源一致性检查器

- [x] 建一个机器化一致性检查器，覆盖所有状态源。
- [x] 检查 `TODO.md` checkbox 与 `acceptance.md` 实现状态戳是否一致。
- [x] 检查 `acceptance.md` 状态戳与 `TESTING_CHECKLIST.md` 证据是否一致。
- [x] 检查 `prd/README.md` 模块索引与实际模块目录是否一致。
- [x] 检查各模块目录下的 `README.md`、`technical.md`、`sync.json` 是否互相一致。
- [x] 检查已归档 `prd.original.md` 不再被 Skill 当作开发依据。
- [x] 输出 drift report：哪些文件冲突、哪个是事实源、建议由哪个 Skill 修复。
  - 证据：`.codex/scripts/agentic_drift_check.py` 已实现并通过；fixture test 覆盖多模块样例。

## §9 P1｜自举样板项目

- [x] 承认当前仓库处在迁移态：没有产品型 `prd/`、`design-system/`，还不是稳定样板。
- [x] 建立一个最小 self-bootstrap 样板项目。
- [x] 样板项目应包含 `TODO.md`、`prd/README.md`、至少一个模块 acceptance 契约、`design-system/DESIGN.md`。
- [x] 用样板项目验证新 Agent 是否能从零理解协作规则。
- [x] 把“脚手架仓库 / 准备阶段缺 TODO 不算错误”的逻辑写入检查器，避免误报。
  - 证据：`fixtures/agentic/golden/simple-web` 作为最小样板；`agentic-lint` 和 `drift_check` 均允许无产品 `prd/` 的 runtime 仓库。

## §10 P1｜golden fixtures / 系统自测

- [x] 建 3 个 golden fixture 产品样例。
- [x] 样例 1：简单 Web 工具。
- [x] 样例 2：含 API / 外部服务 / 降级路径的工具。
- [x] 样例 3：多模块项目，覆盖并行 worker、verify、update-prd。
- [x] 跑完整链路：`01 → 02 → 03 → verify → update-prd`。
  - 证据：每个 fixture 固化 `pipeline.trace.md` 并由 `agentic-fixture-test.sh` 校验链路阶段完整。
- [x] 固化输出结构快照，验证 PRD、TODO、acceptance、testing checklist 是否稳定。
- [x] 将 fixture 检查纳入 release 级验证。
  - 证据：`.codex/scripts/agentic-fixture-test.sh` 已纳入 `.codex/scripts/verify-agentic.sh`。

## §11 P2｜降低规则重复和长期漂移

- [x] 把 Skill 里重复出现的验证强度、日志要求、TODO 回写规则下沉到 `.codex/rules/*`。
- [x] Skill 中只保留引用，不重复定义同一规则。
  - 说明：本轮保留必要的 Skill 局部执行提示，但事实源已收束到 `.codex/rules/*`；后续新增重复事实由 lint/ADR/health 兜底发现。
- [x] 为运行时契约补 ADR：解释为什么以 `AGENTS.md` 为主入口、为什么 `.toml` 是 agent 格式、为什么轻量路径存在。
- [x] 增加 agentic health report，快速展示 rules / skills / agents / hooks / acceptance 的健康状态。
- [x] 定期用 lint 扫描“事实源数量是否增加”，避免文档越堆越多。
  - 证据：`docs/adr/0001-agentic-runtime-contract.md`、`.codex/scripts/agentic-health.sh`、`.codex/scripts/agentic-lint.sh`、`.codex/scripts/verify-agentic.sh`。

## §12 P2｜总体设计原则固化

- [x] 明确本体系是“产品化 Agent 工作流”，不是普通工程模板。
- [x] 明确目标是让 Codex 维护项目状态，而不只是写代码。
- [x] 明确下一阶段重心：runtime、lint、fixtures、权限边界，而不是继续堆文档契约。
- [x] 明确过度仪式感的退出机制：熟练开发者的小修应有短路径。
  - 证据：`AGENTS.md`、`.codex/rules/runtime-contract.md`、`.codex/rules/lifecycle.md`、`docs/adr/0001-agentic-runtime-contract.md`。
- [x] 增加“路由声明”机制：进入修改、开发、验收、PRD/TODO 同步或长流程前，Codex 先输出 `路由判断：... → 使用 ...`。
  - 证据：`AGENTS.md`、`.codex/rules/kernel.md`、`.codex/rules/lifecycle.md`、`docs/agentic-quickstart.md`。
- [x] 将“Codex 自检”和“正式验收 project-verify”拆分：日常开发默认 quick/standard 自检；只有完成 §2、用户要求验收/打勾、高风险边界或 release 时才回写 acceptance 状态戳。
  - 证据：`.codex/rules/verification-levels.md`、`.codex/rules/acceptance-contract.md`、`.codex/skills/project-iterate/SKILL.md`、`.codex/skills/project-verify/SKILL.md`。

## §13 P3｜体验反馈驱动优化

- [x] 新增 voice subagents，模拟小白与专家在想法、首次运行、调试、架构、验收和迁移阶段的心声。
- [x] 基于 voice subagents 反馈补 `docs/agentic-feedback-optimization-plan.md`，固化本轮修改目标与落地计划。
- [x] 优化 quickstart：补首次打开仓库的分岔、路由白话解释和报错新手证据包。
- [x] 优化 `project-debug`：补新手证据包、页面空白分流和 debug summary 证据字段。
- [x] 优化专家信任点：补 worker ownership / 并行失败态 reduce 口径、release 证据包、`✅` 状态戳格式检查和 selector 已落地但未验收的 drift warning。
- [ ] 后续增强：扩充 golden fixtures 的异常/边界场景，再把“每个需求至少正常路径 + 异常/边界路径”从文档规范升级为脚本门禁。

## §14 产品 PRD 初始化与后续差距

- [x] 2026-06-23：从当前代码、README、OpenSpec 基线和 `prd-old/` 历史线索初始化 `prd/` 模块化产品文档体系。
  - 已创建：`prd/README.md`、10 个模块目录、每模块 `README.md` / `technical.md` / `acceptance.md` / `sync.json`，以及 `prd/.update-prd-state.json`。
  - 说明：本轮只做 PRD as-built 与验收契约初始化，不修改业务代码，不把未正式验收场景标为 `✅`。
- [ ] 正式验收：按模块执行 `project-verify`，把各 `prd/<module>/acceptance.md` 中的初始待验收状态转换为带证据的状态戳。
  - 进展：2026-06-24 已完成全量 project-verify 回写；93 个场景中 90 个 ✅、0 个 ❌、3 个 ⚠️。剩余 3 个均为 `desktop-shell-settings-release` 的真实 Electron 托盘 / macOS 语音权限人工确认项，详见 `TESTING_CHECKLIST.md` 和 `test-results/verification-summary.md`。
- [ ] 产品 TODO 重整：当前 TODO 仍以 agentic runtime 优化为主；下轮应按 `prd/` 模块拆出 AgentOS 产品 backlog、优先级和里程碑。
- [ ] UI 验收选择器补强：为项目首页、Composer、Agent 设置、Home Plugin 卡片、任务卡、设置页和更新页补稳定 selector 或 Playwright 可观测路径。
- [ ] 测试补齐：为 `agent-mode-files`、`home-plugin-runner` 沙箱、`task-home-plugin-manager`、自动更新与 speech helper 增加 fixture/单测或可复现 smoke。
- [x] 文案/行为待确认：`electron/project-content.ts` 图片预览限制按现有实现保持 5MB，并将错误文案从“图片超过 10MB”修正为“图片超过 5MB”；已补超限图片预览回归测试。

## §15 P1｜MCP 接入 backlog

- [x] MCP 配置模型：增加全局 MCP server 定义与项目级 `mcpServerOverrides` / `mcpToolPolicies`，支持 stdio、HTTP、SSE，归一化 server 名称、command/args/env/url/headers/alwaysLoad，并兼容旧项目 MCP 设置文件。
  - 证据：`src/desktop-types.ts`、`electron/agent-mode-settings-store.ts`、`electron/agent-mode-settings-store.test.mjs`。
- [x] MCP 设置入口与导航：全局设置新增独立 MCP Tab，提供 MCP 新增/编辑/删除与全局开关；项目首页 Agent 设置 MCP Tab 只提供当前项目开关覆盖；Chat 状态面板提供“去当前项目 MCP 设置”的跳转，无项目时展示空态。
  - 证据：`src/components/setting/ClaudeAgentSettingsPage.tsx`、`src/components/chat/ProjectHomeSurface.tsx`、`src/components/AppAgentStatusPopover.tsx`、`src/components/AppShell.tsx`、`TESTING_CHECKLIST.md`。
- [x] MCP 设置面板：全局 MCP 面板提供 server 列表、启用/禁用、新增/编辑/复制/删除、未保存状态、删除确认和空态引导；项目 MCP Tab 展示全局已启用 server 的项目开关、状态和 tool policy。
  - 证据：全局 MCP server 复制、删除确认、路径不可用/无活动项目空态、项目 Installed MCP Servers 与策略列表已接入；`npm run build` ✅。
- [x] 密钥与环境变量体验：支持 `${ENV_NAME}` 引用，展示“已解析 / 未解析”状态；禁止在日志、状态面板和错误摘要中输出 token、API key 或完整 header 明文。
  - 证据：全局 MCP 编辑字段展示 `mcp-env-resolution-error/status`；运行时与连接测试继续做主进程解析和脱敏摘要；`npm run test:electron` ✅。
- [x] 连接测试与状态展示：实现保存前/保存后的 Test，展示 `connected / failed / needs-auth / pending / disabled`、serverInfo、工具数量和字段级修复提示。
  - 证据：全局 Save & Test 缓存 serverInfo/tools/status，编辑页展开 serverInfo 与恢复提示；项目页回退全局测试缓存并区分“项目可用/当前会话已连接”；`TESTING_CHECKLIST.md`。
- [x] Tool policy 配置：连接成功后按 server 分组列出工具，支持 `每次询问 / 自动允许 / 禁用`；默认不全量自动允许，读写/破坏性工具需保持显式授权。
  - 证据：项目 MCP 已发现工具按 server 分组，展示风险 annotation 和 policy 来源；策略仍按完整 `mcp__server__tool` 保存；`npm run test:electron` ✅。
- [x] SDK 运行时接入：在主聊天 query 与 status probe 中传入项目级 `mcpServers`，复用 `mcpServerStatus()`，把允许的 MCP tool 转成 `allowedTools`，把禁用策略转成 `disallowedTools` 或 `canUseTool` 拦截。
  - 证据：`electron/claude-agent-runner.ts`、`electron/claude-agent-runner/mcp.ts`、`electron/claude-agent-runner-mcp.test.mjs`。
- [x] Chat 可见状态：在 Composer 或 Agent 状态入口展示 MCP 可用数量；状态面板显示 server 状态、失败原因、工具数和“去设置修复”入口。
  - 证据：`src/components/AppAgentStatusPopover.tsx` 已展示 MCP server 状态、错误、工具数与设置跳转。
- [x] Tool 调用展示：把 `mcp__server__tool` 在 transcript、权限弹窗和日志摘要里展示为可读的 `server · tool`，同时保留完整名称用于排查。
  - 证据：`electron/claude-agent-runner/mcp.ts`、`electron/claude-agent-runner.ts`、`src/components/chat/Transcript.tsx`。
- [x] WebSearch 内置工具替换：用 SDK in-process MCP 暴露 AgentOS `web_search`，通过 `toolAliases.WebSearch` 把 Claude Code 内置 WebSearch 名称路由到内部搜索工具，并预留多 provider 扩展。
  - 进展：2026-06-24，本轮完成 provider registry、Brave / DuckDuckGo Search 首批 provider、内部 `agentos-web` MCP server、`WebSearch -> mcp__agentos-web__web_search` alias、内置 WebSearch 禁用和 runner 接入；本轮继续按全局搜索设置接入原生/AgentOS 路由选择，并补 Tavily Provider。验收契约 → `prd/chat-agent-runtime/acceptance.md`、`prd/desktop-shell-settings-release/acceptance.md`。
- [x] WebSearch Provider 体验补强：为 DuckDuckGo bot challenge/网络不可达、Tavily/Brave 认证或配额错误、Provider 保存前连接测试和字段级恢复提示补 UI/运行时文案。
  - 进展：2026-06-24，已按 OpenClaw 的 DuckDuckGo HTML 搜索页解析路线调整，DuckDuckGo 不再调用 Instant Answer API；HTML endpoint 网络不可达时降级为空结果而不是工具错误，默认请求超时为 20 秒；Tavily key 可识别但外部 smoke 返回 HTTP 432 usage limit。本轮继续补 `testGlobalWebSearchProvider` IPC、设置页 Test Provider、`configured / env-resolved / env-missing` 字段状态、auth/quota/bot-challenge/network/service 恢复文案和回归测试。
- [x] 权限与恢复交互：MCP 权限弹窗展示 server、tool、输入摘要和 policy 来源；server 失败、认证缺失、命令不存在、HTTP 401/403 时提供明确恢复路径。
  - 证据：权限/Transcript 继续使用 `server · tool` 友好名；项目策略 UI 展示默认/项目/手动来源；状态与全局编辑页展示 auth/env/command/url 恢复提示。
- [x] Session 生效策略：定义 MCP 配置变化后是下一轮生效、新会话生效还是立即重建 session，并在 UI 中给出明确提示。
  - 证据：运行时 MCP signature 保持 session 重建策略；项目 MCP 面板新增 `mcp-session-effect-hint`，明确保存后下一轮 Agent 会话读取最新设置。
- [x] 测试与验收补齐：增加 MCP 配置 normalize/store 单测、runner options 单测、tool name 展示单测、设置面板交互测试，以及 Chat 状态/权限/失败恢复的稳定选择器。
  - 证据：`npm run typecheck` ✅、`npm run test:electron` ✅（69/69）、`npm run build` ✅、MCP selector audit ✅；15 个 MCP 验收场景已在 `prd/*/acceptance.md` 盖戳。

## 验证记录

### 2026-06-17

- 本轮：创建 agentic engineering 优化 TODO，尚未开始逐项实现与打勾。
- 验证强度：quick（文档创建）。待下一步运行 `bash .codex/scripts/agentic-lint.sh` 并继续实现 P0。
- 本轮：完成 P0/P1/P2 agentic runtime 优化并逐项打勾。
- 验证强度：quick（agentic runtime 规则/脚本/fixture 维护）。
- 验证命令：
  - `bash .codex/scripts/verify-agentic.sh` ✅
  - `bash .codex/scripts/agentic-gate.sh --mode blocking` ✅
  - `git diff --check` ✅
- 本轮：新增路由声明机制，补 `docs/agentic-quickstart.md` 速览，并把日常开发自检与正式验收拆分，降低每次开发默认跑完整 `project-verify` 的流程成本。
- 验证强度：quick（agentic runtime 规则/文档维护）。
- 验证命令：
  - `bash .codex/scripts/verify-agentic.sh` ✅
  - `git diff --check` ✅
- 本轮：根据小白/专家 voice subagents 反馈，补首次体验入口、路由白话解释、debug 新手证据包、release 证据包、worker ownership/失败态 reduce 口径，并增强 acceptance/drift 检查。
- 验证强度：quick（agentic runtime 规则/文档/脚本/fixture 维护）。
- 验证命令：
  - `bash .codex/scripts/verify-agentic.sh` ✅（包含预期 selector 漂移 warning，未阻断）
  - `git diff --check` ✅

### 2026-06-23

- 本轮：执行 `update-prd` 首次全量重建，创建 AgentOS 产品 `prd/` 文档体系与模块验收契约。
- 验证类别：Codex 自检（文档/契约初始化）。
- 验证命令：
  - `bash .codex/scripts/agentic-lint.sh` ✅
  - `python3 .codex/scripts/agentic_drift_check.py` ✅
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `git diff --check` ✅
- 本轮：补充 MCP 接入产品规划，更新 `chat-agent-runtime`、`agent-mode`、`model-settings`、`desktop-shell-settings-release` PRD/acceptance，并新增 §15 MCP backlog。
- 验证类别：Codex 自检（文档/规划同步）。
- 验证命令：
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `git diff --check` ✅
- 本轮：实现 MCP 接入首个纵切：项目级 MCP 配置持久化、项目 Agent 设置 MCP Tab、Claude SDK query/status probe 运行时接入、Agent 状态面板 MCP 状态与设置跳转、MCP tool 友好展示，并增加 store/runtime 单测。
- 验证类别：Codex 自检（产品代码 + 单测）。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `git diff --check` ✅
- 本轮：按“全局添加 MCP、项目只做独立开关覆盖”的产品决策重构 MCP 设置：全局 MCP 设置页管理 MCP server 定义和总开关；项目 Agent MCP 面板只显示全局已启用 server，并保存当前项目 `mcpServerOverrides`；runner 继续接收合成后的有效 MCP 列表。
- 验证类别：Codex 自检（产品 UI + 存储模型 + 单测 + PRD/TODO 同步）。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
- 本轮：补齐 MCP 设置体验：全局 MCP 设置页新增项目级 MCP 边界说明；项目 MCP 面板新增 Installed MCP Servers 状态列表、启用开关、刷新状态、工具数量/失败原因展示，并明确保存配置不会预安装 MCP server。
- 验证类别：Codex 自检（产品 UI + PRD/TODO 同步）。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `git diff --check` ✅
- 本轮：优化 MCP 设置页到 Cursor 列表 + Codex 单 server 编辑形态：全局页显示 installed server、开关、未测试/连接失败/需要认证/工具数量状态；新增 Save & Test，stdio/HTTP probe 会缓存 serverInfo 与工具列表；项目 MCP policy 读取缓存工具并直接配置 ask/allow/deny。
- 验证类别：Codex 自检（MCP UI + IPC/store + runner probe + 单测）。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅
- 本轮：按“全局设置里 MCP 独立成 Tab，不放到模型页”的产品决策调整全局设置导航：新增 `settings/mcp` 分类、侧栏 MCP 入口和独立 MCP 页面；模型页只保留 Provider 表单；同步 PRD/acceptance/TODO 中的旧“全局模型设置页”表述。
- 验证类别：Codex 自检（设置路由 + UI 文案 + PRD/TODO 同步）。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `git diff --check` ✅
- 本轮：实现 WebSearch 试验版替换链路：新增 AgentOS web search provider registry、Brave / DuckDuckGo Search provider、SDK in-process MCP `agentos-web` server，并通过 `toolAliases.WebSearch` 将内置 WebSearch 名称路由到 `mcp__agentos-web__web_search`。
- 验证类别：Codex 自检（Agent runtime + provider 纯逻辑 + TODO 同步）。
- 验证命令：
  - `npm run typecheck` ✅
  - `node --test electron/claude-agent-runner-mcp.test.mjs electron/claude-agent-runner-web-search.test.mjs` ✅
  - `npm run test:electron` ✅
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `git diff --check` ✅
- 本轮：新增全局“搜索”设置页与 IPC/preload 存储链路，支持原生 Web Search 与 AgentOS Provider 模式切换；AgentOS 模式支持 DuckDuckGo Search、Brave Search、Tavily，并让 runner 按设置决定是否注册 `agentos-web`、alias `WebSearch` 与禁用内置 WebSearch。
- 验证类别：Codex 自检（设置页 + Agent runtime + provider 纯逻辑 + PRD/TODO 同步）。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `git diff --check` ✅
- 本轮：执行 `update-prd` 增量同步，将全局搜索设置、WebSearch native/AgentOS 路由、DuckDuckGo/Brave/Tavily Provider、DuckDuckGo 空结果和 Tavily 配额错误边界同步到 `chat-agent-runtime` 与 `desktop-shell-settings-release` PRD，并新增对应验收场景；未执行正式 `project-verify` 盖戳。
- 验证类别：Codex 自检（PRD/acceptance/TODO 同步）。
- 验证命令：
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `node -e "for (const f of ['prd/.update-prd-state.json','prd/chat-agent-runtime/sync.json','prd/desktop-shell-settings-release/sync.json']) JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('json ok')"` ✅
  - `git diff --check` ✅
- 本轮：执行 `update-prd` 增量同步 MCP 相关 PRD，将项目 MCP 面板 as-built、全局 MCP 定义/连接测试、Chat 状态/权限/Transcript 展示、状态面板跳转和模型/MCP 边界同步到 `agent-mode`、`chat-agent-runtime`、`desktop-shell-settings-release`、`model-settings`；未执行正式 `project-verify` 盖戳。
- 验证类别：Codex 自检（PRD/acceptance/TODO 同步）。
- 验证命令：
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `node -e "for (const f of ['prd/.update-prd-state.json','prd/agent-mode/sync.json','prd/chat-agent-runtime/sync.json','prd/desktop-shell-settings-release/sync.json','prd/model-settings/sync.json']) JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('json ok')"` ✅
  - `git diff --check` ✅

### 2026-06-24

- 本轮：排查 DuckDuckGo Provider 普通新闻类 query 返回异常；对照 OpenClaw 后改为直接使用 DuckDuckGo HTML 搜索、bot challenge/网络失败降级、设置页/PRD 文案和回归测试。
- 验证类别：debug 自检（未执行正式 `project-verify` 盖戳）。
- 验证命令：
  - `npm run typecheck` ✅
  - `node --test electron/claude-agent-runner-web-search.test.mjs` ✅
  - `npm run test:electron` ✅（59 tests passed）
  - `bash .codex/scripts/check-acceptance.sh --all` ✅（结构检查通过；自动生成的正式验收临时文件已清理）
  - `git diff --check` ✅
- 备注：外部 DuckDuckGo live `curl` 在当前 shell 环境返回 TLS code 35；本轮已覆盖该路径，DuckDuckGo HTML endpoint 失败时返回空结果，不再让 `web_search` 工具调用标红。
- 追踪：为 WebSearch 后端 provider 增加脱敏阶段日志，记录 provider、queryHash、queryLength、endpoint host/path、HTTP 状态、耗时、结果数和失败摘要，便于定位 HTML 搜索或网络层问题。
- 本轮：按用户指定范围执行搜索相关正式 `project-verify`，完成 `chat-agent-runtime` WebSearch runtime 6 个场景与 `desktop-shell-settings-release` 搜索设置 6 个场景验收盖戳。
- 验证类别：正式验收（project-verify，搜索范围）。
- 验收结果：12 个搜索相关场景 ✅ 通过；场景级无失败、无跳过、无阻塞。
- 证据：`TESTING_CHECKLIST.md`。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅
  - `curl -s -I http://localhost:5173/` ✅（HTTP 200）
  - Chrome CDP browser smoke ✅
  - Provider smoke ✅
- 本轮：调整 MCP 状态模型与设置入口行为：全局 MCP 设置和项目 MCP 设置进入时自动重测已启用 MCP；项目页按“全局启用 + 项目未关闭 = 项目可用”合成状态，并用“当前会话已连接”区分运行时实际连接。
- 验证类别：Codex 自检（MCP 设置 UI 状态 + 类型检查）。
- 验证命令：
  - `npm run typecheck` ✅
- 本轮：完成 WebSearch Provider 体验补强：新增 Provider Test IPC/UI、主进程 `${ENV_NAME}` 解析状态、DuckDuckGo/Brave/Tavily 统一错误分类与恢复文案，并补 HTTP quota/auth 类错误、env-resolved/env-missing 和设置页 seam/UI 回归测试。
- 验证类别：Codex 自检（WebSearch runtime + 设置页 seam + PRD/TODO 同步）。
- 验证命令：
  - `npm run typecheck` ✅
  - `node --test electron/claude-agent-runner-web-search.test.mjs electron/desktop-seam.test.mjs electron/agent-mode-settings-store.test.mjs` ✅
  - `npm run test:electron` ✅（64 tests passed）
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `git diff --check` ✅
- 本轮：修复模型 Provider 预设中 MiniMax 重复 `id` 导致 React key warning 的问题；远端 preset JSON 改为仅在 `VITE_MODEL_PROVIDER_PRESETS_URL` 显式配置时加载，避免默认请求失效 raw URL 产生 404 噪声；补 catalog ID 回归测试。
- 验证类别：debug 自检（模型设置 UI 数据源 + 回归测试）。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅（68 tests passed）
- 本轮：修复新建对话重启后丢失的持久化 bug；renderer 每次工作区状态变更立即写 localStorage 快照，主进程恢复时在 SQLite 索引和 JSON 快照之间选择更新来源，避免旧 SQLite 覆盖新 JSON。
- 验证类别：debug 自检（持久化恢复 + 回归测试，未执行正式 `project-verify` 盖戳）。
- 验证命令：
  - `npm run typecheck` ✅
  - `node --test electron/chat-workspace-store.test.mjs electron/workspace-session.test.mjs` ✅
  - `npm run test:electron` ✅（69 tests passed）
- 本轮：完成 MCP 相关剩余实现与正式验收打勾：全局 MCP 复制/删除确认、字段级 ENV 状态、serverInfo 展开、恢复提示、项目工具按 server 分组、风险 annotation、policy 来源、session 生效提示，以及无活动项目/路径不可用空态。
- 验证类别：正式验收（project-verify，MCP 范围）。
- 验收结果：15 个 MCP 相关场景 ✅ 通过；场景级无失败、无跳过、无阻塞。
- 证据：`TESTING_CHECKLIST.md`。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅（69/69）
  - `npm run build` ✅
  - MCP selector audit ✅
- 本轮：按用户要求执行全量正式 `project-verify`，覆盖 `prd/*/acceptance.md` 全部 10 个模块、93 个场景，并将状态戳回写到各模块验收契约。
- 验证类别：正式验收（project-verify，全量）。
- 验收结果：90 个场景 ✅ 通过；0 个 ❌；3 个 ⚠️ 为真实 Electron 托盘 / macOS 语音权限人工确认项；无阻塞。
- 证据：`TESTING_CHECKLIST.md`、`test-results/verification-summary.md`、`test-results/full-acceptance-smoke-output.json`、`test-results/agentos-preview-empty-workspace.png`。
- 验证命令：
  - `npm run typecheck` ✅
  - `npm run test:electron` ✅（69/69）
  - `npm run test:home-plugin` ✅（当前无 `.agents/home-plugins/project-home`，脚本按预期跳过）
  - `node test-results/full-acceptance-smoke.mjs` ✅
  - `./node_modules/.bin/vite build` ✅
  - `npm run build:local` ✅
  - `curl -I http://127.0.0.1:5181/` ✅（HTTP 200）
  - Chrome headless preview smoke ✅
  - `bash .codex/scripts/check-acceptance.sh --all` ✅
  - `python3 .codex/scripts/agentic_drift_check.py` ✅
  - `git diff --check` ✅
- 本轮：修复全局 MCP 设置页进入后自动连接测试误显示“正在保存 MCP 设置”的交互问题；保存与测试事务状态已拆分，自动测试只展示测试中，保存按钮仅在真实保存时显示保存中。
- 验证类别：Codex 自检（MCP 设置 UI 状态 + 回归测试）。
- 验证命令：
  - `npm run typecheck` ✅
  - `node --test electron/desktop-seam.test.mjs` ✅
  - `npm run test:electron` ✅（70/70）
  - `git diff --check` ✅
- 本轮：修复项目 MCP 设置交互复查发现的问题：项目设置加载结果按项目路径/请求代际隔离，项目 MCP 探测在切换项目或关闭面板后不再写回旧状态，自动测试与保存状态拆分，测试中不再显示“正在保存”或误锁保存/取消/开关。
- 验证类别：Codex 自检（MCP 项目设置状态机 + 回归测试；未执行正式 `project-verify` 盖戳）。
- 验证命令：
  - `npm run typecheck -- --pretty false` ✅
  - `node --test electron/desktop-seam.test.mjs` ✅
  - `node --test electron/agent-mode-settings-store.test.mjs electron/claude-agent-runner-mcp.test.mjs electron/chat-run.test.mjs electron/desktop-seam.test.mjs` ✅（23/23）
  - `npm run test:electron` ✅（72/72）
  - `git diff --check` ✅
