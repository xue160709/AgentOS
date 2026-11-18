# Evidence

## Revision 3：Runtime 专用开发会话（2026-08-30）

### 用户确认来源

- `explicit_user_statement`：项目首页 Runtime 固定属于项目自己的 `.agentos`，工作台手动添加该目录只是少见的验证行为；两者“肯定是完全分开”，项目首页不得自动跳到工作台。
- `explicit_user_statement`：普通用户点击一次即打开独立 Chat，由 AI 直接修改并看到效果；用户不需要理解静态、`npm run dev` 或 build。
- `explicit_user_statement`：独立窗口打开期间用于开发 Runtime；看完效果后关闭窗口应自然退出开发，也可从主窗口退出；结束时生成静态产物并显示。
- `explicit_user_statement`：用户先表达 Runtime 开发对话倾向与普通对话分开；当时是否同时出现在普通项目对话列表尚未选择，随后由“接受默认”完成收口。
- `explicit_user_statement`：2026-08-30 用户回复“接受默认”，确认 Runtime 开发对话不混入普通项目对话列表但可全局搜索、同路径实时资源冲突阻止第二实例并提供显式切换、主动作“用 AI 修改”与收口动作“结束修改”；原 `Q-RDS-301`–`Q-RDS-303` 全部关闭为 `C-RDS-307`–`C-RDS-309`。
- `confirmed_artifact`：Revision 2 `ATDD-WIN-202` 已冻结“关闭窗口不取消运行中 Run”；Revision 2 Final settle 已冻结失败/取消不自动 build、last-good 失败回退和 generation fence。Revision 3 在此安全边界内把“关闭”升级为可延迟完成的结束意图。

### REAL 体验探索证据

- Project Runtime 两次复现：`data → 运行时` 先显示项目页，随后异步切到 `agentos-intelligence-workbench` Workspace Tab；持久 activeProject/activeWorkspaceTab 也实际改变，不是 Preview 遮挡。
- 项目页同时显示“运行中”“启动运行时”“正在加载预览”，刷新禁用且日志为空；工作台同路径页面实际可用，但壳层仍报告 loading/开发服务退出。
- 工作台“打开对话窗口”实际打开 synthetic Project Chat，窗口不说明 Runtime 路径、模式或修改归属；同名 synthetic Project 又派生 `/data/.agentos/.agentos` 并提示未初始化。
- Runtime 详情弹层被原生 Preview 覆盖；静态→dev、dev→静态、构建失败与启停动作未安全触发，明确记为未测，不作为已实现证据。

### as-built 冲突与复用依据

- `electron/local-app-runtime/index.ts` 当前按 canonical root + mode 去重 supervisor，使不同 owner 的 Definition 在同路径下发生别名状态串扰；Revision 3 要求 owner 域隔离。
- `electron/workspace-tab-project.ts` / `workspace-tab-project-chat.ts` 当前为 Workspace Tab 创建可见 backing Project；Revision 3 取代该用户模型，但保留“复用现有 Chat 基础设施、Main 权威持久化”的方向。
- `electron/runtime-edit-coordinator.ts` 当前在所有 potential run 终态后自动 settle，属于 Run 聚合；Revision 3 需要在显式 RuntimeDevelopmentSession 存续时由窗口级 lease 延迟最终收口。
- `electron/project-chat-window-manager.ts` 当前 close 只 flush view state；Revision 3 需要 Main-owned `exitRequested`，同时继续遵守“关闭不取消 Run”。
- `src/components/types.ts` 已有 durable Thread `purpose`，可小改扩展 Runtime 开发用途；不需要建立第二套 Transcript/SDK。

### ORCH-006

- skill: `product-problem-investigation` + `user-perspective-review`
- actual_execution: `mixed`
- actors: `main=DONE@INVESTIGATE-RUNTIME-03/main`；`runtime_reproduction=DONE@INVESTIGATE-RUNTIME-03/runtime_reproduction`；`static_runtime_contract=DONE@INVESTIGATE-RUNTIME-03/static_runtime_contract`；证据指针：本节 REAL 体验探索、主会话只读代码审计

### ORCH-007

- skill: `product-spec` + `change-package`
- actual_execution: `main_direct`
- actors: `main=DONE@SPEC-RUNTIME-03/main`；证据指针：Revision 3 proposal/design/acceptance/PRD diff 与文档引用核对

### ORCH-008

- skill: `change-package`
- actual_execution: `main_direct`
- actors: `main=DONE@DECIDE-RUNTIME-03/main`；证据指针：用户“接受默认”、`C-RDS-307`–`C-RDS-309` 与同步后的 PRD/Acceptance diff

## TECH-RUNTIME-03（2026-08-30）

### as-built 审计

- `verified_as_built / STATIC`：`electron/local-app-runtime/index.ts:1482-1522,1607-1617` 使用 canonical root + mode 的 dedupe owner，多个 Definition 会读取同一 supervisor snapshot/consumer；Revision 3 以 Definition 独立 + canonical-root execution lease 取代。
- `verified_as_built / STATIC`：`electron/workspace-tab-project.ts:30-75` 与 `workspace-tab-project-chat.ts` 会匹配或创建 Project 并写 `WorkspaceTab.projectId`；Revision 3 Runtime Chat 不再调用该入口，旧数据不自动删除。
- `verified_as_built / STATIC`：`electron/chat-workspace-store.ts:384-409,459-498` 的普通 thread 表强制 `project_id NOT NULL`；Revision 3 使用 Runtime thread metadata table + JSON sidecar，共享 Transcript/Broker core，不用 sentinel Project。
- `verified_as_built / STATIC`：`electron/runtime-edit-coordinator.ts:42-70,217-304` 按 project 聚合且无 window exit gate；Revision 3 新 coordinator 按 RuntimeScope 聚合，并把 `exitRequested` 纳入 settle 必要条件。
- `verified_as_built / STATIC`：`electron/project-chat-window-manager.ts:121-123` close 只 flush/cleanup；Revision 3 Runtime window close 在销毁视图前同步登记幂等 exit intent。
- `confirmed_artifact`：技术合同已写入 `technical.md T3.1`–`T3.12`，正式模块同步到 `prd/local-app-runtime/technical.md` 与 `prd/chat-agent-runtime/technical.md`；没有业务代码、测试或正式验收状态变更。

### Interaction Flow Review

- 覆盖 journey：用 AI 修改 → opening/live → 多轮 Run → close/结束修改 → background terminal → save/last-good；另覆盖 waiting prompt、failed mutation、build failure、reenter during save、same-root conflict、app quit/restart。
- 核心 fence：所有 callback 同时校验 `runtimeScopeId + routeGeneration + developmentGeneration + requestId/operationId`；close 不 cancel，reenter 提升 generation，app quit 不启动自动 save。
- 实现前 findings：P0 path alias 与 synthetic Project；P1 run-owned auto-settle、close 无 exit transaction、project-only thread schema。证据等级和测试门禁见 `technical.md T3.12`。

### ORCH-009

- skill: `change-package`
- actual_execution: `main_direct`
- actors: `main=DONE@TECH-RUNTIME-03/main`；证据指针：Revision 3 `technical.md T3.1`–`T3.12`、正式 PRD technical diff、`tasks.md` BUILDABLE gate

### ORCH-010

- skill: `interaction-flow-review`
- actual_execution: `main_direct`
- actors: `main=DONE@TECH-RUNTIME-03/main`；证据指针：`technical.md T3.7`–`T3.12` 状态机、late-event 不变量、findings 与自动化/Electron smoke 门禁

## PLAN-RUNTIME-03（2026-08-30）

- `confirmed_artifact`：`technical.md T3.11` 的六段迁移序列已拆为七张串行 writer 单：R3-01 data、R3-02 broker、R3-03 Runtime identity、R3-04 transaction、R3-05 window、R3-06 surface cutover、R3-07 recovery hardening；另有只读 `R3-CHECK`。
- 每张 writer 单已列出 `change_id@revision`、精确来源、依赖、exact write allowlist、V3 五面、最小验证、交付与停止条件。仓库内 writer/baseline 明示为 `UNASSIGNED`，因此文档生成不冒充派发或业务代码写权。
- 依赖强制串行：核心合同与 `electron/main.ts` 等路径跨单重叠，且后单的正确性依赖前单冻结的 data/broker/identity/state/window contract，不满足安全并行条件。
- `verified / V0`：工单路径/依赖/ATDD 引用与 `technical.md T3.2–T3.12`、两个正式 PRD acceptance 做静态核对；未改业务代码、未执行正式验收。

### ORCH-011

- skill: `change-package`
- actual_execution: `main_direct`
- actors: `main=DONE@PLAN-RUNTIME-03/main`；证据指针：`work-orders/R3-01`–`R3-07`、`R3-CHECK`、`work-orders/README.md` 依赖图与 `tasks.md` 映射

### ORCH-012

- `confirmed_artifact`：`R3-01` 由 Builder task `01a050c3-fb77-7fb0-9ed8-0586fd2665df` 在 attempt 2 完成，主任务按同一 allowlist 与命令独立复验后 accepted。
- 关键证据：Runtime Thread 使用独立 `runtime_development_threads` 与 `runtime-development-workspace.json`；无 Project FK；`idx_runtime_threads_scope_updated` 存在；rollout 按 revision 分路径，双介质失败不会把新 Transcript 混入旧 revision；unknown owner/scope、website source、duplicate id、stale revision 均拒绝。
- 回归证据：普通 Project Thread 的共享 rollout reader 保留有效前缀恢复；ordinary workspace save 不删除 Runtime 行、sidecar 或旧 app-command Thread。
- 命令：`npm run typecheck` exit 0；`node --test electron/project-chat-contract.test.mjs electron/chat-workspace-store.test.mjs electron/runtime-development-thread-store.test.mjs` 28/28 PASS；`git diff --check` exit 0。
- 边界：未接 broker、Main/preload、React、Runtime manager 或窗口入口；未执行正式验收。下一 writer 单为 `R3-02`。

### ORCH-013

- `confirmed_artifact`：`R3-02` 由 Builder task `01a050ce-f5f5-7b50-b05f-8dd84c6b2876` 完成，主任务核对 allowlist、唯一 core/reducer/Runner 路径并独立复验后 accepted。
- 关键证据：Project/Runtime facade 共用 `ChatBrokerCore`；原 Project 54/54 回归保持；Runtime capability 拒绝 Preview、未知 sender、Project/Main window、subframe、错误 document/origin、renderer 自报 scope/root/cwd/双 generation/durable state、跨 scope threadId 与 stale capability。
- 路由与文件证据：request route 在 Runner accepted 前冻结 scope/thread/routeGeneration/developmentGeneration；广播匹配完整 scope 与双 generation；Runtime reliable mutation 拒绝 traversal、root 外路径与 symlink escape，Bash 仍只声明 app-global 权限。
- 命令：`npm run typecheck` exit 0；`node --test electron/project-chat-broker.test.mjs electron/project-chat-ipc.test.mjs electron/project-chat-runtime-services.test.mjs electron/runtime-chat-broker.test.mjs electron/runtime-chat-ipc.test.mjs` 69/69 PASS；`git diff --check` exit 0。
- 环境与边界：`validate_electron_foundation.py --root .` 因仓库既有非 electron-vite 架构（无对应 config/watch/ELECTRON_RENDERER_URL 约定）exit 1；未修改 allowlist 外地基。未注册 `main.ts`/preload/UI/Runtime coordinator/window，下一 writer 单为 `R3-03`。

### ORCH-014

- `confirmed_artifact`：`R3-03` 由 Builder task `01a050ea-8178-7250-87a9-3716c8778fd9` 完成，主任务按 `interaction-flow-review` 复核 acquire/conflict/transition/stop failure/stale release 后 accepted。
- Definition 隔离：删除 `ownerByDedupeKey`、path alias 与抢占式 `stopOwnedDevelopmentRuntimes`；同 root 不同 Definition 的 snapshot、generation、consumer、event、artifact 均独立，第二个实时 Definition 在 spawn 前 conflict，零进程副作用；静态 last-good Preview 不占 lease。
- lease 矩阵：同 Definition acquire 幂等；development→build 仅同 Definition 且换发 leaseId；stale/duplicate release 不释放当前 lease；transition/stop failure 保留 `stop_failed`；最后 consumer 经过 bounded stop 才 release；static-only/uninitialized 的 development lease 仍参与互斥。
- 命令：`npm run typecheck` exit 0；目标 Node tests 沙箱内因 fixture `listen EPERM 127.0.0.1` 为 40/41，允许回环监听环境原命令 41/41 PASS；`git diff --check` exit 0。
- 边界：未接开发窗口、自动保存、UI 或 R3-04 coordinator；真实 Electron remove/relocate、trust revoke、app quit 留后续 smoke。下一 writer 单为 `R3-04`。

