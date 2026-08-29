---
change_id: chg-20260818-agent-command-channel
revision: 2
decision: accepted
delivery: in_progress
owner: main_agent
confirmation_source: explicit_user_statement
confirmed_scope: "2026-08-26：独立项目 Chat 窗口、网站与项目一对一绑定、授权网站可直接新建会话、agentos deep link + HTTPS 一次性 ticket、沿用当前权限；2026-08-27：静态项目只在修改期间自动进入实时预览，修改任务结束后自动生成已保存预览，日常界面隐藏开发模式与重启；同一项目允许多个 Agent 会话并行修改；后续修订为 v1 不实现写入协调机制；2026-08-27 用户要求基于事实统一并产出可交付 Terra 的 spec/TODO，Decision Brief 与三个建议默认选择据此转为 accepted"
---

# Agent 指令通道与独立项目 Chat 窗口

## Revision 2：从应用内通道扩展到网站入口

### 原因

当前全局 Agent 指令通道只能由应用内部模块调用。用户还需要从 AgentOS 内嵌页面或普通系统浏览器里的项目网页发起修改任务，并在一个独立原生窗口中继续与该项目的 Claude Agent SDK 对话。同时，预览运行时应把“开发中实时预览”和“完成后静态预览”呈现为自然状态，避免用户理解“静态预览、就绪、重新构建”等内部概念。

### 用户已确认的产品边界

- Agent 运行能力使用 Claude Agent SDK。
- “打开独立的对话页面”是新建一个原生窗口承载现有完整 Chatbot；每个项目最多一个 Chat 窗口，窗口内的会话与主窗口该项目下的会话属于同一事实源。
- 来源同时包括 AgentOS 内嵌页面与普通系统浏览器页面。
- 网站先发起配对，AgentOS 由用户确认；一个网站只绑定一个本地项目。
- 已授权网站可直接发起任务；每次外部任务都创建一个新的普通会话，之后可在 AgentOS 中继续修改。
- 协议不携带、不选择也不提升权限；v1 沿用当前应用级权限选择，由 Main 持久化并在任务提交时捕获。
- 第一版使用 `agentos://` 负责配对或唤醒，HTTPS 一次性 ticket 负责承载任务；自定义协议 URL 不承载 prompt、项目路径、session、凭据或权限。

### Decision Brief（已确认）

以下 Decision Brief 已在 2026-08-27 用户要求“基于事实统一并产出 spec 和 TODO”后冻结。正式产品、技术、协议、验收和执行任务分别见 `design.md`、`technical.md`、`protocol-v1.md`、`acceptance.md` 与 `work-orders/`；业务代码仍未实现。

#### 1. 产品对象与唯一事实源

- 唯一新增的持久产品对象是 `Website Binding`：记录可验证的网站来源、绑定项目、状态、建立时间和用于 HTTPS 交换的绑定凭据；不记录权限。
- `Task Ticket` 是短期、一次性凭证，消费后至多创建一个普通项目会话；有界幂等记录只防重复，不形成第二套任务历史。
- `Project Chat Window` 只是现有项目会话的另一种视图，不拥有独立 transcript、SDK、session 或持久化。
- Main-owned Chat broker 成为项目 thread、transcript、Chat Run、sessionId、diff 与 revision 的唯一写入入口；主窗口和独立窗口都是 typed IPC client，不能用各自旧快照覆盖事实源。

#### 2. 网站配对与任务协议

```text
网站点击连接/修改
  -> agentos:// 唤醒 AgentOS
  -> AgentOS 从该网站固定的 HTTPS well-known endpoint 获取配对或任务
  -> 校验网站绑定、过期、一次性与幂等
  -> 创建一个新的普通项目会话
  -> 打开或通知该项目的独立 Chat 窗口
```

