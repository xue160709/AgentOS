# CHECK-02｜Revision 2 Development Check

## 目标

独立检查实现是否忠实满足已冻结规格、是否破坏现有 Chat/Runtime，以及是否具备进入正式验收的证据。本单默认只读；发现问题只报告，不顺手扩范围。

## 依赖

- M0、M1、M1a、M2 所有 work order 标记实现完成。
- 用户另行授权正式验收前，只做 Development Check，不把 PRD 状态改为通过。

## Read scope

- 本 change package 全部规格/work orders/evidence。
- 所有上述 work order 实际 diff 与测试。
- `prd/chat-agent-runtime/**`、`prd/local-app-runtime/**`。

## Write allowlist

- `changes/active/chg-20260818-agent-command-channel/evidence.md`
- `changes/active/chg-20260818-agent-command-channel/tasks.md`
- `TODO.md`

只有用户明确要求修复时，才新建精确 fix work order；本检查不得直接改业务代码或正式 Acceptance 通过状态。

## 检查顺序

1. 合同 trace：每个 `ATDD-*` 映射到实现、测试与用户可观察结果。
2. 单 writer：搜索所有 workspace/transcript/run/session 写入路径，证明 renderer 无 full-snapshot 覆盖。
3. 安全负例：sender/frame/project、Preview、deep link、origin、redirect、secret/log、forbidden fields。
4. 竞态：同 thread busy、跨 thread、terminal/sequence/generation、prompt owner、窗口关闭、receipt retry。
5. Runtime：只读、mutation、settle timers、失败矩阵、last-good、manual stop、app quit。
6. 回归：Revision 1 agent channel、现有 Chat、Runtime Revision 5。
7. 真实 Electron smoke：双窗口、draft restart、mac cold/warm link、pair dialog、external focus、Preview capture、静态 build failure。

## 聚合命令

```bash
npm run typecheck
npm run test:electron
npm run build
```

## 结论等级

- `PASS`：无 P0/P1，所有门禁证据齐全。
- `PASS_WITH_RISK`：只有明确非阻断的发布平台/manual smoke 缺口；逐条列出。
- `FAIL`：合同、安全、数据一致性、重复线程、隐式取消或 last-good 任一不满足。

结论必须写入 `evidence.md`，包含 commit/diff 基线、命令、退出码、失败日志摘要与未验证事项。Development Check PASS 仍不等于用户正式 Acceptance。
