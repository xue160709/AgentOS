# R4-04｜创建合同产出可静态化的 Runtime

> 来源 `C-RSM-405`，依赖 R4-01。收口"自建 Runtime 反而不能静态化"这一实测缺陷。

## 任务目标

新建的项目 Runtime 落地即命中探测的 ① / ② 档：配置静态导出、构建产出 `out/index.html`。探测已覆盖识别，因此不强制写 `agentos` 声明块，但允许 AI 写入以精确指定产物位置。

## Allowlist

- `electron/project-runtime-prompt.ts`
- `src/locales/en.json`、`src/locales/zh.json`（`runtime.createPrompt`）
- `electron/project-runtime-prompt.test.mjs`

## 必测

- system prompt 与中英创建请求都要求静态导出并以 `out/index.html` 为完成条件；仍禁止 Python 方案；仍限制写入 `.agentos` 内。

```bash
npm run typecheck
node --test electron/project-runtime-prompt.test.mjs
git diff --check
```
