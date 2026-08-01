# Participant Review Bundle

- Participant ID: user-002
- Design revision: R018
- Design SHA-256: 1633a76b00851a0f0aabe5683db9d2c6774371c595057615cdd0be9d20f4401a
- Allowed Need IDs: NEED-001, NEED-002, NEED-004, NEED-005, NEED-006
- Allowed design sections: 1, 3, 4, 6, 8, 9
- Section source: tracking-table

## Fixed profile

# Participant Profile

- Participant ID: user-002
- Evidence level: E4 SIMULATED
- Lens: 高频使用 / 效率敏感：希望日常跨页面操作比鼠标更快，并可连续发令
- Product goal: 用语音完成 AgentOS 跨页面高频任务
- Trigger and context: 反复使用时连续处理多个跨页操作
- Entry point: Option+Space 或托盘进入命令窗
- Existing knowledge: 熟悉自己的常用任务路径
- Constraints: 不接受频繁停顿、重复唤起或改用鼠标
- Success definition: 连续发令可稳定完成任务，整体快于鼠标
- Most sensitive pain points: 执行悬停、重复提交、迟到事件与完成状态不明
- Relevant NEED candidates: 连续指令、跨页直达、低延迟、可恢复、结果确认
- Out-of-scope assumptions: 不推断年龄、职业、技术或辅助能力

## Latest own feedback

# Feedback

- Participant ID: user-002
- Evidence level: E4 SIMULATED
- Created at: 2026-07-30T23:34:49+08:00

## Content

# Participant Feedback

- Participant ID: user-002
- Mode: INITIAL_FEEDBACK
- Evidence level: E4 SIMULATED；项目现状引用为 E2 PROJECT_FACT

## Journey

| Stage | Goal | Seen/understood | Action | Possible thought | Friction | Consequence |
| --- | --- | --- | --- | --- | --- | --- |
| 快速进入 | 立即发令 | Option+Space/托盘入口（E2） | 唤起命令窗 | “应立即可说”（E4） | 仍需选模式、手动开始 | 入口优势被稀释 |
| 连续发令 | 连做多项任务 | 可编辑 final 后提交（E2） | 连发任务 | “别每次重唤醒”（E4） | 执行中可重复提交 | 重复执行风险 |
| 跨页直达 | 比鼠标更快 | 约 21 个领域 action（E2） | 发跨页目标 | “应比熟练鼠标更快”（E4） | 语义不等于可执行 | 频繁回退鼠标 |
| 正确转发 | 长尾任务接续 | 自动分流命令/Agent/问答（E2） | 发长尾任务 | “转发可以，别让我重述”（E4） | 路由不证明完成 | 信任下降 |
| 确认完成 | 决定是否继续 | 主窗未回传会久停执行中（E2） | 等待结果 | “到底做完没有？”（E4） | 完成状态不明 | 不敢继续发令 |
| 失败恢复 | 从中断处继续 | 错误覆盖、迟到事件风险（E2） | 取消、重试 | “失败也要接着做”（E4） | 隐藏不结束录音 | 流程中断 |

## Pain points

1. 重复唤起→吞噬效率→连续发令→多任务间无需重开。
2. 重复提交→副作用→执行互斥→同一指令只执行一次。
3. 跨页覆盖不足→回退鼠标→目标直达→高频路径稳定完成。
4. 转发不透明→重复表述→保留上下文→Agent 接手后延续目标。
5. 状态不明→不敢继续→明确完成与可恢复→失败后可取消、修正、重试。

## Preference only

- 最关注“连续指令的稳定闭环”，而不是单纯扩大可说控件数量。（E4）

## Unknown

- 真实端到端延迟与跨页任务成功率。
- Agent 转发是否保留上下文。
- 取消后迟到事件是否仍生效。

## Relevant needs

