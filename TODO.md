# AgentOS TODO

> 继续开发入口。产品验收契约只在对应 `prd/<module>/acceptance.md` 定义；TODO 不复制 GWT 场景，也不因代码自检自动勾选。

## 1. 活跃变更

### 1.1 Workspace Tab 与可复用 Runtime（Revision 2）

- **Change**：[`chg-20260825-local-app-tabs-runtime`](changes/active/chg-20260825-local-app-tabs-runtime/proposal.md)
- **PRD**：[`prd/local-app-runtime/README.md`](prd/local-app-runtime/README.md)
- **验收契约**：[`prd/local-app-runtime/acceptance.md`](prd/local-app-runtime/acceptance.md)
- **当前状态**：Revision 2 已实现并通过独立 Development Check；正式 `project-verify` 尚未执行。Revision 1 正式 Acceptance 历史仍为 10/16 通过、6/16 待补证据、0 失败。

#### Revision 2 当前开发

- [x] `DEV-P0-04`｜将 Local App 用户概念迁移为 Workspace Tab/Runtime；实现自定义命名与重命名、右键/键盘菜单关闭、Tabs 位于新对话/搜索上方、schema v3 迁移、项目首页 `Overview / Runtime` 双系统、Runtime 多 host 与独立 PreviewSession。来源：`C-006`–`C-009`。
- [x] `CHECK-P0-02`｜独立检查迁移安全、Main 权威写入、Tab 交互、首页两套系统隔离、consumer/release 和 late event；第三轮 Development Check 为 PASS，不修改正式 Acceptance 状态。

> 下列开发项的实现已经落盘并通过自动化检查；根据本文件门禁，在 6 个真实 Electron 端到端证据补齐、Acceptance 全部通过前暂不勾选或归档。

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

- [ ] `LATER-01`｜已被 Revision 2 的“项目首页独立 Runtime 页”取代；不再采用左预览/右 Claude 分栏，也不改卡片系统。
- [ ] `LATER-02`｜Claude Agent SDK 通过通用 SandboxBroker 在项目运行时中读写、安装依赖和控制进程。
- [ ] `LATER-03`｜确定并实现生产级跨平台 Sandbox Provider；完成项目外文件、网络、环境变量和子进程逃逸验证后再声明强隔离。

## 3. 验证与文档状态

- [x] 业务实现完成后进入 `project-verify`，由独立 `quality_verifier` 逐条验证 `prd/local-app-runtime/acceptance.md`（2026-08-25 首轮：10/16 通过、6/16 待补证据、0 失败）。
- [ ] 正式验收通过后，才能回写 Acceptance 与本 TODO 的完成状态，并将 Planned 同步为 as-built Current。
