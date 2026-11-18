# R3-05｜Runtime 开发窗口、View State、Presence 与 IPC

> 状态：待 R3-04。对应 `technical.md T3.4–T3.6、T3.9–T3.10 / T3.11.5` 的窗口半段。本单建立完整窗口通道，但不替换项目首页/工作台入口。

## 任务目标与原因

新增以 `RuntimeScopeId` 为 key 的专用窗口 manager、独立 view-state、窄 preload capability 和 prompt presence。native close 必须在销毁前同步登记同一个 exit intent；运行中 Run 继续在 Main 写 Transcript，不因 renderer 消失而取消。

## 当前 change_id@revision 与来源

- `chg-20260818-agent-command-channel@3`
- 必读：`technical.md T3.4–T3.6、T3.9–T3.12`，`acceptance.md ATDD-RDS-302/304/307/308`，`prd/chat-agent-runtime/acceptance.md ATDD-RUNTIME-DEV-301–304`。
- 依赖：R3-01–R3-04 完成。

## 冻结行为与安全边界

- 一个 scope 最多一个 Runtime window；重复 open 只 show/focus。
- `--agentos-window-kind=runtime-development`；preload 只暴露 Runtime Chat API，不暴露 `window.desktop`、Project API 或任意路径 API。
- query 只用于显示；Main capability 才是 scope 权威。
- close：同步 `requestExit` → flush view state → destroy；不得 await build、不得 cancel Run；closed/destroyed 不生成第二 exit。
- view state 独立保存 scope/thread/draft/bounds；selected Thread 必须同 scope。
- prompt owner 仅当前 scope visible window；关闭后无 owner，重开只转移一次。

## 派发字段

- `write_mode=writer`
- `deadline=窗口/IPC/component seam 与目标测试通过后停止；不得改主窗口 Runtime 入口`
- `attempt=1`
- `instance_id=UNASSIGNED`
- `diff_baseline=UNASSIGNED`
- `exact_write_allowlist`：仅下节路径；派发前绑定。

## Exact write allowlist

- `src/runtime-development-contract.ts`
- `src/desktop-api.ts`
- `src/desktop-seam.ts`
- `src/main.tsx`
- `src/components/chat/RuntimeDevelopmentWindowPage.tsx`（新增）
- `src/components/chat/runtime-development-window.css`（新增）
- `electron/runtime-development-window-manager.ts`（新增）
- `electron/runtime-development-window-manager.test.mjs`（新增）
- `electron/runtime-development-view-state-store.ts`（新增）
- `electron/runtime-development-view-state-store.test.mjs`（新增）
- `electron/runtime-chat-ipc.ts`
- `electron/runtime-chat-ipc.test.mjs`
- `electron/project-chat-presence.ts`
- `electron/project-chat-presence.test.mjs`
- `electron/project-chat-composition.ts`
- `electron/project-chat-composition.test.mjs`
- `electron/preload.ts`
- `electron/main.ts`
- `electron/desktop-seam.test.mjs`
- `electron/project-chat-renderer.test.mjs`

禁止写 `AppShell.tsx`、ProjectHome/RuntimeWorkspace/AppSearch、workspace-tab-project、Runtime manager/store/coordinator 核心（只经已冻结 API 调用）。

## 实施与 V3 风险面

1. 正常路径：open/focus、create/select/submit 等 Runtime API、draft/bounds 恢复、标题含 Runtime 名称与归属。
2. 失败/超时/取消/late event：load failure 释放刚取得 consumer/capability；close 不取消；旧 window/generation/prompt answer 拒绝。
3. 状态/恢复：saving/needs_attention reenter；Definition removed 时只读；空 Thread 与无权限/未配置/过期 capability 有明确状态。
4. 资源回收：hide/destroy 注销 presence/capability/window 引用；view-state flush 有界且不重复 requestExit。
5. 回滚/完整性：flag 关闭不删除 Thread/view state；旧 Project window 行为不变。

## 必测断言与最小验证

- same-scope double open、跨 scope 独立窗口、wrong sender/subframe/Preview/query spoof 拒绝。
- close 顺序与幂等、active Run 不 cancel、load failure cleanup、reenter during saving。
- draft/bounds/selected thread round-trip 和跨 scope selected thread 拒绝。
- prompt owner close/reopen 一次转移；迟到 answer 拒绝。
- preload capability source audit：Runtime window 无 desktop/Project bridge。

```bash
npm run typecheck
node --test electron/runtime-development-window-manager.test.mjs electron/runtime-development-view-state-store.test.mjs electron/runtime-chat-ipc.test.mjs electron/project-chat-presence.test.mjs electron/project-chat-composition.test.mjs electron/project-chat-renderer.test.mjs electron/desktop-seam.test.mjs
git diff --check
```

## 完成与停止

最终回报窗口生命周期顺序、capability 负例、持久恢复与测试证据。若必须复用 Project window 的 projectId capability、在 renderer 传 root、或 close 只能异步等待 build，立即停止；不得用兼容 fallback。
