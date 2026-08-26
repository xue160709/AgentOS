# Evidence

## Revision 4：手动构建与静态直开

### ORCH-012

- skill: `change-package / technical architecture / update-prd / project-iterate`
- actual_execution: `subagents`
- roles: `technical_architect=DONE@ARCH-P0-04//root/static_runtime_arch`；`implementation_engineer=DONE@DEV-P0-05//root/static_runtime_impl`；`quality_verifier=PASS@CHECK-P0-04//root/static_runtime_quality`；其它角色按 tasks.md Revision 4 的 `not_needed` 理由。
- confirmation: `2026-08-26 用户确认代码变化后手动构建可接受；在“默认静态直开、手动重新构建、保留 dev 模式”的最终推荐后回复“OK，完成开发”。`
- coverage_gate: `pass`
- architecture: `Main 签署静态模式声明、固定 npm run build、私有安全 scheme、GET/HEAD 路径/realpath 隔离、sandboxed Preview、buildId/operation/generation、显式 dev fallback 合同。与架构草案相比，项目仍正常构建到 outputRoot；成功后再复制进 userData 不可变 staging 并原子切换 last-good，避免依赖 Next 专属动态 distDir，也保证构建失败不污染当前预览。`
- prd_sync: `Revision 4 已机械同步为 Current/as-built；C-010～C-012 标记“已实现，待正式验收”，未冒充 project-verify 正式通过。`

### ORCH-013｜Revision 4 实现与 Development Check

- implementation_engineer: `/root/static_runtime_impl`，三轮实现/定向修复，最终 `DONE`。
- quality_verifier: `/root/static_runtime_quality`，三轮只读 Development Check；最终 `PASS`，P0=0、P1=0、P2=0。
- implementation: `agentos-static` 每 Preview 隔离 session、精确 token host、GET/HEAD 与 lexical/realpath containment；zero-spawn static restore；固定 `npm run build`；不可变 artifact + 原子 last-good；手动 build/cancel/stale/failure；显式 dev fallback 与双向 mode transition 进程回收。
- CodeNow: `package.json.agentos.mode=static`；Next `output=export`、`trailingSlash`、unoptimized images；教程静态复制；Radar/Quota 构建期快照；现有 `out` 供首次导入，生成目录已 gitignore。
- validation:
  - `npm run typecheck`: PASS
  - `npm run test:electron`: 145/145 PASS（允许本机 loopback 的环境）
  - CodeNow Wiki `npm run build`: 624/624 静态页面生成成功
  - artifacts: `out/index.html`、`out/codex/index.html`、`out/tutorials/codex/01-what-is-codex/index.html`
  - 两仓 `git diff --check`: PASS
  - final implementation diff: `e30a5973078cd69c8e9f14edadac36ac77757c2d32dbedb962acbdd7c20d0325`
- fixed_findings: `QVR-STATIC-001`～`QVR-STATIC-005` 均已修复并重放通过；包含 custom-scheme origin=null、无尾斜杠静态路由、构建完成后取消、dev→static 孤儿进程、pointer commit 原子边界与 stale 取消恢复。
- acceptance_boundary: `本轮未执行 project-verify；真实打包 Electron Chromium GUI custom-scheme 全流程仍需正式验收。`

### ORCH-014｜Revision 4 开发收口复核

- skill: `change-package / project-iterate`
- actual_execution: `main_direct`
- roles: `沿用 ORCH-013 已完成的 technical_architect、implementation_engineer 与 quality_verifier 结果；主 Agent 在 HEAD a9b8f51bc1a3d8c960fd3cfd7d42a67015903a1a 重跑 npm run typecheck=PASS、npm run test:electron=145/145 PASS，并在 CodeNow Wiki 当前 diff 3fd40b44571a7426d42e0dc82f719ec8c7e6fffb28b08275773389e60b7c58aa 上重跑 npm run build=624/624 PASS；acceptance_requested=false。`

### ORCH-015｜Revision 5 首次导入闭环

