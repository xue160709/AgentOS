# Local App Runtime 技术文档

> 文档状态：方案同步（Planned），对应已确认 `chg-20260825-local-app-tabs-runtime@1`。
>
> 本文严格区分 `Current`（代码已经存在并已从仓库核对）与 `Planned`（本 change 已确认、但尚未实现）。本文不是实现完成声明，也不构成正式验收；正式验收契约位于 `prd/local-app-runtime/acceptance.md`。

## 1. 推荐方案

推荐把 Local App 做成 Electron Main 控制的本地运行时，而不是让 renderer 直接启动命令或加载任意 URL：

```text
renderer（AppShell / WorkspaceSession / LocalAppPreview）
        │ typed Desktop Seam：命令 + 快照 + 事件
        ▼
Electron Main
  LocalAppRuntimeManager
    ├─ LocalAppStore / TrustStore
    ├─ RuntimeSupervisor（依赖准备、spawn、readiness、重启、进程树）
    ├─ PreviewManager（隔离 WebContentsView、导航/窗口/权限策略）
    └─ SandboxAdapter（首期为受信本地进程适配器；不宣称 OS 沙箱）
```

首期只允许用户明确确认过的目录，并固定运行 `npm run dev`。运行时按 `canonicalRoot + command` 去重，使一个 Local App 的多个 Tab/Preview 共享一个 `RuntimeInstance`。预览使用独立、无 Node 权限的 WebContentsView（Planned 实现方向），Main 只把受控的 `PreviewSession` 元数据和运行状态通过 typed seam 给 renderer。

生产级 `SandboxAdapter` 的 Provider（容器、微虚拟机或平台原生能力）目前没有定案；在真实逃逸验证前，不能把 `cwd`、`utilityProcess`、Node permission、renderer sandbox 或路径校验描述为 OS 文件系统沙箱。这是对外发布的安全阻断项。

## 2. Current：现有代码事实

### 2.1 真实入口与现有边界

| 路径 | 当前事实 |
| --- | --- |
| `src/components/AppShell.tsx` | 创建 `WorkspaceSession`，通过 `loadChatWorkspaceState` 加载工作区，通过 `stage/close` 触发持久化；当前只把项目、线程和设置视图装配进壳层。 |
| `src/components/types.ts` | 只有 `WorkspaceProject`、`WorkspaceThread`、`ChatWorkspaceState`、侧栏偏好等工作区/聊天类型；没有 Local App、Runtime 或 Preview 类型。 |
| `src/components/workspace-session.ts` | 管理项目/线程选择、创建、归档、移除、重定位、排序、恢复和 durable save；`restoreWorkspaceSessionState` 以项目和线程为活动选择。 |
| `src/chat-workspace-persistence.ts` | 读写 renderer `localStorage` 与 `window.desktop` mirror，归一化工作区快照；未知字段会被忽略，`pathMissing` 是 runtime-only 字段。 |
| `src/components/AppShellSidebar.tsx` | 当前入口是 `New Thread`、项目新增、搜索和项目/线程列表；没有 `New Tab` 或 Local App 列表。 |
| `src/components/AppShellWorkspace.tsx` | 当前主区在 `ChatPage`、`DocsPage`、`SettingsPage` 之间切换，并管理文件树/搜索/辅助抽屉；没有 Local App Preview 分支。 |
| `src/desktop-api.ts`、`src/desktop-types.ts`、`src/desktop-seam.ts` | 定义 named Desktop API、共享类型和 IPC channel 映射；当前没有 runtime/preview channel。 |
| `electron/preload.ts` | 通过 `contextBridge.exposeInMainWorld('desktop', desktopAdapter)` 暴露类型化方法；不暴露 `ipcRenderer`，并以 `satisfies DesktopAPI` 校验桥接形状。 |
| `electron/main.ts` | 创建主 `BrowserWindow`、托盘、单实例、项目文件/聊天/设置 IPC；当前没有开发服务器 Supervisor、进程组回收或 Local App 预览管理。退出钩子 `prepareForAppQuit` 目前清理托盘、文件 watcher 和语音服务。 |
| `prd/workspace-session/technical.md` | 已记录工作区快照、revision、防抖保存和恢复事实。Local App 应复用该 durable snapshot seam，不另造第二套 renderer 工作区存储。 |
| `prd/desktop-shell-settings-release/technical.md` | 已记录现有 BrowserWindow/preload/IPC/跨平台窗口边界和桌面测试入口。 |

