---
change_id: chg-20260818-agent-command-channel
revision: 5
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

# Revision 5 Tasks

## 工作台零认知查看与自动更新（2026-09-28）

初始项（`product-spec` 写入，按用户确认的顺序）：

- [x] `R5-01` 预览自动呈现：Runtime 进入 running 且有 readyUrl（或静态 previewUrl）时当前工作台立即创建预览，不依赖切页；覆盖首次成功、重启运行时、应用重启恢复、关闭后重开四条路径（`C-RSM-506`；证据 Paintpoints F14）。判据：四条路径各自无需切页即出现页面。
  - 进度（2026-09-28，project-work）：`runtimePreviewReady` 抽为纯函数并作为 `RuntimePreview` 创建 effect 依赖（根因：readyUrl 在 starting 阶段写入、转 running 时依赖无变化）；`isStaleRuntimeSnapshot` 统一 IPC 回包与事件的新旧判定，拒绝同实例更早 `updatedAt` 的快照（应用重启后 renderer 卡 starting）。证据：`node --test electron/runtime-event-state.test.mjs` 新增 3 项先红后绿；`npx tsc` exit 0。版本：base 65a02c4 + 未提交 diff。未验证：真实 GUI 四条路径复走（待 R5-03 后一并走查）。
- [x] `R5-02` 失败说真话：失败文案给出可读根因（端口被占用等），不再只取日志最后一行；无 last-good 时不显示「仍保留上次产物/继续显示上一版」（`C-RSM-506`；F18、F2）。判据：端口冲突场景文案含端口占用原因；首败文案不含上次产物。
  - 进度（2026-09-28，project-work）：`readableFailureReason` 取代「只取最后一行」——识别 `EADDRINUSE` 输出「端口 N 已被其他程序占用」，其次取含 error 的行，跳过 `}`/堆栈帧；生产服务退出文案改「页面服务退出」（F20 部分）；`runtimeBuildFailed` 改为中性「构建失败」，有 last-good 时才用 `runtimeBuildFailedKeptLast`/`serveBuildFailed`。证据：`node --test electron/local-app-runtime.test.mjs electron/runtime-event-state.test.mjs` 39/39；`npx tsc` exit 0。未做：端口冲突时自动换端口（不在确认范围）。
- [x] `R5-03` 源码新鲜度与自动重建：构建成功后记录源码指纹（静态、服务端对称）；按 `C-RSM-503` 时机比对，过期即重建；服务端档构建前备份 `.next`，失败回滚并以旧版重启（`C-RSM-502/503`；F13）。判据：改源码后五个触发点中四个检查点可看到新版，切页不触发；构建失败后旧版仍可用。
  - 进度（2026-09-28，project-work；covers `C-RSM-502/503`，preserves `DI-RSM-502/503/504`）：新增 `electron/local-app-runtime/server-bundle.ts`（服务端构建记录、过期判定：记录匹配比指纹/否则比 mtime、`.next` 克隆备份/还原）；`static.ts` 抽出源码遍历并新增 `newestRuntimeSourceMtime`；Supervisor 新增 `sourceFreshness` / `updateServer`（停服不触发崩溃重试 → 备份 → 构建 → 成功记账并重启 / 失败还原并以旧版重启，`update-failed`）、③→② 首次构建时写记录、`stop()` 等待更新还原备份；Manager 新增 `updateToLatest({force})` 与 `autoUpdate` 选项（Main 开启），每次 start 后后台检查；新 IPC `desktop:runtime:update`，↻（工作台与项目首页）调用之。证据：`node --test electron/runtime-auto-update.test.mjs` 5/5（过期判定、服务端成功、失败回滚且同源不重试、取消还原、静态自动重建）；全量 469 项中 468 通过，唯一失败为 `local-app-runtime.test.mjs` 真实 lsof 用例在并发负载下的既有抖动，单跑 28/28；`npx tsc` exit 0；`npx vite build` PASS。未覆盖：AI 修改结束对服务端档的重建（归 R5-04 统一入口）；真实 GUI 走查（R5-05 后一并）。