### ORCH-015

- `confirmed_artifact`：`R3-04` 由 Builder task `01a050f5-6ff2-7931-be12-a8f52257fd6b` 两个 attempt 完成；主审发现 bridge 直接记录 `Error.message` 可能泄露 root/命令/token/用户内容，attempt 2 改为固定 operation/scopeKind/枚举 code 并补敏感异常测试后 accepted。
- transition 证据：多轮不 build；active Run 关窗不中止；waiting prompt close/reenter；double exit；saving 中 reenter；failed-with/without-mutation；30s timeout/manual retry；build fail；late save；duplicate terminal/release；app quit fence 均有自动化覆盖。fake clock 验证 1500ms quiet window 与 30000ms 总上限。
- 原子性证据：Runtime Run 只登记新 coordinator；旧 Project RuntimeEditCoordinator 回归保持；last-good pointer rename 前同步复核 `runtimeScopeId + routeGeneration + developmentGeneration + operationId`，旧 generation 不发布 artifact、不切 Preview、不关闭或释放新会话。
- 命令：`npm run typecheck` exit 0；完整目标 Node tests 沙箱内唯一 `listen EPERM 127.0.0.1`，允许回环监听环境 74/74 PASS；`git diff --check` exit 0。
- 边界：未接真实 Electron 窗口、跨窗口 close/focus、app restart 或 Main/IPC composition；下一 writer 单为 `R3-05`。

### ORCH-016

- `confirmed_artifact`：`R3-05` 由 Builder task `01a05108-a4ad-7852-bf84-0d96f1c0aa40` 完成，主任务抽查 preload/profile、native close、late load 与 view-state scope 后 accepted。
- 生命周期证据：same-scope open 仅 show/focus；跨 scope 独立；native close 先同步 `requestExit`，再 flush view state 与 destroy；closed/destroyed 只做幂等 cleanup，不产生第二 exit，也不 cancel Main 中的 Run。load failure 和 close-during-load 会撤销 capability/presence/window ref，迟到 activation 被 window identity + scope + 双 generation 拒绝。
- capability/恢复证据：Runtime profile 只暴露 `runtimeChat`，不暴露 desktop/Project/Node/path；Preview/main/Project/unknown/subframe/wrong document/query spoof/stale generation 拒绝；scope/thread/draft/bounds 独立持久化，跨 scope selected Thread 拒绝；prompt owner close 后清空、reopen 只转移一次。
- 命令：`npm run typecheck` exit 0；目标 Node tests 41/41 PASS；`git diff --check` exit 0。Electron foundation 既有非 electron-vite 差异继续保留。
- 边界：未改项目首页/工作台入口；真实 Electron focus、多显示器 bounds、native close 与 prompt 人工 smoke 未执行。下一 writer 单为 `R3-06`。

### ORCH-017

- `confirmed_artifact`：`R3-06` 由 Builder task `01a0511a-812c-7343-8879-a754fb6c109b` 完成；主任务核对入口 payload、legacy reachability、Main snapshot 与 generation fence 后 accepted。
- 入口证据：项目首页只发送 `{projectId,mountId}`，不切工作台 Tab；工作台只发送 `{workspaceTabId}`，不创建或打开 backing Project；未初始化 Runtime 进入受控创建提示。Project/Workspace 的 scope、窗口、Thread 与 view state 分离，只有 root execution lease 冲突时聚焦既有 owner 窗口。
- 状态证据：项目首页、工作台、全局搜索与开发窗口统一消费 Main-owned Runtime snapshot；旧 `openWorkspaceTabProjectChat` 路径从 production composition 不可达，legacy collaborator 明确拒绝；动作文案收敛为“用 AI 修改 / 结束修改”。
- 命令：`npm run typecheck` exit 0；目标 Node tests 40/40 PASS；`npm run build` exit 0，完成签名与 DMG/ZIP（notarization 仍因既有配置缺失跳过）；`git diff --check` exit 0。
- 边界：未执行真实 Electron 项目首页/工作台/搜索/focus GUI smoke，也未把工程复验表述为正式验收。下一 writer 单为 `R3-07`。

### ORCH-018

- `confirmed_artifact`：`R3-07` 由 Builder task `01a05136-810f-7813-966b-36875524b5db` 实现；该 task 在可选 computer-use smoke 授权处等待后，主任务接管只读复验并接受代码 slice。
- 中断/恢复证据：app quit 先冻结 coordinator 且不启动 save；remove/relocate/trust revoke 在 active development 时 busy，先完成纯命令校验，再有界停止旧 process tree 后变更 owner/root/trust；旧 route/generation 失效，Definition removed 保留只读 Thread，static restart 先显示 last-good 再标 stale。
- 完整性/可访问性证据：development-only close 只释放 session consumer；last consumer 才停进程/释放 lease；rollback 不删除 Runtime collection/sidecar/view state/last-good；开发窗口本地化错误、单次 focus、disabled composer、role/status/alert、aria-busy/aria-live 均有 source/behavior 断言，日志只保留固定 code。
- 命令：`npm run typecheck` exit 0；R3-07 定向 tests 86/86 PASS；`npm run build` exit 0；`git diff --check` exit 0。Builder 串行全量在 loader 修复前为 407/409，主任务默认并发复跑另遇 local-app fixture pending；`R3-FIX-01` 后单文件串行全量 409/409 PASS。
- 边界：真实 Electron GUI smoke 因可选操作授权未执行；默认并发 `npm run test:electron` 的 local-app fixture 竞争留给 `R3-CHECK` 独立定性，不签正式验收。

### ORCH-019

- `confirmed_artifact`：`R3-FIX-01` 由 Builder task `01a05153-56b2-7943-ba55-49648622f3ae` 完成，主任务核对精确两文件 diff 后 accepted。
- 根因：R3-02 让 `claude-agent-runner.ts` 引入 `./chat-broker-core` 的 Runtime containment helper，但 `chat-run.test.mjs` 与 `project-chat-contract.test.mjs` 的手工 loader 未提供该依赖，导致两个与 containment 无关的 Runner 回归测试在装载阶段失败。
- 修复：仅在两份测试 loader 中提供异步 true stub；生产 `runtimeMutationTargetAllowed`、Runtime root/symlink containment 与对应负例均未改。
- 命令：目标 tests 17/17 PASS；`node --test --test-concurrency=1 electron/*.test.mjs` 409/409 PASS；`git diff --check` exit 0。下一阶段为只读 `R3-CHECK`。

### ORCH-020

- `confirmed_artifact`：首次 `R3-CHECK` 由独立 Verifier task `01a05156-67a7-7c00-955e-173c8edd982c` 只读执行，结论 `FAIL`，未签正式 Acceptance。
- P0：未初始化 Project 在 `main.ts` 无 Definition 分支直接 ready，bridge 只在 Definition 存在时取得 lease；Main 冲突预检只能看到既有 lease，因此同 prospective root 的 Workspace 请求可并发，违反 ATDD-RDS-301/C-021/ATDD-RUNTIME-DEV-301。
- P1：Runtime submit 持久化后等待 `runner.submit()`，coordinator 仅在 requestId 返回后登记 active Run；close/end 可先 settle，迟到 accepted registration 被拒绝且返回值被忽略，违反 ATDD-RDS-304/305、C-025/026、ATDD-RUNTIME-DEV-303。
- 门禁：typecheck/build/diff-check exit 0；串行诊断 409/409；exact 默认并发 Electron suite 在 local-app fixture pending，非 PASS；真实 Electron smoke 未执行。
- 处置：冻结 `R3-FIX-CHECK-01 → R3-FIX-CHECK-02 → R3-CHECK-02` 串行链，修复前不得给出 Revision 3 Development PASS。

### ORCH-021

- `confirmed_artifact`：`R3-FIX-CHECK-01` 由 Builder task `01a05163-37cb-74b1-8575-6f357d641ae8` 完成，主任务复核 Main 派生、Registry rebind 与释放 fence 后 accepted。
- 互斥证据：prospective root 由 Main fresh-read Project path 后 realpath 并追加固定 `.agentos`；在 BrowserWindow/controlled prompt 前 acquire。Project-first/Workspace-first 第二方均 conflict 且无 process/coordinator 副作用，symlink parent 不能绕过。
- 连续性证据：Definition 出现后重新 inspect/canonicalize；Registry 在同一串行临界区先发布新 token、再按旧 leaseId 删除旧 key，冲突保留双方原 lease，旧 token 无法释放 rebound token。manager 采用该 exact token，无释放后再获取窗口。
- 回收证据：controlled creation 提交失败、native close、route invalidation、quit 都按 authority/leaseId 幂等释放；不停止另一 owner，不删除 Thread/sidecar/last-good。
- 命令：`npm run typecheck` exit 0；目标 tests 38/38 PASS；`git diff --check` exit 0。下一 writer 单为 `R3-FIX-CHECK-02`。

### ORCH-022

- `confirmed_artifact`：`R3-FIX-CHECK-02` 由 Builder task `01a0516e-de5b-78f2-a937-3d31d684e948` 完成，主任务复核 Core route 撤销、coordinator 原子换绑与回滚语义后 accepted。
- 线性化证据：Runtime adapter 在 `runner.submit()` 前同步登记 pending authority；accepted 将 pending ID 原子换绑真实 requestId，exit→accepted 与 accepted→exit 均只有一个 active Run。31 秒 submit 延迟不计入 settle timeout，不发 save/closed。
- 失败证据：submit rejection 清理 Core pending/coordinator authority；无 mutation 正常 closed 且零 save，有可靠 mutation 则 needs_attention。accepted registration failure 先移除 Core route/run，再立即 cancel Runner；迟到 event 找不到 route，不能写 Thread 或 mutation。
- 边界：Project adapter 未接 Runtime submitting hook，保留原失败 snapshot/submit 语义；renderer、generation fence、prompt/double-exit/reenter/late event 不变。
- 命令：`npm run typecheck` exit 0；目标 tests 26/26 PASS；`git diff --check` exit 0。下一阶段为只读 `R3-CHECK-02`。

### ORCH-023

- `confirmed_artifact`：最终 `R3-CHECK-02` 由独立 Verifier task `01a05179-413b-7ac1-b77b-3cd2166d2587` 只读执行，结论 `PASS_WITH_RISK`，未签正式 Acceptance。
- finding 复核：原 P0 prospective-root lease 已覆盖未初始化 Project、Project-first/Workspace-first、symlink parent、rebind 与失败/close/route/quit 回收；原 P1 submit/exit race 已覆盖 pending authority、accepted 原子换绑、reject/registration-failure 回滚及 31 秒 delayed submit。两项均确认修复，无新增 P0/P1。
- 自动化证据：`npm run typecheck`、`npm run build`、`git diff --check` 均 exit 0；P0 定向 tests 38/38、P1 定向 tests 26/26、`node --test --test-concurrency=1 electron/*.test.mjs` 424/424 PASS。build 完成 app/DMG/ZIP，notarization 因既有配置缺失跳过。
- 风险证据：exact `npm run test:electron` 在沙箱为 421/424（3 个 loopback fixture `listen EPERM 127.0.0.1`）；在允许回环的授权环境连续两次均停于 `electron/local-app-runtime.test.mjs` pending 后有界终止，最终观察 421 pass / 0 fail / 1 cancelled，因此不得写成 exact suite PASS。真实 Electron GUI smoke 未执行，同路径冲突后的窗口聚焦、实际独立窗口与多显示器/焦点链仍待正式验收。
- 门禁结论：Revision 3 工程序列与 Development Check 已完成，可报告 `PASS_WITH_RISK`；Change 的正式 Acceptance、GUI 证据与 exact 默认并发套件问题仍保持开放。

### 用户实测缺陷（2026-08-30，`R3-FIX-USER-01` 来源）

