# Revision 3 Work Orders

> 这些任务单是执行入口，不是新的产品事实源。Revision 3 实现只允许从 `R3-01` 开始；旧 `M2/M3` 已被新 Runtime 合同取代，不能作为开发会话实现入口。实现前必须阅读同目录上级的 `design.md`、`technical.md`、`acceptance.md`；网站线另读 `protocol-v1.md`。冲突时按 `technical.md` 顶部优先级处理并停工报告。

## 执行规则

1. 一次只给实现者一个 work order；不要直接给“实现 Revision 3”。
2. `R3-01 → R3-07 → R3-CHECK` 必须串行：它们依次冻结 durable data、共享 broker、Runtime identity、开发事务、窗口 capability、入口 cutover 与恢复边界，并共享核心文件。
3. 实现者只能写任务单 `write allowlist` 中的文件；发现必须改其它业务文件时停下说明原因，先修订任务单。
4. 不得删除、回滚或格式化 allowlist 外的用户改动；工作区脏文件不是实现者的清理目标。
5. 每单完成时必须回报：修改文件、合同映射、运行命令、退出码、未验证风险。没有测试证据不能标完成。
6. 禁止自行补产品行为、放宽协议校验、增加兼容 fallback，或把失败吞成 success。
7. 每张 R3 writer 单的 `instance_id` 与 `diff_baseline` 在仓库中保持 `UNASSIGNED`，表示尚未派发、没有长期写权；派发者必须在任务消息中绑定当前 writer、attempt、deadline、精确 allowlist 与当时基线，未绑定不可执行。

## 依赖图

```text
R3-01 Runtime Thread contract/store/search
  -> R3-02 ChatBrokerCore + Runtime facade/capability
    -> R3-03 Definition isolation + root execution registry
      -> R3-04 RuntimeDevelopmentCoordinator + artifact bridge
        -> R3-05 Runtime window + view state + IPC/presence
          -> R3-06 Project/Workspace surfaces + legacy cutover (P0 gate)
            -> R3-07 recovery/quit/migration/a11y hardening (P1 gate)
              -> R3-CHECK independent development check

Revision 2 历史链（已实现、未正式验收）：

M0-01 contracts + runner sink
  -> M0-02 broker + single writer
    -> M0-03 typed IPC + permission + capability
        -> M0-04 project window + view state
          -> M0-05A scoped preload + redacted capabilities
            -> M0-05B broker thread mutations
              -> M0-05C one workspace coordinator
                -> M0-05D runtime adapter + scoped services
                  -> M0-05E prompt presence + rewind
                    -> M0-05F default-off production composition
                      -> M0-05 main renderer projection
                        -> M0-06 project window + Revision1 migration
                          -> M0-GATE

M0-GATE -> M1-01 binding/protocol stores -> M1-02 deep-link/network/task -> M1-03 pairing/settings/focus
M0-GATE -> M2-01 edit coordinator/hooks -> M2-02 runtime/UI integration
M1-02 -> M1A-01 preview narrow capture

M0-06 -> M3-01 workspace tab backing project（补记：已实现，未经本目录派单）

all -> BUG-AUDIT-CHAT-01 -> BUG-AUDIT-WS-02 -> FIX-WS-01 -> FIX-CHAT-01 -> CHECK-02
```

`FIX-WS-01` 必须排在 `FIX-CHAT-01` 之前：项目生命周期在它之前不落盘，`FIX-CHAT-01` 的重启回归断言无法成立。

## Work order 索引

### Revision 3（当前实施入口）

当前进度：`R3-01`–`R3-07`、旧测试 loader、`R3-FIX-CHECK-01/02` 与最终只读 `R3-CHECK-02` 均已完成；原 P0/P1 独立确认修复，无新增 P0/P1。Development Check 结论为 `PASS_WITH_RISK`：exact 默认并发 Electron suite 仍在 local-app fixture pending，真实 Electron GUI smoke 未执行；不得签正式验收。

2026-08-30 补记：用户真实使用后报告两处 `R3-06` 缺陷（项目首页仍被 Main 陈旧 `activeWorkspaceTabId` 拉回工作台；Runtime 开发文案写错命名空间全部显示原始 key），由 `R3-FIX-USER-01` 修复并补齐回归。这两条说明 `ATDD-RDS-301`/`ATDD-RDS-309` 此前只有 source-grep 级证据，真实渲染路径仍未被自动化覆盖。

