# M0-05C｜唯一 Workspace Operation Coordinator

## 目标

把现有 Main `runChatWorkspaceOperation` 与 `ProjectChatBroker` 的两条独立串行链收敛为同一个 operation coordinator，保证任何 production wiring 前，所有 workspace read-transform-save 都在取得同一把异步锁后才读取。行为保持 disabled：不注册 Project Chat IPC、不切 runner sink、不改 renderer。

## 依赖

- `M0-05B` 完成并通过独立复核。
- 精读 `technical.md §5.1`；审计 `electron/main.ts` 中所有 `ChatWorkspaceStore.save` 调用点和 `runChatWorkspaceOperation` 包裹范围。

## Write allowlist

- `electron/chat-workspace-coordinator.ts`（新增）
- `electron/chat-workspace-coordinator.test.mjs`（新增）
- `electron/project-chat-broker.ts`
- `electron/project-chat-broker.test.mjs`
- `electron/main.ts`（只允许 coordinator 初始化、`runChatWorkspaceOperation` 委托、必要 import，以及把已知逃逸的 `resolveProjectRuntime(..., trust=true)` 最终 durable commit 收进该 wrapper 并做锁内 fresh-read/revalidation）
- `electron/desktop-seam.test.mjs`（只允许 source-audit/回归断言）

禁止写：contract/preload/IPC router、runner/sink、window manager/view-state、workspace store schema、TaskHomePluginManager、React/CSS、binding/deep-link、Runtime modules。禁止注册 `project-chat:*` handler、实例化 production broker、改变 feature flag 或旧 `claude-chat:*` 路径。

## 实施步骤

1. 新建 Main-safe `ChatWorkspaceCoordinator`，只提供泛型 `runExclusive<T>(operation: () => Promise<T> | T): Promise<T>` 与测试所需 `idle()`；内部 promise chain 对 resolve/reject 都释放，不能吞掉调用者错误。
2. `ProjectChatBrokerOptions` 增加可选 `runExclusive` scheduler。broker 每个 public/read/write/event/prompt operation 的 `enqueue` 必须在调用当下把**整个 operation 直接提交**给 scheduler；第一次 store.read 发生在 scheduler 回调内。external scheduler 前不得再挂 private `operationChain.then(...)` 或其它 microtask gate；否则随后调用的 Main operation 会越过先调用的 broker operation。未注入时才保留 isolated-test 内建 chain。
3. broker `idle()` 必须等待已直接提交给 external scheduler 的最后一个 broker operation 完成；不能因外部 queue 仍 pending 提前返回。shared coordinator 本身保持同一 broker 的 publish 顺序与现有 terminal/generation fence。
4. `electron/main.ts` 在 `ChatWorkspaceStore` 创建后创建唯一 coordinator；`runChatWorkspaceOperation` 删除自有 chain，改为调用 coordinator。初始化前调用继续明确 throw，不静默 fallback 到第二条 queue。
5. 审计 Main 所有 `getChatWorkspaceStore().save`。已知唯一逃逸点是 `resolveProjectRuntime(..., trust=true)` 的 Runtime definition save：允许目录 inspect、trust load/grant 作为锁外 preflight；最终 commit 必须调用 `runChatWorkspaceOperation`，在锁内 fresh-read project/runtimeDefinitions、验证 project 仍存在且 path 与 inspect 输入一致、基于最新 state 重算 existing/definition/revision、save + readback。禁止把锁外 `currentState` spread 进 save。runtime manager 注册与 host registration 仍在 durable commit 成功后；commit 失败且本次新授 trust 时维持现有 revoke 补偿。除此之外的所有 save 必须已经在 wrapper 内；只读 `read()` 可在队列外。
6. 新增组合测试：使用同一 coordinator 给一个 broker 和一个模拟 Main mutation。人为暂停 Main operation，在它提交期间排入 broker create/submit/event（另测反向顺序），用明确 callback/read marker 断言 Main→broker 与 broker→Main 的真实执行顺序；只比较最终字段不足以证明 FIFO。最终 state 同时保留两边改动、revision 连续且广播读取 committed state；证明 broker 没在锁外预读。
7. source-audit 锁死：Main 只有一个 coordinator chain；不存在旧 `chatWorkspaceOperationChain`；全部七个 workspace save 都位于 `runChatWorkspaceOperation` 的动态范围，其中 Runtime trust commit 有锁内 fresh read + project-path revalidation，且 runtime/register host 在 durable commit 后；没有 Project Chat router/broker production 实例/handler；旧 Claude handler/sink 文本不变。

## 必测断言

- FIFO；operation reject 后下一项继续；`idle` 不提前；同步 throw/异步 reject 原样给调用者。
- broker external scheduler 覆盖 getSnapshot/create/submit/publish/broadcast；paused coordinator 时 broker `idle()` 不提前；并发 Main+broker mutation 不丢项目、thread、runtime/sidebar fixture 中任一字段。
- broker 首次 read 的时间发生在它真正取得 coordinator 后；测试用 read counter/paused promise 明确证明，不只比较最终碰巧结果。
- 每个成功业务 mutation仍只按原规则 revision +1；coordinator 本身不改 revision。失败不写、不广播。
- Main 现有 Runtime/workspace 目标测试保持绿；source audit 必须按 AST ancestor 或精确 handler callback scope 证明恰好七个 `getChatWorkspaceStore().save` 都位于 `runChatWorkspaceOperation` callback 内，不能只搜索每个 save 之前是否曾出现过 wrapper 文本。
- `resolveProjectRuntime` 回归锁定：inspect 后若 coordinator 前已有别的 workspace mutation，最终 state 保留该 mutation；project 删除/path 改变时不保存 stale definition；save/readback 失败仍按既有规则补偿本次新授 trust，且 runtime/register host 不先于 durable commit。
- `main.ts` 没有 `project-chat:*` 注册，runner/preload/React零改。

## 命令

```bash
npm run typecheck
node --test electron/chat-workspace-coordinator.test.mjs electron/project-chat-broker.test.mjs electron/desktop-seam.test.mjs electron/workspace-session.test.mjs electron/chat-workspace-store.test.mjs
npm run test:electron
git diff --check
```

## 停止并报告

若除已知 `resolveProjectRuntime(..., trust=true)` 外还发现 Main save 在 `runChatWorkspaceOperation` 外，先列出精确调用点并停止；不得留下第二条 queue 或用 revision 冲突重试掩盖。若该已知点无法通过“锁外 preflight + 锁内 fresh-read/revalidate/recompute/save/readback + 锁外成功副作用/失败补偿”收敛，或必须改业务 reducer/Runtime module/renderer 才能统一调度，也立即停止。

## Close record

- 状态：PASS / closed；仍保持 disabled seam，未进入 M0-05 production cutover。
- 复核收尾：external broker operation 在调用当下直接进入 shared coordinator；真实 marker 锁定全局 FIFO；AST 证明恰好七个 Main workspace save 全部位于统一 wrapper callback；Runtime trust stale 路径补偿新授权。
- 独立门禁：目标 Node tests 61/61 PASS；完整 Electron tests 199/199 PASS；typecheck 与 diff check exit 0。
- 下一步：先拆并冻结 production runtime/composition 前置，不直接执行职责过宽的旧 M0-05。
