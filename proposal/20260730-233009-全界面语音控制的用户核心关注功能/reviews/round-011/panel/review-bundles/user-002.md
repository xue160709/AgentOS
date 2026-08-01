# Participant Review Bundle

- Participant ID: user-002
- Design revision: R011
- Design SHA-256: c7022033624daf57aae7a8e378b16086e57dcbcc3eda80e3f5b3def52afa80b3
- Allowed Need IDs: NEED-001, NEED-002, NEED-004, NEED-005, NEED-006
- Allowed design sections: 1, 3, 4, 6, 7, 8, 9
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
- 用户问题：用户要的是从发令到真实结果的可信闭环，不是“所有语义控件都能说”。
- 根本原因：语义覆盖、路由成功与任务完成混用；录音、请求、决策和结果缺统一生命周期。
- 推荐方案：以 `VoiceSession + CommandRequest + Ledger/Tombstone + ExecutionReceipt` 统一四类路由、跨重启幂等、终态证据、取消仲裁和连续草稿。
- 核心变化：先说明能否做，复述理解，每条任务有唯一身份、状态和证据；关闭、重试不再造成隐形录音或重复副作用。
- 明确不做：任意 DOM 点击、绕过系统授权、常驻唤醒词，以及把语义/转发冒充完成。
- 最大风险：无法核验外部后置状态的 Agent 任务只能显示“系统未核验/需要核对”，不计入已验证闭环率。

## 3. 方案原则与范围
- 原则：以可验证任务而非控件数量衡量；请求单一真相；收音与执行分离；产品内决策可语音完成，系统手动边界如实显示。
- 能力须登记目标、前置条件、执行者和后置条件；命令窗、主窗与 Chat 共用 request ID。范围覆盖四类路由及确认、澄清、超时、取消、重试；不含手机遥控、环境常听、完整 TTS、任意 shell/DOM 或无后置条件 action。

## 4. 产品对象与业务规则
| 对象 | 关键字段 | 生命周期/不变量 |
| --- | --- | --- |
| `VoiceSession` | sessionId、generation、ownerWindowId、captureState、locale | 同时最多一个录音 owner；隐藏/关闭先完成停录握手；事件须匹配 sessionId+generation，禁止 fallback 到 Composer |
| `UtteranceDraft` | rawPartial、finalText、editedText、confidence | 提交使用用户最后确认文本；修改后保留“原识别/已编辑”标记，不保存敏感音频 |
| `CapabilityEntry` | goal、route、risk、preconditions、examples、limitations | `DIRECT / DELEGATED / ANSWER / MANUAL_OR_UNSUPPORTED` 四类互斥；必须声明完成证据 |
| `CommandRequest` | requestId、logicalAttemptId、idempotencyKey、dispatchProof、intent、targetRef、route、risk、state、deadline | 一次明确执行创建一个 logical attempt；ACK 丢失、超时重试和重启恢复复用原身份 |
| `DurableRequestLedger` | request、dispatchState、receipt、expiresAt、sequence | 主进程 dispatch 前写入；重启后先回放 receipt 或查询执行状态，不把恢复等同重新执行 |
| `SideEffectTombstone` | requestId、idempotencyKey、effectHash、lastKnownOutcome、dedupeUntil | receipt 可过期，副作用 tombstone 不早于执行端去重期删除；过期未知仍禁止自动重发 |
| `EffectScope` | kind、stableId、ancestorIds、effectClass | 重叠=同 stableId、任一 stableId 在另一 ancestorIds，或任一 effectClass=GLOBAL；隔离仅放行不重叠 scope |
| `TransferEnvelope` | request/key、goal/target/context、risk/permission、deadline | Agent 转交不要求重述；进度按 sequence 单调递增 |
| `ExecutionReceipt` | requestId、outcome、evidenceLevel、postcondition、observedValue、source、completedAt | `VERIFIED`=系统复查后置状态；`REPORTED`=Agent 结构化报告；`UNVERIFIABLE`=无稳定证据，进入 NEEDS_USER_CHECK 而非 SUCCEEDED |
| `ReconciliationRecord` | requestId、effectScope、outcome、authority、evidenceId、sequence、checkedAt | `EXECUTED / NOT_EXECUTED / UNKNOWN`；只有执行端权威记录可释放重叠 scope，用户观察只作注记 |

