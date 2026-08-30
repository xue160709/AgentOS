# Agent 指令通道、独立项目 Chat 与 Runtime 开发会话｜技术规格

> Change：`chg-20260818-agent-command-channel` Revision 3
> 状态：Revision 3 BUILDABLE / Planned；Revision 2 已实现但未正式验收
> 解释优先级：`protocol-v1.md`（网站线协议）→ 本文（进程/IPC/持久化）→ `design.md`（用户行为）→ work order。发现冲突必须停工更新规格，不能由实现者自行选择。

## Revision 4 Technical Delta：RuntimeServePlan

### T4.1 目标与最小改动路径

把"这个 Runtime 怎么被查看"从 `package.json` 申报改为系统探测。关键实现选择：**探测器输出与既有 `StaticDeclaration` 同形的结论**，因此静态构建、last-good 产物库、静态 Preview registry、generation fence 这些既有链路一律不改，只是它们的输入不再只能来自声明块。

### T4.2 RuntimeServePlan 合同

```ts
export type RuntimeServePlan =
  | { kind: 'artifact'; declaration: StaticDeclaration; source: 'declaration' | 'detected' }
  | { kind: 'buildable'; declaration?: StaticDeclaration; source: 'declaration' | 'detected' }
  | { kind: 'production'; reason: 'server-bundle-present' | 'build-produces-no-artifact' }
  | { kind: 'development'; reason: 'no-build-script' | 'no-start-script' }
  | { kind: 'unsupported'; reason: 'no-package-json' | 'no-runnable-script' }
```

`production` 与 `development` 都是"保持运行"，区别只是执行 `npm run start` 还是 `npm run dev`。系统在两者之间永远优先 `production`。

探测顺序（固定，不可重排）：

1. `agentos` 声明块存在且合法 → 用它的 `outputRoot`/`entryFile`；入口文件存在则 `artifact`，否则 `buildable`。声明块非法仍然是硬错误，不降级。
2. 无声明块 → 按 `out` → `dist` → `build` 顺序找 `<dir>/index.html`，第一个命中即 `artifact`，合成等价 declaration（`buildCommand` 固定 `npm run build`）。
3. 未命中静态产物但存在 `.next/BUILD_ID` 且有 `scripts.start` → `production(server-bundle-present)`，直接启动，不重新构建。该标记文件是 Next.js 专有；其它框架不猜服务端产物位置。
4. 有 `scripts.build` → `buildable`，`outputRoot` 待构建后再定。
5. 无 `build` 脚本但有 `scripts.dev` → `development(no-build-script)`。
6. 都没有 → `unsupported`。

构建后重新探测：命中静态产物 → `artifact`；否则有 `scripts.start` → `production(build-produces-no-artifact)`；否则有 `scripts.dev` → `development(no-start-script)`。

产物目录必须通过既有 `isSafeStaticRelativePath` 与 canonical containment 校验；探测只认 `npm run build` / `npm run dev` 两条固定命令，不执行 `package.json` 里的任何其他脚本。

### T4.3 Definition 字段与覆盖

- 新增 `serveOverride?: 'artifact' | 'server'`，持久化在 Definition 上，由用户显式设置，自动探测不推翻。`server` 只表达"保持运行"，具体跑 `start` 还是 `dev` 仍由探测择优。
- 新增**不持久化**的 `serveScript?: 'dev' | 'start'`：Runtime 开发会话与旧 development 入口用它强制一次 dev 运行，绕过探测。它只存在于 manager 注册的运行期定义上，不进 workspace store 白名单。
- `mode` 保留为派生值：`plan.kind === 'development' ? 'development' : 'static'`，供既有代码路径使用。
- `agentos` 字段继续承载 declaration，来源可以是声明块或探测合成；`source` 只用于界面解释与日志，不参与安全判定。

### T4.4 启动策略

`LocalAppRuntimeManager.start()` 先解析 plan（含 override），再分支：

| plan | 行为 | root 执行锁 |
| --- | --- | --- |
| `artifact` | 静态 Preview 伺服 last-good 或目录产物，零进程 | 不占 |
| `buildable` | 取瞬时 build lease，构建一次，按结果转 `artifact` / `production` / `development` | 构建期间占 build lease |
| `production` | spawn `npm run start`，`NODE_ENV=production` | 占 development lease |
| `development` | spawn `npm run dev`，`NODE_ENV=development` | 占 development lease |
| `unsupported` | 不启动，返回固定错误码 | 不占 |

构建后重新探测：命中产物则提交 last-good；未命中则把 plan 记为 `development(build-produces-no-artifact)` 并按 dev 启动，不视为硬失败（`C-RSM-402` 第 ③ 档）。

### T4.5 与开发会话的衔接

`RuntimeDevelopmentRuntimeBridge.open()` 仍无条件进入 dev。`saveCapability` 改由 plan 决定：`artifact` / `buildable` → `static`；`development` → `development-only`；`unsupported` → `unavailable`。会话结束时重新探测：可静态化则构建一次回到 `artifact`，否则留在 dev 并如实告知。

### T4.6 迁移

存量 Definition 的 `mode` 可能是过时的 `development`。启动与 ensure 路径一律重新探测并以探测结论为准；只有 `serveOverride` 能压过探测。不需要数据迁移脚本，也不改动既有 Thread / 产物 / view state。

### T4.7 冲突可见性（修复项）

`startRuntime` / restore 路径的 root-conflict 必须携带占用者的 `runtimeScopeId` 返回 renderer，由既有冲突提示组件显示名称、归属与"切换到正在修改的 Runtime"。renderer 不得再静默吞掉该错误。

### T4.8 卡片状态（修复项）

renderer 同时渲染 Runtime 状态与开发会话状态两段；停止态提供启动入口；`unsupported` 与构建失败给出固定文案与重试。相关文案统一放在 `runtime.*` 命名空间。

## Revision 3 Technical Delta：RuntimeDevelopmentSession

本节取代下方 Revision 2 的 `§12 RuntimeEditCoordinator` 与 `§17 WorkspaceTab → Project durable contract` 中涉及 Runtime 开发会话、同路径 Runtime 复用和 Workspace backing Project 的规则。Revision 2 的 Main-owned Broker、Runner、Transcript、权限、Diff、prompt owner、安全投影、网站协议与普通项目 Chat 继续有效。

### T3.1 目标、范围与 as-built 缺口

Revision 3 是跨 Main/renderer、SQLite/JSON、BrowserWindow、SDK Run 与 Runtime process 的 L 级修改；实施风险按 V3 处理，但本轮只写文档，验证等级为 V0。

| 缺口 | as-built 证据 | Revision 3 要求 |
| --- | --- | --- |
| 相同 root + mode 被别名为一个 runtime owner | `electron/local-app-runtime/index.ts:1482-1522,1607-1617` | Definition、snapshot、consumer 与 Chat 身份始终按 Runtime scope 隔离；同 root 只进入执行资源冲突门 |
| Workspace Chat 创建/修复 visible Project | `electron/workspace-tab-project.ts:30-75`、`workspace-tab-project-chat.ts` | Workspace Runtime thread 不依赖 Project；不再写 `WorkspaceTab.projectId` |
| durable Thread 强制 `project_id NOT NULL` | `electron/chat-workspace-store.ts:384-409,459-498` | 新增 Runtime-scoped thread metadata，不制造 sentinel/synthetic Project |
| Coordinator 按 project 聚合并在所有 Run 终态后自动 settle | `electron/runtime-edit-coordinator.ts:42-70,217-304` | 显式 Runtime 窗口会话只有 `exitRequested` 后才能 settle；普通非 Runtime Run 保留旧策略 |
| Project Chat window close 只 flush view state | `electron/project-chat-window-manager.ts:121-123` | Runtime 开发窗口 close 同步登记结束意图，再销毁视图；不取消 Run |

上述证据是 `STATIC / UNTESTED` 代码审计；已有 GUI 探查的跳转与 synthetic Project 复现记录在 `evidence.md`，本技术规格不把文档审计冒充实现验证。

