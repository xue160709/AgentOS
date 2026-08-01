# Participant Review Bundle

- Participant ID: user-003
- Design revision: R006
- Design SHA-256: 3a277c6f6066e05df4051ed06471ba4bf831e68a57713d2a235ca70016fc10e1
- Allowed Need IDs: NEED-001, NEED-002, NEED-003, NEED-004, NEED-005
- Allowed design sections: 1, 3, 4, 5, 6, 7, 8, 9
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

| NEED-001 | 所有视角；任意语音任务 | “有语义、已路由、已转发”不等于任务真的完成，“全界面”承诺与直接执行范围也可能不一致 | 用户在发令前能判断任务会被直接执行、转交还是不支持；发令后得到与实际界面/系统状态一致的唯一终态 | MUST | 核心任务均能区分“已接收、执行中、已完成、失败、已取消”；成功必须有可核对的后置结果，而非仅显示已路由 | E1 用户关注方向；E2 项目事实；user-001/002/003 | E2 + E4，待真实用户验证优先顺序 |
| NEED-002 | 首次与高频使用；识别、编辑、提交 | 用户担心系统听错、误执行或重复提交；当前 final 可编辑，但执行中仍可能重复发令 | 用户能在副作用发生前确认或修正系统理解；同一意图只产生一次执行 | MUST | 识别结果可纠正；重复快捷键/提交不产生第二次副作用；每次执行都有稳定请求身份 | E2 项目事实；user-001/002/003 | E2 + E4 |
| NEED-003 | 中断恢复；隐藏、关闭、重开命令窗 | 隐藏窗口仍可能录音，关闭时旧会话未显式取消，用户无法可靠判断是否仍在收音 | 录音状态持续可感知；隐藏、关闭、切换消费者时，用户始终能明确停止并知道当前录音归属 | MUST | 不存在无可见提示的持续收音；关闭后旧会话不会阻止或污染新会话；用户能从任意可见入口立即停止 | E2 项目事实；user-003 | E2 + E4；真实 Electron 时序待验证 |
| NEED-004 | 所有视角；权限、Helper、Provider、IPC 或任务失败 | 错误可能被 idle 覆盖；请求可能长期停在执行中；取消、重试和迟到结果的关系不可靠 | 失败原因和恢复点保持可见；用户可以取消、重试或从中断处继续，且迟到事件不会污染新任务 | MUST | 每个请求在限定时间进入唯一终态；取消后不再产生副作用；重试不重复执行；错误提供针对性恢复路径 | E2 项目事实；user-001/002/003 | E2 + E4；部分风险尚未实机复现 |
| NEED-005 | 以语音作为主要控制方式的用户；确认、澄清和模式切换 | 核心流程仍依赖点击开始/停止/提交；在确认、澄清等安全节点容易被迫回到鼠标 | 产品自身管理的核心任务可以从语音开始、经必要确认与澄清、直到完成；必须人工处理的系统权限应提前说明 | MUST | 代表性低风险和需确认任务可在不触鼠标的情况下完成；任何必须手动的系统级步骤都有明确原因和恢复点 | E1 用户关注方向；E2 项目事实；user-001/002 | E2 + E4；是否覆盖所有系统权限待验证 |

## Allowed design excerpts

## 1. 设计结论快照
- 用户问题：用户要的是从发令到真实结果的可信闭环，不是“所有语义控件都能说”。
- 根本原因：语义覆盖、路由成功与任务完成混用；录音、请求、决策和结果缺统一生命周期。
- 推荐方案：以 `VoiceSession + CommandRequest + Ledger/Tombstone + ExecutionReceipt` 统一四类路由、跨重启幂等、终态证据、取消仲裁和连续草稿。
- 核心变化：先说明能否做，复述理解，每条任务有唯一身份、状态和证据；关闭、重试不再造成隐形录音或重复副作用。
- 明确不做：任意 DOM 点击、绕过系统授权、常驻唤醒词，以及把语义/转发冒充完成。
- 最大风险：无法核验外部后置状态的 Agent 任务只能显示“系统未核验/需要核对”，不计入已验证闭环率。

