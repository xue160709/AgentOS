# Workspace Runtime 技术文档

## Revision 4 Current / as-built：静态 Runtime 技术合同

### 声明、探测与兼容

- 静态项目通过 `package.json.agentos` 声明 `{ mode: "static", buildCommand: "npm run build", outputRoot: "out", entryFile: "index.html" }`。Main 只接受这一固定 build command；`outputRoot`/`entryFile` 必须是无绝对路径、反斜杠、NUL 和 `..` 的相对路径，最终 realpath 必须位于 canonical root 内。
- 没有有效静态声明的既有 Definition 继续按 Revision 2 的固定 `npm run dev` 合同运行。静态 Definition 的默认 `start/restore` 只解析 last-good，不 spawn；显式 development action 才进入旧 supervisor。
- Renderer 只能传 runtimeDefinitionId、consumer/host 和预期 generation/operation；不得传 executable、args、cwd、输出目录、文件 URL 或任意 ready URL。

### 构建产物与原子切换

- 用户触发 build 后，Main 在复核信任、canonical root、package 声明和当前 operation 后执行固定 `npm run build`。同一 Definition 的 build 串行化；取消、重复点击和 late exit 使用 buildId/operationId 隔离。
- 项目构建到自己的 `outputRoot`。命令成功后，Main 递归校验输出根和入口、不跟随根外符号链接，再复制到 `userData/runtime-static/<definition-key>/artifacts/<artifact-id>/` 临时目录；校验完成后以原子 manifest/pointer 切换 `last-good`。
- Preview 从不直接服务项目 `out`，也不在 build 开始时替换 last-good。构建失败、取消、复制失败或 AgentOS 重启只清理未提交 staging；已有 last-good 保持可用。
- 第一次打开且缓存尚不存在时，可从已存在且通过相同校验的项目 `outputRoot` 导入一次；没有安全产物则返回 `build_required`。源码 stale 检查排除 `.git`、`node_modules`、`.next`、声明的输出目录和常见构建目录，并在页面可见后异步执行。

### 静态协议与 Preview 安全

- Electron 在 `app.ready` 前注册私有标准安全 scheme，并由每个 Preview 的隔离 session 注册 Main-owned handler。URL 使用 Main 生成的不透明 host/runtime token；Renderer 只接收当前 generation 的 ready URL。
- handler 只允许 `GET/HEAD`。对 URL 解码、规范化和路由候选（`/` → `index.html`，`/route` 与 `/route/` → `route/index.html`）逐级做 lexical containment 与 realpath containment；拒绝编码穿越、NUL、反斜杠、符号链接逃逸、跨 host/runtime 访问、目录列表和构建根外读取。
- 响应使用固定 MIME 映射和最小安全 headers。Preview 继续 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、无应用 preload；外部导航、窗口创建和权限申请继续拒绝，不因静态模式增加文件或 Electron bridge。

### 类型、事件与 UI seam

- `RuntimeDefinition` 增加向后兼容的 mode/static build 配置；`RuntimeSnapshot`/`RuntimeEvent` 增加 mode、buildStatus、artifact/build 标识、stale 与最后成功时间。现有 runtimeId/generation 校验继续成立。
- Desktop Seam 增加 Main-authoritative `buildRuntime(definitionId)` 与显式静态/开发模式切换动作。build 日志沿用脱敏和有界 ring buffer，不高频提交 AppShell 根状态。
- 静态 ready 不拥有项目子进程；Stop 只关闭显式 development supervisor 或取消当前 build，不删除 last-good。移除 Definition 时是否清理 AgentOS 私有缓存必须与 workspace 权威删除同序完成，不删除项目目录或项目 `out`。

### CodeNow Wiki 静态导出

- Next.js 配置使用 `output: "export"`、`trailingSlash: true` 和 unoptimized images；`npm run build` 生成 `out/index.html` 及完整路由资源。
- 教程内容在 build 前复制到 `public/tutorials` 并使用静态 URL；依赖 Route Handler 的教程 API 被移除。CodeNow Radar/Quota 改为构建时快照或静态页面，不保留需要运行时 Next server 的 Route Handler/redirect。
- `npm run dev` 仍可独立用于显式开发模式；静态导出失败不得影响 AgentOS 已保存的 last-good。