- 网站自己的 HTTPS 后端保存配对/任务 envelope；AgentOS 不接受 deep link 传入任意 issuer URL，只能从规范化 HTTPS origin 推导固定 well-known endpoint。
- `agentos://` 只携带协议版本、动作、规范化 HTTPS origin 与不透明 request ID；不携带 prompt、项目、路径、thread/session、长期凭据或权限。
- 首次配对时 AgentOS 展示网站来源和目标项目，用户确认后建立一对一绑定；重复配对幂等，绑定冲突必须先撤销旧绑定。
- 后续任务由 binding 解析项目。ticket body 只包含版本、任务文本/标题、幂等键、签发与过期时间；网站不能指定项目、已有会话或权限。
- 普通浏览器依赖精确 HTTPS origin 与绑定凭据；AgentOS Preview 由 Main 捕获 `agentos://` 导航并附加 `webContents/runtime/generation` 来源上下文，不注入通用 preload 或 IPC。
- v1 网站只得到 `accepted/rejected` 回执；`accepted` 表示 AgentOS 已接收并创建/启动会话，不代表 Agent 最终成功。运行过程、权限、transcript、diff 与最终结果留在 AgentOS。

#### 3. 独立 Chat 窗口

- 一个项目最多一个窗口；重复打开只聚焦已有窗口。窗口固定项目，只显示该项目会话，不提供项目切换。
- 复用现有完整 Chatbot、权限弹窗、Agent 提问、transcript、diff、Composer 和 Chat Run。
- 主窗口与独立窗口共享会话和运行事实；各自保留当前选择的会话、Composer 草稿、焦点和窗口尺寸。
- 外部任务永远创建新会话。当前窗口无草稿且空闲时可切到新会话；存在草稿、权限/提问或运行中会话时不得抢焦点，只显示“新任务”徽标。
- 同一 thread 同时只有一个活跃 run；另一窗口显示“该会话正在运行”并禁止重复提交。事件按 `projectId/threadId/requestId/sequence/routeGeneration` 隔离，终态不被迟到事件覆盖。
- 关闭窗口只关闭视图和订阅，不取消任务、不删除会话或草稿；重新打开后恢复会话与运行状态。只有显式“取消”才终止任务。

#### 4. 面向用户的预览体验

- 对用户只使用“实时预览 / 已保存预览 / 更新预览”，不暴露 dev server、static preview、ready、build、out 或端口。
- 首次导入显示“正在准备首次预览”并自动完成；`刷新页面`只重载当前页面，`更新预览`才生成最新已保存页面。
- Agent 开始修改时，Chat 请求 Runtime 进入实时预览；Runtime 唯一负责 `npm run dev`、端口、进程、readiness 和复用。
- Agent 成功后自动请求 Runtime 收口：有静态声明则执行一次静态构建并切换新产物；不支持静态导出的项目继续使用实时预览。
- Agent 失败或取消不触发静态构建。Agent 成功但构建失败时显示“修改完成，但预览未更新”，保留 last-good 并提供“重试更新预览”；不能把预览失败改写成 Agent 任务失败。
- 独立 Chat 窗口只提供紧凑预览状态和“查看预览”入口；Preview、日志、进程控制与恢复动作仍在主窗口 Runtime。

#### 4A. 实时预览与同项目并发状态合同（已确认原则）

##### 用户入口与页面职责

- Workspace Tab 与项目首页 Runtime 使用同一个状态组件、相同文案与按钮顺序；两者共享一个项目 RuntimeInstance，但各自保留 PreviewSession、可见性、导航和焦点。
- 日常顶部只显示项目、状态、`打开对话`、`刷新页面` 和当前状态需要的主操作。`开始实时预览`、`结束实时预览`、`查看日志`进入“更多”；“开发模式”“重启”“npm run dev”“build”“ready”不面向普通用户。
- 已保存且最新显示“预览已更新”；普通外部源码变化显示“页面可能不是最新”与“更新预览”；首次导入自动显示“正在准备首次预览”，不要求点击构建。
- 修改期间显示“正在修改项目 · 实时预览中”；等待权限或回答显示“等待你的确认”；全部成功收口时显示“修改完成，正在保存最新预览”。
- 隐藏任一 host 不停止 Runtime、不抢焦点；重新显示直接消费最新 Main snapshot，只宣布当前状态，不回放过期过程或重新启动项目。

