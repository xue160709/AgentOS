# M0-05E｜Prompt Presence 与 Broker Rewind（Disabled Seam）

## 目标

补齐 production cutover 前两个 Main-owned 核心缺口：可验证的 window presence/prompt owner 候选与 broker-owned file rewind。建立完整 typed API、preload/router/broker/runner adapter，但继续保持 disabled：不改 `electron/main.ts`、不注册 handler、不实例化 production broker/window、不切 sink、不改 TaskHome/React。

## 依赖

- `M0-05D` PASS/closed。
- 精读 `design.md §6.4`、`technical.md §5.4、§5.7、§6.1`、现有 broker prompt route、runner rewind、capability/router/preload exhaustive tests。

## Write allowlist

- `src/project-chat-contract.ts`
- `src/project-chat-ipc-seam.ts`
- `src/claude-chat-types.ts`（只允许 runner rewind optional durable session 字段）
- `electron/preload.ts`
- `electron/electron-env.d.ts`
- `electron/project-chat-presence.ts`（新增）
- `electron/project-chat-presence.test.mjs`（新增）
- `electron/project-chat-ipc.ts`
- `electron/project-chat-ipc.test.mjs`
- `electron/project-chat-broker.ts`
- `electron/project-chat-broker.test.mjs`
- `electron/project-chat-runtime-services.ts`（只允许 runner adapter 增加 rewind delegate）
- `electron/project-chat-runtime-services.test.mjs`
- `electron/claude-agent-runner.ts`（只允许 rewind durable session restore）
- `electron/chat-run.test.mjs`（只允许上述 runner 行为回归）
- `electron/project-chat-contract.test.mjs`
- `electron/desktop-seam.test.mjs`（只允许 disabled/source audit）

禁止写：`electron/main.ts`、window manager/view-state/coordinator/workspace store、TaskHomePluginManager、现有 WebContents sink、React/CSS/renderer controller、Runtime/binding/deep-link。禁止 production registration/composition、feature flag、旧 `claude-chat:*` cutover。

## 实施步骤

1. 按 `technical.md §6.1` 新建纯 Main-side `ProjectChatPresenceRegistry`：显式 register/unregister、Main-only `setWindowState`、authorized `reportSelection`、`ownerCandidates`。不得读取 BrowserWindow 全局或 renderer state；所有 dependency 显式注入/传入。
2. 共享 contract/API 增加 `ReportProjectChatPresenceInput = {projectId:string; selectedThreadId?:string}` 与 `reportPresenceSelection`；集中 channel、preload、Window 声明 exhaustive 更新。router 必须先从 raw projectId 做 capability 授权，再严格 whitelist DTO；拒绝 renderer 提供的 visible/focused/webContentsId/kind/generation。调用 collaborator 时 owner id 只取授权 capability。
3. presence candidate 精确实现三段优先级、dedupe、generation fence、单焦点与稳定排序。project-window 只能 report 固定 project；main-window 可 report project。hidden/unregister/stale generation 不返回；register 默认不可见。
4. broker options 增加可注入 `promptOwnerCandidates({projectId,threadId,routeGeneration})`。新 prompt 在同一 enqueue 内解析候选并设置首 owner；resolver throw 不丢 prompt。新增 queued `refreshPromptOwners(projectId?)` 与 `onWebContentsUnavailable(webContentsId)`：刷新全部相关 pending prompts，当前 owner 仍 eligible 时保持，否则 failover；owner 实际变化后每个受影响 project 最多广播一次、workspace revision 不变。保留旧 core 测试 seam 仅为兼容测试，不允许 production 绕过 registry。
5. contract/API 增加 `rewindFileDiff(RewindProjectFileDiffInput)` 与 public result，贯穿集中 channel/preload/router。router 按 mutation 命令规则先 capability/project 授权再严格 DTO parser，丢弃/拒绝 renderer forged request/checkpoint/cwd/session/model 字段。
6. 扩展 broker runner port与 D adapter：`rewindFiles` exact delegate。broker 按 §5.7 从 durable state构造 exact payload并 direct fold result；同 thread busy/prompt、archived/orphan/stale/missing checkpoint 在 runner 前拒绝；already reverted no-op；normal failure写 generic error；throw 原子不写。
7. `ClaudeFileRewindPayload` 只增加 optional `sessionId`；runner rewind 在当前 thread runtime session 缺失时才使用 trim 后传入值，已有 in-memory session 不被覆盖。补重启路径测试，禁止把 session 放进 Project Chat renderer DTO/snapshot。
8. source audit 锁定 `main.ts` 无 presence/runtime service/broker composition，Project Chat 仍 disabled；旧 Claude rewind IPC payload继续兼容，旧 handler/sink 文本不变。

## 必测断言

- presence：register 默认 hidden；unknown/stale/wrong-project selection 拒绝；renderer forged lifecycle字段拒绝；Main state 独占 visible/focused；focus 唯一；三段优先级、dedupe、focus epoch/id tie-break 精确。
- prompt：创建时 owner 自动选出；resolver throw 保留无 owner prompt；focus-only refresh 不抢走仍 visible owner；hide/destroy/unregister 后一次调用转移该 window 的全部 prompts；无候选保持 pending/不可回答；owner 更新只广播、revision 不变；late old owner answer 拒绝。
- rewind：router 对 unknown/subframe/wrong URL/wrong project/stale generation 优先拒绝且 broker零调用；冻结 DTO；durable payload含 request/checkpoint/cwd/session/model 且 renderer不可覆盖。
- busy/archived/orphan/missing diff/checkpoint 不调用 runner；reverted no-op；`ok:true/false` 各只 save+broadcast 一次并写固定 safe detail；throw 零写；runner emitted late event 不双写。
- runner restart 用 durable session 恢复 rewind；已有 in-memory session 优先；adapter exact delegate/reject；Project Chat snapshot/API JSON 无 checkpoint/request/cwd/session。
- exhaustive contract/channel/preload/handler tests 与所有既有 M0-01–D 安全负例保持绿；Main/TaskHome/React 零改。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-presence.test.mjs electron/project-chat-broker.test.mjs electron/project-chat-ipc.test.mjs electron/project-chat-runtime-services.test.mjs electron/project-chat-contract.test.mjs electron/chat-run.test.mjs electron/desktop-seam.test.mjs
npm run test:electron
git diff --check
```

## 停止并报告

若 owner priority 必须信任 renderer visible/focused，或必须改 Main/window manager 才能单测，立即停止。若 rewind 只能从 renderer 获取 request/checkpoint/cwd/session/model，或 runner emitted event 无法与 direct result 建立单一 durable mutation，停止报告。若需要同时迁移 TaskHome、切 sink/handler/feature flag 或改 React，均属 M0-05F/05，禁止提前实现。

## Close record

- 状态：未执行。
- 完成后必须回报修改文件、合同映射、测试命令/退出码、未验证风险、停止条件。
