# R4-03｜卡片双段状态、启动入口、查看方式覆盖与冲突可见

> 来源 `C-RSM-404`/`C-RSM-407`，对应 `technical.md T4.7–T4.8`。依赖 R4-02。同时修复 R3-06 的三处删减。

## 任务目标

让用户看懂 Runtime 现在处于哪一档、能不能改、为什么起不来。

## 冻结交互

- 卡片头部同时显示 Runtime 状态与开发会话状态，两者不得互相取代。
- 停止态提供启动入口；`unsupported` 与构建失败给固定文案并可重试；构建失败保留上一版。
- "查看方式"提供「已保存预览」/「保持运行」与"恢复自动判断"；选已保存预览而无产物时触发构建，构建不出静态则如实失败。
- 浏览路径的 root-conflict 复用既有冲突提示，显示占用者名称、归属与"切换到正在修改的 Runtime"，不得静默失败。
- 界面只出现「已保存预览」「需要保持运行才能查看」「更新预览」「用 AI 修改」「结束修改」；npm/端口/HMR 只进日志与高级详情。

## Allowlist

- `src/components/chat/ProjectHomeRuntimeView.tsx`
- `src/components/RuntimeWorkspace.tsx`
- `src/components/AppShell.tsx`
- `src/components/runtime-event-state.ts`
- `src/locales/en.json`、`src/locales/zh.json`
- `electron/runtime-event-state.test.mjs`、`electron/project-chat-renderer.test.mjs`、`electron/ui-locale-keys.test.mjs`

## 必测

- 两段状态同时存在；停止态启动入口可用；冲突提示出现在浏览路径。
- 覆盖切换双向生效并持久化；新增文案在 zh/en 均解析。

```bash
npm run typecheck
node --test electron/runtime-event-state.test.mjs electron/project-chat-renderer.test.mjs electron/ui-locale-keys.test.mjs
npx vite build
git diff --check
```
