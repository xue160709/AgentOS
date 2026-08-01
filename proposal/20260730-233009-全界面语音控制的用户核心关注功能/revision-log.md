# Revision Log


## R001

- 来源：INITIAL_DESIGN；proposal-designer 超时后主会话串行降级
- 修改章节：§0–§12
- 摘要：建立 VoiceSession、CommandRequest 与 ExecutionReceipt 统一状态机，定义任务级能力边界、免手确认澄清、失败恢复和验收追踪。
- Design SHA-256：8a30b5283b33ca9eed67149c5d36ecd2bb4e509c8f89795614351d78fd1578e4


## R002

- 来源：round-001 FINDING-001 至 FINDING-005；targeted designer 超时后主会话串行降级
- 修改章节：§0, §1, §4–§9, §11–§12
- 摘要：补齐 Agent receipt 证据等级、跨重启幂等与取消仲裁、关闭停录握手、首屏能力承诺、全语音能力目录和连续草稿队列。
- Design SHA-256：da17fa289fca9bdebf5a2a5cd86cbffccd6cffe2c583df42238f85bc2846bc54


## R003

- 来源：round-002 FINDING-006 至 FINDING-010；proposal-designer TARGETED_REVISION
- 修改章节：§0, §4, §6–§9, §11–§12
- 摘要：区分 receipt 回放、状态查询与重新 dispatch；新增副作用 tombstone/锁释放表、CAPTURE_STOP_FAILED、可纠正取消结论和确定性端到端脚本。
- Design SHA-256：48885a6dc815a001411c8e27d210c1b77ec45309e9ee176d2c52647fc38825bd


## R004

- 来源：round-003 review-bundle 字符上限；压缩重复表达
- 修改章节：§7–§8
- 摘要：用固定布局描述替代冗长线框，并将终态仲裁表压缩为等价规则，未改变设计语义。
- Design SHA-256：8fc865b22f5fec2c098375327b5adcaad408b9773307292ab0127004f93a737c


## R005

- 来源：round-004 review-bundle 字符上限；压缩重复 IA 树
- 修改章节：§5
- 摘要：将信息架构树压缩为等价职责说明，未改变入口、跨窗口任务条、Chat、设置或能力目录语义。
- Design SHA-256：8438a15e3118498bc21528469178018cdb4e4c4186a3092a037e65c431dcdbf1


## R006

- 来源：round-005 review-bundle 字符上限；压缩重复结论与原则
- 修改章节：§1, §3
- 摘要：压缩重复解释，保留结论、统一对象、范围、非目标与风险语义。
- Design SHA-256：3a277c6f6066e05df4051ed06471ba4bf831e68a57713d2a235ca70016fc10e1


## R007

- 来源：round-006 FINDING-011 至 FINDING-014；targeted designer 超时后主会话串行降级
- 修改章节：§0, §4–§9, §11–§12
- 摘要：补 reconciliation 三结果与 scope 隔离、权威 NOT_DISPATCHED、低证据取消修订、句柄释放不变量、四类首屏示例、漂移与基准算法。
- Design SHA-256：8904d0a445e3508ac535b54869a1eaa7e40519016adbfb5198f59646a919497d


## R008

- 来源：round-007 review-bundle 字符上限；压缩重复对象与交互说明
- 修改章节：§4, §7
- 摘要：移除已由规则和状态表覆盖的重复对象行，压缩等价交互文案，设计语义不变。
- Design SHA-256：7592291455686abc52c44c37aef07e35a9fb0f1c346acae6850aafd698f886c0


## R009

- 来源：round-008 FINDING-015 至 FINDING-017；targeted designer 超时后主会话串行降级
- 修改章节：§0, §4–§9, §11–§12
- 摘要：机器化 EffectScope 重叠与状态迁移，固定 UNKNOWN/tombstone、原子目标校验、五 trial 公式、Agent 续显和首次依据文案。
- Design SHA-256：f702eb8c159b2729c1cdfa1b87c1424bad984352e376e1b0d3fc360f841970ed


## R010

- 来源：round-009-context-limit
- 修改章节：§10,§11,§12
- 摘要：等义压缩方案取舍、影响与追踪表，降低盲评输入包长度；不改变 R009 规则与验收语义
- Design SHA-256：295036163bccf951776d27ff7d026bb87996508b3afb29d1792beb6b3b586c61


## R011

- 来源：round-010-context-limit
- 修改章节：§3,§5,§7
- 摘要：等义合并原则范围、入口职责与页面交互中的重复说明；保留全部路由、证据、恢复和验收规则
- Design SHA-256：c7022033624daf57aae7a8e378b16086e57dcbcc3eda80e3f5b3def52afa80b3


## R012

- 来源：round-011-context-limit
- 修改章节：§1,§5
- 摘要：等义收紧设计快照和信息架构重复措辞，保留首屏承诺、四类示例、依据和能力目录语音路径
- Design SHA-256：a91497e02dde8bfc442bcd4dbd1a749eaf1b1c3532c6000aeb8cae0ddd2b8a55


## R013

- 来源：round-012-context-limit
- 修改章节：§3,§5
- 摘要：标点级等义短写原则与四类首屏示例，不删除任何设计约束
- Design SHA-256：a9136f74b37157a3658fef73ca11289c7b36c215b2e63d76c8c7d7d839c9f3f6


## R014

