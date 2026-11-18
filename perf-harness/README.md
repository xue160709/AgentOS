# Render 计数探针

用真实 `AppShell` 组件树跑一次合成的流式回答，统计每个组件被父级创建了多少次元素。
组件是非 `memo` 的普通函数组件，因此「父级创建了它的元素」等价于「它渲染了一次」。

**不改动任何组件源码**：JSX 工厂通过 `jsxImportSource` 换成 `jsx-shim/`，
所以同一份探针可以在任意 commit / worktree 上直接跑，用来做前后对比。

## 跑一次

```bash
npx vite --config perf-harness/vite.config.ts
```

打开 `http://localhost:5199/perf-harness/index.html`，在控制台执行：

```js
await window.__perfRun()
```

返回 `{ deltaCount, streaming, terminal }`：

- `streaming`：40 条流式 delta 期间的渲染次数（不含提交与终止事件）。
- `terminal`：终止快照（run 变为 `succeeded`）期间的渲染次数。

计数只覆盖普通函数组件。`memo()` / `forwardRef()` 包装后的组件（`Transcript`、`ChatPage`）
返回的是对象而不是函数，不会出现在结果里——判断 `ChatPage` 有没有重渲染，看它渲染体里
创建的 `Composer`。

## 前后对比

```bash
git worktree add --detach /tmp/perf-before <baseline-commit>
ln -s "$PWD/node_modules" /tmp/perf-before/node_modules
cp -r perf-harness /tmp/perf-before/perf-harness
# 改掉 /tmp/perf-before/perf-harness/vite.config.ts 里的端口，然后同样跑一次
```

## 注意

- 探针刻意不用 `requestAnimationFrame` / `setTimeout` 让出：浏览器面板隐藏时前者不触发、
  后者被节流到秒级。`tick()` 用 `MessageChannel`，与 React 调度器同源，不受可见性影响。
- 入口不套 `StrictMode`：dev 下它会把每次 render 计两次。
- 只桩掉 `window.projectChat`（`AppShell` 判定 Revision 2+ 的唯一依据）和工作区的
  localStorage 种子；`window.desktop` / `window.claudeChat` 保持缺席，所有调用点都是可选链。
