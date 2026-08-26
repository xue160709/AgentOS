# Workspace Runtime 产品设计

## Revision 5 Planned：首次导入自动构建闭环

Revision 5 取代 Revision 4 中“没有产物时由用户点击构建”的首次使用路径：用户只负责选择项目和确认信任，AgentOS 负责完成首次可用页面。

```text
选择项目 → 检测静态声明 → 确认信任 → 正在首次构建 → 自动打开静态页面
                                      └─ 失败：说明原因 + 重试 / 显式开发模式
以后打开 → last-good 直接打开（零 spawn）
源码更新 → 旧页面继续可用 + 提示重新构建（用户决定）
```

- `building` 在没有 last-good 时显示“正在首次构建”，有 last-good 时显示“正在重新构建”，不要求用户理解命令和产物目录。
- 静态首次构建失败不得静默改为开发服务器；不支持静态导出的项目则在导入时明确标记为“需要开发服务器”。
- 工具栏、侧栏与 Preview 使用同一 Runtime snapshot 派生状态；Preview 尚在创建时显示“正在打开预览”，不能把已处于 `building/ready/running` 的 Runtime写成“已停止”。
- homepage 作为真实接入项目，保留现有中英文与书籍主流程并迁移到可静态导出的实现。

状态：Planned / 未实现；验收见 `C-013`–`C-015`。

## Revision 4 Current / as-built：最快打开旅程

默认旅程从“打开 Tab → 等待开发服务器启动”改为“打开 Tab → 立即显示最后成功页面”。用户平时不需要知道端口或 Node 进程；只有修改代码并希望预览更新时，才主动点击“构建”。

### 状态与动作

| 状态 | 页面行为 | 用户动作 |
| --- | --- | --- |
| `ready` | 立即显示 last-good 静态页面，无常驻项目进程 | 刷新；需要热更新时显式进入开发模式 |
| `stale` | 仍立即显示旧页面，并提示源码可能比预览新 | 重新构建 |
| `build_required` | 没有可安全打开的构建产物 | 构建 |
| `building` | 保留旧页面；没有旧页面时显示构建进度 | 等待或取消 |
| `build_failed` | 保留旧页面并显示稳定错误摘要/最近日志 | 重试构建或继续使用旧版 |
| `development` | 显式运行既有 dev server，支持热更新 | 停止/重启并可返回静态模式 |

- 打开和恢复不得隐式构建，也不得默认启动 `npm run dev` 或 `npm run start`。
- 构建成功后当前 host 切换到新静态产物；快速关闭、重开或切换 host 时，旧 operation/generation 的结果不得覆盖当前视图。
- 工具栏复用现有布局：静态模式显示构建、构建状态、刷新和“开发模式”；开发模式保留现有日志、重启和停止能力。侧栏 Tab 与项目首页 Runtime host 共享同一 RuntimeDefinition 和最后成功产物。
- stale 检查在旧页面已经可见后异步执行，不得进入首屏阻塞路径；它只提示，不自动执行项目代码。

### 信任说明

静态页面读取不执行项目代码；“构建”会在用户已信任目录中执行固定的 `npm run build`，仍属于本地受信代码执行。页面继续运行在无应用 preload、无 Node/Electron bridge 的 sandboxed Preview 中。

本节已按当前实现同步为 Current/as-built，并通过独立 Development Check；真实打包 Electron Chromium GUI 的 custom-scheme 全流程尚未执行正式验收。

> Revision 2 Current/as-built（Development Check PASS）：侧栏对象已改为用户命名的 `Workspace Tab`，Tabs 区位于新对话与搜索上方，关闭使用右键/键盘菜单；项目首页以页级 `Overview / Runtime` Tab 在既有卡片系统和独立 Runtime 页面之间切换。`ProjectHomeSurface` 卡片区域保持原样，项目首页 Runtime host 不创建隐藏 Tab，同一 Runtime 可被两类 host 共享。正式 Acceptance 尚未执行。

## Revision 2 信息架构与交互合同

```text
侧栏                         项目首页
Tabs                         [ Overview ] [ Runtime ]
├─ 用户命名的 Tab             ├─ Overview：既有卡片系统（不改）
└─ + New Tab                 └─ Runtime：独立预览与运行控制
新对话
搜索
Projects
```

