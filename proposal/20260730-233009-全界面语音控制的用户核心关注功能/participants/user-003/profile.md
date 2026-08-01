# Participant Profile

- Participant ID: user-003
- Evidence level: E4 SIMULATED
- Lens: 中断与失败恢复：关注误识别、权限、重复执行、取消和录音可见性
- Product goal: 可靠地用语音控制界面，不因故障失去控制
- Trigger and context: 误识别、权限、网络/Provider 或跨窗口中断
- Entry point: 快捷键或托盘进入录音与执行流程
- Existing knowledge: 只依据当前反馈判断系统状态
- Constraints: 需要失败可恢复、取消生效、不重复执行、录音状态明确
- Success definition: 能看见当前状态，安全退出，并从失败点继续
- Most sensitive pain points: 错误被覆盖、迟到事件回落、隐藏后仍录音、重复提交
- Relevant NEED candidates: 可感知状态、可撤回、幂等执行、跨窗一致恢复
- Out-of-scope assumptions: 不推断人口学、辅助能力、真实发生率或长期承诺
