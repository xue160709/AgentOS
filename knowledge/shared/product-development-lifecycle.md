# 产品开发生命周期

本文件只记录跨 Skill 稳定的阶段职责与事实流。本轮阶段、等级、角色和 Skill 路由必须另读 [`.codex/rules/lifecycle.md`](../../.codex/rules/lifecycle.md)；具体步骤以对应 Skill 为准。

## 阶段职责

| 阶段组 | 稳定职责 | 交接边界 |
|---|---|---|
| 探索与问题理解 | `intent-decision`、`product-thinking-partner`、`product-discovery`、`product-problem-investigation`、`product-design`，以及按需的 `user-perspective-review`、`interaction-flow-review`、`design-proposal-loop`，帮助收敛意图、范围、根因、证据和方案 | 默认不写正式产品状态；未确认方向不进入 change/Planned，严格设计评审的具体门禁以对应 Skill 为准 |
| 零到一首版 | `01` 定义产品与用户，`02` 形成开发规格和 Acceptance，`03` 实现首版 | 只适用于 lifecycle 判定的 `mvp_initial` |
| 成熟产品增量 | `product-discovery`/`product-design` 确认改变，change 管理持久工作，专业草案经 `update-prd` 同步，`project-iterate` 实现 | 缺合同、Demo/README 漂移或大块重规划不回流 02 |
| 故障与维护 | 未知根因先 `project-debug(DIAGNOSE)`，已知根因或获授权修复进入 `project-iterate` | 诊断不自动授权修复，复验不等于正式验收 |
| 状态同步 | `update-prd` 分离同步已确认 Planned 与代码/已验证行为形成的 Current/as-built | 不从代码反推未确认产品范围、画像或边界 |
| 只读审查 | `code-review` 对明确范围检查工程正确性、仓库约束和规格兑现 | 只返回经主 Agent 复核的候选发现，不授权修复、提交或正式验收 |
| 正式验收 | `project-verify` 派 `quality_verifier` 按 Acceptance 独立验证 | 只有该证据可驱动正式 Acceptance 和对应 TODO 完成状态 |

## 跨阶段事实流

- `01` 形成服务对象、正向范围和已确认边界；`02` 消费这些事实并形成规格，不反向改写。
- 实现角色只写精确授权的代码、测试和开发文档；产品、体验或技术合同缺失时返回对应专业流程。
- 除 `project-verify` 外，Acceptance 相关输出只能是 `DRAFT_ONLY` 契约、质量检查或证据候选。
- `changes/` 管理一次持久变更；根 `TODO.md` 管理产品交付。纯治理 change 不虚构产品 TODO、Acceptance 或实现角色。
- 完成、部分完成、阻塞、失败和跳过保持真实状态；文档同步、代码写完或局部自检都不能自动宣称正式完成。

产品产物和状态单一事实源见 `product-artifact-contracts.md`，验收角色与证据见 `acceptance-and-verification.md`，组织和 writer 边界见 `agent-orchestration.md` 与 `.codex/rules/ownership.md`。
