# Participant Review Bundle

- Participant ID: user-003
- Design revision: R024
- Design SHA-256: f22c7196d5b060be88fdab35f0eb59554893a79d224d0d8b7046576424ade268
- Allowed Need IDs: NEED-002, NEED-003, NEED-004, NEED-005
- Allowed design sections: 1, 3, 4, 6, 7, 8, 9
- Section source: tracking-table

## Fixed profile

# Participant Profile

- Participant ID: user-003
- Evidence level: E4 SIMULATED
- Lens: 中断与失败恢复：关注误识别、权限、重复执行、取消和录音可见性
- Product goal: 可靠地用语音控制界面，不因故障失去控制
- Trigger and context: 误识别、权限、网络/Provider 或跨窗口中断
- Entry point: 快捷键或托盘进入录音与执行流程
- Existing knowledge: 只依据当前反馈判断系统状态
- Constraints: 需要失败可恢复、取消生效、不重复执行、录音状态明确
- Success definition: 能看见当前状态，安全退出，并从失败点继续
- Most sensitive pain points: 错误被覆盖、迟到事件回落、隐藏后仍录音、重复提交
- Relevant NEED candidates: 可感知状态、可撤回、幂等执行、跨窗一致恢复
- Out-of-scope assumptions: 不推断人口学、辅助能力、真实发生率或长期承诺

## Latest own feedback

# Feedback

- Participant ID: user-003
- Evidence level: E4 SIMULATED
- Created at: 2026-07-30T23:34:50+08:00

## Content

# Participant Feedback

- Participant ID: user-003
- Mode: INITIAL_FEEDBACK
- Evidence level: E4 SIMULATED；项目现状引用为 E2 PROJECT_FACT

## Journey

| Stage | Goal | Seen/understood | Action | Possible thought | Friction | Consequence |
| --- | --- | --- | --- | --- | --- | --- |
| 入口 | 确认录音 | 快捷键/托盘开窗（E2） | 先辨状态 | “隐藏时别继续录音”（E4） | 隐藏不停止录音 | 失去控制感 |
| 误识别 | 修正再交付 | 可编辑 final（E2） | 改错后提交 | “错误要留着”（E4） | 错误可能被 idle 覆盖 | 无法复盘 |
| 权限/Helper 失败 | 从失败点续 | 仍待实机验收（E2） | 修复后重试 | “失败别伪装成空闲”（E4） | 状态被覆盖 | 不知能否重试 |
| 超时/取消 | 安全停止 | 可久停执行中、可重复提交（E2） | 取消且不重发 | “取消必须真停”（E4） | 防重与取消不明 | 重复副作用 |
| 关闭/重开 | 隔离旧任务 | 旧窗未 cancel、迟到事件风险（E2） | 核对任务归属 | “旧结果别闯进新窗”（E4） | 跨窗恢复不可信 | 错绑上下文 |
| 结果 | 确认真完成 | 路由审计不证明完成（E2） | 核对动作结果 | “已路由不等于已办完”（E4） | 外部副作用未验 | 不敢信任 |

## Pain points

1. 录音不可见→隐私风险→状态持续可感知→隐藏/关闭后确认停录。
2. 错误被覆盖→丢失恢复点→保留错误与上下文→重试从原失败点开始。
3. 取消/重复提交不明→重复副作用→取消生效且幂等→仅产生一次结果。
4. 迟到事件跨窗→新任务被污染→旧事件隔离→重开后无旧结果回落。
5. 路由冒充完成→误判成功→提供可核对结果→动作与实际状态一致。

## Preference only

- 优先可撤回、状态连续和结果可信，其次才是更快执行。（E4）

## Unknown

- 真实权限/Helper 恢复时序。
- 取消是否终止下游任务。
- 跨窗迟到事件是否实机发生。
- 外部应用结果如何核验。

## Relevant needs

