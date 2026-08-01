# Participant Blind Review

- Participant ID：user-003
- Design revision：R001
- Design SHA-256：8a30b5283b33ca9eed67149c5d36ecd2bb4e509c8f89795614351d78fd1578e4

## Need verdict

| Need | 结论 | 依据 |
| --- | --- | --- |
| NEED-001 | PARTIAL | 已区分接收、执行与终态，但真实后置条件证明仍偏抽象 |
| NEED-002 | PARTIAL | 可纠错且有幂等键；ACK 丢失、重启后的防重边界未定义 |
| NEED-003 | PARTIAL | 录音全局可见、隐藏/关闭停录；关闭后立即重开的时序未验收 |
| NEED-004 | PARTIAL | 有超时、取消、错误保留和迟到隔离；终态仲裁仍不完整 |
| NEED-005 | PASS（方案层） | 核心确认、澄清、取消可语音完成，系统权限边界诚实 |

## Score

| 维度 | 得分 |
| --- | ---: |
| Need 覆盖 | 25/30 |
| 失败恢复 | 14/18 |
| 状态与隔离 | 9/12 |
| 可验收性 | 9/12 |
| 可理解性 | 7/8 |
| 总分 | 64/80 |

## Findings

1. F-01；NEED-003；§4/§7/§8；录音中隐藏或关闭并立即重开、旧 final 迟到；-4；补测隐藏、×、Escape 后 ≤300ms 停采集且三处标记消失；重开只有一个 owner，旧事件不进入当前草稿。
2. F-02；NEED-004；§4 规则 5–7、§8；DELEGATED 超时后取消，随后迟到成功；-4；只有下游“无后续副作用”证据才进 CANCELLED；迟到成功/失败按原 request 显示真实终态且不覆盖新任务。
3. F-03；NEED-002/004；§4；执行已生效但 ACK 丢失，重启后用户重试；-4；明确幂等键 TTL、跨重启与终态重试规则；故障注入下 executor 仅执行一次并返回原 receipt。
4. F-04；NEED-001；§1/§4/§6/§8；Agent 声称完成但外部状态未变；-4；代表性 DIRECT/DELEGATED 以可观测系统状态核验 postcondition，不匹配不得进入 SUCCEEDED。

## Discussion topics

- 哪些 Agent 路由能提供可信终态与后置条件；CANCELLED 的无副作用证据由谁产生；幂等记录需跨进程保留多久。

实际只读 `reviews/round-001/panel/review-bundles/user-003.md`；E4 仅代表模拟视角。
