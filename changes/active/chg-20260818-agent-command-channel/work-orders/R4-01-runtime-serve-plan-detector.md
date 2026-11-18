# R4-01｜RuntimeServePlan 探测器与合同

> 来源 `C-RSM-401`/`C-RSM-402`/`C-RSM-405`，对应 `technical.md T4.1–T4.3`。本单只建立探测器与类型，不改启动分支。

## 任务目标

把"这个 Runtime 怎么被查看"从 `package.json` 申报改成系统探测。探测器输出与既有 `StaticDeclaration` 同形的结论，使既有静态构建/产物/预览链路无需改动。

## 冻结交互

- 探测顺序固定：合法声明块 → 已有产物（`out` → `dist` → `build` 下的 `index.html`）→ 有 `build` 脚本 → 有 `dev` 脚本 → 不支持。
- 非法声明块仍是硬错误，不降级探测。
- 产物目录必须通过 `isSafeStaticRelativePath` 与 canonical containment；只认 `npm run build` / `npm run dev` 两条固定命令。
- `serveOverride` 压过探测；探测不推翻用户显式选择。

## Allowlist

- `electron/local-app-runtime/static.ts`
- `electron/local-app-runtime/index.ts`（仅 inspect 与类型接入）
- `src/components/types.ts`、`src/desktop-api.ts`（Definition 字段）
- `electron/static-runtime.test.mjs`、`electron/local-app-runtime.test.mjs`

## 必测

- 五档判定与顺序；`dist`/`build` 变体；声明块优先于探测；非法声明块不降级。
- 越界产物目录（`..`、绝对路径、symlink 逃逸）被拒。
- `serveOverride` 覆盖两个方向；无 `package.json` 与无脚本目录归为 unsupported。

```bash
npm run typecheck
node --test electron/static-runtime.test.mjs electron/local-app-runtime.test.mjs
git diff --check
```
