---
change_id: chg-20260818-agent-command-channel
revision: 5
change_type: product
status: implementing
confirmation_source: explicit_user_statement
aligned_at: 2026-09-28
verify_policy: none
---

# Product — chg-20260818-agent-command-channel

> 容器迁移说明（2026-08-31）：本 change 建立早于 `product.md` 容器约定，产品事实与确认记录原生保存在 [`proposal.md`](proposal.md)（frontmatter + 已确认范围表）。本文件由 `product-spec` 从该来源同步建立，**不新增任何产品事实**；`exploration.md` 为 2026-08-31 追加的证据附录（§5 用户证据，全部 `agent_proposal`），不属于对齐草稿、不改变已确认范围。

## Product Delta（指针，不复制正文）

- Revision 3 已确认范围：`C-RDS-301`–`C-RDS-309`（Runtime 专用开发会话、双域独立、"用 AI 修改"/"结束修改"、last-good 收口）——见 [`proposal.md`](proposal.md) `confirmed_scope`。
- Revision 4 已确认范围：`C-RSM-401`–`C-RSM-407`（伺服模式四档探测、结论可见可覆盖、双段状态、浏览态不占执行资源）——见 [`proposal.md`](proposal.md) `confirmed_scope_r4` 与正文表格。
- Revision 5 已确认范围：`C-RSM-501`–`C-RSM-506`（入口统一走阶梯、源码更新自动重建与触发时机、工作台零按钮与菜单精简、预览自动呈现与失败说真话）——见 [`proposal.md`](proposal.md) `confirmed_scope_r5` 与 Revision 5 表格；证据见 [`exploration.md`](exploration.md) §4、§5.7、§5.8 与 [`Paintpoints.md`](Paintpoints.md)。
- 确认来源：2026-08-30 用户对话确认（`explicit_user_statement`，逐条记录于 proposal.md 表格与 [`tasks.md`](tasks.md) CONFIRM-* 条目）；Revision 5 为 2026-09-28 用户对话确认（`explicit_user_statement`）。

## 完成定义（Revision 5）

小白新建工作台打开任意可运行的本地网页项目（含 Next.js SSR）后，不需要点任何按钮就能看到页面；改了源码后，按 `C-RSM-503` 的时机再看就是新版本，失败时保留旧版并给出真实原因和一个恢复动作。工作台正常态与侧栏菜单不出现构建、重启、停止等机制操作。

## 非目标

- Revision 5：不限制服务端伺服的局域网可访问性（用户裁决为预期行为）；不新增让用户选择静态/服务端模式的开关；不引入文件实时监听。

见 [`proposal.md`](proposal.md) 各 Revision 的"非目标/冲突处置"节（含对 `ATDD-EDIT-206` 的显式放宽边界、v1 不实现并发写入安全合同）。

## 正式 Spec 与 Acceptance 指针

- 冻结设计与技术合同：[`design.md`](design.md)、[`technical.md`](technical.md)、[`protocol-v1.md`](protocol-v1.md)。
- 验收契约：本 change [`acceptance.md`](acceptance.md)（ATDD-RDS-3xx / ATDD-RSM-4xx）；正式模块 GWT 见 [`prd/local-app-runtime/acceptance.md`](../../../prd/local-app-runtime/acceptance.md)。
- 实施状态：`delivery: in_progress`，任务与验证记录见 [`tasks.md`](tasks.md) 与 [`work-orders/`](work-orders/)。

## 风险与未决

- 正式 GUI 验收未全量执行（开发检查 ≠ 正式 Acceptance，详见 proposal/tasks 各 SMOKE 条目）。
- 2026-08-31 用户视角评审（[`exploration.md`](exploration.md) §5）发现 F1–F11 体验缺口（均为 `agent_proposal` 候选），其中 F4/F5 与已确认合同（`C-RSM-404/405`、design.md opening 承诺）存在实现差距；是否纳入修复范围待用户决策。
- Revision 5 风险：服务端档重建期间页面可见但交互可能失效（停服构建）；大项目自动重建占用 CPU；`Q-R5-01 [ASSUMED]` 探测结论与覆盖入口移入「查看 Runtime」详情，可推翻。