- `explicit_user_statement`：用户在真实应用内使用后报告"项目首页的运行时现在还是依然跳到工作台"，并报告"工作台的所有文本现在都没有进行翻译"。两条均在 `R3-CHECK-02` 之后、由用户而非自动化发现。
- 缺陷 1 根因链（只读复核确认）：`R3-06` 的入口本身干净，项目首页只发 `{projectId,mountId}`；跳转来自 `adoptAuthoritativeWorkspace` 把空 `activeThreadId`/`activeWorkspaceTabId` 判为"本地无意见"并回退 Main 旧值。broker mode 下 renderer 不再持久化选中态且 `WorkspaceCommand` 无 selection variant，Main 的 `activeWorkspaceTabId` 长期陈旧；项目首页切"运行时"页签发出的 `preferences.set` 回包即触发覆盖，`ensureTrustedProjectRuntime` 的整份 `setChatWorkspace(authoritative)` 还把它写进 localStorage。`AppShellWorkspace` 的 `isRuntimeActive` 只要该字段非空就隐藏 `ChatPage`。
- 缺陷 2 根因：`R3-06` 新增的 25 条 Runtime 开发文案写入旧 `localApp` 段，渲染层读的是 `runtime.*`，`translate()` 未命中即返回原始 key。冻结文案"用 AI 修改/结束修改"从未真正显示。既有遗留 `previewNavigation` 同类。
- 检查缺口（对 `R3-CHECK-02` 的修正）：`ATDD-RDS-301` 的"不改变 active tab/project"只由 source-grep 断言入口未调用 `openWorkspaceTab`，未覆盖快照合并这条真实覆盖路径；`ATDD-RDS-309` 的"UI copy assertions"只断言源码里出现 `t('runtime.modifyWithAi')`，未断言该 key 能解析。两项的既有自动化证据不足以支撑其"最低证据"列，`PASS_WITH_RISK` 对这两条被高估。

### ORCH-024

- `confirmed_artifact`：`R3-FIX-USER-01` 由主任务在用户授权下直接实现并补记任务单；write allowlist 六文件，未触碰 Main selection 所有权、workspace 命令 DTO、Runtime coordinator/window/registry 与 `localApp` 段中仍被 `LocalAppPreview.tsx`/`LocalAppWorkspace.tsx` 使用的旧键。
- 选中态证据：空 `activeThreadId`/`activeWorkspaceTabId` 现在被判为项目首页这一有效选择，合并 Main 快照后保持为空并同步 `activeLocalAppTabId`；非空但对象消失时仍回退 Main，原有两条断言语义不变。`ensureTrustedProjectRuntime` 改走同一 `adoptAuthoritativeWorkspace(..., { preserveSelection: true })`，并把合并结果而非 Main 原始快照写入 localStorage，避免跳转跨重启固化。
- 文案证据：25 条 Runtime 开发文案与 `previewNavigation` 从 `localApp` 段移入 `runtime` 段（中英各一份，键名与文案内容不变）；源码内 1007 个静态 `t()` 键在 zh/en 两份目录全部解析，此前中英同缺 17 个。
- 回归证据：新增 `electron/ui-locale-keys.test.mjs` 扫描全部静态 `t('a.b')` 并断言双目录解析，使"写错命名空间"成为可检失败；`electron/workspace-command-client.test.mjs` 新增空选中态用例（原三条只覆盖非空选择与 `preserveSelection:false`）。
- 命令：`npm run typecheck` exit 0；`node --test electron/ui-locale-keys.test.mjs electron/workspace-command-client.test.mjs` 19/19 PASS；`node --test --test-concurrency=1 electron/*.test.mjs` 427/427 PASS（424 基线 + 本单 3 条）；`npx vite build` exit 0；`git diff --check` exit 0。
- 边界：冷启动仍按 Main 陈旧 `activeWorkspaceTabId` 直接进入工作台（`restoreWorkspaceSessionState` 项目首页分支保留该字段），需另开工单以 `selection.set` 命令或 adopt/restore 剥离 selection 收口。真实 Electron GUI smoke 仍未执行；本单不是正式验收。

### ARCHIVE-CHECK-01（2026-08-30 归档前复核）

- 触发：用户要求"看 change 里有哪些没有实现，通过测试验收后归档"。本节只记录只读复核事实，未签正式 Acceptance，未归档。
- 结论：`BLOCKED`。自动化可覆盖的部分全绿，但 Change 自己冻结的关闭条件仍有未满足项，其中两项是硬门禁。
- 通过的命令：`npm run typecheck` exit 0；`node --test --test-concurrency=1 electron/*.test.mjs` 427/427 PASS；`npx vite build` exit 0；`npm run build:local` exit 0（签名 + DMG/ZIP 产出，notarization 因既有配置缺失跳过；选 `--publish never` 变体以排除任何发布副作用）；`git diff --check` exit 0。
- 硬门禁 1：exact `npm run test:electron` 仍非 PASS，且本机两次复现同一现象——默认并发下 `electron/local-app-runtime.test.mjs` 不自行终止（runner 使用 `--test-timeout=0`），第二次有界终止于 389 秒，最终 424 pass / 0 fail / 1 cancelled、exit 1。该文件单独运行 24/24 PASS / 2.1 秒，串行全量 427/427 PASS，因此是默认并发下的 fixture 资源竞争（该单测会 spawn 真实子进程并等待 PID 消失），不是本轮改动引入，但它是 Release candidate 门禁命令之一，未修复即不得关闭 Change。
- 硬门禁 2：真实 Electron GUI smoke 至今一次未执行。`ATDD-RDS-301`–`309` 的"最低证据"列全部含 Electron smoke，`ATDD-LINK-201` 另需 macOS cold/warm deep-link smoke，`ATDD-PREVIEW-201`、`ATDD-WIN-201`–`203`、`ATDD-A11Y-201` 同样要求 Electron 证据。`R3-FIX-USER-01` 的两条缺陷都只在真实渲染路径显现，证明该缺口是实际风险而非形式要求。
- 事实源漂移：`prd/chat-agent-runtime/acceptance.md` 的 `Revision 3` 与 `prd/local-app-runtime/acceptance.md` 的 `Revision 6` 仍标"BUILDABLE / Planned，未实现"，与已落盘实现不符；acceptance.md 声明 PRD 为唯一验收事实源，归档前必须回写 as-built 状态（`prd/local-app-runtime/acceptance.md` 的 `Revision 5` 同样标"Planned / 未实现"，但对应 change 已归档为 done，属更早遗留）。
- 未关闭任务：`CHECK-02`（Revision 2 独立检查，被 Revision 3 取代后暂停）与 `VER-01`（Revision 1 verification，从未执行）仍未勾选；`tasks.md` frontmatter 仍为 `acceptance_requested: false`、`coverage_gate: buildable`，与归档模板要求的 `acceptance_status: accepted`、`coverage_gate: pass` 不符。
- 范围未决：`proposal.md` 的 Revision 2 范围复核把 M1 网站入口整链记为"没有真实第三方消费者，建议后续拆分，待用户决策，本轮不执行"。
- 新增待办（均不在 `R3-FIX-USER-01` 范围，需各自工单）：其一，冷启动仍按 Main 陈旧 `activeWorkspaceTabId` 直接进入工作台，根因是 broker mode 下 selection 无 Main 命令通道；其二，Main 侧中文错误 message 经 `setWorkspaceSaveError(result.message)` 等六处直传 renderer，`locale=en` 下界面显示中文，属跨 revision 的既有 i18n 缺口。

## Revision 4：Runtime 伺服模式探测（2026-08-30）

### 用户确认与实测来源

- `explicit_user_statement`：「工作台的 tab 如果没有在开发者模式，那么都是使用这一个静态网页。只有进入开发者模式，才使用 npm run dev。项目首页的运行时也是一样的。两者没有直接的关系。」
- `explicit_user_statement`：「导入的项目 package.json 里不可能有 agentos 声明块……应该是我们的后端帮它做静态配置。先看有没有已经做好的静态产出物，有就直接运行；没有就看 package.json 怎么 build。新建的 runtime 和导入的网站都要实现。」
- `explicit_user_statement`：2026-08-30 追加四项决定——删除"构建后跑生产服务器"这一档（build 后没有静态就直接到 dev）；探测结论可手动覆盖；开 Revision 4；规格写完直接进入实现。
- 实测事实（只读核对用户机器）：`/Github/homepage` 与 `/Github/codenow.wiki` 都有 `output: "export"` 且 `out/index.html` 已存在，却因缺少 `agentos` 声明块被判为 development 并常驻 `npm run dev`；`/AgentOS/data/.agentos` 既无声明块也无 `output: 'export'`，且其创建 prompt 从未要求写声明块。workspace 存档显示同一 canonical root 上并存 project 与 workspace 两个 Definition，两者都是 development，因而争抢 root 执行锁——这就是"项目首页卡片无法运行"的直接原因。

### ORCH-025

- `confirmed_artifact`：`SPEC-RSM-04` 与 `R4-01`–`R4-04` 由主任务在用户授权下连续实现（"修改完直接开发"），任务单与规格同轮落盘。
- 探测证据：新增 `detectRuntimeServePlan` / `findDetectedStaticArtifact` / `applyServeOverride`，顺序固定为 声明块 → 已有产物（`out` → `dist` → `build`）→ 可构建 → dev → 不支持；探测输出与既有 `StaticDeclaration` 同形，静态构建、last-good 产物库与静态 Preview 链路未改。产物候选逐个走 `validateStaticOutput`，symlink 逃逸被拒。
- 伺服证据：`start()` 现在每次重新探测（只有 `serveOverride` 能压过它），tier ① 直接把已有产物 commit 为 artifact 并以文件伺服，**零 spawn、零 root lease**；tier ② 构建一次后按实际产出目录 commit；构建产不出可打开页面时记 `build-produces-no-artifact` 并降级为 dev，不报硬失败。开发会话与旧 development 入口改用 `serveOverride: 'development'` 表达"这次就是要 dev"，因此探测不会把会话中的 Runtime 拉回静态。
- 修复证据：`acquireExecutionLease` 统一 realpath 化 lease key（此前 `/var` 与 `/private/var` 两种写法会互相绕过锁）；浏览路径的 root 冲突由 Main 铸造一次性 token 并以结构化 payload 抛回 renderer，项目首页与工作台的 start/restore 不再静默吞错；卡片改为并列显示 Runtime 伺服状态与开发会话状态，并按状态提供「启动 / 更新预览」；新增「查看方式」覆盖（已保存预览 / 保持运行 / 恢复自动判断），经 `desktop:runtime:set-serve-override` 由 Main 持久化并回读校验。
- 创建合同证据：system prompt 与中英创建请求都要求 `next.config` 配置 `output: 'export'` 并以 `out/index.html` 存在为完成条件，并说明系统按实际产物判断能否提供已保存预览。
- 命令：`npm run typecheck` exit 0；`node --test --test-concurrency=1 electron/*.test.mjs` **432/432 PASS**（427 基线 + 本轮 5 条新用例）；`npx vite build` exit 0；`git diff --check` exit 0。
- allowlist 偏离（如实记录）：为落地覆盖 IPC 另改了 `src/desktop-seam.ts`、`electron/preload.ts`、`src/desktop-api.ts`；`electron/desktop-seam.test.mjs` 的 save-count 守卫从 8 改为 9（新增的第 9 处 save 已按要求包在 `runChatWorkspaceOperation` 内）。两处均属工单未预见但必要的最小扩展。
- 边界：真实 Electron GUI smoke 仍未执行；`ATDD-RSM-401`–`407` 只取得自动化证据，未签正式验收。同路径两个 Runtime 若都落在 tier ③（都只能 dev），仍然只能有一个在运行——此时显示的是显式冲突与切换入口，而不是静默停止。

### ORCH-026（Revision 4 真实 Electron GUI smoke）