- [ ] `R5-04` 入口统一：`buildRuntime` 与新建流程经四档阶梯，③ 无产物落 ②（`C-RSM-501`；F12）。判据：SSR 项目任何入口都不出现「构建没有产出可直接打开的静态页面」失败态。
- [ ] `R5-05` 工作台零按钮与侧栏菜单精简；探测结论与覆盖入口移入「查看 Runtime」（`C-RSM-504/505`、`Q-R5-01`；F16）。判据：正常态工作台无运行类按钮、菜单四项；异常态出现恢复条与排障项。

### 新发现（project-work）

- `NF-R5-01` 全量 `node --test electron/*.test.mjs` 并发运行时偶发卡死或 `development takeover terminates only the process holding this project Next lock` 失败（真实 `lsof` 1s 超时）；逐文件运行全部通过。与 R5 改动无关，建议单独给该用例放宽超时或串行化。

# Revision 4 Tasks

## Runtime 伺服模式探测（2026-08-30）

- [x] `CONFIRM-RSM-04`｜来源：用户实测导入项目已有静态产物却仍跑 dev｜owner=`user`｜write_mode=`response_only`
  - 确认：伺服方式由系统探测而非项目申报；三档（已有产物 / 可构建 / 只能 dev），明确删除"构建后跑生产服务器"这一档；dev 只在开发会话或第三档出现；探测结论可手动覆盖；自建与导入一视同仁；并要求同轮修复此前实测的卡片不可运行与状态文案问题。

- [x] `SPEC-RSM-04`｜来源 `CONFIRM-RSM-04`｜owner=`main_agent`｜write_mode=`writer`
  - 完成：升 Revision 4，冻结 `C-RSM-401`–`407`、探测阶梯、覆盖语义、双段状态与 `ATDD-RSM-401`–`407`；显式记录对 `ATDD-EDIT-206`「无声明不猜命令」的放宽及其边界。

- [x] `R4-01`｜任务单 `work-orders/R4-01-runtime-serve-plan-detector.md`｜owner=`main_agent`｜依赖：`SPEC-RSM-04`
  - 完成：`detectRuntimeServePlan` / `findDetectedStaticArtifact` / `applyServeOverride` 与固定探测顺序；`servePlan` 进入 inspect 结果，`mode`/`agentos` 改由 plan 派生；Definition 新增 `serveOverride`。
- [x] `R4-02`｜任务单 `work-orders/R4-02-serve-plan-runtime-wiring.md`｜owner=`main_agent`｜依赖：`R4-01`
  - 完成：tier ① 零 spawn 零 lease 直接伺服已有产物；tier ② 构建一次后按实际产出目录 commit；构建无产物降级 dev；开发会话与旧 development 入口改用 `serveOverride: 'development'`；lease key 统一 realpath 化；浏览路径 root 冲突结构化回传。
- [x] `R4-03`｜任务单 `work-orders/R4-03-runtime-surface-state-and-override.md`｜owner=`main_agent`｜依赖：`R4-02`
  - 完成：卡片并列显示伺服状态与开发会话状态并提供启动/更新预览；新增「查看方式」覆盖与 `desktop:runtime:set-serve-override`（Main 持久化 + 回读校验）；start/restore 冲突显示名称、归属与切换入口。
- [x] `R4-SMOKE-01`｜来源：用户授权"启动"真实应用做 GUI 验证｜owner=`main_agent`｜write_mode=`writer`｜依赖：`R4-04`
  - 结论：Revision 4 主路径在真实应用与真实工作区数据上通过。导入项目零进程直出静态产物；项目首页卡片恢复可用并双段显示状态；tier ②→③ 阶梯与同路径冲突提示实测符合合同；退出后 Runtime 进程随之清理。
  - GUI 暴露并当场修复：`buildRuntime` 仍要求声明块、`build-produces-no-artifact` 后「启动」不回落 dev、该状态误报为失败。详见 `evidence.md` ORCH-026。
  - 复验：typecheck 0；串行全量 `432/432`；`npx vite build` 0；`git diff --check` 0。`ATDD-RSM-406` 仅验证控件渲染；开发窗口多轮修改与 deep-link smoke 未覆盖。

