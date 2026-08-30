---
change_id: chg-20260818-agent-command-channel
revision: 3
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
confirmation: user_confirmed
acceptance_requested: false
coverage_gate: buildable
---

# Revision 3 Tasks

## Runtime 专用开发会话（2026-08-30）

- [x] `INVESTIGATE-RUNTIME-03`｜来源：用户要求从普通用户视角找项目首页与工作台 Runtime 卡点｜owner=`main_agent + REAL explorers`｜write_mode=`response_only`
  - 覆盖：项目首页定位/状态/跳转/恢复；工作台验证、模式理解、Chat、同路径对象冲突。
  - 结果：实测项目 Runtime 异步跳到 Workspace Tab；状态同时出现“运行中/启动/加载中”；工作台 Chat 绑定 synthetic Project；同一路径形成三套身份。只读走查，未触发构建、启停或代码修改。

- [x] `CONFIRM-RUNTIME-03`｜来源 `C-RDS-301`–`C-RDS-309`｜owner=`user`｜write_mode=`response_only`
  - 确认：Project/Workspace Runtime 完全分开；项目首页不跳工作台；一键打开 Runtime 专用独立 Chat；普通用户无需理解 npm 模式；窗口级多轮开发；关闭/主窗口结束后统一收口；Runtime 对话不混入普通列表但可全局搜索；同路径冲突阻止第二实例并提供切换；使用“用 AI 修改/结束修改”。
  - 未确认：无产品分叉；剩余技术合同不由产品确认代替。

- [x] `SPEC-RUNTIME-03`｜来源 `CONFIRM-RUNTIME-03`｜owner=`main_agent`｜write_mode=`writer`
  - 编排：`task_level=Heavy`；`deadline=本轮 product-spec 完成`；`attempt=1`；`instance_id=main`；`exact_write_allowlist=changes/active/chg-20260818-agent-command-channel/{proposal.md,design.md,acceptance.md,tasks.md,evidence.md,README.md}, changes/INDEX.md, prd/local-app-runtime/{README.md,design.md,acceptance.md}, prd/chat-agent-runtime/{README.md,acceptance.md}`；`diff_baseline=本轮写入前 HEAD 与干净 worktree`
  - 修改：升 Revision 3，冻结 RuntimeDevelopmentSession、Runtime 专用 Thread、两类 Runtime 隔离、结束/失败/恢复和用户语言。
  - 保持：Revision 2 网站、broker、权限、安全与通用 Chat 合同不变；不改业务代码，不签发正式验收。
  - 完成条件：Change、两个正式 PRD 模块的 Planned/Acceptance 语义一致，未决项不写成 GWT。

- [x] `DECIDE-RUNTIME-03`｜来源：2026-08-30 用户“接受默认”｜owner=`user + main_agent`｜write_mode=`response_only`
  - 决策：Runtime 对话不混入普通列表但可全局搜索；同路径实时资源冲突阻止第二实例并提供显式切换；主动作“用 AI 修改”、收口动作“结束修改”。
  - 完成条件：三项已进入 `C-RDS-307`–`C-RDS-309` 与正式 PRD/Acceptance；产品决策 Gate 关闭。

- [x] `TECH-RUNTIME-03`｜来源 `C-RDS-301`–`C-RDS-309`｜owner=`main_agent`｜write_mode=`writer`｜依赖：`DECIDE-RUNTIME-03`
  - 编排：`deadline=本轮完成技术合同后停止，不进入实现`；`attempt=1`；`instance_id=main`；`exact_write_allowlist=changes/active/chg-20260818-agent-command-channel/{technical.md,proposal.md,design.md,tasks.md,evidence.md,README.md}, changes/INDEX.md, prd/local-app-runtime/{README.md,design.md,technical.md,acceptance.md}, prd/chat-agent-runtime/{README.md,technical.md,acceptance.md}`；`diff_baseline=用户确认默认后的当前 dirty diff；明确排除用户删除的 TODO.md 与新增 AGENTS.md`
  - 完成：冻结 RuntimeScopeId、Runtime thread sidecar/table、单一 ChatBrokerCore、Runtime capability/window、RuntimeDevelopmentSession、root execution lease、退出/恢复/late-event 与回滚合同。
  - 保持：复用 Main broker core、Thread/Transcript/SDK/权限/Diff；不为 Workspace Runtime 创建 synthetic Project 或第二套聊天引擎；不写业务代码、不执行正式验收。
  - 验证：V0 文档 diff/reference 检查与 `git diff --check`；Interaction Flow Review 覆盖 close/background Run/prompt/reenter/app quit。

