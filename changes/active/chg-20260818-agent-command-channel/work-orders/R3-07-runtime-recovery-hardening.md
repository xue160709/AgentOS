# R3-07｜恢复、退出、迁移回滚与可访问性 Hardening

> 状态：待 R3-06。对应 Revision 3 P1：`ATDD-RDS-307–309` 与 `technical.md T3.8–T3.12`。本单不增加产品能力，只封闭破坏性边界。

## 任务目标与原因

在 P0 cutover 稳定后，补齐 app quit、remove/relocate/trust revoke、pending prompt、development-only consumer、late event、旧数据回滚与焦点/可访问性。目标是让中断和恢复不覆盖 last-good、不泄露资源、不把未知半成品说成保存成功。

## 当前 change_id@revision 与来源

- `chg-20260818-agent-command-channel@3`
- 必读：`technical.md T3.3、T3.6–T3.12`，`acceptance.md ATDD-RDS-307–309`，两个正式 PRD 的 Revision 3 acceptance。
- 依赖：R3-01–R3-06 完成并形成稳定 diff；本单后才可进入 R3-CHECK。

## 派发字段

- `write_mode=writer`
- `deadline=P1 自动化、全量 Electron test 与 build 完成后停止；不得签发正式验收`
- `attempt=1`
- `instance_id=UNASSIGNED`
- `diff_baseline=UNASSIGNED`
- `exact_write_allowlist`：仅下节路径；派发前绑定。

## Exact write allowlist

- `src/runtime-development-contract.ts`
- `src/components/AppShell.tsx`
- `src/components/AppShellWorkspace.tsx`
- `src/components/RuntimeWorkspace.tsx`
- `src/components/chat/ProjectHomeRuntimeView.tsx`
- `src/components/chat/RuntimeDevelopmentWindowPage.tsx`
- `src/components/AppSearchModal.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `electron/main.ts`
- `electron/chat-workspace-store.ts`
- `electron/runtime-development-thread-store.ts`
- `electron/runtime-chat-broker.ts`
- `electron/runtime-development-coordinator.ts`
- `electron/runtime-development-runtime-bridge.ts`
- `electron/runtime-development-window-manager.ts`
- `electron/runtime-development-view-state-store.ts`
- `electron/runtime-root-execution-registry.ts`
- `electron/local-app-runtime/index.ts`
- `electron/chat-workspace-store.test.mjs`
- `electron/runtime-development-thread-store.test.mjs`
- `electron/runtime-chat-broker.test.mjs`
- `electron/runtime-development-coordinator.test.mjs`
- `electron/runtime-development-runtime-bridge.test.mjs`
- `electron/runtime-development-window-manager.test.mjs`
- `electron/runtime-development-view-state-store.test.mjs`
- `electron/runtime-root-execution-registry.test.mjs`
- `electron/local-app-runtime.test.mjs`
- `electron/project-chat-renderer.test.mjs`

禁止改产品规格、网站协议、普通 Project Chat 行为；共享文件仍串行单 writer。

## V3 五面与必测断言

1. 正常：关闭重开恢复 Thread/draft；Runtime 搜索可达；development-only 结束 Chat 但 Tab consumer 可继续查看。
2. 失败/超时/取消/late：app quit 不启动 save；旧 build/result/prompt/close callback 全被四元 fence 拒绝；build fail 保留 last-good；自动路径不重试。
3. 状态/恢复：pending prompt 主窗口可见并可重开；restart 后 session 不伪恢复，源码 fingerprint stale 可见；Definition removed 为只读。
4. 资源回收：remove/relocate/trust revoke/app quit 先 stopping、有界结束 process tree 再 release；active Run/session 返回 busy；last consumer release lease。
5. 回滚/完整性：flag rollback 不删新表/sidecar/view state/last-good；旧 synthetic 数据不删不重分类；普通 workspace 保存不覆盖 Runtime collection。

另测：focus 只转移一次、键盘可达、role/status/alert 与 `aria-busy` 正确、不可提交时 composer disabled 与 Main 拒绝一致、错误文案不含 root/port/command/stack。

## 最小验证

```bash
npm run typecheck
node --test electron/runtime-development-thread-store.test.mjs electron/runtime-chat-broker.test.mjs electron/runtime-development-coordinator.test.mjs electron/runtime-development-runtime-bridge.test.mjs electron/runtime-development-window-manager.test.mjs electron/runtime-development-view-state-store.test.mjs electron/runtime-root-execution-registry.test.mjs electron/local-app-runtime.test.mjs electron/project-chat-renderer.test.mjs
npm run test:electron
npm run build
git diff --check
```

## 交付格式与停止条件

最终回报每个风险面的证据、全量命令/退出码、未做的真实 Electron smoke 与环境限制。若 app quit 只能通过自动 build 保数据、remove/relocate 需要偷偷迁移 active scope、或 rollback 需要删除/转写 Runtime Thread，立即停止并报告。
