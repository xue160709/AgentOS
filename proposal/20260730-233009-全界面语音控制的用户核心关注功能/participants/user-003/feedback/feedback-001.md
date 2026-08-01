# Feedback

- Participant ID: user-003
- Evidence level: E4 SIMULATED
- Created at: 2026-07-30T23:34:50+08:00

## Content

# Participant Feedback

- Participant ID: user-003
- Mode: INITIAL_FEEDBACK
- Evidence level: E4 SIMULATED；项目现状引用为 E2 PROJECT_FACT

## Journey

| Stage | Goal | Seen/understood | Action | Possible thought | Friction | Consequence |
| --- | --- | --- | --- | --- | --- | --- |
| 入口 | 确认录音 | 快捷键/托盘开窗（E2） | 先辨状态 | “隐藏时别继续录音”（E4） | 隐藏不停止录音 | 失去控制感 |
| 误识别 | 修正再交付 | 可编辑 final（E2） | 改错后提交 | “错误要留着”（E4） | 错误可能被 idle 覆盖 | 无法复盘 |
| 权限/Helper 失败 | 从失败点续 | 仍待实机验收（E2） | 修复后重试 | “失败别伪装成空闲”（E4） | 状态被覆盖 | 不知能否重试 |
| 超时/取消 | 安全停止 | 可久停执行中、可重复提交（E2） | 取消且不重发 | “取消必须真停”（E4） | 防重与取消不明 | 重复副作用 |
| 关闭/重开 | 隔离旧任务 | 旧窗未 cancel、迟到事件风险（E2） | 核对任务归属 | “旧结果别闯进新窗”（E4） | 跨窗恢复不可信 | 错绑上下文 |
| 结果 | 确认真完成 | 路由审计不证明完成（E2） | 核对动作结果 | “已路由不等于已办完”（E4） | 外部副作用未验 | 不敢信任 |

## Pain points

1. 录音不可见→隐私风险→状态持续可感知→隐藏/关闭后确认停录。
2. 错误被覆盖→丢失恢复点→保留错误与上下文→重试从原失败点开始。
3. 取消/重复提交不明→重复副作用→取消生效且幂等→仅产生一次结果。
4. 迟到事件跨窗→新任务被污染→旧事件隔离→重开后无旧结果回落。
5. 路由冒充完成→误判成功→提供可核对结果→动作与实际状态一致。

## Preference only

- 优先可撤回、状态连续和结果可信，其次才是更快执行。（E4）

## Unknown

- 真实权限/Helper 恢复时序。
- 取消是否终止下游任务。
- 跨窗迟到事件是否实机发生。
- 外部应用结果如何核验。
