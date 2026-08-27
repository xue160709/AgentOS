# Agent 指令通道与独立项目 Chat 窗口｜技术规格

> Change：`chg-20260818-agent-command-channel` Revision 2  
> 状态：Accepted / Planned，未实现  
> 解释优先级：`protocol-v1.md`（网站线协议）→ 本文（进程/IPC/持久化）→ `design.md`（用户行为）→ work order。发现冲突必须停工更新规格，不能由实现者自行选择。

## 1. 实现目标与迁移边界

Revision 2 把现有 renderer-local Chat 写入路径迁移为 Main-owned broker。迁移完成后：

- Main 是项目 thread、transcript、run、SDK session、diff、prompt ownership 与 workspace revision 的唯一 writer。
- 主窗口、项目 Chat 窗口、应用内指令通道和网站任务都只通过同一个 broker 创建线程及提交 Run。
- `ClaudeAgentRunner` 仍是唯一 Claude Agent SDK adapter，但不再直接持有某个 renderer `WebContents`。
- `RuntimeEditCoordinator` 只把可靠 Agent mutation 聚合到现有 Runtime；不复制 Runtime state machine，也不做并发写入协调。
- Revision 1 的 `agentCommandChannel` 公共调用方式继续可用，内部改为调用 broker。迁移期间不得保留第二套可写 chat 状态。

## 2. 当前基线事实

| 当前路径 | 当前行为 | Revision 2 必须改变的点 |
| --- | --- | --- |
| `src/agent-command-channel.ts` | Renderer 内按当前项目配置通道 | 改为 Main broker client；允许明确项目 capability，不依赖当前页面 |
| `src/components/chat/ChatPage.tsx` | Renderer 折叠事件、保存线程，权限模式在 localStorage | 变为 snapshot 投影；权限模式由 Main 持久化 |
| `src/components/chat/chat-run.ts` | 事件折叠与迟到事件规则位于 renderer-safe seam | 提取为 Main-safe reducer；React 不再写 durable transcript |
| `electron/claude-agent-runner.ts` | 直接向一个 `WebContents` 发事件；同 thread 新提交会取消旧请求 | 注入 event sink；busy thread 返回 `thread-busy`，绝不隐式取消 |
| `electron/main.ts` | `claude-chat:*` IPC 直接调用 runner；second-instance 只聚焦主窗口 | 注册 sender capability、broker IPC、deep-link cold/warm 路由 |
| `electron/preload.ts` | `window.claudeChat` 直接暴露 runner 命令 | 增加 `window.projectChat` typed bridge；旧 API 在迁移期内部委托 broker |
| `ChatWorkspaceStore` | Renderer 以完整快照读写 | 只允许 broker 以 revision-aware 串行操作写入 |

## 3. 计划代码边界

### 3.1 新增模块

| 路径 | 唯一职责 |
| --- | --- |
| `src/project-chat-contract.ts` | Renderer/Main 共用的 DTO、事件、错误码与 API 类型；不得 import Electron/React/Node |
| `src/project-chat-reducer.ts` | 纯函数折叠 `ClaudeChatEvent`、run/prompt 状态和 terminal fence |
| `electron/project-chat-broker.ts` | 单 writer、提交线性化、workspace revision、事件路由、prompt owner |
| `electron/project-chat-window-manager.ts` | 每项目一个 BrowserWindow、固定 capability、bounds 与关闭语义 |
| `electron/project-chat-view-state-store.ts` | 独立窗口 selected thread、draft、bounds 的原子持久化 |
| `electron/website-binding-store.ts` | Binding 元数据与 safeStorage credential |
| `electron/agentos-deep-link.ts` | deep link 解析、cold queue、warm route 与平台注册 |
| `electron/agentos-ticket-client.ts` | 固定 HTTPS endpoint 拉取/回执、超时、大小限制、无重定向 |
| `electron/external-task-receipt-store.ts` | ticket/idempotency 有界记录和重复请求结果 |
| `electron/runtime-edit-coordinator.ts` | potential run、edit lease、mutation、settle generation 与 Runtime intent |
| `src/components/chat/ProjectChatWindowPage.tsx` | 独立窗口壳；只消费 broker snapshot、复用 Chat 组件 |
| `src/components/setting/WebsiteBindingsSettingsPage.tsx` | Binding 列表、聚焦项目、撤销确认 |

