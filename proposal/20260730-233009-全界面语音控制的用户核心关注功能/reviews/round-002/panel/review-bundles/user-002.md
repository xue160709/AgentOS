# Participant Review Bundle

- Participant ID: user-002
- Design revision: R002
- Design SHA-256: da17fa289fca9bdebf5a2a5cd86cbffccd6cffe2c583df42238f85bc2846bc54
- Allowed Need IDs: NEED-001, NEED-002, NEED-004, NEED-005, NEED-006
- Allowed design sections: 1, 3, 4, 5, 6, 7, 8, 9
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
- 用户问题：“全界面语音控制”目前容易被理解成“所有控件都能说”，但用户真正需要的是从发令到真实结果的可信闭环。
- 根本原因：现有语义覆盖、路由成功和任务完成混用同一成功口径；录音会话、执行请求、确认/澄清与结果没有统一生命周期。
- 推荐方案：建立“语音任务控制层”，以 `VoiceSession + CommandRequest + DurableRequestLedger + ExecutionReceipt` 为核心；四类路由共用请求身份、跨重启幂等、可验证终态与取消仲裁，并让产品内确认、澄清、取消、排队和恢复可继续用语音完成。
- 用户获得的核心变化：先知道能不能做；系统复述理解；每条任务有唯一状态与证据等级；可在上一任务运行时准备下一条；关闭、失败和重试不会制造隐形录音或重复副作用。
- 明确不做：不开放任意 DOM 点击；不声称 229 个语义控件均可执行；不以语音绕过 macOS 系统授权；不增加常驻环境唤醒词；不把“已转发”显示为“已完成”。
- 当前最大风险：30 类 Agent 任务并非都能核验外部后置状态；无法验证的任务必须显示“Agent 报告完成”或“需要你核对”，不能计入已验证闭环率。

## 3. 方案原则与范围
- **任务闭环，不是控件覆盖**：能力以“用户目标 + 前置条件 + 执行者 + 后置条件”登记，语义标签只服务理解和定位。
- **一次请求，一个真相**：命令窗、主窗口与 Chat 共享 request ID、状态和结果；任何表面都不能自行宣布成功。
- **收音与执行分离**：关闭录音只影响 `VoiceSession`；已提交的 `CommandRequest` 必须显式取消或继续，不能因窗口销毁失联。
- **安全动作可对话完成**：产品内的确认、取消、澄清优先识别为控制语句，不再次进入普通业务路由。
- **手动边界诚实可见**：macOS 权限等必须点击的系统步骤显示原因、位置和完成后如何继续。
- 范围：独立语音命令窗、主窗口当前任务条、托盘录音状态、direct/agent_task/answer 路由、确认/澄清、超时/取消/重试和能力说明。
- 非目标：手机遥控、环境常听、完整 TTS 助手、任意 shell/DOM 自动化、无后置条件的新系统 action。

## 4. 产品对象与业务规则
| 对象 | 关键字段 | 生命周期/不变量 |
| --- | --- | --- |
| `VoiceSession` | sessionId、generation、ownerWindowId、captureState、locale | 同时最多一个录音 owner；隐藏/关闭先完成停录握手；事件须匹配 sessionId+generation，禁止 fallback 到 Composer |
| `UtteranceDraft` | rawPartial、finalText、editedText、confidence | 提交使用用户最后确认文本；修改后保留“原识别/已编辑”标记，不保存敏感音频 |
| `CapabilityEntry` | goal、route、risk、preconditions、examples、limitations | `DIRECT / DELEGATED / ANSWER / MANUAL_OR_UNSUPPORTED` 四类互斥；必须声明完成证据 |
| `CommandRequest` | requestId、logicalAttemptId、idempotencyKey、intent、targetRef、route、risk、state、deadline | 一次明确执行创建一个 logical attempt；ACK 丢失、超时重试和重启回放复用原身份 |
| `DurableRequestLedger` | request、dispatchState、receipt、expiresAt、sequence | 主进程 dispatch 前写入；读/导航保存 24h，写/外部/DELEGATED 保存 7 天；重启后可查询或回放原 receipt |
| `TransferEnvelope` | requestId、idempotencyKey、goal、targetRef、project/thread/page context、risk、permissionMode、locale、deadline | Agent 转交必须携带完整目标与上下文，不要求用户重述；进度事件按 sequence 单调递增 |
| `PendingDecision` | requestId、type、options、expiresAt | `CONFIRM / CLARIFY / PERMISSION_HANDOFF`；只接受绑定 request 的语音或点击响应 |
| `ExecutionReceipt` | requestId、outcome、evidenceLevel、postcondition、observedValue、source、completedAt | `VERIFIED`=系统复查后置状态；`REPORTED`=Agent 结构化报告；`UNVERIFIABLE`=无稳定证据，进入 NEEDS_USER_CHECK 而非 SUCCEEDED |
| `DraftQueue` | sessionId、drafts、maxSize=5 | 允许在上一任务运行时继续收集/编辑下一条；副作用任务同时只 dispatch 一个，出队前重新校验目标上下文 |