- `RuntimeDefinition` 是已信任目录和启动配置；`WorkspaceTab` 是用户创建、命名、激活和关闭的持久视图；`RuntimeInstance` 是共享进程；`RuntimeHost` 是 `workspace-tab` 或 `project-home` 两类承载者。
- 新建时标题输入可编辑，trim 后 1–64 字符，同名允许；重命名使用行内编辑，`Enter` 提交、`Escape` 取消，失焦不隐式提交。标题持久化失败时保留编辑态并显示错误，不制造乐观成功。
- Tab 行不显示关闭按钮。鼠标右键或键盘上下文菜单提供“重命名 / 关闭”；关闭仍由 Main 权威快照提交成功后更新 UI。
- 首页 Overview 为默认页；切到 Runtime 不改变卡片内部状态。每个项目可恢复上次页签选择，错误或启动中也停留在 Runtime 页，不强制跳回 Overview。
- 未信任项目只展示说明与“启动预览”，不得因进入首页自动执行脚本。显式确认后才建立 `project-home:<projectId>:<mountId>` consumer。
- 项目首页离开 Runtime 页时只释放该 host；若仍有 `tab:<workspaceTabId>` consumer，受管进程继续运行。异步结果必须同时校验 project、mount、definition 与 generation，旧结果不得覆盖新页面。

以下章节保留 Revision 1 Current/as-built 基线，供迁移与回归对照。

> 状态：Current/as-built（基于当前代码与受控测试事实）。未实现的项目首页复用、Agent 沙箱代理和生产级 Sandbox Provider 保留在文末 Later；本轮不修改 `acceptance.md` 的正式状态。

## 1. 当前基线与本轮边界

当前 AgentOS 已支持项目、聊天线程和 Local App 并存。侧栏提供独立的 Local Apps 区与 `New Tab` 入口；`WorkspaceSession`、JSON/SQLite 工作区快照负责 Definition、Tab 和活动 Tab 的持久化与恢复；Main 进程负责 Runtime 和原生 Preview 的生命周期。

代码依据：`src/components/AppShellSidebar.tsx` 渲染独立 Local Apps 区、状态和 Tab 关闭入口；`src/components/AppShellWorkspace.tsx` 在 Local App 激活时切换到全屏 Preview 与顶部工具栏；`src/components/workspace-session.ts`、`src/chat-workspace-persistence.ts` 维护 Definition/Tab 与活动选择的 durable snapshot 恢复。

当前从左侧 `New Tab` 接入本地 Web 项目的主旅程已经实现：用户可在 chooser 中打开已接入应用，或绑定新的本地文件夹；确认信任并由 Main 持久化成功后，AgentOS 自动准备依赖、执行 `npm run dev`、探测 loopback 就绪地址并在原生 Preview 中呈现站点。工作区恢复时，已信任且设置为自动启动的 Local App 会重新创建 Runtime。CodeNow Wiki（`/Volumes/macOS/Github/codenow.wiki`）已完成真实 Electron GUI live smoke：首次动态地址为 `http://localhost:50041/`，退出后旧受管 PID 清理；正常重启以新的 `npm PID 94225 / next PID 94253` 和动态地址 `http://localhost:50941/` 恢复同一 Tab 及退出前路由。产品模型不硬编码端口或专用页面。

当前不改造项目首页为左右 Claude 工作台，不接入 Claude Agent SDK 的沙箱文件/命令代理，不把 Home Plugin/A2UI 卡片当作 Local App，也不承诺尚未由真实 Provider 验证的生产级 OS 文件系统或网络强沙箱。项目首页复用同一运行时、通用 Sandbox Provider 和更强的 Agent 控制能力属于 Later。

## 2. 设计目标与体验原则

### 2.1 Current 目标

- 用户只需绑定本地项目，不需要打开终端或自行运行 `npm run dev`。
- Local App Tab 是可发现、可切换、可关闭和可恢复的工作区入口；它与聊天线程有清晰的对象边界。
- 依赖准备、启动、就绪、预览、HMR、停止和失败均有可理解的用户反馈与恢复动作。
- 同一 Local App 的多个视图复用一个 Runtime，不因切换或开新视图重复启动开发服务器。
- 第一次信任是明确且可解释的承诺；后续恢复不重复打扰，但仍以目录可达性和运行时真实探测为准。

### 2.2 已实现的体验不变量