现有主窗口的 `createWindow` 配置了 preload，但没有把它当作 Local App 页面安全边界；Local App 预览必须由独立的 PreviewManager 显式配置 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`，并单独管理导航、窗口和权限。

### 2.2 当前持久化与工作区不变量

- `ChatWorkspaceState` 当前保存 `workspaceRevision`、`activeProjectId`、`activeThreadId`、`projects`、`threads` 和 `sidebarPrefs`。
- `WorkspaceSession.stage` 先调用 renderer 的即时保存，再以 750ms 防抖调用 `window.desktop.saveChatWorkspace`；`workspaceRevision` 只在 durable 内容变化时推进。
- `stripRuntimeProjectFields` 会把 `WorkspaceProject.pathMissing` 排除在 durable fingerprint 之外。
- renderer 从 `localStorage` 与 Electron mirror 选择更新快照；主进程 `ChatWorkspaceStore` 负责 userData 下的 JSON/SQLite/JSONL 兼容存储与搜索（具体实现入口见现有工作区技术文档）。
- 当前 `pickProjectDirectory` 只负责选择项目目录，`validateProjectPaths` 只校验目录可达性；两者都不代表信任授予或运行时沙箱。

### 2.3 首个接入项目事实

`/Volumes/macOS/Github/codenow.wiki/package.json` 当前存在：

- `scripts.dev` 为 `next dev`；
- 存在 `package-lock.json`，当前目录也有 `node_modules`；
- 使用 Next.js `^16.0.0`、React `^19.0.0`；
- 本仓库没有对该项目源码的修改授权，本 change 也明确禁止修改它。

运行时不能把该绝对路径或任何默认端口写入代码。它只作为首个 live smoke 的用户选择结果和测试输入；端口必须从运行日志/readiness 动态发现。

### 2.4 现有测试与可复用验证

- `electron/workspace-session.test.mjs` 已覆盖活动选择、恢复、线程/项目生命周期、即时保存、防抖保存、revision 和 runtime-only 字段。
- `electron/chat-workspace-store.test.mjs` 已覆盖 JSON/SQLite 快照新旧选择、空工作区不复活旧行和历史搜索。
- `electron/desktop-seam.test.mjs` 已覆盖无 generic IPC 泄漏、preload/main channel 对齐及 `DesktopAPI` 形状。
- `electron/window-chrome.test.mjs`、`electron/project-content.test.mjs` 等提供桌面窗口和项目文件边界的现有测试模式。
- 当前不存在 Local App Runtime、开发服务器 readiness、PreviewView 安全负例或进程树回收测试。

## 3. Planned：系统边界与模块职责

### 3.1 模块职责

| 计划模块 | 计划路径 | 责任 | 不负责 |
| --- | --- | --- | --- |
| 工作区对象与恢复 | `src/components/types.ts`、`src/components/workspace-session.ts`、`src/chat-workspace-persistence.ts` | 定义并迁移 Local App Definition/Tab，维护活动目标和 Tab 生命周期；沿用现有 revision/durable save。 | 不启动进程、不判断 OS 沙箱、不直接读写任意目录。 |
| 入口与主区 | `src/components/AppShell.tsx`、`src/components/AppShellSidebar.tsx`、`src/components/AppShellWorkspace.tsx`、`src/components/LocalAppPreview.tsx`（均为现有小改或 Planned 新文件） | New Tab、信任确认、Local App 列表/状态、活动 Tab 路由、预览状态与操作按钮。 | 不调用 `ipcRenderer`，不传递原始 URL/命令给 Electron。 |
| Desktop Seam | `src/desktop-api.ts`、`src/desktop-types.ts`、`src/desktop-seam.ts`、`electron/preload.ts` | 为 inspect/trust/runtime/preview 定义 named typed invoke/event；事件取消订阅和 payload 校验。 | 不暴露 generic `invoke/send/on/off` 或原始 WebContents。 |
| Runtime Manager | `electron/local-app-runtime/`（Planned） | 按 Local App 复用 Runtime，协调 TrustStore、Supervisor、PreviewManager，过滤 stale generation。 | 不让 renderer 自己 spawn，不硬编码 CodeNow Wiki。 |
| Runtime Supervisor | `electron/local-app-runtime/supervisor.*`（Planned） | 检查 `package.json`、依赖准备、`npm run dev`、日志、readiness、有限重启和停止。 | 不提供 OS 级文件/网络隔离承诺。 |
| Preview Manager/Gateway | `electron/local-app-runtime/preview.*`（Planned） | 创建独立 Preview WebContents、绑定 ready URL、限制导航/窗口/权限、刷新/HMR。 | 不向页面注入 Node/Electron bridge，不接受 renderer 任意导航。 |
| Trust/Sandbox | `electron/local-app-runtime/trust-store.*`、`sandbox-adapter.*`（Planned） | 持久化安全信任授予，提供受信本地进程适配器接口；为未来真实 Sandbox Provider 留边界。 | 首期不宣称强沙箱；Provider 选择尚未定案。 |

### 3.2 数据所有权

```text
ChatWorkspaceState（renderer durable UX binding）
  ├─ LocalAppDefinition[]
  ├─ LocalAppTab[]
  └─ activeLocalAppTabId