文件名允许因仓库现有命名规范做机械调整；职责、依赖方向和事实源不得改变。任何合并模块的提案必须先更新本文。

### 3.2 依赖方向

```text
React views
  -> projectChat preload API
  -> ProjectChatBroker
       -> ChatWorkspaceStore
       -> ClaudeAgentRunner
       -> ProjectChatWindowManager
       -> RuntimeEditCoordinator

deep link -> protocol validator -> Binding/Ticket stores -> ProjectChatBroker
ClaudeAgentRunner -> event sink -> ProjectChatBroker -> reducer/store -> subscribed views
```

`ProjectChatBroker` 不 import React。`RuntimeEditCoordinator` 不 import Chat view。Ticket client 不 import workspace store 或 runner。

## 4. 共享合同

以下字段名、联合类型判别字段和值被冻结；实现不得用 `any` 或无判别字符串替代。

```ts
export type ProjectChatErrorCode =
  | 'invalid-argument'
  | 'sender-not-authorized'
  | 'project-not-found'
  | 'project-path-missing'
  | 'thread-not-found'
  | 'thread-busy'
  | 'stale-revision'
  | 'request-not-found'
  | 'prompt-not-owned'
  | 'binding-not-found'
  | 'binding-revoked'
  | 'binding-conflict'
  | 'credential-rejected'
  | 'ticket-invalid'
  | 'ticket-expired'
  | 'ticket-consumed'
  | 'ticket-fetch-failed'
  | 'idempotency-conflict'
  | 'invalid-deep-link'
  | 'unsupported-version'
  | 'receipt-failed'
  | 'credential-storage-unavailable'
  | 'sdk-submit-failed'
  | 'internal-error'

export type ProjectChatError = {
  code: ProjectChatErrorCode
  message: string
  retryable: boolean
}

export type ProjectChatResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectChatError }

export type ProjectChatRunPhase =
  | 'submitting'
  | 'running'
  | 'waiting_permission'
  | 'waiting_answer'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type ProjectChatRunSnapshot = {
  projectId: string
  threadId: string
  requestId: string
  phase: ProjectChatRunPhase
  routeGeneration: number
  startedAt: number
  finishedAt?: number
  error?: ProjectChatError
}

export type ProjectChatSnapshot = {
  projectId: string
  workspaceRevision: number
  sequence: number
  routeGeneration: number
  threads: WorkspaceThread[]
  runs: ProjectChatRunSnapshot[]
  pendingPrompts: ProjectChatPromptSnapshot[]
  permissionMode: ClaudePermissionMode
  unreadExternalTaskCount: number
}

export type ProjectChatEvent = {
  type: 'snapshot'
  projectId: string
  sequence: number
  routeGeneration: number
  workspaceRevision: number
  snapshot: ProjectChatSnapshot
}
```

v1 事件采用完整项目 snapshot，而不是 renderer 自行 patch durable state。实现可以在以后新增 patch event，但不得在本变更中同时维护两种权威折叠路径。

### 4.1 Bridge API