##### 进入实时预览

- 网站修改任务完成 ticket 验证和会话创建后先登记 potential run，直到 Agent 即将执行可靠的文件修改时才 acquire edit lease；纯解释、搜索、查看文件不启动 dev。
- 普通 Chat 同样在第一次可靠写入前进入编辑周期，不因打开窗口或提交普通问题启动 dev。
- 用户可从“更多”手动选择“开始实时预览”；这只用于查看/调试，不自动生成已保存预览。普通外部文件变化继续遵守 Runtime Rev5 的 stale + 手动“更新预览”。
- 关闭 Chat 窗口不释放 Agent edit lease；`结束实时预览`只释放手动 lease，不取消 Agent 任务或停止仍被 Agent 使用的 Runtime。

##### Main-owned EditSession

- 每个项目最多一个内存态 `EditSession(editGeneration)`，聚合 website run、普通 Chat run 和 manual live-preview lease；它不持久化，不构成第二套任务历史或 Runtime 状态机。
- `RuntimeEditCoordinator` 唯一管理 lease、静默收口、恢复和自动构建意图；Renderer 只消费 snapshot，不能直接决定自动 build/restart。
- 两个 host 共享 RuntimeInstance；模式或 generation 变化时各自重绑 PreviewSession。关闭一个 host 不影响另一个，最后 consumer 与最后 edit lease 均释放后才停止临时 dev 进程。

##### HMR、刷新与恢复

- 普通源码、页面和 CSS 变化默认交给项目 HMR，Main 不因每次文件变化刷新或重启。
- 进程和 loopback 健康但页面未同步时，对各 PreviewSession 合并执行一次 soft reload，不重启进程。
- 只有进程退出、连续 health probe 失败，或 lockfile/package/受控运行声明等可靠信号要求重新准备时，才合并为一次 hard recovery；连续原因共用一个 operationId。
- 文件扩展名、目录或 prompt 不能单独证明 HMR/restart/build 需求，不据此自动构建；不实现文件变化归因，不区分 Agent 写入与外部编辑。
- 用户显式停止设置 `manualStopFence`，阻止 watcher、health failure 或迟到事件自动拉起；恢复必须由用户明确触发。app quit 取消 timer、watcher、restart、prepare 和 build，并有界回收进程。

##### Final settle

- 自动收口只适用于 Agent-owned edit session，前置条件固定为三条：本轮至少发生过一次可靠 Agent mutation；该项目下全部 write-capable run 已 terminal；文件指纹经过短静默期保持稳定。不再叠加归因、冲突或 pending recovery 判定。
- 每个 editGeneration 最多一个 settleOperationId 和一个 build operationId。settle/build 期间有新 run 或新 Agent mutation 时，提升 editGeneration，使旧结果失效；旧构建不得替换 last-good pointer。
- 静态项目有 dev script 时，编辑期临时运行 dev；成功构建后原子切换到新静态 artifact，再停止不再需要的 dev。构建期间 last-good 不被删除。
- Development-only 项目继续使用一个受管 dev Runtime，不执行静态 build；合法 static-only 但无 dev script 的项目修改期间明确“实时预览不可用”，成功后仍可固定 build；无 dev 也无静态声明者不猜命令、不 spawn。
- Agent 失败或取消且已产生修改时，不自动 build，显示“存在未完成修改，预览未更新”，保留 Diff、源码与 last-good，提供继续修改、撤销或手动更新。无写入的失败/取消不污染下一次成功收口。
- Agent 成功但实时预览或静态 build 失败时，Agent 结果保持成功，Runtime 单独显示“修改完成，但预览未更新”与恢复动作。

##### 同项目多个会话（用户已选择 B）