- skill: `change-package / update-prd / project-iterate`
- actual_execution: `subagents`
- roles: `implementation_engineer=RUNNING@DEV-P0-06//root/first_import_build_impl`；`quality_verifier=SKIPPED@CHECK-P0-05/pending-development`；`product_manager=not_needed(existing_contract_sufficient)`；`experience_designer=not_needed(existing_contract_sufficient)`；`technical_architect=not_needed(existing_contract_sufficient)`；`visual_interface_designer=not_needed(strict_reuse_of_existing_pattern)`；`acceptance_requested=false`；证据待 DEV-P0-06 与 CHECK-P0-05 返回后收口。

### ORCH-016｜Revision 5 stale 与 Tab 页面保持回归

- skill: `project-debug(FIX) / interaction-flow-review / project-iterate`
- actual_execution: `mixed`
- roles: `technical_architect=DONE@REVIEW-P1-06//root/runtime_state_arch_review`；`experience_designer=DONE@REVIEW-P1-06//root/runtime_tab_ux_review`；`quality_verifier=DONE@REVIEW-P1-06//root/runtime_tab_quality_review`；`main_agent=DONE@FIX-P1-06/main_direct`；`acceptance_requested=false`。
- root_cause: `homepage last-good=2026-08-26T13:17:31.799Z，之后 package.json 与书籍资源 route 的 mtime 更新且 Git working tree 有实际修改；codenow.wiki last-good=2026-08-26T08:02:07.674Z，之后有 741 个纳入指纹的文件 mtime 更新且 Git working tree 有实际修改，因此当前 size+mtime stale 检查有触发依据。Tab 返回首页则由 RuntimePreview unmount cleanup 主动 close PreviewSession 导致重新 loadURL。`
- implementation: `stale 从 recovery bar 移除；三个静态 Runtime 宿主补齐 build/rebuild 文案和普通 Shell 顶部 Build/Cancel 入口；RuntimePreview cleanup 改为只隐藏，真实 close 仍由 Main authoritative tab close、release 与 generation replacement 管理。`
- validation: `npm run typecheck=PASS；node --test electron/desktop-seam.test.mjs electron/local-app-preview.test.mjs=21/21 PASS；git diff --check=PASS。未执行真实 GUI smoke，未进入 project-verify。`

## Revision 2：Workspace Tab 与项目首页 Runtime

### ORCH-006

- skill: `product-design`
- execution_model: `hybrid`
- actual_execution: `subagents`
- triggered_roles:
  - `experience_designer`：trigger=`侧栏 IA、右键/重命名、项目首页两套系统切换、焦点与恢复存在新交互合同`；task=`UX-P0-02`；instance=`/root/tab_runtime_ux`；status=`DONE`
- not_needed:
  - `product_manager`：`existing_contract_sufficient`
  - `visual_interface_designer`：`strict_reuse_of_existing_pattern`
- degradation: `none`
- coverage_gate: `pass`
- evidence: `体验角色 response_only Product Design Pack；用户补充确认现有卡片区不改，首页用 Tab 切换独立 Runtime 系统。`

### ORCH-007

- skill: `change-package / technical architecture`
- execution_model: `orchestrated`
- actual_execution: `subagents`
- triggered_roles:
  - `technical_architect`：trigger=`共享 workspace schema/IPC/storage、Preview host、多 consumer 与跨进程生命周期改变`；task=`ARCH-P0-02`；instance=`/root/tab_runtime_arch`；status=`DONE`
- not_needed:
  - `independent_reviewer`：`no_independent_review_trigger`
- degradation: `none`
- coverage_gate: `pass`
- evidence: `技术角色 response_only 合同：schema v3 双读迁移、中性 Runtime API、workspace-tab/project-home host union、精确 consumer 与 generation 校验。`

### Revision 2 开发基线

- baseline: `HEAD a940b9bff60e19315e3fcce982589315c1d93c2b` 加 Revision 1 dirty tree；不得回退既有实现或覆盖无关用户改动。
- `npm run typecheck`：PASS。
- 目标测试：58 个场景中 57 PASS；唯一失败为受控 Runtime fixture 在当前受限沙箱绑定 `127.0.0.1` 时 `listen EPERM`，与 Revision 1 已知环境限制一致。
- 失败测试：`electron/local-app-runtime.test.mjs` 的 controlled fixture dynamic readiness 场景；其它 Workspace/Store/Desktop Seam/Preview/Runtime 测试通过。

