# Revision 2 Spec Package

> 状态：Decision accepted；规格就绪；业务实现未开始。

## 从这里开始

| 文件 | 回答的问题 |
| --- | --- |
| [`proposal.md`](proposal.md) | 为什么做、确认了哪些产品边界 |
| [`design.md`](design.md) | 用户看到什么、流程和失败恢复怎样 |
| [`technical.md`](technical.md) | Main/renderer/IPC/store/状态机怎样实现 |
| [`protocol-v1.md`](protocol-v1.md) | `agentos://`、HTTPS Ticket 与回执的精确字段 |
| [`acceptance.md`](acceptance.md) | ATDD ID、证据和里程碑门禁 |
| [`work-orders/README.md`](work-orders/README.md) | 怎样把任务逐单交给 Terra |
| [`tasks.md`](tasks.md) | Change 内进度事实 |
| [`evidence.md`](evidence.md) | 决策来源、实现/检查证据 |

## 当前统一事实

- 现在即将开发的是 `M0`：先把现有 Chat 迁成 Main-owned 单一事实源，再提供每项目唯一的独立 Chat 窗口。
- M0 完成后才能开放网站配对/Ticket；Runtime 自动收口可以在 M0 后与网站任务分支并行。
- v1 权限保持当前 app-global 选择，只把权威持久化迁到 Main；没有 project-level permission。
- 网站只会新建普通线程并拿到 accepted/rejected，不会得到任务结果或本地 ID。
- 同项目多 thread 可并行；同一 thread busy 时拒绝第二次提交；v1 不做写入锁或自动合并。
- 静态项目仅在可靠 Agent mutation 期间进入实时预览，成功 settle 后自动 build 一次；失败/取消不保存半成品。

## 给 Terra 的最短提示词

```text
只执行 changes/active/chg-20260818-agent-command-channel/work-orders/<WORK_ORDER>.md。
先完整阅读该任务单要求的 design.md、technical.md、protocol-v1.md、acceptance.md 章节。
严格遵守 write allowlist，不改业务范围，不清理 allowlist 外现有改动。
完成后回报修改文件、合同映射、测试命令/退出码和未验证风险；遇到停止条件立即停工，不自行补设计。
```

不要把整个 Revision 2 一次性交给 Terra。`M0-01`–`M0-06` 必须串行，每一单测试通过后再发下一单。
