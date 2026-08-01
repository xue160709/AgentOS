# Final Proposal Review

- Verdict：REVISE
- Design revision：R024
- Design SHA-256：f22c7196d5b060be88fdab35f0eb59554893a79d224d0d8b7046576424ade268
- Confidence：MEDIUM（独立裁决 Agent 连续两个观察窗口未完成，按 rubric 串行降级）
- User Panel score：72/80
- Independent score：18/20
- Final score：90/100

## Inputs

- R024 design、needs、E1 安全优先边界、固定画像及 E4 反馈、本轮独立盲评与匿名讨论、round manifest、panel score 与 evaluation rubric；修订号、设计哈希和画像哈希一致。

## Hard gates

- 主界面用户术语层与确认卡中的 `Capability` 表达冲突，首次用户仍无法从当前上下文快速预测能力路径。
- 连续模式的固定 30 秒窗口与“非主动暂停时系统诱发维护口令为 0”的验收契约冲突。
- Envelope 拒绝后的保稿、补字段、确认与 request 继承尚无唯一恢复路径，NEED-004 未完全闭环。

## Need coverage

| Need | Priority | Result |
| --- | --- | --- |
| NEED-001 | MUST | 可信结果与用户主动作成立；当前上下文能力提示待补 |
| NEED-002 | MUST | 提交身份、CAS、防重复与音源规则闭环 |
| NEED-003 | MUST | 停录与取消分离、句柄归零释放闭环；实机时序待验 |
| NEED-004 | MUST | 状态/取消/恢复主体成立；Envelope 拒绝恢复待补 |
| NEED-005 | MUST | 低/中风险免手链与系统手动边界成立 |
| NEED-006 | SHOULD | 合成基准诚实；固定静默窗和长期阻塞待优化 |
| NEED-007 | SHOULD | 默认自动与五类边界成立；上下文发现性待补 |

## User Panel synthesis

| Dimension | Max | Score | Valid evidence |
| --- | ---: | ---: | --- |
| Core need and pain resolution | 30 | 28 | 未核验边界诚实，但具体能力仍需试探 |
| Journey effectiveness and efficiency | 18 | 16 | 核对动作偏泛；固定静默窗影响连续节奏 |
| Understanding, expectation and feedback | 12 | 10 | 用户术语规则与 `Capability` 卡片不一致 |
| Control, recovery and trust | 12 | 11 | 取消/Envelope 恢复的用户时点仍不够具体 |
| Accessibility and context fit | 8 | 7 | 固定窗口未适配 Agent 等待情境 |

## Independent completeness

| Dimension | Max | Score | Evidence |
| --- | ---: | ---: | --- |
| 对象与规则 | 4 | 4 | 身份、scope、receipt、录音与证据不变量明确 |
| IA 与职责 | 3 | 2 | 主界面术语与确认卡字段冲突 |
| 流程与恢复 | 5 | 4 | Envelope 拒绝恢复尚不唯一 |
| 质量下界 | 3 | 3 | 性能、故障、基准及安全均可验收 |
| 追踪 | 5 | 5 | 七个 Need 均映射机制和场景 |

## Findings

### P2

- FINDING-041 / NEED-001、007 / 首次唤起与确认 / §5、§7 / 静态示例与 `Capability` 术语使用户仍需猜当前任务 / 扣 4 分 / 按当前页面给 3 条可说任务；卡片只用“直接做/交给 Agent/回答/需手动/做不了”，技术分类仅进详情；首次 4/5 正确预测。
- FINDING-042 / NEED-006 / Agent 等待或队列处理中 / §6、§8、§9 / 固定 30 秒会诱发维护口令并破坏连续效率契约 / 扣 3 分 / 权威等待、决策或队列处理中暂停倒计时并解释，恢复可听输入时重启；非主动暂停维护口令保持 0。
- FINDING-043 / NEED-004、006 / Envelope 缺失或变化、取消待复核 / §4、§6–§9 / 用户可能重述整项任务或不知道何时再看 / 扣 4 分 / 保留原目标，仅展示并补齐变化字段；明确是否复用原 request、何时重确认及自动复核时点，测试 request/dispatch/effect 不重复。

## Must fix

1. 把当前上下文建议和五类用户语言落实到首屏/确认卡。
2. 让连续窗口在系统等待态暂停，并与维护口令验收一致。
3. 补齐 Envelope 拒绝与取消复核的唯一恢复路径和用户时点。

## Remaining risks

- 真实高频任务、macOS 句柄时序及 Agent 后置核验仍需实测；取得真实样本前只能报告合成基准，不构成新的设计猜测。
