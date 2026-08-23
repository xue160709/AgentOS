# 共享 Knowledge 路由

`knowledge/shared/` 只保存跨 Skill 或跨角色稳定复用的 Agent 方法、契约、术语和知识索引，不保存本项目背景、项目决策史、角色草案或单次任务材料。本文件只决定“何时读取哪份共享 Knowledge”，不重复正文规则。

任务开始前先对照下表；命中多个分支时读取全部对应文件，任务包或 Skill 明确指定的文件始终读取。没有命中且没有显式路径时，不继续加载其它共享文件。

| 任务分支 | 读取文件 |
|---|---|
| 需要派工、并行、串行降级、合并角色输出或处理共享单点文件 | `agent-orchestration.md`，并按其强指针读取运行规则 |
| 需要决定 sub-agent 继承哪些对话、材料、证据或文件路径 | `context-sharing.md` |
| 涉及 01、02、03、`change-package`、`product-problem-investigation`、`project-debug`、`project-iterate`、`project-verify`、`code-review` 或 `update-prd` 的稳定阶段职责与事实流 | `product-development-lifecycle.md`；本轮路由判断另读 `.codex/rules/lifecycle.md` |
| 涉及 `prd.md`、`USER_PROFILE.md`、`GUARDRAILS.md`、`CONTEXT.md`、`TODO.md`、设计系统、Current/Planned/as-built 或文件事实源 | `product-artifact-contracts.md` |
| 涉及 Acceptance、GWT、Codex 自检、独立验证、正式通过或验证证据 | `acceptance-and-verification.md` |
| 涉及异步、多步骤、取消、超时、重试、late event、焦点或状态恢复 | `interaction-state-contract.md` |
| 涉及 02/03 的 Framework Profile、支持范围或实施 reference | `framework-support.md` |
| 需要主 Agent 向用户确认范围、画像、边界、单选/多选或冲突 | `user-clarification.md` |
| 需要统一“事实、外部证据、推论、假设、模拟观点”等跨 Skill 协作术语 | `glossary.md` |

项目背景与自由参考材料按需从 `docs/` 读取；一次修改的决定、取代关系和进度从 `changes/` 读取；产品当前状态从正式产品产物与已验证代码读取。它们不得为了方便路由而复制进共享 Knowledge。

`knowledge_curator` 写共享 Knowledge 时还要读取目标文件、直接引用它的文件和主 Agent 指定的确认依据；只有任务要求全局一致性审计时才读取本目录全部正文。

完成标准：所有命中分支均已读取，未命中分支没有因“可能相关”被整目录加载；仍无法判断时把缺失的任务语义或路径交回主 Agent。
