# M2-02｜Runtime Intent、状态 UI 与 Last-good 收口

## 目标

把 coordinator intents 接到现有 Runtime Revision 5，并在两个 Runtime Host 与 Chat 显示冻结状态；不改变现有 Runtime 普通外部编辑规则。

## 依赖

- `M2-01` 完成。
- 现有 Runtime Revision 5 tests 必须先绿。

## Write allowlist

- `electron/runtime-edit-coordinator.ts`
- `electron/local-app-runtime/index.ts`
- `electron/local-app-runtime/static.ts`
- `electron/local-app-runtime/preview.ts`（仅 consumer/session 集成）
- `electron/main.ts`
- `electron/local-app-runtime.test.mjs`
- `electron/static-runtime.test.mjs`
- `electron/runtime-event-state.test.mjs`
- `electron/runtime-edit-integration.test.mjs`（新增）
- `src/components/runtime-event-state.ts`
- `src/components/RuntimePreview.tsx`
- `src/components/RuntimeWorkspace.tsx`
- `src/components/chat/ProjectHomeRuntimeView.tsx`
- `src/components/chat/ProjectChatWindowPage.tsx`（仅紧凑状态/查看预览入口）
- 与上述状态组件直接对应的 CSS/i18n 文件（回报具体路径）

注意：`src/components/RuntimePreview.tsx` 当前可能有用户未提交改动；开始前必须读 diff 并在其上最小修改，不能覆盖。

禁止写：protocol/binding、runner reducer、workspace schema。

## 实施步骤

1. 映射 coordinator lease 到现有共享 RuntimeInstance consumer；两个 host 各自 PreviewSession。
2. 静态+dev：编辑期临时 dev；最新 generation settle 后固定 build 一次、原子切 last-good、再停无 consumer dev。
3. development-only 不 build；static-only 无 dev 显示实时不可用但 settle build；无声明不猜命令。
4. build 失败保留 last-good；Agent run 仍成功，Runtime 独立失败状态。
5. failed/cancelled after mutation 不 auto build，显示固定未完成修改文案与继续/撤销/手动更新入口。
6. 两 Runtime Host 消费同一 Main snapshot；隐藏/关闭不抢焦点、不自动停仍被 lease 使用的 Runtime。
7. manual stop fence 覆盖 watcher/health/late events；app quit 有界清理 timer/watcher/process。
8. 保持 Revision 5“普通外部源码变化 stale + 手动更新”不变。

## 命令

```bash
npm run typecheck
node --test electron/runtime-edit-coordinator.test.mjs electron/runtime-edit-integration.test.mjs electron/local-app-runtime.test.mjs electron/static-runtime.test.mjs electron/runtime-event-state.test.mjs
npm run test:electron
```

## 停止并报告

如果现有 Runtime 没有固定 build intent 或原子 last-good API，先补最小 seam 设计并修订 allowlist；不得在 coordinator 复制 build 状态机。