- `confirmed_artifact`：用户授权后在本机真实启动 Electron（`electron . --remote-debugging-port=9222`，加载 `vite build` 产物），通过 CDP 驱动真实界面与真实工作区数据完成 R4 验证；这是本 Change 第一次执行真实 GUI smoke。
- 工作台 · 导入项目（`/Github/homepage`）：`mode=static`、`hasArtifact=true`、`previewUrl` 有值、`stale=true`，**全程没有为它启动任何 dev server**。即 tier ① 直接采用目录里已有的 `out/`，零进程。R4 之前它必然常驻 `next dev`。
- 项目首页 · `data`（`/AgentOS/data/.agentos`）：卡片同时显示「还没有生成预览」（Runtime）与「可以开始修改」（开发会话），并给出「更新预览 / 构建 / 用 AI 修改 / 查看方式」入口——此前该卡片只有一句「可以开始修改」和一个不可用的预览，用户报告"无法运行"。
- tier ② → ③ 实测：点「更新预览」触发 `npm run build`，Next 构建成功但因该工程是 SSR（含 `ƒ` 动态路由、无 `output: 'export'`）没有产出 `out/index.html`，系统据实记为 `build-produces-no-artifact` 并显示「需要保持运行才能查看」；再点「启动」后 `status=running`、`mode=development`，并可见新起的 `/data/.agentos` dev 进程。整条阶梯按 `C-RSM-402` 落地。
- 同路径冲突可见：`data` 的 dev 占用 root 后，对同目录的工作台 Runtime 触发构建，界面出现「另一个 Runtime 正在修改相同目录 · data · 项目 Runtime」并附「切换到正在修改的 Runtime」。冲突不再静默失败，且浏览态（restore）本身不占锁，两个 Runtime 可同时打开。
- 退出清理：关闭应用后，其启动的 Runtime dev 进程随之退出，未留孤儿进程。
- GUI smoke 暴露并当场修复的三处缺陷：① `buildRuntime` IPC 仍要求 `agentos` 声明块，导致 tier ② 无法构建（改为按 `servePlan` 判定）；② 已处于 `build-produces-no-artifact` 的 Runtime 再次「启动」不会回落到 dev（`start()` 增加该分支，无需重复构建）；③ 该状态此前显示为红色「生成预览失败」，改为如实的「需要保持运行才能查看」+「启动」。另补 `runtime.serveNotGenerated`（「还没有生成预览」）取代此前误用的「已停止」。
- 命令：`npm run typecheck` exit 0；`node --test --test-concurrency=1 electron/*.test.mjs` **432/432 PASS**；`npx vite build` exit 0；`git diff --check` exit 0。
- 边界：本轮只覆盖 `ATDD-RSM-401`–`405`、`407` 的主路径与 `C-RSM-402` 三档；`ATDD-RSM-406`（手动覆盖持久化）只验证了控件渲染，未点击切换；`ATDD-RDS-30x` 的开发窗口多轮修改、结束收口与 macOS deep-link smoke 仍未执行。`Page.captureScreenshot` 在该窗口挂起，本轮证据以 DOM 文本与进程事实为准，无截图。

### ORCH-027（第二轮 GUI smoke：覆盖、开发窗口与同路径冲突）

- `confirmed_artifact`：用户要求把剩余项"跑掉"，继续在真实 Electron + 真实工作区上驱动。
- `ATDD-RSM-406` 手动覆盖：点「保持运行」后 `serveOverride` 持久化为 `development`、Runtime 变为 `running/development`、文案「需要保持运行才能查看」、按钮 `aria-pressed=true` 且出现「恢复自动判断」；点「恢复自动判断」后 override 清空、按钮消失，自动探测重新接管并得出同一结论。**首次点击失败暴露第四个缺陷**：`normalizeRuntimeDefinitions` 的严格白名单没有携带 `serveOverride`，导致 Main 回读校验失败（`runtime-serve-override-readback-failed`）——已修并补 store 回归（合法值保留、未知值丢弃）。
- `ATDD-RDS-301`（同路径第二实例）：工作台 Runtime 正持有该目录的实时开发时，在项目首页点「用 AI 修改」被阻止，界面显示「另一个 Runtime 正在修改相同目录 · agentos-intelligence-workbench · 工作台 Runtime」+「切换到正在修改的 Runtime」，且**没有打开第二个开发窗口**。进程侧复核：同一 root 上始终只有一个 dev 进程。
- `ATDD-RDS-302`（入口不改主窗口）：点「用 AI 修改」打开 `window-kind=runtime-development&runtimeScopeId=project:<id>` 专用窗口；`getChatWorkspace()` 的 `activeWorkspaceTabId` / `activeProjectId` 前后完全一致，**主窗口不切工作台 Tab、不换项目**。这是该条第一次拿到 GUI 证据。
- 窗口能力隔离：主窗口 `window.desktop` 存在、`runtimeChat` 不存在；开发窗口 `runtimeChat` 存在、`desktop` 与 `projectChat` 均不存在。开发窗口标题显示归属（「项目 · data」/「工作台 · agentos-intelligence-workbench」），文案全中文且无原始 key。
- `ATDD-RDS-304`（结束收口）：主窗口点「结束修改」后状态转为「修改已结束」，动作回到「用 AI 修改」。
- 附带观察（非缺陷，记录以免误判）：用 CDP `Target.closeTarget` 关闭开发窗口不会触发 `requestExit`，会话仍停在 live——原生窗口关闭按钮走的是另一条路径，本轮自动化无法点击 macOS 窗口按钮，因此"关闭窗口即结束"未取得 GUI 证据。
- 命令：`npm run typecheck` exit 0；`node --test --test-concurrency=1 electron/*.test.mjs` **433/433 PASS**；`npx vite build` exit 0；`git diff --check` exit 0。
- 仍未覆盖：`ATDD-RDS-303`（窗口内连续多轮 AI 修改）需要真实提交 Agent 请求并改动用户 Runtime 源码，本轮主动不执行；`ATDD-LINK-201` deep link 未测——`agentos:` scheme 由已打包的 AgentOS.app 占用，用 `open` 触发会拉起另一份应用并与开发实例争抢同一 userData，风险大于收益；原生窗口关闭路径同上。

### ORCH-028（`R4-05` 生产伺服档回归）

- `explicit_user_statement`：2026-08-30 用户在看过实测事实后要求"把 B 加回来"，撤回此前"删掉第三档"的决定。触发事实：`/data/.agentos` 的 `npm run build` 成功但 `.next` 里 **0 个 HTML**，三个 API 路由都声明 `runtime='nodejs'` + `dynamic='force-dynamic'` 且在请求时读磁盘，主页面标记 `ƒ server-rendered on demand`——这类工程不是"少配了一行 `output: export`"，静态化需要改数据获取架构。
- 合同修订：`C-RSM-402`/`C-RSM-403` 由三档改为四档（已有静态产物 → 已有服务端产物直接 `start` → 构建后再判 → 只能 `dev`）；`ATDD-RSM-408` 新增；`serveOverride` 词表由 `artifact|development` 改为 `artifact|server`，并新增**不持久化**的 `serveScript: 'dev'|'start'` 供开发会话强制 dev。
- 实现证据：探测新增 `.next/BUILD_ID` 标记（唯一被认可的服务端产物标记，只对 Next 生效，其它框架仍必须先构建）；`spawnNpm` 按 `serveScript` 选择 `run start`（`NODE_ENV=production`）或 `run dev`，共用同一套端口分配、就绪探测与 root lease；构建后无静态产物时优先落到生产伺服，其次才是 dev。
- 真实 GUI 复验：在 `/data/.agentos` 直接执行一次 `npm run build` 产出 `.next/BUILD_ID` 后重启应用，工作台 Runtime 的日志首行即 `> next start -H 127.0.0.1 -p 3457`、`✓ Ready in 135ms`，进程为 `next-server (v15.5.4)`——确认跑的是生产服务器而非 dev，且**没有再构建一次**。同一时刻 `homepage` / `codenow-wiki` 仍是零进程 `stale` 静态产物，项目 Runtime 因同路径已被占用而显示显式冲突提示与切换入口。
- 附带确认（既有行为，非本轮引入）：当项目脚本硬编码端口（此处 `-p 3457`）时，分配的端口被忽略，但 supervisor 从 stdout 解析出真实 `readyUrl` 并据此预览，因此不受影响。
- 命令：`npm run typecheck` exit 0；`node --test --test-concurrency=1 electron/*.test.mjs` **436/436 PASS**（新增 3 条生产档用例）；`npx vite build` exit 0；`git diff --check` exit 0。
- 边界：`.next` 之外的服务端产物形态不探测；生产伺服与 dev 对用户是同一句「需要保持运行才能查看」，界面不暴露两者差别。

## Revision 2：Discovery

### 用户确认来源（2026-08-26）

- SDK：用户纠正为“Claude Agent SDK”。
- 窗口：用户说明“新建一个窗口来承载这个 Chatbot，可以沿用当前的整个 Chatbot”。
- 来源：用户选择同时支持 AgentOS 内嵌页面与普通系统浏览器页面。
- 发起：用户选择由网站发起配对，AgentOS 确认；一个网站绑定一个项目。
- 执行：用户选择授权网站可直接运行，并且每个外部任务创建新会话。
- 权限：用户明确“现在用户选了哪个权限，就用哪个，协议里不涉及权限”。
- 会话：用户说明独立窗口“跟主窗口的项目下面的会话很像”，选择每项目一个窗口、窗口内管理该项目会话。
- 传输：用户选择 `agentos://` 配对/唤醒 + HTTPS 一次性 ticket 的组合，不在第一版建立本地 HTTPS 服务。
- 启动：在 Heavy 范围、角色与停点说明后，用户回复“继续”，确认进入发现和设计阶段。

### 已核实代码基线

- `electron/main.ts` 当前只创建一个主 `BrowserWindow`，并把该窗口的 `webContents` 直接交给 `ClaudeAgentRunner`。
- `electron/preload.ts` 使用窄 `contextBridge`；静态预览使用私有 `agentos-static:` scheme，预览页面没有应用 preload 能力。
- `src/agent-command-channel.ts` 当前在 renderer 配置阶段绑定单一项目，能够创建普通会话、提交完整 prompt、选择 `stay/open` 并订阅状态。
- Workspace Session、Chat Run 和 transcript 已是现有用户可见事实源；Revision 2 不新增第二套模型。
- `chg-20260825-local-app-tabs-runtime@5` 已承接首次自动静态构建、过期手动重建、last-good 与相关预览状态，本变更只消费其能力。

### ORCH-002

- skill: `product-discovery`
- actual_execution: subagents
- roles: `product_manager=DONE@DISC-PM-02; experience_designer=DONE@DISC-UX-02; technical_architect=DONE@DISC-ARCH-02`
- task_mapping: `DISC-PM-02 -> DISC-UX-02 + DISC-ARCH-02 -> DISC-MERGE-02 -> CONFIRM-02`
- deviation: `technical_architect` 因子线程上限复用已完成的 `protocol_scheme_consult` 线程，并按 technical-architect 方法与交付模板补全；不新增写入者。
- merge_owner: main_agent
- final_status_at_that_stage: WAITING_USER_CONFIRMATION

### `DISC-PM-02` 产品范围草案

- 状态：`DONE / agent_proposal / response_only`，未修改正式 PRD、Acceptance 或 TODO。
- 对象：新增的持久产品对象仅为 `Website Binding`；一次性 `Task Ticket` 是短期凭证，不成为第二套任务历史；`Project Chat Window` 只是现有项目会话的视图。
- 规则：网站来源解析绑定项目，每个 ticket 最多创建一个普通会话；网站不能追加既有会话，用户可在 AgentOS 继续；撤销绑定只阻止未来任务，不取消已运行任务。
- 窗口：主窗口和独立窗口共享 thread、transcript、Chat Run、sessionId、diff 与错误；各自保留当前 thread、草稿、尺寸和焦点。关闭窗口不取消任务。
- 权限：任务启动时沿用项目当时已选权限；网站不能回答权限请求或 Agent 提问。
- Runtime：Chat 只发出任务开始/终态意图，`npm run dev`、静态构建、last-good、端口和进程仍由 Runtime 唯一负责。
- 候选默认：Agent 成功后自动静态构建；v1 网站只获得接受/拒绝回执；关闭独立窗口后任务继续。三项待与体验和架构草案合并后交用户确认。

### `DISC-UX-02` Product Design Pack

