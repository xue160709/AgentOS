# 聊天与 Agent 运行时验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 项目 `.agentos` Runtime prompt（Change revision 3：已实现 / 待正式 GUI 验收）

> Revision 3 自动化 Development Check 已单独通过；真实 GUI 验收尚未执行，自动化结果不替代正式 Acceptance。

### 需求：仅合格的独立项目 Chat / Main 编排获得 Runtime 目录约束

#### `ATDD-PROJECT-RUNTIME-201` 场景：独立项目 Chat 普通/编辑重提注入固定路径

- GIVEN Main 已从权威项目记录解析有效 `projectId` 与项目根目录
- WHEN 用户从该独立项目 Chat 窗口提交普通请求或编辑重提
- THEN Main 以 `<project>/.agentos/` 构造并稳定追加 system prompt；该 prompt 仅约束项目 Runtime 网页的实现
- AND runner cwd 保持项目根；runtimeRoot 与 prompt eligibility 分别由 Main 的权威项目路径、sender capability 派生，renderer 不得传入 root、prompt scope 或等价标记
- AND prompt 要求 Agent 读取当前项目已有内容和数据，以 Next.js、React、TypeScript 在 `.agentos/` 构建数据可视化工作台，配置静态导出，在 `.agentos/` 执行 `npm install` 后执行 `npm run build`，并验证成功生成 `out/index.html`；不得以 Python、Flask 或 Streamlit 实现 Runtime

#### `ATDD-PROJECT-RUNTIME-202` 场景：主窗口、受管来源与非项目均不注入

- GIVEN 请求来自主窗口普通 Chat、Agent command、Website task、Task/Home managed run、Workspace/非项目，或项目路径已失效
- WHEN Main 构造 Agent request
- THEN request 不含 `.agentos` Runtime system prompt，也不从 Workspace 目录推导项目 Runtime 根

#### `ATDD-PROJECT-RUNTIME-204` 场景：创建按钮编排独立窗口与线程

- GIVEN 项目 Runtime 处于 `not_initialized`，且调用 sender 具有 main-window capability
- WHEN 用户点击「让 Agent 创建 Runtime 网页」
- THEN Main 打开或聚焦对应项目唯一的独立 Chat 窗口，在其中自动创建并选中线程并提交创建 Runtime 网页请求
- AND 主窗口不创建或选中空对话；按钮 IPC 以外的 sender capability 均被拒绝

#### `ATDD-PROJECT-RUNTIME-205` 场景：伪造 prompt scope / runtimeRoot 不改变资格

- GIVEN renderer 在请求 payload 中附加 `runtimeRoot`、prompt scope 或等价字段
- WHEN Main 处理提交
- THEN Main 忽略或拒绝这些调用方字段，并只按权威项目路径与 sender capability / 专用编排决定实际根目录及是否注入

#### `ATDD-PROJECT-RUNTIME-203` 场景：写错项目根只提示

- GIVEN 项目 run 结束后 `.agentos/` 仍不存在，且项目根出现新的 `package.json`、`index.html` 或 `src` 疑似网页工程迹象
- WHEN 项目 Runtime 页面刷新状态
- THEN 页面提示 Runtime 网页可能写在项目根并显示 `<project>/.agentos/` 目标路径
- AND 系统不移动、复制、删除文件，不自动重试 Agent，也不把该提示写成 Agent run 失败

## Revision 2（Accepted / Planned，未实现）

> 规格来源：`changes/active/chg-20260818-agent-command-channel/`。下列场景已冻结但全部尚未开发/验收；不得把 Revision 1 的通过证据复用为 Revision 2 通过证据。

### 需求：Main 是项目 Chat 的唯一事实源

系统 SHALL 由 Main 串行持久化项目 thread、transcript、run、SDK session、diff 与 workspace revision；主窗口和独立窗口只投影同一项目 snapshot。

#### `ATDD-CHAT-201` 场景：两个窗口观察同一运行

- GIVEN 主窗口与该项目的独立 Chat 窗口同时订阅同一 thread
- WHEN 该 thread 收到 SDK 流式事件并进入终态
- THEN 两个窗口展示相同且不重复的 transcript 与终态，workspace revision 单调递增，任一 renderer 都不以旧完整快照覆盖 Main 状态

#### `ATDD-CHAT-202` 场景：同一线程拒绝第二个运行

- GIVEN 一个 thread 已处于 submitting、running、waiting permission 或 waiting answer
- WHEN 任一窗口再次提交该 thread
- THEN Main 返回 `thread-busy`，不创建新 requestId、不取消或改写旧 Run