业务规则：
1. 全局快捷键在权限已授权时直接进入 `LISTENING`；首次或权限缺失时进入 `PERMISSION_BLOCKED`，不假装正在听。
2. `停止聆听、取消当前任务、确认、取消、选第 N 个、继续等待、重试` 是会话控制语句，优先于业务意图解析。
3. 隐藏/关闭发 `STOP_CAPTURE(sessionId,generation)`；300ms 内收到 Helper ACK 才释放 owner。超时则终止并重建 Helper 录音通道、generation+1 后释放；窗口、托盘、主窗三处指标同事务消失，final 草稿保留。
4. idempotencyKey=`hash(logicalAttemptId+normalizedIntent+stableTarget+effectArgs)`，首次执行前生成并持久化；重试返回 ledger 中原状态/receipt，不再次 dispatch。只有用户明确说“再执行一次”才创建新 logicalAttemptId，并重新走风险确认。
5. DIRECT 仅在 `VERIFIED` 后显示“已完成”；DELEGATED 先显示“已交给 Agent”，`REPORTED` 显示“Agent 报告完成”，`UNVERIFIABLE` 显示“需要你核对”；ANSWER 在回答写入当前 Chat 后完成。
6. 8 秒无 ACK 进入 `DELIVERY_FAILED`；DIRECT 默认 30 秒，DELEGATED 使用 Capability deadline。超时只改变等待状态，不创建新执行；继续等待、取消或重试均复用原 request。
7. `CANCEL_REQUESTED` 不是终态；仅下游返回 cancellationReceipt（未开始或已回滚且无副作用）才能进入 `CANCELLED`。迟到 `VERIFIED` 结果优先于取消声明，原卡改为“取消未阻止，任务已完成/失败”并提醒用户。
8. 事件必须匹配 requestId、sessionId/generation 与递增 sequence；旧请求只更新其历史卡。终态仲裁优先级：可观测 `VERIFIED` > cancellationReceipt > `REPORTED` > timeout；任何低证据事件不得覆盖高证据终态。
9. 同时只允许一个副作用 request 处于 NEEDS_DECISION/RUNNING；运行中可收集最多 5 条队列草稿。出队时若 project/thread/page/target 漂移则暂停并要求重新确认，绝不沿用旧目标。
10. 低风险 direct 可执行前复述并短暂允许口头“撤销”；中风险必须确认；不可撤销破坏性动作保持点击/语音双确认或不进入语音范围。