### T3.2 稳定身份与作用域解析

Runtime 开发不使用 canonical path、active project、Workspace Tab backing Project 或 renderer query 作为身份。Main 从入口权威对象解析以下稳定 key：

```ts
type RuntimeScopeId = `project:${string}` | `workspace:${string}`

type RuntimeScopeRef =
  | {
      kind: 'project-runtime'
      runtimeScopeId: `project:${string}`
      projectId: string
      runtimeDefinitionId?: string // .agentos 尚未创建时允许缺省
    }
  | {
      kind: 'workspace-runtime'
      runtimeScopeId: `workspace:${string}`
      runtimeDefinitionId: string
    }

type ResolvedRuntimeScope = RuntimeScopeRef & {
  owner: RuntimeOwner
  displayName: string
  cwd: string
  runtimeRoot: string
  canonicalRoot?: string
  routeGeneration: number
  capability: 'static-with-dev' | 'static-only' | 'development-only' | 'uninitialized' | 'invalid'
}
```

- Project Runtime 的产品身份从项目创建起就是 `project:<projectId>`；`.agentos` 不存在时可以先打开创建 Chat，Definition 生成后由 Main 在同一 scope 内绑定，不迁移 Thread 或窗口身份。
- Workspace Runtime 的 scope 是 `workspace:<runtimeDefinitionId>`；关闭 Tab 不改变 scope，显式删除 Definition 后历史仍可只读访问，但不可继续提交。
- Project scope 每次 submit fresh-read Project，`cwd=<project root>`、`runtimeRoot=<project>/.agentos`；Workspace scope fresh-read Definition，`cwd=runtimeRoot=canonical root`。
- renderer 不能提交或覆盖 cwd、runtimeRoot、canonicalRoot、owner、routeGeneration、capability 或 Runtime prompt eligibility。
- 路径缺失、Project/Definition 删除、Workspace relocation 或 Project path 改变会提升 `routeGeneration`；旧 window、Run、prompt、settle 与 build callback 全部失效。

### T3.3 Thread、Transcript 与持久化

Runtime 开发复用现有 Transcript 联合、纯 reducer、Claude Agent SDK runner、sessionId、model、permission、prompt 和 file diff。为避免破坏普通 Project Thread 与制造假 Project，抽取共享基类并新增同一 Main writer 管理的 Runtime thread collection：

```ts
type ChatThreadBase = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pinnedAt?: number
  archivedAt?: number
  creationSource: ProjectThreadCreationSource
  chatState: ChatState
}

type RuntimeDevelopmentThread = ChatThreadBase & {
  purpose: 'runtime-development'
  runtimeScopeId: RuntimeScopeId
  runtimeDefinitionId?: string
  runtimeOwner: RuntimeOwner
  creationSource: Extract<ProjectThreadCreationSource, { kind: 'user' | 'app-command' }>
}
```

- `WorkspaceThread[]` 继续只包含普通项目线程；新增 `runtimeDevelopmentThreads[]`，两者共享 reducer、rollout/transcript serializer 和 Broker core，但列表查询与窗口 snapshot 分开。
- SQLite 新增 `runtime_development_threads` 表和 `idx_runtime_threads_scope_updated`，不把 workspace Runtime 填入 `threads.project_id`。Project-owned Runtime 行可保存 owner projectId 作为完整性字段，但不进入 `threads` 外键或普通项目列表。
- JSON fallback 使用独立 `runtime-development-workspace.json` 原子文件；SQLite 与 sidecar 共享单调 `runtimeThreadRevision`。旧版本写普通 workspace 时不会删除 Runtime thread 表/sidecar，避免 rollback 丢记录。
- schema migration 只把既有 `threads` 归为普通 Project Thread，不猜测或重分类历史 app-command Thread。既有 `WorkspaceTab.projectId` 与已生成 Project/Thread 原样保留，字段转为 deprecated read-only；Revision 3 不自动删除可能属于用户的数据。
- 新代码停止调用 `ensureWorkspaceTabProject()` / `openWorkspaceTabProjectChat()`；未来 Runtime 开发只写 Runtime thread collection。旧函数保留一个 release 兼容周期但入口不可达，随后删除。
- 全局搜索同时索引两类 collection。Runtime 结果包含 `scopeKind=runtime-development`、`runtimeScopeId`、Runtime 名称与 `ownerKind`；点击由 Main 打开专用窗口。普通项目对话查询必须明确过滤 Project Thread，不能靠 renderer 隐藏。
- Runtime Definition 删除后 Thread/Transcript 不级联删除；专用窗口显示“Runtime 已移除”，禁用 submit，仍允许搜索、查看与显式归档。

### T3.4 单一 Chat Broker 与 capability

从 `ProjectChatBroker` 抽取一个 Main-owned `ChatBrokerCore`，保留现有 Project facade，并新增 Runtime facade；这不是第二套 Chatbot：两个 facade 使用同一个串行 writer、Runner、event sink、reducer、Transcript serializer、permission service 与 prompt registry。

```text
ProjectChat facade ─┐
                    ├─ ChatBrokerCore ─ Store / Runner / reducer / prompt registry
RuntimeChat facade ─┘
```

- `requestId -> {scopeKind, scopeId, threadId, routeGeneration, developmentGeneration}` 在 runner accepted 前由 Main 冻结；事件只路由到这一份记录。
- 同一 Thread 仍只允许一个 active Run，不同 Runtime Thread 可以并行；一个 RuntimeDevelopmentSession 聚合其 scope 下全部 active Run。
- Runtime submit 只能引用同一 capability scope 中的 `runtime-development` Thread；Project API 看不到也不能修改 Runtime Thread。
- Project Runtime 使用项目上下文读取能力，但 Runtime prompt 固定目标 `.agentos`；Workspace Runtime 的 discovery、附件相对路径与文件搜索都以 Runtime root 为界。
- scope 只是路由与上下文合同，不额外提升现有 app-global permission，也不冒充 OS sandbox。Main 对 Edit/Write/NotebookEdit 的目标做 runtimeRoot containment；无法可靠归因或 root 外 diff 不计入可保存修改并进入 `needs_attention`。原始 Bash 仍受现有权限策略，Revision 3 不宣称具备宿主级强隔离。

新增 renderer capability profile：

```ts
type RuntimeDevelopmentCapability = {
  kind: 'runtime-development'
  webContentsId: number
  runtimeScopeId: RuntimeScopeId
  routeGeneration: number
}
```

- Runtime 开发窗口使用固定 `--agentos-window-kind=runtime-development`，preload 只暴露 Runtime Chat typed API；不暴露 `window.desktop`、普通 Project Chat 或任意路径 API。
- query 中的 `runtimeScopeId` 只用于 renderer 路由显示，不是授权。Main 必须以 webContents capability 覆盖/校验 scope。
- Runtime prompt owner 候选只有当前 scope 的 visible Runtime window。窗口关闭后 prompt 暂无 owner，主窗口只显示“需要你的确认”和重新打开入口；重开后转移一次，迟到回答由 promptId + generation 拒绝。

### T3.5 Main-window 与 Runtime-window API

主窗口只发送它已经持有的页面对象，不直接发送 root：

```ts
type RuntimeDevelopmentTarget =
  | { kind: 'project-runtime'; projectId: string; mountId: string }
  | { kind: 'workspace-runtime'; workspaceTabId: string }

type RuntimeDevelopmentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: RuntimeDevelopmentErrorCode; message: string; retryable: boolean } }

type OpenRuntimeDevelopmentResult =
  | { ok: true; value: { runtimeScopeId: RuntimeScopeId; developmentGeneration: number } }
  | {
      ok: false
      error:
        | { code: 'runtime-development-conflict'; message: string; retryable: false; conflictToken: string; conflictingRuntimeName: string }
        | { code: Exclude<RuntimeDevelopmentErrorCode, 'runtime-development-conflict'>; message: string; retryable: boolean }
    }

type RuntimeDevelopmentMainAPI = {
  openRuntimeDevelopment(target: RuntimeDevelopmentTarget): Promise<OpenRuntimeDevelopmentResult>
  focusRuntimeDevelopmentConflict(conflictToken: string): Promise<RuntimeDevelopmentResult<void>>
  endRuntimeDevelopment(target: RuntimeDevelopmentTarget): Promise<RuntimeDevelopmentResult<void>>
}
```