- [x] `R4-05`｜任务单 `work-orders/R4-05-production-serve-tier.md`｜owner=`main_agent`｜依赖：`R4-SMOKE-02`
  - 来源：用户"把 B 加回来"，撤回删除生产伺服档的决定；修订 `C-RSM-402`/`C-RSM-403`，新增 `ATDD-RSM-408`。
  - 完成：探测四档（静态产物 → `.next/BUILD_ID` 直接 `start` → 构建后再判 → `dev`）；`spawnNpm` 按 `serveScript` 选 `run start`/`run dev` 并切换 `NODE_ENV`；`serveOverride` 词表改为 `artifact|server`，开发会话改用不持久化的 `serveScript: 'dev'`。
  - GUI 复验：`/data/.agentos` 现由 `next start` 伺服（日志 `✓ Ready in 135ms`，无重复构建），静态项目仍零进程，同路径冲突提示正常。
  - 复验：typecheck 0；串行全量 `436/436`；`npx vite build` 0；`git diff --check` 0。

- [x] `R4-SMOKE-02`｜来源：用户要求把剩余 GUI 项"跑掉"｜owner=`main_agent`｜write_mode=`writer`｜依赖：`R4-SMOKE-01`
  - 结论：`ATDD-RSM-406`、`ATDD-RDS-301/302/304` 与窗口能力隔离取得 GUI 证据；同路径第二实例被阻止且提示占用者与切换入口，主窗口不被入口改动。
  - 新修：`serveOverride` 未进入 workspace store 白名单导致覆盖无法持久化（回读失败），已修并补 store 回归。
  - 未覆盖：`ATDD-RDS-303`（真实多轮 AI 修改）、`ATDD-LINK-201`（deep link，scheme 被已打包应用占用）、原生窗口关闭触发收口。详见 `evidence.md` ORCH-027。
  - 复验：typecheck 0；串行全量 `433/433`；`npx vite build` 0；`git diff --check` 0。

- [x] `R4-04`｜任务单 `work-orders/R4-04-runtime-creation-static-contract.md`｜owner=`main_agent`｜依赖：`R4-01`
  - 完成：system prompt 与中英创建请求要求 `output: 'export'` 并以 `out/index.html` 为完成条件。
  - 复验（R4-01–R4-04 合并）：`npm run typecheck` exit 0；串行全量 `432/432` PASS；`npx vite build` exit 0；`git diff --check` exit 0。真实 GUI smoke 未执行，不是正式验收。

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

- [x] `PLAN-RUNTIME-03`｜来源 `technical.md T3.11–T3.12`｜owner=`main_agent`｜write_mode=`writer`｜依赖：`TECH-RUNTIME-03`
  - 编排：`deadline=本轮生成 Revision 3 工单与映射后停止，不进入实现`；`attempt=1`；`instance_id=main`；`exact_write_allowlist=changes/active/chg-20260818-agent-command-channel/{tasks.md,evidence.md,README.md,work-orders/README.md,work-orders/R3-01-runtime-thread-store.md,work-orders/R3-02-chat-broker-core-runtime-facade.md,work-orders/R3-03-runtime-root-execution-registry.md,work-orders/R3-04-runtime-development-coordinator.md,work-orders/R3-05-runtime-development-window-ipc.md,work-orders/R3-06-runtime-surfaces-cutover.md,work-orders/R3-07-runtime-recovery-hardening.md,work-orders/R3-CHECK-runtime-development.md}`；`diff_baseline=TECH-RUNTIME-03 完成后的当前 dirty diff；排除用户删除 TODO.md 与新增 AGENTS.md`。
  - 完成：按技术迁移序列拆成 `R3-01 → R3-07 → R3-CHECK`，每单包含事实来源、依赖、精确 allowlist、V3 五面、验证、交付和停止条件。
  - 门禁：R3 writer 工单尚未派发，仓库内 `instance_id/diff_baseline=UNASSIGNED` 不产生写权；派发时必须绑定当前 writer 与基线。

