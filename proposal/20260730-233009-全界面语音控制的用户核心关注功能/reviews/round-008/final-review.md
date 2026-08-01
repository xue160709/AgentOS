# Final Proposal Review

- Verdict：REVISE
- Design revision：R008
- Design SHA-256：7592291455686abc52c44c37aef07e35a9fb0f1c346acae6850aafd698f886c0
- Confidence：MEDIUM（独立裁决 Agent 超时，按 rubric 串行降级）
- User Panel score：70/80
- Independent score：18/20
- Final score：88/100

## Inputs

- round-008 manifest、needs、固定画像/反馈、R008 design、三份 E4 盲评与匿名议题；哈希一致、画像无漂移。

## Hard gates

- NEED-002/004 仍存在机器实现可能得到两种解释的状态迁移；NEED-006 的 scope 和效率公式也不确定。
- 同根问题已合并，不重复扣分；无证据阻塞或用户分歧。

## Need coverage

| Need | Priority | Result |
| --- | --- | --- |
| NEED-001 | MUST | 四类边界成立，Agent 低证据文案/续显待收口 |
| NEED-002 | MUST | 幂等成立，NOT_DISPATCHED/NOT_EXECUTED 迁移仍含糊 |
| NEED-003 | MUST | 句柄非零不释放闭环 |
| NEED-004 | MUST | UNKNOWN 隔离成立，scope/低证据/tombstone 状态机未闭环 |
| NEED-005 | MUST | 免手流程闭环 |
| NEED-006 | SHOULD | 连续队列成立，scope、漂移与公式未闭环 |
| NEED-007 | SHOULD | 四类示例成立，需验证用户能解释依据 |

## User Panel synthesis

| Dimension | Max | Score |
| --- | ---: | ---: |
| Core need and pain resolution | 30 | 27 |
| Journey effectiveness and efficiency | 18 | 16 |
| Understanding, expectation and feedback | 12 | 10 |
| Control, recovery and trust | 12 | 9 |
| Accessibility and context fit | 8 | 8 |

## Independent completeness

| Dimension | Max | Score |
| --- | ---: | ---: |
| 对象与规则 | 4 | 3 |
| IA 与职责 | 3 | 3 |
| 流程与恢复 | 5 | 4 |
| 质量下界 | 3 | 3 |
| 追踪 | 5 | 5 |

## Findings

### P1

- FINDING-015 / NEED-002、004、006 / UNKNOWN、取消迟到、scope 隔离、目标失权 / §4、§6、§8 / 实现可错误重发、误放行或永久阻塞 / 必须定义 `EffectScope` 规范结构与父子重叠算法，并给出完整状态迁移表：NOT_DISPATCHED 仅一次原身份重发；NOT_EXECUTED 只结束；UNKNOWN tombstone 永不 GC 至权威 reconciliation；CANCELLED+REPORTED/UNVERIFIABLE 必进 NEEDS_USER_CHECK；dispatch 前原子重解析 target/permission。

### P2

- FINDING-016 / NEED-006 / 五 trial 与目标漂移 / §6、§9 / 公式冲突导致验收可选择性通过 / 规定 trial 成功=五任务全 VERIFIED，因此要求 5/5 即 25/25；若采用 ≥24/25 则序列通过应改为 ≥4/5。固定一个口径、超时值和配对中位数算法。
- FINDING-017 / NEED-001、004、007 / Agent 关窗重启、REPORTED 文案、首次理解 / §5–§9 / 低上下文用户仍可能误判且实现缺端到端脚本 / 所有表面紧邻“系统未核验”；关窗/重启保持 requestId、sequence、目标与 deadline；首次测试须解释四类依据。

## Must fix

1. 写出 EffectScope schema、重叠算法和单一状态迁移表。
2. 固定一个无冲突的效率公式与 dispatch 前目标/权限原子检查。
3. 固定 Agent 续显脚本、“系统未核验”文案和首次理解依据。

## Remaining risks

- 真实 Agent 和 macOS 仍待实现验证，但安全默认与降级可在设计层确定。
