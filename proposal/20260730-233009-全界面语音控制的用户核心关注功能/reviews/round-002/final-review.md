# Final Proposal Review

- Verdict：REVISE
- Design revision：R002
- Design SHA-256：da17fa289fca9bdebf5a2a5cd86cbffccd6cffe2c583df42238f85bc2846bc54
- Confidence：MEDIUM（独立裁决 Agent 超时，按 rubric 串行降级）
- User Panel score：68/80
- Independent score：18/20
- Final score：86/100

## Inputs

- round-002 manifest、固定 needs/画像/反馈、R002 design、三份独立盲评与匿名议题；哈希一致，画像无漂移。

## Hard gates

- NEED-002、NEED-003、NEED-004 在崩溃恢复、副作用锁和停录二次失败上仍未闭环。
- 无用户立场冲突；缺口可通过确定协议修订，不是 BLOCKED_BY_EVIDENCE。

## Need coverage

| Need | Priority | Verdict | Result |
| --- | --- | --- | --- |
| NEED-001 | MUST | 四类路由与证据等级成立 | 闭环 |
| NEED-002 | MUST | 崩溃窗口/TTL 仍可能重复副作用 | 未闭环 |
| NEED-003 | MUST | 正常停录握手成立，二次失败未定义 | 未闭环 |
| NEED-004 | MUST | 仲裁方向成立，锁释放与纠正语义不足 | 未闭环 |
| NEED-005 | MUST | 产品内免手链路成立 | 闭环 |
| NEED-006 | SHOULD | 队列成立，基准口径待确定 | 部分闭环 |
| NEED-007 | SHOULD | 首屏承诺成立，目录需端到端脚本 | 部分闭环 |

## User Panel synthesis

| Dimension | Max | Score | Evidence |
| --- | ---: | ---: | --- |
| Core need and pain resolution | 30 | 26 | 未知 dispatch 状态仍可能重复 |
| Journey effectiveness and efficiency | 18 | 16 | 队列锁和基准口径未封闭 |
| Understanding, expectation and feedback | 12 | 10 | CANCELLED 可纠正语义不足 |
| Control, recovery and trust | 12 | 10 | Helper 二次失败与 TTL 到期未定义 |
| Accessibility and context fit | 8 | 6 | 目录免手链路仅有声明 |

## Independent completeness

| Dimension | Max | Score | Evidence |
| --- | ---: | ---: | --- |
| 对象与规则 | 4 | 3 | 缺 tombstone 和恢复查询边界 |
| IA 与职责 | 3 | 3 | 表面职责清晰 |
| 流程与恢复 | 5 | 4 | 缺未知 dispatch/停录失败状态 |
| 质量下界 | 3 | 3 | 阈值与隐私边界明确 |
| 追踪 | 5 | 5 | 所有 Need 有验收映射 |

## Findings

### P1

- FINDING-006 / NEED-002、004 / dispatch 后 receipt 前崩溃或 TTL 到期 / §4 / 可能重复副作用 / 恢复必须区分 receipt 回放、状态查询和重新 dispatch；不可查询或过期未知进入 NEEDS_USER_CHECK，禁止自动重发；副作用 tombstone 与执行端去重期限一致。
- FINDING-007 / NEED-002、004、006 / DELIVERING、timeout、cancel requested 时队列出队 / §4、§8 / 可能两个副作用同时在途 / 副作用锁从 request 创建持有到 VERIFIED、无副作用 cancellationReceipt 或证明未 dispatch 的失败。
- FINDING-008 / NEED-003 / Helper 停录 ACK 与重建均失败 / §4、§9 / 用户无法证明麦克风已停止 / 增加 CAPTURE_STOP_FAILED，阻止新 owner、持续告警、强制终止进程并验收 OS 采集句柄。

### P2

- FINDING-009 / NEED-004 / CANCELLED 后被 VERIFIED 纠正 / §4、§8 / “唯一终态”与可纠正事实冲突 / 定义结论修订记录与固定文案，按两种到达顺序及重启仲裁验收。
- FINDING-010 / NEED-001、006、007 / Agent 关窗续显、能力目录和效率基准 / §5–§9 / 方案可理解但验收不可完全复现 / 明确端到端脚本、trial 分母、计时起止和上下文漂移卡。

## Must fix

1. 补未知 dispatch 恢复、tombstone 与绝不自动重发规则。
2. 补副作用锁释放表、CAPTURE_STOP_FAILED 和可纠正结论语义。
3. 收紧 Agent/目录/队列/效率的确定性验收脚本。

## Remaining risks

- 真实 macOS 与 Agent 能力需实现期验证；设计可先定义安全默认和降级，不阻塞继续修订。