| NEED-001 | 所有视角；任意语音任务 | “有语义、已路由、已转发”不等于任务真的完成，“全界面”承诺与直接执行范围也可能不一致 | 用户在发令前能判断任务会被直接执行、转交还是不支持；发令后得到与实际界面/系统状态一致的唯一终态 | MUST | 核心任务均能区分“已接收、执行中、已完成、失败、已取消”；成功必须有可核对的后置结果，而非仅显示已路由 | E1 用户关注方向；E2 项目事实；user-001/002/003 | E2 + E4，待真实用户验证优先顺序 |
| NEED-002 | 首次与高频使用；识别、编辑、提交 | 用户担心系统听错、误执行或重复提交；当前 final 可编辑，但执行中仍可能重复发令 | 用户能在副作用发生前确认或修正系统理解；同一意图只产生一次执行 | MUST | 识别结果可纠正；重复快捷键/提交不产生第二次副作用；每次执行都有稳定请求身份 | E2 项目事实；user-001/002/003 | E2 + E4 |
| NEED-004 | 所有视角；权限、Helper、Provider、IPC 或任务失败 | 错误可能被 idle 覆盖；请求可能长期停在执行中；取消、重试和迟到结果的关系不可靠 | 失败原因和恢复点保持可见；用户可以取消、重试或从中断处继续，且迟到事件不会污染新任务 | MUST | 每个请求在限定时间进入唯一终态；取消后不再产生副作用；重试不重复执行；错误提供针对性恢复路径 | E2 项目事实；user-001/002/003 | E2 + E4；部分风险尚未实机复现 |
| NEED-005 | 以语音作为主要控制方式的用户；确认、澄清和模式切换 | 核心流程仍依赖点击开始/停止/提交；在确认、澄清等安全节点容易被迫回到鼠标 | 产品自身管理的核心任务可以从语音开始、经必要确认与澄清、直到完成；必须人工处理的系统权限应提前说明 | MUST | 代表性低风险和需确认任务可在不触鼠标的情况下完成；任何必须手动的系统级步骤都有明确原因和恢复点 | E1 用户关注方向；E2 项目事实；user-001/002 | E2 + E4；是否覆盖所有系统权限待验证 |
| NEED-006 | 高频使用；连续跨页面任务 | 每条任务都重复唤起、选模式、录音、提交会抵消语音效率；转交 Agent 后可能需要重述上下文 | 用户可以连续发令，任务间保留必要上下文，并在不确定时暂停或退出 | SHOULD | 一组常见跨页面任务总体操作时间低于熟练鼠标路径；转交后无需重述目标；连续任务不会相互串扰 | user-002；E2 项目流程 | E4 + E2，需真实任务基准 |

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
| `VoiceSession` | sessionId、generation、ownerWindowId、captureState、osHandleCount | ACK 只表示收到停录请求；仅权威探针确认 `osHandleCount=0` 才释放 owner/generation+1 |
| `UtteranceDraft/Queue` | 原识别、编辑稿、confirmationEpoch、draftHash、blockedBy | 队列只存未执行草稿；同一确认稿跨表面共享 epoch/hash |
| `CapabilityEntry` | goal、route、boundaryKind、pre/postconditions、risk | route 四类；`MANUAL_OR_UNSUPPORTED` 必须再标 `MANUAL_REQUIRED` 或 `UNSUPPORTED` 及理由 |
| `CommandRequest/Ledger` | request/key、state、sequence、deadline、attempt | `state` 只取 §8 唯一枚举；重试/重启复用身份，状态与 receipt 先持久化 |
| `SubmissionGate` | sessionId、confirmationEpoch、draftHash、winningRequestId | 主进程唯一约束+CAS；语音/按钮/快捷键/Chat 同时提交只返回 winning request |
| `EffectScope/DispatchProof` | roots、effectClass、targetVersion、permissionVersion、scopeVersion、authority | 执行端条件提交时校验三个版本；任一缺失、陈旧或无法证明隔离即拒绝 |
| `TransferEnvelope` | request/key、goal、target、constraints、contextSnapshot、risk、deadline | Agent 必须原样接收并回显校验摘要；不得要求用户重述 |
| `Receipt/Reconciliation` | outcome、evidence、postcondition、authority、sequence | VERIFIED 为权威后置状态；REPORTED/UNVERIFIABLE 不算成功；用户观察仅注记 |
| `SideEffectTombstone` | request/key、effectHash、outcome、dedupeUntil | UNKNOWN 在权威 reconciliation 前永不 GC，禁止自动重发 |

