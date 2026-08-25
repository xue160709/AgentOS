# Tasks

> Revision 2：用户已取代 Revision 1 的“Local App”用户概念。以下任务在保留 Revision 1 实现与历史证据的前提下，完成 Workspace Tab、Runtime 多宿主与项目首页双系统切换。

```yaml
revision: 2
task_level: Heavy
level_basis: 共享 workspace schema/IPC/storage 迁移、跨进程 Preview host 与多 consumer 生命周期、项目首页主流程变化
professional_gaps: [experience_flow, technical_runtime, implementation, quality]
role_plan: [experience_designer, technical_architect, implementation_engineer, quality_verifier]
not_needed:
  - product_manager: existing_contract_sufficient
  - visual_interface_designer: strict_reuse_of_existing_pattern
  - user_researcher: existing_evidence_sufficient
  - market_researcher: no_relevant_impact
  - cmo_value_strategist: no_relevant_impact
  - independent_reviewer: no_independent_review_trigger
confirmation: user_confirmed
coverage_gate: pass
```

## Revision 2 设计与架构

- [x] `UX-P0-02`｜owner=`experience_designer`｜write_mode=`response_only`｜依赖：用户确认
  - 结果：冻结侧栏 Tabs、创建/重命名/右键关闭、项目首页 `Overview / Runtime` 双系统、状态/焦点/恢复与稳定 selectors。
  - 边界：`ProjectHomeSurface` 与 A2UI 卡片内部不改；项目首页不得创建隐藏 Tab。
  - 实例：`/root/tab_runtime_ux`。

- [x] `ARCH-P0-02`｜owner=`technical_architect`｜write_mode=`response_only`｜依赖：`UX-P0-02`
  - 结果：冻结 `RuntimeDefinition / WorkspaceTab / RuntimeHost`、schema v3 双读迁移、中性 IPC、project-home consumer 与 Preview host 校验合同。
  - 边界：不删除旧快照，不扩大沙箱安全承诺，不引入外部依赖。
  - 实例：`/root/tab_runtime_arch`。

## Revision 2 开发

- [x] `DEV-P0-04`｜来源 `C-006`–`C-009`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`UX-P0-02`,`ARCH-P0-02`,`SYNC-P0-02`
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=60m`；`attempt=1`；`instance_id=/root/workspace_runtime_impl`；`diff_baseline=HEAD a940b9bff60e19315e3fcce982589315c1d93c2b + 2026-08-25 Revision 1 dirty tree`。
  - `exact_write_allowlist=src/components/types.ts,src/components/workspace-session.ts,src/chat-workspace-persistence.ts,src/workspace-snapshot-resolution.ts,src/desktop-api.ts,src/desktop-seam.ts,src/desktop-types.ts,src/components/AppShell.tsx,src/components/AppShellSidebar.tsx,src/components/AppShellWorkspace.tsx,src/components/LocalAppOnboardingDialog.tsx,src/components/LocalAppWorkspace.tsx,src/components/LocalAppPreview.tsx,src/components/chat/ChatStartView.tsx,src/components/chat/ProjectHomeRuntimeView.tsx,electron/chat-workspace-store.ts,electron/main.ts,electron/preload.ts,electron/local-app-runtime/index.ts,electron/local-app-runtime/preview.ts,electron/workspace-session.test.mjs,electron/chat-workspace-store.test.mjs,electron/desktop-seam.test.mjs,electron/local-app-runtime.test.mjs,electron/local-app-preview.test.mjs,src/locales/en.json,src/locales/zh.json,src/style.css`。
  - 实现：中性领域/IPC/schema 迁移、用户命名和 Main-authoritative rename/close、侧栏重排与右键菜单、项目首页双系统 Tab、独立 Runtime host/Preview、精确 consumer release。
  - 保持：现有卡片系统与 `ProjectHomeSurface.tsx` 不改；Revision 1 的信任、动态 readiness、Preview 安全、日志、回收与 generation 不变量不退化。
  - 局部验证：`npm run typecheck`；Workspace/Store/Desktop Seam/Runtime/Preview 目标测试；必要时 `npm run build`。
  - 停止：需要新增依赖、删除旧用户数据、扩大安全承诺、修改白名单外文件或发现产品合同冲突。

- [x] `CHECK-P0-02`｜owner=`quality_verifier`｜write_mode=`readonly`｜依赖：`DEV-P0-04`
  - 目标：风险定向检查 schema 迁移、Tab 右键/命名、首页双系统隔离、同 Runtime 多 host、consumer/release 与 late event；不回写正式 Acceptance/TODO 状态。

## Revision 2 同步

- [x] `SYNC-P0-02`｜owner=`main_agent`｜write_mode=`writer`｜依赖：`UX-P0-02`,`ARCH-P0-02`
  - 目标：将 accepted Revision 2 同步到 `CONTEXT.md`、相关 PRD Planned Delta、Acceptance delta、根 TODO 与索引；实现后再同步 Current/as-built。

```yaml
task_level: Heavy
level_basis: 新增本地任意代码自动执行、持久化主旅程、Electron 进程与预览安全边界
professional_gaps: [product_scope, experience_flow, technical_runtime, acceptance_contract, implementation, quality]
role_plan: [product_manager, experience_designer, technical_architect, quality_verifier, implementation_engineer]
not_needed:
  - market_researcher: no_relevant_impact
  - cmo_value_strategist: no_relevant_impact
  - visual_interface_designer: existing_contract_sufficient
  - user_researcher: existing_evidence_sufficient
