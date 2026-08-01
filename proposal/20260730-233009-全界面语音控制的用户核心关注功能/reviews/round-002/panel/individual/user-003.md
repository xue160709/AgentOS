# Participant Blind Review

- ID：user-003（E4 SIMULATED）
- Revision：R002
- Hash：da17fa289fca9bdebf5a2a5cd86cbffccd6cffe2c583df42238f85bc2846bc54

## Need verdict

- NEED-001、NEED-005：通过。
- NEED-002、NEED-003、NEED-004：有条件通过；崩溃窗口和去重过期仍可能造成重复副作用。

## Score

| 维度 | 得分 |
| --- | ---: |
| Core need and pain resolution | 26/30 |
| Journey effectiveness and efficiency | 16/18 |
| Understanding, expectation and feedback | 10/12 |
| Control, recovery and trust | 10/12 |
| Accessibility and context fit | 7/8 |
| Total | 69/80 |

## Findings

1. NEED-002/004；§4；写操作生效但 receipt 落盘前崩溃，重启回放可能重复副作用；-4。恢复先查询执行端；不可查询时 NEEDS_USER_CHECK，禁止自动重发；补三种崩溃点验收。
2. NEED-002/004；§4；ledger TTL 到期后重试旧请求；-3。receipt 可过期，但副作用 tombstone 与执行端去重期限一致；过期未知不得自动 dispatch。
3. NEED-003；§4/§9；STOP_CAPTURE 无 ACK、Helper 重建仍失败；-2。进入 CAPTURE_STOP_FAILED，阻止新 owner、持续告警并提供强制终止；验收 OS 采集句柄、三处指标与旧事件。
4. NEED-004；§8；CANCELLED 后到 VERIFIED 改终态，与“唯一终态”措辞冲突；-2。把 CANCELLED 定义为可被更高证据纠正的结论并保留修订记录，验收两种到达顺序及重启仲裁。

## Discussion topics

- “重启回放”必须拆成 receipt 回放、状态查询和重新 dispatch 三个术语；未知状态安全默认不重发。

本评审仅依据指定只读 bundle。