1. **先建立信任，再自动执行。** 确认前不运行目录中的脚本；确认内容说明目录、命令和自动恢复行为。
2. **入口、定义、运行时和预览分离。** Tab 只表示用户要看的视图，Runtime 才拥有进程生命周期，Preview 只承载它的输出。
3. **状态必须能解释和恢复。** “正在启动”不是结果；每个等待、失败或停止状态都给出下一步。
4. **运行事实优先于持久化猜测。** 不盲信旧 PID、旧端口或旧的就绪标记；恢复时重新建立 Runtime 并探测 readiness。
5. **亮点在结果中被证明。** 自动运行的价值在首次呈现页面、重启恢复和共享 Runtime 时自然显现，不用教育弹窗或装饰掩盖流程。

## 3. 产品对象与关系

### 3.1 对象定义

| 对象 | 产品含义 | 生命周期与归属 |
| --- | --- | --- |
| `LocalAppDefinition` | 用户明确绑定的本地 Web 项目：本地根目录、AgentOS 管理的启动配置、信任状态和恢复策略。 | 由用户确认后持久化；不因关闭某个 Tab 自动删除。 |
| `LocalAppTab` | 侧栏与主内容区中的持久化视图入口，指向一个 `LocalAppDefinition`。 | 可创建、激活、切换、关闭和恢复；关闭是关闭视图，不等于删除本地项目或定义。 |
| `RuntimeInstance` | 某个 Local App 当前会话中的受管进程组、就绪地址、运行状态和 generation。 | 由 AgentOS 创建、探测、停止和恢复；PID、端口等运行时事实不作为可盲信的持久化事实。 |
| `PreviewSession` | 某个 Tab 加载 Runtime 输出的隔离预览会话。 | 随视图创建/关闭；多个 PreviewSession 可指向同一个 Runtime。 |
| `RuntimeGrant` | 用户授予自动运行所需的目录信任记录。 | 首期至少记录本地目录信任；不得在 UI 中把它表述为已经具备项目外文件、网络或子进程的强隔离。 |

对象关系：

```text
LocalAppDefinition 1 ───── 0..1 RuntimeInstance
        │                         │
        └──── 1..n LocalAppTab ───┴──── 1..n PreviewSession
                    │
                    └── 每个 Tab 只有一个活动 PreviewSession
```

产品规则：

- 同一 canonical root 与同一启动配置只对应一个可复用的 `RuntimeInstance`；新视图引用已有 Runtime，不再执行第二次 `npm run dev`。
- 选择同一已绑定 Local App 时，创建新的 Tab 视图；选择新目录时进入首次接入。Local App 定义与 Tab 的数量关系不因首个 CodeNow Wiki 实例而收窄。
- 关闭最后一个调用方后，Runtime 立即进入停止/回收；关闭非最后一个 Tab 只释放该 Tab 的 consumer，不停止共享 Runtime。用户显式停止后不会被后台自动重新拉起；应用正常重启时，已信任且 `autoStart` 的定义按恢复流程启动。
- 用户移除 Local App 时只删除 AgentOS 中的定义和 Tab，不删除本地文件夹；若 Runtime 仍有其它调用方，不能因单个视图移除而误杀它。

## 4. 信息架构与入口

### 4.1 侧栏层级

侧栏保留现有项目/线程语义，并将 Local App 作为独立对象区，不把它伪装成项目或聊天线程：

```text
应用侧栏
├─ New Thread（现有聊天入口）
├─ Search（现有搜索入口）
├─ New Tab（新增 Local App 入口）
├─ Projects
│  └─ 每个项目的线程历史与已有项目操作
└─ Local Apps（有已绑定定义时显示）
   ├─ <Local App Tab> · 运行/启动中/失败/停止等状态
   └─ <Local App Tab> · 同一应用可有多个视图
```

`New Tab` 是明确的动作入口，而不是把用户直接丢进空白预览。打开 chooser 前，当前原生 Preview 先被隐藏但不关闭 Runtime；chooser 提供两个入口：

1. 选择一个已有的 Local App（用于打开新视图）；或
2. 选择一个本地文件夹（用于绑定新应用）。进入原生 picker 时继续保持 Preview 隐藏；取消或关闭流程后恢复当前活动 Preview。

项目列表、聊天线程、Home、Docs、Settings 的既有入口和选择规则保持不变。主内容区按活动对象切换：现有 Chat/Docs/Settings 继续由原路由承载；Local App Tab 新增隔离 Preview 分支。项目首页的 Claude 分栏不进入本轮信息架构。

