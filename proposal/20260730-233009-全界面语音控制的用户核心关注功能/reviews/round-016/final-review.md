# Final Proposal Review

- Verdict：REVISE
- Design revision：R016
- Design SHA-256：04906fb0461bb5d09fd072cb9824cb8849eb48b5e06c2585cc4d1d1b05524c76
- Confidence：MEDIUM（独立裁决 Agent 连续两个窗口超时，按 rubric 串行降级）
- User Panel score：63/80
- Independent score：14/20
- Final score：77/100

## Inputs

- round-016 manifest、needs、R016 design、三份 E4 盲评、匿名议题与 panel score；设计哈希一致，画像/反馈无漂移。

## Hard gates

- NEED-002/003/004 仍有实现可得到两种结果的机器冲突：及时 ACK 与非零句柄、未统一的请求状态枚举、dispatch 最后窗口的目标/权限版本，以及陈旧 scope。
- 同根问题已合并，不重复扣分；无用户价值分歧或证据阻塞。

## Need coverage

| Need | Priority | Result |
| --- | --- | --- |
| NEED-001 | MUST | 证据分层成立；重启后增量事件续显仍缺断言 |
| NEED-002 | MUST | 原 request 幂等方向成立；提交竞态与唯一状态枚举未闭环 |
| NEED-003 | MUST | 故障态保守；及时 ACK+句柄非零存在冲突 |
| NEED-004 | MUST | UNKNOWN 不重发成立；scope 权威性和取消/reconciliation 全排列未闭环 |
| NEED-005 | MUST | 核心语音决策路径成立 |
| NEED-006 | SHOULD | 连续队列成立；效率计时边界与“有效提升”未确定 |
| NEED-007 | SHOULD | 四类方向成立；手动与不支持仍难区分 |

## User Panel synthesis

| Dimension | Max | Score |
| --- | ---: | ---: |
| Core need and pain resolution | 30 | 25 |
| Journey effectiveness and efficiency | 18 | 14 |
| Understanding, expectation and feedback | 12 | 9 |
| Control, recovery and trust | 12 | 8 |
| Accessibility and context fit | 8 | 7 |

## Independent completeness

| Dimension | Max | Score |
| --- | ---: | ---: |
| 对象与规则 | 4 | 2 |
| IA 与职责 | 3 | 2 |
| 流程与恢复 | 5 | 3 |
| 质量下界 | 3 | 2 |
| 追踪 | 5 | 5 |

## Findings

### P1

- FINDING-018 / NEED-003 / 停录 ACK 与 OS 句柄 / §4、§8、§9 / 及时 ACK 但句柄非零时，owner 可能被提前释放并出现双录音 / OS 句柄归零必须是唯一释放条件；ACK 只表示 Helper 已受理。补及时 ACK+句柄非零的故障测试。
- FINDING-019 / NEED-002、004 / 请求状态与取消仲裁 / §4、§8 / PREPARED、DELIVERY_FAILED、TERMINAL_NOT_EXECUTED、VERIFIED 与既有枚举不统一，取消/reconciliation 的反向顺序不全 / 定义唯一持久状态枚举和事件迁移总表，覆盖 VERIFIED→cancel、cancel→NOT_EXECUTED、cancel→UNKNOWN，明确 revision 与锁。
- FINDING-020 / NEED-002、004、006 / target、permission 与 EffectScope 权威快照 / §4、§8、§9 / 重解析后至执行提交仍可失权；祖先信息陈旧、缺失或共享时可能误放行 / dispatchProof 必须携带执行端条件提交所校验的 targetVersion、permissionVersion、scopeVersion；无法证明 scope 隔离时按 GLOBAL 锁定。

### P2

- FINDING-021 / NEED-004、007 / 首次边界与未知阻塞解释 / §5、§7、§9 / 用户可能把“不支持”误认为可手动完成，也看不懂哪项为何被 UNKNOWN 阻塞 / 增加明确不支持示例；逐条用对象名称说明被谁阻塞或可继续的原因，并加入首次理解标准答案。
- FINDING-022 / NEED-006 / 效率基准 / §9 / `≤` 鼠标且起止点未固定，无法证明连续语音有效提效 / 同操作者、同任务同后置条件，从首次唤起计至第五星 VERIFIED；要求语音中位数严格小于鼠标并保存原始值。
- FINDING-023 / NEED-001、004、006 / Agent 重启后的增量续显 / §6、§8、§9 / 当前脚本只保证恢复 sequence=2 快照，未证明 sequence=3 和最终 receipt 继续进入原卡 / 增加新序列、乱序旧序列和终态 receipt；原 request 更新、sequence 不倒退、dispatch=1。

## Must fix

1. 以 OS 句柄归零作为 owner 唯一释放条件，并补及时 ACK+句柄非零测试。
2. 给出唯一持久状态枚举与全事件迁移表，消除 VERIFIED/SUCCEEDED 等双命名和取消排列空洞。
3. 将 target/permission/scope 版本纳入执行端条件提交；不确定隔离时保守锁定。
4. 补足首次边界、UNKNOWN 阻塞解释、严格效率基准和重启增量续显断言。

## Remaining risks

- 真实 macOS 句柄探测、执行端条件提交和 Agent receipt 能力仍需实现验证；设计层可以先把安全默认与可验收边界定死。