```ts
export type ProjectChatAPI = {
  getSnapshot(projectId: string): Promise<ProjectChatResult<ProjectChatSnapshot>>
  createThread(input: CreateProjectThreadInput): Promise<ProjectChatResult<CreateProjectThreadResult>>
  submitRun(input: SubmitProjectRunInput): Promise<ProjectChatResult<SubmitProjectRunResult>>
  cancelRun(input: CancelProjectRunInput): Promise<ProjectChatResult<void>>
  answerPrompt(input: AnswerProjectPromptInput): Promise<ProjectChatResult<void>>
  openProjectWindow(projectId: string): Promise<ProjectChatResult<void>>
  getWindowViewState(projectId: string): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  saveWindowViewState(input: SaveProjectChatWindowViewStateInput): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  listWebsiteBindings(): Promise<ProjectChatResult<WebsiteBindingPublic[]>>
  revokeWebsiteBinding(bindingId: string): Promise<ProjectChatResult<void>>
  initializePermissionMode(legacyMode?: ClaudePermissionMode): Promise<ProjectChatResult<ClaudePermissionMode>>
  setPermissionMode(mode: ClaudePermissionMode): Promise<ProjectChatResult<ClaudePermissionMode>>
  onEvent(handler: (event: ProjectChatEvent) => void): () => void
}
```

IPC 业务失败必须 resolve 为 `ProjectChatResult.ok=false`，不能依赖 Electron 对 thrown `Error` 自定义字段的序列化。只有 preload/transport 本身断开时 Promise 才 reject；renderer 统一显示脱敏 fallback，不从异常字符串解析 code。

`CreateProjectThreadInput` 必须包含 `projectId`、`title`、`source: 'user' | 'app-command' | 'website'`，网站来源还必须含 Main 生成/验证的 `idempotencyKey`。`SubmitProjectRunInput` 必须包含 `projectId`、`threadId`、`text`，可选附件、模型与 handoff；不得由 renderer 传 `cwd`、permissionMode 或任意 sessionId。broker 从当前 durable thread/project 与 Main 偏好解析这些字段。

新线程必须持久化 creation source 元数据，用于未读外部任务而非第二套任务历史：

```ts
type ProjectThreadCreationSource =
  | { kind: 'user' }
  | { kind: 'app-command' }
  | { kind: 'website'; bindingId: string; receivedAt: number }
```

旧线程迁移为 `{ kind: 'user' }`。renderer/API 对网站不暴露该元数据；Binding 撤销不修改既有线程 source。

持久化迁移固定为：`WorkspaceThread.creationSource` 必填但 normalizer 为旧数据补 `{kind:'user'}`；SQLite `threads` 增加 nullable `creation_source_json TEXT`，旧/null/非法 JSON 归一化为 user，保存新 thread 时写入判别联合。兼容 JSON snapshot 同步保存该字段。不得只存在内存，否则重启后未读徽标与来源会丢失。

## 5. Main-owned Chat Broker

### 5.1 写入串行化与 revision

- 所有 workspace mutation 进入一个 Main 串行队列；以一次读取、变换、原子保存为一个 operation。
- 每个成功 operation 使 `workspaceRevision` 严格递增 1；失败 operation 不递增。
- `sequence` 是每个项目事件流的 Main 内存单调计数；每次广播递增 1，应用重启可从 0 重新开始。
- `routeGeneration` 在项目删除、路径重绑、窗口 capability 重建或应用启动时变化；旧 generation 的事件、prompt 回答和 settle 结果必须拒绝。
- renderer 只接受 `routeGeneration` 相同且 `sequence` 大于最后值的事件；gap 直接调用 `getSnapshot`，不能猜 patch。
- 旧 `saveChatWorkspace(fullSnapshot)` 在 broker 切换后不得供普通 renderer 调用。迁移期调用必须带 expected revision 并在过期时返回 `stale-revision`，不得覆盖 Main 新数据。

### 5.2 创建并提交线程的线性化点

普通创建与外部任务共用下列顺序：