- Main 对 project target 复核 project-home host/mount，对 workspace target 复核 Workspace Tab → workspace-owned Definition；任何 owner 不匹配都在副作用前拒绝。
- `conflictToken` 是 Main-memory、单 sender、短期、一次性凭证；renderer 不获得冲突 Runtime 的路径或可伪造的 ownership 参数。显式切换只聚焦已占用者的正确主界面和开发窗口，不改 activeProjectId、不重写 Runtime owner。
- Runtime 窗口 API 复用 create/select/submit/fork/edit/cancel/answer/diff/model/attachment 能力，但 scope 从 capability 获取；窗口 payload 只允许 thread/request/prompt/changeSet 等 scope 内标识。
- 项目 `.agentos` 未初始化时，“让 AI 创建”调用同一个 open API，然后在该 scope 新建 `runtime-development` Thread 并提交既有受控创建 prompt；普通“用 AI 修改”只打开/恢复窗口，不自动发送 prompt。

### T3.6 RuntimeDevelopmentWindowManager

- 新增 `RuntimeDevelopmentWindowManager`，以 `runtimeScopeId` 为 Map key；同 scope 重复打开只 show/focus，不创建第二窗口。
- 复用现有 Chat renderer 组件和通用 window primitive，但标题固定包含 Runtime 名称与“项目/工作台”归属，页面不提供项目切换。
- view state 独立保存 `{schemaVersion, runtimeScopeId, selectedThreadId?, draft, bounds, updatedAt}`；selected Thread 必须属于该 scope。
- native `close` 事件先同步调用 coordinator `requestExit(scopeId, generation, 'window-close')`，再 flush view state 并销毁视图。requestExit 只改 Main 内存且幂等，不等待 Run/build，不调用 cancel。
- `closed/destroyed` 只注销 capability、presence 和窗口引用；不得再次创建 exit generation。load 失败释放刚取得的窗口/session consumer，并保留可恢复错误。
- 从 `saving` 或 `needs_attention` 重新打开会调用 `reenter`：提升 developmentGeneration、清除旧 exit intent、取消尚未提交的旧 save operation，并使旧 callback 失效。

### T3.7 RuntimeDevelopmentSession 状态机

Main 新增 `RuntimeDevelopmentCoordinator`。现有 `RuntimeEditCoordinator` 保留给普通项目 Chat、Website/后台任务的 run-owned settle；Runtime-scoped Run 只能登记到新 coordinator，禁止双登记。

```ts
type RuntimeDevelopmentPhase =
  | 'opening'
  | 'live'
  | 'exit_requested'
  | 'needs_attention'
  | 'saving'
  | 'closed'
  | 'preview_update_failed'

type RuntimeDevelopmentSession = {
  runtimeScopeId: RuntimeScopeId
  runtimeDefinitionId?: string
  routeGeneration: number
  developmentGeneration: number
  phase: RuntimeDevelopmentPhase
  exitRequested: boolean
  entryFingerprint?: string
  activeRunIds: Set<string>
  waitingPromptIds: Set<string>
  mutationCountByRun: Map<string, number>
  failedMutationRunIds: Set<string>
  rootLeaseId?: string
  settleOperationId?: string
  buildOperationId?: string
  autoSaveAttemptedGeneration?: number
}
```

事务和转换规则：

1. `open`：Main 解析 scope、取得同路径独占修改租约、建立 `opening` session 并打开窗口；可用 dev script 时准备实时服务。static-only 可以进入可修改状态但继续显示 last-good；uninitialized 先按“父目录 realpath + 固定 `.agentos` 子路径”锁定 prospective root 并只打开 Chat，目录出现后重新 canonicalize，冲突才允许继续。
2. `ready`：实时服务 ready、static-only 已判定或 uninitialized Chat 可用后进入 `live`。准备失败进入 `needs_attention`，但不删除 Thread/草稿。
3. `submit`：只允许 `live`；accepted 后将 requestId 加入 `activeRunIds`。Plan Run 可进入 Transcript，但不计 potential writer 或 mutation。
4. `mutation`：只统计 runtimeRoot 内可靠 diff；记录到具体 requestId。窗口仍开时永不自动 settle/build。
5. `requestExit`：`live/opening` 幂等变为 `exit_requested` 并禁止新 submit。active Run 继续；waiting prompt 使可见 phase 为 `needs_attention`，必须重开后回答。
6. `terminal`：移除 active Run。失败/取消且该 Run 已产生 mutation 时加入 `failedMutationRunIds`；无 mutation 的失败不阻止其它成功修改保存。
7. `settle gate`：必须同时满足 exitRequested、无 active Run/agent lease/waiting prompt、无 failedMutationRun、源码 fingerprint 连续 1,500ms 稳定且总等待不超过 30,000ms。净 fingerprint 等于 entryFingerprint 时按无修改关闭。
8. `save`：每个 developmentGeneration 最多自动尝试一次。支持静态保存时，在同一 root execution lease 内停止临时 dev、切换为 build、执行 Main 验证的固定声明并在 commit 前再次校验 scope + routeGeneration + developmentGeneration + operationId；成功才原子发布新 last-good。
9. `failure`：mutation Run 失败/取消、稳定等待超时或声明失效进入 `needs_attention`；build 失败进入 `preview_update_failed`。两者都保留源码/Diff/Thread 和上一版 last-good，自动路径不重试。
10. `reenter`：从 exit/saving/error 状态重新打开会提升 generation。旧 settle/build 即使稍后成功也不能发布 snapshot、切 Preview、关闭新会话或释放新 lease。
11. `closed`：清除 session 临时计数和 Chat lease。Project/static-capable Runtime 返回 last-good；development-only Workspace 只结束 Chat session，Workspace Tab consumer 仍可保持查看服务。

“重新保存”是显式用户动作：它提升 generation 或创建新的 save attempt，不绕过失败栅栏。关闭窗口不是 cancel；用户在 Transcript 中显式取消 Run 才调用 runner cancel。

### T3.8 同路径执行资源与 RuntimeManager

`LocalAppRuntimeManager` 不再通过 `ownerByDedupeKey` 把多个 Definition 映射到一个 snapshot/consumer 集合。每个 Definition 始终以自身 id 读写 supervisor、artifact 与事件；新增 Main-owned `RuntimeRootExecutionRegistry`：

```ts
type RuntimeRootLease = {
  leaseId: string
  canonicalRoot: string
  runtimeDefinitionId: string
  runtimeScopeId: RuntimeScopeId
  kind: 'development' | 'build'
  generation: number
}
```

- `kind='development'` 表示独占修改周期，不要求一定存在 dev process；因此 static-only 与 uninitialized 创建同样会阻止另一 Runtime 同时修改该 root。canonical root 只作为排他资源 key，不作为产品 identity。静态 last-good Preview 不占执行租约。
- acquire 在 Main 串行队列内执行：同 scope/definition 重复请求幂等；另一 definition 已持有时返回 conflict，不 stop/kill/alias/attach 到对方进程。
- 同 definition 从 development → build 使用原子 lease transition；transition 前停止该 definition 的 dev process，失败则保持 last-good 并释放/恢复到明确状态。
- `stopOwnedDevelopmentRuntimes(root)` 不再作为进入开发的抢占策略。精确 Next dev lock 清理只处理不属于另一活动 registry lease 的陈旧/外部锁，并继续受现有有限 PID ownership 检查。
- Workspace development-only service 在 Chat session 关闭后若仍有 Tab consumer，继续持有 development root lease；因此相同 root 的另一 Runtime 仍收到 conflict。最后 consumer 释放或用户停止 Runtime 后才释放。
- Runtime removal/relocation、trust revoke 与 app quit 必须先使 lease 进入 stopping，等待受管 process tree 有界退出后释放。active Run/session 时 relocation/remove 返回 `runtime-development-busy`，不偷偷迁移 scope。
- 路径级 TrustStore 可以继续共享 canonical-root 授权，但这只是安全授权，不得复用 Definition、snapshot、Thread、window 或用户状态；撤销时界面必须说明同路径所有 Runtime 都会停止。