| NEED-002 | 首次与高频使用；识别、编辑、提交 | 用户担心系统听错、误执行或重复提交；当前 final 可编辑，但执行中仍可能重复发令 | 用户能在副作用发生前确认或修正系统理解；同一意图只产生一次执行 | MUST | 识别结果可纠正；重复快捷键/提交不产生第二次副作用；每次执行都有稳定请求身份 | E2 项目事实；user-001/002/003 | E2 + E4 |
| NEED-003 | 中断恢复；隐藏、关闭、重开命令窗 | 隐藏窗口仍可能录音，关闭时旧会话未显式取消，用户无法可靠判断是否仍在收音 | 录音状态持续可感知；隐藏、关闭、切换消费者时，用户始终能明确停止并知道当前录音归属 | MUST | 不存在无可见提示的持续收音；关闭后旧会话不会阻止或污染新会话；用户能从任意可见入口立即停止 | E2 项目事实；user-003 | E2 + E4；真实 Electron 时序待验证 |
| NEED-004 | 所有视角；权限、Helper、Provider、IPC 或任务失败 | 错误可能被 idle 覆盖；请求可能长期停在执行中；取消、重试和迟到结果的关系不可靠 | 失败原因和恢复点保持可见；用户可以取消、重试或从中断处继续，且迟到事件不会污染新任务 | MUST | 每个请求在限定时间进入唯一终态；取消后不再产生副作用；重试不重复执行；错误提供针对性恢复路径 | E2 项目事实；user-001/002/003 | E2 + E4；部分风险尚未实机复现 |
| NEED-005 | 以语音作为主要控制方式的用户；确认、澄清和模式切换 | 核心流程仍依赖点击开始/停止/提交；在确认、澄清等安全节点容易被迫回到鼠标 | 产品自身管理的核心任务可以从语音开始、经必要确认与澄清、直到完成；必须人工处理的系统权限应提前说明 | MUST | 代表性低风险和需确认任务可在不触鼠标的情况下完成；任何必须手动的系统级步骤都有明确原因和恢复点 | E1 用户关注方向；E2 项目事实；user-001/002 | E2 + E4；是否覆盖所有系统权限待验证 |

## Allowed design excerpts

## 1. 设计结论快照
- 问题：用户要从发令到真实结果的可信闭环；现状混用语义覆盖、路由成功与任务完成，且录音、请求、决策、结果缺统一生命周期。
- 方案：以 `VoiceSession + CommandRequest + Ledger/Tombstone + ExecutionReceipt` 统一路由、幂等和证据；采用用户确认的安全优先边界，任何关键事实无法原子核验时停止执行并说明原因。
- 明确不做：任意 DOM 点击、绕过系统授权、常驻唤醒词，以及把语义/转发冒充完成。
- 最大风险：无法核验外部后置状态的 Agent 任务只能显示“系统未核验/需要核对”，不计入已验证闭环率。

## 3. 方案原则与范围
- 原则：可验证任务优先于覆盖数；请求单一真相；收音/执行分离；决策可语音完成，手动与不支持边界如实显示。
- E1 Guardrail：录音句柄、目标/权限、scope 隔离或结果任一无法由权威源原子核验，就不释放、不执行、不重发、不宣告完成；接受能力覆盖缩小。
- 能力须登记目标、前置、执行者、后置条件；命令窗、主窗、Chat 共用 request ID。不含环境常听、任意 shell/DOM、无后置条件 action。

## 4. 产品对象与业务规则
| 对象 | 关键字段 | 生命周期/不变量 |
| --- | --- | --- |
| `VoiceSession` | session/generation、owner、capture、osHandleCount、inputSource、focusedRequestId | 仅句柄归零释放；ASR 只接收经播放回声抑制的 MIC_CAPTURE；歧义指代不路由 |
| `UtteranceDraft/Queue` | 编辑稿、attemptToken、confirmationEpoch、draftHash、blockedBy | final 时持久化跨 session token；队列按序扫描，跳过锁定项继续找可执行项 |
| `CapabilityEntry` | goal、route、boundaryKind、pre/postconditions、risk | route 四类；`MANUAL_OR_UNSUPPORTED` 必须再标 `MANUAL_REQUIRED` 或 `UNSUPPORTED` 及理由 |
| `CommandRequest/Ledger` | request/key、state、sequence、deadline、attempt | `state` 只取 §8 唯一枚举；重试/重启复用身份，状态与 receipt 先持久化 |
| `SubmissionGate` | attemptToken、confirmationEpoch、draftHash、winningRequestId | 主进程唯一约束+CAS；窗口/进程重建仍复用 winning request |
| `EffectScope/DispatchProof` | roots、effectClass、targetVersion、permissionVersion、scopeVersion、authority | 执行端条件提交时校验三个版本；任一缺失、陈旧或无法证明隔离即拒绝 |
| `TransferEnvelope` | request/key、goal、target、constraints、contextSnapshot、risk、deadline | Agent 逐字段深相等校验并回显摘要；缺失/变化则拒绝执行，不要求用户重述 |
| `Receipt/Reconciliation` | outcome、evidence、postcondition、effectPrevented、authority、signature、sequence | 仅签名且 `effectPrevented=true` 可证明取消；REPORTED/UNVERIFIABLE 不算成功 |
| `SideEffectTombstone` | request/key、effectHash、outcome、dedupeUntil | UNKNOWN 在权威 reconciliation 前永不 GC，禁止自动重发 |