#### `ATDD-CHAT-203` 场景：不同线程并行

- GIVEN 同一项目存在两个不同 thread
- WHEN 两个 thread 同时提交有效任务
- THEN 两个 Run 可以并行，事件、权限、问题与终态只进入各自 project/thread/request

#### `ATDD-CHAT-204` 场景：迟到事件不能覆盖新状态

- GIVEN Run 已终态或项目 routeGeneration 已变化
- WHEN Main 收到该 request 的迟到非终态事件或旧 generation 事件
- THEN 事件被幂等忽略，终态、Transcript 与新项目路由保持不变；renderer 发现 sequence gap 时重新获取 snapshot

### 需求：权限与 Prompt 跨窗口只有一个权威状态

#### `ATDD-CHAT-205` 场景：权限模式同步并按提交捕获

- GIVEN 主窗口与独立窗口显示同一 app-global 权限模式，或升级用户只有旧 renderer localStorage 选择
- WHEN 任一窗口修改权限并随后提交 Run
- THEN Main 首次只迁移一次合法旧值（无值为 `auto`），持久化并向所有窗口广播相同模式；该 Run 固定使用提交线性化时的值，后续修改只影响新 Run，迟到旧 renderer 不能覆盖 Main 已存值

#### `ATDD-CHAT-206` 场景：Prompt owner 转移

- GIVEN 一个权限或 AskUserQuestion prompt 已分配给当前聚焦并显示该 thread 的窗口
- WHEN 其它窗口尝试回答，或 owner 窗口关闭
- THEN 非 owner 只能看到“请在另一窗口处理”且回答被拒绝；owner 关闭后 Main 按优先级转移一次交互权，首个有效回答后迟到回答无效

### 需求：每个项目只有一个独立 Chat 窗口

#### `ATDD-WIN-201` 场景：重复打开同一项目窗口

- GIVEN 一个项目 Chat 窗口已经存在
- WHEN 用户或外部任务再次要求打开该项目窗口
- THEN 系统只显示并聚焦现有窗口，不创建第二个窗口；窗口固定该项目且不提供项目切换

#### `ATDD-WIN-202` 场景：关闭窗口不终止任务

- GIVEN 项目窗口中有运行中、等待权限或等待回答的 Run
- WHEN 用户关闭该窗口
- THEN 只关闭视图与订阅，不取消 Run、不删除 thread、不清空 transcript 或 draft；其它可用窗口可继续观察和处理

#### `ATDD-WIN-203` 场景：独立视图状态恢复

- GIVEN 用户在项目窗口选择了 thread、输入未提交 draft 并调整窗口 bounds
- WHEN 关闭重开窗口或重启 AgentOS
- THEN selected thread、draft 与有效 bounds 恢复，且不覆盖主窗口自己的 selected thread/draft

#### `ATDD-WIN-204` 场景：外部新任务不打断当前工作

- GIVEN 新任务进入 broker 前，项目窗口已有非空 draft、活跃 Run 或 pending prompt 中任一项（不计算新任务自身 Run）
- WHEN 合法外部任务创建新 thread
- THEN 当前选择、draft 与焦点不变，只增加持久“新任务”徽标；仅在窗口不存在或 draft 为空且无既有 active Run/prompt 时自动选择并显示新 thread；点击徽标选择最新未读并清除本批计数

#### `ATDD-WIN-205` 场景：项目删除或路径丢失

- GIVEN 项目窗口固定项目已被删除或本地路径不存在
- WHEN 窗口刷新 snapshot 或用户尝试提交
- THEN 提交被禁用，不自动切换其它项目；删除态提供关闭窗口，路径丢失态提供回主窗口修复入口

### 需求：所有 Project Chat IPC 都受 Main capability 约束

#### `ATDD-SEC-201` 场景：未授权 sender 访问 Chat

- GIVEN 调用来自未知 webContents、subframe、错误 renderer URL、固定到其它项目的窗口或 Preview
- WHEN 它调用任一 `project-chat:*` IPC
- THEN Main 返回 `sender-not-authorized` 且不读写项目、thread、prompt、Binding 或 permission；Preview 保持无 preload/Node

### 需求：网站配对由用户明确确认

#### `ATDD-PAIR-201` 场景：接受合法配对

- GIVEN `agentos://v1/pair` 与 fixed HTTPS PairEnvelope 均合法且未过期
- WHEN AgentOS 显示规范化 Origin、网站名称、现有项目选择与能力说明，用户点击“连接”
- THEN Main 再次校验项目和时效，安全保存一个 active Website Binding，再向同 Origin fixed endpoint 回传 accepted