1. 校验 sender project capability、项目存在、路径存在、文本非空。
2. 在串行 workspace operation 中创建普通线程并持久化用户消息；网站请求同时持久化 idempotency receipt 的 `thread-created` 状态。
3. 注册 run 为 `submitting`，捕获此刻 Main 当前 permission mode。
4. 调用 `ClaudeAgentRunner.submit`。
5. runner 返回 `requestId` 后写入 run mapping，状态改为 `running` 并广播。
6. 网站请求此时才返回 `accepted`；普通 UI 返回 `requestId`。

步骤 2 以后步骤 4 失败：保留可见线程和用户消息，写入可读失败 system/assistant 状态，run 终态为 `failed/sdk-submit-failed`。不得删除线程或自动重试 SDK。

同一 `threadId` 已有 `submitting/running/waiting_*` run 时，步骤 1 返回 `thread-busy`；不得调用 runner 的旧“取消后重提”路径。

### 5.3 Runner event sink

```ts
export interface ClaudeChatEventSink {
  publish(event: ClaudeChatEvent): void
}
```

- `ClaudeAgentRunner` 构造函数接收 sink，不接收 `WebContents`。
- sink publish 异常只记录脱敏诊断，不得取消 SDK run。
- broker 维护 `requestId -> {projectId, threadId, routeGeneration}`，未知 requestId 事件丢弃并记录计数，不广播。
- reducer 每处理一个合法事件就在同一串行队列中更新 durable transcript/run，然后广播新 snapshot。
- terminal 后的任何非 terminal 事件不得改写终态；重复 terminal 必须幂等。
- SDK event 不得自己决定窗口导航、项目选择或 external receipt。

### 5.4 Prompt owner

broker 为每个 pending permission/AskUserQuestion 保存：

```ts
type ProjectChatPromptSnapshot = {
  projectId: string
  threadId: string
  requestId: string
  promptId: string
  kind: 'permission' | 'question'
  ownerWebContentsId?: number
  createdAt: number
  payload: RedactedPromptPayload
}
```

owner 按 `design.md §6.4` 选择。`answerPrompt` 必须同时验证 sender capability、ownerWebContentsId、project/thread/request/promptId 和 routeGeneration。第一个有效回答进入 runner 后立即清除 prompt；迟到回答返回 `prompt-not-owned`。owner 被销毁或隐藏时重新分配并广播。

## 6. Sender capability 与窗口隔离

Main 维护不可由 renderer 修改的 registry：

```ts
type RendererCapability =
  | { kind: 'main-window'; webContentsId: number }
  | { kind: 'project-chat-window'; webContentsId: number; projectId: string; routeGeneration: number }
```

每个 `project-chat:*` handler 必须验证：

1. `event.sender.id` 存在于 registry。
2. 调用来自已登记 webContents 的 main frame；subframe 一律拒绝。
3. frame URL 是当前打包 renderer URL 或已知 Vite dev renderer URL。
4. 项目 Chat 窗口只能访问 capability 中固定的 projectId；query string 不构成授权。
5. 主窗口可访问已存在项目，但 projectId、threadId 的归属仍由 broker 复核。

Preview `WebContents` 不加载 preload、不登记 Chat capability。其 `agentos://` 导航只能进入 Main 的窄导航捕获器，不能调用任意 IPC。

## 7. Project Chat Window