- [ ] `DEV-P0-RUNTIME-03`｜来源 `C-RDS-301`–`C-RDS-309`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`TECH-RUNTIME-03`、Revision 3 达到 BUILDABLE
  - 写入：由实施前 work order 根据稳定技术规格给出精确 allowlist；当前不授权业务代码。
  - 修改：完成 Runtime owner 隔离、一键专用窗口、窗口级开发会话、结束收口、Workspace 无 synthetic Project 与主窗口一致状态。
  - 保持：last-good 原子切换、失败/取消不保存半成品、运行中 Run 关闭窗口不取消、Preview sandbox。

- [ ] `ATDD-P0-RUNTIME-03`｜来源 `ATDD-RDS-301`–`ATDD-RDS-306`｜owner=`quality_verifier`｜write_mode=`response_only`｜依赖：`DEV-P0-RUNTIME-03`
  - 目标：产出并执行 P0 自动化与真实 Electron 路径；正式验收仍需用户另行授权。

- [ ] `DEV-P1-RUNTIME-03`｜来源 `ATDD-RDS-307`–`ATDD-RDS-309`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`DEV-P0-RUNTIME-03`
  - 修改：持久开发记录、pending prompt/关闭恢复、app quit、capability matrix、可访问状态与迁移。

- [ ] `ATDD-P1-RUNTIME-03`｜来源 `ATDD-RDS-307`–`ATDD-RDS-309`｜owner=`quality_verifier`｜write_mode=`response_only`｜依赖：`DEV-P1-RUNTIME-03`
  - 目标：覆盖重开/重启、dev-only Workspace、build 失败、late event、焦点与状态一致性。

## Revision 2 已完成/待验收基线

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
- [x] `PLAN-TERRA-02` owner: main_agent｜依赖：`SPEC-02`｜写入：`work-orders/**`｜已拆成逐单串行/依赖明确的 work orders；M0 实施复核中按事实增加 M0-05A scoped-capability、M0-05B thread-mutation、M0-05C single-writer coordinator 与 M0-05D runtime/scoped-services 前置，每单均含 read/write allowlist、步骤、测试、完成/停止条件。

### Revision 2 实现 Work Orders