confirmation: user_confirmed
coverage_gate: pass
```

## 开发 P0

- [x] `ARCH-P0-01`｜owner=`technical_architect`｜write_mode=`response_only`｜依赖：无
  - 目标：冻结 SQLite/JSON 快照一致性、动态端口与 readiness、环境变量 allowlist、Runtime/Preview 依赖顺序及运行时默认常量。
  - 边界：不改变既有产品范围、Acceptance 或“受信任本地进程而非 OS 强沙箱”的安全表述。
  - 完成条件：实现任务可直接消费无冲突的技术合同；若发现产品冲突则停止实现并交回主 Agent。
  - 已冻结：SQLite/JSON 完整快照排序、固定 `npm run dev` + loopback 动态端口、最小环境 allowlist、Runtime/Preview 顺序、超时/重试/回收默认值与测试不变量。

- [x] `DEV-P0-01`｜来源 `C-001`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：无｜写入：Workspace 类型、持久化、侧栏与内容分发
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=45m`；`attempt=1`；`instance_id=/root/local_app_runtime_impl`；`exact_write_allowlist=src/components/types.ts,src/components/workspace-session.ts,src/chat-workspace-persistence.ts,src/workspace-snapshot-resolution.ts,src/project-path.ts,electron/chat-workspace-store.ts,src/components/AppShell.tsx,src/components/AppShellSidebar.tsx,src/components/AppShellWorkspace.tsx,src/components/LocalAppOnboardingDialog.tsx,src/components/LocalAppWorkspace.tsx,electron/workspace-session.test.mjs,electron/chat-workspace-store.test.mjs,对应样式/i18n文件`；`diff_baseline=a940b9bff60e19315e3fcce982589315c1d93c2b`。
  - 修改：新增 Local App Definition/Tab、New Tab 入口、选择/关闭/激活和 durable restore。
  - 保持：普通项目、线程和项目首页选择语义不变；旧工作区快照继续可读。
  - 边界：取消创建不落脏数据；目录缺失进入可恢复状态。
  - 完成条件：用户可创建并恢复 Local App Tab，单元测试覆盖状态转换和迁移。

