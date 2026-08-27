# M0-05B｜Broker Thread Mutations（Disabled Seam）

## 目标

在接 Main production composition 或 React 前，先把现有完整 Chat 必需的 fork、编辑重发、归档、置顶、模型切换和 Diff 已读变成 Main-owned broker intent。renderer 不再通过完整 thread/chat snapshot 写这些 durable 事实。本单仍保持 disabled seam。

## 依赖

- `M0-05A` 完成并通过独立复核。
- 精读 `technical.md §4.1`、`§5.1`、`§5.2`、`§5.5` 与现有 `workspace-session.ts`/`ChatPage.tsx` 对应行为；后两者只读，不得修改。

## Write allowlist

- `src/project-chat-contract.ts`
- `src/project-chat-ipc-seam.ts`
- `electron/project-chat-contract.test.mjs`
- `electron/project-chat-broker.ts`
- `electron/project-chat-broker.test.mjs`
- `electron/project-chat-ipc.ts`
- `electron/project-chat-ipc.test.mjs`
- `electron/preload.ts`
- `electron/electron-env.d.ts`
- `electron/desktop-seam.test.mjs`

禁止写：`electron/main.ts`、`electron/claude-agent-runner.ts`、window manager/view-state、workspace store/session、React/CSS、TaskHomePluginManager、binding/deep-link、Runtime。禁止注册 production handler、实现真实 collaborator 或打开 feature flag。

## 实施步骤

1. 按 `technical.md §4.1/§5.5` 精确新增并贯穿 contract → exhaustive channels → preload → IPC router → broker port 的六个方法：`forkThread`、`editAndSubmitRun`、`archiveThread`、`setThreadPinned`、`setThreadModel`、`markFileDiffReviewed`；既有方法顺序保持稳定。
2. 所有 router 输入只逐字段接受冻结 DTO；先做 M0-03 sender/frame/document/project/current-generation authorization，再验证非空 id、boolean、`ChatModelPick`。禁止接收 renderer 的 thread/title/items/chatState/session/cwd/diff/checkpoint/creationSource。
3. broker 为所有命令复用同一 operation queue、project/thread ownership 与 route-generation fence；归档 thread 对 submit/edit/model/review 返回 `thread-not-found`。active run/prompt 上的 archive/edit/model 返回 `thread-busy`，不调用 cancel。
4. `forkThread` 只从 durable source transcript 找 `messageId`，复制到该 message（含）为止；新 id 由 broker 生成，title/model/modelPick 取 durable source，session/cwd/tasks 不复制，creationSource 固定 user。找不到 message 返回 `invalid-argument`；不得由 renderer 传 transcript。
5. `editAndSubmitRun` 只编辑 durable user message：trim 后非空；替换该项并截断后续项，清 session，runner `resetThread(threadId)` 成功后才保存，再沿用 `submitRun` 的 run registration/permission capture/SDK failure 语义，但不得追加重复 user message。把 broker runner port 增加 `resetThread(threadId): Promise<void>`；本单不改真实 runner，测试 fake 实现即可。
6. `setThreadPinned` 是显式 boolean 幂等 set；`setThreadModel` 比较 providerId + anthropicModel，实际变化才先 reset runner、再清 session/更新 model+modelPick。`submitRun`/`editAndSubmitRun` 的显式 modelPick 若不同，也走同一 reset/clear-session，runner payload 绝不携带旧 session。
7. `markFileDiffReviewed` 只按 durable changeSetId 把目标 diff 设 reviewed 并清 detail；renderer 不传 file/checkpoint。找不到返回 `invalid-argument`。
8. 普通 `submitRun` 同一保存中完成首次标题派生：仅当原 title 精确为 `新对话` 或 `New thread` 且此前无 user message；取 prompt 首个非空行，最多 34 code units，超出为前 34 + `...`。附件-only submit 不改标题。
9. 每个实际 durable mutation revision 恰好 `+1` 并广播一次；显式 pin/model 的 same-value no-op 返回 success 但不 save、不广播。reset throw 返回脱敏 `internal-error`、store/revision 不变、runner submit 不调用。保持 M0-05A snapshot projector，绝不把内部 durable type重新暴露。
10. source-audit 锁死 `main.ts`、真实 runner、React、workspace writer 与 Revision 1 production handler零改，仍无 `project-chat:*` 注册。

## 必测断言

- 六个新增 API 在 contract/channel/preload/router exhaustive，wrong sender/subframe/URL/project/stale generation 均拒绝且 broker 零调用。
- fork 只复制 durable message 截点，保留 model/pick/title，清 session/cwd/tasks、source=user；renderer 注入 items/title/session/path 被 router 丢弃。
- edit 只允许 user message；没有重复 user item；后续 transcript 被截断；reset→save→submit 顺序固定；submit throw 保留编辑结果并追加失败项。
- archive busy 不 cancel；archive 后 submit/edit/model/review 拒绝；pin true/true 与 false/false 第二次不增 revision/不广播。
- model change 与 submit 显式 pick change 都 reset 并不向 runner 传旧 session；same pick 不 reset。
- review 只更新目标 changeSet；不存在 id 不保存。
- 首次标题派生的中英文默认标题、换行、34/35 边界与 attachment-only 均覆盖。
- 并发两个 thread mutation 不丢更新，revision 连续；getSnapshot/broadcast 仍只有安全 ProjectChatThreadSnapshot。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-broker.test.mjs electron/project-chat-ipc.test.mjs electron/project-chat-contract.test.mjs electron/desktop-seam.test.mjs
git diff --check
```

## 停止并报告

若任何命令必须接收 renderer 的完整 transcript/thread/chat state、必须修改真实 runner/Main/React、或无法在 save 前完成必要 reset，立即停止并报告。不得用 raw spread、expected full snapshot、隐式 cancel 或“先写 durable 再尽力 reset”绕过。

## Close record

- 状态：PASS / closed；未进入 M0-05C，未启用 production wiring。
- 复核收尾：旧 generation prompt 不再阻塞当前 generation；所有 mutation 验证 durable project/thread ownership；archived source 可 fork；六路 IPC 均锁定 sender/frame/document/project/generation 与冻结 DTO 投影。
- 独立门禁：`npm run typecheck` exit 0；本单指定 Node tests 49/49 PASS；`git diff --check` exit 0。
- 下一单：`M0-05C-workspace-coordinator.md`。