- 状态：`DONE / DESIGN_PROPOSAL / response_only`，未修改业务文件或正式产品合同。
- 用户词汇：以“实时预览 / 已保存预览 / 更新预览”替代 dev server / static preview / rebuild；首次显示“正在准备首次预览”，无需用户点击构建。
- 页面职责：独立 Chat 窗口只承载现有 Chatbot 和项目会话；Preview、构建、日志和恢复动作留在主窗口 Runtime；网站只发起连接/任务并接收回执。
- 打断规则：外部任务到达时，若当前有草稿或 run，则不抢焦点、不切会话，只显示新任务徽标；否则聚焦新会话。
- 状态链：区分 Agent 成功与预览更新成功；构建失败显示“修改完成，但预览未更新”，保留 last-good 并提供“重试更新预览”。
- 无障碍：配对对话框、权限/提问焦点陷阱、阶段性 aria-live、错误与恢复动作关联、状态不可只依赖颜色。
- 候选默认：新任务不打断当前草稿；Agent 成功后自动更新已保存预览；v1 网站不接收运行过程或最终结果。

### `DISC-ARCH-02` Technical Architecture Draft

- 状态：`DONE / technical_architecture_draft / response_only`，未修改代码、正式 PRD 或 ADR。
- 唯一写入者：Main-owned Chat broker/Workspace store 负责 thread、transcript、run、sessionId、diff 和 revision；两个 renderer 仅为 typed IPC client。
- 网站协议：网站 HTTPS 后端持有短期 ticket；`agentos://` 仅唤醒并携带版本、动作、origin 与 request ID，AgentOS 从固定 well-known endpoint 获取 envelope，不接受任意 issuer URL。
- 一致性：ticket/idempotencyKey 映射到同一 command/thread；thread 先持久化再启动 SDK；事件使用 project/thread/request/sequence/routeGeneration fence。
- Preview：继续无 preload、sandbox；Main 只捕获明确的 `agentos://` 导航，并用 webContents/runtime/generation 校验来源。
- Runtime：Agent 成功后触发独立的 `runtimeSettle`；构建失败保留 last-good 且不反向改变 Agent 成功终态。
- 平台：macOS `open-url`、Windows/Linux `second-instance` 均需 cold/warm start 与打包 smoke；Electron 锁定版本为 30.5.1。
- ADR 候选：Main-owned broker；opaque deep-link + HTTPS ticket。当前未获写 ADR 授权，未落盘。

### `DISC-MERGE-02`

- 当时状态：完成，Decision Brief 已写入 `proposal.md`，当时仍是 `decision: draft`；后续由 `SPEC-02` 冻结为 accepted。
- 合并裁决：选择网站自有 HTTPS origin 的固定 well-known endpoint，避免本地 HTTPS 服务或可注入 issuer URL；新增绑定凭据不属于权限，且不出现在协议 URL。
- 合并裁决：用户看到的最小词汇固定为“实时预览 / 已保存预览 / 更新预览”；Agent 与 Preview 使用两个独立结果。
- 待确认组合：自动更新已保存预览；v1 网站只收接受/拒绝；关闭窗口继续任务且外部任务不抢当前焦点。

### 用户确认：实时预览交互原则（2026-08-27）

- 用户在收到“静态项目只在修改期间自动进入实时预览，全部项目修改任务结束后自动生成已保存预览；日常界面不再直接出现开发模式和重启”的方案后回复“可以，优化方案”。
- 确认范围：Runtime 用户词汇、自动进入/退出实时预览的总原则，以及隐藏 npm/dev/restart 技术概念；不构成业务代码、正式 PRD 或正式验收授权。

### ORCH-003

- skill: `product-design`
- actual_execution: subagents
- roles: `experience_designer=DONE@DISC-UX-RUNTIME-02/experience_flow_rev2; technical_architect=DONE@DISC-ARCH-RUNTIME-02/protocol_scheme_consult`
- task_mapping: `CONFIRM-RUNTIME-02 -> DISC-UX-RUNTIME-02 + DISC-ARCH-RUNTIME-02 -> DISC-MERGE-RUNTIME-02`

### ORCH-004

- date: 2026-08-27
- trigger: 用户选择 B，确认同一项目允许多个 Agent 会话并行修改。
- decision: 保留同项目并行能力，但必须补齐写入冲突检测、预览聚合、归因与最终构建规则；禁止静默 last-write-wins。
- roles: `experience_designer=DONE@DISC-UX-CONCURRENCY-02/experience_flow_rev2; technical_architect=DONE@DISC-ARCH-CONCURRENCY-02/protocol_scheme_consult`
- task_mapping: `CONFIRM-CONCURRENCY-02 -> DISC-UX-CONCURRENCY-02 + DISC-ARCH-CONCURRENCY-02 -> DISC-MERGE-CONCURRENCY-02`
- deviation: `technical_architect` 继续复用既有协议架构线程，补充 Runtime 状态契约；两项均为 response_only，无新增 writer。
- merge_owner: main_agent
- final_status_at_that_stage: DESIGN_MERGED; CHANGE_DECISION_REMAINS_DRAFT

### `DISC-UX-RUNTIME-02`

- 状态：`DONE / DESIGN_PROPOSAL revise / response_only`，未修改业务代码或正式产品合同。
- 两个 host 使用相同状态、按钮顺序和“更多”菜单；隐藏/恢复不重启 Runtime、不回放过期状态、不抢 Preview 焦点。
- 用户状态固定为“预览已更新 / 页面可能不是最新 / 正在修改项目 · 实时预览中 / 等待你的确认 / 正在保存最新预览 / 修改完成但预览未更新”。
- 网站任务、普通 Chat 与手动实时预览共享同一体验；普通问答不启动实时预览。
- Agent 与 Preview 使用独立结果矩阵；多会话尚未全部结束时不得显示“预览已更新”。
- 体验建议：Agent 失败/取消后若留下部分修改，不自动保存为正式预览。主 Agent 依据已确认的“失败/取消不触发静态构建”边界签署该建议。

### `DISC-ARCH-RUNTIME-02`

- 状态：`DONE / technical_architecture_draft / response_only`，未修改代码、PRD、ADR 或测试。
- 新增 Main 内存态 EditSession/EditLease，不新增持久任务历史或第二套 Runtime；同项目两个 host 仍共享 RuntimeInstance 并各有 PreviewSession。
- HMR 不触发 Main 重启；soft reload 不重启进程；只有进程/health 或可靠依赖与受控配置信号触发合并的 hard recovery。
- final settle 以 editGeneration、sourceFingerprint、settle/build operationId 为 fence；新 run 或 mutation 使旧 settle/build 失效，last-good 仅由仍有效的成功构建原子替换。
- 静态、development-only、static-only/no-dev-script 分别降级；失败/取消、外部或未归属变化均不自动 build。
- Rev5 保持普通 stale + 手动更新，只为成功且可归属的 Agent edit session 增加一次自动 build。

### `DISC-MERGE-RUNTIME-02`

- 状态：完成，开发级状态合同已合并进 `proposal.md`，没有同步正式 PRD/TODO/Acceptance 或业务代码。
- 裁决：失败/取消产生的半成品不自动保存；保留 Diff、源码与 last-good，并引导继续修改、撤销或手动更新。
- 裁决：不把 debounce/静默期具体毫秒数写成产品承诺，交由实现基于 fixture 与真实项目调优。
- 当时待确认：v1 同项目 write-capable 修改任务采用项目级排队或并行；用户随后选择 B，并由 `DISC-MERGE-CONCURRENCY-02` 取代排队建议。

### 用户确认：同项目并行修改（2026-08-27）

- 用户在同项目修改会话“排队 / 并行”的选择中回复 `B`，确认同一项目允许多个 Agent 会话并行修改，跨项目仍可并行。
- 本轮把 B 解释为“共享工作区并行 + 禁止静默后写覆盖”，不扩张为每个会话独立 worktree、独立预览或第二套项目事实。

### `DISC-UX-CONCURRENCY-02`

- 状态：`DONE / DESIGN_PROPOSAL revise / response_only`，未修改业务代码或正式产品合同。
- 项目级显示“正在修改项目 · N 个会话”，会话级保留独立运行、等待、失败与冲突状态；两个 Host 显示同一份共享工作区。
- 不同文件直接并行；同一处冲突先由 Agent 自动读取最新内容并重新处理，无法安全解决时只暂停受影响会话，其它会话继续。
- 冲突只在无法自动恢复时打断用户；用户不接触 hash、rebase、版本号、npm 或 build 等技术概念。
- 最终“预览已更新”必须等待所有相关修改完成、冲突与失败遗留处理完毕，并成功保存最新共享结果。

### `DISC-ARCH-CONCURRENCY-02`

- 状态：`DONE / technical_architecture_draft / response_only`，未修改代码、PRD 或 ADR。
- Main-owned `MutationCoordinator` 按项目聚合多个 run，但只按单文件工具调用加短时 path lock，不建立项目级写入队列。
- 受控 Read/Edit/Write 通过每 run 已观察版本、mutation sequence、写前/写后内容校验阻止过期覆盖；冲突写入被拒绝并要求 Agent 重新读取，而非静默 last-write-wins。
- Bash、MCP、子进程与普通外部写入不能可靠归因时标记 unknown/external，并禁止当前 generation 自动 build；不通过解析命令猜测安全性。
- 一个项目继续只有一个共享 dev Runtime；build 以 editGeneration、operationId 和 source fingerprint 为 fence，新 run 或 mutation 使旧结果失效。
- v1 不引入 per-run worktree，因为它会拆分共享源码和预览事实，并显著增加 merge、依赖和路径映射复杂度。

### `DISC-MERGE-CONCURRENCY-02`

- 状态：完成，用户选择 B 已合并进 `proposal.md` 的开发级状态合同；没有同步正式 PRD/TODO/Acceptance 或业务代码。
- 裁决：体验层“自动整理”由受影响 Agent 在写入被安全拒绝后重新读取并应用意图完成，Main 不自行猜测源码合并。
- 裁决：同文件冲突只局部影响相关会话；unknown/external 或写后不一致不会自动回滚源码，但阻止自动生成已保存预览。
- 裁决：只有最新 editGeneration 的所有相关写入成功且无未解决冲突/未知变化时，才构建一次共享最终结果。

## 撤销并发写入安全合同（2026-08-27）

- trigger: 用户在过度设计复核中确认“这个直接删掉就行，其实不用管”。
- scope: 撤销 `DISC-ARCH-CONCURRENCY-02` / `DISC-MERGE-CONCURRENCY-02` 合并进 `proposal.md` 的写入协调机制，并压缩 Final settle 的前置条件。保留用户选择 B 的产品行为（同项目多会话可并行）。
- 已从 `proposal.md` 删除：`MutationCoordinator`、每文件 path lock、写前内容版本校验、写后 `post-write-mismatch`、冲突重放与局部暂停、`unknown/external` 与 `unattributedDirty` 归因、以及基于上述状态的收口前置条件与“需要处理修改冲突”文案。
- 已保留：同项目多会话并行、共享单一 RuntimeInstance 与 editGeneration、“任一相关会话未终态不得显示预览已更新”、generation fence 与 last-good 原子切换。
- 撤销依据（不新增机制即可覆盖的部分）：
  - 不同文件并发写入本身无竞争；这是绝大多数情况。
  - 同一文件不同位置：`Edit` 按精确字符串匹配，落到新内容上仍能命中，两边改动都保留。
  - 同一文件同一处：`Edit` 的 `old_string` 匹配失败，工具直接报错，Agent 自行重读重试。即原设计中“拒绝过期写入 + 重读重放”由 SDK 工具语义天然提供，无需 Main 侧重建。
- 残留风险（已接受）：`Write` 全量覆盖同一文件时可能静默丢失另一会话的改动。判定为可接受，依据是发生频率低、失败可见（`git diff`）、可一条命令还原；已核实 `/Volumes/macOS/Github/homepage` 与 `/Volumes/macOS/Github/codenow.wiki` 均为 git 仓库。
- 保留的必要约束及其成本：收口前必须确认该项目下没有其它活跃 write-capable run，否则会在源码只改了一半时自动 build 并宣称“预览已更新”。该约束只需活跃 run 计数，不需要协调器。
- 重新启用条件：出现真实的丢改动案例（用户可复述、且能定位到并发写入）。届时优先评估最小手段（例如仅对 `Write` 全量覆盖做单文件版本校验），而不是恢复整节合同。
- 当时未同步正式 PRD / Acceptance / TODO；后续 `SYNC-02` 已同步。`tasks.md` 中 `DISC-UX-CONCURRENCY-02`、`DISC-ARCH-CONCURRENCY-02`、`DISC-MERGE-CONCURRENCY-02` 作为历史事实保持已完成，不回改。

