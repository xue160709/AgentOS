# Round 016 Discussion Topics

## 匿名共识

- Agent 的 VERIFIED / REPORTED / UNVERIFIABLE 分层、UNKNOWN 不重发和停录失败的保守方向得到认可。
- 共同根因仍是“协议约束没有完全落成唯一机器状态”：停录 ACK 与 OS 句柄、target/permission 版本、EffectScope 祖先信息、取消与 reconciliation 的全排列仍可能产生两种解释。
- 首次用户还需要非技术阻塞原因和“不支持”示例；高频用户要求统一计时边界与重启后的增量续显。

## 是否需要讨论回应

- 不需要。三方没有价值立场冲突；应采用最保守的安全语义，并把机器状态映射成人能理解的反馈。

## 交给裁决的问题

- “及时 ACK 但句柄非零”和状态枚举冲突是否构成 P1。
- target/permission 提交竞态与陈旧 EffectScope 是否应合并为同一 P1。
- 首屏不支持示例、未知阻塞解释、效率严格快于鼠标、重启后增量续显分别应定为 P2 还是 P3。
