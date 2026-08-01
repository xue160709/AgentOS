# Proposal Design：全界面语音控制的用户核心关注功能

## 0. 文档状态
- Proposal ID：20260730-233009-全界面语音控制的用户核心关注功能
- 当前修订：R027
- 当前状态：DESIGNING
- 当前评分：R026 92/100（REVISE）；本修订待评分
- 对应反馈：E1 `feedback/feedback-001.md`、`feedback/feedback-003.md`；E2 `feedback/feedback-002.md`；E4 `user-001/002/003`
- 最后更新：2026-07-31T07:25:48+08:00
- 未确认信息：真实目标用户、高频任务、语音准确率、30 类 Agent 转交任务完成率与 macOS 实机生命周期仍待验证
- 产出说明：R027 定向 designer 连续两个窗口超时，主会话按 FINDING-044～046 串行降级

## 1. 设计结论快照
- 问题：用户要从发令到真实结果的可信闭环；现状混用语义覆盖、路由成功与任务完成，且录音、请求、决策、结果缺统一生命周期。
- 方案：以 `VoiceSession + CommandRequest + Ledger/Tombstone + ExecutionReceipt` 统一路由、幂等和证据；采用用户确认的安全优先边界，任何关键事实无法原子核验时停止执行并说明原因。
- 明确不做：任意 DOM 点击、绕过系统授权、常驻唤醒词，以及把语义/转发冒充完成。
- 最大风险：无法核验外部后置状态的 Agent 任务只能显示“系统未核验/需要核对”，不计入已验证闭环率。

## 2. 用户需求契约
- MUST：NEED-001 真实完成与可信覆盖；NEED-002 理解可纠正且不重复；NEED-003 录音状态与归属可控；NEED-004 失败可恢复；NEED-005 核心旅程免手闭环。
- SHOULD：NEED-006 连续任务效率；NEED-007 能力可发现且无需背命令。
- 优先规则：MUST 的可信度和可恢复性优先于扩大命令数量；任何新 action 先补后置条件和失败语义，再进入能力目录。

## 3. 方案原则与范围
- 原则：可验证任务优先于覆盖数；请求单一真相；收音/执行分离；决策可语音完成，手动与不支持边界如实显示。
- E1 Guardrail：录音句柄、目标/权限、scope 隔离或结果任一无法由权威源原子核验，就不释放、不执行、不重发、不宣告完成；接受能力覆盖缩小。
- 能力须登记目标、前置、执行者、后置条件；命令窗、主窗、Chat 共用 request ID。不含环境常听、任意 shell/DOM、无后置条件 action。

## 4. 产品对象与业务规则
| 对象 | 关键字段 | 生命周期/不变量 |
| --- | --- | --- |
| `VoiceSession` | session/generation、owner、captureHelperPid、osHandleCount、focusedRequestId、continuousConsent、silenceDeadline/pauseReason | 唯一 Helper 持麦；进程退出且句柄归零才释放；系统暂停不占麦，恢复须连续授权+可见提示 |
| `UtteranceDraft/Queue` | 编辑稿、attemptToken、confirmationEpoch、draftHash、blockedBy | final 时持久化跨 session token；队列按序扫描，跳过锁定项继续找可执行项 |
| `CapabilityEntry` | goal、route、boundaryKind、pre/postconditions、risk | route 四类；`MANUAL_OR_UNSUPPORTED` 必须再标 `MANUAL_REQUIRED` 或 `UNSUPPORTED` 及理由 |
| `CommandRequest/Ledger` | request/key、state、sequence、deadline、attempt | `state` 只取 §8 唯一枚举；重试/重启复用身份，状态与 receipt 先持久化 |
| `SubmissionGate` | attemptToken、confirmationEpoch、draftHash、winningRequestId | 主进程唯一约束+CAS；窗口/进程重建仍复用 winning request |
| `EffectScope/DispatchProof` | roots、effectClass、targetVersion、permissionVersion、scopeVersion、authority | 执行端条件提交时校验三个版本；任一缺失、陈旧或无法证明隔离即拒绝 |
| `TransferEnvelope` | request/key、goal、target、constraints、contextSnapshot、risk、deadline | Agent 深相等校验；缺失/变化先拒绝，保留原目标，仅修补差异 |
| `Receipt/Reconciliation` | outcome、evidence、postcondition、effectPrevented、authority、signature、sequence | 仅签名且 `effectPrevented=true` 可证明取消；REPORTED/UNVERIFIABLE 不算成功 |
| `SideEffectTombstone` | request/key、effectHash、outcome、dedupeUntil | UNKNOWN 在权威 reconciliation 前永不 GC，禁止自动重发 |

