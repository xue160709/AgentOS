# Agent 指令通道与独立项目 Chat 窗口｜产品设计规格

> Change：`chg-20260818-agent-command-channel` Revision 2  
> 状态：Accepted / Planned，未实现  
> 本文只冻结用户可观察行为；技术接口见 `technical.md`，网站协议见 `protocol-v1.md`，正式场景见 `acceptance.md`。

## 1. 产品目标

让已授权网站可以把一条完整修改任务安全地交给绑定的本地项目，并由 AgentOS 创建普通项目会话、运行 Claude Agent SDK、在独立项目 Chat 窗口中继续协作，同时把修改期实时预览和完成后已保存预览收敛为同一条用户旅程。

本功能不创建第二套会话、Transcript、SDK、权限或任务历史。网站入口、主窗口和独立窗口都使用现有项目与线程事实。

## 2. 冻结词汇

| 用户词汇 | 含义 | 禁止暴露的实现词汇 |
| --- | --- | --- |
| 实时预览 | Agent 修改期间由受管开发 Runtime 提供的页面 | dev server、port、readiness、HMR process |
| 已保存预览 | Main 管理的 last-good 静态 artifact | out、static scheme、artifact pointer |
| 更新预览 | 主动生成新的已保存预览 | npm run build、rebuild command |
| 网站连接 | 网站 Origin 与一个本地项目建立 Binding | credential、binding secret |
| 外部任务 | 网站经一次性 Ticket 发起的新普通会话 | envelope、idempotency record |

## 3. 产品对象

### 3.1 Website Binding

- 一个规范化 HTTPS Origin 最多绑定一个本地项目。
- 一个项目可以被多个不同 Origin 绑定。
- Binding 只决定网站可以向哪个项目新建任务，不保存或改变权限。
- 用户可以查看和撤销 Binding；撤销只阻止未来任务，不取消已经启动的会话。

### 3.2 Task Ticket

- Ticket 是网站后端保存的短期、一次性任务载荷。
- 每个有效 Ticket 至多创建一个普通项目线程。
- Ticket 不是 AgentOS 中新的任务历史对象；消费后以普通线程为唯一历史。

### 3.3 Project Chat Window

- 每个项目最多存在一个独立 Chat 窗口。
- 窗口固定项目，不提供项目切换。
- 它只是现有项目 Chatbot 的另一种视图，不拥有独立 Transcript、SDK session 或运行状态。
- 重复打开同一项目只聚焦或显示已有窗口。

### 3.4 Edit Session

- Edit Session 是 Main 内存态的项目修改周期，不持久化为用户任务。
- 同一项目的普通 Chat、网站任务和手动实时预览共享一个 RuntimeInstance。
- 同一项目多个会话可以并行；v1 不提供写入锁、冲突合并或 per-run worktree。

## 4. 首次连接旅程

```text
网站点击“连接 AgentOS”
  → agentos://v1/pair 唤醒 AgentOS
  → AgentOS 从该 Origin 的固定 HTTPS endpoint 获取配对信息
  → AgentOS 显示网站名称、Origin 与本地项目选择
  → 用户确认
  → AgentOS 保存 Binding 并向固定 endpoint 回传 accepted
```

### 4.1 配对对话框

必须显示：

- 网站展示名和规范化 Origin；Origin 不可编辑。
- 目标本地项目；只允许选择已存在的 AgentOS 项目。
- 明确说明网站之后可以直接为该项目创建新会话。
- 明确说明网站不能查看 Transcript、文件、权限请求或最终结果。
- `连接`、`取消`两个动作。

取消、关闭、按 Escape 都不得创建 Binding、线程或 Runtime。

- 配对对话框始终由主窗口承载；主窗口隐藏或最小化时先显示主窗口，再显示 modal，但不切换当前项目或页面。
- 同时到达多个配对请求时一次只显示一个，按到达顺序处理；每次显示和点击连接前都重新检查过期时间。过期项直接失败，不展示陈旧确认框。

### 4.2 Binding 冲突

- Origin 已绑定同一项目：视为幂等成功，不重复创建 Binding。
- Origin 已绑定另一项目：不允许直接覆盖；对话框只提供“取消”与“前往管理连接”。
- 项目不存在或路径丢失：不允许确认连接。

## 5. 外部任务旅程

