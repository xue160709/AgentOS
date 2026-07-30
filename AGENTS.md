# CodeNow 项目协作入口

- 使用中文回复。
- 项目初始化后，以根目录 `TODO.md` 为日常任务事实源；准备阶段还没有 TODO 时不报错。
- 开始改文件、开发、验收、同步文档或长流程前，先输出：`路由判断：<依据> → 使用 <Skill/轻量维护路径>`。

## 主会话上下文

主会话开始实质协作前先直接读取根目录 `COLLABORATOR.md` 与 `.codex/rules/collaborator-profile.md`，不要用搜索结果推断它们是否存在。V2 画像按熟悉世界、六主题知识地图、表达契约和类比边界调整最终回复；它们只描述当前协作者与沟通方式。

- 产品服务对象只从 `USER_PROFILE.md` 读取；读取、迁移和 Profile Pack 规则见 `.codex/rules/product-user-profile.md`。
- 产品边界只从 `GUARDRAILS.md` 读取；确认、冲突和引用规则见 `.codex/rules/product-guardrails.md`。
- Leaf worker 的上下文隔离、Guardrail Pack、Profile Pack、单写者和 Worktree 规则统一见 `.codex/rules/runtime-contract.md`。

## 路由与事实源

常驻铁律见 `.codex/rules/kernel.md`；完整进入条件、省话口令和改道路由只以 `.codex/rules/lifecycle.md` 为准。Skill、调用与权限的信息层级见 `.codex/rules/skill-contract.md`。

按任务读取对应唯一规范：

| 事项 | 事实源 |
| --- | --- |
| Skill 路由 | `.codex/rules/lifecycle.md` |
| Skill 调用 / Agent 权限 | `.codex/rules/skill-contract.md` / `.codex/rules/runtime-contract.md` |
| TODO 回写 | `.codex/rules/todo-writeback.md` |
| ATDD / acceptance | `.codex/rules/acceptance-contract.md` |
| 自检 / 正式验收 | `.codex/rules/verification-levels.md` |
| ADR / 领域术语 | `.codex/rules/adr.md` / `.codex/rules/context.md` |
| 提交提醒 | `.codex/rules/git-commit-reminder.md` |

产品任务还按需读取 `TODO.md`、相关 `prd/<模块>/`、`prd/<模块>/acceptance.md`、`GUARDRAILS.md`；UI 开发读取 `design-system/DESIGN.md`。没有 design system 的首版项目先运行或补齐 `02-project-prepare`。

## 开发与验收边界

- 产品代码位置、TODO 回写、Acceptance、证据和验证等级分别执行上表对应 Rules；AGENTS.md 不保存第二份实现细则。
- 内置首版 Framework Adapter 的机器事实源是 `.codex/framework-adapters.json`；根目录 `README.md` 的“支持范围”由 `02-project-prepare` 生成为用户可读投影。两者不一致或没有 Adapter 时不得静默套用相近框架。

修改 `.codex/` 或 `AGENTS.md` 后运行对应平台的 agentic lint：macOS/Linux 使用 `bash .codex/scripts/agentic-lint.sh`，Windows PowerShell 使用 `& .codex/scripts/agentic-lint.ps1`。修改 gate、drift、acceptance parser、worktree 或 patch gate 时，再直接运行受影响脚本的只读检查或最小临时目录 smoke。最终回复必须说明验证类别和实际动作；写操作结束后按提交提醒规则给出非阻塞 Commit 建议。
