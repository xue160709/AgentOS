# DISCUSSION_RESPONSE｜user-001（E4）

- A **KEEP**：Agent 等待不应停整个 VoiceSession；现有 `pauseReason`、scope 隔离已可表达，仅冲突源暂停。
- B **ADJUST**：明确低风险复述不等于再次说“执行”；现有 Draft/Gate 足够，无需新机制。
- C **ADJUST**：普通“我看到了”不得解锁；预登记的角色、对象版本、证据 hash、签名与终态可由 CapabilityEntry＋Receipt 表达，无需新对象。
- D **ADJUST**：恢复前必须回放 sentinel 并权威复核句柄/权限；现有 VoiceSession＋Ledger 可承载，但缺明确开放收音门禁。
- E **ADJUST**：能力询问用 ANSWER＋Capability，未核验用 Receipt＋恢复卡，取消止损用 effectClass＋恢复卡；缺口是用户文案、状态规则与 VoiceOver/播报串行规则，不是对象缺失。

前 **71/80（27/16/10/11/7）** → 后 **71/80（27/16/10/11/7）**；讨论未形成设计修订，不因意见数量改分。未解：NEED-001、NEED-007；NEED-004 仍待门禁与故障验证。审计：仅本人初评与本轮议题。
