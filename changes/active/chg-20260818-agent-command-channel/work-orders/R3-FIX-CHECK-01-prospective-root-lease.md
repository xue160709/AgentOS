# R3-FIX-CHECK-01｜未初始化 Project prospective-root lease

> 来源：首次 `R3-CHECK` 的 P0 finding。仅修复 Project `.agentos` 尚不存在时的同根互斥，不新增产品能力，不签正式验收。

## 问题与目标

未初始化 Project 当前在没有 Runtime Definition 时直接把开发会话置为 ready；bridge 不取得 root lease。与此同时 Workspace Runtime 可在同一 prospective root 上取得 lease，导致两个 Agent 并行写同一路径，违反 `technical.md:204`、ATDD-RDS-301、C-021 与 ATDD-RUNTIME-DEV-301。

修复必须在 controlled creation prompt/任何 Runtime Run 可提交前，以父目录 realpath + `.agentos` 形成 canonical prospective root 并原子取得 Project scope development lease。关闭、创建失败、route invalidation、quit 必须释放；Definition 出现后必须重新 canonicalize 并安全绑定/转换，不得出现无锁窗口或删除用户数据。

## 派发与 allowlist

- `write_mode=writer`，`attempt=1`；instance/baseline 在派发消息绑定。
- 仅允许修改：
  - `src/runtime-development-contract.ts`
  - `electron/main.ts`
  - `electron/runtime-development-runtime-bridge.ts`
  - `electron/runtime-root-execution-registry.ts`
  - `electron/runtime-development-runtime-bridge.test.mjs`
  - `electron/runtime-root-execution-registry.test.mjs`
  - `electron/runtime-development-window-manager.test.mjs`
  - `electron/project-chat-renderer.test.mjs`

## 必测

- Project-first / Workspace-first 同 prospective root，第二个请求 conflict 且不 spawn。
- symlink parent canonicalization，不能用路径别名绕过。
- controlled creation submit 之前已持 lease；关闭、创建失败、旧 route、quit 幂等释放。
- Definition 出现后无锁窗口地绑定真实 canonical root；旧 lease/token 不能释放新 owner。
- 已初始化 Project、Workspace、static/development-only 与 last-good 回归不变。

```bash
npm run typecheck
node --test electron/runtime-development-runtime-bridge.test.mjs electron/runtime-root-execution-registry.test.mjs electron/runtime-development-window-manager.test.mjs electron/project-chat-renderer.test.mjs
git diff --check
```

若必须以 renderer 传 root、先运行 creation prompt 再加锁、静默迁移另一 active scope 或删除 Runtime 数据，立即停止报告。
