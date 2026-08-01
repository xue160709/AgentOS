# Participant Blind Review

- ID：user-003
- Revision：R008
- SHA-256：7592291455686abc52c44c37aef07e35a9fb0f1c346acae6850aafd698f886c0
- Score：75/80（30/30、16/18、10/12、11/12、8/8）

## Findings

1. NEED-004；§4/§8；规则 9 要求 CANCELLED→REPORTED/UNVERIFIABLE 转 NEEDS_USER_CHECK，但规则 10 的证据优先级可能保持已取消；-2。持久化后注入两种事件并重启，必须生成 revision 与“不会自动重发”。
2. NEED-002/004；§4/§6/§8；NOT_DISPATCHED 与 NOT_EXECUTED 状态迁移相邻但不明确；-2。前者仅凭原子有效证明可原身份最多重发一次；后者只结束并释放，绝不重发。
3. NEED-002/004；§4/§9；UNKNOWN tombstone 最终清理条件未定义；-1。去重期过后仍保留至权威 reconciliation，重试副作用计数始终 0 或 1。

本评审只读指定 bundle；E4 不冒充真实用户。
