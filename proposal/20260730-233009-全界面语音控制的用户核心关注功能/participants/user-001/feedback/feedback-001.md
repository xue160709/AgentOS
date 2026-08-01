# Feedback

- Participant ID: user-001
- Evidence level: E4 SIMULATED
- Created at: 2026-07-30T23:34:49+08:00

## Content

# Participant Feedback

- Participant ID: user-001
- Mode: INITIAL_FEEDBACK
- Evidence level: E4 SIMULATED；项目现状引用为 E2 PROJECT_FACT

## Journey

| Stage | Goal | Seen/understood | Action | Possible thought | Friction | Consequence |
| --- | --- | --- | --- | --- | --- | --- |
| 首次进入 | 开始语音任务 | Option+Space/托盘进入命令窗（E2） | 打开窗口 | “这是全界面入口吗？”（E4） | 不懂模式、权限、范围 | 不敢开始 |
| 知道能说什么 | 判断任务是否支持 | 21 个直执行 action；语义不等于可执行（E2） | 猜一句命令 | “哪些能直接做？”（E4） | “全界面”预期与能力边界不清 | 试错成本高 |
| 发出指令 | 让系统正确接收 | 需选模式、手动录音/编辑/提交（E2） | 录音并提交 | “它听对了吗？”（E4） | 步骤多；可能重复提交 | 误操作或重复执行 |
| 确认结果 | 判断是否完成 | 直接命令、转 Agent、回答三类路由（E2） | 等待回传 | “还在做，还是卡住了？”（E4） | 状态可能被覆盖或长期执行中 | 无法信任结果 |
| 失败恢复 | 安全重试或退出 | 权限/Helper、迟到事件、录音未结束风险（E2） | 取消、修正、重试 | “重试会不会重复执行？”（E4） | 失败原因与状态不可靠 | 放弃语音 |

## Pain points

1. 能力边界不明→盲猜→先判断任务能否说→首次尝试前能正确预期路由。
2. 接收确认不足→担心听错→确认提交内容→提交前可发现并纠正误识别。
3. 执行状态不可信→重复操作→明确完成/失败→每次指令有唯一终态。
4. 失败不可安全恢复→担心副作用→可取消、修正、重试→重试不重复执行。

## Preference only

- 优先保证“范围可判断＋结果可确认＋失败可恢复”，再追求更多可说命令。（E4）

## Unknown

- 真实语音识别准确率与延迟。
- 三类路由的真实完成率。
- 权限、Helper 和跨窗口异常的实机表现。
- 用户能否理解自动、命令、聊天模式。
