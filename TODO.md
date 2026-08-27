# AgentOS TODO

> 继续开发入口。产品验收契约只在对应 `prd/<module>/acceptance.md` 定义；TODO 不复制 GWT 场景，也不因代码自检自动勾选。
>
> 勾选图例：`[x]` 已完成且有证据；`[~]` 实现已落盘并通过自动化检查，仅卡在正式验收证据，**不是待开工**；`[ ]` 未开工或未决。

## 1. 活跃变更

### 1.1 Agent 指令通道与独立项目 Chat 窗口（Revision 2）— Spec 已冻结，待开发

- **Change**：[`chg-20260818-agent-command-channel`](changes/active/chg-20260818-agent-command-channel/proposal.md)
- **产品规格**：[`design.md`](changes/active/chg-20260818-agent-command-channel/design.md)
- **技术规格**：[`technical.md`](changes/active/chg-20260818-agent-command-channel/technical.md)
- **网站协议**：[`protocol-v1.md`](changes/active/chg-20260818-agent-command-channel/protocol-v1.md)
- **验收计划**：[`acceptance.md`](changes/active/chg-20260818-agent-command-channel/acceptance.md)；正式 GWT 唯一事实源为 [`prd/chat-agent-runtime/acceptance.md`](prd/chat-agent-runtime/acceptance.md)
- **Terra 执行入口**：[`work-orders/README.md`](changes/active/chg-20260818-agent-command-channel/work-orders/README.md)
- **当前状态**：M0-01–M0-05D 已实现并通过独立门禁；typed IPC/capability/permission/window/view-state/runtime services 均仍是 disabled seam，尚未接入 production Main/UI。剩余前置固定为 M0-05E prompt/rewind 与 M0-05F default-off composition，之后立即执行 renderer cutover；权限 v1 为 app-global、Main 权威。

#### M0：必须串行，先建立共享 Chat 事实源

- [x] `M0-01`｜共享合同、唯一纯 reducer、Claude runner event sink 与 WebContents 迁移 adapter；独立复跑 typecheck、目标测试 16/16、diff check 均 PASS。
- [x] `M0-02`｜Main-owned ProjectChatBroker core、workspace single writer、run/prompt 路由；独立复跑 typecheck、目标测试 46/46、diff check 均 PASS，尚未 production wiring。
- [x] `M0-03`｜typed IPC、sender/frame/project capability、Main app-global permission disabled seam；独立复跑 typecheck、目标测试 38/38、diff check 均 PASS，未注册 production handler。
- [x] `M0-04`｜每项目唯一 Project Chat Window manager、scoped profile 参数与原子 view-state disabled seam；独立复跑 typecheck、目标测试 40/40、diff check 均 PASS。
- [x] `M0-05A`｜收窄 project-window preload profile；补齐脱敏模型/context/文件/附件/status typed capabilities与安全 thread snapshot；独立复跑 typecheck、目标测试 38/38、diff check 均 PASS，仍未 production wiring。
- [x] `M0-05B`｜fork/edit-resubmit/archive/pin/model/diff-review 已收进 broker intent；独立复跑 typecheck、目标测试 49/49、diff check 均 PASS，仍未 production wiring。
- [x] `M0-05C`｜broker 与现有 Main workspace mutations 已共用唯一 operation coordinator；独立复跑目标测试 61/61、完整 Electron 199/199、typecheck 与 diff check 均 PASS，仍未 production wiring。
- [x] `M0-05D`｜真实 runner adapter、durable scoped read services、附件 realpath/symlink containment；独立复跑目标测试 53/53、完整 Electron 204/204、typecheck 与 diff check 均 PASS，仍未 production wiring。
- [x] `M0-05E`｜Main-owned presence/prompt owner、broker-owned rewind；Terra 回报 typecheck、目标 73/73、完整 Electron 210/210、diff check 均 PASS；按用户指示不再重复验证。
- [ ] `M0-05F`｜default-off production composition，原子收口 TaskHome/sink/handler 与 feature flag。
- [ ] `M0-05`｜M0-05F 后立即做主窗口 snapshot 投影、封闭 renderer full-snapshot writer。
- [ ] `M0-06`｜完整独立项目 Chat UI、Revision 1 `agentCommandChannel` 迁移、双窗口 M0 Gate。
- [~] `M3-01`｜Workspace Tab durable backing Project：Main-only tab-id Chat API、canonical path repair/lazy backfill、重复 root 去重与安全 sender 负例；实现与目标自动化检查已提交本轮门禁，正式验收待独立证据。