本节为 Revision 4 Current/as-built 技术事实。实现已通过 `npm run typecheck`、完整 Electron 145/145 测试、CodeNow Wiki 624/624 静态页面构建与第三轮独立 Development Check；正式 Acceptance 仍只由 `project-verify` 更新。

## Revision 2 Current / as-built 技术合同

- durable schema 升级到 v3：`runtimeDefinitions`、`workspaceTabs`、`activeWorkspaceTabId`、`projectHomeViewModes`；读取时一次性兼容 Revision 1 的 `localAppDefinitions/localAppTabs/activeLocalAppTabId`，保留 id、用户标题、信任和活动选择，损坏信任降为 revoked；新写入只使用中性字段。
- 领域与 typed Desktop Seam 使用 `RuntimeDefinition / WorkspaceTab / Runtime*` 中性命名。旧 `localApp*` 仅允许留在迁移读取、历史文档或内部物理目录，不再出现在用户界面。
- Runtime 继续按 `canonicalRoot + command` 去重。consumer 使用 `tab:<workspaceTabId>` 与 `project-home:<projectId>:<mountId>`，项目首页不得通过创建隐藏 Tab 获得 Runtime。
- Preview host 为判别联合：`workspace-tab` host 校验权威 Tab，`project-home` host 校验项目、mount 和对应 Definition；异步创建后再次校验 host、runtime generation 与 consumer，失效结果必须关闭。
- `ProjectHomeSurface.tsx` 保持不变；新的 Runtime 页面由独立 `ProjectHomeRuntimeView.tsx` 承载，`ChatStartView.tsx` 只负责页级视图切换。

实现已完成并通过第三轮独立 Development Check。类型检查、构建、diff check 通过；定向测试 57/58 通过，唯一失败为受限沙箱的 loopback `listen EPERM`。以下内容是 Revision 1 历史基线，保留用于迁移与回归对照。

> 文档状态：`Current / as-built`（2026-08-25）。本文记录当前工作区中已实现的代码路径、数据不变量和可复核的开发检查；不改变 `prd/local-app-runtime/acceptance.md` 的正式状态，也不等同于正式验收。当前实现是显式信任的本地进程（`TrustedLocalProcess`），不是生产级 OS 文件系统或网络沙箱。
>
> 本次同步基于当前 dirty tree 的实现与测试。`changes/active/chg-20260825-local-app-tabs-runtime/evidence.md` 保存了 Development Check、GUI smoke 和正式验收阻塞项的过程证据；未实现的项目首页复用、Agent 沙箱代理和生产级 Sandbox Provider 在文末保留为 Later。

## 1. 代码入口与运行时分层

Local App 的入口、持久化绑定、受管进程和原生预览由四个相互独立的对象组成：

```text
AppShell / WorkspaceSession / LocalAppPreview
        │  named typed Desktop Seam
        ▼
Electron Main
  ChatWorkspaceStore     Definition / Tab / activeTab 的权威快照
  LocalAppTrustStore     canonical root 的独立信任复核
  LocalAppRuntimeManager
    └─ LocalAppRuntimeSupervisor  prepare / spawn / readiness / stop
  LocalAppPreviewManager           WebContentsView / navigation / visibility
```

