# 项目协作说明

- 使用中文回复我。
- 项目初始化后，后续任务以仓库根目录 `TODO.md` 为准；脚手架仓库或准备阶段尚未生成 `TODO.md` 时，不要把缺失当成错误。

开始工作前按需读取：
- `docs/agentic-quickstart.md`（需要快速判断路由、轻量路径、自检/正式验收边界时）
- `.codex/rules/todo-writeback.md`
- `.codex/rules/git-commit-reminder.md`（涉及写操作收尾、切换下一项任务或提醒提交时）
- `.codex/rules/acceptance-contract.md`（涉及验收契约、ATDD 门禁、acceptance.md 时）
- `.codex/rules/runtime-contract.md`（涉及 `.codex/`、subagent、hook、迁移路径时）
- `.codex/rules/adr.md`（涉及难回退架构决策、`docs/adr/` 时）
- `.codex/rules/context.md`（涉及领域术语表、`CONTEXT.md` 时）
- `CHANGELOG.md`（修补 bug、回顾已修问题或同步发布说明时）
- `TODO.md`（若已生成）
- `prd/README.md`、`prd/<模块>/acceptance.md`（验收契约）与 `prd/` 下与当前任务相关的模块文档（若已生成）
- `design-system/DESIGN.md`（若已由 02-project-prepare 生成）
- `.codex/rules/coach.md` 仅在教学场景按需读取

如果当前项目尚未生成 `design-system/`，首版开发前应先运行或补齐 `02-project-prepare`。日常非 UI 修改不需要读取设计系统。

当前仓库以 `AGENTS.md` 与 `.codex/` 为主事实源，其中 `.codex/agents/*.toml` 保存 specialist subagent 定义；可复制到新项目的最小运行时包是 `AGENTS.md` 与 `.codex/`。旧 Claude 目录为历史路径，不要新增引用。若为了兼容其它运行环境创建 `CLAUDE.md`，必须与 `AGENTS.md` 保持同义，不能成为新的事实源。

项目代码默认生成在仓库根目录（`package.json`、源码入口、`public/`、配置文件等均位于根目录）；除非用户明确指定子目录，禁止自动创建 `web/`、`client/`、`frontend/` 等应用子目录。

执行时请优先完成 `TODO.md` 中未勾选的任务；如果实际代码、`prd/` 与 `TODO.md` 冲突，以当前代码事实和 `prd/` 已实现文档为依据，并把新的差距或后续任务按风险规则更新回 `TODO.md`。

**省话口令**：用户可以用短句直接锁定路径，Codex 应优先尊重：
- `只读评估`：只读文件并给结论，不改文件、不补 acceptance、不回写 TODO，最终说明原因与验证类别。
- `轻量维护`：只做规则/脚本/文案/小样式/纯内部重构，默认做 Codex 自检，不进入完整 ATDD。
- `实现 TODO 第 x 项`：按 `project-iterate` 执行，并先检查对应 acceptance 契约。
- `正式验收/打勾`：按 `project-verify` 执行，逐条回写状态戳与证据。
- `新想法先别写代码`：按 `product-discovery` 澄清并写增量，不直接实现。
- `教学模式`：按 `.codex/rules/coach.md` 用零基础方式解释代码、报错或运行流程；除非用户明确要求，不顺手改代码。

**路由声明机制**：每次开始会修改文件、写代码、跑验收、同步 PRD/TODO 或执行较长流程前，先用一行明确本轮路由，格式为 `路由判断：<触发依据> → 使用 <Skill/轻量维护路径>`。例如：`路由判断：这是新功能想法，尚未进 TODO → 使用 product-discovery`；`路由判断：这是 TODO 已确认任务 → 使用 project-iterate`；`路由判断：这是规则/脚本维护，不改变产品行为 → 走轻量维护路径`。路由声明只是可见决策，不替代实际读取对应规则与 Skill。

**日常产品想法**（已有 `prd/` 或 `prd.md`、尚未定稿进 TODO）：用 **`product-discovery`** Skill 陪聊澄清并写 prd/TODO 增量；定稿后再用 **`project-iterate`** 开发。冷启动用 `01-mvp-prd-builder`，大块重规划用 `02-project-prepare`。

**意图不明确时**：凡是用户需求模糊、任务边界不清、存在多个可行方向需要取舍，或直接执行大概率跑偏，必须先调用 **`intent-decision`** Skill（`.codex/skills/intent-decision/SKILL.md`），通过正交维度探针帮用户把意图显影成可执行规格，再开始执行。不得猜测并直接动手。

**TODO 回写按风险分级**，规范见 `.codex/rules/todo-writeback.md`。完成/部分完成 checkbox、修改产品行为/API/平台能力/主流程、验证失败/跳过/阻塞、发现新任务或规格差距时必须回写。只改错别字、纯格式、只读评估或用户明确要求不改 TODO 时可不回写，但最终回复必须说明原因。

**Bug 修复记录**：修补 bug 后必须更新 `CHANGELOG.md` 的 `Unreleased / Bug Fixes`。记录只写已经修复的问题；新发现但未修复的问题写入 `TODO.md`、对应验收失败记录或最终回复的阻塞项。每条 bugfix 至少写清日期、用户可见症状、处理方式、验证方式和影响范围，推荐格式：

```markdown
- 2026-06-24: 修复 <用户可见症状>。处理：<修复方式>；验证：<命令或 smoke>；范围：<模块或文件>。
```

