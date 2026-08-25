# Tasks

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

- [ ] `DEV-P0-01`｜来源 `C-001`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：无｜写入：Workspace 类型、持久化、侧栏与内容分发
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=dispatch-time`；`attempt=0`；`instance_id=unassigned`；`exact_write_allowlist=src/components/types.ts,src/components/workspace-session.ts,src/chat-workspace-persistence.ts,src/components/AppShell.tsx,src/components/AppShellSidebar.tsx,src/components/AppShellWorkspace.tsx,对应测试与样式/i18n文件`；`diff_baseline=4ed464766c0c7c844944e825dfb606b51232049e`。
  - 修改：新增 Local App Definition/Tab、New Tab 入口、选择/关闭/激活和 durable restore。
  - 保持：普通项目、线程和项目首页选择语义不变；旧工作区快照继续可读。
  - 边界：取消创建不落脏数据；目录缺失进入可恢复状态。
  - 完成条件：用户可创建并恢复 Local App Tab，单元测试覆盖状态转换和迁移。

- [ ] `DEV-P0-02`｜来源 `C-002`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`DEV-P0-01`｜写入：Local App Runtime、Desktop Seam 与 Electron 装配
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=dispatch-time`；`attempt=0`；`instance_id=unassigned`；`exact_write_allowlist=electron/local-app-runtime/**,electron/main.ts,electron/preload.ts,src/desktop-api.ts,src/desktop-types.ts,src/desktop-seam.ts,对应测试`；`diff_baseline=4ed464766c0c7c844944e825dfb606b51232049e`。
  - 修改：自动执行 `npm run dev`、捕获日志、readiness、状态事件、有限重启和进程树回收。
  - 保持：renderer 只能使用命名 IPC；不继承完整宿主 env；不将 `cwd` 描述为安全沙箱。
  - 边界：端口冲突、命令缺失、退出中止、崩溃退避和 stale generation。
  - 完成条件：受信任 fixture 可自动启动、就绪、停止和恢复，失败状态可观察。

- [ ] `DEV-P0-03`｜来源 `C-003`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`DEV-P0-01`,`DEV-P0-02`｜写入：CodeNow Wiki 接入配置与集成测试
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=dispatch-time`；`attempt=0`；`instance_id=unassigned`；`exact_write_allowlist=本仓库 Local App seed/config/fixture 与集成测试文件；不得修改 /Volumes/macOS/Github/codenow.wiki`；`diff_baseline=4ed464766c0c7c844944e825dfb606b51232049e`。
  - 修改：以 `/Volumes/macOS/Github/codenow.wiki` 和 `npm run dev` 验证真实项目接入，不硬编码端口。
  - 保持：CodeNow Wiki 源码只读；接入模型对其它本地 Web 项目可复用。
  - 边界：路径不存在、`dev` 脚本缺失、依赖准备失败、Next.js 启动超时。
  - 完成条件：AgentOS 自动启动并在 Local App Tab 中显示 CodeNow Wiki。

## 开发 P1

- [ ] `DEV-P1-01`｜来源 `C-004`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：全部 P0｜写入：运行时恢复、引用计数、退出清理与测试
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=dispatch-time`；`attempt=0`；`instance_id=unassigned`；`exact_write_allowlist=electron/local-app-runtime/**,electron/main.ts,src/components/workspace-session.ts,src/chat-workspace-persistence.ts,对应测试`；`diff_baseline=4ed464766c0c7c844944e825dfb606b51232049e`。
  - 修改：恢复时重新启动、同定义复用 Runtime、最后调用方关闭后回收、退出杀进程树。
  - 边界：旧 PID/端口、重复恢复、快速开关 Tab、late event。
  - 完成条件：没有重复服务和孤儿进程，恢复选择稳定。

- [ ] `DEV-P1-02`｜来源 `C-005`｜owner=`implementation_engineer`｜write_mode=`writer`｜依赖：`DEV-P0-02`｜写入：隔离 PreviewView 与安全测试
  - 编排：ownership 指针 `.codex/rules/ownership.md`；`deadline=dispatch-time`；`attempt=0`；`instance_id=unassigned`；`exact_write_allowlist=electron/local-app-runtime/**,electron/main.ts,src/components/LocalAppPreview.tsx,对应测试`；`diff_baseline=4ed464766c0c7c844944e825dfb606b51232049e`。
  - 修改：独立无 Node Preview、HMR 转发、刷新/重启/日志状态、导航与窗口限制。
  - 边界：预览崩溃、HMR 断线、外部导航、弹窗和权限请求。
  - 完成条件：站点正常显示且不能访问 Electron/Node bridge。

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