- 同一项目的多个 Claude Agent SDK 会话可同时运行和修改，跨项目也可并行；同一 thread 仍只允许一个活跃 run。Runtime 不新增持久“项目任务”对象，只从现有会话聚合“正在修改 / 等待确认 / 正在保存最新预览”。
- 所有会话共享同一份项目源码、一个 RuntimeInstance 和一个 editGeneration，不创建 per-run worktree 或第二份项目事实。两个 Preview Host 展示共享工作区的合并现状，不提供“每个会话一份预览”。
- 项目级状态显示“正在修改项目 · N 个会话”；每个会话保留自己的运行、等待或失败状态。强制只读且没有写入能力的会话不计入收口阻塞；仍保有写入能力的活跃 run 在终态前视为相关 run。
- v1 不实现写入协调。同一文件同一处的竞争由 Agent SDK `Edit` 的精确匹配失败自然暴露，并由该 Agent 自行重读重试；`Write` 全量覆盖可能造成的丢失由项目自身版本控制兜底。撤销理由与重新启用条件见 `evidence.md` 的“撤销并发写入安全合同（2026-08-27）”。

##### 并行预览与最终收口

- 一个项目只运行一个 dev Runtime；HMR 消费共享工作区的最新落盘结果。两个 Host 各自 soft reload，一个 PreviewSession 加载失败不改写另一个 Host 或 Agent 的结果；Runtime 崩溃时只恢复一次共享进程。
- 任一相关修改会话仍在运行或等待用户输入时不得显示“预览已更新”。预览只表达共享源码当前状态，不能承诺某个会话的隔离结果。
- 自动收口的前置条件与 `Final settle` 一致，只有三条：该项目下所有 write-capable run 已终态；本轮至少发生过一次可靠 Agent mutation；源码指纹经过静默期保持稳定。不得再叠加其它前置条件。
- 失败或取消但没有产生写入的 run 不阻塞其它成功修改收口；失败或取消且已产生写入的 run 继续遵守“不自动生成已保存预览”。
- 每个 editGeneration 最多构建一次共享工作区的最终结果。settle/build 期间出现新的可能写入 run 时立即提升 generation，旧操作不得切换 last-good；只有最新 generation 成功原子切换后，两个 Host 才显示“预览已更新”。
- 用户可见异常文案固定为“存在未完成修改，预览未更新”；恢复入口放在项目状态和对应会话中，普通用户不需要判断该刷新、重启还是重新构建。

##### 状态与无障碍

- 阶段变化使用 `role=status` / `aria-live=polite`，不逐 token 播报；收口期间设置 `aria-busy=true`。
- 失败使用 `role=alert` 并始终提供恢复动作；状态含义不依赖颜色。
- “更多”具备 `aria-expanded` / `aria-controls`，Escape 关闭并把焦点还给触发按钮；权限/提问只允许一个窗口持有交互焦点，另一窗口提示“请在另一窗口处理”。
- Header、Preview、Toast 与 Sidebar 必须消费同一 Main snapshot，不得分别解释状态。

##### 与 Runtime Revision 5 的兼容边界

Runtime Rev5 的“普通后续源码变化 stale + 手动更新”继续成立。本变更只增加窄例外：能证明属于成功 Agent edit session 的变化在安全收口后自动 build 一次。外部编辑、未归属变化、Agent 失败或取消仍不自动构建。

#### 5. 失败、恢复与安全语义

- 未绑定、配对拒绝、ticket 过期/已使用、来源不符、项目丢失或绑定撤销时都不创建会话，也不尝试其它项目。
- HTTPS 暂时不可用且 ticket 尚未消费时可安全重试；SDK 已启动但回执失败时，通过幂等键返回原 `commandId/threadId`，不能创建第二个会话。
- thread 必须先持久化再提交 SDK；创建后提交失败则保留可见失败会话。app 重启不承诺恢复 live run，但已持久化 thread/session 可继续。
- 协议不能回答权限请求或 Agent 提问。任务在线性化提交点读取 Main 当前应用级权限模式，本次 run 固定使用该模式。
- Preview 保持 sandbox、无 Node/Electron bridge；新增的只是 Main 对特定 `agentos://` 导航的窄捕获与来源校验。
- IPC 校验 sender、frame URL、窗口登记、项目能力与 generation；日志不记录 prompt、路径、绑定凭据或 ticket body。