```text
网站点击“修改”
  → agentos://v1/task 唤醒 AgentOS
  → 获取并验证一次性 Ticket
  → Binding 解析唯一项目
  → Main 持久化新普通线程
  → Main 提交 Claude Agent SDK Run
  → 向网站回传 accepted
  → 打开、显示或通知项目 Chat 窗口
```

### 5.1 网站回执

- v1 只返回 `accepted` 或 `rejected`。
- `accepted` 表示线程已持久化且 SDK submit 已返回 requestId，不表示 Agent 最终成功。
- 网站不接收 threadId、requestId、Transcript、Diff、权限、问题、进度或最终结果。
- 回执发送失败时，本地会话继续运行；相同幂等键重试不得创建第二个线程。

### 5.2 新任务打断规则

项目 Chat 窗口收到外部任务时：

```text
IF 当前 Composer 草稿为空
AND 当前窗口没有活跃 Run
AND 没有等待权限或回答
THEN 选择新线程并显示窗口
ELSE 保持当前线程、草稿和焦点，只增加“新任务”徽标
```

这里的草稿、活跃 Run 和 Pending Prompt 取“新外部任务进入 broker 之前”的窗口快照，不包含该任务自己刚创建的 Run。项目窗口尚不存在时等同 idle：创建窗口、选择新线程并显示。自动选择的任务立即记为已读；未自动选择的任务累计徽标。用户点击徽标时选择最新未读外部线程并清空本批未读计数；未读游标跨窗口关闭和应用重启保留。

主窗口永远不因外部任务自动切换项目、线程或页面。

## 6. 独立 Chat 窗口

### 6.1 内容范围

窗口复用：

- 项目线程列表与归档/置顶状态。
- Chat Transcript、thinking、工具、Diff、上下文压缩与运行耗时。
- Composer、模型选择、权限模式、附件、Slash Command 和 `@` 引用。
- 权限请求、AskUserQuestion、取消和文件回滚。

窗口不包含：

- 项目切换、全局 Docs、全局 Settings。
- Runtime Preview、日志、进程控制或构建详情。
- 网站 Binding 管理。

窗口标题固定为“`<项目名> · Chat · AgentOS`”。

### 6.2 视图状态

- 主窗口与项目 Chat 窗口分别保留自己的当前线程和 Composer 草稿。
- 项目 Chat 窗口的当前线程、草稿和窗口 bounds 持久化，关闭并重新打开后恢复；应用重启后也恢复。
- 关闭项目 Chat 窗口只关闭视图和订阅，不取消 Run、不删除线程、不清空草稿。
- 项目被删除后窗口显示“项目已移除”，禁用提交并提供关闭窗口。
- 项目路径丢失时保留线程和草稿，禁用提交并提供在主窗口处理项目路径的入口。

### 6.3 同一线程运行规则

- 同一 thread 同时最多一个 active run。
- 第二个窗口提交正在运行的 thread 时显示“该会话正在另一窗口运行”，不取消旧 Run，也不创建新 requestId。
- 不同 thread 可以并行运行；同项目和跨项目都允许。

### 6.4 权限与提问焦点

- 一个 Pending Prompt 同时只有一个交互 Owner。
- 优先级：当前聚焦且显示该 thread 的窗口 → 可见的项目 Chat 窗口 → 可见主窗口。
- Owner 关闭后 Main 把交互权转移给下一个可用窗口。
- 非 Owner 只显示“请在另一窗口处理”，不渲染可提交的按钮。

## 7. 权限模式

- v1 保留现有“应用当前选择的权限模式”语义，不新增项目级权限设置。
- 权限模式由 Main 持久化并向所有 Chat 窗口广播；任一窗口修改后其它窗口显示相同值。
- 外部任务在 SDK submit 的线性化点读取一次当前值，本轮 Run 固定使用该值。
- Deep link、Ticket、Binding 和网站回执都不能携带、选择、回答或提升权限。
- Main 尚无已保存值时使用 `auto`。

## 8. 修改与预览旅程

### 8.1 进入实时预览

- 打开窗口、创建线程、纯解释、搜索或只读文件不会启动实时预览。
- 非 `plan` Run 是 potential write-capable run，但只有发生可靠写入意图或实际 Diff 后才建立 Edit Session。
- 对 `Edit`、`Write`、`NotebookEdit` 的写入意图在工具执行前获取 Agent edit lease。
- 其它工具只有在成功后产生可定位文件 Diff 时才登记 mutation；不解析 Bash 文本猜测写入。
- 静态项目有 dev script 时启动共享实时预览；没有 dev script 时显示“修改进行中，实时预览不可用”。