- [x] `R3-01`｜来源 `technical.md T3.1–T3.3 / T3.11.1`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`PLAN-RUNTIME-03`
  - 编排：`attempt=2`；`instance_id=01a050c3-fb77-7fb0-9ed8-0586fd2665df`；`diff_baseline=bf70d5307487ab53f57203baa275083b5801af77 + 当前 Revision 3 文档 dirty diff`；严格使用 `work-orders/R3-01-runtime-thread-store.md` 的 10 路径 allowlist。
  - 完成：建立独立 Runtime Development Thread 合同、SQLite/sidecar、共享单调 revision、按 revision 隔离的 rollout、scope/owner 校验与 Runtime 搜索元数据；普通 Project Thread 与旧 app-command 数据保持隔离。
  - 独立复验：`npm run typecheck` PASS；目标 Node tests `28/28` PASS；`git diff --check` PASS。该结果仅表示工程工作单 accepted，不是 Revision 3 正式验收。

- [x] `R3-02`｜来源 `technical.md T3.2–T3.5 / T3.9 / T3.11.2`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`R3-01`
  - 编排：`attempt=1`；`instance_id=01a050ce-f5f5-7b50-b05f-8dd84c6b2876`；`diff_baseline=bf70d5307487ab53f57203baa275083b5801af77 + 已 accepted 的 Revision 3 文档与 R3-01 dirty diff`；严格使用 `work-orders/R3-02-chat-broker-core-runtime-facade.md` allowlist。
  - 完成：抽出唯一 `ChatBrokerCore`，Project facade 回归保持原语义；新增 Runtime facade、capability-only router、fresh-resolved scoped read、双 generation route fence 与 Runtime root mutation containment，Project/Runtime durable collection 双向隔离。
  - 独立复验：`npm run typecheck` PASS；目标 Node tests `69/69` PASS（原 Project 基线 54/54 全保留）；`git diff --check` PASS。Electron foundation 参考脚本因仓库既有非 electron-vite 架构返回 1，记录为既有架构差异，不越权修改地基文件；本单不是正式验收。

- [x] `R3-03`｜来源 `technical.md T3.2 / T3.8–T3.12`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`R3-02`
  - 编排：`attempt=1`；`instance_id=01a050ea-8178-7250-87a9-3716c8778fd9`；`diff_baseline=bf70d5307487ab53f57203baa275083b5801af77 + 已 accepted 的 Revision 3 文档与 R3-01/R3-02 dirty diff`；严格使用 `work-orders/R3-03-runtime-root-execution-registry.md` allowlist。
  - 完成：移除 canonical-root Definition alias，保持 supervisor/snapshot/consumer/event/artifact/generation 按 Definition 独立；新增 Main-owned root execution registry，冻结 development/build acquire、conflict、原子 transition、stopping/stop_failed 与 generation/leaseId fenced release。
  - 独立复验：`npm run typecheck` PASS；目标测试沙箱内因 loopback `EPERM` 为 40/41，允许回环监听环境原命令 `41/41` PASS；`git diff --check` PASS。未执行真实 Electron remove/relocate/trust revoke/app quit smoke，本单不是正式验收。

- [x] `R3-04`｜来源 `technical.md T3.7 / T3.9–T3.11.4`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`R3-03`
  - 编排：`attempt=2`；`instance_id=01a050f5-6ff2-7931-be12-a8f52257fd6b`；`diff_baseline=bf70d5307487ab53f57203baa275083b5801af77 + 已 accepted 的 Revision 3 文档与 R3-01–R3-03 dirty diff`；attempt 2 仅修 bridge 日志脱敏并补敏感异常负例。
  - 完成：实现窗口级 `RuntimeDevelopmentCoordinator` 与 Runtime bridge；冻结多轮 live、exit gate、1500ms 稳定窗/30s 上限、failed-mutation/prompt gate、每 generation 一次自动保存、manual retry、reenter/quit/late result fence，并在 last-good pointer rename 前复核 scope + 双 generation + operationId。
  - 独立复验：`npm run typecheck` PASS；完整目标集合沙箱内唯一 loopback `EPERM`，允许回环监听环境 `74/74` PASS；`git diff --check` PASS。bridge 日志只含 operation/scopeKind/枚举 code；未接 BrowserWindow/React/Main IPC，本单不是正式验收。