### ORCH-008

- skill: `update-prd`
- mode: `UPDATE`
- target_state: `Planned Revision 2`
- status: `DONE`
- synced: `CONTEXT.md`、模块 README/design/technical、Acceptance C-006–C-009、根 TODO、PRD 索引与 change tasks。
- boundary: `Revision 1 的 Current/as-built 与 10/16 正式验收历史保留；Revision 2 场景仍为未实现，未以设计同步冒充验收通过。`

### ORCH-009｜Revision 2 实现与 Development Check

- skill: `project-iterate`
- execution_model: `orchestrated`
- implementation_engineer: `/root/workspace_runtime_impl`，三轮定向实现/修复，最终 `DONE`
- quality_verifier: `/root/workspace_runtime_quality`，三轮只读 Development Check，最终 `PASS`（P0=0，P1=0）
- implemented: `schema v3 neutral fields + legacy read migration`、`Workspace Tab naming/context-menu close`、`Overview/Runtime independent pages`、`project-home host registry`、`multi-host consumer/Preview lifecycle`、`stale mount/request/generation cleanup`
- protected_boundary: `src/components/chat/ProjectHomeSurface.tsx` 零 diff；未创建隐藏 Workspace Tab；未扩大 Trusted local process 安全承诺。
- validation:
  - `npm run typecheck`: PASS
  - 目标 Node 测试：57/58 PASS；唯一失败为受限 sandbox controlled fixture `listen EPERM: operation not permitted 127.0.0.1`
  - `npm run build`: PASS；macOS notarization 按既有配置跳过
  - `npm run test:home-plugin`: PASS（无项目 Home Plugin，按 allow-missing 跳过）
  - `git diff --check`: PASS
- acceptance_boundary: `C-006`–`C-009` 仅标记“已实现，待正式验收”；本轮未执行 project-verify，未宣称正式 Acceptance 通过。

## 规划证据

- `2026-08-25`：用户确认先开发左侧 `New Tab` 机制，并接入 CodeNow Wiki；AgentOS 负责自动运行 `npm run dev`，用户不手动启动。
- `/Volumes/macOS/Github/codenow.wiki/package.json`：已核实项目名为 `codenow-wiki`，`dev` 脚本为 `next dev`。
- `src/components/AppShellSidebar.tsx`：当前侧栏已有新建线程、项目和线程列表入口，可作为 New Tab 接入 seam。
- `src/components/workspace-session.ts`、`src/chat-workspace-persistence.ts`：当前已有 Workspace Session durable snapshot 与恢复机制，可扩展但尚无 Local App 对象。
- `electron/main.ts`、`electron/preload.ts`、`src/desktop-seam.ts`：当前已有类型化 Desktop Seam，但尚无开发服务器、端口、进程树和预览运行时管理。

## 状态

- 产品、体验、技术与 ATDD 正式 PRD 同步：已完成（2026-08-25）。
- 业务代码实现：已完成；全部定向修复与用户确认的体验修复已落盘，最终 Development Check 通过。
- 正式验收：首轮 `project-verify` 已执行，10/16 场景通过、6/16 待补真实 Electron 端到端证据、0 失败，总体 `BLOCKED`。
- 真实接入：CodeNow Wiki live smoke、切换对话保活、多 Tab Runtime 复用、刷新不重启、退出清理与正常重启自动恢复均已完成。

## 编排记录

### ORCH-001

- skill: `project-iterate`
- execution_model: `orchestrated`
- actual_execution: `subagents`
- triggered_roles:
  - `technical_architect`：trigger=`SQLite/JSON 快照、动态端口和 Preview 前置依赖存在实现合同缺口`；task=`ARCH-P0-01`；instance=`/root/local_app_contract_freeze`；status=`DONE`
  - `implementation_engineer`：trigger=`跨 Workspace、SQLite、typed IPC、Electron 进程与 Preview 的完整实现`；task=`DEV-P0-01/02/03,DEV-P1-01/02`；instance=`/root/local_app_runtime_impl`；status=`DONE`
  - `quality_verifier`：trigger=`heavy_change: 跨模块、IPC、进程生命周期、安全边界与异步恢复`；task=`Development Check`；instance=`/root/local_app_dev_quality`；status=`DONE`
