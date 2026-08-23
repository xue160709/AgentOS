# Skill 与 Agent 编排索引

本文件只路由跨 Skill 的稳定组织合同，不复制运行规则、角色配置或 Skill 步骤。

## 权威入口

| 判断 | 唯一入口 |
|---|---|
| 用户责任、单层 sub-agent 关系和外部授权 | `AGENTS.md` |
| Intent、阶段、专业缺口、Light/Medium/Heavy、required 与质量触发 | `.codex/rules/lifecycle.md` |
| writer、精确路径、并行冲突、失败恢复和降级 | `.codex/rules/ownership.md` |
| sub-agent 继承历史、任务包字段与返回格式 | `knowledge/shared/context-sharing.md` |
| 产品产物、共享状态和正式完成边界 | `product-artifact-contracts.md` 与 `acceptance-and-verification.md` |
| 可用角色、模型和角色指令 | `.codex/config.toml` 与 `.codex/agents/*.toml` |

## 稳定组织合同

- Skill 是主 Agent 使用的流程入口，不是独立组织层；Skill 命中不等于专业角色已经执行。
- 主 Agent 冻结共享语义、授权任务和整合结果；专业角色在任务包边界内返回草案、实现、审查或验证。
- 专业缺口决定角色，文件边界和依赖只决定并行或串行。并行不可用不取消 required 职责，也不得被描述为已经并行。
- 角色结果在主 Agent 复核前仍是建议；共享状态、变更包和最终承诺按上表的权威入口写入。
- `knowledge/shared/` 只由 `knowledge_curator` 在主 Agent 确认可复用语义并给出精确路径后更新；运行配置、脚本和项目结论不复制进 Knowledge。

完成标准：每项组织判断都能追溯到上表唯一入口，任务包自包含，角色与 writer 有真实实例和精确边界，降级与独立性状态如实保留。