- 来源：round-013-context-limit
- 修改章节：§5
- 摘要：把信息架构改为更短的等义产品文案，保留首屏承诺、四类示例依据和目录语音浏览
- Design SHA-256：fdd6c23149cec1e34799dd97853e3ff32f90d0f20b4e07e97b9e88c192d1b68c


## R015

- 来源：round-014-context-limit
- 修改章节：§5
- 摘要：将信息架构压为对象职责句，保留四类示例与判定依据
- Design SHA-256：450a40fcbff34aa0b95430b02c0b03afb7258b61f326dfe2b989d1c756702d53


## R016

- 来源：round-015-context-limit
- 修改章节：§5
- 摘要：删除页面章节已覆盖的重复词，不改变对象职责或能力目录路径
- Design SHA-256：04906fb0461bb5d09fd072cb9824cb8849eb48b5e06c2585cc4d1d1b05524c76


## R017

- 来源：feedback-003 + round-016 must-fix; targeted designer timed out, serial fallback
- 修改章节：§0,§1,§3,§4,§5,§7,§8,§9,§10,§12
- 摘要：落实用户选择 A：OS 句柄归零唯一释放、唯一 CommandState、执行端三版本条件提交、保守 scope、手动/不支持分层、UNKNOWN 阻塞解释、严格效率与重启增量验收
- Design SHA-256：9f5f5d508c2901c9e14865b078608ef031678317304da077413b34054d29caea


## R018

- 来源：round-017 must-fix; targeted designer timed out, serial fallback
- 修改章节：§0,§4,§5,§6,§7,§8,§9,§11,§12
- 摘要：新增原子 SubmissionGate、有限时 CLOSED_UNVERIFIED 与签名解锁、连续收音状态、TransferEnvelope、冻结基准、三处一步强停和零鼠标验收
- Design SHA-256：1633a76b00851a0f0aabe5683db9d2c6774371c595057615cdd0be9d20f4401a


## R019

- 来源：round-018 must-fix + targeted designer r19
- 修改章节：§0,§4,§5,§6,§7,§8,§9,§12
- 摘要：取消仅在签名 effectPrevented=true 后成立；8秒只查询、权威 NOT_DISPATCHED 后安全重试；首次默认自动；连续等待与 Envelope 字段保真验收收口
- Design SHA-256：368825f8ec85038414ed2a736bbb41dabe2f3d5a86770409a9690c6ea5fa3c3a


## R020

- 来源：round-019 must-fix; targeted designer timed out, serial fallback
- 修改章节：§0,§4,§6,§7,§9,§12
- 摘要：attemptToken 跨 session 幂等、系统音源隔离与抢话、多请求指代、确定性队列、恢复卡/错误记录、键盘强停和完整对照验收
- Design SHA-256：cb5957e71ffab88329706d5cc0194bdbaee9089cf961e3f3f93e0b8cc6f3eea9


## R021

- 来源：round-020 context limit
- 修改章节：§5,§7
- 摘要：等义压缩首屏、确认卡与恢复卡重复文案，不改变 R020 协议或验收
- Design SHA-256：eb5fe8d610e177672e21dc0665dce78f3421fa1160a30adad678d468ca0be860


## R022

- 来源：round-021 context limit
- 修改章节：§5,§7
- 摘要：等义压缩五类示例、结果卡和录音故障文案，协议与验收不变
- Design SHA-256：28b5761c579805e4a05d805565195e15921ac99775226b806f9753f3bf3e0d07


## R023

- 来源：round-022 context limit
- 修改章节：§5,§7
- 摘要：删除对象和状态章节已覆盖的页面重复词，R020 设计语义不变
- Design SHA-256：eb6e53052985fc6e64c6a55cfc74e391014f2720f9d94fb4fa30f3bad7cc84f1


## R024

- 来源：round-023 must-fix + targeted designer r24 + user E1 A
- 修改章节：§0,§4,§5,§6,§7,§9,§12
- 摘要：拆分停录与取消并定义裸停止仲裁；建立用户术语层和唯一主动作；明确权限/Helper修复及FAILED_VERIFIED的attempt继承；冻结含DIRECT/DELEGATED的合成基准与维护口令约束。
- Design SHA-256：f22c7196d5b060be88fdab35f0eb59554893a79d224d0d8b7046576424ade268


## R025

- 来源：round-024 must-fix; targeted designer r25 timeout; main-session fallback
- 修改章节：§0,§4,§5,§6,§7,§8,§9,§12
- 摘要：加入当前页面三条建议与五类用户语言；系统等待时权威停麦并暂停连续倒计时；补齐 Envelope 差异修复、request/attempt 分界、取消自动复核时点，并登记缺失的 RECOVERING 状态。
- Design SHA-256：9bdf0ed97da1b1241e11fc015504e3094fec522d1341285cf4c49408cd353254


## R026

- 来源：R025 semantic-preserving review-bundle compression
- 修改章节：§4,§8,§9
- 摘要：压缩 Envelope、连续暂停与验收表述，不改变 R025 语义。
- Design SHA-256：4b50f7eda960ad400997a9f80ff911bab2272926a723c3932db96de4e63543d4


## R027

- 来源：round-025 must-fix; targeted designer r27 timeout; main-session fallback
- 修改章节：§0,§4,§5,§6,§7,§8,§9,§12
- 摘要：把强停定义为 PID 终止、OS 句柄复核与权限撤销兜底；消除封存文案误导；首次建议非阻塞播报并支持抢话；同步压缩验收文本。
- Design SHA-256：40ac35e6b499c10353e41eed4fe613a9943fbd6b6278161e8346af0541ea5e5b