- not_needed:
  - `product_manager`：`existing_contract_sufficient`
  - `experience_designer`：`existing_contract_sufficient`
  - `visual_interface_designer`：`existing_contract_sufficient`
  - `independent_reviewer`：`no_independent_review_trigger`
- degradation: `none`
- coverage_gate: `blocked`
- evidence: `技术合同已冻结；implementation_engineer 首轮实现与自检完成；quality_verifier 的 Development Check 结论为 FAIL，已进入定向修复。`

## 实现前冻结技术合同（ARCH-P0-01）

- 工作区快照：SQLite `workspace_meta` 保存 Local App 定义、Tab、活动 Tab 与完整性元数据；JSON/SQLite 共用 revision/savedAt，恢复不依赖 SQLite 文件 mtime，Local App-only 快照不得判空。
- 启动：argv 固定 `npm run dev`，Main 分配 loopback 候选端口并注入 `PORT`、`HOST=127.0.0.1`；只接受进程存活且 loopback HTTP probe 成功的 ready URL。
- 环境：仅继承 PATH、用户目录、临时目录、平台启动必需字段与 locale；注入 PORT/HOST/NODE_ENV，排除凭据与未列入变量。本边界不构成 OS 强沙箱。
- 默认常量：依赖准备 120s、readiness 60s、probe 250ms/单次 1s、端口候选 3、崩溃重试 3 次（1/2/4s）、TERM 3s、KILL 2s、退出清理 5s、最后 consumer 立即回收。
- Preview：最小隔离 WebContentsView 必须先于 CodeNow Wiki live smoke；不加载应用 preload，不允许 Node/Electron bridge、外部导航、弹窗或权限请求。

## 文档同步证据

- 产品摘要：`prd/local-app-runtime/README.md`。
- Planned 产品设计：`prd/local-app-runtime/design.md`。
- Current/Planned 技术边界：`prd/local-app-runtime/technical.md`。
- 唯一验收契约：`prd/local-app-runtime/acceptance.md`，全部场景保持 `⬜ 未实现`。
- 开发入口：根 `TODO.md` 的 §1.1；Later 见 §2。
- 模块索引：`prd/README.md`。

## Development Check（2026-08-25）

- 结论：`FAIL`，不得进入正式 Acceptance Check。
- P0：Runtime 手动重启会丢失多 Tab consumers，关闭一个非最后 Tab 后会误停共享服务。
- P0：Local App 重新选择目录后仍复用旧 Runtime，旧项目进程不会切换。
- P1：lockfile digest 只保存在内存，AgentOS 重启后无法识别已有 `node_modules` 项目的 lockfile 变化。
- P1：Preview bounds 未监听滚动；reload/HMR 恢复后降级状态不能可靠清除。
- P1：首次接入对话框缺少初始焦点与焦点陷阱；关闭 Tab 后缺少相邻可用焦点恢复。
- 已验证：类型检查通过；目标 Node 测试普通 sandbox 下仅 fixture loopback 因 `EPERM` 受阻，提升权限后 Runtime 测试 `8/8` 通过；`git diff --check` 通过。
- 未验证：真实 Electron Preview 交互与安全负例、CodeNow Wiki live smoke。

## 用户确认的创建时序缺陷（2026-08-25）

- 根因：Renderer 已把 Local App Tab 加入内存状态，但 `persistChatWorkspaceState()` 静默吞掉 Main 保存异常；随后 `desktop:local-app:start` 从 Main 的工作区读取不到 Definition，返回 `local-app-definition-missing`。
- 修复门槛：Main 必须先确认包含 Definition/Tab 的工作区已持久化，Renderer 才显示 Tab，Runtime 只能在该确认之后启动。
- 失败语义：JSON/SQLite 保存失败时不创建可见 Tab、不启动进程、保持接入对话框并显示明确错误；不得以 localStorage 镜像冒充 Main 持久化成功。