### T3.9 退出、崩溃、恢复与 late event

- DevelopmentSession 是 Main-memory 活跃事务，不跨 app restart 恢复；Thread、Transcript、view state、last-good 与源码是 durable 事实。
- `before-quit` 设置全局 quitting fence：不启动新的 settle/build，取消未提交的自动 save，按现有 app shutdown 规则终止 Runner/受管进程。源码可能已变但 last-good 不变；下次启动由静态 fingerprint 显示 stale，不能宣称保存成功。
- 窗口关闭后 active Run 的事件仍由 request route 写同一 Thread；不存在 renderer 时不会丢 Transcript。Run 到 terminal 后 coordinator 继续收口或显示主窗口恢复状态。
- 每个异步 callback 必须同时校验 `runtimeScopeId + routeGeneration + developmentGeneration + requestId/operationId`。只校验 buildId、Runtime generation 或当前 active project 均不足。
- Project/Definition 失效或 root changed 时立即提升 routeGeneration、取消 pending save、关闭 Preview consumer并进入 `needs_attention`；旧路径结果不得写入新 scope。
- prompt owner 转移、window cleanup、build commit 和 root lease release 都是幂等操作；重复 close、双击结束、close+主窗口结束并发只产生一个 exit intent。

### T3.10 Snapshot、错误与用户语言

Main 为主窗口和 Runtime 窗口投影同一份 `RuntimeDevelopmentSnapshot`；Header、卡片、placeholder 与专用窗口不得自行组合 Runtime/Run 状态：

```ts
type RuntimeDevelopmentSnapshot = {
  runtimeScopeId: RuntimeScopeId
  runtimeDefinitionId?: string
  routeGeneration: number
  developmentGeneration: number
  phase: RuntimeDevelopmentPhase
  activeRunCount: number
  waitingPromptCount: number
  hasChanges: boolean
  canSubmit: boolean
  canReopen: boolean
  canEnd: boolean
  userMessage?: string
  errorCode?: RuntimeDevelopmentErrorCode
}

type RuntimeDevelopmentErrorCode =
  | 'runtime-development-conflict'
  | 'runtime-development-busy'
  | 'runtime-scope-stale'
  | 'runtime-root-missing'
  | 'runtime-trust-required'
  | 'runtime-live-preview-unavailable'
  | 'runtime-save-unavailable'
  | 'runtime-save-timeout'
  | 'runtime-build-failed'
```

- 默认主动作/accessible name 为“用 AI 修改”，活跃态收口动作为“结束修改”。
- 技术名词、root、端口、command、operationId 和 stack 不进入默认错误消息；高级日志继续脱敏。
- 冲突只显示 Runtime 名称与归属，并提供“切换到正在修改的 Runtime”；不自动导航。
- `canSubmit=false` 必须与 Main 拒绝条件一致；`exit_requested/saving` 不允许 renderer 乐观追加新用户消息。

### T3.11 迁移、实施顺序与回滚

1. 先新增共享 Thread base、Runtime thread store/codec/search metadata 与迁移测试；普通 Project Thread 路径保持不变。
2. 抽取 `ChatBrokerCore`，让现有 Project facade 全量回归通过，再增加 Runtime facade/capability/scoped read。
3. 实现 `RuntimeRootExecutionRegistry` 并移除 path dedupe alias；先用 manager tests 证明不同 Definition snapshot/consumer 隔离和 conflict。
4. 实现纯 `RuntimeDevelopmentCoordinator`、bridge 与 generation-fenced artifact commit；不接 UI。
5. 接入 Runtime window/view-state/presence/close transaction，再替换项目首页与 Workspace 入口。
6. 最后停用 Workspace backing Project 入口和旧 Runtime-scoped auto-settle 路由；普通非 Runtime run-owned settle 保留。

回滚 flag 必须同时关闭新入口和 Runtime facade，但不得删除 `runtime_development_threads`、sidecar、last-good 或旧 synthetic Project 数据。回滚版本不能识别 Runtime Thread 时数据保持在新表/sidecar，恢复新版本后继续可读。禁止在回滚中把 Runtime Thread 转成普通 Project Thread。

### T3.12 流程审查 Findings 与测试门禁

#### Findings（实现前已知）

| Severity | 证据 | 用户症状 | 根因 | 规格修复 |
| --- | --- | --- | --- | --- |
| P0 | STATIC / UNTESTED，`local-app-runtime/index.ts:1482-1617` | 同路径两个入口状态串扰或打开错误 Runtime | path+mode alias 兼任产品 identity | Definition 独立 + root execution lease |
| P0 | RUNTIME / REPRODUCED，见 `evidence.md`；STATIC `workspace-tab-project.ts:30-75` | Workspace Chat 生成 Project，并派生错误 `.agentos/.agentos` | Chat 只能绑定 project_id | Runtime thread collection + scope capability |
| P1 | STATIC / UNTESTED，`runtime-edit-coordinator.ts:217-304` | 每轮修改后 dev/build 反复切换 | settle gate 没有 window exit intent | 显式 session + exitRequested gate |
| P1 | STATIC / UNTESTED，`project-chat-window-manager.ts:121-123` | 关窗后无法表达结束修改或看到恢复状态 | close 只有 view cleanup | 同步 requestExit + Main snapshot |
| P1 | STATIC / UNTESTED，`chat-workspace-store.ts:384-409` | Runtime 对话只能混入项目或造假项目 | thread schema 强制 project FK | 独立 metadata collection，共享 chat core |

#### P0 自动化

- scope resolver：project/workspace/uninitialized、owner mismatch、path missing、relocation generation。
- store/codec：Runtime Thread round-trip、普通列表过滤、global search metadata、SQLite/sidecar fallback、旧版本回滚不删除。
- broker/capability：scope spoof、wrong window、subframe、Preview、跨 Runtime threadId 全拒绝；同 runner/reducer 单写。
- root registry：同 scope 幂等、同 root 不同 definition conflict、显式 switch 不转移 owner、dev→build 原子 transition、last consumer release。
- coordinator transition：open→live→多轮→exit→save；无修改；active Run close；waiting prompt close/reopen；failed-with-mutation；failed-without-mutation；timeout；double exit；reenter during save；late build result。
- artifact integration：generation 在 commit 前检查，build fail/abort 保留 last-good，development-only 不伪造保存。

#### P1 / Electron smoke

- Project Runtime 与 Workspace Runtime 指向同一路径：项目首页不跳 Tab，第二实时实例被阻止，显式切换聚焦正确窗口。
- “用 AI 修改”打开专用窗口；普通列表无 Runtime Thread，全局搜索结果可回到同一 Thread。
- 连续两轮修改期间不 build；running/waiting 时关闭窗口，主窗口状态正确，重开后 prompt/focus 只转移一次。
- close 与主窗口“结束修改”并发只收口一次；保存中重开，旧结果不切 Preview。
- app quit/restart 后 Transcript 和 draft 可恢复、last-good 未被未知半成品覆盖、stale 可见。
- development-only Workspace 结束 Chat 后仍可查看；停止最后 consumer 后同路径租约释放。

正式验收仍需用户另行授权。实现阶段至少运行目标 Node tests、`npm run typecheck`、`npm run test:electron`、`npm run build` 和上述真实 Electron smoke；受限环境无法绑定 loopback 时必须如实记录，不得把单测替代 GUI 路径。

---

## Revision 2 已实现技术基线（未正式验收）

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