#### M1：网站入口（M0 Gate 后）

- [ ] `M1-01`｜严格 protocol parser、safeStorage Binding、幂等 receipt stores。
- [ ] `M1-02`｜mac/argv cold-warm deep link、固定 HTTPS Ticket、accepted/rejected 回执与提交线性化。
- [ ] `M1-03`｜配对对话框、Settings 网站连接、新任务不打断/徽标规则。
- [ ] `M1A-01`｜Preview 窄 deep-link 捕获；保持无 preload/Node/Chat IPC。

#### M2：Agent 修改期 Runtime 收口（M0 Gate 后，可与 M1 前半并行）

- [ ] `M2-01`｜可靠 before-tool lease/actual Diff、potential runs、三条件 settle、generation fence。
- [ ] `M2-02`｜接入现有 Runtime：静态自动 build/last-good、development-only、失败/取消回退与双 Host 状态。

#### 验证门禁

- [ ] `CHECK-02`｜全部 work order 完成后执行独立 Development Check；必须覆盖单 writer、同 thread busy、secret/IPC/deep-link 安全负例、幂等、窗口关闭、prompt owner、Runtime generation/last-good 和现有 Chat/Runtime 回归。
- [ ] 正式 Acceptance｜仅在用户另行授权后逐条验证 `ATDD-CHAT-201`–`ATDD-A11Y-201`；Development Check PASS 不自动等于正式验收。

### 1.2 Workspace Tab 与可复用 Runtime（Revision 5）— 已关闭

- **Change**：[`chg-20260825-local-app-tabs-runtime`](changes/archive/2026/chg-20260825-local-app-tabs-runtime/proposal.md)（已归档）
- **PRD**：[`prd/local-app-runtime/README.md`](prd/local-app-runtime/README.md)
- **验收契约**：[`prd/local-app-runtime/acceptance.md`](prd/local-app-runtime/acceptance.md)
- **当前状态**：2026-08-27 按用户指示关闭，`delivery=done`、`coverage_gate=degraded`。关闭前实跑 `npm run typecheck`（PASS）、`npm run test:electron`（147/147）、homepage `npm run build`（PASS，104 个 HTML）。
- **关闭时的已知缺口**（详见归档包 `evidence.md` 的“关闭记录”）：Revision 5 的独立 Development Check 未执行；`R-UI-HEIGHT-01` / `R-UI-FLOW-01` 两条 GUI smoke 未执行，首页布局返工 attempt 3 的视觉回归无人复核；`project-verify` 仍为 `BLOCKED`。**Change 关闭不等于产品正式验收。**

#### Revision 4 当前开发

- [x] `DEV-P0-05`｜把静态项目默认打开路径改为直接加载 last-good 构建，不启动常驻 npm/Next 进程；实现手动构建、stale/失败回退、静态协议安全边界与显式 dev fallback，并把 CodeNow Wiki 改为可静态导出。来源：`C-010`–`C-012`。
- [x] `CHECK-P0-04`｜对静态零 spawn、固定构建命令、路径/符号链接隔离、last-good/late event、dev fallback 和 CodeNow Wiki 导出执行独立 Development Check；结果 PASS，不修改正式 Acceptance 状态。

#### Revision 2 当前开发

