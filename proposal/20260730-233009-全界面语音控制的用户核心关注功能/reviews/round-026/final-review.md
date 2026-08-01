# Final Proposal Review

- Verdict：REVISE
- Design revision：R027
- Design SHA-256：40ac35e6b499c10353e41eed4fe613a9943fbd6b6278161e8346af0541ea5e5b
- Confidence：MEDIUM（独立裁决 Agent 连续两个观察窗口未完成，按 rubric 串行降级）
- User Panel score：70/80
- Independent score：18/20
- Final score：88/100

## Inputs

- R027 design、needs、E1 安全优先边界、固定画像/E4 反馈、本轮盲评、匿名讨论、panel score、round manifest 与 rubric；修订号及设计/画像哈希一致。
- 讨论已删除两项误读：Agent 等待并不天然等于 scope 冲突；低风险“复述并可撤销”不天然要求第二次用户确认。真实效率数据按剩余风险处理，不把合成基准冒充真实提效。

## Hard gates

- 强停退出后未持久化隐私事故并在重开前复核 PID/句柄/权限，重开可能丢失“仍未证明停麦”的门禁。
- “签名人工核验”缺授权角色、证据和可释放范围；普通“我看到了”是否能解锁没有唯一规则，NEED-004 未闭环。

## Need coverage

| Need | Priority | Result |
| --- | --- | --- |
| NEED-001 | MUST | 可信结果主体成立；人工核验证据与取消止损待补 |
| NEED-002 | MUST | 编辑、CAS、防重与低风险撤销闭环 |
| NEED-003 | MUST | 强停升级链成立；退出—重开隐私门禁待补 |
| NEED-004 | MUST | 状态恢复成立；人工核验解锁规则缺失 |
| NEED-005 | MUST | 代表性免手链与系统权限边界成立 |
| NEED-006 | SHOULD | 合成基准诚实；暂停粒度须与 scope 隔离一致 |
| NEED-007 | SHOULD | 当前页建议成立；能力询问和辅助朗读待补 |

## User Panel synthesis

| Dimension | Max | Score | Valid evidence |
| --- | ---: | ---: | --- |
| Core need and pain resolution | 30 | 27 | 未核验任务缺可执行证据闭环 |
| Journey effectiveness and efficiency | 18 | 16 | 能力询问与等待期间独立发令不明确 |
| Understanding, expectation and feedback | 12 | 10 | 三类未完成状态和取消止损仍需解释 |
| Control, recovery and trust | 12 | 10 | 人工解锁与重开隐私门禁缺失 |
| Accessibility and context fit | 8 | 7 | 首播报与 VoiceOver/系统朗读未串行 |

## Independent completeness

| Dimension | Max | Score | Evidence |
| --- | ---: | ---: | --- |
| 对象与规则 | 4 | 3 | 人工核验 authority/policy 字段缺失 |
| IA 与职责 | 3 | 3 | 用户语言、详情层与主动作明确 |
| 流程与恢复 | 5 | 4 | 退出重开及暂停粒度不完整 |
| 质量下界 | 3 | 3 | 性能、故障、基准与隐私测试充分 |
| 追踪 | 5 | 5 | 七个 Need 可追溯 |

## Findings

### P2

- FINDING-047 / NEED-003 / 强停失败后退出、撤权、重开 / §4、§6–§9 / 事故告警和原稿可能丢失，过早开放收音 / 扣 3 / 退出前原子持久化 privacy incident；重开先回放并权威查 PID/句柄/权限，句柄0或权限拒绝后才消警并恢复稿，否则持续禁录。
- FINDING-048 / NEED-001、004 / 用户已在外部看到任务结果 / §4、§7–§9 / 普通确认可能错误解锁，或合法证据也无法续行 / 扣 4 / Capability 预登记人工核验策略：授权角色、对象/版本、证据类型/hash、签名/时间、允许终态；只由满足策略的 receipt 释放，普通“我看到了”不释放并说明替代路径。
- FINDING-049 / NEED-006 / Agent 运行时继续独立任务 / §6、§8、§9 / 文案把 Agent 等待整体列为系统暂停，可能阻断不重叠 DIRECT / 扣 2 / 仅播报、队列背压或 scope 冲突暂停；单纯等待不暂停，一次唤起内300ms可接独立任务且无串扰。
- FINDING-050 / NEED-001、004、007 / 首次询问能力或取消未证实 / §5–§7 / 用户仍可能先试错，或不知道即时止损 / 扣 2 / “这个能做吗”走无副作用 capability query，不建 request、effect=0，返回五类路径/边界/替代；恢复卡按 effectClass 仅给一个安全止损动作。

### P3

- FINDING-051 / NEED-007 / 首次播报与 VoiceOver/系统朗读并发 / §5、§9 / 音频重叠影响理解 / 扣 1 / 检测辅助朗读后禁自动播报，改走同一 accessibility announcement 队列；25次播放零入稿且建议文字可达。

## Must fix

1. 决定人工核验能否释放锁，并把 authority/evidence/policy 写成唯一规则。
2. 持久化强停隐私事故，重开验证后才恢复收音与草稿。
3. 将连续暂停收窄到真实冲突，并补能力询问、止损与辅助朗读规则。

## Remaining risks

- 长期 UNKNOWN 锁与能力覆盖缩小是 E1 安全优先的已知代价；真实高频样本、macOS 句柄和 VoiceOver 时序仍需实测。