#### 6. 最小交付顺序

1. `M0`：Main-owned Chat broker、单 writer、独立 ChatWindow、共享 snapshot/event fence。
2. `M1`：Website Binding、`agentos://` cold/warm deep-link、网站 HTTPS ticket 与接受/拒绝回执。
3. `M1a`：AgentOS Preview 的窄 deep-link 捕获与 runtime generation 校验。
4. `M2`：Chat Run 成功后调用 Runtime settle，自动更新静态预览并保留 last-good 失败回退。

`agentos-ui://` 页面协议、网站运行进度/结果回调、远程/跨设备 Agent、本地 HTTPS 服务与 Chat 窗口内嵌 Preview 均延后，除非以后出现明确需求。

#### 7. 建议冻结的默认选择

1. Agent 成功后自动更新已保存预览；预览结果与 Agent 结果分开显示。
2. v1 网站只接收 `accepted/rejected`，不接收运行过程或最终结果。
3. 关闭独立 Chat 窗口后任务继续；外部新任务不打断当前草稿、权限请求或运行中会话。

这三项已作为 Revision 2 的冻结默认合同。

### 非目标与硬边界

- 第一版不建立本地 HTTPS 服务。
- 不允许网站枚举、动态选择或全局访问全部本地项目。
- 不在 deep link 中放置 prompt、项目路径、session、凭据或权限。
- 不允许协议覆盖或提升用户已选权限。
- 不建立第二套会话、transcript、Agent SDK、任务历史数据库或 Chatbot。
- 不在指令通道内拼接业务 prompt；调用方提交完整任务内容。
- 同项目多会话并行不做写入协调：不实现 `MutationCoordinator`、path lock、写入内容版本校验、写后一致性校验、文件变化归因或冲突重放。同文件冲突由 Agent SDK `Edit` 匹配失败自然暴露并由该 Agent 重试；`Write` 全量覆盖的丢失风险由项目自身版本控制兜底。若将来出现真实的丢改动案例，再单独评估，不在本轮扩张状态机。

### 与本地预览 Runtime 的边界

`chg-20260825-local-app-tabs-runtime@5` 负责信任后的自动首次静态构建、过期后的手动重建、last-good 静态结果和预览状态呈现。本变更只定义 Chat 任务如何绑定项目、启动开发预览并在完成时请求 Runtime 收口，不复制构建状态机或静态产物管理。

### 交付顺序

1. 先冻结产品对象、授权边界和成功/失败语义。
2. 再设计独立窗口、配对和外部任务的完整状态流。
3. 再确定主进程 broker、deep link、HTTPS ticket、跨窗口会话与 Runtime 的技术契约。
4. Decision Brief 已确认，PRD、Acceptance、TODO 与 Terra work orders 已同步；M0→M1/M2 与 M3-01 已实现并默认开启。
5. 剩余工作固定为 `FIX-WS-01 -> FIX-CHAT-01 -> CHECK-02`。

## Revision 2 范围复核（2026-08-29，`BUG-AUDIT-WS-02`）

按用户要求对已交付范围做一次过度设计复核。结论分三类，**本轮只执行"记录"与"修正"，不擅自删除已交付能力**。

### 1. 判定为不过度，明确不砍

