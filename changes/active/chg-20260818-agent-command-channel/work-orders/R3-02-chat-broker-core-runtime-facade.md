# R3-02｜ChatBrokerCore 与 Runtime Facade/Capability

> 状态：待 R3-01。对应 `technical.md T3.4–T3.5 / T3.11.2`。本单只建立 Main 侧可测试能力，不接用户入口。

## 任务目标与原因

把现有 `ProjectChatBroker` 的通用单 writer、Runner、event route、prompt 与 reducer 能力抽成唯一 `ChatBrokerCore`，在 Project facade 全量回归后新增 Runtime facade、scope capability 与 scoped read。它必须是同一聊天引擎的第二种作用域，不是第二套 Chatbot。

## 当前 change_id@revision

- `chg-20260818-agent-command-channel@3`
- 依赖：R3-01 完成且其 store/contract tests 通过。
- 必读：`technical.md T3.2–T3.5、T3.9–T3.12`，`acceptance.md ATDD-RDS-302/306/307`。

## 已确认事实与精确来源

- request route 在 runner accepted 前冻结 `{scopeKind, scopeId, threadId, routeGeneration, developmentGeneration}`。
- Project API 不能看到/修改 Runtime Thread；Runtime API 不能跨 capability scope。
- Project Runtime cwd 为项目根但写入目标限 `.agentos`；Workspace Runtime cwd/root 均为 Runtime root。
- Preview、subframe、错误窗口、跨 scope threadId、renderer 自报 root/generation 全部拒绝。
- Bash 仍受现有 app-global 权限；不能宣称 OS sandbox。可靠文件 mutation 才能进入保存统计。

## 派发字段

- `write_mode=writer`
- `deadline=Project facade 回归与 Runtime facade 负例通过后停止；不得注册 UI 入口`
- `attempt=1`
- `instance_id=UNASSIGNED`（派发前绑定）
- `diff_baseline=UNASSIGNED`（派发时冻结）
- `exact_write_allowlist`：仅下节路径。

## Exact write allowlist

- `src/runtime-development-contract.ts`
- `src/project-chat-contract.ts`
- `electron/chat-broker-core.ts`（新增）
- `electron/runtime-chat-broker.ts`（新增）
- `electron/runtime-chat-ipc.ts`（新增，仅 router/capability seam，不在 `main.ts` 注册）
- `electron/project-chat-broker.ts`
- `electron/project-chat-ipc.ts`
- `electron/project-chat-runtime-services.ts`
- `electron/claude-agent-runner.ts`
- `electron/project-chat-broker.test.mjs`
- `electron/project-chat-ipc.test.mjs`
- `electron/project-chat-runtime-services.test.mjs`
- `electron/runtime-chat-broker.test.mjs`（新增）
- `electron/runtime-chat-ipc.test.mjs`（新增）

只读依赖 R3-01 store；若必须修改其实现，停工回到新 attempt。禁止写 `electron/main.ts`、`electron/preload.ts`、React、Runtime manager/coordinator/window。

## 实施与 V3 风险面

1. 正常路径：先以共享 core 重建 Project facade 并保持 DTO/行为不变，再接 Runtime create/select/submit/fork/edit/cancel/answer/diff/model/attachment。
2. 失败/取消/late event：unknown request 丢弃并脱敏记录；terminal 后 late non-terminal 不回滚；close 与 window presence 尚不在本单。
3. 状态/恢复：Runtime snapshot 只读 R3-01 collection；Definition 已移除时只读可用、submit 失败。
4. 资源回收：facade dispose 解除 event/prompt 注册，不 dispose 共享 Runner 或另一 facade。
5. 回滚/完整性：Runtime facade flag 关闭不删除 Runtime Thread；Project facade 行为和持久化字节保持兼容。

## 必测断言与最小验证

- 现有 Project broker/ipc/scoped service 测试全部通过。
- 同 Runner、同 reducer、同串行 writer；源码审计不得出现第二个 runner/reducer/store writer。
- capability 覆盖 scope：scope spoof、wrong window、subframe、Preview、跨 Runtime threadId 拒绝。
- request route 的 route/development generation 在 accepted 前固定；事件写且只写一个 Thread。
- Runtime root containment 负例；错误/日志不泄露 root、命令、credential。

```bash
npm run typecheck
node --test electron/project-chat-broker.test.mjs electron/project-chat-ipc.test.mjs electron/project-chat-runtime-services.test.mjs electron/runtime-chat-broker.test.mjs electron/runtime-chat-ipc.test.mjs
git diff --check
```

## 交付格式、完成与停止

最终回报 changed files、Project regression 数量、capability 负例、合同映射与风险。若抽 core 必须改变现有 Project facade 公开语义、复制 broker 状态，或 scope 无法在 Main 权威解析，立即停止；不得用 query/root fallback。