Electron Main（runtime/security state）
  ├─ RuntimeInstance（内存，退出后丢弃）
  ├─ PreviewSession（内存，视图关闭后丢弃）
  ├─ RuntimeGrant / TrustStore（Planned 持久化）
  └─ PreparationRecord（Planned 持久化的 lockfile 摘要）
```

renderer 的 durable 快照是用户可见的绑定和 Tab 事实；Main 的 TrustStore 是自动执行前的安全闸门。两者不互相盲信：启动必须同时满足快照的 `trustStatus=trusted`、Main 的有效 `RuntimeGrant`、目录 canonical path 复核和 `package.json`/`dev` 脚本复核。快照写入失败时遗留 grant 不会触发自动运行，因为没有对应的已恢复 Tab/Definition。

## 4. Planned：数据模型、状态与迁移

### 4.1 工作区 durable 类型

计划在 `src/components/types.ts` 增加下列类型；字段名是实现契约草案，具体序列化归一化由实现任务落地：

```ts
type LocalAppTrustStatus = 'trusted' | 'revoked'

type LocalAppDefinition = {
  id: string
  name: string
  rootPath: string
  // 由 Main realpath 得到，用于去重和信任复核；不凭 renderer 字符串判断同一目录。
  canonicalRoot?: string
  packageManager: 'npm'
  devCommand: { executable: 'npm'; args: ['run', 'dev'] }
  trustStatus: LocalAppTrustStatus
  autoStart: boolean
  createdAt: number
  updatedAt: number
}

type LocalAppTab = {
  id: string
  localAppId: string
  title: string
  createdAt: number
  updatedAt: number
}

type LocalAppRuntimeStatus =
  | 'preparing'
  | 'starting'
  | 'running'
  | 'degraded'
  | 'failed'
  | 'path_missing'
  | 'stopped'

type RuntimeInstance = {
  localAppId: string
  runtimeId: string
  generation: number
  status: LocalAppRuntimeStatus
  readyUrl?: string
  port?: number
  restartAttempt: number
  startedAt?: number
  updatedAt: number
  stopReason?: 'user' | 'last-consumer' | 'app-quit' | 'crash' | 'error'
}

type PreviewSession = {
  previewId: string
  localAppId: string
  tabId: string
  runtimeId: string
  generation: number
  status: 'creating' | 'loading' | 'ready' | 'failed' | 'closed'
}