### 4.2 Local App 侧栏行

每个 Local App Tab 行至少让用户辨认三件事：应用名称、当前视图是否活动、运行/预览处于什么状态。状态不能只用颜色或动画表达；失败、目录缺失和停止需要可读标签及可执行动作。

- 活动行标记当前主内容对象，并保持 `aria-current` 语义。
- 运行状态由共享 Runtime 与当前 PreviewSession 共同决定；同一应用的多个行可以同时显示“共享运行中”，但不各自制造进程。
- 行级关闭只关闭该视图；停止/重启 Runtime 是作用于同一 Local App 的明确动作，必须在动作标签中说明影响范围。
- Local App 区为空时，显示简短空态和 `New Tab` 动作；不在空态中堆叠运行时术语或复杂教育内容。
- 侧栏折叠时保留 Local App 行的可访问名称和状态；仅在空间不足时压缩文本，不删除状态信息。

## 5. 主旅程与任务流

### 5.1 首次绑定本地应用

```text
点击 New Tab
  ↓
选择 Local App → 选择本地文件夹
  ↓
检查目录与 dev 脚本，展示信任确认
  ├─ 取消 → 关闭流程，不创建定义/Tab，不留下脏记录
  └─ 信任并继续
       ↓
Main 检查信任并持久化 Definition + Tab，读回成功
       ├─ 失败 → 保持对话框，显示错误，不显示 Tab，不启动 Runtime
       └─ 成功 → Renderer 显示并激活 Tab
       ↓
准备依赖（如需要）
       ↓
执行 npm run dev → 捕获状态/日志 → 探测真实就绪地址
       ↓
建立 PreviewSession，显示本地应用页面（CodeNow Wiki 为目标接入实例）
```

关键交互规则：

- 文件夹选择结果先作为未提交草稿；没有用户确认信任前，AgentOS 不启动脚本、不创建持久定义或 Tab。
- 信任确认明确展示：将运行的项目目录、由 AgentOS 管理的 `npm run dev`、首次确认后可在应用恢复时自动运行。不得写成“项目外访问已被强制阻断”。
- 创建流程先 flush Renderer 尚未落盘的工作区变更，再读取 Main authoritative revision。Main 先检查目录/脚本、记录 trust、保存并读回包含 Definition/Tab 的 JSON/SQLite 快照；Renderer 只有收到成功快照后才显示 Tab，随后才调用 Runtime start。保存失败时不显示 Tab、不启动进程，接入对话框保持打开并提供可读错误。
- AgentOS 负责启动命令、依赖准备和端口/就绪探测；用户不需要从界面选择或手动执行 `npm run dev`。
- CodeNow Wiki 的接入验证已覆盖真实目录和 `dev: next dev`：真实 GUI smoke 显示页面、动态端口和启动结果均来自运行时探测；首次与重启后的端口不同，证明恢复不会盲信旧端口或旧 PID。体验层仍不写死端口或专用页面。
- 信任成功后先创建并激活 Tab，再让用户看到准备/启动反馈；这样用户知道等待的是哪一个应用，失败也能从该 Tab 恢复。

### 5.2 已信任应用的自动恢复

```text
AgentOS 启动/工作区恢复
  ↓
恢复 Local App 定义、Tab 与活动选择
  ↓
检查目录可达性与可运行配置
  ├─ 目录缺失 → path_missing，等待重新定位或移除
  └─ 可达且已信任
       ↓
重新创建 Runtime（不复用旧 PID/端口猜测）
       ↓
准备依赖 → 启动 → readiness 成功
       ↓
恢复活动 Tab 的 PreviewSession
```

- 只对已持久化且已信任的定义自动启动；未完成信任的草稿不能进入恢复队列。
- 恢复期间保留 Tab 和活动选择，主内容显示“正在恢复/正在启动”，不把空白页面误报为运行成功。
- 运行时启动失败时保留定义与 Tab，进入可读失败状态；不因一次失败删除用户绑定，也不无限自动重试。
- 用户此前明确手动停止的 Runtime 不应被同一会话中的自动恢复循环再次拉起；用户可从停止状态显式启动/重启。普通应用退出后的正常恢复仍按已信任定义自动启动。

### 5.3 多视图、切换与关闭

