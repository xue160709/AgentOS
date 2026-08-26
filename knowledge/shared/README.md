# 共享 Knowledge 路由

`knowledge/shared/` 只保存跨 Skill 或跨角色稳定复用的 Agent 方法、契约、术语和知识索引，不保存本项目背景、项目决策史、角色草案或单次任务材料。本文件只决定“何时读取哪份共享 Knowledge”，不重复正文规则。

任务开始前先对照下表；命中多个分支时读取全部对应文件，任务包或 Skill 明确指定的文件始终读取。没有命中且没有显式路径时，不继续加载其它共享文件。

| 任务分支 | 读取文件 |
|---|---|
| sub-agent 的公共行为准则（汇报、任务模式、读取范围、结果性质、写入边界、权限覆盖、外部操作、交付格式） | `role-conduct.md`；各角色的使命与判断权见 `.codex/agents/*.toml`，专业方法见 `knowledge/roles/<role>.md` |
| 需要提出、落位、呈现、强化或验收产品亮点 | `highlight-contract.md` |
| 需要产出、消费或审查外部事实与用户证据 | `evidence-standards.md` |
| 需要设计、实现或验收界面的键盘可达、焦点、对比度与辅助技术行为 | `accessibility-baseline.md` |
| 需要派工、并行、串行降级、合并角色输出或处理共享单点文件 | `agent-orchestration.md`，并按其强指针读取运行规则 |
| 需要为设计/产品类起草、修订或比较任务设定质量线、附判例或沉淀判例 | `proposal-quality-bar.md` |
| 需要判断是否多候选起草，或准备候选任务包、组织候选比较与综合 | `competitive-drafting.md` |
| 需要决定 sub-agent 继承哪些对话、材料、证据或文件路径 | `context-sharing.md` |
| 需要消费上游阶段的产物，或判断本阶段产出能否改写上游事实 | `product-development-lifecycle.md`；本轮阶段判定与 Skill 路由另读 `.codex/rules/lifecycle.md` |
| 涉及 `prd.md`、`USER_PROFILE.md`、`GUARDRAILS.md`、`CONTEXT.md`、`TODO.md`、设计系统、Current/Planned/as-built 或文件事实源 | `product-artifact-contracts.md` |
| 涉及 Acceptance、GWT、实现自检、独立验证、正式通过或验证证据 | `acceptance-and-verification.md` |
| 需要枚举界面或流程的状态，或涉及异步、取消、超时、重试、late event、焦点与状态恢复 | `interaction-state-contract.md` |
| 涉及 02/03 的 Framework Profile、支持范围或实施 reference | `framework-support.md` |
| 需要主 Agent 向用户确认范围、画像、边界、单选/多选或冲突 | `user-clarification.md` |
| 需要统一“事实、外部证据、推论、假设、模拟观点”等跨 Skill 协作术语 | `glossary.md` |

项目背景与自由参考材料按需从 `docs/` 读取；一次修改的决定、取代关系和进度从 `changes/` 读取；产品当前状态从正式产品产物与已验证代码读取。它们不得为了方便路由而复制进共享 Knowledge。

每份共享文件开头写明自己的读取时机，使任务包直接附上路径时无需回读本表即可判断适用性；本表与各文件的读取时机由 `knowledge_curator` 保持一致。

一个概念只要有两个以上角色各自承担一段（例如产品亮点、证据、状态、无障碍），就属于共享契约并收入上表；只服务单一角色的方法留在 `knowledge/roles/<role>.md`。`knowledge_curator` 的读取范围见其角色 TOML。

完成标准：所有命中分支均已读取，未命中分支没有因“可能相关”被整目录加载；仍无法判断时把缺失的任务语义或路径交回主 Agent。
