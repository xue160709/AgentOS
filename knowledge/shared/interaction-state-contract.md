# 交互状态契约

## 适用范围

适用于 `02` 的交互/验收规划、`03` 的异步实现与 `update-prd` 的已实现行为整理，尤其适用于多步骤、可取消、需等待外部回调或会切换视图的流程。本文提炼状态不变量，不复制原 Skill 的审查脚本或输出模板。

## 最小状态覆盖

每条异步或多步骤旅程至少要能说明开始、进行中、成功、失败、取消和超时；涉及权限或用户确认时补充等待状态，涉及提交和后台处理时区分提交中与运行中。每个状态都要有进入事件、退出条件、用户可见反馈和可执行动作。

## 状态不变量

- 提交/确认构成事务边界；重复触发、提交中再次提交和提交中取消都要有明确语义。
- UI state、内部 ref、draft/selection、计时器、监听器和外部请求的清理或保留必须一致。
- 每个异步回调都要绑定 session/request/generation 等作用域，或具备可取消机制；late event 不能写回新请求、新线程、新路由或已卸载视图。
- 取消必须使旧任务和旧回调失效，不能只把按钮或弹窗改回初始外观。
- loading、disabled、status text、aria-label 与真实可执行动作一致；乐观更新必须有失败反馈、回滚或重试路径。
- 输入框、焦点、selection/caret、draft 和 autocomplete 的目标必须明确；辅助按钮触发异步写入后，后续键盘/IME 输入仍应进入产品定义的输入目标。

## 常见风险族

| 风险族 | 审查重点 |
|---|---|
| state/ref 不一致 | 视图显示已清理，但 ref、selection 或旧实体仍被回调使用。 |
| 旧事件污染新状态 | submit、cancel、切页或切换对象后，旧 partial/final/progress 继续更新当前界面。 |
| 取消不彻底 | abort、timer、listener、permission waiter 或临时 draft 仍然存活。 |
| 焦点所有权漂移 | 辅助按钮抢焦点，或关闭弹窗后焦点落到失效控件；异步文本写入错误 draft/range。 |
| 可见状态打架 | Header、Toast、按钮、Sidebar 或 aria 文案分别描述不同阶段。 |
| 乐观更新无恢复 | 网络/IPC/权限失败后没有保留输入、错误反馈或重试入口。 |

## 验收与证据

交互验收应覆盖至少一条竞态或 late-event 路径，并验证状态文案、按钮、焦点、selection 和输入恢复；无法自动化时提供明确的手工步骤。审查或验收记录应说明事件顺序、用户可见症状、复现路径、期望/实际行为、证据和未覆盖的设备/权限/网络条件。

## 本轮来源

本轮只读提炼日期：2026-08-16。来源：`/Volumes/macOS/Github/CodeNow/.codex/skills/interaction-flow-review/SKILL.md`、`/Volumes/macOS/Github/CodeNow/.codex/skills/interaction-flow-review/references/async-state-smells.md`、`/Volumes/macOS/Github/CodeNow/.codex/skills/interaction-flow-review/references/acceptance-scenarios.md`、`/Volumes/macOS/Github/CodeNow/.codex/rules/acceptance-contract.md`、`/Volumes/macOS/Github/CodeNow/.codex/rules/verification-levels.md`。源中的 Skill、脚本、测试模板和代码未迁入当前项目。