| 能力 | 保留理由 |
| --- | --- |
| `RuntimeEditCoordinator` 的 edit lease / 三条件 settle / generation fence | 已在 `TRIM-CONCURRENCY-02` 砍过一轮（移除 `MutationCoordinator`、path lock、写后校验、冲突重放）。剩余部分是"多会话并行 + 成功后自动重建一次 + 失败不保存半成品"这三条已确认边界的最小实现，再砍会产出半成品产物 |
| 每项目单窗口 + sender frame/project/generation capability 校验 | 安全边界。`ATDD-SEC-201` / `ATDD-PREVIEW-201` 把 Preview 能否触达 Chat IPC 定为阻断级问题 |
| broker 串行队列 + revision + terminal fence | 两个窗口共享同一个 run 的必要条件，不是冗余抽象 |

### 2. 判定为过度或低收益，记录为改进项（不在本 change 内执行）

| 项 | 事实 | 处置 |
| --- | --- | --- |
| M1 网站入口整条链（`agentos://` + well-known HTTPS + binding credential + safeStorage + 幂等 receipt store + Preview 窄捕获 + 347 行协议规格） | 目前**没有任何真实第三方网站消费者**；唯一实际使用者是 AgentOS 自己的 Preview，而 Preview 在同一进程内，本不需要 origin 校验、绑定凭据与一次性 ticket | **待用户决策**：建议后续把"Preview 走 Main 内部通道"与"浏览器入口"拆成两个独立范围，浏览器入口推迟到有真实网站接入。本轮不动已交付代码 |
| 同一 30 方法接口在 `project-chat-contract.ts` / `ProjectChatBrokerPort` / `ProjectChatIpcRouter` / `preload.ts` / `desktop-seam.ts` 五处手工镜像 | `electron/project-chat-ipc.ts` 已 919 行，其中相当比例是一对一转写 | 不重构既有面。**新增面必须避免重演**：`FIX-WS-01` 因此冻结为"单一命令通道 + 判别联合"，而不是为 6 个操作各建一套镜像 |
| 本 change 的 `acceptance.md` 复制了一份 34 行 ATDD 矩阵，同时声明唯一事实源在 PRD | 复核确认 `ATDD-CHAT-207`–`209`、`ATDD-WS-201` 曾只存在于 change 侧、未进入 PRD，"唯一事实源"声明已实际失效 | 已回补 PRD 场景，并在 `acceptance.md` 顶部写入同步义务；不删除实现侧 ID 注册表（它承担 work order 映射，与 PRD 的产品 GWT 职责不同） |
| 19 张 work order 的 allowlist/停止条件流程 | `M3-01` 绕过该流程直接落地，成本已付但约束力未兑现 | 已在 `tasks.md` 与 `work-orders/README.md` 补记，并把"先补任务单再落地"写成显式规则 |

### 3. 真正的缺陷不是"过度"而是"不彻底"

`M0-05` 只迁移了 thread 事实就关闭了 renderer 的 durable writer，project / sidebar / view 事实被留在原地。`FIX-CHAT-01` 原范围只覆盖 thread 那一半，因此即使完成，新建项目、移除项目、重定位项目仍然不落盘。修法只有两条且必须择一执行到底：Main 补齐窄命令，或保留一个按字段裁剪的 renderer writer。本轮选择前者，冻结在 `FIX-WS-01`。

## Revision 1：已实现基线

Revision 1 已提供无 UI、可全局导入的应用内 Agent 指令通道：配置阶段绑定一个项目，调用阶段接收完整指令和可选导航策略；通过 Workspace Session 创建普通线程，并复用 Chat Run 状态和 transcript。它没有第二套 SDK、队列或历史数据库。

Revision 2 会扩展入口、窗口与授权边界。Revision 1 当前实现仍是 as-built 事实，直到 Revision 2 经确认并完成实现；其中“通道只绑定当前 renderer 项目”的限制将由 Revision 2 的项目级主进程协调机制取代。

### Revision 1 验收状态

- 契约位于 `prd/chat-agent-runtime/acceptance.md` 的“开发者通过全局通道启动独立 Agent 线程”。
- 单元与集成自检已经完成，尚未执行用户授权的正式验收。
- 原 `VER-01` 不单独关闭 Change；其未完成风险并入 Revision 2 后续验证计划，不能视为已验收。