#### `ATDD-PAIR-202` 场景：取消配对或遇到冲突

- GIVEN 用户关闭/取消配对，或该 Origin 已绑定另一个项目
- WHEN 配对流程结束
- THEN 取消不创建 Binding/thread/Runtime；冲突不覆盖旧 Binding，只提供取消或前往连接管理

#### `ATDD-PAIR-203` 场景：Binding credential 安全

- GIVEN Main 准备生成或读取 Binding credential
- WHEN safeStorage 可用或不可用
- THEN 可用时只有 ciphertext 落盘且 credential 只通过 accepted HTTPS response 发送一次；不可用时配对 rejected，UI/API/log/磁盘都无明文 fallback

### 需求：授权网站用一次性 Ticket 新建普通线程

#### `ATDD-TASK-201` 场景：接受合法外部任务

- GIVEN Origin 有 active Binding，TaskEnvelope 合法、未过期且 idempotency key 未消费
- WHEN AgentOS 从 fixed HTTPS endpoint 获取任务
- THEN Main 先持久化普通 thread 与完整用户消息，再提交现有 Claude Agent SDK；runner 返回 requestId 后网站收到不含本地 ID 的 accepted

#### `ATDD-TASK-202` 场景：回执失败后幂等重试

- GIVEN thread 与 Run 已创建，但 accepted POST 因网络失败未送达
- WHEN 网站用相同 Binding 和 idempotency key 重试相同任务
- THEN 原 Run 继续，AgentOS 重发原 terminal receipt，且不创建第二个 thread 或 requestId

#### `ATDD-TASK-203` 场景：无效或越权 Ticket

- GIVEN Binding 不存在/已撤销、Ticket 过期/来源不符/已消费，或 envelope 携带 project path、thread/session、permission 等禁止字段
- WHEN AgentOS 验证任务
- THEN 请求 rejected，不创建 thread、不提交 SDK、不尝试其它项目或权限模式

#### `ATDD-TASK-204` 场景：网站只获得最小回执

- GIVEN 外部任务进入 accepted 或 rejected
- WHEN AgentOS POST TaskReceipt
- THEN body 只含协议版本、网站 request/idempotency key、status 与可选稳定 code，不含 project/thread/local request、Transcript、Diff、权限、问题、进度或最终结果

### 需求：Deep link 在冷启动与已运行状态语义一致

#### `ATDD-LINK-201` 场景：cold/warm deep link 去重

- GIVEN 合法 pair/task URL 通过 macOS open-url、初始 argv 或 second-instance argv 到达
- WHEN AgentOS 尚未 ready 或已经运行
- THEN 所有入口使用同一严格 parser；ready 前进入最多 32 项/5 分钟队列，相同 action+origin+request 只处理一次，非法/过期/超长 URL 无副作用

### 需求：Preview 只能触发窄 deep-link 导航

#### `ATDD-PREVIEW-201` 场景：内嵌网站点击 AgentOS 链接

- GIVEN 无 preload/Node 的项目 Preview 加载当前有效 Runtime generation
- WHEN 页面导航到合法 `agentos://v1/pair|task`
- THEN Preview 阻止自身导航并把原始 URL交给 Main 同一 parser；旧 generation 或非法链接不执行，Preview 仍不能调用 Project Chat IPC

### 需求：可靠 Agent 写入才建立 Edit Session

#### `ATDD-EDIT-201` 场景：只读与写入工具分流

- GIVEN 一个非 plan Run 正在解释、搜索或读取文件
- WHEN 尚未出现 `Edit/Write/NotebookEdit` before-tool 意图或成功工具后项目内实际 Diff
- THEN 不启动 Agent edit lease 或实时预览；明确写工具在执行前 acquire，其他工具只按成功 Diff 登记 mutation，不解析 Bash 文本猜测

#### `ATDD-EDIT-202` 场景：满足三条件后收口

- GIVEN 本 editGeneration 至少一次成功 Agent mutation
- WHEN 所有 potential/write-capable Run 已终态且源码 fingerprint 连续 1,500ms 不变
- THEN Main 只产生一次 settle intent；任一条件不满足或 30,000ms 内未稳定都不自动 build

#### `ATDD-EDIT-203` 场景：新修改使旧收口失效

