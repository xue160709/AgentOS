# Terra Work Orders

> 这些任务单是执行入口，不是新的产品事实源。实现前必须阅读同目录上级的 `design.md`、`technical.md`、`protocol-v1.md`、`acceptance.md`。冲突时按 `technical.md` 顶部优先级处理并停工报告。

## 执行规则

1. 一次只给 Terra 一个 work order；不要直接给“实现 Revision 2”。
2. `M0-01` 到 `M0-06`（含插入的 `M0-05A`–`M0-05F` production 前置）必须串行，因为都迁移 Chat 单 writer。M0 通过后，`M1-01` 与 `M2-01` 才可并行。
3. 实现者只能写任务单 `write allowlist` 中的文件；发现必须改其它业务文件时停下说明原因，先修订任务单。
4. 不得删除、回滚或格式化 allowlist 外的用户改动；工作区脏文件不是实现者的清理目标。
5. 每单完成时必须回报：修改文件、合同映射、运行命令、退出码、未验证风险。没有测试证据不能标完成。
6. 禁止自行补产品行为、放宽协议校验、增加兼容 fallback，或把失败吞成 success。

## 依赖图

```text
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

all -> CHECK-02
```

## Work order 索引

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
| 19 | `CHECK-02-development-check.md` | 独立风险检查与证据，不改产品范围 |

## 分支与提交建议

- 分支：`codex/chg-20260818-agent-command-channel-r2`
- 每个 work order 一个可回滚提交，标题包含 work order ID。
- M0 未通过前 feature flag `projectChatBrokerV2` 默认关闭；M0-GATE 后才允许默认开启。M1/M2 入口分别独立受控。

## 全局停止条件

出现任一情况立即停止，不猜：

- 规格字段/状态在现有 SDK 中无法观察；
- safeStorage、平台协议注册或 Runtime API 与规格前提不符；
- 需要让 Preview 获得 preload/Node；
- 必须允许多个 renderer 写完整 workspace 才能推进；
- 测试要求修改真实用户数据、访问生产网站或使用真实 credential；
- allowlist 外已有改动与本任务重叠，无法安全保留。
