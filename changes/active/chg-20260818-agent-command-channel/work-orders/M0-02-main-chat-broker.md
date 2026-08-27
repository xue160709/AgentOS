# M0-02｜Main-owned ProjectChatBroker

## 目标

实现项目 thread/transcript/run/prompt/session 的唯一写入者与 revision-aware 串行队列。暂不开放新窗口和网站入口。

本单只实现并测试 broker core，不切换当前生产 Chat 路径。Revision 1 renderer/IPC 在 M0-05 原子 cutover 前继续走现有 runner；禁止让 broker 与 renderer 同时写同一 workspace。

## 依赖

- `M0-01` 完成。
- 精读 `technical.md §4–5`、`§11` 中与 thread receipt 无关的 broker 规则。

## Write allowlist

- `electron/project-chat-broker.ts`（新增）
- `electron/project-chat-broker.test.mjs`（新增）
- `electron/chat-workspace-store.ts`
- `electron/chat-workspace-store.test.mjs`
- `electron/claude-agent-runner.ts`
- `src/project-chat-contract.ts`
- `src/project-chat-reducer.ts`
- `src/components/types.ts`
- `src/components/workspace-session.ts`
- `src/chat-workspace-persistence.ts`
- `electron/workspace-session.test.mjs`

禁止写：`electron/main.ts`、preload、React、window manager、deep link、Runtime。本单测试直接构造 broker，不做 production wiring、feature-flag 切换或旧 IPC 委托。

## 实施步骤

1. 注入 workspace store、runner、clock/id factory/event broadcaster，禁止 broker 内直接访问 renderer。
2. 迁移 `WorkspaceThread.creationSource` 与 SQLite `creation_source_json`；旧/null/非法值为 user，JSON/SQLite 两个恢复源往返不丢 source。
   - creation-source 判别联合定义在 `src/components/types.ts`，`ProjectThreadCreationSource` 复用/别名该事实，不能建立两个结构相似但可漂移的联合；
   - `WorkspaceSession.addThread` 接受可选 creationSource，省略时创建 `{kind:'user'}`；`ensureTaskRunThread` 创建的既有应用内线程同样明确为 user；
   - AppShell 等通过 WorkspaceSession 创建线程的调用点无需逐个改 TSX，也不得因此扩张 React allowlist。
3. 建立单串行 mutation queue；成功 durable operation revision +1。
4. 实现 `getSnapshot/createThread/submitRun/cancelRun/answerPrompt` 内核；通过注入的最小 runner/store/broadcaster 接口测试，不接 `main.ts` 旧 IPC。
   - `getSnapshot` 必须排在已入队 mutation 之后读取，不能在异步 save 中间返回旧 revision；
   - 默认 ID factory 使用强唯一 ID（如 `randomUUID`），不能只用同毫秒时间戳；测试仍可注入确定性 factory；
   - project `pathMissing===true` 或空路径均返回 `project-path-missing`。
5. submit 固定执行“持久化 thread/user message → submitting → runner submit → request mapping/running”；SDK submit 失败保留可见线程。
   - runner payload 的 cwd 来自 durable project，sessionId 来自 durable thread，modelPick 为显式 input 或 thread 当前值，permission mode 只读取一次；renderer 不能注入这些权威字段；
   - website create variant 使用已验证的 bindingId/receivedAt 形成 creationSource，不能把所有 website source 返回 invalid。
6. 同 thread active 时返回 `thread-busy`，不得调用旧隐式取消路径；不同 thread 允许并行。
7. event sink 按 request mapping 折叠 durable transcript；terminal/sequence/generation fence 严格执行。
   - broker 维护 `requestId -> {projectId, threadId, routeGeneration}` registry；
   - 未登记 requestId 的事件丢弃、增加脱敏诊断计数且不广播；
   - 已登记但 terminal/旧 generation 的迟到事件按规格幂等处理。
8. 实现 prompt 单 owner 的纯 registry/重新分配逻辑；UI capability 由下一单接入。
   - owner unavailable 时从候选中移除原 owner，再选下一项；无 owner 时拒绝回答；runner answer throw 时保留 prompt 与 waiting run，返回脱敏错误。
9. broker 实现 `ClaudeChatEventSink.publish` 或等价注入入口，但本单不得替换当前 Main 的 WebContents sink；M0-03 才负责 wiring。
10. routeGeneration 提升后旧 generation run/prompt 不出现在 snapshot、不造成 thread-busy；旧 route 只用于识别 stale cancel/event。

## 必测断言

- 两个并发 mutation 不丢 thread，revision 严格递增。
- 同 thread 第二次 submit：runner submit 调用次数不增加，cancel 次数为 0。
- 不同 thread 同时 active；事件只进入归属 thread。
- 未知 requestId 不写 workspace、不广播，只增加诊断计数；该断言不得由 runner 假实现。
- terminal 后迟到 delta 不改变终态/transcript done 状态。
- generation 提升后同 thread 可启动新 run，snapshot 不含旧 run/prompt，旧 cancel 返回 stale。
- runner submit throw 后 thread 可见且 failed。
- broker restart 读取 durable thread；live run 不伪恢复。
- creationSource 在 JSON/SQLite round-trip 与旧 snapshot migration 后正确。
- website thread 保存 bindingId/receivedAt；已有 session/modelPick/cwd/permission 的 runner payload 来源正确且 permission getter 只调用一次。
- prompt owner 9 unavailable 后真实转移到 7；answer throw 不清 prompt、不改 waiting phase。
- delayed store save 与并发 getSnapshot 证明读排在写之后；默认 ID factory 不因同毫秒创建碰撞。
- SQLite 专项测试必须在可用时移除/绕过 JSON 恢复源，证明 `creation_source_json` 单独 round-trip；不能只由 JSON fallback 使测试通过。
- 当前 `claude-chat:*` handler、主窗口事件和 renderer workspace writer 行为未改变；不存在中间态双 writer。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-broker.test.mjs electron/chat-workspace-store.test.mjs electron/workspace-session.test.mjs electron/chat-run.test.mjs
```

## 停止并报告

如果现有 workspace save 无法原子表达 revision，不保留 renderer full snapshot workaround；先报告所需 store schema migration。