- `ProjectChatWindowManager` 使用 `Map<projectId, BrowserWindow>`；重复打开只 `show/focus`。
- 与主窗口使用相同 renderer bundle 和 preload，入口参数只决定渲染 `ProjectChatWindowPage`，权限来自 registry。
- 必须保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox` 与主窗口安全基线一致。
- BrowserWindow `close` 只保存 view state、注销订阅/owner 并销毁视图；不得调用 cancel/newThread/删除线程。
- 窗口创建后再注册 capability，load 失败时清理 registry 与 map。
- 项目删除/路径丢失由 snapshot 状态驱动 UI；不得自动把窗口指向其它项目。

### 7.1 View state persistence

文件：`userData/project-chat-view-state.json`，schema v1：

```ts
type ProjectChatWindowViewState = {
  schemaVersion: 1
  projectId: string
  selectedThreadId?: string
  draft: string
  externalTaskSeenAt: number
  bounds?: { x?: number; y?: number; width: number; height: number }
  updatedAt: number
}
```

- draft 最大 100,000 UTF-16 code units；超出拒绝保存，不截断。
- draft/selected thread/seen cursor 在变更后 300ms debounce 保存，并在 blur/close 时 flush。
- bounds 默认 1024×760，限制在至少 720×560，并保证与任一已连接 display 有可见交集；否则使用主 display 居中默认值。
- `unreadExternalTaskCount` 由 website thread 的 `receivedAt > externalTaskSeenAt` 计算；自动选择时推进游标，点击徽标选择最新未读并推进到当前最大 `receivedAt`。
- store 使用 temp file + rename 原子替换；解析失败备份为 `.corrupt-<timestamp>` 后从空状态恢复。
- view state 不是 workspace revision 的组成部分，不能写 transcript/run/session。

## 8. Permission mode

- v1 scope 为 app-global，不是 per-project。
- 存在 `DesktopPreferences.chatPermissionMode`，类型为 `ClaudePermissionMode`。升级时若该字段尚未存在，只有已登记 main-window capability 可调用一次 `initializePermissionMode`，把当前 legacy localStorage key `codex-ui-template:claude-permission-mode` 的合法值迁入；没有合法 legacy 值则保存 `auto`。项目 Chat 窗口不能初始化。
- Main 保存初始化值后返回当前 mode；主窗口再删除 legacy key。字段已经存在时 initialize 幂等返回现值，绝不被旧 renderer 覆盖。非法已保存值归一化并修复为 `auto`。
- `setPermissionMode` 只接受联合类型成员，Main 保存成功后广播所有项目 snapshot。
- submit 在步骤 3 捕获 mode；之后其它窗口修改只影响新 run。
- Website Binding、ticket、deep link 与 external receipt 不得含此字段。

## 9. Website Binding 与 credential

`userData/website-bindings.json` schema v1：

```ts
type WebsiteBindingRecord = {
  schemaVersion: 1
  bindingId: string
  origin: string
  displayName: string
  projectId: string
  credentialCiphertext: string
  status: 'active' | 'revoked'
  createdAt: number
  revokedAt?: number
}

type WebsiteBindingPublic = Omit<WebsiteBindingRecord, 'credentialCiphertext'>
```

- `origin` 是 `protocol-v1.md` 的规范化 HTTPS origin；store 对 active origin 建唯一索引。
- credential 至少 32 random bytes，base64url 编码，只在 pairing accepted HTTPS response 中发送一次。
- 落盘前必须使用 Electron `safeStorage.encryptString`；`safeStorage.isEncryptionAvailable() === false` 时配对返回 `credential-storage-unavailable`，不得明文回退。
- revoke 采用 tombstone，立即使新任务失败；不删除线程、不取消 run。credential ciphertext 可在 revoke operation 中清空。
- UI/API/log 不返回 credential、ticket body、完整 task 文本或本地绝对路径。

## 10. Deep link 与平台生命周期

- scheme 固定 `agentos`；动作与线协议见 `protocol-v1.md`。
- macOS 同时处理 `app.on('open-url')`；Windows/Linux 处理 initial `process.argv` 和 `second-instance` argv。
- 使用 single instance lock；第二实例只把原始 argv 交给 parser，不能直接执行 task。
- app ready 前使用内存 cold queue：最多 32 项、每项最多保留 5 分钟；超出丢弃最旧并记录脱敏计数。
- 同一 `{action, origin, request_id}` 在队列和处理中去重。
- deep link 处理失败不打开任意网页、不降级读取 URL 中的 prompt/项目/权限。
- 配对显示 modal；外部任务按产品焦点规则打开/通知 Project Chat Window，主窗口不自动切路由。
- 配对请求与任务共用有界 deep-link queue；配对 modal 每次只处理一个，显示前和接受前重新验证 PairEnvelope 时效。
- 打包注册修改 `electron-builder.json5`，并由 `electron-builder.config.cjs` 继续读取；开发态使用 `app.setAsDefaultProtocolClient` 的 Electron executable/entry 参数。

## 11. External task receipt state machine

文件：`userData/external-task-receipts.json`。每个 active binding 保存最近 1,000 条或 24 小时内记录，先满足任一边界即淘汰最旧 terminal 记录；非 terminal 不得被容量淘汰。

```ts
type ExternalTaskReceiptState =
  | 'fetching'
  | 'validated'
  | 'thread-created'
  | 'submitting'
  | 'accepted'
  | 'rejected'