业务规则：
1. 快捷键进入 `LISTENING` 或 `PERMISSION_BLOCKED`。系统播报带 playback provenance 并作为 echo reference；真人抢话先停播报，再接收 MIC_CAPTURE。系统音频或来源不确定的帧不得入稿。
2. 隐藏/关闭发 `STOP_CAPTURE`；300ms 无 ACK 可重建 Helper，但 ACK 不释放 owner。到 1s 或任何复核点句柄非零/不可查均进 `CAPTURE_STOP_FAILED`；只有权威句柄归零才释放，旧 generation 仅诊断。
3. idempotencyKey=`hash(logicalAttemptId+intent+stableTarget+effectArgs)`；“再执行一次”才新建 attempt。
4. 所有入口以 `attemptToken+confirmationEpoch+draftHash` CAS 后创建 request；输家返回 winningRequestId。Ledger/Gate 恢复前禁提交。权限或 Helper 修复保留原稿/token/epoch 并回 `REVIEW_READY`；不创建 request。`FAILED_VERIFIED` 的旧 request 保持终态，仅复制可编辑稿；用户修改并重确认才建新 attempt。
5. 执行端在落副作用的同一原子提交中比较 target/permission/scopeVersion；不一致返回 `PRECONDITION_CHANGED`、effect=0、结束原 request 并回草稿重确认。
6. scope roots 为 `{stableId, coverage:EXACT|SUBTREE, ancestorIds, hierarchyVersion}`。GLOBAL 总重叠；同 root 重叠；SUBTREE 覆盖另一 root 时重叠。仅权威同版本的两个 EXACT 可证明不重叠；其余缺失、陈旧、冲突均提升为 GLOBAL。
7. DIRECT 仅 VERIFIED 后称完成；DELEGATED 用 TransferEnvelope；ANSWER 写入 Chat 后完成。指代只接受唯一 focusedRequest、序号、名称或唯一“上一条”，否则澄清且 effect=0。“停止录音”只停收音，“取消第N个任务”只请求取消业务；裸“停止”有且仅有一个候选时绑定它，零候选不动作，多候选列出“录音/任务名”澄清，澄清前 capture/effect 均不变。紧急键只停录音。
8. 8 秒无 ACK 为 DELIVERY_FAILED，只查询原 request；deadline 后为 TIMED_OUT；`reconcileBy=deadline+60s`。到期 UNKNOWN 转 `CLOSED_UNVERIFIED`，保留 tombstone/scope，仅允许权威重查、导出诊断或签名人工核验。
9. 恢复先回放 Ledger/Gate/receipt，再开放提交并查询原 request；`NOT_DISPATCHED` 前不重发。新鲜原子 `NOT_DISPATCHED` 后才可原 request/key 安全重试一次；request 创建即锁 scope。
10. 低风险先复述并可撤销；中风险确认；不可撤销破坏动作双确认或排除。

## 6. 用户旅程
| 步骤 | 用户目标 | 用户动作 | 系统反馈 | 状态变化 | 退出/恢复 |
| --- | --- | --- | --- | --- | --- |
| 1 | 开始说话 | 按 Option+Space | 权限正常则提示音+红色录音标；缺权限则显示系统步骤 | IDLE→LISTENING 或 PERMISSION_BLOCKED | 说“停止录音”或再次按快捷键 |
| 2 | 确认听对 | 自然说任务，停顿或说“就这样” | 实时文本；结束后显示“我理解为…”、目标、路由和风险 | LISTENING→REVIEW_READY | 口头修正、键盘编辑或取消 |
| 3 | 提交任务 | 说“执行”或按提交 | 生成 requestId，显示已接收而非已完成 | REVIEW_READY→DELIVERING | 8 秒无 ACK 仅查询并显示“不会重新执行”；权威 NOT_DISPATCHED 后才可安全重试 |
| 4 | 处理分支 | 说“确认/取消第2个任务” | 取消请求显示“任务仍可能执行”；裸“停止”多候选时先问“停录音还是取消某任务” | NEEDS_DECISION→RUNNING/CANCEL_REQUESTED | 澄清前不动作；签名 effectPrevented=true 后才显示已取消 |
| 5 | 连续准备 | 一次唤起后说“连续输入”；任务间说“下一条” | 红色录音标常显，新草稿只入队 | CONTINUOUS_LISTENING + QUEUED_DRAFT | 默认静默30秒；“等待/继续/再等一分钟”控制窗口；明确停止或到期才停录 |
| 6 | 确认真实结果 | 可关闭命令窗或看任务条 | 主窗与 Chat 续显同一 requestId/sequence；VERIFIED/REPORTED/需核对分开显示 | RUNNING→证据结论/NEEDS_USER_CHECK | 继续等待或请求取消 |
| 7 | 安全续行/恢复 | 语音查阻塞、跳过或重排；重开应用 | 队列逐项标阻塞，非重叠继续；先回放 Gate/Ledger/receipt 再开放提交 | QUEUED_DRAFT/RECOVERING→可执行项或封存 | UNKNOWN 不重发；签名核验后解锁 |