- [x] `R3-05`｜来源 `technical.md T3.4–T3.6 / T3.9–T3.11.5`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`R3-04`
  - 编排：`attempt=1`；`instance_id=01a05108-a4ad-7852-bf84-0d96f1c0aa40`；`diff_baseline=bf70d5307487ab53f57203baa275083b5801af77 + 已 accepted 的 Revision 3 文档与 R3-01–R3-04 dirty diff`；严格使用 `work-orders/R3-05-runtime-development-window-ipc.md` allowlist。
  - 完成：新增按 RuntimeScopeId 唯一的专用窗口、独立 view state、Runtime-only preload/capability/IPC 与 prompt presence；native close 同步 requestExit，再 flush/destroy，active Run 不 cancel；load failure 与 late activation 按 window/scope/双 generation 清理和拒绝。
  - 独立复验：`npm run typecheck` PASS；目标 Node tests `41/41` PASS；`git diff --check` PASS。Runtime preload source audit 无 desktop/Project bridge，跨 scope selected Thread 拒绝；未执行真实 Electron GUI/多显示器/prompt smoke，本单不是正式验收。

- [x] `R3-06`｜来源 `technical.md T3.5–T3.7 / T3.10–T3.11.6`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`R3-05`
  - 编排：`attempt=1`；`instance_id=01a0511a-812c-7343-8879-a754fb6c109b`；`diff_baseline=bf70d5307487ab53f57203baa275083b5801af77 + 已 accepted 的 Revision 3 文档与 R3-01–R3-05 dirty diff`；严格使用 `work-orders/R3-06-runtime-surfaces-cutover.md` allowlist。
  - 完成：项目首页与工作台入口分别发送 Project/Workspace Runtime identity 并打开专用开发窗口；不再切换工作台 Tab、创建或打开 synthetic backing Project；未初始化 Runtime 进入受控创建提示。主窗口、开发窗口与全局搜索统一消费 Main snapshot，冲突只聚焦现有 owner 窗口；旧 helper 保留为不可达兼容代码。
  - 独立复验：`npm run typecheck` PASS；目标 Node tests `40/40` PASS；`npm run build` exit 0（签名、DMG/ZIP 成功，既有 notarization 配置缺失提示保留）；`git diff --check` PASS。未执行真实 Electron GUI smoke，本单不是正式验收。

- [x] `R3-07`｜来源 `technical.md T3.3 / T3.6–T3.12`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`R3-06`
  - 编排：`attempt=1`；`instance_id=01a05136-810f-7813-966b-36875524b5db`；`diff_baseline=bf70d5307487ab53f57203baa275083b5801af77 + 已 accepted 的 Revision 3 文档与 R3-01–R3-06 dirty diff`；严格使用 `work-orders/R3-07-runtime-recovery-hardening.md` allowlist。Builder 在可选 computer-use smoke 授权处等待，主任务已接管只读复验并要求跳过该 smoke。
  - 完成：封闭 app quit、remove/relocate/trust revoke、pending prompt、development-only consumer、late event、restart stale、Definition removed、rollback 保留、焦点/键盘/a11y 与错误脱敏；无效项目命令先完成纯校验，避免提前停止 Runtime。
  - 独立复验：`npm run typecheck` PASS；R3-07 定向 Node tests `86/86` PASS；`npm run build` exit 0；`git diff --check` PASS。完整默认并发 Electron 套件暴露两份 R3-02 遗留 loader 缺口，已由 `R3-FIX-01` 修复；串行全量 `409/409` PASS。真实 Electron GUI smoke 未执行，本单不是正式验收。

- [x] `R3-FIX-01`｜来源 `R3-07 npm run test:electron`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`R3-07`
  - 编排：`attempt=1`；`instance_id=01a05153-56b2-7943-ba55-49648622f3ae`；精确 allowlist 仅 `electron/chat-run.test.mjs`、`electron/project-chat-contract.test.mjs`。
  - 完成：两份旧手工 TypeScript loader 提供 `./chat-broker-core` 的最小 `runtimeMutationTargetAllowed` stub；不改生产 containment、Runner 或测试主题。
  - 独立复验：目标测试 `17/17` PASS；单文件串行全量 Electron tests `409/409` PASS；`git diff --check` PASS。

