---
change_id: chg-20260818-agent-command-channel
revision: 2
task_level: Heavy
level_basis: "网站授权与身份边界、跨窗口共享会话、平台 deep link、主进程协调和预览 Runtime 跨模块契约"
professional_gaps:
  - product_scope
  - experience_flow
  - technical_contract
role_plan:
  - product_manager
  - experience_designer
  - technical_architect
not_needed:
  - user_researcher: "用户目标与关键选择已有明确陈述，本轮不虚构额外用户证据"
  - market_researcher: "这是现有产品的本地运行时扩展，不依赖市场事实"
  - visual_interface_designer: "独立窗口严格复用现有 Chatbot，本轮只设计流程和状态"
  - quality_verifier: "语义冻结和实现完成后再进入风险检查；用户尚未发起正式验收"
confirmation: user_confirmed_discovery
acceptance_requested: false
coverage_gate: in_progress
---

# Revision 2 Tasks

## 实时预览交互优化（2026-08-27）

- [x] `CONFIRM-RUNTIME-02` owner: user｜依赖：`DISC-MERGE-02`｜执行：conversation｜用户确认“静态项目只在修改期间自动进入实时预览，全部项目修改任务结束后自动生成已保存预览；日常界面不再直接出现开发模式和重启”，并要求优化方案。
- [x] `DISC-UX-RUNTIME-02` owner: experience_designer｜依赖：`CONFIRM-RUNTIME-02`｜执行：response_only｜已返回两类入口、Chat 触发、双 host、状态文案、焦点、结果矩阵和失败恢复 Product Design Pack。
- [x] `DISC-ARCH-RUNTIME-02` owner: technical_architect｜依赖：`CONFIRM-RUNTIME-02`｜执行：response_only｜已返回 edit lease、变化分类、HMR/soft reload/recovery、final settle、generation fence 与 Rev5 兼容合同。
- [x] `DISC-MERGE-RUNTIME-02` owner: main_agent｜依赖：`DISC-UX-RUNTIME-02`、`DISC-ARCH-RUNTIME-02`｜写入：`proposal.md`、`evidence.md`｜已合并开发级实时预览状态合同，失败/取消不自动保存半成品；未写业务代码或正式 PRD。
- [x] `CONFIRM-CONCURRENCY-02` owner: user｜依赖：`DISC-MERGE-RUNTIME-02`｜执行：conversation｜用户选择 B：同一项目允许多个 Agent 会话并行修改，跨项目仍可并行；协议不采用静默后写覆盖。
- [x] `DISC-UX-CONCURRENCY-02` owner: experience_designer｜依赖：`CONFIRM-CONCURRENCY-02`｜执行：response_only｜已返回同项目多会话汇总、共享预览、自动处理冲突、局部暂停、恢复文案与无障碍状态合同。
- [x] `DISC-ARCH-CONCURRENCY-02` owner: technical_architect｜依赖：`CONFIRM-CONCURRENCY-02`｜执行：response_only｜已返回 Main-owned MutationCoordinator、文件级 optimistic guard、未知写入边界、共享 Runtime 与 settle/build fence。
- [x] `DISC-MERGE-CONCURRENCY-02` owner: main_agent｜依赖：`DISC-UX-CONCURRENCY-02`、`DISC-ARCH-CONCURRENCY-02`｜写入：`proposal.md`、`evidence.md`｜已把用户选择 B 合并为开发级并发状态合同；未写业务代码、正式 PRD 或 ADR。

- [x] `DISC-PM-02` owner: product_manager｜依赖：无｜执行：response_only｜已返回产品对象、范围、授权、终态和 3 个候选决策；结果为 `agent_proposal`，待主 Agent 合并与用户确认。
- [x] `DISC-UX-02` owner: experience_designer｜依赖：`DISC-PM-02`｜执行：response_only｜已返回 Product Design Pack，覆盖词汇、主旅程、窗口职责、完整状态、无障碍和恢复路径；结果待主 Agent 合并与用户确认。
- [x] `DISC-ARCH-02` owner: technical_architect｜依赖：`DISC-PM-02`｜执行：response_only｜已返回 Main broker、deep link/ticket、binding、跨窗口 fence、Runtime settle、平台打包与回滚架构草案。
- [x] `DISC-MERGE-02` owner: main_agent｜依赖：`DISC-UX-02`、`DISC-ARCH-02`｜写入：`proposal.md`、`evidence.md`｜已合并 Decision Brief，解决网站 issuer、窗口打断、双结果状态和单 writer 边界。
- [x] `TRIM-CONCURRENCY-02` owner: user + main_agent｜依赖：`DISC-MERGE-CONCURRENCY-02`｜写入：`proposal.md`、`evidence.md`｜用户确认删除并发写入安全合同；已移除 `MutationCoordinator`、path lock、版本校验、写后校验、冲突重放与变化归因，收口前置条件压缩为三条，保留“多会话可并行”与“未终态不显示预览已更新”。
- [ ] `CONFIRM-02` owner: user｜依赖：`DISC-MERGE-02`｜执行：conversation｜确认或修订 Decision Brief；确认前不进入正式产品合同和业务实现。
- [ ] `SYNC-02` owner: main_agent｜依赖：`CONFIRM-02`｜写入：`prd/**`、`TODO.md`、change package｜使用 update-prd 同步已确认范围、Acceptance 和实现计划。
- [ ] `DEV-02` owner: implementation_engineer｜依赖：`SYNC-02`｜写入：待架构确认后的精确 allowlist｜实现独立窗口、项目级会话协调、配对/ticket 入口及 Runtime 衔接。
- [ ] `CHECK-02` owner: quality_verifier｜依赖：`DEV-02`｜执行：V3 风险检查；仅在用户另行明确授权时进入正式验收。

## Revision 1 已完成基线

- [x] `ACC-01` owner: main_agent｜固化应用内全局通道范围、非目标和 ATDD 契约。
- [x] `IMP-01` owner: main_agent（串行 implementation_engineer 职责）｜实现通道、非激活线程创建与 Chat Run 状态桥接。
- [x] `TST-01` owner: main_agent（串行 quality check 职责）｜覆盖核心状态与 Workspace Session 边界。
- [x] `SYNC-01` owner: main_agent｜同步相同通道代码到 `IntelligentOS-APP` 并接入选题入口。
- [x] `CHK-01` owner: main_agent｜运行双仓库 Codex 自检并记录剩余风险。
- [ ] `VER-01` owner: project-verify｜状态：未执行；不声明正式通过，风险并入 Revision 2 后续验证计划。
