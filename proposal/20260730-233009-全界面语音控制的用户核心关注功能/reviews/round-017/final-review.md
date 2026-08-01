# Final Proposal Review

- Verdict：REVISE
- Design revision：R017
- Design SHA-256：9f5f5d508c2901c9e14865b078608ef031678317304da077413b34054d29caea
- Confidence：MEDIUM（独立裁决 Agent 超时，按 rubric 串行降级）
- User Panel score：66/80
- Independent score：16/20
- Final score：82/100

## Inputs

- R017 design、needs、E1 安全优先选择、固定画像、本轮三份 E4 盲评、匿名议题、panel score 与 round manifest；哈希一致、画像无漂移。

## Hard gates

- NEED-002 的跨表面并发提交仍可创建两个 attempt；NEED-004 的长期 UNKNOWN 只有永久锁，没有有限时用户终态和权威恢复入口，MUST 尚未闭环。
- 同根意见已合并；无用户价值分歧或证据阻塞。

## Need coverage

| Need | Priority | Result |
| --- | --- | --- |
| NEED-001 | MUST | 证据分层、增量续显成立；长期未核验缺稳定收束 |
| NEED-002 | MUST | 执行端幂等成立；request 创建前并发归并缺失 |
| NEED-003 | MUST | 句柄唯一释放成立；三处一步强停验收待补 |
| NEED-004 | MUST | 不重发和保守 scope 成立；长期 UNKNOWN 恢复不完整 |
| NEED-005 | MUST | 主流程成立；零鼠标端到端验收待补 |
| NEED-006 | SHOULD | 严格效率公式成立；连续收音和上下文交接不完整 |
| NEED-007 | SHOULD | 手动/不支持已区分；路由依据需在确认卡可见 |

## User Panel synthesis

| Dimension | Max | Score |
| --- | ---: | ---: |
| Core need and pain resolution | 30 | 27 |
| Journey effectiveness and efficiency | 18 | 16 |
| Understanding, expectation and feedback | 12 | 9 |
| Control, recovery and trust | 12 | 10 |
| Accessibility and context fit | 8 | 4 |

## Independent completeness

| Dimension | Max | Score |
| --- | ---: | ---: |
| 对象与规则 | 4 | 3 |
| IA 与职责 | 3 | 2 |
| 流程与恢复 | 5 | 4 |
| 质量下界 | 3 | 2 |
| 追踪 | 5 | 5 |

## Findings

### P1

- FINDING-024 / NEED-002 / 语音、按钮、快捷键在首次反馈前并发提交 / §4、§6、§9 / 可生成不同 logicalAttemptId，绕过执行幂等并产生两次副作用 / 增加主进程原子 `SubmissionGate`：以 sessionId+confirmationEpoch+draftHash 做 CAS，所有表面复用 winning request；只有明确“再执行一次”递增 epoch。并发注入须 request=1、dispatch=1、effect=1。
- FINDING-025 / NEED-001、004 / REPORTED、UNKNOWN 或查询永久不可用 / §4、§7、§8 / 用户永久停在处理中且同 scope 无恢复入口 / 设定 reconciliation deadline，转入用户终态 `CLOSED_UNVERIFIED`；保留 tombstone/锁且不冒充结果，同时提供权威重新核验、导出诊断、人工升级入口。只有签名 reconciliation 可释放同 scope。

### P2

- FINDING-026 / NEED-006 / 一次唤起连续五项及 Agent 转交 / §4、§6、§8、§9 / 连续模式可能要求重复按键，Agent 可能要求重述，基准可挑简单任务 / 定义可见的 CONTINUOUS_LISTENING 状态和停止规则；恢复 `TransferEnvelope` 的目标、对象、约束、上下文快照；预注册五条跨页任务，限定一次唤起、零鼠标和零重述。
- FINDING-027 / NEED-003、005 / 停录失败和核心免手旅程 / §7、§9 / 三处只告警但未保证都能一步强停；低/中风险及权限恢复缺零鼠标证据 / 三处均提供同一强停动作；补低风险、中风险、权限阻塞三条端到端脚本，除系统授权页外零鼠标，授权后语音续接草稿。

### P3

- FINDING-028 / NEED-007 / 同义或目录外任务的确认 / §5、§7 / 用户看到路由但不一定理解选择依据 / 确认卡显示命中的 Capability、路由依据和边界理由，并允许语音改选或取消。

## Must fix

1. 在 request 创建前增加跨表面的原子 SubmissionGate。
2. 增加 `CLOSED_UNVERIFIED` 有限时终态及仅由权威 reconciliation 解锁的恢复入口。
3. 固定连续收音状态、TransferEnvelope、预注册基准和三类零鼠标/强停验收。

## Remaining risks

- 真实执行器是否能提供签名 reconciliation、macOS 强停与跨应用权限版本仍需实现验证；选择 A 要求能力登记缺少这些契约时直接降级为手动或不支持。