type RuntimeGrant = {
  canonicalRoot: string
  trustStatus: 'trusted' | 'revoked'
  grantedAt: number
  revokedAt?: number
}
```

`ChatWorkspaceState` 计划增加 `localAppDefinitions: LocalAppDefinition[]`、`localAppTabs: LocalAppTab[]` 和 `activeLocalAppTabId: string`（旧快照缺失时归一化为空字符串）。现有 `activeProjectId`/`activeThreadId` 保留：切换到 Local App 时保存并保留最近聊天选择，切回聊天时不丢失原项目/线程；切换聊天时清空 `activeLocalAppTabId`。这避免把旧项目/线程活动选择改成破坏性联合类型。

RuntimeInstance、PreviewSession、最近日志和 PID 不进入工作区 durable snapshot。持久化 PID/端口不能作为恢复依据；每次恢复都创建新的 runtime/generation 并重新探测 readiness。

### 4.2 Main 侧安全与准备记录

以下路径和模块均为 Planned，不代表当前存在：

- `userData/local-app-trust.json`：只保存 canonical root、授予/撤销时间和信任状态，不保存命令输出或环境变量。
- `userData/local-app-preparation.json`：按 canonical root 保存 package manager、lockfile 路径/摘要和最近准备时间；摘要用于判断依赖是否需要重新准备，不用于安全授权。
- `electron/local-app-runtime/LocalAppStore`：读写上述记录并串行化 trust/revoke/prepare 更新。

若后续决定把 `RuntimeGrant` 直接并入 ChatWorkspace 快照，必须保持 Main 侧独立复核；不能仅因为 renderer 快照标记为 trusted 就执行任意脚本。

### 4.3 迁移与恢复

1. `normalizeChatWorkspaceState` 对旧 JSON/SQLite 快照补空的 `localAppDefinitions`、`localAppTabs` 和 `activeLocalAppTabId`，保留现有项目、线程和 revision。
2. 过滤悬空 Tab/Definition 引用；不因目录暂时不可达删除定义或 Tab。
3. `WorkspaceSession.restore` 先恢复旧聊天选择，再校验 Local App active Tab 是否存在；目录缺失进入 `path_missing`，用户仍可重新定位或移除。
4. Renderer 加载完成后，把已信任且仍有持久化 Tab 的定义注册/启动请求发送给 Main；Main 不盲信旧 PID、旧端口或旧 ready URL。
5. 关闭最后一个 Tab 会删除/归档该视图并减少 runtime consumer 引用；是否停止由 RuntimeManager 的 stop policy 决定，首期建议无消费者即停止，避免隐藏后台进程。
6. 移除定义前先停止对应 runtime、销毁 PreviewSession、撤销 grant，再从工作区 durable 状态移除；失败时保留可恢复错误而不静默丢绑定。

## 5. Planned：IPC、调用链与事件契约

### 5.1 Typed Desktop Seam

在现有 `DesktopAPI`/`DESKTOP_INVOKE_CHANNELS`/`DESKTOP_EVENT_CHANNELS` 中增加命名能力；每个 payload 由 preload 转发、Main 再做运行时校验。建议最小接口如下（精确 TypeScript 名称以实现任务为准）：

| 能力 | 结果/边界 |
| --- | --- |
| `inspectLocalAppDirectory(rootPath)` | 只读检查 canonical root、`package.json`、`scripts.dev` 和 lockfile；返回 `invalid-root`、`package-json-missing`、`dev-script-missing` 等可读错误，不启动代码。 |
| `trustLocalAppDirectory(rootPath)` | 仅在用户确认后写入 Main TrustStore，返回规范化 Definition 元数据；不得接受 renderer 传来的 trusted 标记作为唯一依据。 |
| `revokeLocalAppTrust(canonicalRoot)` | 撤销 grant；若有 runtime，先进入停止流程。 |
| `getLocalAppRuntime(localAppId)` | 返回当前快照；无 runtime 时返回 `stopped`/`path_missing` 以及可恢复原因，不能返回 stale PID/端口作为运行事实。 |
| `startLocalAppRuntime(target, cause)` | `cause` 为 `user` 或 `restore`；Main 复核信任、目录、脚本后幂等启动，重复请求复用同一 promise/RuntimeInstance。 |
| `stopLocalAppRuntime(localAppId, reason)` | reason 为 `user`、`last-consumer` 或 `app-quit`；使当前 generation 失效并回收进程树。 |
| `restartLocalAppRuntime(localAppId)` | 先停止旧 generation，再创建新 `runtimeId/generation`；不复用旧 ready URL。 |
| `createLocalAppPreview(tabId, localAppId)` | Main 根据 runtime ready URL 创建隔离 PreviewSession；renderer 不传任意 URL。 |
| `setLocalAppPreviewBounds(previewId, bounds)` | 同步 WebContentsView 在主窗口中的矩形；只接受当前窗口/当前 session 的受控范围。 |
| `reloadLocalAppPreview(previewId)` | 仅刷新当前 session，不能改变其 origin。 |
| `closeLocalAppPreview(previewId)` | 解除 consumer 引用并销毁 WebContentsView。 |
| `onLocalAppRuntimeEvent(handler)` | 事件取消订阅；所有事件必须带 `localAppId`、`runtimeId`、`generation`。 |

建议 channel 名称保持现有命名风格，例如 `desktop:local-app:inspect`、`desktop:local-app:start`、`desktop:local-app:event`；不要在 renderer 或 preload 中新增裸 `ipcRenderer.invoke('...')`。

### 5.2 Runtime 快照与事件

运行态快照/事件至少包含：

```ts
type LocalAppRuntimeEvent = {
  type: 'snapshot' | 'status' | 'log' | 'ready' | 'exit'
  localAppId: string
  runtimeId: string
  generation: number
  status: LocalAppRuntimeStatus
  readyUrl?: string
  port?: number
  stream?: 'stdout' | 'stderr'
  line?: string // 已脱敏、长度受限
  code?: number | null
  signal?: string | null
  detail?: string
  timestamp: number
}
```

Renderer 只接受 `localAppId`、`runtimeId`、`generation` 与当前请求匹配的事件；`generation` 更旧的 partial/final/exit/log 都丢弃，不能写回新启动或新 Tab。事件应按状态合并、日志限流，避免 npm 输出把 renderer 队列打满。

### 5.3 主调用链

```text
侧栏 New Tab
  -> AppShell 请求现有目录 picker（或等价 typed picker）
  -> inspectLocalAppDirectory
  -> 信任确认 UI
  -> trustLocalAppDirectory
  -> WorkspaceSession.addLocalAppDefinition/addLocalAppTab
  -> stage：即时 renderer snapshot + 防抖 ChatWorkspaceStore
  -> startLocalAppRuntime(localAppId, user)
  -> Supervisor 检查依赖并 spawn npm run dev
  -> stdout/stderr 脱敏、URL 解析、HTTP readiness probe
  -> Runtime event(ready, localAppId/runtimeId/generation)
  -> createLocalAppPreview + LocalAppPreview
  -> AppShellWorkspace 渲染预览并允许 refresh/restart/stop/close
