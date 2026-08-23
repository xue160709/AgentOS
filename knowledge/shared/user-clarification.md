# 用户澄清与提问工具

## 适用范围

适用于 `01-mvp-prd-builder` 及其它需要用户确认产品范围、画像或边界的流程。本文只定义跨 Skill 的提问和事实确认原则，不复制具体题库、题数或工具参数。

## 已确认规则

- 用户提问由主 Agent 负责；问题应服务于范围、服务对象、场景或边界的确认，不由 sub-agent 直接向用户提问。
- 需要结构化选项时，先检查当前环境实际暴露的工具及其 schema；只有当前模式、题型、选项数量和自定义输入都受支持时才调用。工具不可用或表达能力不足时，使用当前 Skill 的文本提问格式，不硬编码工具名称。
- 单选和多选必须保持原语义，不能把多选降级成单选；每轮只提出一道问题，不为使用工具而合并问题。
- 记录用户实际选择或自定义答案。未选项只是降权信号，不等于用户明确拒绝；模型推断和建议也不自动成为产品事实。
- 关键范围或边界仍含冲突时，主 Agent 先暂停正式写入和派工，向用户复述冲突并请求裁决；确认后再进入相应阶段。

## 结果边界

澄清答案可以进入任务包和后续产品产物的依据，但只有主 Agent 确认后的内容才能成为 `USER_PROFILE.md`、`GUARDRAILS.md` 或 PRD 的正式事实。问题过程、未选方向和未确认解释应保留为上下文信号，不得伪装成结论。

## 本轮来源

本轮只读提炼日期：2026-08-16。来源：`/Volumes/macOS/Github/CodeNow/.codex/rules/question-tools.md`、`/Volumes/macOS/Github/CodeNow/.codex/rules/product-user-profile.md`、`/Volumes/macOS/Github/CodeNow/.codex/rules/product-guardrails.md`、`/Volumes/macOS/Github/CodeNow/.codex/rules/lifecycle.md`。源中的题目数量、题库和工具配置未迁入当前项目。