业务规则：
1. 快捷键在已授权时进入 `LISTENING`，否则 `PERMISSION_BLOCKED`；停止、取消、确认、选第 N 个、等待、重试等控制语句优先于业务路由。
2. 隐藏/关闭发 `STOP_CAPTURE`；300ms 无 ACK 可重建 Helper，但 ACK 不释放 owner。到 1s 或任何复核点句柄非零/不可查均进 `CAPTURE_STOP_FAILED`；只有权威句柄归零才释放，旧 generation 仅诊断。
3. idempotencyKey=`hash(logicalAttemptId+intent+stableTarget+effectArgs)`；“再执行一次”才新建 attempt。
4. 所有提交入口先以 `sessionId+confirmationEpoch+draftHash` CAS SubmissionGate，再创建 request；输家返回 winningRequestId。只有原请求已释放 scope 且用户明确说“再执行一次”并重新确认，epoch 才递增。
5. 执行端在落副作用的同一原子提交中比较 target/permission/scopeVersion；不一致返回 `PRECONDITION_CHANGED`、effect=0、结束原 request 并回草稿重确认。
6. scope roots 为 `{stableId, coverage:EXACT|SUBTREE, ancestorIds, hierarchyVersion}`。GLOBAL 总重叠；同 root 重叠；SUBTREE 覆盖另一 root 时重叠。仅权威同版本的两个 EXACT 可证明不重叠；其余缺失、陈旧、冲突均提升为 GLOBAL。
7. DIRECT 仅 VERIFIED 后称完成；DELEGATED 用 TransferEnvelope 转交，显示已转交、`Agent 报告已完成；系统未核验`或已验证；ANSWER 写入 Chat 后完成。
8. 8 秒无 ACK 为 DELIVERY_FAILED；deadline 后为 TIMED_OUT；`reconcileBy=deadline+60s`。到期仍 UNKNOWN 转 `CLOSED_UNVERIFIED`，保留 tombstone/scope，仅允许权威重查、导出诊断或提交带 authority/evidenceId/signature 的人工核验；用户观察不能解锁。
9. 恢复先回放 receipt，再以原 request/key 查询；仅执行端新鲜原子 `NOT_DISPATCHED` 可原身份重发一次。request 创建即锁 scope，仅 §8 明示迁移释放。
10. 低风险先复述并可撤销；中风险确认；不可撤销破坏动作双确认或排除。

## 6. 用户旅程
| 步骤 | 用户目标 | 用户动作 | 系统反馈 | 状态变化 | 退出/恢复 |
| --- | --- | --- | --- | --- | --- |
| 1 | 开始说话 | 按 Option+Space | 权限正常则提示音+红色录音标；缺权限则显示系统步骤 | IDLE→LISTENING 或 PERMISSION_BLOCKED | 说“停止”或再次按快捷键 |
| 2 | 确认听对 | 自然说任务，停顿或说“就这样” | 实时文本；结束后显示“我理解为…”、目标、路由和风险 | LISTENING→REVIEW_READY | 口头修正、键盘编辑或取消 |
| 3 | 提交任务 | 说“执行”或按提交 | 生成 requestId，显示已接收而非已完成 | REVIEW_READY→DELIVERING | 8 秒无 ACK 可重试 |
| 4 | 处理分支 | 对确认说“确认/取消”，对候选说“第 2 个” | 决策绑定当前 request；长列表可滚动并朗读序号 | NEEDS_DECISION→RUNNING/CANCELLED | 说“都不是”回到草稿 |
| 5 | 连续准备 | 一次唤起后说“连续输入”；任务间直接说“下一条” | 红色录音标常显，新草稿只入队 | CONTINUOUS_LISTENING + QUEUED_DRAFT | 说“停止/结束连续输入”；静默10秒自动停录 |
| 6 | 确认真实结果 | 可关闭命令窗或看任务条 | 主窗与 Chat 续显同一 requestId/sequence；VERIFIED/REPORTED/需核对分开显示 | RUNNING→证据结论/NEEDS_USER_CHECK | 继续等待或请求取消 |
| 7 | 安全出队 | scope 锁释放后继续 | 并列原/新上下文；改名重确认，删除/失权只可重选或跳过 | QUEUED_DRAFT→REVIEW_READY | 副作用始终为 0 |
| 8 | 崩溃恢复 | 重开应用 | receipt 回放→状态查询→权威 NOT_DISPATCHED 后重发 | RECOVERING→结果/NEEDS_USER_CHECK | 未知可隔离队列，绝不重发 |