业务规则：
1. 快捷键进入 `LISTENING` 或 `PERMISSION_BLOCKED`。系统播报带 playback provenance 并作为 echo reference；真人抢话先停播报，再接收 MIC_CAPTURE。系统音频或来源不确定的帧不得入稿。
2. 隐藏/关闭发 `STOP_CAPTURE`；300ms 未同时得到 ACK 与句柄归零，主进程按稳定 PID 终止唯一 Capture Helper，禁止重建；700ms 后仍存活则强制终止。仅“PID 已退出且 OS 句柄=0”可显示已停并释放。到1s仍非零/不可查即 `CAPTURE_STOP_FAILED`，保留 owner sentinel、禁新录音；唯一主动作“退出 AgentOS 并打开 macOS 麦克风设置”，提示手动撤销权限，完成前绝不称已停。
3. idempotencyKey=`hash(logicalAttemptId+intent+stableTarget+effectArgs)`；“再执行一次”才新建 attempt。
4. 所有入口以 `attemptToken+confirmationEpoch+draftHash` CAS 后创建 request；输家返回 winningRequestId。Ledger/Gate 恢复前禁提交。权限或 Helper 修复保留原稿/token/epoch 并回 `REVIEW_READY`；不创建 request。`FAILED_VERIFIED` 的旧 request 保持终态，仅复制可编辑稿；用户修改并重确认才建新 attempt。
5. 执行端在落副作用的同一原子提交中比较 target/permission/scopeVersion；不一致返回 `PRECONDITION_CHANGED`、effect=0、结束原 request 并回草稿重确认。
6. scope roots 为 `{stableId, coverage:EXACT|SUBTREE, ancestorIds, hierarchyVersion}`。GLOBAL 总重叠；同 root 重叠；SUBTREE 覆盖另一 root 时重叠。仅权威同版本的两个 EXACT 可证明不重叠；其余缺失、陈旧、冲突均提升为 GLOBAL。
7. DIRECT 仅 VERIFIED 后称完成；DELEGATED 用 Envelope；ANSWER 写入 Chat 后完成。Envelope 签名拒绝且证明 `NOT_DISPATCHED/effect=0`：同一 request 保留目标，只补非 effect 差异并确认，不建 attempt，acceptedDispatch/effect≤1。target/intent/effectArgs/risk 变化则旧 request 以 effect=0 终结，复制稿，修改重确认后建新 attempt；未证明未派发则锁定只查询。
8. 指代只接受唯一 focusedRequest、序号、名称或唯一“上一条”，否则澄清且 effect=0。“停止录音”只停收音，“取消第N个任务”只请求取消；裸“停止”仅一候选时绑定，零候选不动作，多候选列“录音/任务名”澄清，期间 capture/effect 不变。紧急键只停录音。
9. 8 秒无 ACK 为 DELIVERY_FAILED，只查询原 request；deadline 后为 TIMED_OUT；`reconcileBy=deadline+60s`。到期 UNKNOWN 转 `CLOSED_UNVERIFIED`，保留 tombstone/scope，仅允许权威重查、导出诊断或签名人工核验。
10. 恢复先回放 Ledger/Gate/receipt，再开放提交并查询原 request；`NOT_DISPATCHED` 前不重发。新鲜原子 `NOT_DISPATCHED` 后才可原 request/key 安全重试一次；request 创建即锁 scope。
11. 低风险先复述并可撤销；中风险确认；不可撤销破坏动作双确认或排除。

## 5. 信息架构
- 首次默认自动，命令/聊天仅在高级设置；命令窗、主窗、Chat 共享 receipt。
- 首屏承诺五类处理且仅核验后说完成；依据当前页与已登记能力给至多3条建议，不足则少显示。首次 Option+Space 同步突出并短播报建议，播放有 provenance、真人可抢话，不增点击；首次成功后静默展示。目录可语音浏览。
- 主界面只说任务、目标、处理方式、风险、结果、下一步；request/scope/effectHash/authority/sequence 等仅在“技术详情/导出”出现。