## 7. 页面与交互设计
- 命令窗依次显示录音/隐私、上下文/承诺、原识别/编辑稿、当前任务、5条草稿、上一结果；写操作不自动执行。
- 确认卡列动作、目标、Capability、依据、影响；指代多解列 request 并澄清。队列可语音查阻塞、跳过、重排。
- 结果区分：已接收/执行中/请求停止（仍可能执行）/已取消（effect=0）/已转交/已验证/`Agent 报告已完成；系统未核验`/需核对/失败/超时；REPORTED 不进 SUCCEEDED。
- 恢复卡先用用户语言列对象、期望结果、可见证据和安全下一步；技术详情再列 target/scope、诊断与资格，跨状态/重启不覆盖。
- `CAPTURE_STOP_FAILED` 三处红色告警；句柄归零前仅可强停/诊断，不能新录音。录音中关窗先停录留稿，执行中只收起。
- 命令窗、主窗、托盘及 `Option+Shift+Esc` 均可一步强停录音；不取消业务，句柄归零才消警/释放 owner，草稿保留。
- 每态只有一个主动作：超时“查询原任务”、未知“核对结果”、封存“请求权威核验”、权限/Helper 修复“继续原稿”、失败“修改后重试”；其余进更多菜单。
- 拒绝卡各给一个支持替代和手动例；核对卡列对象、期望、证据、安全下一步；取消摘要只说“已取消/仍可能执行”，技术详情列 target/effectHash/authority/sequence/time。
- 漂移卡并列新旧上下文、目标、风险；目录项可朗读路由、证据、限制。

## 8. 状态与异常矩阵
`VoiceUIState` 只取 `IDLE / PERMISSION_BLOCKED / LISTENING / CONTINUOUS_LISTENING / CAPTURE_STOPPING / CAPTURE_STOP_FAILED / REVIEW_READY / NEEDS_DECISION / QUEUED_DRAFT`；连续态默认静默窗口30秒，“等待”保持、“继续”重置30秒、“再等一分钟”延长60秒，录音标与倒计时始终可见。`CommandState` 只取 `PREPARED / DELIVERING / DELIVERY_FAILED / RUNNING_DIRECT / RUNNING_DELEGATED / TIMED_OUT / CANCEL_REQUESTED / NEEDS_USER_CHECK / CLOSED_UNVERIFIED / TERMINAL_NOT_EXECUTED / SUCCEEDED_VERIFIED / FAILED_VERIFIED`。

| 当前状态 + 权威事件 | 唯一新状态 | 锁/可见结论 |
| --- | --- | --- |
| 创建 request | PREPARED | scope 锁定，尚未执行 |
| PREPARED + 版本条件提交通过 | DELIVERING→RUNNING_* | 锁保持；ACK 只表示接收 |
| PREPARED/DELIVERY_FAILED + 新鲜原子 NOT_DISPATCHED | DELIVERING（原 request 最多一次） | 显示“安全重试”；锁保持 |
| 任意未验证态 + PRECONDITION_CHANGED | TERMINAL_NOT_EXECUTED | effect=0、释放，回草稿重确认 |
| DELIVERING + 8 秒无 ACK | DELIVERY_FAILED | 仅查询；显示“正在查询原请求，不会重新执行” |
| RUNNING_* + deadline | TIMED_OUT | 锁保持，不宣告失败 |
| 任意未验证态 + 用户取消 | CANCEL_REQUESTED | 锁保持 |
| CANCEL_REQUESTED + 签名 receipt(effectPrevented=true) | TERMINAL_NOT_EXECUTED | effect=0；显示“已取消”，释放 |
| CANCEL_REQUESTED + effectPrevented=false/unknown、无签名或不可查询 | NEEDS_USER_CHECK | 显示“仍可能执行”；锁/tombstone 保持 |
| 任意未验证态 + NOT_EXECUTED | TERMINAL_NOT_EXECUTED | 禁重发，释放 |
| 任意未验证态 + UNKNOWN/不可查询/TTL | NEEDS_USER_CHECK | tombstone 不 GC，锁保持 |
| 任意未验证态 + REPORTED/UNVERIFIABLE | NEEDS_USER_CHECK | 系统未核验，锁保持 |
| NEEDS_USER_CHECK + reconcileBy 到期 | CLOSED_UNVERIFIED | 显示“已安全封存，结果未核验”；锁/tombstone 保持 |
| CLOSED_UNVERIFIED + 签名 NOT_EXECUTED | TERMINAL_NOT_EXECUTED | 追加 revision 后释放 |
| CLOSED_UNVERIFIED + 签名 EXECUTED + verified receipt | SUCCEEDED_VERIFIED/FAILED_VERIFIED | 追加 revision 后释放 |
| 任意状态 + VERIFIED(success/failure) | SUCCEEDED_VERIFIED/FAILED_VERIFIED | 最高证据；释放；若纠正旧结论则追加 revision |
| 已验证/NOT_EXECUTED + 后到 cancel、低证据或 UNKNOWN | 原状态不变 | 只追加诊断，不降级、不重锁 |