## 5. 信息架构
```text
全局快捷键 / 托盘
└─ 语音命令窗
   ├─ 录音与隐私状态（全局唯一）
   ├─ 当前上下文 + 能力/路由说明
   ├─ 识别草稿与系统理解
   ├─ 当前任务卡（确认/澄清/进度/结果/恢复）
   ├─ 下一步草稿队列（最多 5 条，不提前执行副作用）
   └─ 最近任务（证据等级 + 结果；进入主窗看完整记录）

主窗口
├─ 当前语音任务条（命令窗关闭后仍可控制）
├─ 当前 Chat（Agent 任务进度与回答）
└─ 设置 > 语音控制
   ├─ 权限与语言
   ├─ “我可以做什么”能力目录
   └─ 最近任务与失败诊断
```
- 命令窗负责采集、理解确认与当前任务控制，不持有业务执行真相。
- 主窗口任务条负责跨窗口连续性；Chat 负责 Agent 的详细过程，但终态同步回统一任务条。
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
| 6 | 确认真实结果 | 可关闭命令窗或看任务条 | VERIFIED/REPORTED/需核对分开显示；Agent 进度保留同一 requestId | RUNNING→终态/NEEDS_USER_CHECK | 继续等待、取消、幂等重试 |
| 7 | 安全出队 | 前一任务终态后继续 | 重新校验上下文；未漂移则展示下一条，漂移则要求确认新目标 | QUEUED_DRAFT→REVIEW_READY | 说“跳过/清空队列/结束” |

## 7. 页面与交互设计
低保真命令窗：
```text
┌ 语音控制 · 正在聆听 ●        [停止] [×]
│ 当前：项目 A / 对话列表       [能做什么]
│ 直接执行 / 交给 Agent / 回答 / 需要手动
│
│ “归档当前对话”
│ 我理解为：归档「需求讨论」
│ 直接执行 · 需要确认
│
│ 说“确认”或“取消”          [确认] [取消]
│ ─────────────────────────────
│ 当前：Agent 报告已完成（待核对）
│ 下一条：打开模型设置（未执行）
└──────────────────────────────
```
- 初始态先显示四类边界承诺，再给当前页面 3–5 个任务级示例；“能做什么”进入可全语音浏览的能力目录。
- 自动模式成为默认，不要求首次用户先选模式；命令/聊天作为显式高级覆盖，并用一句结果差异解释。
- 草稿区同时显示原识别和用户编辑后的最终文本；低置信片段高亮，但不以置信度自动执行写操作。
- 确认卡显示动作、目标、影响和是否可撤销；澄清列表必须可滚动、支持序号语音选择、搜索和“都不是”。
- 结果卡使用固定动词：已接收、正在执行、已交给 Agent、已验证完成、Agent 报告完成、需要核对、失败、已取消、等待超时；展示对象、变化、证据来源和下一步。
- 队列卡仅保存草稿；支持“读队列、把第 2 条提前、删除第 1 条、清空队列”。任何出队执行都重新展示理解和风险。
- 关闭按钮在录音中执行“停止并保留草稿”；任务执行中关闭只收起窗口，主窗口任务条继续显示状态。
- 托盘与主窗口只要在录音就显示同一红色麦克风标记，并提供“立即停止录音”。