1. 从 chooser 的已接入列表或 Local Apps 区选择一个已绑定应用时，Main 新建并持久化一个唯一 Tab，Renderer 收到成功快照后激活它；PreviewSession 连接到该应用已有 Runtime（若尚未运行则触发一次启动）。
2. 切换 Tab 只切换 PreviewSession 和活动选择，不重启 Runtime，不丢失其它视图状态。
3. 关闭非活动 Tab 只移除该视图；共享 Runtime 与其它视图继续可用。
4. 关闭活动 Tab 后，焦点和活动选择落到相邻可用 Local App Tab；没有其它 Local App Tab 时回到安全的现有项目视图，并保留 Local App 定义供以后从 `New Tab` 打开。
5. 关闭最后一个调用方后，Runtime 进入停止/回收流程；若在回收完成前重新打开同一应用，RuntimeManager 通过 generation 与去重键决定复用/重建，不能产生双进程。

### 5.4 停止、重启与重试

- `刷新预览`只重新加载当前 PreviewSession，不默认重启开发服务器。
- `重启运行时`先使当前 generation 失效，再停止旧进程组并创建新 Runtime；旧日志、旧端口和旧事件不能写回新状态。
- 失败状态的 `重试`沿用已信任定义，重新进入准备/启动；不再次要求信任。若失败原因是目录或配置本身不可用，应优先提供“重新选择目录”而不是无效重试。
- `停止`是用户可见的明确动作；停止后显示启动入口，不能在后台无提示地反复拉起。
- 准备或启动中取消会使旧任务、计时器、监听器和事件失效。首次接入的取消清理未提交草稿；已存在的 Tab 保留定义但回到 stopped，不允许 late event 把它改回 running。
- 切换聊天或其它工作区 Tab 只隐藏当前 Preview；`LocalAppPreview` 的卸载清理调用 `setLocalAppPreviewVisible(false)`，不调用 release/stop。Runtime consumer 仍绑定 Local App Tab，回到该 Tab 时复用当前 generation 和 PreviewSession，不重复 spawn。

## 6. 页面与状态设计

### 6.1 接入界面状态

| 状态 | 进入事件 | 用户可见信息 | 可执行动作 | 退出条件 |
| --- | --- | --- | --- | --- |
| `unconfigured` | 点击 `New Tab` | 选择已有 Local App 或新增本地文件夹 | 选择、返回/取消 | 选择已有定义或返回 |
| `folder_selected` | 文件夹选择返回 | 目录名称/路径，正在检查项目配置 | 确认继续、重新选择、取消 | 检查完成或用户取消 |
| `trust_required` | 发现需要运行本地脚本 | 目录、`npm run dev`、自动恢复说明和信任风险 | 信任并继续、取消 | 信任成功或取消 |
| `cancelled` | 用户取消或关闭接入流程 | 不保留未提交对象 | 重新开始 | 回到侧栏原焦点 |

首次接入只有在 `trust_required` 的确认动作完成后才产生持久对象；`unconfigured`、`folder_selected` 和 `cancelled` 不进入工作区快照。

### 6.2 Runtime 与 Preview 状态

| 状态 | 进入事件 | 用户看到什么 | 可执行动作 | 恢复/退出规则 |
| --- | --- | --- | --- | --- |
| `preparing` | 信任成功、恢复或重试 | 正在检查项目/准备依赖，可查看最近日志 | 查看日志、取消 | 依赖准备完成进入 `starting`；失败进入 `failed` |
| `starting` | 准备完成并启动 `npm run dev` | 正在启动开发服务并等待就绪 | 查看日志、停止 | readiness 成功进入 `running`；超时/退出进入 `failed` |
| `running` | 真实探测到就绪地址且 Runtime 进程存活 | 站点预览、运行中状态、刷新/重启/关闭动作 | 刷新预览、重启运行时、停止、关闭 Tab | Preview 断开只更新 Preview 状态为 `degraded`/`failed`；进程退出进入 Runtime `failed` |
| `degraded` | 运行态快照的降级状态（Preview 事件不直接改写 Runtime 状态） | 区分“服务器仍在运行”和“预览暂时不可用”，保留可见错误/最近页面（若有） | 重新连接/刷新、查看日志、重启 | Preview 恢复为 `ready`；确认进程失败回 `failed` |
| `failed` | 依赖失败、命令缺失、端口/readiness 超时或进程崩溃；Preview 加载失败单独记录在 Preview 状态 | 失败阶段、稳定错误码、用户可读摘要、最近日志入口和影响范围 | 重试、重新选择目录、移除 Local App | 重试回 `preparing`；重新定位后重新检查；移除清理定义/Tab |
| `path_missing` | 恢复或运行前目录不可达 | 原路径不可用，绑定仍保留 | 重新定位、移除 | 重新定位后重新检查；不自动运行未知新目录 |
| `stopped` | 用户停止、关闭最后 Tab 后回收或退出清理完成 | 已停止，不显示陈旧预览为可用 | 启动/重启、关闭/移除 Tab | 启动回 `preparing` 或 `starting` |