## 8. 状态与异常矩阵
`VoiceUIState` 只取 `IDLE / PERMISSION_BLOCKED / LISTENING / CONTINUOUS_LISTENING / CAPTURE_STOPPING / CAPTURE_STOP_FAILED / REVIEW_READY / NEEDS_DECISION / QUEUED_DRAFT`；连续态在每次提交后仍监听控制词/下一草稿，显式停止或静默10秒才进入 CAPTURE_STOPPING。`CommandState` 只取 `PREPARED / DELIVERING / DELIVERY_FAILED / RUNNING_DIRECT / RUNNING_DELEGATED / TIMED_OUT / CANCEL_REQUESTED / CANCELLED_PROVISIONAL / NEEDS_USER_CHECK / CLOSED_UNVERIFIED / TERMINAL_NOT_EXECUTED / SUCCEEDED_VERIFIED / FAILED_VERIFIED`。

| 当前状态 + 权威事件 | 唯一新状态 | 锁/可见结论 |
| --- | --- | --- |
| 创建 request | PREPARED | scope 锁定，尚未执行 |
| PREPARED + 版本条件提交通过 | DELIVERING→RUNNING_* | 锁保持；ACK 只表示接收 |
| PREPARED/DELIVERY_FAILED + 新鲜原子 NOT_DISPATCHED | DELIVERING（原 request 最多一次） | 锁保持 |
| 任意未验证态 + PRECONDITION_CHANGED | TERMINAL_NOT_EXECUTED | effect=0、释放，回草稿重确认 |
| DELIVERING + 8 秒无 ACK | DELIVERY_FAILED | 锁保持，只查询 |
| RUNNING_* + deadline | TIMED_OUT | 锁保持，不宣告失败 |
| 任意未验证态 + 用户取消 | CANCEL_REQUESTED | 锁保持 |
| CANCEL_REQUESTED + cancellationReceipt | CANCELLED_PROVISIONAL | 显示“暂定已取消”，锁保持 |
| 任意未验证态 + NOT_EXECUTED | TERMINAL_NOT_EXECUTED | 禁重发，释放 |
| 任意未验证态 + UNKNOWN/不可查询/TTL | NEEDS_USER_CHECK | tombstone 不 GC，锁保持 |
| 任意未验证态 + REPORTED/UNVERIFIABLE | NEEDS_USER_CHECK | 系统未核验，锁保持 |
| NEEDS_USER_CHECK/CANCELLED_PROVISIONAL + reconcileBy 到期 | CLOSED_UNVERIFIED | 显示“已安全封存，结果未核验”；锁/tombstone 保持 |
| CLOSED_UNVERIFIED + 签名 NOT_EXECUTED | TERMINAL_NOT_EXECUTED | 追加 revision 后释放 |
| CLOSED_UNVERIFIED + 签名 EXECUTED + verified receipt | SUCCEEDED_VERIFIED/FAILED_VERIFIED | 追加 revision 后释放 |
| 任意状态 + VERIFIED(success/failure) | SUCCEEDED_VERIFIED/FAILED_VERIFIED | 最高证据；释放；若纠正旧结论则追加 revision |
| 已验证/NOT_EXECUTED + 后到 cancel、低证据或 UNKNOWN | 原状态不变 | 只追加诊断，不降级、不重锁 |