上述表覆盖 VERIFIED→cancel、cancel→effectPrevented=true/false/unknown；取消请求或回执不得覆盖已验证终态。低 sequence、旧 generation 只诊断；未列事件拒绝迁移并告警。

## 9. 用户体验质量下界
- 可用性：命令窗不抢主窗焦点；Tab 覆盖草稿/决策/恢复，Escape 不绕过停录。状态用文字+图标并 `aria-live`；语音/键鼠等价。480×372 可滚动且长文不裁切。
- 语言与隐私：locale 可独立选择，控制语/示例/状态均 i18n；无录音不占麦，不默认存音频，历史仅存文本、路由、结果、诊断且可清除；敏感字段不入快照/历史。
- 性能与关闭：录音反馈≤300ms、partial≤500ms、direct ACK≤1s；停录 300ms 无 ACK 重建，1s 时仅 OS 句柄=0 可释放，否则 `CAPTURE_STOP_FAILED`。
- 合成效率基准：真实高频样本取得前，报告/图表均标“合成基准”，不得宣称真实用户提效。冻结同五任务、顺序和后置条件，至少含一个 DIRECT、一个 DELEGATED（等待计时），语音/鼠标同热身并交叉顺序；从首次唤起到五星 VERIFIED，每项上限60s、失败记60s，5 trials 须25/25、重复=0，中位总时长严格低于鼠标。
- 工作负载：从 action catalog 冻结 fixture ID/hash，含跨上下文、开对象、建草稿、改设置、中风险写入；无可验证 action 即失败。语音全程一次唤起、零鼠标/Agent 重述；“等待/继续/再等一分钟”单独计为维护口令，不算业务任务；除参与者主动暂停外系统诱发次数须0，否则 trial 失败。
- 首次理解：固定切项目/移窗/总结/授权/任意网页控件的路由与理由；5名首次用户至少4名完成四类路由、手动/不支持辨别及“识别—纠正—一次提交—终态—恢复”，路径和理由正确率均≥80%。
- 故障/锁/证据：dispatch 前、执行后 receipt 前、落盘后崩溃，effect 仅0/1；未知/不可查/TTL 不重发。测试 ACK+句柄非零、ACK/重建双失败、句柄不可查均不释放且新 owner=0；覆盖 cancel↔VERIFIED、NOT_EXECUTED/UNKNOWN，重启后状态/锁/计数符合 §8。
- Scope/续显：覆盖 EXACT/SUBTREE/GLOBAL、版本缺失/陈旧及预检后改名/删除/失权，失败 effect=0；sequence=2 重启后注入3、乱序1、终态 receipt，原 request 更新不倒退，dispatch=1。
- 并发/转交：四入口同稿 request/dispatch/effect=1；低/中风险从修正到 VERIFIED 零鼠标。Envelope 逐字段深相等，重述=0、dispatch=1；VERIFIED/REPORTED 文案严格分开。
- 音源/仲裁/恢复：系统播报+真人抢话25次，播放零入稿；三 request 测序号/名称/上一条/“它”。另测裸“停止”候选为0/1/多项：仅1项绑定，多项澄清，停录/任务 effect=0；紧急键只停录。权限/Helper 修复保留 token/epoch/稿且不建 request；FAILED_VERIFIED 须修改重确认后新 attempt；跨窗/崩溃均无重复。
