# Round 006 Discussion Topics

## 匿名共识

- receipt 回放、状态查询、NOT_DISPATCHED 后重发、tombstone、generation 隔离与可修订 CANCELLED 已建立安全骨架。
- 剩余共同问题是“不确定状态怎样安全结束”：REPORTED/UNVERIFIABLE、不可查询和 TTL 到期需要 reconciliation 与锁释放契约。
- 首次视角额外要求四类各一例和“系统未核验”显著文案；高频视角要求目标删除/失权与精确基准；恢复视角要求 NOT_DISPATCHED 证明权威性。

## 是否需要讨论回应

- 不需要。三方没有相反立场；均要求更严格的安全结束与可理解性，直接交裁决者按最低有效体验处理。

## 交给裁决的问题

- reconciliation 和锁释放缺口是否仍构成 MUST 硬门禁。
- 停录句柄语义、低证据迟到事件、首屏示例和效率算法应分别定为 P1/P2/P3。