| 顺序 | 文件 | 交付 | 门禁 |
| --- | --- | --- | --- |
| R3-01 | `R3-01-runtime-thread-store.md` | Runtime Thread 合同、SQLite/sidecar、搜索元数据与回滚保留 | data contract |
| R3-02 | `R3-02-chat-broker-core-runtime-facade.md` | 唯一 ChatBrokerCore、Runtime facade/capability/scoped read | broker contract |
| R3-03 | `R3-03-runtime-root-execution-registry.md` | Definition 独立、root execution lease、去 path alias | runtime identity |
| R3-04 | `R3-04-runtime-development-coordinator.md` | 窗口级状态机、exit gate、generation-fenced atomic save | transaction |
| R3-05 | `R3-05-runtime-development-window-ipc.md` | 专用窗口、view state、窄 preload、presence/close | window security |
| R3-06 | `R3-06-runtime-surfaces-cutover.md` | 项目首页/工作台入口、统一 snapshot、停用 backing Project 路径 | P0 complete |
| R3-07 | `R3-07-runtime-recovery-hardening.md` | quit/restart/relocation/trust/late event/a11y/rollback | P1 complete |
| CHECK | `R3-CHECK-runtime-development.md` | 独立 Development Check 与真实 Electron smoke，不是正式验收 | verification |
| FIX-USER | `R3-FIX-USER-01-project-home-selection-locale.md` | 空选中态不被 Main 陈旧 Tab 覆盖、Runtime 文案归位 `runtime` 段、两条渲染路径回归 | 用户实测缺陷 |

### Revision 2（历史执行记录）

| 顺序 | 文件 | 交付 |
| --- | --- | --- |
| 1 | `M0-01-contracts-runner-sink.md` | 共享合同、纯 reducer、runner event sink |
| 2 | `M0-02-main-chat-broker.md` | Main 单 writer、run/prompt 路由 |
| 3 | `M0-03-ipc-permission-capability.md` | typed bridge、sender capability、Main 权限模式 |
| 4 | `M0-04-project-chat-window.md` | 一项目一窗口、view state persistence |
| 5 | `M0-05A-scoped-chat-capabilities.md` | 窄 preload profile、脱敏 project-scoped Chat 能力 |
| 6 | `M0-05B-broker-thread-mutations.md` | fork/edit/archive/pin/model/diff-review Main-owned intent |
| 7 | `M0-05C-workspace-coordinator.md` | broker/Main 共用唯一 read-transform-save 调度器 |
| 8 | `M0-05D-runtime-scoped-services.md` | 真实 runner adapter、durable scoped reads、附件 realpath containment（disabled） |
| 9 | `M0-05E-prompt-presence-rewind.md` | Main-owned presence/prompt owner、broker-owned rewind（disabled） |
| 10 | `M0-05F-production-composition.md` | default-off production composition、TaskHome/sink/handler 原子边界 |
| 11 | `M0-05-renderer-cutover.md` | 主窗口 snapshot 投影、封闭 renderer writer |
| 12 | `M0-06-project-window-command-channel.md` | 完整项目窗口、Revision 1 通道迁移、M0 Gate |
| 13 | `M1-01-binding-protocol-stores.md` | 协议 parser、Binding 与 receipt stores |
| 14 | `M1-02-deep-link-ticket.md` | 平台 deep link、HTTPS client、外部任务提交 |
| 15 | `M1-03-pairing-settings-focus.md` | 配对 UI、连接管理、新任务焦点规则 |
| 16 | `M1A-01-preview-capture.md` | Preview 窄 deep-link 捕获与隔离 |
| 17 | `M2-01-runtime-edit-coordinator.md` | edit lease、mutation、settle generation |
| 18 | `M2-02-runtime-ui-integration.md` | Runtime intents、状态文案、last-good 收口 |
| 19 | `FIX-WS-01-workspace-ownership.md` | 项目生命周期与偏好的 Main-owned 单一命令通道、ownership audit 关单 |
| 20 | `FIX-CHAT-01-sidebar-thread-mutations.md` | 主侧边栏 archive/pin Main-owned cutover、busy 合同对齐、readiness 三态、Runtime snapshot 竞态回归 |
| 21 | `CHECK-02-development-check.md` | 独立风险检查与证据，不改产品范围 |

> `M3-01`（Workspace Tab durable backing Project）已在 `electron/workspace-tab-project.ts` / `electron/workspace-tab-project-chat.ts` 实现，但**没有经过本目录派单**。这是执行规则 1/3 的一次实际失效，已在 `evidence.md` 记录；后续同类实现必须先补任务单再落地。

## 分支与提交建议

- 分支：`codex/chg-20260818-agent-command-channel-r3`
- 每个 work order 一个可回滚提交，标题包含 work order ID。
- feature flag 现状：`projectChatBrokerV2Enabled` 读取 `AGENTOS_PROJECT_CHAT_BROKER_V2 !== '0'`，M0-GATE 后已**默认开启**，`0` 只保留为回滚逃生口。任何"默认关闭"的旧描述均已失效，评估缺陷影响面时必须按默认开启计算。
- Revision 3 rollback flag 必须同时关闭新 Runtime 入口与 Runtime facade，但不得删除 `runtime_development_threads`、sidecar、view state、last-good 或旧 synthetic Project 数据。

## 全局停止条件

出现任一情况立即停止，不猜：

- 规格字段/状态在现有 SDK 中无法观察；
- safeStorage、平台协议注册或 Runtime API 与规格前提不符；
- 需要让 Preview 获得 preload/Node；
- 必须允许多个 renderer 写完整 workspace 才能推进；
- 测试要求修改真实用户数据、访问生产网站或使用真实 credential；
- allowlist 外已有改动与本任务重叠，无法安全保留。
