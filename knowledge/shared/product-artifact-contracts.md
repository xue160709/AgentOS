# 产品产物契约

## 适用范围

适用于 `01`、`02`、`03` 与 `update-prd` 之间的产品文档、开发入口和实现事实管理。本文定义单一事实源与状态边界，不复制具体模板内容。

## 单一事实源

| 产物 | 稳定职责 | 边界 |
|---|---|---|
| `USER_PROFILE.md` | 记录产品服务对象、处境、目标/动机、核心痛点、典型使用情境及影响产品决策的能力/环境限制。 | 只表达已确认的产品用户，不混入协作者的技术水平、职业或沟通偏好；不得因角色建议、代码或实现细节自行扩大或改写。 |
| `GUARDRAILS.md` | 记录已确认的产品边界与非目标。 | 作为范围约束使用；未经主 Agent 和用户确认的推论、建议或模拟观点不得写入。 |
| `CONTEXT.md` / `CONTEXT-MAP.md` | 记录具体产品领域的正式术语、定义、禁用近义词与上下文关系。 | 只收已确认的产品专属概念；不承担规格、实现、验收或脚手架共享术语。 |
| 根 `prd.md` | 记录产品范围与规格。 | 作为产品定义入口；不承担完整用户画像、验收契约或代码实现记录。 |
| `design-system/DESIGN.md` | 记录设计事实。 | 与产品定义和开发准备衔接；不把未确认的视觉建议当作产品范围。 |
| `prd/<module>/acceptance.md` | 记录模块验收契约。 | 是验收契约的单一事实源；不以实现者的局部自检替代正式验收。 |
| `TODO.md` | 记录执行入口、任务状态、进度、阻塞、下步和验收指针。 | 产品行为、API、平台能力或主流程变化后同步状态；不复制整段验收场景。 |
| 代码与已验证行为 | 记录 as-built 事实。 | 只反映实际实现和已验证行为；不能反向扩大 `prd.md`、画像或边界。 |

## 状态隔离

- `Current` 表示当前产品/设计/实现事实；`Planned` 表示已确认但尚未成为当前实现事实的计划。两者必须分离。
- 计划内容不得写成当前或 as-built；代码事实也不得自动变成新的产品计划或边界决定。
- 各产物通过路径和必要的稳定指针互相引用，不复制整段内容；主 Agent 负责根级产品状态与跨文档冲突，`knowledge/shared/` 的写入边界见[编排规则](agent-orchestration.md)。
- 产品领域术语以 `CONTEXT.md` 为准；`knowledge/shared/glossary.md` 只定义 CodeNow Pro 跨 Skill 协作术语，两者不得互相覆盖。

## Change 与 TODO

- `changes/` 是持久、跨角色或跨会话变更的控制面；需要产品/业务代码实现的 Change 才由 `change-package` 管理后转 `project-iterate` 按授权任务实现。纯治理、规则、协作元数据或专业文档 Change 由主 Agent/文件所有者按 tasks 授权执行并按 `change-package` 门禁关闭，不虚构 `implementation_engineer`。具体创建、推进、恢复和归档步骤另读 [`change-package`](../../.codex/skills/change-package/SKILL.md)。
- 根 `TODO.md` 是产品交付面；产品行为、API 或主流程变化才需要映射 TODO。纯治理变更不创建空 TODO。
- 产品 Acceptance、对应产品 TODO 的正式完成状态，以及 Change 中对产品正式验收的声明/证据，由主 Agent 依据已确认范围和 `project-verify` 的正式独立验证证据写入；实现结果、开发阶段五态证据和其他证据候选不能直接改变产品正式状态或构成正式通过，但可作为该 Change 的适用验证输入。
- Change 自身的 `delivery` 由 `change-package` 根据 accepted proposal、全部 task 终态及该变更适用的验证/审查证据关闭，最终由主 Agent 按该门禁裁决；纯治理或文档 Change 不要求虚构产品 Acceptance 或 `project-verify`，sub-agent 不写 Change 状态。

## 变更原则

已确认的产品、设计和验收内容才能进入对应正式产物。角色草案、建议、假设和未验证行为保留其原有状态；信息不足或冲突时返回主 Agent，不自行补全。

## Guardrail 语义边界

Guardrail 的五类语义、正式门槛、ID、变更和下游效力只以 [`.codex/rules/product-guardrails.md`](../../.codex/rules/product-guardrails.md) 为准。本文件只确认 `GUARDRAILS.md` 是产品边界事实源，不复制分类正文。

## 任务与证据隔离

- Acceptance 只在对应模块契约中定义；TODO 只放任务状态和指针，验证证据另行记录并由独立验收关联。
- 完成、部分完成、阻塞、失败或跳过必须如实保留；未完成项不能因代码已写或文档已同步而自动变成完成。
