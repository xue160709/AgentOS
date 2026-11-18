# M0-05｜主窗口 Renderer Snapshot Cutover

## 目标

先让主窗口 Chat 成为 broker snapshot 投影，关闭 renderer durable full-snapshot writer；本单不接完整独立窗口，也不迁移应用内 command channel。

## 依赖

- `M0-05F` default-off production composition 完成；此前本任务单禁止直接派发。
- M0 前四单测试全绿。

## Write allowlist

- `src/components/chat/ChatPage.tsx`
- `src/components/AppShell.tsx`
- `src/components/AppShellWorkspace.tsx`
- `src/components/workspace-session.ts`
- `src/project-chat-contract.ts`
- `src/chat-workspace-persistence.ts`
- `src/components/types.ts`
- 对应 Chat/AppShell CSS 与测试文件（回报具体路径）
- `electron/workspace-session.test.mjs`
- `electron/project-chat-renderer.test.mjs`（新增）

禁止写：broker/runner/Main/preload、binding/deep link、Runtime。

## 实施步骤

1. 让主窗口 Chat 消费 `getSnapshot/onEvent`，并把 sequence/generation/revision 保存在 controller seam，而不是散落在组件 effect。
2. renderer 只保留主窗口 selected thread/draft view state；transcript/run/session/diff 不经 renderer full workspace save。
3. sequence gap 重新 fetch snapshot；旧 sequence/generation 丢弃。
4. 同 thread active 禁用提交并展示固定文案；不得通过新 submit 触发 cancel。
5. 主窗口启动时把合法 legacy permission localStorage 值通过 `initializePermissionMode` 迁入一次，成功后删除旧 key；之后 permission 只调用 Main API。
6. pending prompt 根据 owner 渲染可操作/只读状态。
7. 删除或封闭 renderer durable full workspace writer；保留只读/一次性迁移 seam 时明确注释并测试不可被普通 UI 调用。

## 必测断言

- Main snapshot 到达时 transcript 不重复，旧 sequence/generation 被丢弃。
- 主窗口 draft 不被 snapshot 覆盖。
- 同 thread busy、prompt owner、permission sync 的 UI 状态正确。
- renderer full workspace writer 不再可从普通 Chat 提交路径到达。

## 命令

```bash
npm run typecheck
node --test electron/workspace-session.test.mjs electron/project-chat-renderer.test.mjs electron/project-chat-broker.test.mjs
npm run test:electron
```

## 停止并报告

若必须大规模重写 Chat 视觉组件，先拆任务；本单只允许状态归属与组合方式改造，不做视觉 redesign。