| 路径 | 当前责任 | 运行时边界 |
| --- | --- | --- |
| `src/components/types.ts` | `LocalAppDefinition`、`LocalAppTab`、Runtime/Preview 状态和事件类型；`ChatWorkspaceState` 增加 Local App durable 字段 | Definition/Tab 是工作区事实；Runtime、Preview、PID、端口和日志不进入快照 |
| `src/chat-workspace-persistence.ts`、`src/workspace-snapshot-resolution.ts` | JSON/localStorage 归一化、revision/savedAt/completeness 比较和 mirror | localStorage 只是 renderer 镜像，不是 Main 持久化成功凭证 |
| `src/components/workspace-session.ts` | 活动选择、Local App Tab 生命周期、防抖保存、显式 flush 和失败重试 | 只维护工作区状态，不 spawn/stop 进程 |
| `src/components/AppShell.tsx` | New Tab、flush/revision gate、Main commit 后发布状态、Runtime attach、视图切换和恢复启动 | 只能传 root/id/revision 等受控参数，不能传命令、环境或 URL |
| `src/components/AppShellSidebar.tsx`、`AppShellWorkspace.tsx` | 独立 Local Apps 区、Tab 状态、全屏 Preview 顶部工具栏 | Local App 不伪装成项目或聊天线程 |
| `src/components/LocalAppOnboardingDialog.tsx`、`LocalAppWorkspace.tsx`、`LocalAppPreview.tsx` | chooser/信任确认、状态和恢复动作、原生 Preview 宿主 bounds/visibility 协调 | renderer 不直接嵌入任意站点 URL |
| `electron/local-app-runtime/index.ts` | inspect、TrustStore、RuntimeManager/Supervisor、依赖准备、readiness、generation、consumer 和进程树 | 首期是受信本地进程，不提供 OS 级隔离 |
| `electron/local-app-runtime/preview.ts` | Main-owned `WebContentsView`、安全拦截、session partition、reload 和 Preview race 防护 | 只加载当前 Runtime 提供的 loopback ready URL |
| `electron/main.ts`、`electron/preload.ts`、`src/desktop-api.ts`、`src/desktop-seam.ts` | Main IPC 装配、typed preload bridge 和 named channel 合同 | 不暴露通用 `ipcRenderer` |

同一 `canonicalRoot + npm run dev` 通过 RuntimeManager 去重；一个 Definition 可以有多个 Tab/PreviewSession，但同一 dedupe key 只有一个受管 Runtime。关闭 Tab 只影响该 Tab 的 consumer；只有最后一个 consumer、显式 Stop/Remove 或 app quit 才停止 Runtime。

## 2. Durable 工作区与双介质恢复

### 2.1 快照字段和归一化

`ChatWorkspaceState` 当前包含：

- `localAppDefinitions`：Definition id、名称、用户选择的 `rootPath`、Main 复核得到的 `canonicalRoot`、固定 `npm run dev` 配置、`trustStatus`、`autoStart` 和时间戳；
- `localAppTabs`：唯一 Tab id、所属 Definition、标题和时间戳；
- `activeLocalAppTabId`：当前 Local App 活动选择；
- `workspaceRevision`、`workspaceSchemaVersion`、`snapshotComplete`：JSON 与 SQLite 共享的逻辑时钟和快照完整性元数据。

Runtime snapshot、PreviewSession、PID、端口、Runtime 日志、consumer 集合和 Preview WebContents 均只存在 Main/renderer 内存。`LocalAppTrustStore` 独立保存 `userData/local-app-trust.json`；依赖准备摘要独立保存 `userData/local-app-preparation.json`。

`normalizeChatWorkspaceState` 的坏字段策略是保守不可执行：

- 缺失或非数组的 Local App 集合归一化为空；未知/损坏的信任字段归为 `revoked`，不能因为快照内容自动执行；
- 悬空或重复 Tab 被丢弃，Definition 保留；无效的活动 Tab 回退为空；
- 旧快照缺少新字段时仍可读取项目、线程和活动选择；Local App-only 快照因有 Definition/Tab 不会被判为空；
- `pathMissing` 是项目运行时标记，不进入 durable fingerprint；Local App 目录暂时不可达不删除 Definition/Tab。

### 2.2 ChatWorkspaceStore

`electron/chat-workspace-store.ts` 的 `ChatWorkspaceStore.read()` 同时读取 JSON 和 SQLite `workspace_meta`，由 `resolveChatWorkspaceSnapshot` 按 revision、savedAt、schema/complete 和 Local App/聊天完整度选择逻辑较新的快照；正常快照不依赖 SQLite 文件 mtime。缺少保存时间的历史 JSON 只使用文件时间作为兼容性的 freshness fallback。