- GIVEN settle 或 build 已针对 generation N 开始
- WHEN 新 potential Run 或 mutation 到达并产生 generation N+1
- THEN N 的迟到 settle/build 结果不能切换 last-good 或宣布预览已更新，系统等待最新 generation 重新满足条件

#### `ATDD-EDIT-204` 场景：静态项目成功更新已保存预览

- GIVEN 静态项目的最新 editGeneration 满足 settle 且无失败栅栏
- WHEN 固定静态 build 成功
- THEN Main 原子切换 last-good，只对该 generation build 一次，并在没有其它 consumer/lease 时停止临时 dev Runtime

#### `ATDD-EDIT-205` 场景：失败、取消或 build 失败

- GIVEN Run 在产生 mutation 后失败/取消，或 Agent 成功但静态 build 失败
- WHEN Main 处理终态
- THEN 前者不自动 build 并显示“存在未完成修改，预览未更新”；后者保持 Agent 成功但显示“修改完成，但预览未更新”；两者都保留源码、Diff 与旧 last-good

#### `ATDD-EDIT-206` 场景：项目 Runtime 能力矩阵

- GIVEN 项目分别为 development-only、static-only 无 dev、或无可靠 dev/static 声明
- WHEN 有成功 Agent mutation
- THEN development-only 继续共享实时预览且不显示已保存更新；static-only 编辑期说明实时不可用但可固定 build；无声明不猜命令、不 spawn

### 需求：用户可以管理网站连接

#### `ATDD-UX-201` 场景：撤销 Binding

- GIVEN Settings 网站连接列表显示 active Binding 的网站、Origin、项目与时间且不显示 credential
- WHEN 用户二次确认撤销
- THEN Binding 立即变为 revoked，未来任务 rejected；既有 thread/Run 不删除、不取消、不改标题

### 需求：新增交互满足可访问性底线

#### `ATDD-A11Y-201` 场景：Dialog、状态与菜单可访问

- GIVEN 用户通过键盘操作配对、撤销、权限、提问、状态与“更多”菜单
- WHEN 对话框打开/关闭或状态变化
- THEN dialog 有正确 role/焦点陷阱/Escape 语义，status/alert 不逐 token 播报，菜单关闭后焦点回触发器，任何状态不只依赖颜色

## 验收契约

### 需求：聊天提交构造完整 Agent 运行载荷
系统 SHALL 将用户文本、附件、线程 ID、项目 cwd、权限模式、模型选择、sessionId 与必要上下文构造成 `ClaudeChatSubmitPayload` 后提交给主进程。

#### 场景：用户提交有效聊天
- GIVEN 用户在项目线程中输入非空文本或选择有效附件
- WHEN 用户提交 Composer
- THEN 系统创建或复用线程，写入用户消息与模型选择，并调用 `window.claudeChat.submit`

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=textbox[name="聊天输入"]｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

#### 场景：空提交
- GIVEN Composer 文本为空且没有附件
- WHEN 用户触发提交
- THEN 系统不启动有效 Claude Agent 请求，并保持当前线程不新增空用户消息

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

### 需求：SDK 事件流转为可渲染 transcript
系统 SHALL 将 Claude Agent SDK 的 assistant、thinking、tool、activity、result、error 和 cancelled 事件标准化写入当前线程 transcript。

#### 场景：流式文本完成
- GIVEN 一次已 accepted 的 Agent 请求正在运行
- WHEN 主进程推送 session_start、assistant_delta 和 result 事件
- THEN UI 将 assistant 文本合并为 done 消息，并保存 sessionId、model、cwd 和耗时

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

#### 场景：取消请求保留部分输出
- GIVEN assistant 已产生部分流式文本
- WHEN 用户取消当前请求
- THEN transcript 保留已生成文本，并把该 assistant 消息标记为 cancelled

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

### 需求：权限与用户提问通过 UI 闸门处理
系统 SHALL 在工具执行需要用户确认时展示权限请求，并将有效 `AskUserQuestion` 转为用户输入弹窗。

#### 场景：工具请求权限
- GIVEN SDK 请求执行未默认允许的工具
- WHEN 权限事件到达 UI
- THEN 系统暂停该工具决策，并展示允许或拒绝的用户操作入口

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=dialog[name="权限请求"]｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

#### 场景：Agent 提出选择题
- GIVEN SDK 产生包含至少两个选项的 AskUserQuestion
- WHEN 事件路由到 ChatPage
- THEN 系统展示用户输入弹窗，并把用户选择返回运行时

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=dialog[name="Agent 提问"]｜验证方式: npm run test:electron（chat-run）｜证据: TESTING_CHECKLIST.md｜

