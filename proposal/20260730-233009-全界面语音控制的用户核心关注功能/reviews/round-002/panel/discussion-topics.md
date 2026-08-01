# Round 002 Discussion Topics

## 匿名共识

- 三方认可四类能力承诺、证据分级、免手决策和 generation 隔离方向。
- 三方共同发现 dispatch/receipt 之间崩溃时不能把“回放”理解为重新执行；未知状态必须安全地不重发。
- 高频与恢复视角共同要求副作用锁覆盖所有非权威终态，不能因 timeout 或 cancel requested 提前出队。

## 是否需要讨论回应

- 不需要。没有影响结论的相反立场；差异只在恢复视角对跨重启、TTL 和 Helper 二次失败采用更严格下界，应直接由裁决者按最低有效体验处理。

## 交给独立裁决的问题

- 把 receipt 回放、状态查询和重新 dispatch 混称“回放”是否构成 MUST 硬门禁。
- TTL 到期后的 tombstone、不可查询 Agent、CAPTURE_STOP_FAILED 与副作用锁释放分别需要何种严重度。
- R002 是否应继续修订协议边界，还是已有关键证据不足需要 BLOCKED_BY_EVIDENCE。
