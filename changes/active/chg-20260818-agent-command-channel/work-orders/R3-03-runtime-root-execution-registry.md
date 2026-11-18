# R3-03｜Definition 隔离与 RuntimeRootExecutionRegistry

> 状态：待 R3-02。对应 `technical.md T3.8 / T3.11.3`。本单不实现开发窗口或自动保存。

## 任务目标与原因

移除 `LocalAppRuntimeManager` 以 canonical root + mode 把多个 Definition 映射为同一 owner/snapshot/consumer 的别名行为。Definition 始终独立；canonical root 只交给新的 Main-owned execution registry 做互斥开发/build 租约。

## 当前 change_id@revision 与合同

- `chg-20260818-agent-command-channel@3`
- 必读：`technical.md T3.2、T3.8–T3.12`，`acceptance.md ATDD-RDS-301/305`，`prd/local-app-runtime/acceptance.md C-021/C-026/C-027`。
- 依赖：R3-02 完成；不得改 Broker/Thread/UI。

## 必须保留 / 允许改变 / 禁止推断

- 保留每个 Definition 自己的 supervisor、artifact、event、consumer；静态 last-good Preview 不占租约。
- 允许新增 `development|build` lease、同 definition 原子 transition、stopping/release 与冲突结果。
- 禁止 alias/attach/kill/stop 另一 Definition；禁止用 path 作为产品 identity；禁止自动切换界面。
- Workspace development-only 在 Tab consumer 存在时可继续占 development lease；具体会话策略留 R3-04。

## 派发字段

- `write_mode=writer`
- `deadline=manager 隔离与 registry 单测完成后停止；不得接 UI`
- `attempt=1`
- `instance_id=UNASSIGNED`
- `diff_baseline=UNASSIGNED`
- `exact_write_allowlist`：仅下节路径；派发前必须绑定 writer/baseline。

## Exact write allowlist

- `src/runtime-development-contract.ts`
- `src/components/types.ts`
- `electron/runtime-root-execution-registry.ts`（新增）
- `electron/runtime-root-execution-registry.test.mjs`（新增）
- `electron/local-app-runtime/index.ts`
- `electron/local-app-runtime/static.ts`
- `electron/local-app-runtime.test.mjs`
- `electron/static-runtime.test.mjs`

禁止写 `electron/main.ts`、preload、React、broker/coordinator/window、workspace store。

## 实施与 V3 风险面

1. 正常路径：Definition snapshot/consumer/artifact 独立；同 scope/definition acquire 幂等；development→build 原子 transition。
2. 失败/超时/取消/late event：冲突不产生 process side effect；stop/transition 失败保留 last-good 并进入明确状态；旧 generation release 不释放新 lease。
3. 状态/恢复：同 root 不同 Definition 都可静态查看；只有实时开发/build 冲突；manager restart 不从路径猜 owner。
4. 资源回收：最后 consumer、remove/relocate/trust revoke/app quit 需要的 stopping seam 可测；有界 process-tree stop 后才释放。
5. 回滚/完整性：移除 alias 后不得移动/覆盖现有 artifact；flag 回滚不删除 Definition 或 last-good。

## 必测断言与最小验证

- 同 root 两个 Definition 的 snapshot、generation、consumer、event、artifact 全隔离。
- 同 scope acquire 幂等；另一 Definition conflict；显式 focus token 不在本单且不能转移 lease。
- development→build 只对同 Definition；transition/stop failure 不发布错误 last-good。
- static-only/uninitialized development lease 也互斥；静态 Preview 不互斥。
- development-only 最后 consumer release；stale generation/duplicate release 幂等。

```bash
npm run typecheck
node --test electron/runtime-root-execution-registry.test.mjs electron/local-app-runtime.test.mjs electron/static-runtime.test.mjs
git diff --check
```

## 完成信号与停止条件

最终回报 Definition 隔离证据、lease transition 矩阵、测试/退出码和未验证 process 风险。若 manager 无法在不复制 supervisor/build 状态机的前提下隔离 Definition，或必须复用 `ownerByDedupeKey` 才能保持现有行为，停止并修订规格。
