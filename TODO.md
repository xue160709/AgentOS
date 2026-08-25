# AgentOS TODO

> 继续开发入口。产品验收契约只在对应 `prd/<module>/acceptance.md` 定义；TODO 不复制 GWT 场景，也不因代码自检自动勾选。

## 1. 活跃变更

### 1.1 Local App New Tab 与 CodeNow Wiki 自动运行

- **Change**：[`chg-20260825-local-app-tabs-runtime`](changes/active/chg-20260825-local-app-tabs-runtime/proposal.md)
- **PRD**：[`prd/local-app-runtime/README.md`](prd/local-app-runtime/README.md)
- **验收契约**：[`prd/local-app-runtime/acceptance.md`](prd/local-app-runtime/acceptance.md)
- **当前状态**：已完成规划同步；业务代码与正式验收尚未开始。

#### P0：用户可见闭环

- [ ] `DEV-P0-01`｜实现 Local App Definition/Tab、侧栏 `New Tab`、首次目录选择与信任确认、创建/激活/关闭及旧快照迁移。来源：`C-001`；验收：`ATDD-P0-01`。
- [ ] `DEV-P0-02`｜实现 AgentOS 自动依赖准备、`npm run dev`、动态 readiness、运行状态、日志、重试、停止和进程回收基础。来源：`C-002`；验收：`ATDD-P0-02`。
- [ ] `DEV-P0-03`｜以 `/Volumes/macOS/Github/codenow.wiki` 做首个真实接入，确认 `next dev` 自动启动和页面预览，不硬编码路径以外的产品逻辑或端口。来源：`C-003`；验收：`ATDD-P0-03`。

#### P1：交付前必要正确性

- [ ] `DEV-P1-01`｜实现 Tab/Runtime/Preview 分离、同应用 Runtime 复用、AgentOS 恢复后自动启动、generation 防迟到事件和退出时进程树清理。来源：`C-004`；验收：`ATDD-P1-01`。
- [ ] `DEV-P1-02`｜实现独立无 Node Preview、HMR/刷新/重启、导航/弹窗/权限限制和安全负例测试。来源：`C-005`；验收：`ATDD-P1-02`。

#### 实施门禁

- [ ] 实现前冻结首期 `TrustedLocalProcessAdapter` 的安全文案与环境变量 allowlist；不得把它描述为生产级 OS 沙箱。
- [ ] 为 Local App writer 任务分配精确代码路径、diff 基线和唯一实现者；实现后按风险触发开发质量检查。
- [ ] CodeNow Wiki live smoke 需要实际启动外部项目时，单独执行并保留真实日志/页面证据；fixture 不得替代。

## 2. 后续范围

- [ ] `LATER-01`｜项目首页复用 Local App Runtime，形成左侧预览、右侧 Claude Agent SDK 的开发工作台。
- [ ] `LATER-02`｜Claude Agent SDK 通过通用 SandboxBroker 在项目运行时中读写、安装依赖和控制进程。
- [ ] `LATER-03`｜确定并实现生产级跨平台 Sandbox Provider；完成项目外文件、网络、环境变量和子进程逃逸验证后再声明强隔离。

## 3. 验证与文档状态

- [ ] 业务实现完成后进入 `project-verify`，由独立 `quality_verifier` 逐条验证 `prd/local-app-runtime/acceptance.md`。
- [ ] 正式验收通过后，才能回写 Acceptance 与本 TODO 的完成状态，并将 Planned 同步为 as-built Current。