业务规则：
1. 快捷键在已授权时进入 `LISTENING`，否则 `PERMISSION_BLOCKED`；停止、取消、确认、选第 N 个、等待、重试等控制语句优先于业务路由。
3. 隐藏/关闭发 `STOP_CAPTURE(sessionId,generation)`；300ms 内收到 Helper ACK 才释放 owner。超时则重建 Helper；重建或 OS 采集句柄关闭校验仍失败时进入 `CAPTURE_STOP_FAILED`，保留 owner 占位并阻止新 owner。强杀 Helper 且 OS 句柄=0 后才 generation+1、释放 owner；旧 generation 只记诊断。
4. idempotencyKey=`hash(logicalAttemptId+intent+stableTarget+effectArgs)`，执行前持久化；重试只返回原状态/receipt。“再执行一次”才新建 attempt 并重走确认。
5. DIRECT 仅在 `VERIFIED` 后显示“已完成”；DELEGATED 先显示“已交给 Agent”，`REPORTED` 显示“Agent 报告完成”，`UNVERIFIABLE` 显示“需要你核对”；ANSWER 在回答写入当前 Chat 后完成。
6. 8 秒无 ACK 进入 `DELIVERY_FAILED`；DIRECT 默认 30 秒，DELEGATED 使用 Capability deadline。超时只改变等待状态，不创建新执行；继续等待、取消或重试均复用原 request。
7. 恢复分三路：有 receipt 只回放；无 receipt 用原 request/key 查询；仅有权威 `NOT_DISPATCHED` 证明才可用原身份重发。证明必须来自执行端原子记录，含 request/key、effectAttemptCount=0、单调 sequence、observedAt，且仍在去重期；陈旧、用户口述或 renderer 状态无效。
8. Reconciliation 与取消只按 §8 状态迁移表执行；UNKNOWN tombstone 在权威 reconciliation 前不得 GC。用户隔离未知队列不改变结论或锁，只允许不重叠 scope 新建队列。
9. 事件必须匹配 requestId、sessionId/generation 与递增 sequence；旧请求只更新历史卡。证据优先级：VERIFIED > cancellationReceipt > REPORTED > timeout。
10. request 创建即锁定 EffectScope；仅 §8 标明“释放”的迁移可解锁。
11. 出队/确认后 dispatch 前，主进程以 stableId 原子重解析 target 与 permission；改名显示新旧标签并重确认，删除/失权禁止 dispatch，只能重选或跳过。
12. 低风险 direct 执行前复述并允许口头撤销；中风险必须确认；不可撤销破坏性动作双确认或不进入语音范围。

## 6. 用户旅程
| 步骤 | 用户目标 | 用户动作 | 系统反馈 | 状态变化 | 退出/恢复 |
| --- | --- | --- | --- | --- | --- |
| 1 | 开始说话 | 按 Option+Space | 权限正常则提示音+红色录音标；缺权限则显示系统步骤 | IDLE→LISTENING 或 PERMISSION_BLOCKED | 说“停止”或再次按快捷键 |
| 2 | 确认听对 | 自然说任务，停顿或说“就这样” | 实时文本；结束后显示“我理解为…”、目标、路由和风险 | LISTENING→REVIEW_READY | 口头修正、键盘编辑或取消 |
| 3 | 提交任务 | 说“执行”或按提交 | 生成 requestId，显示已接收而非已完成 | REVIEW_READY→DELIVERING | 8 秒无 ACK 可重试 |
| 4 | 处理分支 | 对确认说“确认/取消”，对候选说“第 2 个” | 决策绑定当前 request；长列表可滚动并朗读序号 | NEEDS_DECISION→RUNNING/CANCELLED | 说“都不是”回到草稿 |
| 5 | 继续准备 | 上一任务运行时说“下一条”，口述后续任务 | 新草稿进入队列，只显示待执行，不触发副作用 | RUNNING + QUEUED_DRAFT | 语音编辑、排序、删除 |
| 6 | 确认真实结果 | 可关闭命令窗或看任务条 | 主窗与 Chat 续显同一 requestId/sequence；VERIFIED/REPORTED/需核对分开显示 | RUNNING→证据结论/NEEDS_USER_CHECK | 继续等待或请求取消 |
| 7 | 安全出队 | scope 锁释放后继续 | 并列原/新上下文；改名重确认，删除/失权只可重选或跳过 | QUEUED_DRAFT→REVIEW_READY | 副作用始终为 0 |
| 8 | 崩溃恢复 | 重开应用 | receipt 回放→状态查询→权威 NOT_DISPATCHED 后重发 | RECOVERING→结果/NEEDS_USER_CHECK | 未知可隔离队列，绝不重发 |

## 7. 页面与交互设计
- 命令窗顺序：录音/隐私、上下文与四类承诺、原识别/编辑稿及“我理解为”、当前任务、5 条草稿、上一结果；自动路由默认，写操作不因高置信度自动执行。
- 确认卡显示动作、目标、影响、可撤销性；澄清列表可滚动、搜索、语音选序号或“都不是”。队列仅存草稿，可朗读/排序/删除/清空，出队重审理解与风险。
- 结果固定区分：已接收、执行中、已交给 Agent、已验证完成、`Agent 报告已完成；系统未核验`、需要核对、失败、暂定已取消、超时；REPORTED 不进 SUCCEEDED。
- `NEEDS_USER_CHECK` 显示“无法确认是否已执行；不会自动重发”及对象级核对步骤。用户注记不替代 reconciliation；结束队列只隔离未知 scope，不宣告结果，非重叠任务可继续。更高证据到达时显示结论修订时间线。
- `CAPTURE_STOP_FAILED` 在三处持续红色告警；句柄归零前仅可强杀语音进程或看诊断，不能新录音。录音中关窗先停录并留草稿，执行中关窗只收起。
- 上下文漂移卡并列新旧项目、对话、页面、目标、风险；目录项可朗读路由、风险、证据和限制。

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
| NEEDS_USER_CHECK | REPORTED/UNVERIFIABLE/恢复未知 | “不会自动重发”、核对与隔离说明 | 注记、隔离队列、打开目标 | 权威 reconciliation | 重叠 scope 保持锁，非重叠可继续 |
| FAILED | 可解释失败 | 原因、保留输入、影响范围 | 修正、重试、取消 | 新 request/退出 | 不覆盖错误直到用户处理 |
| TIMED_OUT | 超过 deadline | 尚未确认完成，不宣告失败 | 继续等待、取消、幂等重试 | 收到终态 | 迟到结果进原 request |
| CANCEL_REQUESTED | 已请求下游终止 | 是否仍可能产生结果 | 等待、返回任务 | CANCELLED/终态 | 终态按真实结果显示 |
| CANCELLED | cancellationReceipt 支持的暂定结论 | 已取消、证据与可纠正说明 | 查看时间线 | 新任务/高证据纠正 | revision 保留旧结论 |