## `CONFIRM-02` / `SPEC-02` / `SYNC-02`（2026-08-27）

- trigger：用户连续要求“先基于事实来统一”“怎么把 spec 写清楚，因为要让 terra 来开发”，随后明确要求“那你来出 spec 和 TODO”。
- interpretation：接受已合并 Decision Brief 与三个建议默认合同，并授权产出开发规格/TODO；不构成业务代码实现或正式验收授权。
- current decision：`proposal.md decision=accepted`；`coverage_gate=ready_for_implementation`；delivery 仍为 in_progress。
- fact audit：确认当前 `agent-command-channel` 位于 renderer、`claude-chat:*` IPC 直接调用一个绑定主窗口 WebContents 的 runner、同 thread 新 submit 会取消旧 run、权限模式在 Chat renderer 本地持久化、second-instance 尚未解析 deep link。Revision 2 规格以这些 as-built 差距为迁移起点。
- frozen defaults：网站只收 accepted/rejected；关闭独立窗口 run 继续且新任务不打断草稿/active run/prompt；静态项目成功 Agent edit settle 后自动更新已保存预览。
- permission clarification：当前代码不是 project-level permission store。为避免无依据新增作用域，v1 冻结为 app-global、Main-authoritative、所有窗口同步、submit 时捕获，默认 `auto`。
- spec outputs：`README.md`、`design.md`、`technical.md`、`protocol-v1.md`、`acceptance.md`。
- execution outputs：初版 `work-orders/` 共 13 单；M0 实施复核后按真实缺口插入 M0-05A–M0-05F，其中 E 已冻结、F 在 E 复核后生成，最终索引为 19 单。M0 串行，M0 Gate 后 M1/M2 可按依赖并行，每单包含精确 write allowlist、测试、完成与停工条件。
- formal sync：`prd/chat-agent-runtime/{README,technical,acceptance}.md` 已同步 Revision 2 planned 合同；根 `TODO.md` 与 `prd/README.md` 已更新。正式 Acceptance 仍全部未执行。
- no business code：本次只修改文档；用户已有的 `AGENTS.md` 删除和其它业务代码脏改动未被覆盖或清理。

### M0-01 Terra preflight 修订

- Terra 在未修改文件、未运行测试前触发停止条件：M0-01 原任务单要求覆盖“未知 request”，但 `technical.md §5.3` 把 unknown requestId ownership/丢弃/计数明确归给 M0-02 `ProjectChatBroker`。
- 判定：Terra 停止正确；技术架构无冲突，work-order 拆分存在一条越界测试要求。
- 修订：M0-01 只测试 runner 单次 event publish、sink failure 不终止 run，以及 caller 已解析归属后的 pure reducer terminal fence；明确禁止提前建立 request registry 或 unknown filter。
- 修订：M0-02 新增 unknown requestId 丢弃、脱敏计数、不写 workspace、不广播的明确步骤和断言；`technical.md §5.3/§14` 同步分开 Runner 与 Broker 职责。
- 状态：`M0-01` 仍为未开工，可在相同 work order 上重新执行；没有业务代码需要回滚。

### M0-01 首轮实现复核

- Terra 已实现共享合同、纯 reducer、runner event sink 与 WebContents adapter；没有提前实现 request ownership/unknown-request。
- 独立复跑：目标 Node tests 16/16 PASS，`npm run typecheck` PASS，`git diff --check` PASS。
- 尚未关单的合同缺口：`ProjectChatPromptSnapshot` 使用完整 raw event 且缺少 promptId/kind/owner/createdAt；cancel/answer 缺 threadId/promptId；view state 缺 schema/project/seen/updated 字段；`WebsiteBindingPublic` 字段与 §9 不一致。
- 尚未关单的单一实现缺口：`src/components/chat/chat-run.ts` 仍保留完整 `foldChatRunEventLegacy` 与 helper 副本，不是薄 adapter，形成两套可漂移 fold 规则。
- 裁决：M0-01 保持 in progress，不进入 M0-02；先完成精确 DTO + reducer 去重的小范围收尾，再复跑同一门禁。

### M0-01 收尾复核与关单

- Terra 已逐字段修正 Prompt、cancel/answer、window view state/save patch 与 WebsiteBindingPublic，并加入 compile-time exact type fixtures。
- `src/components/chat/chat-run.ts` 只保留调用 `project-chat-reducer.ts` 的薄 `foldChatRunEventLegacy`；fold/helper 实现只存在于新 pure reducer。
- 独立复跑：`npm run typecheck` exit 0；目标 Node tests 16/16 PASS；`git diff --check` exit 0。
- 边界复核：未建立 requestId registry，未实现 unknown-request 过滤/计数；这些仍归 M0-02。
- 结论：M0-01 PASS/closed；真实 Electron/Claude SDK 集成留在 M0 Gate，不影响进入 M0-02 core implementation。

### M0-02 preflight allowlist 修订

- Terra 在未写 M0-02 文件前停止：`WorkspaceThread.creationSource` 冻结为必填，但现有两个类型化构造点位于未授权的 `src/components/workspace-session.ts`。
- 独立审计确认：普通 addThread 与 task-run ensure 是两个直接 `WorkspaceThread` 构造点；AppShell 的其它入口均经 WorkspaceSession，无需扩张到 React TSX。
- 修订：M0-02 allowlist 增加 `src/components/workspace-session.ts` 与其既有测试；creation-source 联合放在 `components/types.ts`，WorkspaceSession input 可选但持久 WorkspaceThread 必填，省略归一为 user。
- 状态：Terra 停止正确；M0-02 仍未开始写入，可按更新任务单继续。

### M0-02 首轮实现复核

- 已实现 broker 串行队列、revision、request route、unknown count、terminal/generation event fence、prompt registry，以及 creationSource JSON/SQLite 迁移；Terra 报告目标测试 42/42/typecheck/diff check PASS。
- 复核发现未覆盖缺口：website create variant 缺 bindingId/receivedAt 因而 broker 永远拒绝；runner payload 未从 durable thread 带 sessionId/modelPick；Prompt owner reassign 未移除失效 owner；旧 generation run 仍显示且永久参与 thread-busy。
- 补充风险：getSnapshot 未排入 operation queue；默认时间戳 ID 同毫秒可能碰撞；answer runner throw 会 reject 且可能缺乏稳定业务错误；现有 creationSource 测试可能由 JSON fallback 通过，未独立证明 SQLite 恢复。
- 裁决：M0-02 保持 in progress；上述均为既有 broker/迁移合同的收尾，不扩入 M0-03 或生产 wiring。

### M0-02 补单复核与关单

- Terra 已补齐 website source durable metadata、durable cwd/session/model payload、submit 时 permission 捕获、Prompt owner 真正 failover、answer failure 保留 waiting 状态、route-generation 可见性/busy fence、线性化 snapshot、UUID 默认 ID，以及独立 SQLite migration/round-trip 断言。
- 独立复跑：`npm run typecheck` exit 0；`node --test electron/project-chat-broker.test.mjs electron/chat-workspace-store.test.mjs electron/workspace-session.test.mjs electron/chat-run.test.mjs` 46/46 PASS；`git diff --check` exit 0。
- 边界复核：`electron/main.ts`、preload、React 与旧 `claude-chat:*` production 路径未接入 broker；M0-02 仍是可注入、可测试的 broker core，不存在中间态双 writer。
- 结论：M0-02 PASS/closed；进入 M0-03 前先把任务单中的旧 IPC 委托描述修正为“只实现 disabled seam”，production cutover 仍唯一归 M0-05。

### M0-03 实现复核与关单

- 已实现集中 Project Chat channel、完整 typed preload adapter、严格 `senderFrame === mainFrame`/renderer document/project/generation capability router、app-global permission missing/valid/invalid 迁移，以及在 broker queue 上不增加 workspace revision 的全项目 snapshot 广播；整个 seam 未在 `main.ts` 注册。
- 安全复核补齐：renderer 不能伪造 `source='website'`；Prompt `promptId` 必须等于 response `permissionRequestId` 且 broker 再做防御校验；项目窗口可修改 app-global permission 但 stale generation 被拒；Binding list/revoke/permission initialize 仅 main-window capability 可用。
- 独立复跑：`npm run typecheck` exit 0；`node --test electron/project-chat-ipc.test.mjs electron/desktop-seam.test.mjs electron/project-chat-broker.test.mjs electron/chat-run.test.mjs` 38/38 PASS；`git diff --check` exit 0。
- 边界复核：旧 `claude-chat:*` handler 与 WebContents sink 仍完整走 Revision 1；没有 `project-chat:*` production handler、真实 BrowserWindow 或 React cutover。真实 Electron `senderFrame` 身份留 M0 Gate 验证，代码在缺失/不相等时默认拒绝。
- 结论：M0-03 PASS/closed。M0-04 继续只建立不可达的 window/view-state seam；production Main composition 与 renderer 单 writer cutover 仍留 M0-05。

### M0-04 实现复核与关单

- 已实现一项目一 BrowserWindow manager、固定 `--agentos-window-kind=project-chat` preload profile 参数、同 bundle 最小页面路由、最小无 path 项目摘要，以及 schema v1 view-state 原子 store/300ms controller。
- 生命周期复核补齐：capability 注册失败或 load reject 会 cleanup 后销毁失败窗口；close/closed/webContents destroyed 幂等 unregister、map cleanup 与单次 `onWebContentsUnavailable`，且不触发 cancel。
- 持久化复核补齐：完整 read-merge-write 串行化，不同项目并发保存不争用 temp；copy-on-write 只在 rename 成功后更新 cache，失败后仍读取旧 durable state且可重试；draft 100,000/100,001、corrupt backup、bounds 可见性均有断言。
- 独立复跑：`npm run typecheck` exit 0；任务单六个目标测试文件共 40/40 PASS；`git diff --check` exit 0。
- 边界复核：`electron/main.ts`、preload、runner、ChatPage 与旧 production handlers 未改；manager 只能由测试构造，最小页面在当前 production 不可达。
- 结论：M0-04 PASS/closed。进入 renderer cutover 前需先冻结 scoped preload 与现有 Chat 全功能所需的 project-scoped 命令/只读 DTO，并把 Main composition 与 renderer 改造拆成可回滚小单。

### M0-05A 实现复核与关单

- 已实现 project-window 精确 additionalArgument preload profile：项目 profile 只暴露 `projectChat`，主 profile 保留既有 `desktop`/`claudeChat` 并增加 disabled `projectChat`；query/hash 不能改变 profile。
- 已增加六个 project-scoped typed read/selection capability 与 exhaustive channel/preload/router forwarding；router 只注入 collaborator，未在 Main 注册或实现真实 filesystem/settings/dialog 依赖。
- attachment 边界已按实际 UTF-8/严格 base64 解码内容重算 8 个、512 KiB、5 MiB、24 MiB 限制，不信任 renderer size；加入 MIME magic、pre-decode encoded-length、id/name/preview 上限、跨平台 basename、relative path normalizer 和 Windows/POSIX traversal 负例。
- snapshot 不再暴露 `WorkspaceThread`：getSnapshot/broadcast 共用显式 `ProjectChatThreadSnapshot` projector，移除 session/cwd/creationSource/binding/skillPath/task metadata、attachment/diff absolute path、checkpoint/internal requestId；恶意 relativePath/name 与 thread-status scope mismatch 默认失败或安全投影。
- 独立复跑：`npm run typecheck` exit 0；`node --test electron/project-chat-ipc.test.mjs electron/project-chat-contract.test.mjs electron/project-chat-broker.test.mjs electron/desktop-seam.test.mjs` 38/38 PASS；`git diff --check` exit 0。
- 边界复核：`electron/main.ts`、真实 runner、window manager、React、workspace store/session 与 Revision 1 production handler 未改；M0-05A 仍是 disabled seam。
- 结论：M0-05A PASS/closed。下一单先实现 broker-owned thread mutation intents（M0-05B），不直接派发原先职责过宽的 renderer cutover。

### M0-05B 实现复核与关单