## 3. 方案原则与范围
- 原则：任务级能力而非控件数量；一次请求一个真相；收音与执行分离；产品内决策可语音完成；系统手动边界诚实可见。
- 能力登记必须包含用户目标、前置条件、执行者和后置条件；命令窗、主窗与 Chat 共享 request ID，任何表面不得自行宣布成功。
- 范围：独立语音命令窗、主窗口当前任务条、托盘录音状态、direct/agent_task/answer 路由、确认/澄清、超时/取消/重试和能力说明。
- 非目标：手机遥控、环境常听、完整 TTS 助手、任意 shell/DOM 自动化、无后置条件的新系统 action。

## 4. 产品对象与业务规则
| 对象 | 关键字段 | 生命周期/不变量 |
| --- | --- | --- |
| `VoiceSession` | sessionId、generation、ownerWindowId、captureState、locale | 同时最多一个录音 owner；隐藏/关闭先完成停录握手；事件须匹配 sessionId+generation，禁止 fallback 到 Composer |
| `UtteranceDraft` | rawPartial、finalText、editedText、confidence | 提交使用用户最后确认文本；修改后保留“原识别/已编辑”标记，不保存敏感音频 |
| `CapabilityEntry` | goal、route、risk、preconditions、examples、limitations | `DIRECT / DELEGATED / ANSWER / MANUAL_OR_UNSUPPORTED` 四类互斥；必须声明完成证据 |
| `CommandRequest` | requestId、logicalAttemptId、idempotencyKey、dispatchProof、intent、targetRef、route、risk、state、deadline | 一次明确执行创建一个 logical attempt；ACK 丢失、超时重试和重启恢复复用原身份 |
| `DurableRequestLedger` | request、dispatchState、receipt、expiresAt、sequence | 主进程 dispatch 前写入；重启后先回放 receipt 或查询执行状态，不把恢复等同重新执行 |
| `SideEffectTombstone` | requestId、idempotencyKey、effectHash、lastKnownOutcome、dedupeUntil | receipt 可过期，副作用 tombstone 不早于执行端去重期删除；过期未知仍禁止自动重发 |
| `TransferEnvelope` | requestId、idempotencyKey、goal、targetRef、project/thread/page context、risk、permissionMode、locale、deadline | Agent 转交必须携带完整目标与上下文，不要求用户重述；进度事件按 sequence 单调递增 |
| `PendingDecision` | requestId、type、options、expiresAt | `CONFIRM / CLARIFY / PERMISSION_HANDOFF`；只接受绑定 request 的语音或点击响应 |
| `ExecutionReceipt` | requestId、outcome、evidenceLevel、postcondition、observedValue、source、completedAt | `VERIFIED`=系统复查后置状态；`REPORTED`=Agent 结构化报告；`UNVERIFIABLE`=无稳定证据，进入 NEEDS_USER_CHECK 而非 SUCCEEDED |
| `DraftQueue` | sessionId、drafts、maxSize=5 | 允许在上一任务运行时继续收集/编辑下一条；副作用任务同时只 dispatch 一个，出队前重新校验目标上下文 |