## Development Check 回归（2026-08-25）

- 结论：`FAIL`；已确认两阶段顺序为 Main 持久化成功 → Renderer 可见 Tab → Runtime start，但仍有数据一致性缺口。
- P0：Renderer 存在尚未 flush 的新聊天/项目状态时，创建使用旧 revision，可能以 Main 返回的旧工作区覆盖未保存数据。
- P1：创建失败会撤销此前已存在的同 root 授权；relocate 从 operation 外读取旧快照；preparation record 缺失时会错误跳过 `npm ci`。
- P1：Preview partition 未包含 session/tab，reload 失败分支缺少 current-session 校验；后台 autosave 错误尚不可见。
- 已通过：restart consumers、两阶段 create/start、显式保存错误传播与 pending retry、Preview scroll/reload 恢复、焦点路径、类型检查、`42/42` 自动化测试、最终代码构建与打包（notarization 按现有配置跳过）。

## 用户确认的 Local App 体验调整（2026-08-25）

- 切换到聊天或其它 Tab 时本地项目不得停止；Runtime consumer 绑定 Tab 生命周期，不绑定当前可见性。
- `New Tab` 必须同时支持绑定新的本地应用和打开已接入应用；Renderer chooser 打开前必须隐藏原生 Preview，不能被 WebContentsView 遮挡。
- Local App 激活时预览铺满主内容区；Refresh、紧凑状态与日志入口放在顶部工具区，Running 与最近日志默认不占预览面积。
- `product_manager` `/root/local_app_ux_product`：`DONE/DRAFT_ONLY`，冻结 Definition/Tab/Runtime/Preview 生命周期、New/Open 双入口和 Acceptance Delta。
- `experience_designer` `/root/local_app_ux_flow`：`DONE/DRAFT_ONLY`，冻结 Preview hide/show 协调、持久化旅程、全屏 IA、焦点与可观察验收线索。
- `visual_interface_designer` `/root/local_app_ux_visual`：`DONE/DRAFT_ONLY`，冻结顶部工具条、全屏 Preview、折叠日志与错误态视觉层级。

## 第三轮 Development Check（2026-08-25）

- 结论：`FAIL`，剩余 5 个局部确定性缺陷进入 attempt 6。
- 同一 canonical root 复用 Definition 时 Tab id 不唯一，第二个 Tab 会被归一化丢弃。
- Preview 异步创建与关闭 Tab 存在竞态，可能遗留隐藏原生视图。
- chooser 转目录选择时会提前恢复 Preview，原生层仍可能遮挡流程。
- 项目型工作区 running 状态仍在主区重复显示 Runtime summary，挤占全屏 Preview。
- relocate 的旧 Preview/Runtime 停止失败会被降级为 warning 并继续启动新 Runtime，可能新旧项目并存。

## 剩余风险

- 生产级 Sandbox Provider 尚未确认和验证；在此之前只能运行用户显式信任的本地项目，不能宣称项目外访问被强制阻断。
- 正式 Acceptance 仍缺少信任确认取消、失败/停止恢复、真实 `path_missing` 恢复，以及 Preview Node/Electron、外部导航、弹窗和权限请求负例的持久端到端证据；这些场景不得以静态配置或 fixture 单测冒充正式通过。

## 最终 Development Check 与真实 GUI 证据（2026-08-25）