```

恢复路径为：

```text
App ready -> loadChatWorkspaceState -> normalize/restore
  -> 对有 Tab 的 trusted Definition 逐个提交 restore start
  -> Main 复核 TrustStore + canonical root + package.json/dev
  -> 新 RuntimeInstance/generation -> readiness
  -> 恢复 activeLocalAppTabId 对应 PreviewSession
```

恢复启动是异步的，不能阻塞主窗口显示；在 ready 前先显示 `preparing`/`starting`，失败显示最近脱敏日志与重试入口。

## 6. Planned：自动启动、readiness、HMR 与进程生命周期

### 6.1 依赖准备与启动

1. Main 对 canonical root 读取 `package.json`，必须确认 `scripts.dev` 存在；首期 command 不接受 renderer 任意 executable/args，只生成 `npm run dev`。
2. 以 lockfile 摘要和 `node_modules` 可达性判断是否需要准备依赖：本实例检测到 `package-lock.json`；缺少依赖或 lockfile 摘要变化时进入 `preparing`。
3. 有 lockfile 时优先使用 `npm ci`，无 lockfile 时使用 `npm install`；依赖准备同样是受信目录中的代码执行/网络行为，必须显示状态、日志、失败原因和取消语义，不修改 CodeNow Wiki 源码。
4. 准备完成后以 Main 子进程启动 `npm run dev`，`cwd` 为 canonical root，`shell: false`，环境使用最小 allowlist；不把 renderer 的环境变量或完整宿主环境透传给项目。
5. 缺少 `package.json`、`dev` 脚本、npm、依赖安装失败或目录不可达均在启动前转为可观察失败，不进入无意义重试。

### 6.2 Readiness 与动态端口

- 不硬编码 `3000` 或任何项目端口。
- Supervisor 从 stdout/stderr 解析开发服务器输出中的 `http://localhost:<port>`/loopback URL，再对该 origin 做有界 HTTP readiness probe；只接受 loopback origin，状态为 200/3xx 且进程仍存活才进入 `running`。
- 对 Next.js `next dev`，优先使用其启动日志中的 Local URL；HMR WebSocket 使用相同 origin，不另做端口推断或 URL 重写。
- 未输出可识别地址、HTTP probe 超时、只监听外部地址或进程提前退出时进入 `failed`，保留脱敏最近日志和 `readiness_timeout`/`invalid_ready_origin` 错误码。
- readiness、依赖准备和停止都必须可取消；取消后旧 generation 的 late event 不能再次变成 `running`。

### 6.3 HMR、刷新与重启