业务规则：
1. 全局快捷键在权限已授权时直接进入 `LISTENING`；首次或权限缺失时进入 `PERMISSION_BLOCKED`，不假装正在听。
2. `停止聆听、取消当前任务、确认、取消、选第 N 个、继续等待、重试` 是会话控制语句，优先于业务意图解析。
3. 隐藏/关闭发 `STOP_CAPTURE(sessionId,generation)`；300ms 内收到 Helper ACK 才释放 owner。超时则重建 Helper；重建或 OS 采集句柄关闭校验仍失败时进入 `CAPTURE_STOP_FAILED`，保留 owner 占位并阻止新 owner。强杀 Helper 且 OS 句柄=0 后才 generation+1、释放 owner；旧 generation 只记诊断。
4. idempotencyKey=`hash(logicalAttemptId+normalizedIntent+stableTarget+effectArgs)`，首次执行前生成并持久化；重试返回 ledger 中原状态/receipt，不再次 dispatch。只有用户明确说“再执行一次”才创建新 logicalAttemptId，并重新走风险确认。
5. DIRECT 仅在 `VERIFIED` 后显示“已完成”；DELEGATED 先显示“已交给 Agent”，`REPORTED` 显示“Agent 报告完成”，`UNVERIFIABLE` 显示“需要你核对”；ANSWER 在回答写入当前 Chat 后完成。
6. 8 秒无 ACK 进入 `DELIVERY_FAILED`；DIRECT 默认 30 秒，DELEGATED 使用 Capability deadline。超时只改变等待状态，不创建新执行；继续等待、取消或重试均复用原 request。
7. 重启恢复严格分三路：ledger 有 receipt 只回放；无 receipt 用原 request/key 查询执行端；仅有可审计 `NOT_DISPATCHED` 证明时才可用原身份重新 dispatch。未知、不可查询、查询失败、TTL 到期一律进入 `NEEDS_USER_CHECK`，禁止自动重发。
8. `CANCEL_REQUESTED` 不是终态；cancellationReceipt 只形成“基于当前证据的 CANCELLED”。迟到 `VERIFIED` 可纠正结论，并追加不可删除的 `revision{from,to,evidence,at}`；界面明确提示“取消未阻止/状态已纠正”。
9. 事件必须匹配 requestId、sessionId/generation 与递增 sequence；旧请求只更新其历史卡。证据优先级：可观测 `VERIFIED` > cancellationReceipt > `REPORTED` > timeout；低证据事件不得覆盖高证据结论。
10. 副作用 request 从创建即持全局锁；DELIVERING、DELIVERY_FAILED、RUNNING、TIMED_OUT、CANCEL_REQUESTED、NEEDS_USER_CHECK、REPORTED 均持锁。仅 VERIFIED、证明未开始/已回滚且无副作用的 cancellationReceipt、或 NOT_DISPATCHED 证明可释放。
11. 运行中可收集最多 5 条队列草稿。出队时并列入队时/当前 project、thread、page、target 与 risk；漂移则让用户选择“按新目标/回原目标/跳过”，前两项都回 REVIEW_READY 重新确认。
12. 低风险 direct 可执行前复述并短暂允许口头“撤销”；中风险必须确认；不可撤销破坏性动作保持点击/语音双确认或不进入语音范围。

## 5. 信息架构
- 快捷键/托盘进入命令窗；窗内依次承载录音状态、上下文/路由、草稿、当前任务、5 条待执行草稿和最近结果。
- 主窗口任务条承接关窗后的控制，Chat 展示 Agent 过程；二者消费同一请求流。设置 > 语音控制承载权限/语言、能力目录、历史和诊断。
- 命令窗只负责采集、理解确认和当前任务控制，业务真相只来自统一 receipt。
- 首屏固定承诺：“我会告诉你任务是直接执行、交给 Agent、回答，还是需要手动；只有核验结果后才说完成。”
- 能力目录按“导航与切换、创建与发送、设置与状态、系统任务、回答”组织；每项标路由、风险、证据等级和限制。支持“能做什么/下一类/读第 N 项/试试第 N 项/返回”全语音浏览。

## 6. 用户旅程
| 步骤 | 用户目标 | 用户动作 | 系统反馈 | 状态变化 | 退出/恢复 |
| --- | --- | --- | --- | --- | --- |
| 1 | 开始说话 | 按 Option+Space | 权限正常则提示音+红色录音标；缺权限则显示系统步骤 | IDLE→LISTENING 或 PERMISSION_BLOCKED | 说“停止”或再次按快捷键 |
| 2 | 确认听对 | 自然说任务，停顿或说“就这样” | 实时文本；结束后显示“我理解为…”、目标、路由和风险 | LISTENING→REVIEW_READY | 口头修正、键盘编辑或取消 |
| 3 | 提交任务 | 说“执行”或按提交 | 生成 requestId，显示已接收而非已完成 | REVIEW_READY→DELIVERING | 8 秒无 ACK 可重试 |
| 4 | 处理分支 | 对确认说“确认/取消”，对候选说“第 2 个” | 决策绑定当前 request；长列表可滚动并朗读序号 | NEEDS_DECISION→RUNNING/CANCELLED | 说“都不是”回到草稿 |
| 5 | 继续准备 | 上一任务运行时说“下一条”，口述后续任务 | 新草稿进入队列，只显示待执行，不触发副作用 | RUNNING + QUEUED_DRAFT | 语音编辑、排序、删除 |
| 6 | 确认真实结果 | 可关闭命令窗或看任务条 | 主窗与 Chat 续显同一 requestId/sequence；VERIFIED/REPORTED/需核对分开显示 | RUNNING→证据结论/NEEDS_USER_CHECK | 继续等待或请求取消 |
| 7 | 安全出队 | 锁释放后继续 | 并列入队时/当前上下文；无漂移才展示下一条，漂移则三选一并重新确认 | QUEUED_DRAFT→REVIEW_READY | 跳过/清空队列/结束 |
| 8 | 崩溃恢复 | 重开应用 | receipt 回放→状态查询→仅凭 NOT_DISPATCHED 重发；未知只提示核对 | RECOVERING→原结论/NEEDS_USER_CHECK | 不提供自动重试 |