## 8. 状态与异常矩阵
| 状态 | 触发条件 | 可见反馈 | 可执行动作 | 退出条件 | 恢复方式 |
| --- | --- | --- | --- | --- | --- |
| IDLE | 无录音/任务 | 准备就绪、当前上下文 | 开始、输入、查看能力 | 用户开始 | 无 |
| PERMISSION_BLOCKED | macOS 未授权 | 缺哪项权限、打开位置、必须手动原因 | 打开设置、重新检测、取消 | 权限通过 | 回原草稿并开始 |
| LISTENING | owner 已取得 | 全局红色录音标、partial | 停止、取消、修正 | final 或停止 | 隐藏/关闭自动停录 |
| REVIEW_READY | final 可用 | 系统理解、路由、风险 | 执行、编辑、取消 | 创建 request | 保留草稿 |
| DELIVERING | 等主窗口 ACK | “正在提交”与倒计时 | 取消 | ACK 或 8 秒 | DELIVERY_FAILED 后重试 |
| NEEDS_DECISION | 确认/澄清 | 影响或候选、剩余时间 | 语音/点击确认、取消、都不是 | 有效响应/超时 | 超时回 REVIEW_READY |
| QUEUED_DRAFT | 已有副作用任务运行 | 队列序号、文本、未执行标记 | 编辑、排序、删除、清空 | 前项终态且上下文复核 | 漂移时重新确认 |
| RUNNING_DIRECT | executor 执行 | 目标与进度 | 取消（若支持） | receipt | 超时后继续/取消/重试 |
| RUNNING_DELEGATED | Agent 接手 | “已交给 Agent”、Chat 入口、最新进度 | 查看、取消、关闭窗 | Agent receipt | 主窗口任务条持续 |
| SUCCEEDED | VERIFIED 后置条件成立 | 具体变化、来源和可撤销性 | 撤销、继续发令 | 新任务 | receipt 进入历史 |
| NEEDS_USER_CHECK | REPORTED/UNVERIFIABLE | Agent 报告、无法核验原因、核对步骤 | 标记符合/不符、打开目标 | 用户核对 | 不计入已验证闭环率 |
| FAILED | 可解释失败 | 原因、保留输入、影响范围 | 修正、重试、取消 | 新 request/退出 | 不覆盖错误直到用户处理 |
| TIMED_OUT | 超过 deadline | 尚未确认完成，不宣告失败 | 继续等待、取消、幂等重试 | 收到终态 | 迟到结果进原 request |
| CANCEL_REQUESTED | 已请求下游终止 | 是否仍可能产生结果 | 等待、返回任务 | CANCELLED/终态 | 终态按真实结果显示 |
| CANCELLED | 确认无后续副作用 | 已取消、未完成的影响 | 重试、继续 | 新任务 | 新 requestId |

终态仲裁：
| 当前事实 | 后到事件 | 结果 |
| --- | --- | --- |
| CANCEL_REQUESTED | cancellationReceipt | CANCELLED |
| CANCEL_REQUESTED/CANCELLED | VERIFIED success/failure | 改为真实终态并提示“取消未阻止/状态已纠正” |
| TIMED_OUT/DELIVERY_FAILED | 原 request receipt | 合并原卡，不创建新副作用 |
| 任意终态 | 低 sequence 或旧 generation | 只记诊断，不改 UI |
| SUCCEEDED(VERIFIED) | REPORTED/timeout | 忽略低证据事件 |

## 9. 用户体验质量下界
- 焦点：命令窗出现不抢主窗口输入焦点；键盘 Tab 顺序覆盖草稿、决策、恢复；Escape 只关闭表面，不跳过停录规则。
- 可访问性：所有状态有文字与图标，不能只靠颜色/提示音；结果和错误使用 `aria-live`；语音与键鼠始终等价。
- 长文本与窗口：480×372 为最小尺寸但内容必须纵向滚动；候选、错误和长项目名不裁切；支持窗口尺寸记忆。
- i18n：识别 locale 默认跟随应用语言并可单独选择；控制语句、示例、状态文案统一走 i18n，中文/英文礼貌表达进入同一意图。
- 隐私：无录音时不保持麦克风；不默认保存音频；任务历史只保存文本、路由、结果和诊断码，并允许清除。
- 性能与关闭：开始录音反馈 ≤300ms；partial 可见 ≤500ms；本地 direct ACK ≤1s；关闭/隐藏后 ≤300ms 停采集并清除三处指标，Helper 无 ACK 时 ≤1s 完成重建和 owner 释放。
- 连续效率基准：在具备至少 2 个项目、3 个对话的 fixture 上执行“切项目→切对话→打开文档→打开模型设置→新建对话”五任务序列，连续 5 轮成功率 ≥95%、重复副作用为 0、无需重唤起，语音序列中位总时长不高于同一熟练操作者鼠标序列。
- 首次理解基准：5 名符合后续确认画像的首次参与者中至少 4 名能在看首屏后解释四类路由，并对 4 个代表任务的路径预测正确率 ≥80%。
- 安全：敏感字段不进入语音快照或历史；外部应用/网页和写操作继续经过 allowlist、风险级别与后置条件。