- [x] `R3-CHECK-01`｜来源 `work-orders/R3-CHECK-runtime-development.md`｜owner=`quality_verifier`｜write_mode=`response_only`｜依赖：`R3-FIX-01`
  - 编排：`instance_id=01a05156-67a7-7c00-955e-173c8edd982c`；只读；未签正式 Acceptance。
  - 结论：`FAIL`。P0：未初始化 Project 未取得 prospective-root lease；P1：submit 等待 Runner accepted 时 close/end 可提前 settle。另有 exact 默认并发 Electron suite 在 local-app fixture pending、真实 GUI smoke 未执行。
  - 命令：typecheck/build/diff-check exit 0；串行诊断全量 409/409；exact `npm run test:electron` 非 PASS。

- [x] `R3-FIX-CHECK-01`｜来源 `R3-CHECK-01 P0`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`R3-CHECK-01`
  - 编排：`attempt=1`；`instance_id=01a05163-37cb-74b1-8575-6f357d641ae8`；严格使用 `work-orders/R3-FIX-CHECK-01-prospective-root-lease.md` allowlist。
  - 完成：Main 从 Project path realpath 派生 prospective `.agentos` root，在窗口/controlled prompt 前取得 Project lease；Registry 提供 fenced 原子 rebind，Definition 出现后新 token 先发布、旧 key 再移除，旧 token 不可释放新 owner。双向冲突无 spawn，失败/close/route/quit 幂等释放。
  - 独立复验：typecheck exit 0；目标 tests 38/38 PASS；diff-check exit 0。未执行 GUI/全量/build，不签正式验收。

- [x] `R3-FIX-CHECK-02`｜来源 `R3-CHECK-01 P1`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`R3-FIX-CHECK-01`
  - 编排：`attempt=1`；`instance_id=01a0516e-de5b-78f2-a937-3d31d684e948`；严格使用 `work-orders/R3-FIX-CHECK-02-submit-exit-linearization.md` allowlist。
  - 完成：Runner 前登记 pending authority，accepted 原子换绑真实 requestId；exit 在 accepted 前后均看到同一 active Run。submit rejection 显式回滚；accepted registration failure 先撤销 Core route 再 cancel Runner，旧 generation 事件不落库。
  - 独立复验：typecheck exit 0；目标 tests 26/26 PASS；diff-check exit 0。31 秒 delayed submit 不 settle/save，terminal 后只收口一次；未执行 GUI/全量/build，不签正式验收。

- [x] `R3-CHECK-02`｜来源 `R3-CHECK-01`｜owner=`quality_verifier`｜write_mode=`response_only`｜依赖：`R3-FIX-CHECK-02`
  - 编排：`instance_id=01a05179-413b-7ac1-b77b-3cd2166d2587`；只读重跑 `work-orders/R3-CHECK-runtime-development.md`，未签正式 Acceptance。
  - 结论：`PASS_WITH_RISK`。原 prospective-root P0 与 submit/exit P1 均已独立确认修复，无新增 P0/P1；C-021–C-027 与对应自动化路径通过。
  - 命令：typecheck/build/diff-check exit 0；P0 定向 38/38、P1 定向 26/26、串行诊断全量 424/424 PASS。exact `npm run test:electron` 在授权环境两次均停于 `local-app-runtime.test.mjs` pending，非 PASS；真实 Electron GUI smoke 未执行，继续作为正式验收前风险。

- [x] `R3-FIX-USER-01`｜来源：2026-08-30 用户真实使用后报告的两处 `R3-06` 缺陷｜owner=`main_agent`｜write_mode=`writer`｜依赖：`R3-CHECK-02`
  - 编排：`attempt=1`；`instance_id=main`（用户授权主任务直接实现，任务单同轮补记）；`diff_baseline=R3-CHECK-02 之后的当前 dirty diff`；严格使用 `work-orders/R3-FIX-USER-01-project-home-selection-locale.md` 的 6 路径 allowlist。
  - 完成：空 `activeThreadId`/`activeWorkspaceTabId` 不再被 `adoptAuthoritativeWorkspace` 判为"本地无意见"，项目首页不再被 Main 陈旧 `activeWorkspaceTabId` 拉回工作台；`ensureTrustedProjectRuntime` 改走同一保选中态合并并只持久化合并结果；25 条 Runtime 开发文案与 `previewNavigation` 从 `localApp` 段移入渲染层实际读取的 `runtime` 段。
  - 检查缺口修正：`ATDD-RDS-301` 与 `ATDD-RDS-309` 此前只有 source-grep 级证据，未覆盖快照合并路径与 key 解析；已分别补 `electron/workspace-command-client.test.mjs` 空选中态用例与新增 `electron/ui-locale-keys.test.mjs` 全量键解析断言。
  - 独立复验：`npm run typecheck` exit 0；目标 tests 19/19 PASS；串行全量 `427/427` PASS；`npx vite build` exit 0；`git diff --check` exit 0。冷启动仍按 Main 陈旧 Tab 进入工作台，留作后续 selection 所有权工单；本单不是正式验收。