type ExternalTaskReceiptRecord = {
  bindingId: string
  requestId: string
  idempotencyKey: string
  payloadHash: string
  state: ExternalTaskReceiptState
  threadId?: string
  requestIdLocal?: string
  rejectionCode?: ProjectChatErrorCode
  createdAt: number
  updatedAt: number
}
```

- 唯一键是 `{bindingId, idempotencyKey}`；同 binding 下同 key、不同 website request_id 仍视为重试。
- `payloadHash` 是规范化 `title + "\n" + task` 的 SHA-256 hex；同 key 不同 hash 返回 `idempotency-conflict`，不覆盖旧记录。
- ticket 验证成功不算消费。线程与 `thread-created` receipt 必须在可恢复操作中都成功后才算本地消费线性化。
- accepted 只在 runner 返回 local requestId 后写入；回执网络失败不回滚 accepted。
- 重复 accepted 请求重发 accepted；重复 rejected 请求重发相同 code；不得新建线程。
- `thread-created/submitting` 在应用崩溃后恢复为 `rejected/sdk-submit-failed`，保留线程；v1 不自动恢复 live SDK run。

## 12. RuntimeEditCoordinator

### 12.1 内存模型

```ts
type RuntimeEditSession = {
  projectId: string
  editGeneration: number
  potentialRunIds: Set<string>
  activeEditLeaseIds: Set<string>
  successfulMutationCount: number
  failedOrCancelledAfterMutation: boolean
  manualLeaseCount: number
  manualStopFence: boolean
  settleOperationId?: string
  buildOperationId?: string
}
```

- 非 `plan` submit 在 runner accepted 后登记 potential run；`plan` 不登记。
- `Edit`、`Write`、`NotebookEdit` 的 before-tool 事件先 acquire Agent lease，再允许工具继续。
- 其它工具只在 successful PostToolUse 且 file-diff 模块报告项目根目录内非空 diff 时调用 `recordMutation`。
- 不根据 Bash 命令文本、文件扩展名或目录名猜写入。
- terminal 释放 run/lease；terminal 前已 mutation 且 run failed/cancelled 设置失败栅栏。
- 新 potential run 或新 mutation 出现在 settle/build 期间时递增 editGeneration，旧 operation result 只能丢弃，不能切 last-good。

### 12.2 Settle

仅当 `successfulMutationCount > 0`、`potentialRunIds` 为空且没有失败栅栏时等待源码 fingerprint：连续 1,500ms 相等；总等待最多 30,000ms。任一变化重新计算静默时间，超时进入 runtime failure，不自动 build。

- 静态声明存在：调用现有 Runtime 固定 build intent 一次；成功且 generation 相同才原子切 last-good。
- development-only：不 build，保留受管 dev Runtime。
- static-only 无 dev：编辑期可无实时预览，settle 后仍执行固定 build。
- 无可靠 build 声明：不猜命令，显示预览不可更新。
- failed/cancelled after mutation：不自动 build；用户手动更新走现有 Runtime 手动路径。

Coordinator 不写源文件、不创建锁、不做 optimistic version check、不自动 merge/retry/rollback。

## 13. 错误与用户恢复映射

| code | retryable | 本地副作用 | 用户恢复 |
| --- | --- | --- | --- |
| `thread-busy` | false | 无新 run | 打开现有运行或等待终态 |
| `stale-revision` | true | 无覆盖写入 | 重新取 snapshot 后重做动作 |
| `project-path-missing` | false | 不提交 | 回主窗口修复项目路径 |
| `binding-conflict` | false | 不覆盖 binding | 前往网站连接管理 |
| `ticket-fetch-failed` | true | 不创建线程 | 网站重试同 ticket/key |
| `ticket-expired` / `ticket-consumed` | false | 不创建线程 | 网站签发新 ticket |
| `sdk-submit-failed` | true | 保留失败线程 | 用户在线程中重试；网站同 key 不再复制线程 |
| `receipt-failed` | true | accepted run 继续 | 后台/网站同 key重发回执 |
| `credential-storage-unavailable` | false | 不创建 binding | 恢复系统凭据存储后重试 |

所有跨 IPC 业务异常以 `ProjectChatResult.ok=false` 返回；未知内部异常映射为 `internal-error`，message 不含绝对路径、prompt、credential、ticket body 或 stack。

## 14. 测试分层

### 必须自动化

- pure contract/parser：origin、deep link、ticket schema、size/time/idempotency/error mapping。
- broker：单 writer revision、同 thread busy、跨 thread 并行、terminal fence、prompt owner failover、SDK submit failure 保留线程。
- runner sink：事件归属、sink failure、未知/迟到 request。
- stores：atomic write、corrupt recovery、safeStorage unavailable、origin unique、receipt eviction/recovery。
- window/capability：一项目一窗口、wrong project/subframe/preview sender rejection、close 不 cancel。
- runtime coordinator：read-only 不启动、reliable tool lease、diff mutation、三条件 settle、1500/30000 timer、generation invalidation、failed/cancel no build。

### 必须 Electron smoke

- macOS warm/cold deep link；Windows argv parser 至少用平台无关 fixture 覆盖，发布前在 Windows 验证协议注册。
- 主窗口与项目窗口同时观察同一 run，不重复消息；权限 owner 关闭后转移。
- 草稿/selected thread/bounds 跨关闭和应用重启恢复。
- Preview 点击 deep link 被 Main 捕获，但 Preview 无 Chat IPC。
- 静态项目 mutation 后自动 build/last-good，build 失败保持旧页面。

## 15. 迁移与回滚

1. 先引入 contract/reducer 与 runner sink，不改变 UI 行为。
2. broker 作为唯一 runner caller，旧 `claude-chat:*` handler 内部委托 broker。
3. 主窗口切到 snapshot 投影，禁用 renderer full workspace write。
4. 再开放项目 Chat 窗口；通过双窗口测试后才开放 deep link。
5. 最后接 RuntimeEditCoordinator。

每个里程碑用 feature flag `projectChatBrokerV2` 隔离入口，但 flag 关闭只能回到完整 Revision 1 路径；不得让一部分窗口写 broker、另一部分写旧 workspace。Website Binding/receipt schema 保持可读，回滚时只关闭入口，不删除用户线程或 binding 数据。

## 16. 明确禁止的实现捷径

- 不让两个 renderer 各自保存完整 workspace snapshot。
- 不从 query string、deep link 或 Ticket 接受项目路径、threadId、permissionMode、prompt。
- 不把 credential 明文写盘或放入日志/renderer。
- 不让 Preview 获得 preload 或通用 IPC。
- 不用第二次 submit 隐式取消同 thread 正在运行的请求。
- 不把 HTTPS 回执失败当作 Agent run 失败或取消 run。
- 不在 runtime settle 里解析 Bash 文本、猜 build command 或增加并发写锁。
- 不用 work order 的局部描述覆盖本文冻结合同。