- `git diff --check`：PASS。
- `npm run typecheck`：PASS。
- `npm run test:electron`：PASS，`117/117`；包含受控 loopback fixture、动态 readiness、失败分支、generation、consumer 生命周期和退出清理。
- `npm run build`：PASS；仅保留既有 chunk size warning，notarization 按当前配置跳过。
- 真实项目：`/Volumes/macOS/Github/codenow.wiki`；AgentOS 自动执行 `npm run dev`，首次动态就绪地址为 `http://localhost:50041/`，真实 CodeNow 页面在受控 Preview 中显示。
- 全屏布局：Local App 激活后 Preview 占据主内容区；顶部工具区显示运行状态、刷新、日志、重启与停止；日志默认关闭，主区未显示大块运行摘要。
- New Tab：打开 chooser 时原生 Preview 从可访问树和画面中隐藏；chooser 同时显示“打开已接入应用”和“绑定新的本地应用”；后者成功打开可操作的 macOS 目录选择器，取消目录选择后仍停留在 chooser。
- 切换生命周期：从 Local App 切到普通对话再返回前后，受管 Runtime 始终为 `npm PID 81290 / next PID 81318`；未发生 stop 或 respawn，返回后恢复同一 Preview。
- 多 Tab：从 chooser 打开同一 canonical root 后侧栏出现两个独立 `LocalAppTab`；进程检查仍只有 `81290 / 81318` 一套受管 Runtime；关闭第二个 Tab 后该 Runtime 继续存活。
- 刷新：点击顶部“刷新预览”后页面恢复，Runtime PID 仍为 `81290 / 81318`，证明刷新不隐式重启 Runtime。
- 退出清理：退出首次测试 AgentOS 后，`AgentOS PID 80507`、`npm PID 81290`、`next PID 81318` 均不再存在。
- 正常重启恢复：再次启动 AgentOS 后，持久化的 `codenow-wiki` Tab 自动恢复为“运行中”，无需再次确认；AgentOS 重新创建 `npm PID 94225 / next PID 94253`，动态就绪地址变为 `http://localhost:50941/`，并恢复退出前页面 `/inspiration/c01-ai-file-renamer`，未复用旧 PID 或旧端口。
- 第二次退出清理：结束重启恢复 smoke 后，`AgentOS PID 93342`、`npm PID 94225`、`next PID 94253` 均不再存在。

## 正式 Acceptance Check（2026-08-25）

- 独立 `quality_verifier` 结论：`BLOCKED`，未发现 FAIL。
- 已具备正式证据的场景：确认信任后创建、关闭 Tab 保留 Definition、旧快照兼容、fixture 自动启动、CodeNow Wiki live smoke、同应用多视图复用、generation/late event 隔离、退出清理、Preview 正常加载与刷新；主 Agent 随后补充了正常退出后自动恢复的真实 GUI/PID/动态端口证据。
- 仍待补证据的场景：信任确认取消/Escape 不落盘；失败态 UI 与重试/停止；真实目录或脚本不可用时的可恢复 UI；Preview 页面真实执行 Node/Electron bridge、外部导航、`window.open` 与权限请求负例。
- 因上述缺口，模块不得宣称正式 Acceptance 全部通过，根 TODO 不得整体完成或归档。
### ORCH-010｜2026-08-25 回归诊断

- skill: `project-debug`
- execution_model: `hybrid`
- actual_execution: `mixed`
- triggered_roles:
  - `technical_architect`：trigger=`当前 Electron 与受管 dev server 跨进程；异常 parent exit 后 app-owned 进程成为 PID 1 子进程并持有 Next lock，单侧 UI 日志不能安全决定进程归属与回收`；task=`REG-RUNTIME-01`；instance=`/root/runtime_orphan_arch`；status=`DONE`
  - `implementation_engineer`：trigger=`Medium/Heavy 回归实现必须由工程角色写入`；task=`REG-UI-01`；instance=`/root/runtime_layout_impl`；status=`DONE`
  - `implementation_engineer`：trigger=`跨进程 Runtime ownership/cleanup 实现与目标测试`；task=`REG-RUNTIME-01`；instance=`/root/runtime_orphan_impl`；status=`RUNNING`
  - `implementation_engineer`：trigger=`用户纠正首页切换边界，attempt 1 需 rework`；task=`REG-UI-01`；instance=`/root/runtime_layout_rework`；status=`RUNNING`
- not_needed:
  - `product_manager`：`existing_contract_sufficient`
  - `experience_designer`：`existing_contract_sufficient`
  - `visual_interface_designer`：`strict_reuse_of_existing_pattern`
  - `independent_reviewer`：`no_independent_review_trigger`