`save()` 的顺序和失败语义如下：

1. 归一化 state；没有有效 revision 时分配下一 revision；线程 rollout 文件先以临时文件写入并 rename。
2. SQLite 侧在 `BEGIN`/`COMMIT` 事务中更新 `workspace_meta`、项目和线程行；`workspace_meta` 保存 Local App JSON、active tab、revision、schema 和 complete。
3. JSON 侧写入同目录带 PID/时间后缀的临时文件，再 `rename` 原子替换 `chat-workspace.json`，不直接覆盖目标文件。
4. SQLite 和 JSON 各自尝试，至少一个介质成功就返回保存结果；两边都失败才抛出稳定的 `workspace-save-failed`。一侧损坏时另一侧可作为恢复源；搜索索引是可重建附属数据，不掩盖已提交的工作区事务。

Renderer 的 `WorkspaceSession.stage()` 先把去掉 runtime-only 字段的快照写入 localStorage mirror，再安排 750ms 防抖保存。`flush()` 会传播 Main 保存错误；失败的 pending snapshot 被保留，下一次显式 flush 可以重试相同内容。AppShell 通过 `onSaveError` 显示持久保存失败和 Retry，不把后台失败静默成成功。

### 2.3 Main-authoritative 操作与并发

Main 用 `runChatWorkspaceOperation()` 串行化工作区写操作。创建、打开和重新定位均以 renderer flush 后从 `getChatWorkspace()` 读到的 authoritative revision 调用，并由 Main 再读快照做 expected revision gate；revision 不匹配返回 `workspace-conflict`，不会用旧 renderer state 覆盖聊天/项目变化。

创建/打开/重新定位返回的 workspace 是 Main 保存并 readback 后的快照。Renderer 只有收到成功结果后才更新 React state 和 localStorage；Main 的 `createLocalApp`/`openLocalAppTab` 只负责 inspect、信任/复核、保存、readback 和 Runtime register，不启动进程。Renderer 发布可见 Tab 后才显式调用 `startLocalAppRuntime(definition.id, 'user', tab.id)`。

## 3. Main-authoritative Local App 生命周期

### 3.1 New Tab、绑定和打开既有应用

调用链：

```text
New Tab
  -> 隐藏当前 Preview（不 release consumer）
  -> chooser：打开已接入应用 / 绑定新的本地应用
  -> 原生目录 picker + inspect（只读）
  -> 信任确认
  -> flush renderer pending state
  -> Main get authoritative revision + createLocalApp
  -> save/readback Definition + 唯一 LocalAppTab
  -> Renderer setChatWorkspace + localStorage mirror
  -> startLocalAppRuntime
```

- `LocalAppOnboardingDialog` 在 chooser 和信任确认之间保持打开；点击“绑定新的本地应用”时进入 picker，但不会先卸载 chooser。picker 取消仍回到 chooser；只有用户再次取消 chooser 才恢复原活动 Preview。
- inspect 只复核 canonical root、目录、`package.json`、`scripts.dev`、lockfile 和 `node_modules`，不执行项目代码。Renderer 不传 executable/args/env/URL；Definition 的 command 在 Main/归一化中固定为 `npm run dev`。
- Main 发现相同 canonical root 时复用既有 Definition，只创建新的唯一 Tab；创建和 open 都会在持久化前检查 Tab id collision，连续打开同一个应用不会丢第二个 Tab。
- 首次 trust grant 记录 `wasTrusted`。保存失败只撤销本轮新增且此前未信任的 grant；已有 Definition/授权不被误撤销。保存/readback 失败返回结构化错误，保持对话框和 inspect 草稿，不显示 Tab、不 start。
- 打开已接入应用走 `openLocalAppTab(localAppId, expectedRevision)`，Main 复核 Definition、canonical root 和独立 TrustStore，保存新 Tab 后由 Renderer 先发布再 attach/start；失败留在 chooser。