上述表覆盖 VERIFIED→cancel、cancel→VERIFIED、cancel→NOT_EXECUTED、cancel→UNKNOWN。低 sequence、旧 generation 只诊断；任何未列事件拒绝迁移并告警。

## 9. 用户体验质量下界
- 焦点：命令窗出现不抢主窗口输入焦点；键盘 Tab 顺序覆盖草稿、决策、恢复；Escape 只关闭表面，不跳过停录规则。
- 可访问性：所有状态有文字与图标，不能只靠颜色/提示音；结果和错误使用 `aria-live`；语音与键鼠始终等价。
- 长文本与窗口：480×372 为最小尺寸但内容必须纵向滚动；候选、错误和长项目名不裁切；支持窗口尺寸记忆。
- i18n：识别 locale 默认跟随应用语言并可单独选择；控制语句、示例、状态文案统一走 i18n，中文/英文礼貌表达进入同一意图。
- 隐私：无录音时不保持麦克风；不默认保存音频；任务历史只保存文本、路由、结果和诊断码，并允许清除。
- 性能与关闭：开始录音反馈 ≤300ms；partial ≤500ms；direct ACK ≤1s。关闭后 300ms 无 ACK 即重建；到 1s 时只有 OS 句柄=0 才释放 owner，否则 CAPTURE_STOP_FAILED，句柄非零绝不释放。
- 连续效率基准：同操作者、同五任务、同顺序/后置条件；从首次 Option+Space 到第五星 VERIFIED。每项上限 60s，失败记 60s；5 个 trial 必须 25/25、重复=0，保存原始总时长，升序第3值须严格小于鼠标基线。
- 基准工作负载：测试前从现有 action catalog 预注册并冻结 fixture ID/hash，固定为“跨上下文切换、打开指定对象、创建可撤销草稿、修改可撤销设置、中风险确认写入”五类；任一类无可验证 action 则测试失败。全程只唤起一次、零鼠标、零 Agent 重述，语音/鼠标共用后置条件。
- 首次理解基准：锁定“切项目/移动窗口/总结/麦克风授权/任意网页控件”的标准路由与理由；5 名首次参与者至少4名能区分四类路由及手动/不支持子类，路径和理由正确率均≥80%。
- 安全：敏感字段不进入语音快照或历史；外部应用/网页和写操作继续经过 allowlist、风险级别与后置条件。
- 故障脚本：分别在 dispatch 前、执行后 receipt 前、receipt 落盘后崩溃；重启后副作用计数只能为 0 或 1，未知/不可查询/TTL 到期绝不重发，tombstone 必须命中。
- 锁与录音脚本：及时 ACK+句柄非零、ACK/重建双失败、句柄不可查三案均 owner 不释放、新 owner=0；仅权威归零后恢复。
- 证据顺序脚本：覆盖 cancel↔VERIFIED、cancel→NOT_EXECUTED/UNKNOWN，重启后状态、revision、锁、effect count 符合 §8。
- Scope/目标脚本：覆盖同 root、父子、共享祖先 EXACT、SUBTREE、缺失/陈旧版本、GLOBAL；不能证明隔离即 GLOBAL。于预检后/执行端提交前注入改名/删除/失权，版本失败时 effect=0。
- Agent 续显脚本：sequence=2 时重启，再注入 3、乱序1和终态 receipt；原 request 更新、序列不倒退、dispatch=1，主窗可继续等待/取消。
- 并发/免手脚本：语音、按钮、快捷键、Chat 同时提交同一稿，request/dispatch/effect 均=1；低风险、中风险各一项从修正到 VERIFIED 零鼠标。权限页注明系统手动原因，返回后语音续接原草稿。