- degradation: `none`
- coverage_gate: `in_progress`
- runtime: `started_at=2026-08-25T21:04:53+08:00; completed_at=2026-08-25T21:15:02+08:00; wall_ms=609000; model=gpt-5.6-luna; input_tokens=null; output_tokens=null; result_path=; result_hash=72bf1fb9d464d16b7ecdde6a9407e47b01b96b20d108f4768cab5dff460e9cba; consumed=true`
- evidence: `截图 + c5aed82 diff + 当前进程/lock/端口只读证据；UI 高度根因已定位为新 Runtime 根节点未继承全高 flex 布局，以及项目页级 Tab 仍消费旧 ChatStartView 大顶距。REG-UI-01 diff 72bf1fb9 已通过 npm run typecheck 与目标 diff-check。架构结论采用 app-owned IPC liveness bridge：只回收桥接器自身创建的子进程树；不得扫描目录/端口、不得删除 Next lock、不得误杀外部进程；process-exited 需保留真实失败原因。`

### REG-UI-01｜2026-08-25 GUI 回归

- `VER-REG-UI-01-WORKSPACE-GUI-72bf1fb9`：1400×768 的 `my-v0-project` Workspace Runtime 中，toolbar 固定于顶部，停止态 Preview 铺满剩余主内容高度，不再停在约 320px。
- `VER-REG-UI-01-PROJECT-RUNTIME-GUI-72bf1fb9`：`agent-init` 项目 Runtime 中，页面级 Tabs、项目身份/信任操作、次级操作与 Preview 各占独立布局行，无按钮或文本重叠。
- `VER-REG-UI-01-PROJECT-OVERVIEW-GUI-72bf1fb9`：切回 Overview 后只出现既有标题、Composer、项目控制与卡片，Runtime 内容未混入，Tabs 保持在页面顶部。

> 用户于随后截图明确纠正：hero 与 Composer 不属于切换内容，必须始终保留；`Overview / Runtime` 只切换 Composer 下方的卡片区与 Runtime 面板。因此 attempt 1 的两个项目首页 GUI 结论仅作为失败诊断历史，不再进入当前 slice 的有效 `verificationIds`；Workspace Runtime 全高结论也将在 attempt 2 新 diff 上重跑后再消费。

> 用户第二次截图确认 attempt 2 仍然错误：虽然 Composer 已固定，但首页整体 flex/overflow/留白被重写、Tab 被放成页面顶栏，破坏了原项目首页。attempt 3 以 `c5aed82^` 的原 `ChatStartView` DOM/CSS 为布局基线，仅在原 `chat-start-view__below-composer` 内包住 cards/runtime 局部切换；attempt 2 的 dd894b22 自检不作为当前有效验证。

### ORCH-011｜2026-08-26 Runtime 工作区性能诊断与 Revision 3