- [x] `DEV-P0-02`｜来源 `C-002`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`DEV-P0-01`｜写入：Local App Runtime、Desktop Seam 与 Electron 装配
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=45m`；`attempt=1`；`instance_id=/root/local_app_runtime_impl`；`exact_write_allowlist=electron/local-app-runtime/**,electron/main.ts,electron/preload.ts,src/desktop-api.ts,src/desktop-types.ts,src/desktop-seam.ts,electron/desktop-seam.test.mjs,electron/local-app-runtime.test.mjs,test-fixtures/local-app-runtime/**`；`diff_baseline=a940b9bff60e19315e3fcce982589315c1d93c2b`。
  - 修改：自动执行 `npm run dev`、捕获日志、readiness、状态事件、有限重启和进程树回收。
  - 保持：renderer 只能使用命名 IPC；不继承完整宿主 env；不将 `cwd` 描述为安全沙箱。
  - 边界：端口冲突、命令缺失、退出中止、崩溃退避和 stale generation。
  - 完成条件：受信任 fixture 可自动启动、就绪、停止和恢复，失败状态可观察。

- [x] `DEV-P0-03`｜来源 `C-003`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`DEV-P0-01`,`DEV-P0-02`,`DEV-P1-02` 的最小隔离 Preview｜写入：CodeNow Wiki 接入配置与集成测试
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=45m`；`attempt=1`；`instance_id=/root/local_app_runtime_impl`；`exact_write_allowlist=本仓库 Local App fixture、集成测试与运行证据文件；不得修改 /Volumes/macOS/Github/codenow.wiki`；`diff_baseline=a940b9bff60e19315e3fcce982589315c1d93c2b`。
  - 修改：以 `/Volumes/macOS/Github/codenow.wiki` 和 `npm run dev` 验证真实项目接入，不硬编码端口。
  - 保持：CodeNow Wiki 源码只读；接入模型对其它本地 Web 项目可复用。
  - 边界：路径不存在、`dev` 脚本缺失、依赖准备失败、Next.js 启动超时。
  - 完成条件：AgentOS 自动启动并在 Local App Tab 中显示 CodeNow Wiki。

## 开发 P1

- [x] `DEV-P1-01`｜来源 `C-004`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：全部 P0｜写入：运行时恢复、引用计数、退出清理与测试
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=45m`；`attempt=1`；`instance_id=/root/local_app_runtime_impl`；`exact_write_allowlist=electron/local-app-runtime/**,electron/main.ts,src/components/workspace-session.ts,src/chat-workspace-persistence.ts,src/components/AppShell.tsx,对应测试`；`diff_baseline=a940b9bff60e19315e3fcce982589315c1d93c2b`。
  - 修改：恢复时重新启动、同定义复用 Runtime、最后调用方关闭后回收、退出杀进程树。
  - 边界：旧 PID/端口、重复恢复、快速开关 Tab、late event。
  - 完成条件：没有重复服务和孤儿进程，恢复选择稳定。

- [x] `DEV-P1-02`｜来源 `C-005`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`DEV-P0-02`｜写入：隔离 PreviewView 与安全测试
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=45m`；`attempt=1`；`instance_id=/root/local_app_runtime_impl`；`exact_write_allowlist=electron/local-app-runtime/**,electron/main.ts,electron/preload.ts,src/desktop-api.ts,src/desktop-types.ts,src/desktop-seam.ts,src/components/LocalAppPreview.tsx,src/components/LocalAppWorkspace.tsx,electron/desktop-seam.test.mjs,electron/local-app-preview.test.mjs,对应样式/i18n文件`；`diff_baseline=a940b9bff60e19315e3fcce982589315c1d93c2b`。
  - 修改：独立无 Node Preview、HMR 转发、刷新/重启/日志状态、导航与窗口限制。
  - 边界：预览崩溃、HMR 断线、外部导航、弹窗和权限请求。
  - 完成条件：站点正常显示且不能访问 Electron/Node bridge。

## Development Check 定向修复

- [x] `FIX-P0-01`｜来源 `C-004`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：首轮 Development Check
  - 编排：`deadline=30m`；`attempt=2`；`instance_id=/root/local_app_runtime_impl`；写入仅限 Runtime manager/supervisor 与对应测试。
  - 修复：restart 前后保留并重新挂载全部 consumers；两个 consumer 重启后释放一个不得停止 Runtime。

- [x] `FIX-P0-02`｜来源 `C-003`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：首轮 Development Check
  - 编排：`deadline=30m`；`attempt=2`；`instance_id=/root/local_app_runtime_impl`；写入仅限 AppShell、Runtime manager、相关 Desktop Seam 与对应测试。
  - 修复：canonical root 变化时先关闭旧 Preview、停止旧 Runtime、撤销旧授权，再持久化并启动新 Runtime；不得继续复用旧进程。

- [x] `FIX-P1-01`｜来源 `C-002`,`C-004`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：首轮 Development Check
  - 编排：`deadline=30m`；`attempt=2`；`instance_id=/root/local_app_runtime_impl`；写入仅限 Local App preparation record、Main 装配与对应测试。
  - 修复：原子持久化 canonical root + lock digest；AgentOS 重启后 lockfile 变化仍触发 `npm ci`。

- [x] `FIX-P1-02`｜来源 `C-001`,`C-005`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：首轮 Development Check
  - 编排：`deadline=30m`；`attempt=2`；`instance_id=/root/local_app_runtime_impl`；写入仅限 Local App Preview/对话框/AppShell、样式与对应测试。
  - 修复：Preview bounds 跟踪 capture scroll，reload/HMR 恢复时清除降级状态；对话框初始焦点与 focus trap；关闭 Tab 后焦点落到相邻 Tab 或 New Tab。

- [x] `FIX-P0-03`｜来源 `C-001`,`C-002`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：用户确认的持久化失败根因
  - 编排：`deadline=20m`；`attempt=3`；`instance_id=/root/local_app_runtime_impl`；写入仅限 Workspace persistence/session、Local App 创建 UI、typed Desktop Seam、Main 装配与对应测试。
  - 修复：首次创建由 Main 确认 Definition/Tab 已写入 JSON/SQLite 后，Renderer 才提交可见 Tab，并在此后启动 Runtime；保存失败必须向 Renderer 返回失败、阻断创建与启动、保持对话框并显示可读错误。
  - 回归：强制 Main save 拒绝时，Definition/Tab/Runtime 均不产生；成功时顺序必须为 persist success → visible state → start，`local-app-definition-missing` 不再出现。

- [x] `FIX-P0-04`｜来源 `C-001`,`C-004`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：第二轮 Development Check
  - 编排：`deadline=30m`；`attempt=4`；`instance_id=/root/local_app_runtime_impl`；写入仅限 Workspace store/session、创建/重定位事务、Runtime/Preview 与对应测试。
  - 修复：创建前 flush Renderer pending snapshot，并以 Main flush 后的 authoritative revision 提交；不得用旧 Renderer revision 覆盖未保存聊天/项目变更。
  - 修复：JSON 原子替换、SQLite 事务与单介质成功恢复语义；避免以 best-effort 回滚掩盖 Definition/Tab 残留。

- [x] `FIX-P1-03`｜来源 `C-002`,`C-003`,`C-004`,`C-005`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：第二轮 Development Check
  - 编排：`deadline=30m`；`attempt=4`；`instance_id=/root/local_app_runtime_impl`。
  - 修复：只撤销本轮新建且不被其它 Definition 使用的 trust；relocate 在单一 operation 内读取/revision gate/保存并提供失败补偿；preparation record 缺失/损坏时保守执行 `npm ci`；Preview partition 按 session 隔离，reload 双分支校验当前 session；后台保存失败可见并可重试。

## 用户确认的 Local App 体验修复

- [x] `UX-P0-01`｜来源 `C-001`,`C-004`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：产品/体验规则已冻结
  - 编排：`deadline=30m`；`attempt=5`；`instance_id=/root/local_app_runtime_impl`。
  - 修复：切换聊天/其它 Tab 只隐藏 Preview，不 release consumer、不 stop Runtime；切回复用原 PreviewSession/Runtime generation，不重复 spawn。
  - 修复：打开 Renderer chooser 前先隐藏原生 Preview，关闭/取消/成功后只恢复当前活动 Preview，旧 visibility 请求不得反向覆盖。

- [x] `UX-P0-02`｜来源 `C-001`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：产品/体验规则已冻结
  - 编排：`deadline=30m`；`attempt=5`；`instance_id=/root/local_app_runtime_impl`。
  - 修复：`New Tab` 始终提供“绑定新的本地应用”和“打开已接入应用”；打开已有应用也走 Main authoritative persist → Renderer visible Tab → Runtime attach，保存失败不显示 Tab。
  - 规则：相同 canonical root 不创建重复 Definition，只创建新的 LocalAppTab 并复用 Runtime。

- [x] `UX-P1-01`｜来源 `C-002`,`C-005`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：产品/体验/视觉规则已冻结
  - 编排：`deadline=30m`；`attempt=5`；`instance_id=/root/local_app_runtime_impl`。
  - 修复：Local App 预览铺满主内容区；刷新、紧凑状态与日志入口进入顶部工具区；Running/最近日志默认不占主区域；失败/停止/path missing 保留明显恢复动作。

## ATDD P0/P1

- [x] `ATDD-P0-01`｜来源 `C-001`｜owner=`quality_verifier`｜write_mode=`response_only`｜对应开发 `DEV-P0-01`｜目标：`prd/local-app-runtime/acceptance.md`
  - 契约：New Tab 创建、取消、选择、关闭和恢复。
  - 观察：稳定 selector、Workspace Session 单测和 UI 集成测试。

- [x] `ATDD-P0-02`｜来源 `C-002`｜owner=`quality_verifier`｜write_mode=`response_only`｜对应开发 `DEV-P0-02`｜目标：`prd/local-app-runtime/acceptance.md`
  - 契约：自动依赖准备、`npm run dev`、readiness、错误与重试。
  - 观察：受控 fixture、进程状态、日志摘要和 IPC 事件。

- [x] `ATDD-P0-03`｜来源 `C-003`｜owner=`quality_verifier`｜write_mode=`response_only`｜对应开发 `DEV-P0-03`｜目标：`prd/local-app-runtime/acceptance.md`
  - 契约：CodeNow Wiki 真实目录接入与页面显示。
  - 观察：本地 live smoke；环境不可用时保持未验证，不以 fixture 冒充。

- [x] `ATDD-P1-01`｜来源 `C-004`｜owner=`quality_verifier`｜write_mode=`response_only`｜对应开发 `DEV-P1-01`｜目标：`prd/local-app-runtime/acceptance.md`
  - 契约：应用恢复、Runtime 复用、进程树回收、stale event 丢弃。
  - 观察：集成测试、PID/端口探测与退出检查。

- [x] `ATDD-P1-02`｜来源 `C-005`｜owner=`quality_verifier`｜write_mode=`response_only`｜对应开发 `DEV-P1-02`｜目标：`prd/local-app-runtime/acceptance.md`
  - 契约：Preview 无 Node/Electron 能力、导航和弹窗受控、HMR 可恢复。
  - 观察：Electron 集成测试与安全负例。

## Later

- [ ] `LATER-01`：项目首页开发模式复用同一 Local App Runtime，左预览、右 Claude Agent SDK。
- [ ] `LATER-02`：Claude Agent SDK 使用通用 SandboxBroker 工具修改代码、安装依赖和控制 Runtime。
- [ ] `LATER-03`：确定并实现生产级跨平台 Sandbox Provider；通过项目外文件、网络、环境变量和子进程逃逸验证后再声明强隔离。

- [x] `SYNC-P0-01`｜owner=`main_agent`｜write_mode=`writer`｜依赖：方案已由用户确认、开发与 ATDD 任务规格完整
  - 动作：调用 `$update-prd`，以本 change 的 `proposal.md`、`design.md`、`tasks.md` 为计划输入。
  - 写入（主 Agent）：根 `TODO.md`、`prd/local-app-runtime/acceptance.md`、`prd/README.md`、必要索引/指针与 change 共享状态；专业角色分别写模块 README/design/technical。
  - 边界：不改业务代码，不执行正式验收，不伪造证据或状态戳。
  - 已同步：`prd/local-app-runtime/README.md`、`design.md`、`technical.md`、`acceptance.md`、`sync.json`、根 `TODO.md`、`prd/README.md`、`CONTEXT.md`。

## 2026-08-25 回归修复

- [ ] `REG-UI-01`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：用户 2026-08-25 明确纠正的首页切换合同
  - 结果：Workspace Runtime Preview 重新铺满主内容区；项目首页恢复 Revision 2 前的 hero/Composer/留白/宽度/滚动布局，只在既有 below-composer 卡片容器内切换卡片区与 Runtime 面板；Runtime 面板自身不重叠。
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=30m`；`attempt=1`；`instance_id=/root/runtime_layout_impl`；`exact_write_allowlist=src/components/chat/ChatStartView.tsx,src/style.css`；`diff_baseline=HEAD c5aed82 + unrelated dirty baseline (.agents deletions, AGENTS.md, .agent/)`。
  - 验证：`npm run typecheck`；稳定 Electron GUI 中分别检查项目 Overview、项目 Runtime 与 Workspace Runtime 的可视高度、窄宽度换行和无重叠。
  - Rework：attempt 1 错把 hero + Composer 一并放入 Overview 条件分支；attempt 2 又为固定 Composer 重写了首页 flex/overflow 并把 Tab 放成页面顶栏。用户均明确否定。attempt 3 必须以 `c5aed82^` 的原首页 DOM/CSS 为布局基线，只在原 `chat-start-view__below-composer` 内加入局部切换。
  - 编排：`deadline=30m`；`attempt=3`；`instance_id=/root/runtime_layout_rework2`；`exact_write_allowlist=src/components/chat/ChatStartView.tsx,src/style.css`；`diff_baseline=HEAD c5aed82 + attempt2 diff dd894b22 + runtime writer disjoint diff + unrelated dirty baseline`。

- [ ] `REG-RUNTIME-01`｜owner=`technical_architect → implementation_engineer`｜write_mode=`response_only → writer`｜依赖：现有进程树回收与安全合同
  - 结果：AgentOS/Electron 异常或开发热重启后，不遗留 app-owned `npm run dev` 进程阻塞下一次启动；不得误杀同目录的外部进程；撞锁/提前退出显示真实失败阶段。
  - 证据基线：旧 `/Volumes/macOS/Github/homepage` Runtime PID 17509/17534/17535 于 15:57 启动后成为 PID 1 子进程，持有 `.next/dev/lock` 与 54233；当前 Electron PID 53900 于 20:10 启动，未拥有该进程，首页 Runtime 显示 readiness 失败。
  - 编排：技术架构实例 `/root/runtime_orphan_arch` 已冻结最小 ownership/cleanup 合同；`deadline=45m`；`attempt=1`；`instance_id=/root/runtime_orphan_impl`；`exact_write_allowlist=electron/local-app-runtime/index.ts,electron/local-app-runtime.test.mjs,test-fixtures/local-app-runtime/server.mjs`；`diff_baseline=HEAD c5aed82 + REG-UI-01 diff + unrelated dirty baseline`。
  - 验证：目标 Runtime 测试覆盖 app-owned 归属、异常 parent exit、PID 复用/外部进程负例、重复启动与可读错误；稳定集成后再做一次开发质量检查。

- [ ] `CHECK-REG-01`｜owner=`quality_verifier`｜write_mode=`readonly`｜依赖：`REG-UI-01`,`REG-RUNTIME-01`
  - 目标：对冻结集成 diff 做一次 full Development Check，重点检查 Runtime 进程所有权、误杀负例、异常恢复、Preview bounds、首页两视图隔离与响应式重叠；不回写正式 Acceptance/TODO 状态。