- PreviewManager 在 runtime ready 后加载 ready URL；同源 `ws/wss` HMR 连接只允许绑定到当前 loopback origin。
- HMR 断线但开发进程仍活着时，Preview 保持 `degraded`/可重连状态并提供刷新；不能自动启动第二个 server。
- `refresh` 只 reload 当前 PreviewSession；`restart` 使旧 generation 失效、停止旧进程树并新建 generation；两者不能混用为隐式重启。
- 多 Tab 通过同一 `RuntimeInstance` 复用 ready URL；`canonicalRoot + normalized command` 是去重键，避免重复端口和重复 HMR server。

### 6.4 崩溃退避、停止与进程树

- `start` 在 `preparing`/`starting`/`running` 时幂等返回当前实例；`stop` 取消等待、使 generation 失效并禁止用户主动停止后的自动拉起。
- 非用户主动停止的崩溃采用有限次数退避（实现默认可先取 3 次、指数延迟；具体数值需在实现/验收中固定），超过上限进入 `failed`，不能无限重启。
- POSIX 使用独立 process group 和组级终止；Windows 使用等价的进程树终止策略（如 `taskkill /T`），两者都要等待/复核子进程退出；不能只杀 npm wrapper 留下 Next/Node 孤儿进程。
- `app.on('before-quit')` 计划调用 `RuntimeManager.stopAll({ reason: 'app-quit' })`，在有界超时内回收受管进程、Preview WebContents 和 watcher，再允许退出。超时要记录但不能阻塞无限时长。
- 运行时不持久化 PID、端口或进程句柄；应用重启总是重新 spawn 和 readiness probe。

## 7. Planned：Preview 隔离与安全边界

### 7.1 PreviewManager 策略

推荐由 Main 创建挂载到主窗口的独立 `WebContentsView`，而不是把任意 URL 直接交给应用 renderer 的 iframe/主文档。每个 PreviewSession 使用独立 partition、无应用 preload，并显式设置：

- `nodeIntegration: false`；
- `contextIsolation: true`；
- `sandbox: true`；
- 不暴露 `desktop`、`ipcRenderer` 或 `claudeChat` bridge；
- `setWindowOpenHandler` 拒绝新窗口/弹窗；
- `will-navigate` 只允许当前 runtime 的 loopback origin；外部 URL 不自动放行；
- 权限请求默认拒绝，除非未来有明确的逐项授权契约；
- 下载、协议跳转、DevTools 和跨 origin 导航按安全策略拒绝或转为可观察错误。

Preview 只从 Main 保存的 `readyUrl` 导航，renderer 没有设置任意 URL 的 API。WebContentsView 的 bounds/visibility 由 typed seam 同步，Tab 切换必须先隐藏旧 Preview 并校验 `previewId`，避免旧页面覆盖新活动 Tab。

### 7.2 信任与 Sandbox 未知

首期 `TrustedLocalProcessAdapter` 只提供进程生命周期和受信目录约束，安全能力明确标记为 `filesystemIsolation: false`、`networkIsolation: false`。它的前提是用户已确认该目录将执行本地脚本；UI 必须写明“受信任本地运行”，不能宣传“项目外文件已被强制阻断”。

计划保留如下接口边界：

```ts
interface SandboxAdapter {
  readonly providerId: string
  readonly capabilities: {
    filesystemIsolation: boolean
    networkIsolation: boolean
    environmentIsolation: boolean
  }
  prepare(spec: RuntimeSpec): Promise<void>
  spawn(spec: RuntimeSpec): Promise<ManagedProcess>
  stopTree(process: ManagedProcess, reason: StopReason): Promise<void>
}
```

生产 Provider 选容器、微虚拟机还是平台原生 sandbox 仍是未知项；必须有 PoC 覆盖项目外文件、网络、环境变量和子进程逃逸后才能提升为安全发布能力。不能在本轮静默选型，也不写入 ADR。

## 8. Planned：日志、隐私与可观测性