`CHANGELOG.md` 不替代 `TODO.md`、`prd/<模块>/acceptance.md`、`TESTING_CHECKLIST.md` 或 `test-results/`；正式验收状态戳仍只写在 acceptance 契约和验收证据里。规则/流程类变更写入 `CHANGELOG.md` 的 `Process`，不要混入 `Bug Fixes`。记录时不得写入密钥、Token、完整请求头、用户隐私或其它敏感原文。

**轻量维护路径**：只改协作规则、脚本、错别字、格式、文案、小样式或纯内部重构，且不改变产品行为/§2 功能完成状态时，不强制补 acceptance 或 TODO；但需要运行相关 lint/smoke，并在最终回复说明未回写原因。修改 `.codex/` 或 `AGENTS.md` 后优先运行 `bash .codex/scripts/agentic-lint.sh`。

**TODO 过长时**：将已稳定完成且已验证的功能块归档到对应 `prd/` 文档，再精简 TODO；直接使用 `update-prd` Skill 处理，不再维护独立归档规则文件。

**ATDD 验收驱动开发**：验收契约是**唯一事实源**，写在 `prd/<模块>/acceptance.md`（GWT：需求 SHALL + 场景 GIVEN/WHEN/THEN），先于代码，规范见 `.codex/rules/acceptance-contract.md`。开发任何 §2 功能前先过**门禁**：确认对应 `acceptance.md` 存在且场景具体可观察；缺失或空泛先 spawn `qa-acceptance-planner` 补契约再写代码。`TODO.md §2` 不内嵌验收标准，只放任务 + 指向 acceptance.md 的指针；`project-verify` 逐条执行场景并在 acceptance.md 回写实现状态戳，`TESTING_CHECKLIST.md` 只记录证据。

## 验证

验证只分两类：**Codex 自检** 与 **正式验收（project-verify）**。具体触发条件、风险伸缩规则和 `build` 触发条件见唯一事实源 **`.codex/rules/verification-levels.md`**。

日常开发、bugfix、轻量维护默认做 **Codex 自检**：按改动风险选择最小但足够的 smoke、测试、类型检查、lint 或动态走查，并回写必要的 TODO 进度；**正式验收** 是单独动作，只有声明完成 §2 功能、用户要求验收/打勾、首版交付、发布/打包、插件加载目录验证，或主流程/API/平台高风险边界需要可追溯证据时，才按范围运行 `project-verify`、回写 `acceptance.md` 状态戳并同步 TODO checkbox。PRD as-built（`prd/<模块>/README.md` / `technical.md`）只在模块闭环、TODO 归档、里程碑或用户要求同步时更新，不跟随每次小改全量刷新。

最终回复必须说明本轮验证类别与实际动作，例如 `验证：Codex 自检，运行了 ...` 或 `验证：正式验收，project-verify 覆盖 ...`。`npm run build` 不作为默认验证项，只在用户明确要求、发布/打包、验证构建产物或插件加载目录时按需执行。

如果本轮修补了 bug，最终回复还必须说明 `CHANGELOG.md` 已更新；如果按规则应更新 `TODO.md`、`CHANGELOG.md` 或验收证据但没有更新，必须说明原因。

写操作收尾后，按 `.codex/rules/git-commit-reminder.md` 判断是否追加非阻塞 `Commit：...` 提醒；用户切换到下一项任务且工作区未提交时，先做 dirty worktree 确认。用户同意后才使用 `git-commit` Skill 执行提交。

写代码时请遵守：
- **Web UI 项目**（Next.js、Electron renderer、浏览器插件页面等）：`prd/<模块>/acceptance.md` 场景的机器验收路径须提供稳定选择器；优先语义选择器（role/label/accessible name），必要时使用 `data-testid`（命名与验收见 `.codex/skills/project-verify/references/selector-and-testid.md`）；由 `03-project-develop` / `project-iterate` 在实现时落实，`project-verify` 执行验收并回写状态戳。
- **非 UI 逻辑**（纯函数、数据转换、API/IPC/background handler、脚本等）：须提供可复现的单元测试、集成测试、fixture、curl/CLI smoke 或日志证据；验收方式见 `.codex/skills/project-verify/references/non-ui-verification.md`。
- 复杂逻辑、边界条件、降级策略需要简短中文注释；简单代码不机械补注释。注释应解释“为什么这样做”、输入输出边界和调试观察点，避免只重复代码表面含义。
- 日志按风险分级：API Route / 第三方 API 调用、IPC handler / Electron main-preload 边界、浏览器插件 background 远程请求、鉴权/Key/权限申请、持久化写入失败、降级/重试/cache miss/外部服务失败必须有脱敏运行证据；优先沿用项目已有 logger，没有 logger 时使用 `console.log` / `console.error`；复杂数据转换、多状态业务流程、难以通过 UI 观察的后台任务建议加日志；纯 UI 展示、纯样式、简单类型声明、静态 fixture、无 I/O 小工具函数不需要机械补日志。
- 日志不得输出 API Key、Token、Bearer、用户隐私原文等敏感信息；需要记录时只保留脱敏后的摘要。

注意：
- `prd.original.md` 是归档的原始总目标，仅供人类回顾；后续开发不要再依赖它。
- 如果实际代码、`prd/` 与 `TODO.md` 冲突，以当前代码事实和 `prd/` 已实现文档为依据，并把新的差距或后续任务更新回 `TODO.md`。
