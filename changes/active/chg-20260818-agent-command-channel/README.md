# Revision 2 Spec Package

> 状态：Decision accepted；规格冻结；**M0–M2 与 M3-01 业务实现均已落盘并默认开启**；剩余 `FIX-WS-01`、`FIX-CHAT-01` 两张缺陷单与 `CHECK-02` 未完成。
>
> 2026-08-29 由 `BUG-AUDIT-WS-02` 修正：本文此前长期写着"业务实现未开始"，与代码严重不符，已按事实更新。

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

- Chat 已是 Main-owned 单一事实源，每项目唯一独立 Chat 窗口已上线；feature flag `AGENTOS_PROJECT_CHAT_BROKER_V2` **默认开启**，`0` 只是回滚逃生口。
- 网站配对/Ticket、Preview 窄捕获、Runtime edit 收口（M1 / M1a / M2）均已实现。
- v1 权限保持当前 app-global 选择，只把权威持久化迁到 Main；没有 project-level permission。
- 网站只会新建普通线程并拿到 accepted/rejected，不会得到任务结果或本地 ID。
- 同项目多 thread 可并行；同一 thread busy 时拒绝第二次提交；v1 不做写入锁或自动合并。
- 静态项目仅在可靠 Agent mutation 期间进入实时预览，成功 settle 后自动 build 一次；失败/取消不保存半成品。

## 未完成的事实（阻塞 M0 Gate 与 `CHECK-02`）

`M0-05` 的 renderer cutover 是一次**半迁移**：thread 事实迁给了 Main，同时关闭了 renderer 唯一的 durable writer，但 project / sidebar / view 事实仍留在 renderer。由此产生的全部缺陷都是同一个根因，不是独立 bug：

| 单 | 覆盖 |
| --- | --- |
| `FIX-WS-01` | P0 新建项目不落盘且不可用；P0 项目移除/重定位/置顶/排序不落盘（含路径丢失恢复流程）；P1 侧栏与首页偏好不落盘；关闭 ownership audit |
| `FIX-CHAT-01` | P0 侧边栏归档/置顶不落盘并被 snapshot 回滚；P0 归档运行中会话的文案/实现/broker 合同三方不一致；P1 readiness 三态 |

顺序固定为 `FIX-WS-01 -> FIX-CHAT-01 -> CHECK-02`。

## 已识别的过度设计与处置

复核结论与处置见 [`proposal.md`](proposal.md) 的「Revision 2 范围复核（2026-08-29）」。摘要：M1 网站入口整条链目前没有真实第三方消费者，建议后续拆分（**待用户决策，本轮不执行**）；接口五层手工镜像与 work order 流程失效已记录为改进项；`RuntimeEditCoordinator`、单窗口 capability 校验、broker 串行队列判定为**不过度、不砍**。

## 给 Terra 的最短提示词

```text
只执行 changes/active/chg-20260818-agent-command-channel/work-orders/<WORK_ORDER>.md。
先完整阅读该任务单要求的 design.md、technical.md、protocol-v1.md、acceptance.md 章节。
严格遵守 write allowlist，不改业务范围，不清理 allowlist 外现有改动。
完成后回报修改文件、合同映射、测试命令/退出码和未验证风险；遇到停止条件立即停工，不自行补设计。
```

不要把整个 Revision 2 一次性交给 Terra。剩余两单 `FIX-WS-01` 与 `FIX-CHAT-01` 必须串行，前者通过后再发后者。
