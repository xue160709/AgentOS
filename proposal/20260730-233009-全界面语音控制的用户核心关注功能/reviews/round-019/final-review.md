# Final Proposal Review

- Verdict：REVISE
- Design revision：R019
- Design SHA-256：368825f8ec85038414ed2a736bbb41dabe2f3d5a86770409a9690c6ea5fa3c3a
- Confidence：MEDIUM（独立裁决 Agent 超时，按 rubric 串行降级）
- Raw Panel score：70/80
- Validated User Panel score：71/80
- Independent score：18/20
- Final score：89/100

## Inputs

- R019 design、needs、E1 A、固定画像、本轮 E4 盲评、匿名议题、panel score、manifest 与 rubric；哈希一致，无画像漂移。

## Hard gates

- SubmissionGate 以 sessionId 为键，窗口/进程重建后同一确认稿可能成为新 attempt，NEED-002 未闭环。
- 连续收音未定义系统播放音源隔离与多 request 指代仲裁，可能对错误请求产生副作用，NEED-002/004 未闭环。
- “权威源永久不可用也要释放同 scope”的扣分与 E1 A 冲突，裁决删除。

## Need coverage

| Need | Priority | Result |
| --- | --- | --- |
| NEED-001 | MUST | 结果/Agent 证据成立；多请求指代可能偏离目标 |
| NEED-002 | MUST | 同 session 幂等成立；跨 session identity 与播放音源待补 |
| NEED-003 | MUST | 句柄/强停成立；键盘入口验收待补 |
| NEED-004 | MUST | 取消、封存成立；错误记录与指代仲裁待补 |
| NEED-005 | MUST | 免手主流程成立 |
| NEED-006 | SHOULD | 连续/转交成立；调度、抢话与基准协议待补 |
| NEED-007 | SHOULD | 默认自动和路径依据成立；拒绝后替代建议待补 |

## User Panel synthesis

删除与 E1 冲突的同-scope解锁扣分后：

| Dimension | Max | Score |
| --- | ---: | ---: |
| Core need and pain resolution | 30 | 28 |
| Journey effectiveness and efficiency | 18 | 16 |
| Understanding, expectation and feedback | 12 | 10 |
| Control, recovery and trust | 12 | 10 |
| Accessibility and context fit | 8 | 7 |

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

- FINDING-032 / NEED-002、004 / 关窗、崩溃、重建 session 后重提同一确认稿 / §4、§8、§9 / sessionId 变化可绕过 SubmissionGate，产生第二 request / 将 `attemptToken` 在确认时持久化为与 session 无关的稳定身份；Gate 唯一键为 attemptToken+confirmationEpoch+draftHash，Ledger 恢复完成前禁止提交。跨窗/崩溃/并发 request/dispatch/effect=1。
- FINDING-033 / NEED-001、002、004、006 / 连续收音中的系统播报、抢话和“取消它” / §4、§6、§8、§9 / 播放音频可能入稿，歧义指代可能操作错 request / 增加音源 provenance 与 echo suppression；真人抢话先停播报。指代只允许唯一 focusedRequest、序号、名称或“上一条”；多解必须澄清，错误 request effect=0。

### P2

- FINDING-034 / NEED-003、004、006 / UNKNOWN 队列、签名核验、强停和错误历史 / §7–§9 / 安全规则存在但用户入口与不可覆盖记录不完整 / 队列按顺序扫描并跳过被锁项；恢复卡列 scope、核对/导出/签名入口和允许动作；错误记录持久化 requestId、阶段、诊断码、资格、下一步；三处强停均可键盘触达。
- FINDING-035 / NEED-001、002、004、006、007 / 首次闭环与效率基准 / §9 / 单项脚本未覆盖首次纠正恢复，鼠标对照可能有学习偏差 / 5人4人完成“识别—纠正—一次提交—终态—恢复”；语音/鼠标各五次、同热身、交叉顺序、同后置条件并保存原始值。

### P3

- FINDING-036 / NEED-001、004、007 / 拒绝、需核对和已取消卡 / §7 / 下一步和证据细节仍可更具体 / 展示相关替代、对象级核对、禁重试原因，以及取消的 target/effectHash/authority/sequence/time。

## Must fix

1. 用跨 session 持久 attemptToken 封住 request 创建前的重复窗口。
2. 定义音源隔离、抢话和多请求指代仲裁。
3. 收口队列/恢复卡/错误记录，并补首次闭环与对照基准。

## Remaining risks

- 真实回声消除、全局快捷键、OS 句柄与外部执行器签名仍需实机验证；缺少能力时按 A 降级。
