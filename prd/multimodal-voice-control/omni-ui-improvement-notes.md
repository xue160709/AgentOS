# omni-ui 改进建议与 AgentOS 影响评估

> 记录日期：2026-07-05  
> 背景：AgentOS 已基于 `@xue160709/omni-ui-*` 0.1.0 接入多模态命令、独立语音命令窗口、LLM 意图解析和主窗口 headless executor。本文件记录接入过程中暴露出的 omni-ui 改进空间，以及这些改进落地后对当前 AgentOS 代码的影响。

## 总体判断

omni-ui 当前能力已经足够支撑 AgentOS 的 MVP：它能提供统一的页面/实体注册、规则优先 resolver、action executor、确认/澄清语义和 turn 流程。

真正的改进空间不在“再多几个组件”，而在“作为大型应用基础运行时时更不侵入、更 headless、更适合多窗口”。AgentOS 这次遇到的问题，大多来自 demo 友好的默认组件形态和大型 Electron 壳层之间的边界不够清晰。

## 建议 1：Provider 不应默认破坏宿主布局

### 现象

`MultimodalProvider` 当前会渲染真实 `div[data-mm-root]` 包住 children。这个 wrapper 默认没有 `height: 100%`、`min-height: 0` 或其它全高布局约束。

在 AgentOS 这种桌面壳里，主窗口高度链路是：

```text
html/body/#app -> AppShell -> AppBody -> Workspace/Chat
```

Provider 额外插入一层无高度 wrapper 后，会打断 `.app-shell { height: 100%; }` 的百分比参照。再叠加 `body { overflow: hidden; }`，结果是主窗口底部被裁掉，表现为页面无法滚动、Composer 不可见。

### 建议

- 提供 `rootProps` 或 `rootClassName`，让接入方可以显式控制 wrapper。
- 提供 `asChild` 或 `headless` 模式，不额外制造 DOM 节点。
- 默认 wrapper 至少应包含：

```css
[data-mm-root] {
  min-height: 0;
  min-width: 0;
}
```

对全屏应用可考虑文档推荐：

```css
#app > [data-mm-root] {
  height: 100%;
  min-height: 0;
}
```

### 如果改进，会影响当前代码吗

会，但主要是删除兼容代码。

当前 AgentOS 在 `src/style.css` 里有：

```css
#app > [data-mm-root] {
  height: 100%;
  min-height: 0;
  min-width: 0;
}
```

如果 omni-ui Provider 自带安全布局，或者支持 `asChild/headless`，这段可以删除或改为更小的应用级兜底。对应的 Electron 静态测试也需要更新。

## 建议 2：页面注册应提供 hook 版本

### 现象

`MultimodalPage` 当前既做页面语义注册，又渲染 DOM wrapper。对普通页面这没问题，但对 AppShell 这种顶层布局节点，它会制造额外布局盒。

AgentOS 目前通过：

```tsx
<MultimodalPage style={{ display: 'contents' }}>
  <AppShell />
</MultimodalPage>
```

让它只保留语义注册，不参与布局。

### 建议

提供 hook 版 API：

```tsx
useMultimodalPage({
  id,
  title,
  route,
  state,
})
```

组件版 `MultimodalPage` 继续保留，适合普通 DOM 区块；hook 版适合 AppShell、layout route、portal 或多窗口场景。

### 如果改进，会影响当前代码吗

会，是正向简化。

当前 `src/components/AppShell.tsx` 里的 `MultimodalPage` wrapper 可以改成：

```tsx
useMultimodalPage({
  id: multimodalPageId,
  title: multimodalPageTitle,
  route: multimodalPageRoute,
  state: { activeViewId, settingsCategory, activeProjectId, activeThreadId },
})
```

然后 AppShell JSX 可以恢复为直接返回 `.app-shell`。这会减少布局风险，也让 React tree 更贴近 AgentOS 原始结构。