## 7. 页面与交互设计
- 命令窗自上而下固定为：录音/隐私状态；当前上下文与四类能力承诺；识别草稿与“我理解为”；当前任务卡；最多 5 条下一步草稿；上一任务结果。
- 初始态显示四类边界和当前页 3–5 个任务示例；自动模式默认，命令/聊天是带一句结果差异的高级覆盖。
- 草稿区并列原识别与编辑文本；低置信片段高亮，写操作不因置信度自动执行。
- 确认卡显示动作、目标、影响和是否可撤销；澄清列表必须可滚动、支持序号语音选择、搜索和“都不是”。
- 结果卡使用固定动词：已接收、正在执行、已交给 Agent、已验证完成、Agent 报告完成、需要核对、失败、已取消、等待超时；展示对象、变化、证据来源和下一步。
- 队列卡仅保存草稿；支持“读队列、把第 2 条提前、删除第 1 条、清空队列”。任何出队执行都重新展示理解和风险。
- `NEEDS_USER_CHECK` 固定文案：“无法确认是否已执行；不会自动重发”，并给出对象级核对步骤；`CANCELLED` 被更高证据纠正时显示“结论已修订”及证据时间线。
- `CAPTURE_STOP_FAILED` 在命令窗、主窗、托盘持续红色告警，只提供“强制终止语音进程”和诊断；OS 采集句柄归零前不能开始新录音。
- 上下文漂移卡并列原/新项目、对话、页面、目标和风险；能力目录每项必须朗读路由、风险、证据与限制。
- 关闭按钮在录音中执行“停止并保留草稿”；任务执行中关闭只收起窗口，主窗口任务条继续显示状态。
- 托盘与主窗口只要在录音就显示同一红色麦克风标记，并提供“立即停止录音”。

## 8. 状态与异常矩阵
| 状态 | 触发条件 | 可见反馈 | 可执行动作 | 退出条件 | 恢复方式 |
| --- | --- | --- | --- | --- | --- |
| IDLE | 无录音/任务 | 准备就绪、当前上下文 | 开始、输入、查看能力 | 用户开始 | 无 |
| PERMISSION_BLOCKED | macOS 未授权 | 缺哪项权限、打开位置、必须手动原因 | 打开设置、重新检测、取消 | 权限通过 | 回原草稿并开始 |
| LISTENING | owner 已取得 | 全局红色录音标、partial | 停止、取消、修正 | final 或停止 | 隐藏/关闭自动停录 |
| CAPTURE_STOP_FAILED | 停录 ACK、Helper 重建或句柄校验失败 | 三处持续告警、实际句柄状态 | 强制终止、查看诊断 | OS 句柄=0 | generation+1 后释放 owner |
| REVIEW_READY | final 可用 | 系统理解、路由、风险 | 执行、编辑、取消 | 创建 request | 保留草稿 |
| RECOVERING | 应用重启发现未终态 request | 正在回放 receipt 或查询状态 | 查看详情 | 查到结果/NOT_DISPATCHED/未知 | 未知进 NEEDS_USER_CHECK |
| DELIVERING | 等主窗口 ACK | “正在提交”与倒计时 | 取消 | ACK 或 8 秒 | DELIVERY_FAILED 后重试 |
| NEEDS_DECISION | 确认/澄清 | 影响或候选、剩余时间 | 语音/点击确认、取消、都不是 | 有效响应/超时 | 超时回 REVIEW_READY |
| QUEUED_DRAFT | 已有副作用任务运行 | 队列序号、文本、未执行标记 | 编辑、排序、删除、清空 | 前项终态且上下文复核 | 漂移时重新确认 |
| RUNNING_DIRECT | executor 执行 | 目标与进度 | 取消（若支持） | receipt | 超时后继续/取消/重试 |
| RUNNING_DELEGATED | Agent 接手 | “已交给 Agent”、Chat 入口、最新进度 | 查看、取消、关闭窗 | Agent receipt | 主窗口任务条持续 |
| SUCCEEDED | VERIFIED 后置条件成立 | 具体变化、来源和可撤销性 | 撤销、继续发令 | 新任务 | receipt 进入历史 |
| NEEDS_USER_CHECK | REPORTED/UNVERIFIABLE/恢复未知 | “不会自动重发”、原因与核对步骤 | 标记符合/不符、打开目标 | 用户核对 | 锁保持，除非取得权威释放凭证 |
| FAILED | 可解释失败 | 原因、保留输入、影响范围 | 修正、重试、取消 | 新 request/退出 | 不覆盖错误直到用户处理 |
| TIMED_OUT | 超过 deadline | 尚未确认完成，不宣告失败 | 继续等待、取消、幂等重试 | 收到终态 | 迟到结果进原 request |
| CANCEL_REQUESTED | 已请求下游终止 | 是否仍可能产生结果 | 等待、返回任务 | CANCELLED/终态 | 终态按真实结果显示 |
| CANCELLED | cancellationReceipt 支持的暂定结论 | 已取消、证据与可纠正说明 | 查看时间线 | 新任务/高证据纠正 | revision 保留旧结论 |