- 用户现象：打开 Runtime Workspace Tab 后持续显示运行中，项目整体点击迟钝，切换 Tab 页面无变化；用户要求按顺序修复并重新允许 subagents。
- `PERF-P0-01` 根因：`WorkspaceSession.selectWorkspaceTab()` 只写 `activeWorkspaceTabId`，没有清空旧 `activeThreadId`；`WorkspaceSession.active()` 的恢复解析优先保留旧线程并把 Tab 解析为空，形成“点击已触发但页面不变”。只读复现：`selected={activeThreadId:"thread",activeWorkspaceTabId:"tab"}`，`resolved={threadId:"thread",workspaceTabId:null}`。
- `PERF-P1-01` 根因：Main 每行 stdout/stderr 都发送一个 Runtime event，`AppShell` 对每个事件执行根级 `setRuntimeStates` 并复制日志数组；没有 Renderer 合并窗口。
- `PERF-P1-02` 根因：`AppShell` 在 `useLayoutEffect` 中 stage 完整工作区；即时镜像路径会做 durable fingerprint 序列化和同步 localStorage 序列化/写入，发生在浏览器绘制前。
- `PERF-P2-01` 证据：诊断时发现 8 组历史 `local-app-runtime-stop-*` fixture 进程树，共约 126 MiB、CPU 近零；本轮不会在未获清理授权时直接终止这些历史进程，只修复所有权明确的测试/停止路径并验证不新增残留。
- 资源基线：当前 AgentOS 约 480 MiB RSS；两个用户配置的不同 Runtime root 约 525 MiB RSS，总计约 1005 MiB，空闲 CPU 约 0.2%。自动启动策略属于产品行为，暂不在确定性性能修复中擅自更改。
- stale recovery：`/root/runtime_orphan_impl` 已无 live agent，相关 liveness bridge 实现已进入提交 `eedcf52`；Revision 2 的 `RUNNING` 记录按恢复审计关闭，并由 `PERF-P2-01` 重新检查残留缺陷。
- `PERF-P0-01`：`WorkspaceSession.selectWorkspaceTab()` 现在以同一次状态转换清空 `activeThreadId` 并选择目标 Tab；新增 active/restore 回归测试。`node --test electron/workspace-session.test.mjs` PASS，16/16。
- `PERF-P1-01`：实现角色 `/root/runtime_event_batching` 抽取 `RuntimeEventBatcher` 与纯状态归并 helper；纯日志按 75ms 窗口合并，非日志状态先按到达顺序带上排队日志后立即提交，cleanup 清 timer/队列。`node --test electron/runtime-event-state.test.mjs` PASS，4/4；`npm run typecheck` PASS；主 Agent 已复核 diff 与重跑结果。
- `PERF-P1-02`：`AppShell` 的 Workspace Session staging 已从 `useLayoutEffect` 移至普通 `useEffect`；保存实现、即时 localStorage 镜像、750ms Main flush 与 StrictMode cleanup 未改。联合目标测试 PASS，20/20；`npm run typecheck` PASS。
- `PERF-P2-01`：实现角色 `/root/runtime_process_cleanup` 确认历史泄漏均来自测试 fixture 失败/中断路径；其“合并 bridge/npm 进程组”半成品在重复测试中出现间歇性 lock cleanup 失败，主 Agent 未消费该风险改动并恢复既有生产分组合同。最终保留两项确定性修复：`stopAll()` 在工作先完成时清除未胜出的 5 秒 timeout；Runtime fixture 的 `finally` 以本轮写入的 npm/server PID 证据先做有界 TERM/KILL 和退出等待，再删除临时目录。停止/IPC 断连用例重复 5 轮 10/10 PASS，单轮 Node 退出由约 5.6s 降至约 0.6–0.7s；完整 Runtime 套件在允许 loopback 的环境 18/18 PASS；类型检查和 diff-check PASS。
- `PERF-P2-01` 进程核对：完整测试后只读列表仍只有 2026-08-25 21:28–21:32 的原 8 组 `server.mjs owned` 历史残留，本轮没有新增 fixture PID；未对历史进程执行终止。
- Revision 3 集成回归：首次 `npm run test:electron` 为 130/131，唯一失败是 `desktop-seam.test.mjs` 仍要求 Runtime event neutralization 内联于 `AppShell.tsx`；实现已抽到 `runtime-event-state.ts`，因此更新静态 seam 测试去检查新 helper 与 AppShell batcher 装配。随后目标 Desktop Seam 11/11 PASS，完整 Electron 套件 131/131 PASS；稳定实现 diff hash=`b835aecba429485ad3da44582b41a2cf5989ec6540b4961d5d8c6265804cba14`。
- 独立 Development Check：`quality_verifier` `/root/runtime_performance_quality` 对最终 diff `602f1dce442434859da159a0b7f89503fef3d0d08c561a2a67e88f16872a0926` 结论 PASS，P0=0、P1=0。其首轮提出的 `PERF-P2-BATCH-001` 与 `PERF-P2-CLEANUP-001` 已分别通过 10,000 行有界队列测试和 controlled fixture `finally stopAll → rm` 关闭；完整 Electron 套件最终 132/132 PASS。
- 剩余 `PERF-P2-PID-REUSE-001`：仅测试 fixture 的异常兜底在极窄窗口按刚写入的裸 PID TERM/KILL，理论上存在 PID 复用误杀；生产 Runtime 清理没有增加裸 PID、目录、端口或锁扫描。本 change 保持 active，并将该 P2 finding 留作后续测试基础设施加固。