- [x] `M0-01` owner: implementation_engineer｜依赖：`SYNC-02`｜任务单：`work-orders/M0-01-contracts-runner-sink.md`｜共享合同、唯一纯 reducer、runner event sink 与 WebContents 迁移 adapter 已完成；独立复跑 typecheck、目标测试 16/16、diff check 均 PASS，未实现 request ownership/unknown-request。
- [x] `M0-02` owner: implementation_engineer｜依赖：`M0-01`｜任务单：`work-orders/M0-02-main-chat-broker.md`｜Broker core、single writer、run/prompt 路由与 creationSource 迁移已完成；独立复跑 typecheck、目标测试 46/46、diff check 均 PASS，未做 production wiring。
- [x] `M0-03` owner: implementation_engineer｜依赖：`M0-02`｜任务单：`work-orders/M0-03-ipc-permission-capability.md`｜typed bridge、strict sender/frame/project capability、app-global permission 与 capability-aware broadcaster disabled seam 已完成；独立复跑 typecheck、目标测试 38/38、diff check 均 PASS，未 production wiring。
- [x] `M0-04` owner: implementation_engineer｜依赖：`M0-03`｜任务单：`work-orders/M0-04-project-chat-window.md`｜每项目唯一 window manager、固定 scoped-profile 参数、原子 view state 与最小同 bundle 壳已完成；独立复跑 typecheck、目标测试 40/40、diff check 均 PASS，仍未 production wiring。
- [x] `M0-05A` owner: implementation_engineer｜依赖：`M0-04`｜任务单：`work-orders/M0-05A-scoped-chat-capabilities.md`｜project-window 窄 preload、六个脱敏 capability、安全 attachment/thread snapshot projector 已完成；独立复跑 typecheck、目标测试 38/38、diff check 均 PASS，仍保持 disabled seam。
- [x] `M0-05B` owner: implementation_engineer｜依赖：`M0-05A`｜任务单：`work-orders/M0-05B-broker-thread-mutations.md`｜fork/edit-resubmit/archive/pin/model/diff-review Main-owned intent 已完成；独立复跑 typecheck、目标测试 49/49、diff check 均 PASS，仍保持 disabled seam。
- [x] `M0-05C` owner: implementation_engineer｜依赖：`M0-05B`｜任务单：`work-orders/M0-05C-workspace-coordinator.md`｜broker/Main 已共用唯一 read-transform-save operation coordinator；独立复跑目标测试 61/61、完整 Electron 199/199、typecheck 与 diff check 均 PASS，仍保持 disabled seam。
- [x] `M0-05D` owner: implementation_engineer｜依赖：`M0-05C`｜任务单：`work-orders/M0-05D-runtime-scoped-services.md`｜真实 runner adapter、durable scoped read services、附件 canonical containment 已完成；独立复跑目标测试 53/53、完整 Electron 204/204、typecheck 与 diff check 均 PASS，仍保持 disabled composition。
- [x] `M0-05E` owner: implementation_engineer｜依赖：`M0-05D`｜任务单：`work-orders/M0-05E-prompt-presence-rewind.md`｜Terra 回报完成：typecheck 0、目标 73/73、完整 Electron 210/210、diff check 0；按用户指示不再独立复核。
- [x] `M0-05F` owner: implementation_engineer｜依赖：`M0-05E`｜任务单：`work-orders/M0-05F-production-composition.md`｜default-off production composition、TaskHome/sink/handler 原子边界已完成；typecheck、目标测试与 composition/window smoke 通过，完整 Electron 的 loopback 环境失败已在授权环境复跑排除。
- [x] `M0-05` owner: implementation_engineer｜依赖：`M0-05F`｜任务单：`work-orders/M0-05-renderer-cutover.md`｜主窗口 snapshot 投影、recipient prompt ownership 与 renderer durable writer 封闭已完成；完整 Electron 219/219 通过。
- [x] `M0-06` owner: implementation_engineer｜依赖：`M0-05`｜任务单：`work-orders/M0-06-project-window-command-channel.md`｜完整项目窗口与 Revision 1 通道迁移已完成；目标测试 36/36、完整 Electron 221/221、真实 Electron 入口/单窗/bridge/draft 恢复 smoke 通过。无凭据 fixture 未覆盖 active run/prompt owner GUI smoke，保留为默认开启前风险，不阻塞 M1/M2 开发。
- [x] `M1-01` owner: implementation_engineer｜依赖：`M0-06`｜任务单：`work-orders/M1-01-binding-protocol-stores.md`｜protocol parser、加密 Binding store 与幂等 receipt store 已完成；typecheck 与目标测试 7/7 通过。
- [x] `M1-02` owner: implementation_engineer｜依赖：`M1-01`｜任务单：`work-orders/M1-02-deep-link-ticket.md`｜cold/warm deep link、HTTPS Ticket、外部任务线性化与协议注册已完成；typecheck、diff check、目标测试 31/31 与受控 HTTPS fixture 通过。TS/Vite/Electron/zip build 成功，arm64 DMG 的 HFS+/APFS 环境失败保留为发布打包风险。
- [x] `M1-03` owner: implementation_engineer｜依赖：`M1-02`｜任务单：`work-orders/M1-03-pairing-settings-focus.md`｜Main-only 配对 FIFO、网站连接管理、external task 焦点/持久未读、徽标 seen cursor 与路径恢复已完成；typecheck、diff check、目标测试及授权 loopback 环境完整 Electron 267/267 全部通过。
- [x] `M1A-01` owner: implementation_engineer｜依赖：`M1-02`｜任务单：`work-orders/M1A-01-preview-capture.md`｜Preview 的合法 agentos pair/task 窄捕获、session/generation fence 与无 preload/Chat IPC 隔离已完成；typecheck、diff check 与目标测试 33/33 通过。
- [x] `M2-01` owner: implementation_engineer｜依赖：`M0-06`｜任务单：`work-orders/M2-01-runtime-edit-coordinator.md`｜结构化 SDK hooks、edit lease、mutation、settle generation 与失败栅栏已完成；typecheck、diff check 与目标测试 42/42 通过。
- [x] `M2-02` owner: implementation_engineer｜依赖：`M2-01`｜任务单：`work-orders/M2-02-runtime-ui-integration.md`｜Runtime intent、双 Host/Chat 状态、scoped preview navigation 与 last-good 收口已完成；精确安全断言 92/92、完整 Electron 243/243、typecheck 与 diff check 全部通过。
- [x] `M3-01` owner: implementation_engineer｜依赖：`M0-06`｜任务单：**缺失（补记）**｜Workspace Tab durable backing Project：Main-only tab-id Chat API、canonical path repair/lazy backfill、重复 root 去重与安全 sender 负例已实现于 `electron/workspace-tab-project.ts`、`electron/workspace-tab-project-chat.ts`，并冻结在 `design.md` §3.5。**该实现未经 `work-orders/` 派单**，违反 work order 执行规则 1/3；2026-08-29 由 `BUG-AUDIT-WS-02` 补记，不追溯回滚，但后续同类实现必须先补任务单。正式验收待独立证据。
- [x] `BUG-AUDIT-CHAT-01` owner: main_agent｜依赖：`M0-05B`、`M0-05`、`M2-02`｜写入：`evidence.md`、`acceptance.md`、`work-orders/FIX-CHAT-01-sidebar-thread-mutations.md`｜已确认主侧边栏 archive/pin 漏接 Main intent；broker mode 同时关闭 renderer autosave，使修改不落盘并被 Runtime/Project Chat snapshot 覆盖。已评估相邻 project/sidebar ownership 风险，未改业务代码。
- [x] `BUG-AUDIT-WS-02` owner: main_agent｜依赖：`BUG-AUDIT-CHAT-01`｜写入：`evidence.md`、`acceptance.md`、`tasks.md`、`README.md`、`proposal.md`、`work-orders/**`｜按用户要求复核本 change 的缺陷面与过度设计。新发现 P0：broker 默认开启下**新建项目既不落盘也不可用**（renderer-only `addProject` + Main 无项目命令 + broker `project-not-found` + ChatPage 无条件走 broker）；项目移除/重定位/置顶/排序同样不落盘，且路径丢失恢复流程终点即在此路径上；归档运行中会话存在文案/实现/broker 合同三方不一致；readiness 用单一布尔表达 probing 与 legacy。同时完成过度设计复核并给出处置（见 `proposal.md` §Revision 2 范围复核）。已核实 `npm run typecheck` exit 0；未改业务代码。
- [x] `FIX-WS-01` owner: implementation_engineer｜依赖：`BUG-AUDIT-WS-02`｜任务单：`work-orders/FIX-WS-01-workspace-ownership.md`｜单一 Main-owned 命令通道 `chat-workspace:command` 已落地：`project.create/remove/relocate/setPinned/reorder` 与 `preferences.set` 六个 variant 走 `runChatWorkspaceOperation` + revision 门槛 + 回读校验，命令 DTO 结构性拒绝 threads/projects/未知键与 renderer 生成的项目 id；纯转换集中在 `src/workspace-commands.ts` 并由 `WorkspaceSession` 复用，消除双实现。`npm run typecheck` exit 0；`node --test electron/workspace-commands.test.mjs` 14/14；`node --test electron/workspace-command-client.test.mjs` 16/16；`npx vite build` PASS。ownership 归属矩阵已落盘 `evidence.md`，`ATDD-WS-201` 关闭。
- [x] `FIX-CHAT-01` owner: implementation_engineer｜依赖：`FIX-WS-01`｜任务单：`work-orders/FIX-CHAT-01-sidebar-thread-mutations.md`｜主侧边栏归档/置顶已切到 broker intent（显式 boolean、target project 自己的 `routeGeneration`、per-thread pending fence、`stale-revision` 单次 fresh-read 重试）；busy 判定改为读 snapshot 的 run/prompt 事实并覆盖普通/`task-run`/`skill-run`，broker 路径移除隐式 `claudeChat.cancel` 与 `stopTaskHomePlugin` 并新增固定提示 `sidebar.archiveBusyThread`；readiness 拆为 `probing | enabled | legacy`，probing 不再落入 legacy full-snapshot writer；归档只在目标线程为当前选择时移动 selection。附带修复 `runtimeEditStatus` 的三条硬编码中文（改走 i18n）。`node --test electron/project-chat-renderer.test.mjs electron/desktop-seam.test.mjs` PASS，含新增 source audit。
- [ ] `CHECK-02` owner: quality_verifier｜依赖：`M1-03`、`M1A-01`、`M2-02`、`FIX-WS-01`、`FIX-CHAT-01`｜任务单：`work-orders/CHECK-02-development-check.md`｜**Revision 3 合同取代后暂停作为整包关闭门禁**。仍可验证未受影响的 Revision 2 网站、broker、权限与安全范围，但旧 M2/M3 预期不得证明 Runtime 开发体验通过，也不能关闭 Change；Revision 3 需由 `ATDD-P0/P1-RUNTIME-03` 另行覆盖。仅在用户另行明确授权时进入正式验收。

## Revision 1 已完成基线

- [x] `ACC-01` owner: main_agent｜固化应用内全局通道范围、非目标和 ATDD 契约。
- [x] `IMP-01` owner: main_agent（串行 implementation_engineer 职责）｜实现通道、非激活线程创建与 Chat Run 状态桥接。
- [x] `TST-01` owner: main_agent（串行 quality check 职责）｜覆盖核心状态与 Workspace Session 边界。
- [x] `SYNC-01` owner: main_agent｜同步相同通道代码到 `IntelligentOS-APP` 并接入选题入口。
- [x] `CHK-01` owner: main_agent｜运行双仓库 Codex 自检并记录剩余风险。
- [ ] `VER-01` owner: project-verify｜状态：未执行；不声明正式通过，风险并入 Revision 2 后续验证计划。
