# M1A-01｜Preview 窄 Deep-link 捕获

## 目标

允许 AgentOS 内嵌项目页面点击合法 `agentos://v1/pair|task`，由 Main 统一处理，同时证明 Preview 仍无 preload/Node/Chat IPC。

## 依赖

- `M1-02` 完成。
- 精读 `technical.md §6`、`protocol-v1.md §2`。

## Write allowlist

- `electron/local-app-runtime/preview.ts`
- `electron/local-app-preview.test.mjs`
- `electron/agentos-deep-link.ts`
- `electron/main.ts`
- `electron/project-chat-ipc.test.mjs`
- `electron/agentos-preview-capture.test.mjs`（新增）

禁止写：preload、renderer Chat/UI、binding/protocol schema、Runtime state machine。

## 实施步骤

1. 在 Preview navigation/window-open seam 只捕获 scheme=`agentos`，交给同一个 parser/queue；其它协议沿用现有规则。
2. 捕获前后保留 PreviewSession/runtime generation 验证；已销毁/旧 generation navigation 无副作用。
3. 不向 Preview 注入 preload、contextBridge、credential 或 IPC token。
4. 测合法 pair/task 被一次处理，非法/超长/未知 action 被阻止且不导航外部目标。
5. 安全测试明确 Preview sender 调 `project-chat:*` 全部拒绝。

## 命令

```bash
npm run typecheck
node --test electron/local-app-preview.test.mjs electron/agentos-preview-capture.test.mjs electron/project-chat-ipc.test.mjs
```

## 停止并报告

如果捕获需要给 Preview preload，立即停工；该设计不被允许。
