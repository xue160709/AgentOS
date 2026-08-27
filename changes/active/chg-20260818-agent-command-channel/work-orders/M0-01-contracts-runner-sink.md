# M0-01｜共享合同、Reducer 与 Runner Event Sink

## 目标

建立 Main broker 可用的类型与纯事件折叠 seam，把 `ClaudeAgentRunner` 从固定 `WebContents` 解耦；本单不创建 broker、不改 UI、不改提交语义。

## 依赖

- 无代码依赖；先读 `technical.md §1–4`、`§5.4` 的 Prompt DTO、`§7.1` 的 view-state DTO、`§9` 的 public Binding DTO，以及 `§5.3` 中的 Runner event-sink 接口和 sink failure 条款。`§5.3` 的 requestId ownership/mapping 属于 M0-02，本单只理解合同、不实现。
- 基线测试：`electron/chat-run.test.mjs`、`electron/claude-sdk-message-router.test.mjs`。

## Write allowlist

- `src/project-chat-contract.ts`（新增）
- `src/project-chat-reducer.ts`（新增）
- `src/components/chat/chat-run.ts`
- `src/claude-chat-types.ts`
- `electron/claude-agent-runner.ts`
- `electron/claude-chat-web-contents-sink.ts`（新增，迁移期 adapter）
- `electron/main.ts`（只允许替换 runner sink 构造，不改 IPC）
- `electron/chat-run.test.mjs`
- `electron/claude-sdk-message-router.test.mjs`
- `electron/project-chat-contract.test.mjs`（新增）

禁止写：`electron/preload.ts`、任何 React TSX、workspace store、Runtime；`electron/main.ts` 除 runner 构造行外禁止改动。

## 实施步骤

1. 按 `technical.md §4/§5.4/§7.1/§9` 定义精确合同与 `ProjectChatError` helper；无 `any`。尤其不得用完整 `ClaudeChatEvent` 替代 `ProjectChatPromptPayload`，不得省略 prompt/thread/view-state/Binding 冻结字段。
2. 从现有 `chat-run.ts` 提取与 React 无关的事件折叠逻辑到 `project-chat-reducer.ts`；`chat-run.ts` 不得保留第二份 fold/helper 实现。若为兼容测试保留旧 export，它必须是调用 `project-chat-reducer` 的薄函数。
3. 为 runner 定义并注入 `ClaudeChatEventSink.publish(event)`；移除 runner core 对具体 `WebContents.send` 的依赖。
4. 在独立 adapter 中把现有主窗口 `WebContents` 转成 sink，并只修改 `main.ts` 的 runner 构造；本单不得改 IPC 或 submit/cancel/newThread 语义。
5. 为下列边界写测试：
   - pure reducer 在调用方已经解析到目标 run/thread 的前提下保持现有 transcript fold，并阻止 terminal 被迟到非 terminal event 覆盖；
   - runner 把每个 SDK 标准事件发布给 sink 一次；
   - sink `publish` throw 只被脱敏记录，不向 SDK run 反向抛出、不取消 run。
6. 本单不得建立 `requestId -> project/thread` registry，也不得判断“未知 requestId”；这两项明确留给 M0-02 broker。
7. 对共享 DTO 增加 compile-time `satisfies` fixture 或等价类型断言，至少覆盖 Prompt、cancel/answer、window view state/save patch 和 WebsiteBindingPublic，防止仅测试 error helper。

## 完成条件

- 旧测试全部通过；新 pure contract/reducer test 通过。
- Runner 代码不 import `WebContents`，或仅临时 adapter 文件 import；核心 runner 构造函数只接收 sink。
- `src/components/chat/chat-run.ts` 不保留 reducer/helper 副本；新 reducer 是唯一 fold 实现。
- `ProjectChatPromptSnapshot`、cancel/answer、view state/save patch、WebsiteBindingPublic 与技术规格逐字段一致。
- 没有 request ownership registry、unknown-request 过滤或 project/thread routing 的提前实现。
- 没有 UI/持久化行为变化。

## 命令

```bash
npm run typecheck
node --test electron/chat-run.test.mjs electron/claude-sdk-message-router.test.mjs electron/project-chat-contract.test.mjs
```

## 停止并报告

若 SDK before/post tool 事件类型不足以支持 reducer，不在本单发明 mutation 事件；记录缺口交给 M2-01。