- [x] `ARCHIVE-CHECK-01`｜来源：2026-08-30 用户要求复核未实现项并在通过后归档｜owner=`main_agent`｜write_mode=`response_only`（仅写 change 文档）｜依赖：`R3-FIX-USER-01`
  - 结论：`BLOCKED`，不归档。typecheck / 串行全量 427/427 / `npx vite build` / `npm run build:local` / diff-check 全部 exit 0，但 exact `npm run test:electron` 仍非 PASS（默认并发下 `local-app-runtime.test.mjs` 不终止，有界终止于 389s，424 pass / 1 cancelled / exit 1），真实 Electron GUI smoke 从未执行。
  - 其余未满足项：PRD 两处 Revision 状态仍写"未实现"与实现不符；`CHECK-02`、`VER-01` 未关闭；frontmatter 仍为 `acceptance_requested: false` / `coverage_gate: buildable`；M1 网站入口范围待用户决策。
  - 新增待办：冷启动选中态回落工作台；Main 中文错误 message 直传 renderer。两条需各自工单，不并入本 Change 的关闭条件。

- [x] `DEV-P0-RUNTIME-03`｜来源 `C-RDS-301`–`C-RDS-309`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`PLAN-RUNTIME-03`
  - 任务单：严格串行执行 `R3-01-runtime-thread-store.md` → `R3-02-chat-broker-core-runtime-facade.md` → `R3-03-runtime-root-execution-registry.md` → `R3-04-runtime-development-coordinator.md` → `R3-05-runtime-development-window-ipc.md` → `R3-06-runtime-surfaces-cutover.md`；每次只派一单并重新绑定 writer/baseline。六张 P0 writer 单已完成工程复验，正式验收仍待 `R3-CHECK` 与用户授权。
  - 修改：完成 Runtime owner 隔离、一键专用窗口、窗口级开发会话、结束收口、Workspace 无 synthetic Project 与主窗口一致状态；`R3-06` 是 P0 code gate。
  - 保持：last-good 原子切换、失败/取消不保存半成品、运行中 Run 关闭窗口不取消、Preview sandbox。

- [x] `ATDD-P0-RUNTIME-03`｜来源 `ATDD-RDS-301`–`ATDD-RDS-306`｜owner=`quality_verifier`｜write_mode=`response_only`｜依赖：`DEV-P0-RUNTIME-03`
  - Development Check：`R3-CHECK-02` 自动化范围 `PASS_WITH_RISK`；同路径冲突/窗口聚焦等真实 Electron GUI 路径未执行。该完成标记仅表示开发检查已执行，正式验收仍需用户另行授权。

- [x] `DEV-P1-RUNTIME-03`｜来源 `ATDD-RDS-307`–`ATDD-RDS-309`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`DEV-P0-RUNTIME-03`
  - 任务单：`work-orders/R3-07-runtime-recovery-hardening.md`；派发时绑定新 writer/baseline。
  - 修改：持久开发记录、pending prompt/关闭恢复、app quit、capability matrix、可访问状态与迁移。

- [x] `ATDD-P1-RUNTIME-03`｜来源 `ATDD-RDS-307`–`ATDD-RDS-309`｜owner=`quality_verifier`｜write_mode=`response_only`｜依赖：`DEV-P1-RUNTIME-03`
  - Development Check：`R3-CHECK-02` 自动化范围 `PASS_WITH_RISK`，重开/重启、dev-only Workspace、build 失败与 late event 已有自动化证据；真实窗口焦点/状态 smoke 未执行。只完成 Development Check，不签正式验收。

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