状态不变量：

- `RuntimeInstance` 的状态与 `PreviewSession` 的状态分开表达。Runtime `running` 不代表 Preview 一定 `ready`；Preview `degraded`/`failed` 时仍保留进程运行事实和预览恢复动作，不能把预览故障误报成 Runtime 已停止，也不能把整条 Tab 标成无故障运行。
- `failed` 必须说明失败发生在哪一阶段：依赖、命令、进程、readiness 或预览，而不是只显示“启动失败”。日志可以更详细，但不以日志替代首屏可读原因和动作。
- `path_missing` 不删除历史定义；重新定位到不同目录时必须重新检查，并在信任范围发生变化时重新请求信任。
- 状态事件携带 Local App、Runtime 和 generation 作用域；切换 Tab、取消、重试或关闭后的 late event 不能污染新视图、新 Runtime 或已卸载内容。
- 自动重试采用有限次数/退避；达到上限后停在 `failed`，由用户明确重试，避免失败时不断运行本地脚本。

### 6.3 全屏 Preview、顶部工具栏与日志

- Local App 激活时，主内容区使用全屏 Preview stage；顶部工作区工具栏承载紧凑 Runtime 状态、预览刷新、日志、重启和停止。Local App 不重复显示聊天/项目首页工具条，也不在预览区域内占用一块运行时 summary。
- 日志默认收起；点击顶部 `Logs` 后才展开最近的有界日志。切换 Tab 或 Runtime generation 时日志展开状态重置为收起，Running 与最近日志默认不挤占 Preview 面积。
- `刷新预览`只 reload 当前 PreviewSession；`重启运行时`是应用级动作，会使旧 generation 失效并重建进程；按钮与状态文案保持二者可区分。

### 6.4 HMR 与预览行为

- 首次就绪后，预览显示站点本身，并在其宿主状态区域保持可读的运行/预览状态；“页面出现”与“Runtime ready”都可被用户验证。
- HMR 正常更新时不切换 Tab、不清空用户当前视图；发生短暂断线时以 `degraded`/重新连接状态告知用户，避免把旧页面误认为最新结果。
- 预览容器不得获得 Electron/Node 直连能力；实现提供对未允许导航、窗口创建和权限请求的受控阻止路径，并给出返回或刷新动作。真实 Preview 页面对 Node/Electron bridge、外部导航、`window.open` 和权限请求的安全负例仍待正式补证；这里不是尚未验证的 OS 强沙箱承诺。

## 7. 亮点出现、理解与验证

本轮没有单独的亮点策略文件；以下只把 active change 已确认、且当前代码已承载的真实能力安排到用户能验证价值的时机：

| 时机 | 用户应发现/理解什么 | 产品内证明 |
| --- | --- | --- |
| 首次点击 `New Tab` | 这是把本地 Web 项目接入 AgentOS 的入口，不是新聊天或网页书签 | 独立的 Local App 选择与空态，不混在项目/线程列表中 |
| 信任确认前 | AgentOS 将代为运行本地项目脚本；用户只需确认一次，但仍知道具体目录和命令 | 显示目录、`npm run dev` 与自动恢复说明；不承诺未验证的强隔离 |
| 第一次成功 | 用户不用终端就看到真实项目页面 | `running` 状态、站点预览、可查看日志/刷新/重启；“页面能用”是价值证明 |
| 重启 AgentOS 后 | 已信任绑定可以自动恢复，而不是重新配置 | Tab 和活动选择先恢复，随后显示恢复/就绪状态；不要求再次信任 |
| 打开第二个同应用视图 | 切换视图不会再启动一份开发服务器 | 两个 Tab 共享同一 Runtime 状态，关闭一个不影响另一个 |
| 发生失败时 | 自动化不是黑盒；用户知道原因并能继续 | 分阶段错误摘要、最近日志、重试/重新定位/移除动作 |

