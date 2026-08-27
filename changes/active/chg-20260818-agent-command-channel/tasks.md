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
coverage_gate: ready_for_implementation
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
- [x] `CONFIRM-02` owner: user｜依赖：`DISC-MERGE-02`｜执行：conversation｜2026-08-27 用户要求先基于事实统一，并直接产出可交付 Terra 的 spec/TODO；Decision Brief 与三个建议默认选择据此转为 accepted。
- [x] `SPEC-02` owner: main_agent｜依赖：`CONFIRM-02`｜写入：change package｜已冻结 `design.md`、`technical.md`、`protocol-v1.md`、`acceptance.md`，明确产品行为、数据/IPC/状态机、网站线协议、错误码和门禁。
- [x] `SYNC-02` owner: main_agent｜依赖：`SPEC-02`｜写入：`prd/**`、`TODO.md`、change package｜已同步 Revision 2 planned 状态、正式 GWT、根 TODO 与 Terra work orders；未写业务代码。
- [x] `PLAN-TERRA-02` owner: main_agent｜依赖：`SPEC-02`｜写入：`work-orders/**`｜已拆成 13 个串行/依赖明确的 work order，每单含 read/write allowlist、步骤、测试、完成/停止条件。

### Revision 2 实现 Work Orders（均未开工）

- [ ] `M0-01` owner: implementation_engineer｜依赖：`SYNC-02`｜任务单：`work-orders/M0-01-contracts-runner-sink.md`｜共享合同、纯 reducer、runner event sink。
- [ ] `M0-02` owner: implementation_engineer｜依赖：`M0-01`｜任务单：`work-orders/M0-02-main-chat-broker.md`｜Main broker、single writer、run/prompt 路由。
- [ ] `M0-03` owner: implementation_engineer｜依赖：`M0-02`｜任务单：`work-orders/M0-03-ipc-permission-capability.md`｜typed IPC、sender capability、app-global permission。
- [ ] `M0-04` owner: implementation_engineer｜依赖：`M0-03`｜任务单：`work-orders/M0-04-project-chat-window.md`｜每项目唯一窗口与 view state。
- [ ] `M0-05` owner: implementation_engineer｜依赖：`M0-04`｜任务单：`work-orders/M0-05-renderer-cutover.md`｜主窗口 snapshot 投影、封闭 renderer durable writer。
- [ ] `M0-06` owner: implementation_engineer｜依赖：`M0-05`｜任务单：`work-orders/M0-06-project-window-command-channel.md`｜完整项目窗口、Revision 1 通道迁移；完成后执行 M0 Gate。
- [ ] `M1-01` owner: implementation_engineer｜依赖：`M0-06`｜任务单：`work-orders/M1-01-binding-protocol-stores.md`｜protocol parser、Binding/receipt stores。
- [ ] `M1-02` owner: implementation_engineer｜依赖：`M1-01`｜任务单：`work-orders/M1-02-deep-link-ticket.md`｜cold/warm deep link、HTTPS Ticket、外部任务提交。
- [ ] `M1-03` owner: implementation_engineer｜依赖：`M1-02`｜任务单：`work-orders/M1-03-pairing-settings-focus.md`｜配对/连接管理 UI 与新任务焦点规则。
- [ ] `M1A-01` owner: implementation_engineer｜依赖：`M1-02`｜任务单：`work-orders/M1A-01-preview-capture.md`｜Preview 窄捕获与安全隔离。
- [ ] `M2-01` owner: implementation_engineer｜依赖：`M0-06`｜任务单：`work-orders/M2-01-runtime-edit-coordinator.md`｜edit lease、mutation、settle generation。
- [ ] `M2-02` owner: implementation_engineer｜依赖：`M2-01`｜任务单：`work-orders/M2-02-runtime-ui-integration.md`｜接入 Runtime/last-good 与状态 UI。
- [ ] `CHECK-02` owner: quality_verifier｜依赖：`M1-03`、`M1A-01`、`M2-02`｜任务单：`work-orders/CHECK-02-development-check.md`｜执行独立 Development Check；仅在用户另行明确授权时进入正式验收。

## Revision 1 已完成基线

- [x] `ACC-01` owner: main_agent｜固化应用内全局通道范围、非目标和 ATDD 契约。
- [x] `IMP-01` owner: main_agent（串行 implementation_engineer 职责）｜实现通道、非激活线程创建与 Chat Run 状态桥接。
- [x] `TST-01` owner: main_agent（串行 quality check 职责）｜覆盖核心状态与 Workspace Session 边界。
- [x] `SYNC-01` owner: main_agent｜同步相同通道代码到 `IntelligentOS-APP` 并接入选题入口。
- [x] `CHK-01` owner: main_agent｜运行双仓库 Codex 自检并记录剩余风险。
- [ ] `VER-01` owner: project-verify｜状态：未执行；不声明正式通过，风险并入 Revision 2 后续验证计划。
