# Final Proposal Review

- Verdict：REVISE
- Design revision：R006
- Design SHA-256：3a277c6f6066e05df4051ed06471ba4bf831e68a57713d2a235ca70016fc10e1
- Confidence：MEDIUM（独立裁决 Agent 超时，按 rubric 串行降级）
- User Panel score：72/80
- Independent score：19/20
- Final score：91/100

## Inputs

- round-006 manifest、固定 needs/画像/反馈、R006 design、三份 E4 盲评和匿名议题；哈希一致、画像无漂移。

## Hard gates

- NEED-004 在不可查询、TTL 到期、REPORTED/UNVERIFIABLE 时缺少可结束的 reconciliation，可能永久持锁，MUST 尚未闭环。
- 其它缺口可通过定向规则和文案解决，无证据阻塞或用户分歧。

## Need coverage

| Need | Priority | Result |
| --- | --- | --- |
| NEED-001 | MUST | 证据分级成立，REPORTED 文案需更显著 |
| NEED-002 | MUST | 幂等/崩溃骨架闭环，NOT_DISPATCHED 证明需收紧 |
| NEED-003 | MUST | 双失败保守阻断成立，句柄释放措辞需统一 |
| NEED-004 | MUST | 未知状态缺 reconciliation 与锁释放终局 |
| NEED-005 | MUST | 免手决策与目录闭环 |
| NEED-006 | SHOULD | 队列成立，漂移失权和基准算法需补 |
| NEED-007 | SHOULD | 能力目录成立，首屏四类示例需补 |

## User Panel synthesis

| Dimension | Max | Score | Evidence |
| --- | ---: | ---: | --- |
| Core need and pain resolution | 30 | 28 | 未知状态仍可能永久阻塞 |
| Journey effectiveness and efficiency | 18 | 16 | 失权目标和 trial 口径不足 |
| Understanding, expectation and feedback | 12 | 10 | REPORTED/四类示例易误读 |
| Control, recovery and trust | 12 | 11 | 低证据迟到事件缺仲裁 |
| Accessibility and context fit | 8 | 7 | 免手目录已定义，待脚本证明 |

## Independent completeness

| Dimension | Max | Score |
| --- | ---: | ---: |
| 对象与规则 | 4 | 4 |
| IA 与职责 | 3 | 3 |
| 流程与恢复 | 5 | 4 |
| 质量下界 | 3 | 3 |
| 追踪 | 5 | 5 |

## Findings

### P1

- FINDING-011 / NEED-004、006 / 不可查询、TTL 到期、人工核对 / §4、§8 / 锁可能永久持有，用户无法继续 / 定义 reconciliation 三结果与权威凭证：已执行→补 receipt；未执行→NOT_EXECUTED 证明并释放但不自动重发；仍未知→显式终止队列/隔离 scope，保留 tombstone 与禁止重发。

### P2

- FINDING-012 / NEED-004 / 暂定 CANCELLED 后到 REPORTED/UNVERIFIABLE / §4、§7、§8 / 疑似副作用可能被取消文案掩盖 / 转 NEEDS_USER_CHECK、追加 revision、保持锁并验收两种低证据事件及重启。
- FINDING-013 / NEED-002、003 / NOT_DISPATCHED 证明与停录句柄 / §4、§9 / 陈旧证明或“≤1s释放”歧义可能导致重复/并行采集 / 指定执行端原子签名证明、新鲜度；删除任何句柄非零时释放 owner 的措辞。
- FINDING-014 / NEED-001、006、007 / 首屏、目标失权、效率 trial / §5–§9 / 可理解性和复现性仍有局部缺口 / 首屏四类各一例；改名/删除/失权分支；失败 trial 记到超时上限并固定中位数算法。

## Must fix

1. 补 reconciliation 三结果、scope 隔离与锁释放终局。
2. 补低证据迟到仲裁、原子 NOT_DISPATCHED 证明和一致停录措辞。
3. 收口首屏示例、目标失权和基准算法。

## Remaining risks

- 真实 Agent query/cancel 与 macOS 句柄探测属于实现期验证；设计必须保持“未知不重发”的安全默认。
