# Acceptance 与独立验证

## 适用范围

适用于 `02-project-prepare` 形成验收契约、`03-project-develop` 实现首版，以及后续记录正式验收状态的协作边界。

## 契约性质

- Acceptance 属于 ATDD 契约：先于代码写出，且只在对应的 `prd/<module>/acceptance.md` 定义。
- 每个能力至少要有正常路径和适用的异常/边界路径；场景使用 GIVEN/WHEN/THEN，THEN 必须描述可观察结果。
- Web UI 场景需要稳定的语义选择器；非 UI 场景需要可复现的验证方式。TODO、产品 README 或实现文档只引用契约，不复制场景。

## 契约形成

- `02` 在规划内容合并后，若产品、体验和技术语义已冻结且剩余缺口仅限 GWT、边界/失败场景或可观察验证方式，由 `quality_verifier` 提供标记为 `DRAFT_ONLY` 的 Acceptance 草案。
- 主 Agent 复核已确认范围后，单写 `prd/<module>/acceptance.md`；该文件是模块验收契约的事实源。
- Acceptance 定义“做完”的可验证契约，不能由实现者临时发明或自行改写。
- 产品、体验或技术语义缺失时，先由对应专业角色起草并经主 Agent 裁决；只有这些语义已冻结，且剩余缺口仅是 GWT、适用边界/失败场景或可观察验证方式时，才允许 `quality_verifier` 以 `DRAFT_ONLY` 起草。QA 草案不改变正式契约或状态。
- `project-verify` 是正式验收的唯一入口，由其派出的 `quality_verifier` 独立验证。除该入口外，其他 Skill 或角色在 Acceptance 相关工作中只能返回 `DRAFT_ONLY` 的契约草案、测试缺口或验证证据候选；`update-prd` 中主 Agent 精确授权的模块专业文档由对应专业角色直接写入，主 Agent 复核后才成为项目事实，且不能改变正式 Acceptance/TODO 状态。`03-project-develop` 等开发流程还可在风险触发时形成开发阶段质量检查五态证据，但这些都不能改变正式状态，只有 `project-verify` 的独立验证证据可供主 Agent 回写。

## 实现与验证分工

| 工作 | 负责人 | 不能替代的工作 |
|---|---|---|
| 按契约实现并进行 Codex/实现自检 | `implementation_engineer` | 维护产品模块同目录或任务白名单内的实现测试；自检不等于开发阶段质量检查或正式验收，不能自行标记正式通过。 |
| `03-project-develop` 等流程中按风险触发的开发阶段质量检查 | `quality_verifier`（由对应流程安排） | 可形成五态证据并指出缺口，但不回写正式 Acceptance/TODO，不等同于 `project-verify` 的独立验收。 |
| `project-verify` 正式验收 | `quality_verifier`（由 `project-verify` 派出） | 维护 `tests/` 或任务包精确授权的独立测试/证据路径；必须以独立视角按契约验证，不由 03 检查、`update-prd` 同步或主 Agent 的主观判断替代。 |
| 契约与最终状态的合并、记录和对外声明 | 主 Agent | 不能把未验证行为宣称为正式通过。 |

实现者与验证者不得并发修改同一测试文件；文件所有权与授权路径以 [`.codex/rules/ownership.md`](../../.codex/rules/ownership.md) 为准。

## 正式通过条件

Acceptance 正式通过必须同时具备：

1. `project-verify` 派出的 `quality_verifier` 的独立验证；
2. 明确的独立验证日期；
3. 可定位、可复核的验证证据。

产品 Acceptance、对应产品 TODO 的正式状态，以及 Change 中对产品正式验收的声明/证据，只能由主 Agent 根据上述 `project-verify` 证据写入；03 等流程的开发阶段质量检查五态证据、实现自检和 `update-prd` 同步结果不能自动改变产品正式状态。

Change 自身的 `delivery` 按 `change-package` 门禁关闭，不与产品 Acceptance 合并；纯治理或文档 Change 不要求虚构产品 Acceptance 或 `project-verify`，sub-agent 不写 Change 状态。

缺少任一项时，只能保留为未完成、待验证或其他真实状态，不能写成正式通过。Acceptance 状态只反映契约与证据，不因代码已写完或局部自检完成而自动改变。

## 三层验证与失败回路

- **实现自检**：由主 Agent 或 `implementation_engineer` 按风险做局部、最小充分检查，用于证明本轮判断或改动有依据；不回写正式 Acceptance/TODO，也不能代替后两层。
- **按风险触发的开发阶段质量检查**：`03-project-develop` 等流程可由流程安排 `quality_verifier` 做集成后的质量检查，形成五态证据和测试缺口；结果只供主 Agent 后续处理，不回写正式 Acceptance/TODO。`update-prd` 仅同步计划与代码事实，不构成正式验收入口。
- **`project-verify` 正式验收**：由其派出的 `quality_verifier` 按契约逐条验证，记录实际动作、场景结果、验证日期和可定位证据；只有这层独立证据可供主 Agent 合并产品正式 Acceptance/对应 TODO 状态及 Change 中的产品正式验收声明/证据。Change 自身 `delivery` 仍按 `change-package` 门禁处理。
- 正式验收失败或跳过时，任务保持未完成并记录原因；修复由实现职责处理，之后回到 `project-verify` 独立验收复验，不通过改写契约或降低标准来收口。

## 本轮来源

本轮只读提炼日期：2026-08-16。来源：`/Volumes/macOS/Github/CodeNow/.codex/rules/acceptance-contract.md`、`/Volumes/macOS/Github/CodeNow/.codex/rules/verification-levels.md`、`/Volumes/macOS/Github/CodeNow/.codex/rules/todo-writeback.md`、`/Volumes/macOS/Github/CodeNow/.codex/skills/interaction-flow-review/references/acceptance-scenarios.md`。源中的状态模板、命令和脚本未迁入当前项目。