### 3.2 重新定位、移除和关闭

`relocateLocalApp` 在同一个 Main workspace operation 中读取 authoritative state、检查 expected revision、构造新 Definition 并保存。不同 root 的切换顺序为：

1. 关闭该 Local App 的 PreviewSession，并有界停止旧 Runtime；任一步失败返回可读错误，在保存新 Definition 前不 register/start 新 Runtime。
2. 为新 canonical root 授权（若需要），保存并 readback 同一 Definition id、更新后的 Tab 标题和新 root。
3. 只有新状态已经 durable 后才 register/start 新 Definition；旧 root 的授权最后撤销，若仍被其它 Definition 使用则保留。

保存或新启动失败时保留可恢复状态：本轮新 grant 会按 `wasTrusted` 撤销，已停止的旧 Runtime 会尝试恢复；新状态已保存但新 Runtime 未就绪时返回 `ok` 加 warning，保留新 Definition 和重试动作，不把它伪装成旧状态。关闭 Tab 调用 `releaseLocalAppRuntime(tab.localAppId, tab.id)`；移除/显式 Stop/Restart 会先关闭相关 Preview，再停止或撤销授权。

### 3.3 恢复与视图切换

AppShell 先显示已恢复的工作区，再异步遍历持久化的 trusted、`autoStart` Definition/Tab 调用 `startLocalAppRuntime(..., 'restore', tab.id)`。恢复不使用旧 PID、端口或 PreviewSession；目录缺失返回 `path_missing`，Definition/Tab 保留供 relocate/remove。

选择项目、线程、Docs、Settings 或其它 Local App Tab 时只把当前 Preview `setVisible(false)`；不 release consumer、不 stop Runtime。回到同一 Tab 时复用相同 Runtime generation 和现有 PreviewSession。关闭最后一个 Tab 才进入 last-consumer stop。可见性请求带序号，旧 hide/show promise 不能把已离开的 Preview 再显示回来。

## 4. Runtime Supervisor：准备、启动、就绪和回收

### 4.1 inspect、依赖准备和环境

`electron/local-app-runtime/index.ts` 中的 `inspectLocalAppDirectory()` 使用 `realpath` 得到 canonical root，要求目录、`package.json` 和非空 `scripts.dev`；返回 package name、lockfile/lock digest 和 node_modules 存在性。它不信任 renderer 传来的 command。

依赖准备记录位于 userData 下的 `local-app-preparation.json`，内容按 canonical root 保存 lock digest。文件采用临时文件 + `rename` 原子替换；启动时加载，缺失、损坏或中断写入按空记录处理。规则为：

- 有 `package-lock.json` 且 node_modules 缺失、digest 缺失或 digest 变化：执行 `npm ci`；即使 node_modules 仍在，也保守执行 `ci`；
- 无 lockfile 且 node_modules 缺失：执行 `npm install`；已有 node_modules 时跳过准备；
- `npm ci` 成功后保存 canonical root + lock digest，新的 Supervisor 实例可复用记录；lockfile 变化会再次准备。

准备和启动均使用 `shell: false`、canonical root 作为 cwd、POSIX 独立 process group（Windows 使用等价树回收）以及最小环境 allowlist：继承 `PATH/Path`、`HOME/USERPROFILE`、`TMPDIR/TMP/TEMP`、Windows 的 `SystemRoot/ComSpec/PATHEXT/APPDATA/LOCALAPPDATA` 和 `LANG/LC_ALL`，注入 `PORT`、`HOST=127.0.0.1`、`NODE_ENV=development`。其它宿主变量、`npm_config_*` 和凭据变量不透传。

### 4.2 固定命令、动态端口和 readiness

Main 只生成 `npm run dev`，通过最多 3 个 loopback 候选端口启动。Supervisor 解析 stdout/stderr 中的 localhost/127.0.0.1/::1 HTTP(S) URL，并对 loopback URL 做单次最多 1s 的 HTTP probe；只有受管进程仍存活且 probe 成功（2xx/3xx）才进入 `running`。项目忽略 `PORT` 或输出不可接受的外部 origin 时不会猜测端口，进入可读失败。

