# Independent adjudicator failure

- 角色：`proposal_voice_adjudicator_r17`
- 结果：连续两个 30 秒完成窗口均超时，随后中止；未采纳未完成输出，也未重试。
- 降级：主会话仅依据 round-017 固定输入和 rubric 串行裁决，`confidence=MEDIUM`。