## 6. 用户旅程
| 步骤 | 用户目标 | 用户动作 | 系统反馈 | 状态变化 | 退出/恢复 |
| --- | --- | --- | --- | --- | --- |
| 1 | 开始说话 | 按 Option+Space | 首次先突出/短播报当前页建议，提示音+红色录音标；真人开口即停播报，缺权限显示系统步骤 | IDLE→LISTENING 或 PERMISSION_BLOCKED | 说“停止录音”或再次按快捷键 |
| 2 | 确认听对 | 自然说任务，停顿或说“就这样” | 实时文本；结束后显示“我理解为…”、目标、路由和风险 | LISTENING→REVIEW_READY | 口头修正、键盘编辑或取消 |
| 3 | 提交任务 | 说“执行”或按提交 | 生成 requestId，显示已接收而非已完成 | REVIEW_READY→DELIVERING | 8 秒无 ACK 仅查询并显示“不会重新执行”；权威 NOT_DISPATCHED 后才可安全重试 |
| 4 | 处理分支 | 说“确认/取消第2个任务” | 取消请求显示“任务仍可能执行”；裸“停止”多候选时先问“停录音还是取消某任务” | NEEDS_DECISION→RUNNING/CANCEL_REQUESTED | 澄清前不动作；签名 effectPrevented=true 后才显示已取消 |
| 5 | 连续准备 | 一次唤起后说“连续输入”；任务间说“下一条” | 可听时红色录音标常显；Agent 等待/队列背压/系统播报时停麦并显示“系统处理中，未录音” | CONTINUOUS_LISTENING↔CONTINUOUS_PAUSED_SYSTEM | 可听时静默30秒；系统暂停不耗时，恢复时提示音+红标并重置；用户仍可等待/继续/停止 |
| 6 | 确认真实结果 | 可关闭命令窗或看任务条 | 主窗与 Chat 续显同一 requestId/sequence；VERIFIED/REPORTED/需核对分开显示 | RUNNING→证据结论/NEEDS_USER_CHECK | 继续等待或请求取消 |
| 7 | 安全续行/恢复 | 语音查阻塞、跳过或重排；重开应用 | 队列逐项标阻塞，非重叠继续；先回放 Gate/Ledger/receipt 再开放提交 | QUEUED_DRAFT/RECOVERING→可执行项或封存 | UNKNOWN 不重发；签名核验后解锁 |

## 7. 页面与交互设计
- 命令窗依次显示录音/隐私、上下文/承诺、原识别/编辑稿、当前任务、5条草稿、上一结果；写操作不自动执行。
- 确认卡只列动作、目标、处理方式、依据、影响；处理方式固定为“直接做/交给 Agent/只回答/需手动/做不了”，`Capability/route` 仅技术详情。指代多解列任务并澄清。
- 结果区分已接收/执行中/请求停止/已取消/已转交/已验证/系统未核验/需核对/失败/超时；REPORTED 不进 SUCCEEDED。
- 恢复卡先用用户语言列对象、期望结果、可见证据和安全下一步；技术详情再列 target/scope、诊断与资格，跨状态/重启不覆盖。
- `CAPTURE_STOP_FAILED` 三处显示“麦克风可能仍在使用”；主动作“退出 AgentOS 并打开麦克风设置”，诊断次级；禁新录音。录音中关窗停录留稿，执行中只收起。
- 命令窗、主窗、托盘及 `Option+Shift+Esc` 一步触发 §4 强停升级链且不取消业务；PID 退出+句柄归零才消警，草稿保留。
- 每态一个主动作：超时/取消中“查看原任务进度”（并显示自动复核至何时）、未知“核对可见结果”、封存“请求权威核验”、Envelope 差异“确认这些变化”、权限/Helper 修复“继续原稿”、失败“修改后重试”；其余进更多菜单。
- 拒绝卡各给一个支持替代和手动例；核对卡列对象、期望、证据、安全下一步；取消摘要只说“已取消/仍可能执行”，技术详情列 target/effectHash/authority/sequence/time。
- 漂移卡并列新旧上下文、目标、风险；目录项可朗读路由、证据、限制。

## 8. 状态与异常矩阵
`VoiceUIState` 只取 `IDLE / PERMISSION_BLOCKED / LISTENING / CONTINUOUS_LISTENING / CONTINUOUS_PAUSED_SYSTEM / CAPTURE_STOPPING / CAPTURE_STOP_FAILED / REVIEW_READY / NEEDS_DECISION / QUEUED_DRAFT / RECOVERING`。连续态静默30秒；Agent 等待/队列背压/播报先停麦，句柄归零才停计时并显示“未录音”。`INPUT_READY` 且授权有效时提示+红标启动新 generation，否则 IDLE。`CommandState` 只取 `PREPARED / DELIVERING / DELIVERY_FAILED / RUNNING_DIRECT / RUNNING_DELEGATED / TIMED_OUT / CANCEL_REQUESTED / NEEDS_USER_CHECK / CLOSED_UNVERIFIED / TERMINAL_NOT_EXECUTED / SUCCEEDED_VERIFIED / FAILED_VERIFIED`。

