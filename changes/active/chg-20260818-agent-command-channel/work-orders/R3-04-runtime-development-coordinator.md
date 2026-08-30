# R3-04｜RuntimeDevelopmentCoordinator 与原子保存 Bridge

> 状态：待 R3-03。对应 `technical.md T3.7、T3.9–T3.10 / T3.11.4`。本单只做纯状态机与 Main bridge，不接窗口/UI。

## 任务目标与原因

实现显式、窗口级 `RuntimeDevelopmentSession`：多轮 Run 在用户结束前保持 live，只有收到 exit intent 且所有安全门满足后才最多自动保存一次。Runtime-scoped Run 只登记新 coordinator；旧 `RuntimeEditCoordinator` 继续服务普通项目/网站/后台 Run，禁止双登记。

## 当前 change_id@revision 与来源

- `chg-20260818-agent-command-channel@3`
- 必读：`technical.md T3.7–T3.12`，`acceptance.md ATDD-RDS-303–305/308/309`，`prd/local-app-runtime/acceptance.md C-024–C-027`。
- 依赖：R3-01–R3-03 完成。

## 冻结行为

- `open→live→exit_requested→saving→closed`；waiting prompt、mutation failure/timeout 为 `needs_attention`；build failure 为 `preview_update_failed`。
- 窗口仍开时不 settle/build；close 不 cancel Run；双 exit 幂等且禁止新 submit。
- gate：exitRequested、无 active Run/agent lease/prompt、无 failed-mutation、fingerprint 稳定 1500ms/总等待 30s。
- 每 developmentGeneration 自动尝试最多一次；commit 前核验 scope + routeGeneration + developmentGeneration + operationId。
- reenter 提升 generation；旧 callback 不能发布 artifact、切 Preview、关闭新会话或释放新 lease。

## 派发字段

- `write_mode=writer`
- `deadline=纯状态机和 bridge 集成测试通过后停止；不得写 BrowserWindow/React`
- `attempt=1`
- `instance_id=UNASSIGNED`
- `diff_baseline=UNASSIGNED`
- `exact_write_allowlist`：仅下节路径；派发前绑定。

## Exact write allowlist

- `src/runtime-development-contract.ts`
- `electron/runtime-development-coordinator.ts`（新增）
- `electron/runtime-development-runtime-bridge.ts`（新增）
- `electron/runtime-development-coordinator.test.mjs`（新增）
- `electron/runtime-development-runtime-bridge.test.mjs`（新增）
- `electron/runtime-edit-coordinator.ts`
- `electron/runtime-edit-coordinator.test.mjs`
- `electron/chat-broker-core.ts`
- `electron/runtime-chat-broker.ts`
- `electron/runtime-chat-broker.test.mjs`
- `electron/claude-agent-runner.ts`
- `electron/local-app-runtime/index.ts`
- `electron/local-app-runtime/static.ts`
- `electron/local-app-runtime.test.mjs`
- `electron/static-runtime.test.mjs`
- `electron/runtime-root-execution-registry.ts`
- `electron/runtime-edit-integration.test.mjs`

禁止写 `electron/main.ts`、preload、窗口 manager/view store、React/i18n、workspace-tab-project。

## 实施与 V3 风险面

1. 正常路径：open/ready、连续多轮、exit、稳定、无修改关闭或一次 build+atomic last-good。
2. 失败/超时/取消/late event：failed-with/without-mutation 分流、prompt gate、timeout、build fail、manual retry、新 generation late result。
3. 状态/恢复：reenter 清旧 exit 与未提交 save；project/root relocation 提升 routeGeneration 并进入 needs_attention；session 不跨 app restart。
4. 资源回收：closed 清临时计数/Chat lease；root lease 依据 capability/consumer 释放；重复 terminal/exit/release 幂等。
5. 回滚/完整性：失败保留源码/Diff/Thread/last-good；app quit fence 不启动 settle/build；旧结果不得 commit。

## 必测断言与最小验证

- 完整 transition matrix：多轮不 build、active Run close、waiting prompt close/reenter、double exit、save 中 reenter。
- mutation failure/取消阻止自动保存；无 mutation failure 不阻止其它成功修改。
- 无修改不 build；每 generation 最多一次；30s timeout；显式重新保存创建新 attempt。
- Runtime Run 不进入旧 coordinator；普通 Project Run 行为不变。
- generation-fenced artifact commit 与 build fail/abort last-good。

```bash
npm run typecheck
node --test electron/runtime-development-coordinator.test.mjs electron/runtime-development-runtime-bridge.test.mjs electron/runtime-edit-coordinator.test.mjs electron/runtime-edit-integration.test.mjs electron/runtime-chat-broker.test.mjs electron/local-app-runtime.test.mjs electron/static-runtime.test.mjs
git diff --check
```

## 交付与停止

最终回报 transition 覆盖、fake-clock 证据、atomic commit fence、合同映射与风险。若固定 build declaration/atomic last-good API 不足，先停止并提出最小 seam 修订；不得复制 Runtime build 状态机、解析 Bash 文本或放宽 failed-mutation gate。