## 建议 3：Command UI 与 Runtime 能力更清晰分层

### 现象

omni-ui 自带的可见命令输入组件对 demo 很友好，但在 AgentOS 主聊天窗口里，它容易和 Composer 抢底部空间，并截获滚动、点击和焦点。

AgentOS 最终采用的是：

```text
主窗口：headless executor，只负责注册 action 和执行命令
独立窗口：承载文本输入、语音输入、确认卡、澄清列表和结果回显
```

### 建议

- 文档上明确区分 `runtime/headless` 与 `demo UI`。
- 将 CommandInput、DevTools 等可见组件标注为 optional surface，而不是主集成路径。
- 提供一个官方的 headless 示例，展示如何用自定义窗口或自定义 composer 接入。

### 如果改进，会影响当前代码吗

影响较小。AgentOS 当前已经把主窗口 runtime 和独立命令窗口分开了。

如果 omni-ui 提供官方 headless 示例或更稳定的 headless API，AgentOS 主要会清理 `src/multimodal/AgentOsMultimodal.tsx` 里的部分桥接代码，但不会改变“主窗口唯一执行方”的架构。

## 建议 4：多窗口命令 session 需要成为一等能力

### 现象

AgentOS 的目标不是在同一个 DOM 里输入和执行，而是：

```text
语音命令窗口采集 utterance
  -> 主进程转发
  -> 主窗口 omni-ui runtime 解析和执行
  -> 结果、确认、澄清回传语音窗口
```

当前这套链路需要 AgentOS 自己设计 IPC 协议和状态映射。

### 建议

omni-ui 可以提供跨 surface/session 的协议抽象，例如：

```ts
type MultimodalCommandSession = {
  submitUtterance(input): Promise<TurnHandle>
  respondConfirmation(turnId, accepted): Promise<void>
  respondClarification(turnId, optionId): Promise<void>
  subscribe(listener): Unsubscribe
}
```

并允许 session transport 由宿主实现：

```text
same-window
cross-window IPC
browser extension background
native bridge
remote device
```

### 如果改进，会影响当前代码吗

会影响 `src/multimodal/AgentOsMultimodal.tsx`、`src/voice-main.tsx`、`electron/main.ts` 中的命令转发和响应协议。

这是可控影响，因为 AgentOS 已经把这些逻辑集中在 Desktop Seam 和 multimodal runtime 中。业务组件，例如 ChatPage、Composer、Sidebar，不需要被动重写。

## 建议 5：确认、澄清和执行结果协议应稳定类型化

### 现象

AgentOS 独立窗口需要展示：

- 成功执行
- 无法识别
- 需要确认
- 需要澄清
- 执行失败

这要求把 omni-ui turn/result 映射成窗口 UI 可消费的数据。当前 AgentOS 已做一层适配，但这层适配对 omni-ui 内部 result 形态有耦合。

### 建议

提供稳定的 UI-facing result protocol：

```ts
type CommandUiResult =
  | { status: 'executed'; message: string }
  | { status: 'unsupported'; reason: string }
  | { status: 'needs-confirmation'; turnId: string; title: string; description?: string }
  | { status: 'needs-clarification'; turnId: string; candidates: ClarificationCandidate[] }
  | { status: 'failed'; message: string; recoverable: boolean }
```

同时提供 helper：

```ts
toCommandUiResult(turn): CommandUiResult
```

### 如果改进，会影响当前代码吗

会简化独立命令窗口和 runtime 之间的 DTO。

当前 AgentOS 自己维护的确认/澄清映射可以替换成 omni-ui 官方 helper。需要更新测试断言，但交互形态不会改变。

## 建议 6：LLM resolver 的 Provider 适配层可以更开放

### 现象

AgentOS 没有让 renderer 直接持有模型 Key，而是通过主进程 Claude Agent SDK 做一次性 JSON 意图识别。这个安全边界是对的，但需要自己把 omni-ui resolver prompt、SDK query、JSON 提取和错误降级粘起来。

