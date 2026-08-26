# Acceptance 与独立验证

适用于 `02-project-prepare` 形成验收契约、`03-project-develop` 实现首版，以及后续记录正式验收状态的协作边界。本文件只定义职责与证据边界；验证深度如何选择、正式验收何时触发与由谁授权，以 [`.codex/rules/lifecycle.md`](../../.codex/rules/lifecycle.md) 的“验证深度”与“正式验收授权”为唯一事实源。

## 契约性质

- Acceptance 属于 ATDD 契约：先于代码写出，且只在对应的 `prd/<module>/acceptance.md` 定义。
- 每个能力至少要有正常路径和适用的异常/边界路径；场景使用 GIVEN/WHEN/THEN，THEN 必须描述可观察结果。
- Web UI 场景需要稳定的语义选择器；非 UI 场景需要可复现的验证方式。TODO、产品 README 或实现文档只引用契约，不复制场景。
- Acceptance 定义“做完”的可验证契约，不由实现者临时发明或自行改写。

## 契约形成

- 产品、体验或技术语义缺失时先由对应专业角色起草并经主 Agent 裁决；这些语义冻结后，剩余缺口仅是 GWT、适用边界/失败场景或可观察验证方式时，才由 `quality_verifier` 提供 `DRAFT_ONLY` 草案，草案不改变正式契约或状态。
- 主 Agent 复核已确认范围后单写 `prd/<module>/acceptance.md`，该文件是模块验收契约的事实源。

## 实现与验证分工

| 工作 | 负责人 | 边界 |
|---|---|---|
| 按契约实现并做实现自检 | Light：主 Agent；Medium/Heavy：`implementation_engineer` | 维护产品模块同目录或任务白名单内的实现测试；自检不等于开发阶段质量检查或正式验收 |
| 开发阶段独立质量检查 | `quality_verifier`（由对应流程按 lifecycle 安排） | 形成五态证据并指出缺口，不回写正式 Acceptance/TODO |
| 正式验收 | `quality_verifier`（由 `project-verify` 派出） | 维护 `tests/` 或任务包精确授权的独立测试/证据路径，以独立视角按契约逐条验证 |
| 契约与最终状态的合并、记录和对外声明 | 主 Agent | 不能把未验证行为宣称为正式通过 |

实现者与验证者不得并发修改同一测试文件；文件所有权与授权路径以 [`.codex/rules/ownership.md`](../../.codex/rules/ownership.md) 为准。

## 正式通过条件

Acceptance 正式通过必须同时具备：`project-verify` 派出的 `quality_verifier` 的独立验证、明确的独立验证日期、可定位可复核的验证证据。三者缺一只能保留未完成、待验证或其他真实状态；产品 Acceptance、对应 TODO 状态及 Change 中的产品正式验收声明只能由主 Agent 依据这层证据写入。

验收失败或跳过时任务保持未完成并记录原因；修复后回到 `project-verify` 复验，不通过改写契约或降低标准收口。Change 自身的 `delivery` 按 `change-package` 门禁关闭，不与产品 Acceptance 合并；纯治理或文档 Change 不虚构产品 Acceptance，sub-agent 不写 Change 状态。

## 本轮来源

本文件是跨 Skill 的验收职责与证据边界事实源；运行判断与授权规则见 [`.codex/rules/lifecycle.md`](../../.codex/rules/lifecycle.md)。