- 已将 fork、edit-resubmit、archive、显式 pin、model 与 diff-review 六个 durable thread mutation 收进 broker，同步贯穿冻结 contract、集中 channel、project-only preload 与 capability router；renderer 不能提交完整 thread/chat/transcript 或 authority 字段。
- 复核修正了三个状态边界：旧 route generation prompt 不再造成当前 generation `thread-busy`；orphan thread 不能绕过 durable project ownership；已归档 source 仍可 fork，但 submit/edit/model/review 按合同拒绝。
- reset/model 语义在 save 前完成，失败不写 store、不增 revision、不广播、不 submit；首次标题、并发 mutation、SDK submit failure、缺失 diff、`now()=0` pin 幂等和六路 IPC sender/frame/document/project/generation 隔离均有专项断言。
- 独立复跑：`npm run typecheck` exit 0；`node --test electron/project-chat-broker.test.mjs electron/project-chat-ipc.test.mjs electron/project-chat-contract.test.mjs electron/desktop-seam.test.mjs` 49/49 PASS；`git diff --check` exit 0。
- 边界复核：`electron/main.ts`、真实 runner、React、workspace store/session 与 Revision 1 production handler 未改；M0-05B 仍是 disabled seam。
- 结论：M0-05B PASS/closed。下一单先让 broker 与现有 Main workspace mutations 共用唯一 operation coordinator（M0-05C），之后才允许设计 production composition/cutover。

### M0-05C preflight 事实修订

- Main save 调用点审计共发现七处；其中六处已在 `runChatWorkspaceOperation` 内，`resolveProjectRuntime(..., trust=true)` 的 Runtime definition save 是唯一逃逸点。
- 原任务单若保持“main.ts 只改 wrapper/init”会按停止条件必停，且直接用锁外 `currentState` 包一层 save 仍会覆盖 coordinator 等待期间的新 workspace 事实。
- 规格已冻结窄修复：inspect/trust grant 可锁外 preflight；最终 commit 取得唯一 coordinator 后 fresh-read project/runtimeDefinitions、重验 project path、基于最新 state 重算 definition/revision、save/readback；成功 runtime/host 副作用在 commit 后，失败的新 trust grant 维持 revoke 补偿。
- M0-05C allowlist 只为这一已知 Main 调用点扩张；若再发现其它逃逸 save 或必须改 Runtime module/renderer，仍停止报告。

### M0-05C 实现复核与关单

- 新增唯一 `ChatWorkspaceCoordinator`：FIFO、同步 throw/异步 reject 原样返回且不阻塞后续，`idle()` 等待已提交 operation；Main 旧 `chatWorkspaceOperationChain` 已删除，wrapper 在 store 初始化后只委托 coordinator，初始化前明确失败。
- broker 注入 external scheduler 时在调用当下直接提交完整 operation，不再经过私有 Promise microtask；私有 chain 仅供 isolated 默认。真实 marker 证明 broker-first 为 `broker:read → broker:save → main:mutation`，Main-first paused 时 broker 在 release 前零 read，external `idle()` 不提前。
- external scheduler 专项覆盖 getSnapshot/create/submit/publish/broadcast；组合 state 保留 Main runtime/sidebar 与 broker thread mutation，revision 连续、广播读取 committed state。
- `resolveProjectRuntime(..., trust=true)` 已收进唯一 writer：锁内 fresh-read project/runtimeDefinitions、path revalidation、基于最新 state 重算/save/readback；stale/save failure 补偿新 trust，runtime/host 注册在 commit 成功后。
- source audit 使用 TypeScript AST 找到恰好七个 workspace save，并逐个验证函数祖先是 `runChatWorkspaceOperation` callback，避免字符串 `lastIndexOf` 假阳性。
- 独立复跑：任务单目标 Node tests 61/61 PASS；`npm run test:electron` 在允许本地回环监听后 199/199 PASS；`npm run typecheck` 与 `git diff --check` exit 0。
- 边界复核：没有注册 `project-chat:*` handler、没有实例化 production broker、没有切换 runner sink/旧 `claude-chat:*`，preload/React/Runtime module 未改。
- 结论：M0-05C PASS/closed。原 M0-05 仍不能直接派发；先冻结 production runtime adapter、真实 scoped collaborators、prompt presence/rewind 与 Main composition 的可回滚边界。

### M0-05D 派发前事实冻结

- 当前 `ProjectChatScopedReadCollaborator` 只是注入 seam；Main 尚未提供真实 settings/context/search/dialog/attachment/status 实现，broker runner port 也尚未与同一 `ClaudeAgentRunner` 做 production adapter。
- M0-05D 只补可注入真实 services：durable project/thread authority、settings/status/context/file 脱敏投影、附件 root/candidate realpath containment，以及 `resetThread -> newThread` adapter；不注册 IPC、不切 sink、不改 renderer。
- env config 不合成虚构 model provider；model catalog 只投影 settings providers 且完全排除 env/credential/URL/auth 字段。status 只用 durable cwd/session/modelPick 并固定 `refresh:false`。
- 本单明确不解决 sink 构造、prompt presence/rewind、TaskHome managed run 与 feature flag composition；原 M0-05 继续禁止派发。

### M0-05D 实现复核与关单

- 新增无状态 runner adapter，`submit/cancel/answer` exact delegate，`resetThread` 只映射同一 runner 的 `newThread`；没有 request/event ownership。
- scoped services 每次 fresh-read durable workspace/settings；context/search/status 只返回 public DTO，status payload 只取 durable cwd/session/modelPick 并固定 `refresh:false`；settings/env credential、URL、auth 与 status runtime sentinel 不外泄。
- attachment 在 reader 前 canonicalize root/candidate 并执行 containment；missing/root-self/symlink escape 只产生 generic skipped。复核发现并修正真实 search 返回形状与 POSIX 下 Windows separator candidate 构造，新增回归锁定。
- 独立复跑：`npm run typecheck` PASS；任务单目标 Node tests 53/53 PASS；`npm run test:electron` 在允许本地回环监听后 204/204 PASS；`git diff --check` PASS。
- 边界复核：Main/runner/broker/preload/React 未改，没有 IPC registration、sink composition 或 feature flag；M0-05D PASS/closed。

### M0-05E 派发前事实冻结

- 原 M0-05 需要 pending prompt owner 与 rewind UI，但当前 broker prompt 只提供手工候选 seam，系统没有可信 visible/focused/selected-thread presence；ProjectChatAPI 也没有 rewind，旧 UI 仍把 checkpoint/request/cwd/model 直接交给 legacy bridge。
- 冻结 Main-owned presence：renderer 只能报告 selection，visibility/focus/capability/generation 全由 Main；owner 创建时按三段优先级选择，已显示的 visible owner 保持稳定，hide/destroy 才 failover。
- 冻结 broker-owned rewind：renderer 只发 project/thread/changeSet/generation，broker 从 durable diff/thread/project 解析 checkpoint/request/session/model/cwd，direct result 是唯一 durable mutation，terminal emitted event 不得双写。
- 剩余前置不再开放式增加：M0-05E 后只允许一张 M0-05F default-off production composition，再立即派发 renderer cutover。

### 2026-08-29 主侧边栏归档/置顶 Cutover 缺陷核查

- 用户报告新增网页 Runtime 后，侧边栏会话删不掉或右键删除无反应。代码核查确认右键菜单和垃圾桶按钮均正常进入 `requestArchive -> AppShell.archiveThread`，原生 Preview bounds 取内容宿主 `getBoundingClientRect()`，没有覆盖侧边栏；故排除菜单 handler、CSS z-index 和 Preview 点击拦截。
- 根因是 M0-05 renderer cutover 漏接两条已在 M0-05B 提供的 Main intent：`AppShell.archiveThread` 仍调用 `workspaceSession.archiveThread`，`toggleThreadPinned` 仍调用 `workspaceSession.toggleThreadPinned`。
- `projectChatEnabled=true` 时 `WorkspaceSession.stage(chatWorkspace)` 被明确跳过，因此上述本地 thread mutation 不会保存到 Main。`applyProjectChatSnapshot` 又会按 project 整批替换 threads，Main 中未归档/未置顶的旧事实会覆盖 renderer 本地变化。
- RuntimeEditCoordinator 的 `onSnapshot` 会触发 `projectChatBroker.broadcastProjectSnapshot`；run 注册、工具 lease、mutation、terminal 与 settle 均可 publish，因此 Runtime 活跃时回滚通常发生在用户可观察到本地隐藏之前，表现为“没有反应”。即使没有 Runtime 广播，切项目、刷新 snapshot 或重启也会恢复 Main 事实。
- broker 已有完整、测试通过的 `archiveThread` 和显式 `setThreadPinned`，并冻结 active run/prompt 返回 `thread-busy`、不隐式 cancel 的合同；P0 不需要修改 Main/broker/IPC，只需修复主 renderer 接线、busy 提示、generation/readiness 和回归测试。
- 相邻影响审计发现：broker mode 关闭的是整个 renderer full workspace autosave，而项目置顶/排序/移除/迁移、sidebar/project collapse、project home view 及部分 home-plugin/task/skill seed 仍存在本地 `WorkspaceSession` 调用。它们不能通过重新开启 `saveChatWorkspace(fullSnapshot)` 修复，否则会恢复 Main/renderer 双 writer并覆盖 broker transcript。已在 `FIX-CHAT-01` 冻结 P1 ownership audit：逐项归类为窄 Main command、独立 view-state 或 legacy-only，并在需要时拆后续工单。
- 本轮仅完成诊断与 change 写入：`npm run typecheck` exit 0；目标 broker/workspace 测试通过；工作区在写入 change 前干净。未改业务代码，不声明缺陷已修复，`CHECK-02` 新增 `FIX-CHAT-01` 前置。

### 2026-08-29 `BUG-AUDIT-WS-02` Workspace ownership 与过度设计复核

用户要求复核本 change 还有哪些 bug 要修、方案是否过度设计。仅做代码核对与 change 写入，未改业务代码。`npm run typecheck` exit 0；完整 `npm run test:electron` 在当前受限环境未跑完（与既有 loopback fixture 限制一致），因此下列结论全部来自源码核对，不引用测试结果。

#### 事实修正

- `README.md` 与 `changes/INDEX.md` 长期声明"业务实现未开始 / implementation pending"，与代码不符：`M0-01`–`M2-02` 共 19 单均已实现并关单。已按事实更新。
- `projectChatBrokerV2Enabled` 返回 `environment.AGENTOS_PROJECT_CHAT_BROKER_V2 !== '0'`（`electron/project-chat-composition.ts:7`），Project Chat broker **在生产里默认开启**。`work-orders/README.md` 中"M0 未通过前默认关闭"的描述已失效并更正。缺陷影响面必须按默认开启计算。
- `design.md` §3.5 冻结的 `M3-01` 已实现于 `electron/workspace-tab-project.ts` 与 `electron/workspace-tab-project-chat.ts`，但 `tasks.md` 与 `work-orders/` 中**没有对应任务单**，属于 work order 执行规则 1/3 的一次实际失效。已补记，不追溯回滚。
- `ATDD-CHAT-207`–`209` 与 `ATDD-WS-201` 此前只存在于本 change 的 `acceptance.md`，未写入被声明为"唯一事实源"的 `prd/chat-agent-runtime/acceptance.md`。已回补 GWT，并在 change 侧 `acceptance.md` 顶部写入同步义务。

#### 新发现缺陷（`FIX-WS-01`）