### 8.2 修改中

- 项目级状态显示“正在修改项目 · N 个会话”。
- 等待权限或问题时显示“等待你的确认”。
- HMR 处理普通页面变化；Main 不因每个文件变化重启进程。
- 两个 Runtime Host 共享 RuntimeInstance，但各自保留 PreviewSession、导航和焦点。
- 用户显式停止实时预览后设置 manual stop fence；Agent、watcher 或迟到事件不能自动拉起，直到用户明确恢复。

### 8.3 最终收口

自动收口只在同时满足以下条件时开始：

1. 本 editGeneration 至少有一次成功 Agent mutation。
2. 该项目所有 potential/write-capable Run 已终态。
3. 源码指纹连续 1,500ms 不变；最长等待 30,000ms。

静态项目：

- 所有相关 Run 成功后自动执行一次固定静态 build。
- build 成功后原子切换 last-good，再停止不再需要的临时 dev Runtime。
- build 失败保留旧页面，Agent 结果仍成功，显示“修改完成，但预览未更新”。

Development-only 项目：

- 不执行静态 build，继续使用共享实时预览。
- 不显示“已保存预览已更新”。

失败或取消：

- 没有 mutation：不污染本轮收口。
- 已有 mutation：不自动 build，显示“存在未完成修改，预览未更新”。
- 保留源码、Diff 和 last-good；提供继续修改、撤销或手动更新。

### 8.4 并发修改

- v1 不实现 MutationCoordinator、文件锁、写前版本校验、自动冲突合并或回滚。
- `Edit` 精确匹配失败由该 Agent 重读并自行重试。
- `Write` 全量覆盖导致的丢改动风险由项目版本控制和可见 Diff 兜底。
- 任一 potential/write-capable Run 未终态时不得宣布“预览已更新”。
- settle/build 期间出现新 potential Run 或新 mutation 时递增 editGeneration；旧结果不得切换 last-good。

## 9. Binding 管理

在 Settings 增加 category id=`website-bindings`、显示名“网站连接”的页面：

- 列出网站名称、Origin、项目名称、建立时间和状态。
- 支持聚焦项目、撤销连接。
- 不显示 credential。
- 撤销需二次确认；成功后该 Origin 的新任务全部 rejected。
- 已运行线程不删除、不取消、不改标题。

## 10. 无障碍与文案

- 配对、权限、提问和撤销确认使用 `role=dialog`，焦点陷阱完整，Escape 可关闭允许取消的对话框。
- 状态变化使用 `role=status` / `aria-live=polite`，不逐 token 播报。
- 错误使用 `role=alert` 并提供明确恢复动作。
- “更多”菜单使用 `aria-expanded` / `aria-controls`，关闭后焦点返回触发按钮。
- 状态含义不能只依赖颜色。

### 10.1 稳定可访问名称

以下 role/name 是验收 selector，不得因样式实现而改变：

| 元素 | role / accessible name |
| --- | --- |
| 配对对话框 | `dialog / 连接网站` |
| 配对项目选择 | `combobox / 目标项目` |
| 配对动作 | `button / 连接`、`button / 取消` |
| 撤销对话框 | `dialog / 撤销网站连接` |
| 独立窗口主区域 | `main / <项目名> 对话` |
| 新任务徽标 | `button / 新任务，<N> 条` |
| 同线程 busy | `status / 该会话正在另一窗口运行` |
| 项目已删除 | `alert / 项目已移除` |
| 路径丢失 | `alert / 项目路径不可用` |
| 修改阶段 | `status / 正在修改项目` |
| 预览更新失败 | `alert / 修改完成，但预览未更新` |

## 11. 明确非目标

- 网站获取 Agent 最终结果、进度、Transcript 或 Diff。
- 本地 HTTPS server、WebSocket 或浏览器扩展。
- 网站枚举或动态选择全部本地项目。
- 网站追加已有线程。
- 远程或跨设备 Agent。
- Chat 窗口内嵌 Runtime Preview。
- per-run worktree、自动 merge、MutationCoordinator 或生产级 OS Sandbox。
- Deep link 携带 prompt、项目路径、thread/session、凭据或权限。