- Main 只记录 runtimeId/localAppId/generation、状态转移、退出码、readiness 结果和错误分类；不记录 API key、token、密码、完整环境变量或用户文件内容。
- stdout/stderr 进入每个 Runtime 的有界内存 ring buffer，行长、总量和事件频率受限；renderer 只接收脱敏、截断后的最近日志。原始日志不写入 workspace snapshot，也不默认落盘。
- 脱敏覆盖常见 `KEY/TOKEN/SECRET/PASSWORD` 赋值、Bearer/token 片段和当前进程环境中的已知凭据值；脱敏是降低泄漏概率的措施，不是 OS 安全边界。命令本身固定为 `npm run dev`，不把用户自定义参数拼入错误或日志。
- 每条用户可见错误至少包含阶段（inspect/prepare/start/readiness/preview/stop）、稳定 error code、简短原因和恢复动作（重试、重新定位、移除）；原始 stack 仅留 Main 调试日志且同样不得含密钥。
- 运行状态事件可被 renderer 订阅/取消订阅；路由切换、Tab 关闭和组件卸载时必须取消 listener，避免内存泄漏和旧事件写回。

## 9. Planned：质量属性与测试计划

### 9.1 需要验证的不变量

- 一个 `canonicalRoot + command` 同时最多一个活动 Runtime；多个 Tab 共享而不重复启动。
- 任何状态事件都带 `localAppId/runtimeId/generation`；旧 generation 不能改变当前 UI。
- `start/stop/restart/close` 并发安全；停止后不被 late event 或崩溃重试重新拉起。
- 启动成功必须经过动态 readiness probe；旧 PID、旧端口或仅有进程存活不能冒充 `running`。
- 应用退出后不留下受管子进程；停止/崩溃/超时均有可观察状态和恢复动作。
- Preview 页面没有 Electron/Node 能力，不能创建未受控窗口、导航到未授权目标或获得未授权权限。
- 旧工作区快照可读；Local App 新字段缺失/损坏只回退为空集合，不破坏旧项目/线程。

### 9.2 计划测试层次

| 层次 | 计划覆盖 | 计划位置/方式 |
| --- | --- | --- |
| 纯单元 | Definition/Tab 归一化、WorkspaceSession 活动选择、迁移、去重键、状态转移和 generation 过滤 | 扩展 `electron/workspace-session.test.mjs` 或新增 Planned runtime/session unit tests。 |
| Supervisor 单元 | fake spawn、依赖准备、URL 解析、readiness 超时、有限退避、取消和 process-tree adapter | `electron/local-app-runtime/*.test.mjs`（Planned）。不启动真实项目。 |
| IPC 合同 | `DesktopAPI`/seam/preload/main channel 对齐、无裸 IPC、事件 payload 校验和取消订阅 | 扩展 `electron/desktop-seam.test.mjs`（Planned）。 |
| 集成 fixture | 受控本地 fixture 自动 `npm run dev`、动态端口、HMR/reload、重启、停止和孤儿进程检查 | Planned fixture；不把 CodeNow Wiki 当作唯一测试替代。 |
| Preview 安全负例 | 无 Node/Electron bridge、外部导航、`window.open`、权限请求、跨 origin/WebSocket 和旧 preview 覆盖 | Electron integration test（Planned）。 |
| 真实 smoke | 选择 `/Volumes/macOS/Github/codenow.wiki`，检查 `dev` 脚本、真实 readiness 和页面显示 | 对应 `ATDD-P0-03`；环境不可用时保持未验证，不能用 fixture 冒充。 |
| 正式验收 | P0/P1 GWT 逐条独立验证 | `prd/local-app-runtime/acceptance.md`，由 `project-verify` 产生正式证据。 |

建议实现稳定选择器：`local-app-new-tab`、`local-app-trust-confirm`、`local-app-runtime-status`、`local-app-runtime-log`、`local-app-preview`、`local-app-retry`、`local-app-restart`、`local-app-stop`；这些是 Planned 测试接口，不改变产品文案或验收事实源。

## 10. Planned：性能、可靠性与跨平台

- 应用启动先恢复 UI，再异步启动 trusted Local App；单个项目的依赖准备/启动失败不能阻塞其他 Tab 和主窗口。
- Runtime 以 Map 按 dedupe key 管理，事件按状态合并、日志限流；Preview 只为活动/仍有消费者的 Tab 保留 WebContentsView，避免每个事件重建页面。
- readiness、依赖安装、停止和退出清理均有超时；超时进入可观察错误并继续清理，不无限等待。
- canonical root 使用 `fs.realpath`；Windows 路径/`npm.cmd`/进程树终止与 POSIX process group 分开实现。路径分隔符、大小写敏感性、symlink 变更、IPv4/IPv6 localhost 和 shell quoting 必须在 macOS/Windows/Linux（若发布支持）分别测试。
- 不使用 `shell: true` 拼接命令；通过平台适配选择 npm executable，防止路径中空格和 shell 注入。
- 预览 origin 只允许 runtime 报告的 loopback 地址；若开发服务监听 `0.0.0.0` 或输出不可验证地址，首期进入 `invalid_ready_origin`/`failed`，不保证网络隔离。该限制不能替代生产 Sandbox Provider。
- 当前仓库依赖 Electron `^30.0.1`、TypeScript `^5.2.2`、Vite `^5.1.6`；WebContentsView bounds、sandbox 和权限策略必须在目标平台的 Electron 集成测试中核对，不能只依据类型检查通过。