- **P0 新建项目既不落盘也不可用。** 逐跳核对：`createProject` / `createProjectFromExistingPath` 只调 `workspaceSession.addProject`（`src/components/AppShell.tsx:1446`、`:1479`）→ autosave 在 broker 模式整条跳过（`:1103`）→ Main 侧不存在任何创建项目命令 → `ProjectChatBroker.getSnapshot` 对不在 Main store 的项目返回 `project-not-found`（`electron/project-chat-broker.ts:118`）→ `ChatPage` 在 `projectChatEnabled` 时无条件走 `api.createThread` / `api.submitRun`（`src/components/chat/ChatPage.tsx:1567`）。结果：工作区只要已有一个项目，之后新增的项目立即进入"发消息报错 + 重启后消失"。`BUG-AUDIT-CHAT-01` 把该项并入 P1 一行，严重度定级错误。
- **P0 项目移除/重定位/置顶/排序不落盘**（`AppShell.tsx:2131`、`:2162`、`:2109`、`:2114`）。其中 `relocateProject` 是 Main `openProjectPathRecovery` 路径丢失恢复流程的终点，因此恢复动作本身也不落盘。
- **P1 侧栏收起、项目折叠、项目首页 Overview/Runtime 页签不落盘**（`AppShell.tsx:2119`、`:2123`、`:549`）。
- **P1 投影降级字段**：`projectChatThreadToWorkspaceThread`（`src/components/workspace-session.ts:137`）硬编码 `creationSource: { kind: 'user' }`、丢弃 `skillPath`、attachment `path` 置空；`src/components/chat/ProjectChatWindowPage.tsx:233` 同样。当前不致命只因 renderer 已不回写 thread。处置：`FIX-WS-01` 不补字段（补字段会把 `creationSource.bindingId` 等 website 元数据推进主窗口投影），改为让新命令 DTO 结构性拒绝 threads/projects 载荷，使投影永久 view-only。

#### 新发现缺陷（`FIX-CHAT-01`）

- **P0 归档运行中会话三方不一致**：`AppShellSidebar.requestArchive` 只对 `purpose === 'task-run'` 检查运行状态（`src/components/AppShellSidebar.tsx:460`）；`AppShell.archiveThread` 对 `skill-run` 走 legacy `window.claudeChat.cancel`、对普通线程完全不取消（产生孤儿 run）；文案 `sidebar.confirmRemoveRunningTask` 承诺"会先终止当前运行并归档"；broker 冻结合同却是 `thread-busy` 拒绝且不隐式 cancel。
- **P1 readiness 单布尔**：`projectChatEnabled` 初值 `false`（`AppShell.tsx:292`）直到首个 `getSnapshot` 成功才置 true（`:464`），用同一个值表达 probing 与 legacy，启动窗口内的工作区变更会走 legacy full-snapshot writer。
- **P2 `runtimeEditStatus` 三条状态文案硬编码中文**（`src/components/runtime-event-state.ts:12`），未走 i18n。记录为 `CHECK-02` 的收尾项，不单独派单。

#### 结论与派单

- 根因是一次半迁移，不是若干独立 bug：`M0-05` 迁移 thread 事实并关闭 renderer durable writer，却把 project / sidebar / view 事实留在原地。
- `FIX-CHAT-01` 原范围只覆盖 thread 一半，且其 allowlist 明确禁止改 `electron/main.ts`/broker/IPC，无法承载 P0 项目命令。因此拆分：新增 `FIX-WS-01` 承担 ownership 收口，`FIX-CHAT-01` 收窄为 thread mutation + busy 合同 + readiness 三态，顺序固定 `FIX-WS-01 -> FIX-CHAT-01 -> CHECK-02`。
- 过度设计复核结论与处置见 `proposal.md` 的「Revision 2 范围复核（2026-08-29）」；其中 M1 网站入口的拆分建议为**待用户决策**，本轮未执行。

### 2026-08-29 `FIX-WS-01` 实现与自检

#### 交付

- 新增 `src/workspace-commands.ts`：workspace 命令的**唯一纯定义**（判别联合、严格 parser、转换函数、回读断言）。`WorkspaceSession` 的 `addProject / removeProject / relocateProject / toggleProjectPinned / reorderProject` 改为委托同一批纯函数，Main 与 renderer 不再各有一份实现。
- 新增通道 `chat-workspace:command`（`DESKTOP_INVOKE_CHANNELS.applyWorkspaceCommand`）、preload typed 转发、`electron/main.ts` handler：`isAuthorizedMainWindowInvoke` → 严格 parse → `runChatWorkspaceOperation` → `expectedRevision` 门槛 → `withNextWorkspaceRevision` → `save` → **回读校验** → 返回权威快照。
- 新增 `src/components/workspace-command-client.ts`：串行提交、`workspace-conflict` 单次 fresh-read 重试、偏好 300ms 去抖合并、卸载前 flush，以及 `adoptAuthoritativeWorkspace`（采纳 Main 快照但保留 renderer 自有的 selection）。
- `AppShell` 六个入口改为只发意图：`createProject` / `createProjectFromExistingPath` / `removeProject` / `relocateProject` / `toggleProjectPinned` / `reorderProject`，以及 `toggleSidebarCollapsed` / `toggleSidebarProjectCollapsed` / `setProjectHomeViewMode`（乐观本地 + 去抖命令）。命令路径**不按 `projectChatEnabled` 分支**，legacy 与 broker 共用。

#### DTO 结构隔离（替代补投影字段）

命令联合不含 `threads` / `projects` / `chatState` / `workspaceRevision` 等快照字段，未知键与 renderer 传入的项目 id 一律整条拒绝（`invalid-command`）。因此 `projectChatThreadToWorkspaceThread` 的降级字段（`creationSource` 归一为 `user`、丢 `skillPath`、attachment `path` 置空）**在结构上不可能**被写回 Main，`BUG-AUDIT-WS-02` 的 P1-2 按不变量关闭而不是补字段——补字段会把 `creationSource.bindingId` 等 website 元数据推进主窗口投影，扩大脱敏面。

#### `ATDD-WS-201` 归属矩阵（关单形式）

| mutation | 归属 | 介质 | 代码位置 |
| --- | --- | --- | --- |
| 项目创建/移除/重定位/置顶/排序 | Main durable command | `ChatWorkspaceStore` | `electron/main.ts` `applyWorkspaceCommand` handler；`src/workspace-commands.ts` |
| 侧栏收起 / 项目折叠 / 项目首页页签 | Main durable command（`preferences.set`，去抖） | `ChatWorkspaceStore` | `AppShell.toggleSidebarCollapsed` / `toggleSidebarProjectCollapsed` / `applyProjectHomeViewMode` |
| thread 归档/置顶 | Main broker intent | broker | `src/components/project-chat-thread-intents.ts` |
| task-run thread seed | Main | broker | `electron/task-home-plugin-manager.ts` `runPort.ensureThread`（renderer `ensureTaskRunThread` 仅在 legacy 生效） |
| workspaceTabs / runtimeDefinitions | Main 原子接口（既有） | `ChatWorkspaceStore` | `create/open/close/rename/relocateWorkspaceTab` |
| hidden skill paths | renderer-local | `localStorage` | `AppShell.hideProjectSkill` |
| 主窗口 selected project/thread/tab | renderer-local selection | 内存 | `adoptAuthoritativeWorkspace` 显式保留 |
| 项目窗口 selected thread / draft / bounds | Main view-state（既有） | `ProjectChatViewStateStore` | `electron/project-chat-view-state-store.ts` |

无剩余"待定"项。

### 2026-08-29 `FIX-CHAT-01` 实现与自检

- `archiveThread` / `toggleThreadPinned` 在非 legacy 下只调用 `window.projectChat.archiveThread` / `setThreadPinned`，DTO 使用 **target project 自己的 `routeGeneration`**（`ProjectChatSnapshotController.snapshot(projectId)`，缺失时 fresh-read），`stale-revision` 最多一次 fresh-read 重试，per-thread + per-action pending fence 防重复提交。成功后不再调用任何 renderer durable reducer。
- busy 判定改为读 snapshot 的 `runs`（非终态）与 `pendingPrompts`，覆盖普通、`task-run`、`skill-run`；broker 路径下 `archiveThread` **移除**了原先的 `claudeChat.cancel` 与 `stopTaskHomePlugin` 前置调用，改为固定提示 `sidebar.archiveBusyThread`（中英文）。
- 三方不一致的收敛方式：`sidebar.confirmRemoveRunningTask`（承诺"会先终止当前运行"）被限制在 legacy 分支——在那条路径上该承诺是**真实**的，因为 legacy 确实先停后归档。broker 路径不再展示该文案。
- readiness 拆为 `projectChatReadiness: 'probing' | 'enabled' | 'legacy'`：只有 `window.projectChat` 缺失或 `getSnapshot` 抛出（通道未注册）才进入 `legacy`；`getSnapshot` 返回业务错误说明通道存在，判为 `enabled`。autosave 守卫改为 `if (projectChatReadiness !== 'legacy') return`，probing 期不再落入 legacy full-snapshot writer。
- 归档只在被归档线程恰为当前选择时移动 selection（`if (wasActive) goHome()`）；非活动线程归档不再跳走当前会话。
- 附带修复 `runtimeEditStatus` 的三条硬编码中文，改为 `runtime.editFailed / editSaving / editActive` i18n key（原为 `BUG-AUDIT-WS-02` 记录的 P2，本轮一并处理）。

### 2026-08-29 自检结果与 allowlist 偏离

- `npm run typecheck`：exit 0。
- `node --test`：全部 41 个非网络套件 263/263 PASS；追加 `static-runtime` / `local-app-preview` / `agentos-external-task` 26/26 PASS，`claude-agent-runner-web-search` / `agentos-ticket-client` 20/20 PASS。合计 **309/309，0 fail**。
- `electron/local-app-runtime.test.mjs` 在当前沙箱挂起（fixture 需要监听 `127.0.0.1`，与既有环境限制一致），**未纳入本轮结果**；本轮未修改该模块，需在允许回环监听的环境由 `CHECK-02` 复跑。
- `npx vite build`：renderer 与 preload/main bundle 均 PASS。
- 新增测试：`electron/workspace-commands.test.mjs`（14）、`electron/workspace-command-client.test.mjs`（16）。更新 source audit：`electron/desktop-seam.test.mjs`（workspace save 计数 7→8，仍全部包在 `runChatWorkspaceOperation` 内）、`electron/project-chat-renderer.test.mjs`（新增 "main sidebar routes thread and workspace mutations to Main-owned intents"，断言 `workspaceSession.*` 项目/偏好 reducer 在 `AppShell` 不可达、无 `saveChatWorkspace(`、隐式 cancel 只在 legacy 分支、`if (wasActive) goHome()`）。
- **Allowlist 偏离（按规则先记录）**：`FIX-WS-01` 冻结的 write allowlist 未包含 `src/workspace-commands.ts`（共享纯模块）、`src/components/workspace-session.ts`（改为委托以消除双实现）；`FIX-CHAT-01` 未包含 `src/components/project-chat-thread-intents.ts`、`src/components/runtime-event-state.ts` 及三个 `runtimeEditStatus` 调用点。偏离理由：把持久化转换复制进 `electron/main.ts` 会制造 Main/renderer 两份实现，正是本轮要消灭的缺陷类别；i18n 修复无法只改 locale 文件。两张任务单的 allowlist 已同步补记。
- 未执行：真实 Electron 双窗口 smoke、重启后落盘的 GUI 验证。二者留 `CHECK-02`，本轮不声称正式验收通过。

## Revision 1：实现与自检

### `ACC-01`

- 结果：完成。
- 证据：用户确认每次发送创建新线程、通道固定绑定项目、调用方传完整指令、是否打开线程可配置，并选择复用现有状态能力。
- 实现：`src/agent-command-channel.ts` 提供配置、发送、打开线程、状态查询与订阅；`AppShell` / `ChatPage` / `WorkspaceSession` 完成非激活线程与 Chat Run 状态桥接。

### `IMP-01` / `TST-01` / `SYNC-01` / `CHK-01`

- 结果：实现与 Codex 自检完成；Acceptance 未写正式通过状态。
- 来源仓库：`npm run typecheck -- --pretty false` 通过；`npm run test:electron` 86/86 通过；`git diff --check` 通过。
- 同步仓库：`npm run typecheck -- --pretty false` 通过；`npm run test:electron` 101/101 通过；选题入口 source audit 9/9 通过。
- 一致性：`src/agent-command-channel.ts` 与 `electron/agent-command-channel.test.mjs` 在两个仓库逐字一致；共享类型仅保留 IntelligentOS 既有 `AppViewId = 'ai'` 差异，`ChatPage` 仅保留既有 localStorage key 差异。
- 工具缺口：两个仓库都不存在规则中历史引用的 `.codex/scripts/check-acceptance.sh`，因此未运行该格式检查，也未执行正式验收。
- 剩余风险：尚未在真实 Electron 窗口中用真实 SDK 长任务逐项执行 `stay` / `open`、等待输入、成功、失败与取消场景；不能视为正式验收通过。
