# R4-02｜按 plan 分档的启动、构建与开发会话衔接

> 来源 `C-RSM-402`/`C-RSM-403`/`C-RSM-406`，对应 `technical.md T4.4–T4.6`。依赖 R4-01。

## 任务目标

`start()` 按 plan 分档：`artifact` 零进程文件伺服、`buildable` 构建一次后转 `artifact`、`development` 才 spawn dev。浏览态不占 root 执行锁，因此同路径两个 Runtime 可以同时查看。

## 冻结交互

- 浏览态永不 spawn dev。dev 只出现在开发会话或第 ③ 档。
- 构建后重新探测：命中产物提交 last-good；未命中记 `build-produces-no-artifact` 并按 dev 启动，不报硬失败。
- 构建期间取瞬时 build lease 并串行；dev 独占 development lease，冲突时保留既有 conflict 错误与占用者信息。
- `saveCapability` 由 plan 决定：`artifact`/`buildable` → `static`，`development` → `development-only`，`unsupported` → `unavailable`。
- 存量 Definition 的过时 `mode` 由探测结论覆盖，不写迁移脚本，不动 Thread/产物/view state。

## Allowlist

- `electron/local-app-runtime/index.ts`
- `electron/runtime-development-runtime-bridge.ts`
- `electron/main.ts`（start/restore 冲突回传）
- `electron/local-app-runtime.test.mjs`、`electron/static-runtime.test.mjs`、`electron/runtime-development-runtime-bridge.test.mjs`、`electron/runtime-root-execution-registry.test.mjs`

## 必测

- artifact 档零 spawn、不取 lease；同路径两个 Definition 同时伺服成功。
- buildable 档构建一次即转 artifact；构建无产物则降级 dev。
- 开发会话进入 dev、结束重新探测并只构建一次；development-only 结束后不伪造已保存。
- root 冲突仍然阻止第二个 dev，并把占用者信息回传。

```bash
npm run typecheck
node --test electron/local-app-runtime.test.mjs electron/static-runtime.test.mjs electron/runtime-development-runtime-bridge.test.mjs electron/runtime-root-execution-registry.test.mjs
git diff --check
```