默认运行时常量集中在 `LOCAL_APP_RUNTIME_DEFAULTS`：依赖准备 120s、readiness 60s、probe interval 250ms、单次 probe 1s、端口候选 3 次、崩溃重试 3 次及 1/2/4s 退避、TERM 3s、KILL 2s、app quit cleanup 5s。状态包括 `preparing`、`starting`、`running`、`degraded`、`failed`、`path_missing`、`stopped`，并带 phase/errorCode/detail。

### 4.3 Manager、consumer、generation 和事件

`LocalAppRuntimeManager` 以 canonical root + fixed command 去重，维护 Definition owner 和 Tab consumer 集合：

- `start` 对 preparing/starting/running 幂等；重复 Tab attach 到已有 Runtime，不重复 spawn；
- `restart` 先停止旧进程，再以新 generation 启动，并保留全部既有 consumers；释放一个 consumer 不会停止仍被其它 Tab 使用的 Runtime；
- 非最后一个 consumer release 只返回当前 snapshot，最后一个 release 触发 `last-consumer` stop；显式 stop 后不会由 late event 或 crash recovery 自动重启；
- 每条 Runtime/Preview 事件携带 `localAppId`、`runtimeId`、`generation`、`timestamp`。AppShell 丢弃更旧 generation 或同 generation 的不同 runtimeId 事件；停止/取消会 abort 当前 operation。

stdout/stderr 进入有界内存 ring buffer（默认 160 行、单行 2,000 字符），先去 ANSI 和常见 Bearer/KEY/TOKEN/SECRET/PASSWORD 值，再传给 renderer。退出使用 POSIX process group 的 TERM→KILL，Windows 使用 `taskkill /T /F`；`before-quit` 在 5s 有界窗口内同时关闭 Preview 和受管进程。

## 5. Preview Manager：隔离、布局和 race 防护

### 5.1 安全承载

`electron/local-app-runtime/preview.ts` 由 Main 创建 `WebContentsView`，明确使用：

- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`；不加载应用 preload，不暴露 `desktop`、`ipcRenderer` 或 Node bridge；
- 每个 PreviewSession 使用 `local-app-${localAppId}-${tabId}-${previewId}-${generation}` 的独立非持久 partition，不跨 Tab 共享本地站点存储，也不跨应用重启长期保留；
- Main 只接受当前 Runtime 的 normalized loopback `readyUrl`；`will-navigate`/`will-redirect` 只允许同 origin loopback，`setWindowOpenHandler` 拒绝新窗口，permission request 默认拒绝。

### 5.2 Session、visibility 和 bounds

相同 `previewId + tabId + localAppId + runtimeId + generation` 的 `create()` 返回 existing session，不重新 `loadURL`；同一 Tab 进入新 generation 会关闭旧 session。创建时先把 native view 隐藏，避免原生视图遮挡 chooser；关闭 Tab/Stop/Restart/Remove/new generation 调用 `closeForTab` 或 `closeForLocalApp`，而普通卸载/切换只隐藏不关闭。

`LocalAppPreview.tsx` 在 DOM host 上使用 `ResizeObserver`、window resize 和 capture-phase document scroll 同步 bounds；纯函数 `localAppPreviewBoundsFromRect()` 与 Main `previewBoundsFromRect()` 对非法值做 clamp。visibility 与 create 请求各有序号，旧请求不能把离开的 Preview 再显示。

Main 的 `createLocalAppPreview` 在 `await PreviewManager.create()` 返回后再次读取 authoritative workspace，并检查 Tab 仍存在且 localAppId 匹配、Runtime 的 runtimeId/generation 仍匹配、session 仍是 active map entry。任一校验失败立即 `closeIfCurrent()`，避免 delayed `loadURL` 与 close-by-tab 竞态遗留隐藏 WebContentsView。

### 5.3 reload、HMR 和 Preview 状态

Preview `reload()` 只刷新当前 WebContentsView，不触碰 Runtime；成功事件顺序为 `loading -> ready`，并清除旧 `degraded/failed` detail；reject 或 `did-fail-load` 仅在 session 仍 active 时更新为 `failed/degraded`。Main 将 Preview 状态以 `phase=preview`、`status=running`、`previewStatus` 转发，renderer 不把 Preview failure 伪装成 Runtime failure。旧 generation 的 callbacks、reload reject 和 did-fail-load 都被 map identity 校验丢弃。

## 6. Typed Desktop Seam 与安全参数边界

Local App IPC 在 `src/desktop-seam.ts` 中以命名 channel 注册，主要能力为：

```text
inspectLocalAppDirectory
createLocalApp / openLocalAppTab / relocateLocalApp
trustLocalAppDirectory / revokeLocalAppTrust
get/start/stop/release/restartLocalAppRuntime
create/setBounds/setVisible/reload/closeLocalAppPreview
onLocalAppRuntimeEvent
```

`src/desktop-api.ts` 描述稳定结果类型（create/open 返回 saved workspace + Definition + Tab，不返回 Runtime）；`electron/preload.ts` 只为这些方法转发 `ipcRenderer.invoke`，bridge 以 `satisfies DesktopAPI` 校验，事件有取消订阅。Main 对 root、id、revision、bounds、reason 等 payload 做运行时校验。Renderer 无法提交 executable、args、env 或 URL；Main 会重新 inspect、canonicalize、复核 TrustStore 和快照。

## 7. UI、日志和稳定观察点

Local App 在侧栏有独立区域和 `New Tab`，不进入项目/线程 reducer。激活 Local App 时 `AppShellWorkspace` 隐藏 Agent 状态和文件面板按钮，顶部 toolbar 提供紧凑状态、`刷新预览`、`日志`、`重启`、`停止`；日志默认折叠，主区只保留 Preview stage。失败、停止和 `path_missing` 保留 Retry/Start、Relocate、Remove 等恢复动作，状态由文本、`role=status/alert` 和 selector 表达，不只靠颜色。

稳定 selector 包括：

- `local-app-new-tab`、`local-app-choose-new`、`local-app-chooser`、`local-app-trust-confirm`；
- `local-app-runtime-status`、`local-app-runtime-log`、`local-app-preview`；
- `local-app-preview-refresh`、`local-app-logs`、`local-app-retry`、`local-app-restart`、`local-app-stop`。

Onboarding dialog 打开后通过 `requestAnimationFrame` 聚焦第一个有效控件，Tab 键循环在 dialog 内，Escape 取消未提交流程；成功关闭后聚焦新 Tab，关闭 Tab 后聚焦相邻仍存在的 Local App Tab，没有则聚焦 New Tab。焦点和 visibility 都受异步请求序号保护。

日志调试应以 `localAppId/runtimeId/generation`、phase/status、errorCode、动态 ready origin 和退出原因定位；不得记录完整环境、凭据、token 或用户文件原文。`LocalAppRuntimeSnapshot.logs` 只提供脱敏、有界的最近日志。

## 8. 测试与验证边界

### 8.1 代码与测试映射

| 测试 | 当前覆盖 |
| --- | --- |
| `electron/chat-workspace-store.test.mjs` | Local App-only 快照、revision/savedAt 选择、旧 SQLite 不复活、JSON/SQLite 单边失败 fallback、双边失败 reject |
| `electron/workspace-session.test.mjs` | durable fingerprint、Local App 归一化/悬空 Tab、flush 错误传播、pending retry、localStorage mirror 与 runtime-only 字段 |
| `electron/local-app-runtime.test.mjs` | loopback/env/inspect、动态端口/readiness、bounded failure、consumer/restart/generation、root/cwd、preparation record/digest、受控 fixture、crash recovery 和进程清理 |
| `electron/local-app-preview.test.mjs` | sandbox WebContentsView、partition/navigation/window/permission 边界、复用和 closeForTab、bounds/scroll helper、reload 恢复、stale generation/reload、delayed create-close race |
| `electron/desktop-seam.test.mjs` | named IPC/preload/main 对齐、create/open 的 persist→visible→start 顺序、revision gate、relocate 保护、Main Preview readback/race 和 chooser 入口 |
| `test-fixtures/local-app-runtime/*` | 不修改真实项目源码的通用 `npm run dev` fixture；CodeNow Wiki 不作为唯一自动化 fixture |

### 8.2 已执行检查与未覆盖

当前工作区本次复跑结果：

- `npm run typecheck`：PASS；
- `node --test electron/chat-workspace-store.test.mjs electron/workspace-session.test.mjs`：22/22 PASS；
- `node --test electron/local-app-preview.test.mjs`：8/8 PASS；
- `node --test electron/desktop-seam.test.mjs`：10/10 PASS；
- `node --test electron/local-app-runtime.test.mjs`：11/12 通过，受控 fixture 在当前 sandbox 绑定 loopback 时因 `listen EPERM` 失败；runtime 的其它 11 个单测通过。active change evidence 另记录了在允许 loopback 的检查环境中 `npm run test:electron` 117/117、`npm run build` PASS 和 CodeNow Wiki GUI smoke 证据。

真实 GUI/CodeNow Wiki 正向证据已完成并记录：动态地址、页面显示、退出进程树清理、重启新 PID/新端口、chooser 隐藏 Preview、聊天切换不停止、同 root 多 Tab 复用和刷新不重启。正式 Acceptance 当前记录为 `10/16 PASS`、`6/16 待补`、总体 `BLOCKED`；这只是对 `acceptance.md`/evidence 的引用，不在本文件回写状态。待补证据包括信任取消/Escape 不落盘、失败/停止 UI、真实 `path_missing` 恢复，以及真实 Preview 页面访问 Node/Electron bridge、外部导航、`window.open` 和权限请求的安全负例。

## 9. Planned / Later 与安全阻断

下列能力不是当前实现，不得从现有接口或 `sandbox: true` 推断出来：

- `LATER-01`：项目首页复用同一 Runtime，形成左 Preview、右 Claude Agent SDK 的开发工作台；
- `LATER-02`：Claude Agent SDK 通过通用 SandboxBroker 读写项目、安装依赖和控制进程；
- `LATER-03`：选择并验证生产级跨平台 Sandbox Provider。必须先完成项目外文件、网络、环境变量和子进程逃逸验证，才能声明强隔离。

当前风险：自动依赖准备和 `npm run dev` 会执行用户显式信任目录中的脚本并可能访问网络；本地进程仍可能读取宿主文件、环境或创建子进程。canonical path、最小 env、loopback Preview 和 Electron renderer sandbox 只能缩小误用面，不能替代 OS sandbox。跨平台 process-tree、WebContentsView 布局/权限和真实失败目录的正式 GUI 证据仍需独立验证。

## 10. 最近同步

- 日期：`2026-08-25`。
- 代码依据：当前 dirty tree 的 `src/components/*`、`src/chat-workspace-persistence.ts`、`src/workspace-snapshot-resolution.ts`、`src/desktop-*`、`electron/main.ts`、`electron/preload.ts`、`electron/chat-workspace-store.ts`、`electron/local-app-runtime/*`、对应 Node tests 和 `test-fixtures/local-app-runtime/*`。
- 方案依据：`changes/active/chg-20260825-local-app-tabs-runtime/{proposal.md,design.md,tasks.md,evidence.md}`；正式契约仍为 `prd/local-app-runtime/acceptance.md`。
- 本轮实际写入：仅 `prd/local-app-runtime/technical.md`。未修改 `acceptance.md`、`TODO.md`、`changes/`、CodeNow Wiki 或业务代码；未创建 commit。
- 技术文档同步不改变 Acceptance/TODO 的正式状态；正式验收入口仍是 `project-verify`，当前开发检查和 GUI smoke 只作为可定位证据候选。