## 11. 技术风险、未知与 ADR 候选

### 已知风险

1. 自动依赖准备和 `npm run dev` 会执行受信目录中的 lifecycle/script 代码并可能访问网络；信任提示必须发生在执行前。
2. 没有 OS sandbox 时，恶意/被攻陷项目可以读取宿主文件、环境或创建子进程；路径校验、cwd、utilityProcess 和 renderer sandbox 都无法消除该风险。
3. 任意 Web 项目未必输出可解析的 ready URL，或可能监听非 loopback 地址；需要明确失败而不是猜端口。
4. Windows wrapper、macOS/Linux process group 和开发服务器子孙进程的回收语义不同，容易留下孤儿进程。
5. WebContentsView 的 bounds 同步、HMR WebSocket、窗口/权限拦截在三平台上可能有实现差异。

### 未知/阻断项

- 生产 `SandboxAdapter` Provider、能力证明和跨平台逃逸测试尚未定案；在此完成前不能对外承诺“项目外不可访问”。
- 是否允许受信应用使用自定义环境变量、非 npm 包管理器和自定义 dev 参数尚未确认；首期按 `npm run dev`、最小环境 allowlist 收窄。
- 最后一个 consumer 关闭后的具体 grace period 尚未成为产品契约；首期可采用立即停止，后续若需要后台保持再单独确认。
- WebContentsView 在目标 Electron 30 打包平台上的布局/输入/权限行为需 PoC；若推荐实现不可行，应回到主 Agent 做取舍，不静默改成弱隔离 iframe。

### ADR 候选（本轮不写入 `docs/adr/`）

- 生产 Sandbox Provider 及其跨平台能力证明；需用户确认、ADR 门禁、主 Agent 预留编号和精确路径后才能记录。
- Preview WebContentsView 与其他承载方式的跨平台最终选择；仅在 PoC 结果要求长期追溯时记录。

## 12. 实施顺序与变更追踪

建议实施顺序：

1. `DEV-P0-01`：工作区类型、归一化、迁移、New Tab、活动目标和 LocalAppPreview 路由。
2. `DEV-P0-02`：Main RuntimeManager/Supervisor、typed IPC、依赖准备、readiness、状态事件和进程树回收。
3. `DEV-P0-03`：不修改 CodeNow Wiki 的真实目录 smoke 与接入配置/测试。
4. `DEV-P1-01`：恢复、Runtime 复用、引用计数、退出清理和 stale event。
5. `DEV-P1-02`：隔离 Preview、HMR、导航/窗口/权限负例。

对应 ATDD 为 `ATDD-P0-01` 至 `ATDD-P1-02`，唯一正式契约为 `prd/local-app-runtime/acceptance.md`。Later `LATER-01` 至 `LATER-03` 不在本轮技术完成定义内，尤其不因本文件的 `SandboxAdapter` 抽象而宣称安全能力已经实现。

## 13. 最近同步摘要

- 日期：`2026-08-25`。
- 方案输入：`changes/active/chg-20260825-local-app-tabs-runtime/{proposal.md,design.md,tasks.md}`，revision `1`，decision `accepted`。
- Current 依据：`src/components/*` 工作区/侧栏/主区代码、`src/desktop-*`、`electron/main.ts`、`electron/preload.ts`、`package.json`、`/Volumes/macOS/Github/codenow.wiki/package.json` 及现有 workspace/desktop technical 文档。
- 本轮写入：`prd/local-app-runtime/technical.md`（本文件）。未修改业务代码、CodeNow Wiki、TODO、Acceptance、change 或索引；未执行项目启动、依赖安装或真实 smoke。
- 这是 Planned 方案同步，不创建 as-built 同步 commit，也不把不存在的 `electron/local-app-runtime/`、`LocalAppPreview.tsx` 或 Preview/Sandbox 实现写成 Current。