### 建议

omni-ui 保持 provider-neutral，同时暴露更清晰的 resolver adapter interface：

```ts
createLlmResolver({
  complete,
  parseJson,
  onTelemetry,
  onFallback,
})
```

并提供官方示例：

- browser fetch provider
- Electron main-process provider
- Claude Agent SDK provider
- local model provider

### 如果改进，会影响当前代码吗

影响集中在 `src/multimodal/config.ts` 和 Electron intent resolve IPC。AgentOS 仍应保留“Key 只在主进程”的原则。

如果 omni-ui 官方支持 Claude Agent SDK adapter，当前代码可以删掉部分 prompt 拼接、JSON 容错和 telemetry glue。

## 建议 7：性能观测 API 可以更产品化

### 现象

大型 AppShell 接入后，DOM 快照和语义对象注册的性能非常关键。omni-ui 内部已有缓存、节流和 benchmark 思路，但接入方在真实产品里需要更直观的指标。

### 建议

提供 dev-only performance hooks：

```ts
useMultimodalDiagnostics()
```

返回：

- 当前对象数量
- 当前 DOM 节点数量
- 最近一次 snapshot 耗时
- mutation refresh 次数
- resolver 耗时
- action dispatch 耗时
- 被忽略节点数量和原因

### 如果改进，会影响当前代码吗

影响较小。AgentOS 可以把这些诊断接到现有开发者入口或设置页，而不是自己额外打日志。生产路径不用改变。

## 对 AgentOS 当前代码的迁移优先级

| 优先级 | omni-ui 改进 | AgentOS 迁移动作 | 风险 |
| --- | --- | --- | --- |
| P0 | Provider `asChild/headless` 或安全 wrapper | 删除 `#app > [data-mm-root]` 兼容 CSS，更新静态测试 | 低 |
| P0 | `useMultimodalPage` | 移除 AppShell 外层 `MultimodalPage` wrapper | 低 |
| P1 | 稳定 UI result protocol | 替换当前确认/澄清 DTO 映射 | 中 |
| P1 | 跨窗口 command session | 收缩 Desktop Seam 中转协议和 voice window glue | 中 |
| P2 | 官方 Claude Agent SDK resolver adapter | 简化 intent resolve IPC 内部实现 | 中 |
| P2 | diagnostics hook | 增加开发诊断面板，减少自定义日志 | 低 |

## 建议给 omni-ui 的 issue 拆分

1. `MultimodalProvider` 支持 `asChild/headless/rootProps`，避免默认 DOM wrapper 破坏宿主布局。
2. 新增 `useMultimodalPage`，让页面语义注册不依赖 DOM wrapper。
3. 文档拆分 headless runtime 与 demo CommandInput，明确大型应用推荐集成方式。
4. 设计 cross-window command session protocol，覆盖确认、澄清和结果回传。
5. 导出稳定的 UI-facing turn/result protocol 和转换 helper。
6. 提供 Electron main-process LLM resolver 示例，尤其是 Key 不进入 renderer 的安全模式。
7. 提供 dev-only diagnostics hook，帮助宿主评估 snapshot 和 resolver 性能。

## 结论

如果 omni-ui 完成上述改进，AgentOS 当前实现不会被推翻，反而会变薄。

最可能被删除或简化的是：

- `src/style.css` 中针对 `div[data-mm-root]` 的布局兜底。
- `AppShell` 外层 `MultimodalPage` wrapper。
- 独立命令窗口与主窗口之间的部分结果映射代码。
- LLM resolver 的部分 JSON 解析和 provider glue。

最不应改变的是：

- 主窗口仍是唯一命令执行方。
- API Key 仍只留在主进程。
- 语音窗口只负责采集 utterance 和展示交互状态。
- 业务组件只暴露 executor，不直接耦合模型或系统级命令。
