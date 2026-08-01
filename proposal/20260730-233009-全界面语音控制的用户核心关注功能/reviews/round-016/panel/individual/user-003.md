# Participant Blind Review

- ID：user-003
- Revision：R016
- SHA-256：04906fb0461bb5d09fd072cb9824cb8849eb48b5e06c2585cc4d1d1b05524c76
- Score：71/80（30/30、14/18、9/12、10/12、8/8）

五维：核心 Need 闭环 30/30；失败恢复 14/18；状态一致性 9/12；可验收性 10/12；可感知与边界 8/8。

## Findings

- P1｜Need：NEED-003；section：§4.3、§8、§9；scenario：Helper 在300ms内回 ACK，但 OS 采集句柄仍非零；impact：§4允许释放 owner，而§8/§9要求句柄归零才释放，可能出现隐藏后仍收音并产生新 owner；deduction：-4；可执行验收：注入“及时 ACK+句柄非零”，断言 owner 不释放、新 owner=0、三处持续告警；仅句柄归零后 generation+1 并恢复。
- P1｜Need：NEED-004；section：§8；scenario：恢复或仲裁进入 PREPARED、DELIVERY_FAILED、TERMINAL_NOT_EXECUTED、VERIFIED；impact：这些状态未全部进入主状态表，且 VERIFIED 与既有 SUCCEEDED 命名冲突，我无法确信重启前后会显示同一唯一状态；deduction：-3；可执行验收：给出唯一状态枚举，对每个事件执行全迁移覆盖；禁止未定义状态，持久化并重启后状态、锁与可执行动作完全一致。
- P2｜Need：NEED-004；section：§4.9、§8、§9；scenario：VERIFIED 先于 cancellationReceipt，或取消后再到 NOT_EXECUTED/UNKNOWN；impact：优先级原则存在，但矩阵只明确 CANCELLED 后到 VERIFIED/低证据，反向顺序及 reconciliation 组合缺少显式迁移，可能错误降级结论或释放锁；deduction：-2；可执行验收：逐一执行 cancel→VERIFIED、VERIFIED→cancel、cancel→NOT_EXECUTED、cancel→UNKNOWN 并重启，明确断言最终状态、revision、锁和副作用计数。
- 无扣分｜Need：NEED-004；section：§4.8、§7、§8、§9；scenario：UNKNOWN 经 TTL 到期、隔离队列和多次重启；impact：设计明确 tombstone 不 GC、不自动重发、重叠 scope 持锁，仅放行不重叠任务，符合我的恢复底线；deduction：0；可执行验收：跨多次 TTL/重启验证 tombstone 始终命中、dispatch count 不增加、重叠项不出队。

声明：这是 E4 模拟评审。
