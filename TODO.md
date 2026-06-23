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
  - 优先级建议：`workspace-session`、`chat-agent-runtime`、`file-context`、`model-settings` 先验已有单元测试覆盖模块；随后验 `agent-mode`、`home-plugin`、`task-home-plugin`、`desktop-shell-settings-release`。
- [ ] 产品 TODO 重整：当前 TODO 仍以 agentic runtime 优化为主；下轮应按 `prd/` 模块拆出 AgentOS 产品 backlog、优先级和里程碑。
- [ ] UI 验收选择器补强：为项目首页、Composer、Agent 设置、Home Plugin 卡片、任务卡、设置页和更新页补稳定 selector 或 Playwright 可观测路径。
- [ ] 测试补齐：为 `agent-mode-files`、`home-plugin-runner` 沙箱、`task-home-plugin-manager`、自动更新与 speech helper 增加 fixture/单测或可复现 smoke。
- [ ] 文案/行为待确认：`electron/project-content.ts` 中图片预览常量为 5MB，但错误文案写“图片超过 10MB”；需确认是调常量还是调文案。

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