终态仲裁：CANCELLED 后到 VERIFIED 纠正真实结论；后到 REPORTED/UNVERIFIABLE 转 NEEDS_USER_CHECK；均追加 revision。TIMED_OUT/DELIVERY_FAILED 的 receipt 合并原卡；低 sequence 或旧 generation 只记诊断。

| 当前状态 + 权威事件 | 新状态 | 副作用/锁 |
| --- | --- | --- |
| PREPARED + 新鲜原子 NOT_DISPATCHED | DELIVERING（原 request，最多一次） | 可 dispatch，锁保持 |
| 任意非终态 + NOT_EXECUTED | TERMINAL_NOT_EXECUTED | 禁重发，释放 scope |
| 非终态 + UNKNOWN/不可查询/TTL 到期 | NEEDS_USER_CHECK | 禁重发；tombstone 永不 GC，scope 隔离并保持锁 |
| CANCELLED + VERIFIED | VERIFIED 真实终态 + revision | 按真实终态释放 |
| CANCELLED + REPORTED/UNVERIFIABLE | NEEDS_USER_CHECK + revision | 保持锁，不自动重发 |
| REPORTED/UNVERIFIABLE + VERIFIED | VERIFIED 真实终态 + revision | 释放 scope |

## 9. 用户体验质量下界
- 焦点：命令窗出现不抢主窗口输入焦点；键盘 Tab 顺序覆盖草稿、决策、恢复；Escape 只关闭表面，不跳过停录规则。
- 可访问性：所有状态有文字与图标，不能只靠颜色/提示音；结果和错误使用 `aria-live`；语音与键鼠始终等价。
- 长文本与窗口：480×372 为最小尺寸但内容必须纵向滚动；候选、错误和长项目名不裁切；支持窗口尺寸记忆。
- i18n：识别 locale 默认跟随应用语言并可单独选择；控制语句、示例、状态文案统一走 i18n，中文/英文礼貌表达进入同一意图。
- 隐私：无录音时不保持麦克风；不默认保存音频；任务历史只保存文本、路由、结果和诊断码，并允许清除。
- 性能与关闭：开始录音反馈 ≤300ms；partial ≤500ms；direct ACK ≤1s。关闭后 300ms 无 ACK 即重建；到 1s 时只有 OS 句柄=0 才释放 owner，否则 CAPTURE_STOP_FAILED，句柄非零绝不释放。
- 连续效率基准：一个 trial=五任务序列；五项全在 60s 内 VERIFIED 才成功，失败记 60s。共 5 trial，要求 5/5 成功即 25/25、重复副作用=0；保存五个总时长，升序第 3 个为中位数，须不高于同操作者鼠标基线。
- 首次理解基准：5 名符合后续确认画像的首次参与者中至少 4 名能在看首屏后解释四类路由，并对 4 个代表任务的路径预测正确率 ≥80%。
- 安全：敏感字段不进入语音快照或历史；外部应用/网页和写操作继续经过 allowlist、风险级别与后置条件。
- 故障脚本：分别在 dispatch 前、执行后 receipt 前、receipt 落盘后崩溃；重启后副作用计数只能为 0 或 1，未知/不可查询/TTL 到期绝不重发，tombstone 必须命中。
- 锁与录音脚本：DELIVERING/TIMED_OUT/CANCEL_REQUESTED/NEEDS_USER_CHECK 均不得出队；停录 ACK 与重建双失败时新 owner=0、三处持续告警，强杀后 OS 句柄=0 才恢复。
- 证据顺序脚本：分别执行 cancel→VERIFIED、VERIFIED→cancel 并重启，UI 结论、revision 和证据顺序一致；旧 generation 只记诊断。
- Scope/目标脚本：同 stableId、父子 ancestor、不相交、GLOBAL 四组；UNKNOWN 隔离后只放行不相交项。确认后到 dispatch 前注入改名/删除/失权，只有改名可重确认，其他 effect count=0。
- Agent 续显脚本：Agent 进度 sequence=2 时关窗并重启；主窗与 Chat 保持 requestId、目标、上下文、deadline，sequence 不倒退且 dispatch count=1；三种 evidence 对应固定文案。
