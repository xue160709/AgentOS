# Final Proposal Review

- Verdict：REVISE
- Design revision：R026
- Design SHA-256：4b50f7eda960ad400997a9f80ff911bab2272926a723c3932db96de4e63543d4
- Confidence：MEDIUM（独立裁决 Agent 连续两个观察窗口未完成，按 rubric 串行降级）
- User Panel score：74/80
- Independent score：18/20
- Final score：92/100

## Inputs

- R026 design、needs、E1 安全优先边界、固定画像/E4 反馈、本轮盲评、匿名讨论与 panel score、round manifest、evaluation rubric；修订号、设计与画像哈希一致。
- 已删除两项无效扣分：user-001 未获 §8 属于 bundle 输入限制；user-002 已在讨论中撤销“系统暂停=系统诱发维护口令”的误读。

## Hard gates

- `STOP_CAPTURE`、重建后句柄仍非零/不可查时，方案只保证不释放、不新录音和持续告警，没有定义终止失控 Helper/音频会话、权威复核和系统权限兜底；NEED-003 的“立即停止”未闭环。

## Need coverage

| Need | Priority | Result |
| --- | --- | --- |
| NEED-001 | MUST | 五类处理、后置核验、唯一用户结论闭环 |
| NEED-002 | MUST | 编辑、CAS、稳定身份与防重复闭环 |
| NEED-003 | MUST | 常规停录闭环；句柄卡死的实际终止路径缺失 |
| NEED-004 | MUST | 状态与恢复闭环；封存文案仍可能误导 |
| NEED-005 | MUST | 低/中风险免手链及手动边界闭环 |
| NEED-006 | SHOULD | 连续暂停逻辑成立；真实效率为明确剩余风险 |
| NEED-007 | SHOULD | 当前页建议成立；首次注意顺序待微调 |

## User Panel synthesis

| Dimension | Max | Score | Valid evidence |
| --- | ---: | ---: | --- |
| Core need and pain resolution | 30 | 29 | 句柄卡死时不能确认已停麦 |
| Journey effectiveness and efficiency | 18 | 16 | 强停失败后缺可执行恢复路径 |
| Understanding, expectation and feedback | 12 | 11 | “安全封存”可能暗示副作用停止 |
| Control, recovery and trust | 12 | 11 | 强停只有告警/诊断，缺系统级兜底 |
| Accessibility and context fit | 8 | 7 | 首次建议注意顺序及立即停录待验 |

## Independent completeness

| Dimension | Max | Score | Evidence |
| --- | ---: | ---: | --- |
| 对象与规则 | 4 | 4 | 请求、转交、scope、录音与证据不变量明确 |
| IA 与职责 | 3 | 3 | 用户术语、详情层和唯一主动作清楚 |
| 流程与恢复 | 5 | 4 | 句柄卡死无终止/权限兜底 |
| 质量下界 | 3 | 2 | 验收只证明不释放，未证明实际停止 |
| 追踪 | 5 | 5 | 七个 Need 均有设计和验收映射 |

## Findings

### P1

- FINDING-044 / NEED-003 / Helper 失控、OS 句柄持续非零或不可查 / §4、§7–§9 / 红色告警存在但麦克风可能仍活动，用户无法完成“立即停止” / 扣 5 分 / 定义强停升级链：终止捕获进程与音频会话、按 PID/句柄权威复核；仍不可证实时唯一主动作打开系统麦克风权限并明确要求撤销，绝不显示已停止；覆盖每级失败注入。

### P2

- FINDING-045 / NEED-004 / UNKNOWN 到期封存 / §7、§8 / “已安全封存”可能被理解为原任务已停止 / 扣 1 分 / 改为“已停止自动重试；原任务结果仍未知，可能已经执行”，主动作按能力为“核对可见结果”或“请求权威核验”。

### P3

- FINDING-046 / NEED-007 / 首次按 Option+Space / §5、§6 / 建议与录音同时出现，可能先猜后看 / 扣 1 分 / 首次非阻塞突出当前页建议，可播报且允许抢话，不增加点击；5 人至少4人在首次发声前理解一条建议。

## Must fix

1. 为停录失败补可执行的系统级终止、权威复核和权限撤销兜底。
2. 消除“安全封存”对副作用已停止的暗示。
3. 让首次建议在不阻断语音的前提下先被理解。

## Remaining risks

- 长期 UNKNOWN 锁是用户选择 A 的安全代价；只允许权威隔离后的任务继续，不以吞吐换重发风险。
- 真实高频样本与 macOS 句柄时序仍需实测；此前只能标合成基准，不构成设计证据阻断。