| 当前状态 + 权威事件 | 唯一新状态 | 锁/可见结论 |
| --- | --- | --- |
| 任意收音态 + 停止 | CAPTURE_STOPPING | 执行 §4 升级链；保留稿 |
| CAPTURE_STOPPING + PID退出且句柄=0 | REVIEW_READY/IDLE（按有无稿） | 显示已停止；释放 owner |
| CAPTURE_STOPPING + 1s仍非零/不可查 | CAPTURE_STOP_FAILED | 显示可能仍在使用；禁新录音 |
| 创建 request | PREPARED | scope 锁定，尚未执行 |
| PREPARED + 版本条件提交通过 | DELIVERING→RUNNING_* | 锁保持；ACK 只表示接收 |
| PREPARED/DELIVERY_FAILED + 新鲜原子 NOT_DISPATCHED | DELIVERING（原 request 最多一次） | 显示“安全重试”；锁保持 |
| DELIVERING + 签名 ENVELOPE_REJECTED/NOT_DISPATCHED | DELIVERY_FAILED | effect=0；保留原目标，仅允许确认差异后续接 |
| 任意未验证态 + PRECONDITION_CHANGED | TERMINAL_NOT_EXECUTED | effect=0、释放，回草稿重确认 |
| DELIVERING + 8 秒无 ACK | DELIVERY_FAILED | 仅查询；显示“正在查询原请求，不会重新执行” |
| RUNNING_* + deadline | TIMED_OUT | 锁保持，不宣告失败 |
| 任意未验证态 + 用户取消 | CANCEL_REQUESTED | 锁保持 |
| CANCEL_REQUESTED + 签名 receipt(effectPrevented=true) | TERMINAL_NOT_EXECUTED | effect=0；显示“已取消”，释放 |
| CANCEL_REQUESTED + effectPrevented=false/unknown、无签名或不可查询 | NEEDS_USER_CHECK | 显示“仍可能执行”；锁/tombstone 保持 |
| 任意未验证态 + NOT_EXECUTED | TERMINAL_NOT_EXECUTED | 禁重发，释放 |
| 任意未验证态 + UNKNOWN/不可查询/TTL | NEEDS_USER_CHECK | tombstone 不 GC，锁保持 |
| 任意未验证态 + REPORTED/UNVERIFIABLE | NEEDS_USER_CHECK | 系统未核验，锁保持 |
| NEEDS_USER_CHECK + reconcileBy 到期 | CLOSED_UNVERIFIED | “已停止自动重试；原任务结果仍未知，可能已经执行”；锁/tombstone 保持 |
| CLOSED_UNVERIFIED + 签名 NOT_EXECUTED | TERMINAL_NOT_EXECUTED | 追加 revision 后释放 |
| CLOSED_UNVERIFIED + 签名 EXECUTED + verified receipt | SUCCEEDED_VERIFIED/FAILED_VERIFIED | 追加 revision 后释放 |
| 任意状态 + VERIFIED(success/failure) | SUCCEEDED_VERIFIED/FAILED_VERIFIED | 最高证据；释放；若纠正旧结论则追加 revision |
| 已验证/NOT_EXECUTED + 后到 cancel、低证据或 UNKNOWN | 原状态不变 | 只追加诊断，不降级、不重锁 |

上述表覆盖 VERIFIED→cancel、cancel→effectPrevented=true/false/unknown；取消请求或回执不得覆盖已验证终态。低 sequence、旧 generation 只诊断；未列事件拒绝迁移并告警。

