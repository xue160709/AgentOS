# Independent adjudicator failure

- 角色：`proposal_voice_adjudicator_r19`
- 结果：连续两个 30 秒窗口超时后中止；未采纳未完成输出，也未重试。
- 降级：主会话按固定 rubric 串行裁决，`confidence=MEDIUM`。
