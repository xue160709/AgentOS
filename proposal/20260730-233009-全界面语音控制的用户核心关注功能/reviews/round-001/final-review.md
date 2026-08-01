# Final Proposal Review

- Verdict：REVISE
- Design revision：R001
- Design SHA-256：8a30b5283b33ca9eed67149c5d36ecd2bb4e509c8f89795614351d78fd1578e4
- Confidence：MEDIUM（独立裁决 Agent 超过两个 30 秒观察窗口后中断；本轮按同一 rubric 串行降级）
- User Panel score：60/80
- Independent score：17/20
- Final score：77/100

## Inputs

- 已核对 round manifest、固定画像与反馈哈希、`needs.md`、R001 `design.md`、三份独立盲评和匿名议题。
- Panel 仅是 E4 模拟体验预测；没有把重复意见提升为真实用户证据。

## Hard gates

- NEED-001、NEED-002、NEED-004 仍存在会改变用户结果的闭环缺口，`all_must_needs_resolved=false`。
- 主旅程、对象与状态结构成立；画像未漂移；没有必须由用户选择才能继续的终局冲突。

## Need coverage

| Need ID | Priority | Design location | Participant verdict | Result |
| --- | --- | --- | --- | --- |
| NEED-001 | MUST | §3–§8 | 三方均指出 Agent 终态/后置条件不足 | 未闭环 |
| NEED-002 | MUST | §4, §6, §8 | 可纠错，但跨重启幂等不完整 | 未闭环 |
| NEED-003 | MUST | §4, §7–§9 | 原则成立，关闭重开时序需明确 | 部分闭环 |
| NEED-004 | MUST | §4, §6, §8 | 超时/取消/迟到的终态仲裁不足 | 未闭环 |
| NEED-005 | MUST | §4, §6, §7 | 产品内语音确认、澄清与系统权限边界明确 | 闭环 |
| NEED-006 | SHOULD | §5, §6, §9 | 连续发令仍等待上一任务终态 | 部分闭环 |
| NEED-007 | SHOULD | §5, §7, §9 | 有示例和目录，但首屏整体承诺与免手浏览不足 | 部分闭环 |

## User Panel synthesis

| Dimension | Max | Score | Valid evidence |
| --- | ---: | ---: | --- |
| Core need and pain resolution | 30 | 23 | Agent completion、幂等与取消证据不足 |
| Journey effectiveness and efficiency | 18 | 13 | 长任务阻塞下一条准备，缺少基准 |
| Understanding, expectation and feedback | 12 | 9 | 四类路由未在首屏形成可预测承诺 |
| Control, recovery and trust | 12 | 9 | 跨重启和迟到终态仲裁不完整 |
| Accessibility and context fit | 8 | 6 | 能力目录尚未定义语音浏览 |

## Independent completeness

| Dimension | Max | Score | Evidence |
| --- | ---: | ---: | --- |
| 对象、关系、生命周期与规则 | 4 | 3 | 主对象完整，幂等 TTL/持久化缺失 |
| 信息架构与组件职责 | 3 | 3 | 命令窗、主窗、Chat 职责清晰 |
| 主流程、分支与恢复 | 5 | 4 | 缺取消/迟到终态仲裁表 |
| i18n、可访问性与跨模块 | 3 | 3 | 有明确质量下界 |
| Need—设计—验收追踪 | 5 | 4 | 全 Need 可追踪，部分验收缺确定输入/阈值 |

## Findings

### P1

- FINDING-001 / NEED-001、NEED-006 / Agent 长尾任务 / §4–§8 / “已交给 Agent”仍可能无可信终态，用户需重述或误判完成 / 必须定义转交包、进度、后置条件、降级和 receipt 协议，并按能力声明 `VERIFIED / REPORTED / UNVERIFIABLE`。
- FINDING-002 / NEED-002、NEED-004 / ACK 丢失、重启、取消后迟到成功 / §4、§8 / 可能重复副作用或把真实成功显示为已取消 / 必须定义跨重启幂等 TTL、原 receipt 回放、取消证据与终态优先级。

### P2

- FINDING-003 / NEED-003 / 录音中隐藏、关闭并立即重开 / §4、§7、§8 / 旧 owner 或旧 final 可能污染新会话 / 必须给出关闭握手、超时强制释放、三处指标消失与事件隔离验收。
- FINDING-004 / NEED-007、NEED-005 / 首次打开及询问“能做什么” / §5、§7 / 用户可能把示例当全部能力且被迫点击目录 / 必须补一句四类边界承诺和语音浏览目录流程。
- FINDING-005 / NEED-006 / 上一任务运行时准备下一条 / §4–§6 / 长任务打断高频效率 / 必须定义单在途副作用、可并行草稿队列和连续任务基准。

## Must fix

1. 补 Agent transfer/receipt/postcondition 与不可验证降级契约。
2. 补跨重启幂等、取消证据和迟到终态仲裁表。
3. 补语音关闭握手、首次能力承诺、免手目录与连续任务队列。
4. 把上述规则写成确定性的验收输入、阈值和预期结果。

## Remaining risks

- 真实用户任务排序、真实语音准确率、macOS TCC 和 30 类 Agent 任务能力仍需实施阶段验证；不阻塞本轮把设计契约补完整。