export type ProjectChatPromptPayload =
  | {
      kind: 'permission'
      permissionRequestId: string
      toolUseId: string
      toolName: string
      title: string
      displayName: string
      description: string
      inputPreview: string
    }
  | {
      kind: 'question'
      permissionRequestId: string
      toolUseId: string
      questions: ClaudeAskUserQuestion[]
    }

export type ProjectChatPromptSnapshot = {
  projectId: string
  threadId: string
  requestId: string
  promptId: string
  kind: ProjectChatPromptPayload['kind']
  ownerWebContentsId?: number
  createdAt: number
  payload: ProjectChatPromptPayload
}

export type ProjectChatProjectSnapshot = {
  id: string
  name: string
  pathMissing: boolean
}

export type ProjectChatMessageAttachment = {
  id: string
  kind: 'text' | 'image'
  name: string
  mimeType: string
  size: number
  preview?: string
  dataUrl?: string
}

export type ProjectChatTaskItem = {
  id: string
  toolUseId?: string
  subject: string
  description?: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  owner?: string
  blocks?: string[]
  blockedBy?: string[]
  createdAt: number
  updatedAt: number
  order: number
}

export type ProjectChatTaskState = {
  updatedAt: number
  items: ProjectChatTaskItem[]
}

export type ProjectChatFileDiffFile = {
  relativePath: string
  status: ClaudeFileDiffFileStatus
  additions: number
  deletions: number
  hunks: ClaudeFileDiffHunk[]
  truncated?: boolean
}

export type ProjectChatTranscriptItem =
  | (Omit<ChatMessageItem, 'attachments'> & { attachments?: ProjectChatMessageAttachment[] })
  | ChatToolItem
  | ChatThinkingItem
  | ChatActivityItem
  | ChatContextCompactionItem
  | {
      type: 'file_diff'
      id: string
      changeSetId: string
      files: ProjectChatFileDiffFile[]
      status: ClaudeFileChangeSetStatus
      detail?: string
    }

export type ProjectChatThreadSnapshot = {
  id: string
  projectId: string
  title: string
  purpose?: 'home-plugin-customization' | 'home-plugin-card-customization' | 'task-run' | 'skill-run'
  homePluginSlug?: string
  skillCommand?: string
  skillTitle?: string
  createdAt: number
  updatedAt: number
  pinnedAt?: number
  archivedAt?: number
  chatState: {
    model: string
    modelPick?: ChatModelPick
    tasks?: ProjectChatTaskState
    items: ProjectChatTranscriptItem[]
  }
}