这些说明应嵌入任务反馈与结果，不增加强制产品介绍或大段教程；视觉层只强化信息层级、状态可辨识度和错误恢复，不以装饰替代状态设计。

## 8. 键盘、焦点与无障碍

- `New Tab`、已有 Local App 选择、Tab 行、刷新/重启/停止/关闭/重试/重新定位/移除均使用可聚焦的语义按钮或链接；不把仅鼠标悬停作为唯一入口。
- 打开接入选择或信任确认后，焦点进入对话的首个可执行控件；`Escape` 取消当前未提交流程并回到触发 `New Tab` 的按钮。取消不留下持久对象。
- 创建并激活新 Tab 后，焦点落到该 Tab 的可识别控件或主内容状态；成功加载、HMR 短暂断线等异步更新不强行抢走用户正在编辑或预览中的焦点。
- 关闭活动 Tab 后，焦点移动到确定存在的相邻 Tab；若无可用 Tab，回到 Local Apps 空态的 `New Tab` 或安全的现有项目入口，不能落到已卸载节点。
- 状态变化通过与当前控件一致的可读文本和适度的 `aria-live` 告知；失败摘要使用可被辅助技术识别的错误语义。颜色、spinner 或页面是否出现不能是唯一状态线索。
- 预览获得键盘焦点时，宿主仍提供可回到 Tab/运行控制的稳定路径；预览内页面的焦点不应使关闭、刷新或失败恢复操作不可达。
- 文案支持中英文，目录、命令、错误阶段和动作名称不可只靠截断文本理解；路径可以视觉截断，但辅助技术名称需保留完整上下文。
- 不在本轮新增未经确认的快捷键；先保证现有侧栏 Tab/Enter/Space/Escape 顺序和原生文件夹选择器可用。

## 9. 响应式与窗口变化

- 侧栏展开时显示 Local Apps 区、名称和状态；侧栏折叠时保留图标/名称的可访问标识、活动标记和状态，不依赖悬浮提示才能完成切换或恢复。
- 窗口较窄时，Local App 状态与操作可换行或收进明确的操作菜单；错误原因和主要恢复动作仍需可见，不能只剩图标。
- 主内容区宽度变化不改变 Runtime 生命周期。Preview 随内容区缩放或进入窄布局，不能因为侧栏收起、展开或切换 Tab 而重启 Runtime。
- 接入/信任界面在窄窗口中保持完整的目录、命令、风险说明和主要动作；动作可垂直排列，但取消与继续顺序和键盘顺序稳定。
- 预览加载、错误和停止态都要有不依赖固定尺寸的内容承载；窗口尺寸变化期间保持状态文本、焦点和重试路径。

## 10. 视觉交接边界

本文件不规定颜色、字体、阴影、动效或具体组件皮肤。请由视觉界面设计师在现有 AgentOS 设计系统内落实以下交接点：

- `New Tab` 与现有新建线程的层级区分，以及 Local Apps 独立分组的可发现性。
- `preparing`、`starting`、`running`、`degraded`、`failed`、`path_missing`、`stopped` 的非颜色状态编码、文案层级和操作优先级。
- 预览宿主状态、站点内容和运行时控制的清晰边界；错误/恢复路径在窄窗口与侧栏折叠时仍可读。
- 焦点环、键盘顺序、辅助技术状态播报与页面内容之间的对比和空间优先级。

## 11. 风险、未知项与验证边界