### 需求：Generative UI 在沙箱中渲染
系统 SHALL 支持 `show-widget` Markdown fence，并在无网络和无表单能力的 sandbox iframe 中渲染交互组件。

#### 场景：assistant 输出 show-widget
- GIVEN assistant 消息包含合法 `show-widget` fence
- WHEN transcript 渲染该消息
- THEN 系统渲染沙箱组件，并允许组件通过受控消息触发后续用户输入

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: iframe[title="Generative UI"]｜验证方式: node test-results/full-acceptance-smoke.mjs｜证据: TESTING_CHECKLIST.md｜

#### 场景：非法 widget 输出
- GIVEN assistant 消息包含不合法或无法解析的 widget fence
- WHEN transcript 渲染该消息
- THEN 系统显示普通消息或错误态，不允许 widget 获得网络和表单能力

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

### 需求：聊天运行时接入项目 MCP 配置
系统 SHALL 在启动 Claude Agent SDK query 时读取当前项目 MCP server 配置，并把可用工具、连接状态和权限策略反馈到 Chat。

#### 场景：启动 query 时传入 MCP servers
- GIVEN 当前项目已保存至少一个启用的 MCP server
- WHEN 用户提交聊天并启动 Claude Agent SDK query
- THEN 主进程将项目级 `mcpServers` 传入 query options，并按 tool policy 构造 `allowedTools` 或拦截禁用工具

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：MCP server 连接失败
- GIVEN 当前项目配置的 MCP server 启动失败、认证缺失或 HTTP 401
- WHEN Chat 状态面板刷新运行时状态
- THEN UI 展示对应 server 的 failed 或 needs-auth 状态、脱敏错误摘要和进入 MCP 设置的修复入口

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

#### 场景：MCP 工具请求权限
- GIVEN Claude Agent SDK 请求调用 `mcp__server__tool` 且该工具策略为每次询问
- WHEN 权限事件到达 UI
- THEN 权限弹窗展示 server 名称、tool 名称、输入摘要和允许/拒绝操作，且不泄漏密钥或完整 header

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

#### 场景：Transcript 展示 MCP 工具调用
- GIVEN assistant 调用了名称为 `mcp__github__create_issue` 的工具
- WHEN transcript 渲染该工具事件
- THEN UI 以可读形式展示 `github · create_issue`，并在详情中保留完整工具名用于排查

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

### 需求：聊天运行时按全局搜索设置路由 WebSearch
系统 SHALL 在启动 Claude Agent SDK query 时读取全局搜索设置，并据此决定是否使用 Claude Code 原生 WebSearch 或 AgentOS `web_search` Provider。

#### 场景：使用原生 Web Search
- GIVEN 全局搜索设置选择原生 Web Search
- WHEN 用户提交一次可能触发联网搜索的 Agent 请求
- THEN 主进程不注册内部 `agentos-web` MCP server，不设置 `toolAliases.WebSearch`，也不把内置 `WebSearch` 加入禁用列表

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：使用 AgentOS 搜索 Provider
- GIVEN 全局搜索设置选择 AgentOS 搜索 Provider，并选择 DuckDuckGo Search、Brave Search 或 Tavily
- WHEN 用户提交一次可能触发联网搜索的 Agent 请求
- THEN 主进程注册内部 `agentos-web` MCP server，将 `toolAliases.WebSearch` 指向 `mcp__agentos-web__web_search`，并禁用内置 `WebSearch`

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：Provider 缺少凭据
- GIVEN 全局搜索设置选择 Brave Search 或 Tavily 但对应 API Key 未配置
- WHEN AgentOS `web_search` 被调用
- THEN 工具返回可读错误，并且日志和 transcript 不输出 API Key 或完整 header 明文

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: provider smoke + npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：DuckDuckGo HTML 网页搜索
- GIVEN 全局搜索设置选择 AgentOS 搜索 Provider 且 Provider 为 DuckDuckGo Search
- WHEN `web_search` 查询一个普通网页搜索词
- THEN 工具读取 DuckDuckGo HTML 搜索结果，返回合法 JSON 输出，包含 Provider 信息和归一化后的 title、url、snippet、source；若 HTML 搜索无结果、触发拦截或网络不可达则返回空 `results` 数组，不把整个工具调用标记为错误，也不伪造搜索结果

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: provider smoke + npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：Tavily 请求映射
- GIVEN 全局搜索设置选择 AgentOS 搜索 Provider 且 Provider 为 Tavily，并配置有效或可解析的 Tavily API Key
- WHEN `web_search` 携带 query、max_results、allowed_domains 和 freshness 调用
- THEN 主进程向 Tavily `/search` 发起 POST 请求，传入 Bearer 认证、`max_results`、include/exclude domains 和 time_range 映射，并将结果归一化为 title、url、snippet、source 和 publishedAt

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：Provider HTTP 错误脱敏返回
- GIVEN Brave 或 Tavily Provider 返回认证、套餐、配额或其它 HTTP 错误
- WHEN AgentOS `web_search` 被调用
- THEN 工具返回可读错误文本，日志只记录 provider、queryLength 和脱敏错误摘要，不输出 API Key、Bearer token 或完整 header

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: provider smoke｜证据: TESTING_CHECKLIST.md｜