export type ProjectChatSnapshot = {
  projectId: string
  project: ProjectChatProjectSnapshot
  workspaceRevision: number
  sequence: number
  routeGeneration: number
  threads: ProjectChatThreadSnapshot[]
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

`ProjectChatProjectSnapshot` 是独立窗口可见的最小项目摘要：只含显示名称与路径是否可用，不暴露本地绝对路径。项目已删除时 `getSnapshot` 返回 `project-not-found`；窗口据此显示“项目已移除”。

`ProjectChatThreadSnapshot` 是 broker durable thread 的显式 renderer 投影，绝不能用 `WorkspaceThread`、`ChatState` 或对象 spread 代替。它故意不含 `sessionId`、`cwd`、`creationSource`/`bindingId`、`skillPath`、task `metadata`、message attachment `path`、file diff `path`/`checkpointId`/内部 `requestId`。`getSnapshot` 和 `ProjectChatEvent.snapshot` 必须经过同一个 projector；主窗口 capability 也不例外。Transcript 的用户/助手自然语言和已展示的 tool/thinking/activity 内容属于 Chat 可见内容，不做关键词式“脱敏”；这里只移除未列出的结构化内部字段。

### 4.1 Bridge API

```ts
export type ProjectChatAPI = {
  getSnapshot(projectId: string): Promise<ProjectChatResult<ProjectChatSnapshot>>
  createThread(input: CreateProjectThreadInput): Promise<ProjectChatResult<CreateProjectThreadResult>>
  submitRun(input: SubmitProjectRunInput): Promise<ProjectChatResult<SubmitProjectRunResult>>
  forkThread(input: ForkProjectThreadInput): Promise<ProjectChatResult<CreateProjectThreadResult>>
  editAndSubmitRun(input: EditAndSubmitProjectRunInput): Promise<ProjectChatResult<SubmitProjectRunResult>>
  archiveThread(input: ArchiveProjectThreadInput): Promise<ProjectChatResult<void>>
  setThreadPinned(input: SetProjectThreadPinnedInput): Promise<ProjectChatResult<void>>
  setThreadModel(input: SetProjectThreadModelInput): Promise<ProjectChatResult<void>>
  markFileDiffReviewed(input: MarkProjectFileDiffReviewedInput): Promise<ProjectChatResult<void>>
  cancelRun(input: CancelProjectRunInput): Promise<ProjectChatResult<void>>
  answerPrompt(input: AnswerProjectPromptInput): Promise<ProjectChatResult<void>>
  openProjectWindow(projectId: string): Promise<ProjectChatResult<void>>
  getWindowViewState(projectId: string): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  saveWindowViewState(input: SaveProjectChatWindowViewStateInput): Promise<ProjectChatResult<ProjectChatWindowViewState>>
  listWebsiteBindings(): Promise<ProjectChatResult<WebsiteBindingPublic[]>>
  revokeWebsiteBinding(bindingId: string): Promise<ProjectChatResult<void>>
  initializePermissionMode(legacyMode?: ClaudePermissionMode): Promise<ProjectChatResult<ClaudePermissionMode>>
  setPermissionMode(mode: ClaudePermissionMode): Promise<ProjectChatResult<ClaudePermissionMode>>
  getModelCatalog(): Promise<ProjectChatResult<ProjectChatModelCatalog>>
  getAgentContext(projectId: string): Promise<ProjectChatResult<ProjectChatAgentContext>>
  searchProjectFiles(input: SearchProjectChatFilesInput): Promise<ProjectChatResult<ProjectChatFileSearchItem[]>>
  pickAttachments(options?: { allowImages?: boolean }): Promise<ProjectChatResult<ProjectChatAttachmentSelection>>
  readProjectAttachments(input: ReadProjectChatAttachmentsInput): Promise<ProjectChatResult<ProjectChatAttachmentSelection>>
  getThreadStatus(input: GetProjectChatThreadStatusInput): Promise<ProjectChatResult<ProjectChatThreadStatus>>
  onEvent(handler: (event: ProjectChatEvent) => void): () => void
}
```

为避免项目窗口复用现有 bridge 时读取 provider credential、任意本地路径或全局 desktop 能力，以上只读/选择能力使用以下冻结的脱敏 DTO：

```ts
type ProjectChatModelProvider = {
  id: string
  name: string
  model: string
  modelSupportsImages: boolean
  defaultHaikuModel: string
  defaultHaikuSupportsImages: boolean
  defaultOpusModel: string
  defaultOpusSupportsImages: boolean
  defaultSonnetModel: string
  defaultSonnetSupportsImages: boolean
}

type ProjectChatModelCatalog = {
  activeProviderId: string
  activeAnthropicModel: string
  providers: ProjectChatModelProvider[]
}

type ProjectChatAgentContext = {
  skills: Array<{
    kind: 'skill' | 'command'
    name: string
    command: string
    title: string
    description: string
    argumentHint: string
    relativePath: string
    scope: 'user' | 'project'
    source: 'claude' | 'agent' | 'agents' | 'cursor'
    native: boolean
  }>
  agents: Array<{
    kind: 'agent'
    name: string
    description: string
    relativePath: string
    scope: 'user' | 'project'
    source: 'claude' | 'agent' | 'agents' | 'cursor'
    native: boolean
    model?: string
    tools: string[]
  }>
}

type SearchProjectChatFilesInput = { projectId: string; query: string }
type ProjectChatFileSearchItem = { label: string; relativePath: string; type: 'directory' | 'file' }

type ProjectChatAttachment = {
  id: string
  kind: 'text' | 'image'
  name: string
  mimeType: string
  size: number
  text?: string
  base64?: string
  preview?: string
  dataUrl?: string
}
type ProjectChatAttachmentSelection = {
  attachments: ProjectChatAttachment[]
  skipped: Array<{ name: string; reason: string }>
}
type ReadProjectChatAttachmentsInput = {
  projectId: string
  relativePaths: string[]
  allowImages?: boolean
}

type GetProjectChatThreadStatusInput = { projectId: string; threadId: string }
type ProjectChatThreadStatus = {
  threadId: string
  active: boolean
  requestId?: string
  reportedModel: string
  permissionMode: string
  tools: string[]
  skills: string[]
  slashCommands: string[]
  agents: string[]
  contextUsage?: ClaudeAgentStatusContextUsage
  lastError?: string
  updatedAt?: number
}
```

`ProjectChatAttachment` 故意没有 `path`；native picker 可选择任意用户确认的文件，但只返回已读取的受限内容。附件合同沿用现有产品边界：每次最多 8 个；文本仅允许 MD/Markdown/TXT，实际 UTF-8 内容最多 512 KiB；图片仅允许 PNG/JPEG/GIF/WEBP，实际解码内容最多 5 MiB；一次请求的实际总内容最多 24 MiB。`id` 最多 256 UTF-16 code units，跨平台 basename `name` 最多 255，`preview` 最多 160。IPC router 必须先按这些字符/编码长度上限做廉价拒绝，再根据 `text` 的 UTF-8 bytes 或严格 base64 解码后的 bytes 重新计算大小；base64 超过 5 MiB 可对应的最大编码长度时不得先分配解码 Buffer。不信任 renderer 传入的 `size`，并拒绝 kind/mime/content 不一致、非法 base64、超数或超量的 submit。

`readProjectAttachments` 只接收相对当前 capability project root 的路径；拒绝绝对路径、`..`、NUL 与超过 8 项，Main 还必须做 realpath/symlink containment。picker/read collaborator 的结果仍须逐项投影并执行上述数量、类型和实际体积上限；不合格项只可进入不含 path 的 `skipped`。`SubmitProjectRunInput.attachments` 从 M0-05A 起改为 `ProjectChatAttachment[]`，broker 给 runner 的内部 adapter 可补空 path，不得重新信任 renderer path。

model catalog 不得含 `apiKey`、`authToken`、`apiKeyUrl`、`baseUrl`、auth mode 或 env 值；agent/file DTO 不得含 `rootPath`/绝对 `path`；thread status 不得含 `cwd`、`sessionId`、`baseUrl`、`endpointHost`、`apiKeySource` 或 credential。所有名为 `relativePath` 的输出仍须通过与输入相同的 POSIX/Windows 相对路径校验，不能仅因字段名为 relative 就信任；attachment/message attachment 的 `name` 必须取跨平台 basename。`getThreadStatus` 返回的 `threadId` 必须等于请求值。router 必须对 collaborator 输出再次逐字段投影，不能假设注入实现已脱敏。

IPC 业务失败必须 resolve 为 `ProjectChatResult.ok=false`，不能依赖 Electron 对 thrown `Error` 自定义字段的序列化。只有 preload/transport 本身断开时 Promise 才 reject；renderer 统一显示脱敏 fallback，不从异常字符串解析 code。

`CreateProjectThreadInput` 必须包含 `projectId`、`title`、`source: 'user' | 'app-command' | 'website'`。网站 variant 还必须含 Main 已验证的 `idempotencyKey`、`bindingId` 与 `receivedAt`；broker 用后两者形成 durable creationSource。`SubmitProjectRunInput` 必须包含 `projectId`、`threadId`、`text`，可选附件、模型与 handoff；不得由 renderer 传 `cwd`、permissionMode 或任意 sessionId。broker 从当前 durable project path、thread `sessionId` 和 thread modelPick 解析这些字段，显式 input modelPick 才覆盖 thread 当前值。

```ts
type CreateProjectThreadInput =
  | { projectId: string; title: string; source: 'user' | 'app-command' }
  | {
      projectId: string
      title: string
      source: 'website'
      idempotencyKey: string
      bindingId: string
      receivedAt: number
    }
```

以下命令 DTO 同样冻结：

```ts
type CancelProjectRunInput = {
  projectId: string
  threadId: string
  requestId: string
  routeGeneration: number
}

type ForkProjectThreadInput = {
  projectId: string
  threadId: string
  messageId: string
  routeGeneration: number
}

type EditAndSubmitProjectRunInput = {
  projectId: string
  threadId: string
  messageId: string
  text: string
  modelPick?: ChatModelPick
  routeGeneration: number
}

type ArchiveProjectThreadInput = {
  projectId: string
  threadId: string
  routeGeneration: number
}

type SetProjectThreadPinnedInput = {
  projectId: string
  threadId: string
  pinned: boolean
  routeGeneration: number
}

type SetProjectThreadModelInput = {
  projectId: string
  threadId: string
  modelPick: ChatModelPick
  routeGeneration: number
}

type MarkProjectFileDiffReviewedInput = {
  projectId: string
  threadId: string
  changeSetId: string
  routeGeneration: number
}

type AnswerProjectPromptInput = {
  projectId: string
  threadId: string
  requestId: string
  promptId: string
  routeGeneration: number
  response: ClaudePermissionResponsePayload
}
```

`promptId` v1 取 SDK `permissionRequestId`。`ProjectChatPromptPayload` 只能由 Main 从对应 SDK event 逐字段投影；不得把完整 `ClaudeChatEvent`、任意 tool input 或未列字段原样放入 snapshot。

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
- 该唯一队列由 `ChatWorkspaceCoordinator.runExclusive(operation)` 持有。现有 `runChatWorkspaceOperation` 必须委托它；broker 构造时注入同一个 scheduler，并在取得锁后才允许第一次 `store.read()`，不能先读再只把 `save()` 排队。只把两个 queue chain 顺序串接不等于 single writer。
- broker 的默认内建 queue 只用于未接 Main 的 isolated tests；production composition 必须显式注入 coordinator scheduler。注入后，broker `enqueue` 必须在调用当下直接把完整 operation 提交给 shared coordinator，不能先挂到私有 Promise chain/microtask 再延迟提交，否则随后调用的 Main operation 会越过先调用的 broker operation，形成两级队列而非唯一全局 FIFO。broker `idle()` 只追踪已直接提交的最后 operation。coordinator operation 内不得再次调用会重入同一 coordinator 的 broker public method；Main handler 要么调用 broker，要么直接运行一个 coordinator operation。
- coordinator 不接收 renderer snapshot、不实现 workspace 业务 reducer，只负责串行调度；底层 store read/save 仍由调用方在 operation 内执行。operation throw 后必须释放队列，后续 operation 继续。
- 已知的 `resolveProjectRuntime(..., trust=true)` 路径当前有一处逃逸的 workspace save。目录 inspect 与 trust grant 可作为锁外 preflight，但最终 durable commit 必须进入 `runChatWorkspaceOperation`：取得 coordinator 后重新读取 project/runtimeDefinitions，确认 project 仍存在且 path 与 inspect 输入一致，基于这份最新 state 重算 definition/revision，再 save + readback。runtime manager/register host 等成功副作用仍在 durable commit 返回后执行；commit 失败且本次新授 trust 时按现有语义 revoke。不得把锁外 `currentState` spread 进最终 save。
- 每个成功 operation 使 `workspaceRevision` 严格递增 1；失败 operation 不递增。
- `sequence` 是每个项目事件流的 Main 内存单调计数；每次广播递增 1，应用重启可从 0 重新开始。
- `routeGeneration` 在项目删除、路径重绑、窗口 capability 重建或应用启动时变化；旧 generation 的事件、prompt 回答和 settle 结果必须拒绝。
- generation 提升后，旧 generation run/prompt 不再出现在 snapshot，也不得继续造成 `thread-busy`；旧 request route 可暂留以返回 `stale-revision`/丢弃迟到事件，但不能污染新 generation。
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

Runner 职责只包含：

- `ClaudeAgentRunner` 构造函数接收 sink，不接收 `WebContents`。
- 把标准化 SDK event 发布给 sink；sink publish 异常只记录脱敏诊断，不得取消 SDK run 或反向抛回 SDK loop。
- SDK event/runner 不判断项目归属，不得自己决定窗口导航、项目选择或 external receipt。

Broker 职责从 M0-02 才开始：

- broker 维护 `requestId -> {projectId, threadId, routeGeneration}`，未知 requestId 事件丢弃并记录计数，不广播。
- reducer 只折叠 broker 已解析归属的合法事件；每次折叠在同一串行队列中更新 durable transcript/run，然后广播新 snapshot。
- terminal 后的任何非 terminal 事件不得改写终态；重复 terminal 必须幂等。

### 5.4 Prompt owner

broker 为每个 pending permission/AskUserQuestion 保存：

```ts
type ProjectChatPromptSnapshot = {
  projectId: string
  threadId: string
  requestId: string
  promptId: string
  kind: ProjectChatPromptPayload['kind']
  ownerWebContentsId?: number
  createdAt: number
  payload: ProjectChatPromptPayload
}
```

owner 按 `design.md §6.4` 选择。`answerPrompt` 必须同时验证 sender capability、ownerWebContentsId、project/thread/request/promptId 和 routeGeneration。第一个有效回答进入 runner 后立即清除 prompt；迟到回答返回 `prompt-not-owned`。owner 被销毁或隐藏时重新分配并广播。

Broker core 的 failover seam 必须接收不可用 `webContentsId`，从候选列表删除该值再选下一项；不能把原 owner 再次分给自己。尚未分配 owner 的 prompt 不接受 renderer 回答。runner answer 失败时保留 prompt/owner/waiting phase，并返回脱敏 `internal-error`，不能假装已回答。

### 5.5 Thread mutation commands

M0-05B 把现有 Chat 可见的 thread 变更收进同一 broker 队列；renderer 不得发送完整 `WorkspaceThread`、`ChatState` 或 transcript array：

- `forkThread` 只接收 durable source thread + 一个现有 message id。broker 从 durable transcript 复制到该 message（含该 message）为止，保留 model/modelPick，清空 session/cwd/tasks，生成新的 user-source thread；不得信任 renderer 提供 items/title/path/session。
- `editAndSubmitRun` 只允许编辑 durable user message。broker 原子地用 trim 后非空文本替换该消息、截断其后 transcript、清空 durable session，然后调用 runner reset-thread，再以同一 user message 开始新 run；不能追加第二条重复 user message。SDK submit 失败仍保留已编辑/截断结果并追加可见失败项。
- `archiveThread` 在 thread 有 active run/prompt 时返回 `thread-busy`，不隐式 cancel；成功只写一次 `archivedAt`。已归档 thread 不接受 submit/edit/model/review。
- `setThreadPinned` 使用显式 `pinned: boolean`，重复调用幂等，不用 toggle 语义；`setThreadModel` 仅在非 busy 时更新 model/modelPick，实际 pick 改变时清空 durable session 并调用 runner reset-thread。`submitRun`/`editAndSubmitRun` 若携带与 durable pick 不同的显式 modelPick，必须执行同一 reset + clear-session 语义，绝不能把旧模型 session 传给新模型。
- `markFileDiffReviewed` 只能按 durable `changeSetId` 找到对应 diff，把 status 改为 `reviewed` 并清空 detail；renderer 不传 diff/file/checkpoint。
- 上述命令都验证 project/thread 归属及当前 `routeGeneration`；每个成功且实际改变 durable state 的命令 revision `+1` 并广播一次。幂等 no-op 返回成功但不增加 revision、不广播。reset-thread 失败必须返回脱敏 `internal-error`，且不能留下“durable session 已清但 runner 未清”的半提交；先完成可失败的 runner reset，再保存 durable mutation。
- 普通 `submitRun` 在 durable thread 已归档时按 `thread-not-found` 拒绝。首次普通 submit 若 thread title 是冻结默认值 `新对话` 或 `New thread` 且此前没有 user message，broker 用 prompt 首个非空行生成最多 34 字符加 `...` 的标题；renderer 不再另写 title。

### 5.6 Production runtime adapter 与 scoped read services

M0-05D 只建立可注入、可单测的真实 Main services，仍不得注册 `project-chat:*` handler、实例化 production broker、切换 runner sink 或让 renderer 可达：

- broker runner adapter 是纯委托：`submit`、`cancel`、`answerPermissionRequest` 原样调用同一 `ClaudeAgentRunner`；`resetThread(threadId)` 精确映射为 `runner.newThread(threadId)`。adapter 不拥有 request route，不消费/改写 event，也不吞异常。
- `getModelCatalog` 每次调用 fresh-read `ClaudeAgentSettingsStore.getSnapshot()`，只逐字段投影 `settings.activeProviderId`、`settings.activeAnthropicModel` 与 provider 的 id/name/model/四档图片能力字段。即使 `configSource === 'env'`，也不创建虚构 env provider，不返回 `env` 对象中的 baseUrl/model/presence flag；绝不返回 credential、URL 或 auth mode。
- `getAgentContext(projectId)` 与 `searchProjectFiles({projectId, query})` 每次调用先 fresh-read durable workspace，只用当前 `project.path` 调用既有 discovery/search。project 不存在、`pathMissing` 或空路径时拒绝且不调用 filesystem；成功输出只保留合同字段，丢弃 rootPath、绝对 path、instruction file content，并重新校验全部 relativePath。
- `readProjectAttachments` 不接受绝对路径。服务本身再次执行与 router 相同的 1–8 项跨平台相对路径校验；对 root 和每个 candidate 分别 `realpath`，再用 `path.relative(realRoot, realCandidate)` 验证 candidate 等于 root 或位于 root 内。候选 realpath 失败、指向 root 外（含 symlink escape）或指向 root 本身时，该项只生成 `{name: basename, reason: 'Attachment is unavailable.'}`，不得传给 attachment reader；其它项才把 canonical absolute path 交给既有 reader。root realpath 失败则整次拒绝。reader 结果仍由 M0-05A router 做数量/MIME/真实体积/内容签名和逐字段投影；IPC 输出不含 path 或底层 reason。
- `pickAttachments` 只委托 Main 注入的现有 dialog+reader 函数，参数只有一次冻结的 `allowImages === true`；dialog/reader 的 raw 结果必须先经过 M0-05A router projector 才能到 renderer。
- `getThreadStatus({projectId, threadId})` 每次调用 fresh-read durable project/thread ownership，拒绝 archived/missing thread 与 missing path；只用 durable `thread.chatState.sessionId/modelPick`、durable project cwd 调用同一 runner 的 `getStatus({threadId, sessionId?, modelPick?, cwd, refresh: false})`。返回只投影 `ProjectChatThreadStatus`，且 threadId 必须与请求一致；cwd/session/baseUrl/endpoint/auth/config source/MCP/plugin 细节不得外泄。

这些 services 的异常统一由现有 router `call()` 映射为脱敏 `internal-error`；不得把 filesystem、settings 或 runner 原始错误文本送给 renderer。M0-05D 不解决 runner sink/broker 的构造环、prompt owner presence、rewind、TaskHome managed run 或 feature flag composition；这些必须在后续独立任务单冻结后，才可执行 renderer cutover。

### 5.7 Broker-owned file rewind

Project Chat rewind 的 renderer 输入只允许 `{projectId, threadId, changeSetId, routeGeneration}`；不得包含 requestId、checkpointId、cwd、sessionId 或 modelPick。broker 在统一 workspace operation 内 fresh-read project/thread ownership 和 durable `file_diff` item，再从 durable item/thread/project 构造 runner payload：

```ts
type RewindProjectFileDiffInput = {
  projectId: string
  threadId: string
  changeSetId: string
  routeGeneration: number
}

type RewindProjectFileDiffResult = {
  changeSetId: string
  status: 'reverted' | 'error'
  detail?: string
}
```

- archived/missing thread、stale generation、active run/prompt、missing diff/checkpoint 都在调用 runner 前拒绝；已 `reverted` 为 success no-op，不 save、不广播、不再调用 runner。`reviewed`/`error` 可以重试。
- runner rewind payload 精确取 durable diff 的 requestId/checkpointId、thread id、thread modelPick/sessionId 与 project cwd。为支持应用重启后的 durable session，Main-only runner payload 可增加 optional `sessionId`；`ClaudeAgentRunner.rewindFiles` 只在该 thread 当前 runtime state 没有 session 时接受并写入该值，renderer 的 Project Chat API 永不暴露此字段。
- runner 返回 `ok:true/false` 都是一次已完成 rewind attempt：broker 把对应 diff 原子写成 `reverted/error`，detail 只用固定安全文案，revision `+1` 并广播一次，再返回上述 public result。runner throw/reject 返回脱敏 `internal-error` 且 durable state/revision 不变。
- `ClaudeAgentRunner` 仍可能发布 `file_rewind_result`；旧 request 已 terminal 时该 event 按现有 fence 丢弃。broker 以 direct runner result 为本命令唯一 durable mutation，不能因同步 result + 迟到 event 双写/双广播。

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

### 6.1 Main-owned presence 与 Prompt owner 候选

Main 维护与 capability 分离但以 `webContentsId` 关联的 presence registry。renderer 只可通过 typed API 报告 `{projectId, selectedThreadId?}`；`visible`、`focused`、`webContentsId`、window kind、project-window 固定 project/generation 全由 Main/registry 提供，renderer 输入若携带这些字段必须拒绝。

registry 规则：

- register 后默认 `visible=false/focused=false`；Main window lifecycle 才能调用 `setWindowState(webContentsId, {visible, focused})`。hidden 必须同时清 focused；某窗口 focused 时 registry 清除其它窗口 focused，维护确定的单焦点。
- project-window selection 的 projectId 必须等于 capability 固定 projectId；main-window 可报告任一 project。stale/unknown/unregistered capability 拒绝，不能创建隐式 presence。
- 针对 `{projectId, threadId, routeGeneration}` 的候选顺序精确为：visible+focused 且 selection 正在显示该 thread 的窗口；同 generation、visible 的该 project Chat window；visible main window。每组去重并按最近 focus epoch、再按 webContentsId 确定排序；hidden/stale/unknown 永不返回。
- broker 创建 prompt 时同步调用注入的 candidate resolver 并冻结 owner。presence refresh 时，只要当前 owner 仍在新候选中就保持 owner，避免单纯焦点切换搬动已打开对话框；owner hidden/destroyed/stale 或当前无 owner 时选择新的首候选。owner 改变后对受影响 project 广播 snapshot，但不改 workspace revision。
- registry unregister 与 broker `onWebContentsUnavailable(webContentsId)` 都必须幂等；一次 unavailable 要处理该 window 拥有的全部 prompt，不只一个 promptId。候选 resolver/refresh 异常不得删除 prompt、回答 prompt 或中断 runner；最多保留当前安全 owner/无 owner并记录脱敏诊断。

M0-05E 只实现 presence/owner/rewind 的 disabled seam；window lifecycle 与 production broker 的实际 wiring 留给 M0-05F。

## 7. Project Chat Window

- `ProjectChatWindowManager` 使用 `Map<projectId, BrowserWindow>`；重复打开只 `show/focus`。
- 与主窗口使用相同 renderer bundle 和同一个 preload **文件**，但暴露不同 capability profile。Main 创建项目窗口时必须通过 `webPreferences.additionalArguments` 写入固定 `--agentos-window-kind=project-chat`；preload 在 M0-05 起据此只暴露 `window.projectChat`，不得暴露现有 `window.desktop` 或 `window.claudeChat`。主窗口 profile 保持既有 bridge，并在 cutover 时增加 `projectChat`。query/route 只决定渲染 `ProjectChatWindowPage`，不能选择 preload profile 或授权项目。
- 必须保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox` 与主窗口安全基线一致。
- BrowserWindow `close` 只保存 view state、注销订阅/owner 并销毁视图；不得调用 cancel/newThread/删除线程。
- 窗口创建后再注册 capability，load 失败时清理 registry 与 map。
- 项目删除/路径丢失由 snapshot 状态驱动 UI；不得自动把窗口指向其它项目。
- `ProjectChatWindowPage` 的 `projectId` 来自 Main 创建窗口时固定的 capability/query 投影，窗口生命周期内不可更换。线程选择器只列该 snapshot 的项目内线程；新建对话必须是独立 UI action 和显式 renderer view state，不能用空 `selectedThreadId` 下拉项后立即 fallback 到最新历史线程。
- 新建对话可在 renderer 内暂存一个 project-scoped `modelPick` 草稿。首次创建 thread 后的第一条 `submitRun` 必须显式携带该 pick，由 broker 用现有 model-change/reset/session-clear 规则与首条消息一起持久化；创建成功后清除 renderer 草稿。不得把仅更新模型按钮文案视为模型选择成功。
- 项目窗口所需的模型目录、项目上下文/文件搜索、附件选择、状态与 rewind 必须经后续冻结的 project-scoped typed API，由 Main 从 capability 的 projectId 解析路径/线程；不得为了复用现有 Chat 而重新暴露含 credential 的 `claudeChat.getSettings` 或接受 renderer 传绝对路径的 `desktop` API。

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

type SaveProjectChatWindowViewStateInput = {
  projectId: string
  patch: Partial<Pick<
    ProjectChatWindowViewState,
    'selectedThreadId' | 'draft' | 'externalTaskSeenAt' | 'bounds'
  >>
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
- runner sink：标准事件只发布一次，sink failure 不终止/取消 run；runner 不做 request ownership。
- broker/reducer：事件归属、未知 request 丢弃计数、terminal/旧 generation 迟到事件 fence。
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
2. 实现并测试 broker core，但不接 production Main；Revision 1 保持完整路径，避免中间态双 writer。
3. 注册 typed IPC、capability 与 broker wiring，入口保持内部关闭；旧 renderer 仍走完整 Revision 1。
4. 主窗口在一个 cutover 中切到 snapshot 投影并禁用 renderer full workspace write；同一 cutover 后 broker 才成为 production runner caller。
5. 再开放项目 Chat 窗口；通过双窗口测试后才开放 deep link。
6. 最后接 RuntimeEditCoordinator。

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

## 17. WorkspaceTab → Project durable contract（M3-01）

- `WorkspaceTab.projectId?: string` 是兼容读取字段；所有 Main 新建/打开的 Tab 及 lazy migration 后的 Tab 都必须写入它，JSON 与 SQLite `workspace_tabs_json` 原样 round-trip。
- Renderer 只可调用 `openWorkspaceTabProjectChat(workspaceTabId)`；不得提交 path、runtimeDefinitionId、projectId 映射或 URL。该调用只授权主窗口 main frame、已注册 capability 与 renderer allowlist document；项目 Chat 窗口、Preview、subframe、未知 sender 一律拒绝。
- 该 API 在唯一 `ChatWorkspaceCoordinator` operation 内 fresh-read Tab 和 RuntimeDefinition。Main 用 Runtime canonicalRoot/rootPath 与 Project path 的规范化值匹配：唯一匹配复用并回写；无匹配创建 user Project；dangling/wrong projectId 重新匹配；多个匹配失败并且不打开窗口。
- link 保存后必须 readback 确认 `tab.projectId` 和 Project 均存在，失败不得调用 `ProjectChatWindowManager.open()`，并 best-effort 恢复未链接快照。窗口仍按最终 projectId 唯一复用，生命周期内不能换项目。