- [x] `DEV-P0-04`｜将 Local App 用户概念迁移为 Workspace Tab/Runtime；实现自定义命名与重命名、右键/键盘菜单关闭、Tabs 位于新对话/搜索上方、schema v3 迁移、项目首页 `Overview / Runtime` 双系统、Runtime 多 host 与独立 PreviewSession。来源：`C-006`–`C-009`。
- [x] `CHECK-P0-02`｜独立检查迁移安全、Main 权威写入、Tab 交互、首页两套系统隔离、consumer/release 和 late event；第三轮 Development Check 为 PASS，不修改正式 Acceptance 状态。

> 下列开发项的实现已经落盘并通过自动化检查；根据本文件门禁，在 6 个真实 Electron 端到端证据补齐、Acceptance 全部通过前暂不勾选或归档。

#### P0：用户可见闭环

- [~] `DEV-P0-01`｜实现 Local App Definition/Tab、侧栏 `New Tab`、首次目录选择与信任确认、创建/激活/关闭及旧快照迁移。来源：`C-001`；验收：`ATDD-P0-01`。
- [~] `DEV-P0-02`｜实现 AgentOS 自动依赖准备、`npm run dev`、动态 readiness、运行状态、日志、重试、停止和进程回收基础。来源：`C-002`；验收：`ATDD-P0-02`。
- [~] `DEV-P0-03`｜以 `/Volumes/macOS/Github/codenow.wiki` 做首个真实接入，确认 `next dev` 自动启动和页面预览，不硬编码路径以外的产品逻辑或端口。来源：`C-003`；验收：`ATDD-P0-03`。

#### P1：交付前必要正确性

- [~] `DEV-P1-01`｜实现 Tab/Runtime/Preview 分离、同应用 Runtime 复用、AgentOS 恢复后自动启动、generation 防迟到事件和退出时进程树清理。来源：`C-004`；验收：`ATDD-P1-01`。
- [~] `DEV-P1-02`｜实现独立无 Node Preview、HMR/刷新/重启、导航/弹窗/权限限制和安全负例测试。来源：`C-005`；验收：`ATDD-P1-02`。

#### 实施门禁

- [ ] 实现前冻结首期 `TrustedLocalProcessAdapter` 的安全文案与环境变量 allowlist；不得把它描述为生产级 OS 沙箱。
- [ ] 为 Local App writer 任务分配精确代码路径、diff 基线和唯一实现者；实现后按风险触发开发质量检查。
- [ ] CodeNow Wiki live smoke 需要实际启动外部项目时，单独执行并保留真实日志/页面证据；fixture 不得替代。

## 2. 未排期 Backlog

> 不属于任何 active change。来自 `chg-20260825-local-app-tabs-runtime` 关闭时迁出。

- [ ] `LATER-02`｜Claude Agent SDK 通过通用 SandboxBroker 在项目运行时中读写、安装依赖和控制进程。
- [ ] `LATER-03`｜确定并实现生产级跨平台 Sandbox Provider；完成项目外文件、网络、环境变量和子进程逃逸验证后再声明强隔离。
- [ ] `PERF-P2-PID-REUSE-001`（P2）｜测试 fixture 的异常兜底在极窄窗口按刚写入的裸 PID 发 TERM/KILL，理论上存在 PID 复用误杀。生产 Runtime 清理路径不受影响。来源：`chg-20260825-local-app-tabs-runtime` PERF 轮质量检查。
- [ ] `GUI-REG-01`｜补 `R-UI-HEIGHT-01` / `R-UI-FLOW-01` 的 Electron GUI smoke：Workspace Runtime 全高预览、Overview/Runtime 常规与窄宽度布局。首页布局返工 attempt 3 至今只有 typecheck 覆盖。

> `LATER-01` 已被 Revision 2 的“项目首页独立 Runtime 页”取代，不再跟踪。

## 3. 验证与文档状态

- [x] 业务实现完成后进入 `project-verify`，由独立 `quality_verifier` 逐条验证 `prd/local-app-runtime/acceptance.md`（2026-08-25 首轮：10/16 通过、6/16 待补证据、0 失败）。
- [ ] 正式验收通过后，才能把 Acceptance 标记为正式通过并更新模块总体验收状态；已实现的 Revision 4 开发事实已同步为 Current/as-built。