终态仲裁：cancellationReceipt 可形成暂定 CANCELLED；后到 VERIFIED 追加 revision 并纠正同一卡。TIMED_OUT/DELIVERY_FAILED 的迟到 receipt 合并原卡；低 sequence、旧 generation 或低证据事件只记诊断。

## 9. 用户体验质量下界
- 焦点：命令窗出现不抢主窗口输入焦点；键盘 Tab 顺序覆盖草稿、决策、恢复；Escape 只关闭表面，不跳过停录规则。
- 可访问性：所有状态有文字与图标，不能只靠颜色/提示音；结果和错误使用 `aria-live`；语音与键鼠始终等价。
- 长文本与窗口：480×372 为最小尺寸但内容必须纵向滚动；候选、错误和长项目名不裁切；支持窗口尺寸记忆。
- i18n：识别 locale 默认跟随应用语言并可单独选择；控制语句、示例、状态文案统一走 i18n，中文/英文礼貌表达进入同一意图。
- 隐私：无录音时不保持麦克风；不默认保存音频；任务历史只保存文本、路由、结果和诊断码，并允许清除。
- 性能与关闭：开始录音反馈 ≤300ms；partial 可见 ≤500ms；本地 direct ACK ≤1s；关闭/隐藏后 ≤300ms 停采集并清除三处指标，Helper 无 ACK 时 ≤1s 完成重建和 owner 释放。
- 连续效率基准：一个 trial=“切项目→切对话→打开文档→打开模型设置→新建对话”完整序列，共 5 trial；从快捷键到第 5 项 VERIFIED 计时，澄清、修正、确认、等待全计入。序列成功 5/5、逐任务成功 ≥24/25、重复副作用=0、无需重唤起，语音中位时长不高于同操作者鼠标基线，并保存逐轮原始值。
- 首次理解基准：5 名符合后续确认画像的首次参与者中至少 4 名能在看首屏后解释四类路由，并对 4 个代表任务的路径预测正确率 ≥80%。
- 安全：敏感字段不进入语音快照或历史；外部应用/网页和写操作继续经过 allowlist、风险级别与后置条件。
- 故障脚本：分别在 dispatch 前、执行后 receipt 前、receipt 落盘后崩溃；重启后副作用计数只能为 0 或 1，未知/不可查询/TTL 到期绝不重发，tombstone 必须命中。
- 锁与录音脚本：DELIVERING/TIMED_OUT/CANCEL_REQUESTED/NEEDS_USER_CHECK 均不得出队；停录 ACK 与重建双失败时新 owner=0、三处持续告警，强杀后 OS 句柄=0 才恢复。
- 证据顺序脚本：分别执行 cancel→VERIFIED、VERIFIED→cancel 并重启，UI 结论、revision 和证据顺序一致；旧 generation 只记诊断。