#### 场景：API Key 池按顺序轮询
- GIVEN 全局搜索设置选择 AgentOS 搜索 Provider 且 Provider 为 Brave Search 或 Tavily，并配置多个 API Key 或 `${ENV_NAME}` 引用
- WHEN 当前优先级最高的 Key 返回认证失败、配额/套餐限制、429、网络超时或服务错误，且后续 Key 可用
- THEN `web_search` 使用同一次请求参数按顺序尝试下一个 Key，最终返回成功 Key 的归一化搜索结果；日志只记录 provider、keyIndex、errorKind、queryLength 和耗时，不输出任何 API Key 或完整 header

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: unit/integration: node --test electron/claude-agent-runner-web-search.test.mjs + npm run test:electron｜证据: test-results/verification-summary.md｜

#### 场景：API Key 池全部失败时脱敏汇总
- GIVEN Brave Search 或 Tavily 的 API Key 池中所有已解析 Key 都不可用，或所有 `${ENV_NAME}` 引用均未解析
- WHEN AgentOS `web_search` 被调用
- THEN 工具返回可读的聚合失败摘要，说明失败数量和主要错误类型，并给出恢复建议；日志和 transcript 不输出 API Key、Bearer token、完整 header 或完整请求体

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: unit/integration: node --test electron/claude-agent-runner-web-search.test.mjs + npm run test:electron｜证据: test-results/verification-summary.md｜

### 需求：开发者通过全局通道启动独立 Agent 线程

系统 SHALL 提供无 UI 的全局 Agent 指令通道。开发者在配置阶段绑定一个项目；调用方只传完整指令和可选导航策略。每次调用 MUST 创建新的普通线程、立即提交指令，并返回该线程 ID。

#### 场景：留在当前页面启动新线程

- GIVEN 通道已绑定项目，当前页面或当前聊天中存在未提交草稿
- WHEN 任意应用模块发送非空完整指令并选择 `stay`
- THEN 系统在绑定项目中创建新的可见线程并立即启动 Chat Run，返回新 `threadId`，且当前路由、活动线程和 Composer 草稿保持不变

#### 场景：创建后打开新线程

- GIVEN 通道已绑定项目
- WHEN 任意应用模块发送非空完整指令并选择 `open`
- THEN 系统创建并提交新线程后选择该线程，用户可立即查看指令和运行过程

#### 场景：通道发布线程运行终态

- GIVEN 指令通道已经创建并提交一个线程
- WHEN Chat Run 进入运行、等待权限、等待回答、成功、失败或取消状态
- THEN 通道只向该线程对应的订阅者发布 `running`、`waiting`、`asking`、`succeeded`、`failed` 或 `cancelled`，且终态不被迟到的非终态事件覆盖

#### 场景：空指令或提交失败

- GIVEN 通道已配置
- WHEN 调用方发送空白指令，或新线程无法提交到 Chat Run
- THEN 空白指令不创建线程；提交失败保留已经创建的可见线程用于排查，并向调用方抛出可读错误及发布 `failed` 状态

## 平台专项验证（Electron + React）

- 验证主进程事件只能影响归属线程。
- 验证权限响应和 AskUserQuestion 不泄漏到其它线程。
- 验证附件和模型图片能力联动。
- 验证 MCP server 状态、tool policy 和权限响应只作用于当前项目/线程；日志和 UI 摘要不得输出 MCP token、header 或连接串明文。
- 验证全局搜索设置变化会进入 runtime config signature，使下一轮 Agent 请求按最新搜索路由创建 SDK session；Provider Key 不进入日志明文。

## 建议验证命令

```bash
npm run typecheck
node --test electron/chat-run.test.mjs electron/claude-sdk-message-router.test.mjs
```
