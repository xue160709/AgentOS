# Final Proposal Review

- Verdict：REVISE
- Design revision：R018
- Design SHA-256：1633a76b00851a0f0aabe5683db9d2c6774371c595057615cdd0be9d20f4401a
- Confidence：MEDIUM（独立裁决 Agent 超时，按 rubric 串行降级）
- Raw Panel score：67/80
- Validated User Panel score：70/80
- Independent score：17/20
- Final score：87/100

## Inputs

- R018 design、needs、E1 选择 A、固定画像、本轮 E4 盲评、匿名议题、panel score、manifest 与 rubric；哈希一致、无画像漂移。

## Hard gates

- NEED-004 要求“取消后不再产生副作用”，当前 `CANCELLED_PROVISIONAL` 仍可能被迟到 VERIFIED 纠正，且“暂定已取消”会制造错误安全感。
- 无证据解锁同 scope 的两项 E4 扣分与 E1 安全优先直接冲突，且方案已有 `CLOSED_UNVERIFIED`、非重叠续行、签名 reconciliation，裁决删除该扣分。

## Need coverage

| Need | Priority | Result |
| --- | --- | --- |
| NEED-001 | MUST | 证据与安全封存闭环；Agent Envelope 保真脚本待补 |
| NEED-002 | MUST | SubmissionGate 闭环；8秒“可重试”文案与规则冲突 |
| NEED-003 | MUST | 句柄与三处强停闭环 |
| NEED-004 | MUST | UNKNOWN 边界成立；取消成功语义未闭环 |
| NEED-005 | MUST | 免手脚本已覆盖 |
| NEED-006 | SHOULD | 连续态与基准成立；等待延长和 Envelope 验收待补 |
| NEED-007 | SHOULD | 能力依据成立；首次默认自动模式需再明确 |

## User Panel synthesis

裁决删除与 E1 冲突的同-scope强制解锁扣分后，最低有效体验为：

| Dimension | Max | Score |
| --- | ---: | ---: |
| Core need and pain resolution | 30 | 28 |
| Journey effectiveness and efficiency | 18 | 15 |
| Understanding, expectation and feedback | 12 | 11 |
| Control, recovery and trust | 12 | 9 |
| Accessibility and context fit | 8 | 7 |

## Independent completeness

| Dimension | Max | Score |
| --- | ---: | ---: |
| 对象与规则 | 4 | 3 |
| IA 与职责 | 3 | 3 |
| 流程与恢复 | 5 | 4 |
| 质量下界 | 3 | 3 |
| 追踪 | 5 | 4 |

## Findings

### P1

- FINDING-029 / NEED-004 / dispatch 前、执行中和副作用开始后的取消 / §4、§7、§8 / `CANCELLED_PROVISIONAL` 仍可能产生副作用，“暂定已取消”不满足取消成功语义 / 取消后只显示“正在请求停止，仍可能执行”；仅签名 cancellationReceipt 明确 `effectPrevented=true` 时转 TERMINAL_NOT_EXECUTED 并显示“已取消”。false/unknown 一律 NEEDS_USER_CHECK；删除 CANCELLED_PROVISIONAL。

### P2

- FINDING-030 / NEED-002、004、007 / 8秒无 ACK 与首次入口 / §4–§8 / “可重试”和模式选择会让用户误判操作 / 8秒仅显示“查询原请求，不会重新执行”；仅权威 NOT_DISPATCHED 后出现“安全重试”。首次默认自动路由，模式选择降为高级设置。
- FINDING-031 / NEED-001、006 / 连续思考与 Agent 转交 / §4、§6、§8、§9 / 固定10秒可能重复唤起，Envelope 无字段级验收 / 默认静默30秒，支持“等待/继续/再等一分钟”并持续显示录音；补 TransferEnvelope 逐字段相等、Agent 回显摘要、零重述与 VERIFIED/REPORTED 分层脚本。

## Must fix

1. 删除“暂定已取消”；只有权威证明阻止副作用后才宣布取消成功。
2. 统一超时查询/安全重试文案，并把三模式降为高级覆盖。
3. 补连续等待与 TransferEnvelope 保真验收。

## Remaining risks

- E1 选择 A 的明确代价是：权威源永久不可用时，同 scope 的语音写操作永久停用；这属于确认边界，不再作为缺陷。真实取消原子性和签名 reconciliation 仍需实现验证。