- **生产级 Sandbox Provider 未定。** 体验验证阶段只能描述“用户显式信任的本地项目”和受控预览；不能把普通 `cwd`、renderer sandbox 或 `utilityProcess` 写成完整文件系统沙箱。项目外文件、网络、环境变量和子进程逃逸验证完成前，不得开放强隔离承诺。
- **任意项目脚本风险。** 首期仅对显式信任目录自动运行；信任提示必须准确说明命令与目录。是否允许后续修改信任、网络或环境变量范围，需要安全/技术决策后再扩展。
- **依赖准备规则未产品化。** 包管理器识别、lockfile 变化、安装命令、超时和日志脱敏由技术合同确定；产品层只承诺可观察的准备状态、原因和恢复入口。
- **readiness 的边界仍需验证。** 当前实现使用启动日志解析与 loopback HTTP 探测共同确认就绪；产品层不硬编码端口，只依赖真实就绪结果，跨平台项目和异常响应的覆盖仍待验证。
- **无人调用方的停止时机已实现为立即回收。** 最后 consumer 释放后 Runtime 进入停止，退出清理与崩溃退避仍由运行时常量控制。
- **路径迁移的边界仍需验证。** 当前以 canonical root 复用 Definition/Runtime，并在重新定位到不同目录时重新检查、必要时重新信任；跨平台路径规范化、符号链接和旧授权失效策略仍需进一步验证。
- **真实 GUI 已完成，安全负例仍待补证。** CodeNow Wiki live smoke 已于 2026-08-25 完成；仍缺少真实失败目录/脚本、Preview Node/Electron bridge、外部导航、`window.open` 和权限请求等正式负例证据，不能把正向页面显示推论为安全边界或全部验收通过。
- **用户研究证据边界。** 本轮未发现独立的 `docs/research/users/` 用户研究材料或独立亮点策略文件；设计依据仅为用户已确认语义、active change 的 `proposal.md`/`design.md`/`evidence.md`/`tasks.md` 与现有代码事实。若出现真实用户反馈，应回到产品/研究流程更新，而不是把本设计的推断当成研究结论。

## 12. as-built 依据与后续接口

- 本 Current/as-built 同步依据 active change `chg-20260825-local-app-tabs-runtime`、当前实现和受控测试；Acceptance/TODO 的正式契约和状态由主 Agent 按相应流程维护，本文件不复制其 GWT 或任务清单。
- 关键实现路径：`src/components/types.ts`、`src/components/workspace-session.ts`、`src/chat-workspace-persistence.ts`、`src/workspace-snapshot-resolution.ts`、`src/components/AppShell.tsx`、`src/components/AppShellSidebar.tsx`、`src/components/AppShellWorkspace.tsx`、`src/components/LocalAppOnboardingDialog.tsx`、`src/components/LocalAppWorkspace.tsx`、`src/components/LocalAppPreview.tsx`、`electron/main.ts`、`electron/local-app-runtime/index.ts`、`electron/local-app-runtime/preview.ts`。
- 开发与构建验证：`npm run typecheck` PASS；`npm run test:electron` PASS（`117/117`，含受控 loopback、动态 readiness、失败分支、generation、consumer 生命周期和退出清理）；`npm run build` PASS（仅保留既有 chunk size warning）；`git diff --check` PASS。这些开发检查不等同于正式 Acceptance 全通过。
- 真实 GUI 证据：已执行真实 Electron 窗口与 `/Volumes/macOS/Github/codenow.wiki` live smoke；首次动态地址为 `http://localhost:50041/`，退出后旧 PID 全清；正常重启创建新的 `npm PID 94225 / next PID 94253`，动态地址为 `http://localhost:50941/`，并恢复同一 Tab 与退出前路由。chooser/picker、聊天切换 PID 不变、同 root 多 Tab 共享 Runtime、刷新不重启也已实测。
- 正式 Acceptance 状态仍为 `10/16 PASS`、`6/16 待补`，总体 `BLOCKED`，未发现 FAIL；待补包含取消/Escape 不落盘、失败/停止恢复、真实 `path_missing` 恢复，以及 Preview Node/Electron bridge、外部导航、弹窗和权限请求负例。本文件不把开发检查或 GUI smoke 写成全部通过，也不回写 `acceptance.md` 状态。
- 视觉界面设计师消费第 4、6、8、9、10 节，补充现有设计系统下的层级与状态呈现。
- 技术架构消费第 3、5、6、11 节，确定 Runtime、Preview、Desktop Seam、generation、SandboxAdapter、持久化和 readiness 合同。

## 13. Planned / Later（未实现）

- `LATER-01`：项目首页复用同一 Local App Runtime，形成左预览、右 Claude Agent SDK 的开发工作台。
- `LATER-02`：Claude Agent SDK 通过通用 SandboxBroker 在项目运行时中读写、安装依赖和控制进程。
- `LATER-03`：确定并实现生产级跨平台 Sandbox Provider；完成项目外文件、网络、环境变量和子进程逃逸验证后再声明强隔离。
