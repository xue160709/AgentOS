# R4-05｜生产伺服档回归

> 来源：2026-08-30 用户"把 B 加回来"，修订 `C-RSM-402`/`C-RSM-403`，对应 `technical.md T4.2/T4.4`。依赖 R4-02。

## 任务目标

浏览态在"保持运行"这一类里优先跑生产产物而不是 dev。实测 `/data/.agentos` 的 `next build` 产出 0 个 HTML、三个 `force-dynamic` API 路由，静态化需要改架构；这类工程应当以 `npm run start` 伺服。同时覆盖"已经构建好的服务端产物直接运行、不重复构建"。

## 冻结交互

- 探测顺序：声明块 → 已有静态产物 → `.next/BUILD_ID` + `start` 脚本（直接 start）→ `build` 脚本（构建后再判）→ `dev` 脚本 → 不支持。
- 构建后无静态产物：有 `start` 走生产伺服，否则有 `dev` 走开发伺服；两者都不报硬失败。
- `.next/BUILD_ID` 是唯一被认可的服务端产物标记，只对 Next 生效；其它框架必须先构建。命令仍固定为 `npm run build` / `npm run start` / `npm run dev`，不读取也不执行其它脚本。
- 生产伺服使用 `NODE_ENV=production`，与 dev 共用端口分配、就绪探测与 root lease；同一目录仍只允许一个常驻服务。
- `serveOverride` 值改为 `'artifact' | 'server'`；`server` 只表示"保持运行"，跑 start 还是 dev 由探测择优。
- 开发会话与旧 development 入口改用不持久化的 `serveScript: 'dev'` 强制 dev，绕过探测；该字段不进 store 白名单。
- 用户可见文案不变：② 与 ④ 都是「需要保持运行才能查看」。

## Allowlist

- `electron/local-app-runtime/static.ts`、`electron/local-app-runtime/index.ts`
- `electron/runtime-development-runtime-bridge.ts`、`electron/main.ts`
- `src/components/types.ts`、`src/chat-workspace-persistence.ts`、`src/components/AppShell.tsx`、`src/components/chat/ProjectHomeRuntimeView.tsx`
- `electron/static-runtime.test.mjs`、`electron/local-app-runtime.test.mjs`、`electron/chat-workspace-store.test.mjs`、`electron/runtime-development-runtime-bridge.test.mjs`

## 必测

- 已有 `.next/BUILD_ID` + start：直接 `run start`，零 build spawn。
- 构建后无静态产物：有 start → `run start`；无 start 有 dev → `run dev`。
- 静态产物优先于服务端产物（两者并存时零进程）。
- 开发会话仍然跑 `run dev`；`serveScript` 不被持久化。
- `serveOverride: 'server'` 持久化并在 start/dev 之间择优；未知值被丢弃。

```bash
npm run typecheck
node --test electron/static-runtime.test.mjs electron/local-app-runtime.test.mjs electron/chat-workspace-store.test.mjs electron/runtime-development-runtime-bridge.test.mjs
npx vite build
git diff --check
```
