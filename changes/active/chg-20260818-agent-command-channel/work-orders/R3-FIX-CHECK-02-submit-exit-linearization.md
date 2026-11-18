# R3-FIX-CHECK-02｜Runtime submit / exit 线性化

> 来源：首次 `R3-CHECK` 的 P1 finding。仅封闭 Runner accepted 前的 submit/exit 窗口，不改变普通 Project Chat 或用户文案。

## 问题与目标

Runtime submit 在持久化用户消息后等待 `runner.submit()`；coordinator 只有在 Core 收到 requestId 后才登记 active Run。此时 close/end 可先进入 settle/save，迟到 accepted 又被 coordinator 拒绝但返回值被忽略，形成无 coordinator 保护的 writer，违反 ATDD-RDS-304/305、C-025/026 与 ATDD-RUNTIME-DEV-303。

修复必须让 potential/submitting Run 与 exit 形成单一线性顺序：Runner accepted 前 coordinator 已知道存在潜在 writer，或 submit acceptance 与 exit 共用同一事务。submit rejection 必须回滚 pending 状态；`registerAcceptedRun` 失败不得被忽略，也不得让 Run 在无 coordinator route 时继续写。

## 派发与 allowlist

- `write_mode=writer`，`attempt=1`；instance/baseline 在派发消息绑定。
- 仅允许修改：
  - `electron/chat-broker-core.ts`
  - `electron/runtime-chat-broker.ts`
  - `electron/runtime-development-coordinator.ts`
  - `electron/runtime-chat-broker.test.mjs`
  - `electron/runtime-development-coordinator.test.mjs`

## 必测

- delayed runner：submit → close/end → accepted → mutation → terminal；accepted 前不得 settle/save，终态后只收口一次。
- submit rejection：清理 potential/submitting，不挂住 session，不自动保存失败半成品。
- close/end 与 accepted 同 tick 两种顺序；register 失败必须显式 cancel/拒绝，不产生孤儿 writer。
- prompt、double exit、reenter during save、late event、普通 Project facade 回归不变。

```bash
npm run typecheck
node --test electron/runtime-chat-broker.test.mjs electron/runtime-development-coordinator.test.mjs
git diff --check
```

若需要取消已有 active Run、改变普通 Project Chat submit 语义、放宽 generation fence 或把状态放回 renderer，立即停止报告。