## 9. 用户体验质量下界
- 可用性：不抢主窗焦点；Tab 覆盖草稿/决策/恢复，Escape 不绕停录；文字+图标+`aria-live`，语音/键鼠等价；480×372 可滚动。locale 独立可选，文案全 i18n。
- 隐私/性能：无录音不占麦、不默认存音频，历史可清除且敏感字段不入；录音反馈≤300ms、partial≤500ms、direct ACK≤1s；停录执行 §4，未权威归零绝不释放。
- 合成效率：真实样本前报告均标“合成基准”。冻结同五任务/顺序/后置条件，含 DIRECT+DELEGATED；语音/鼠标同热身、交叉顺序；每项≤60s，5 trials须25/25、重复=0，中位总时长低于鼠标。
- 工作负载：冻结 action fixture ID/hash，含跨上下文、开对象、建草稿、改设置、中风险写入；无可验证 action 即失败。语音一次唤起、零鼠标/Agent 重述；维护口令另计，非主动暂停的系统诱发口令须0。
- 首次理解：固定五类例与当前页建议；5人至少4人在首次发声前理解一条建议、预测处理方式，并完成“识别—纠正—提交—终态—恢复”，路径/理由≥80%。
- 故障/锁/证据：三崩溃点 effect仅0/1，未知不重发；注入 STOP_CAPTURE 无响应、普通/强制终止失败、PID退出但句柄非零/不可查：仅 PID退出+句柄0显示已停，否则权限兜底且新录音=0。覆盖 cancel↔VERIFIED、NOT_EXECUTED/UNKNOWN。
- Scope/续显：覆盖 EXACT/SUBTREE/GLOBAL、版本缺失/陈旧及预检后改名/删除/失权，失败 effect=0；sequence=2 重启后注入3、乱序1、终态 receipt，原 request 更新不倒退，dispatch=1。
- 并发/转交：四入口同稿 request/acceptedDispatch/effect=1；Envelope 深相等；非 effect 差异只补差异，同 request、acceptedDispatch/effect=1、重述=0；effect 差异则旧 request effect=0、新 attempt 重确认；无 NOT_DISPATCHED 证明时发送=0。
- 连续暂停：注入 Agent 等待/队列背压/播报；先句柄归零再显示未录音、停计时，INPUT_READY 后提示+红标才收音；系统诱发维护口令=0，播放零入稿。
- 音源/仲裁/恢复：系统播报+真人抢话25次，播放零入稿；三 request 测序号/名称/上一条/“它”。另测裸“停止”候选为0/1/多项：仅1项绑定，多项澄清，停录/任务 effect=0；紧急键只停录。权限/Helper 修复保留 token/epoch/稿且不建 request；FAILED_VERIFIED 须修改重确认后新 attempt；跨窗/崩溃均无重复。

## 10. 方案取舍
采用 E1 确认的安全优先：无法原子核验就缩小覆盖、阻止执行或保持锁。代价是部分 Agent/跨应用任务更常进入手动、需核对或不支持；不以免手率换取隐形录音、错对象或重复副作用。

## 11. 影响与未知
- 影响模块：`voice-main.tsx`/`voice-state.ts`（统一状态机）、`electron/main.ts`（请求注册与窗口交接）、`speech-recognition.ts`（session owner 与严格路由）、`AgentOsMultimodal.tsx`（receipt/decision）、Chat 提交链（Agent 进度与终态）。
- 新增 SubmissionGate、TransferEnvelope、共享 receipt 与持久化 Ledger；恢复层含 reconciliation、scope 判定和 OS 句柄探针，未知或不可核验时保持锁并暴露诊断。
- 迁移：现有 21 个 action 逐个补 `postconditionProbe`、`evidenceLevel`、`cancellation`、`deadline`；未补齐前标“实验性/需核对”，不得算入已验证闭环率。
- 指标分开报告：语义发现率、直接闭环率、Agent 任务闭环率、人工边界率、取消成功率、重复副作用率。
- 未知与验证：真实用户首要任务、安静/嘈杂环境识别、两种语言控制语句、30 类 Agent 任务的 query/probe/cancel/去重期限、macOS 句柄探测、权限返回后的自动续接与多窗口实机时序。
- 证据策略：先按 §9 固定 fixture 验证 5 个 direct，再验证 2 个中风险确认和 3 个 delegated（分别覆盖 VERIFIED、REPORTED、UNVERIFIABLE）；未取得真实用户任务排序前不扩大量 action。

## 12. 需求—设计—验收追踪
| Need ID | 设计章节 | 用户评审结论 | 验收场景 | 状态 |
| --- | --- | --- | --- | --- |
| NEED-001 | §3, §4, §6-§9 | R024：上下文能力提示待补，已补 | 当前页建议；卡片五类用户语言 | 待新轮盲评 |
| NEED-002 | §4, §6, §8, §9 | R024 通过 | token 跨重启；播放零入稿；歧义 effect=0 | 待新轮盲评 |
| NEED-003 | §3, §4, §7-§9 | R026：强停升级链待补，已补 | PID终止+句柄复核；权限撤销兜底 | 待新轮盲评 |
| NEED-004 | §3, §4, §6-§9 | R026：封存文案待补，已补 | 明示停止重试但任务可能已执行 | 待新轮盲评 |
| NEED-005 | §3-§9 | R024 通过 | 低/中风险零鼠标；系统手动边界 | 待新轮盲评 |
| NEED-006 | §3, §4, §6-§9 | R024：静默窗待补，已补 | 系统等待停麦暂停；维护口令=0 | 待新轮盲评 |
| NEED-007 | §5, §7, §9 | R026：首次注意顺序待补，已补 | 非阻塞播报/抢话；4/5发声前理解 | 待新轮盲评 |
