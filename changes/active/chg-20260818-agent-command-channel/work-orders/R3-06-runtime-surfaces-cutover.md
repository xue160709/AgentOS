# R3-06｜项目首页/工作台入口、统一 Snapshot 与旧路径 Cutover

> 状态：待 R3-05。对应 `technical.md T3.5、T3.10–T3.11.5–6`。完成本单才可声称 Revision 3 P0 实现完成。

## 任务目标与原因

把项目首页和工作台接到同一 Runtime development API/Snapshot，但保持两个 Runtime scope 完全独立。两个入口都用“用 AI 修改”，活跃态用“结束修改”；项目首页不跳 Workspace Tab，工作台不创建/打开 backing Project。全局搜索可进入专用 Runtime 窗口，普通对话列表不显示 Runtime Thread。

## 当前 change_id@revision 与来源

- `chg-20260818-agent-command-channel@3`
- 必读：`design.md` 全部 Revision 3 用户流程，`technical.md T3.2、T3.5、T3.10–T3.12`，`acceptance.md ATDD-RDS-301–307/309`。
- 依赖：R3-01–R3-05 全部完成。

## 冻结交互

- Project target 只发 `{projectId,mountId}`；Workspace target 只发 `{workspaceTabId}`；Main 复核 owner/host。
- 冲突不自动导航；显示 Runtime 名称/归属和“切换到正在修改的 Runtime”，一次性 token 只聚焦正确主界面/窗口，不改 activeProjectId/owner。
- 未初始化“让 AI 创建”复用 open API 并提交受控创建 prompt；普通“用 AI 修改”不自动发 prompt。
- Header/卡片/placeholder/窗口只消费 Main 的 `RuntimeDevelopmentSnapshot`，不自行拼 Run/Runtime 状态。
- 停止新代码调用 `ensureWorkspaceTabProject/openWorkspaceTabProjectChat`；旧数据与函数保留兼容周期但入口不可达。

## 派发字段

- `write_mode=writer`
- `deadline=P0 UI/IPC cutover、目标回归与 build 通过后停止；不得执行正式验收`
- `attempt=1`
- `instance_id=UNASSIGNED`
- `diff_baseline=UNASSIGNED`
- `exact_write_allowlist`：仅下节路径；派发前绑定。

## Exact write allowlist

- `src/runtime-development-contract.ts`
- `src/desktop-api.ts`
- `src/desktop-seam.ts`
- `src/components/AppShell.tsx`
- `src/components/AppShellWorkspace.tsx`
- `src/components/AppShellSidebar.tsx`
- `src/components/RuntimeWorkspace.tsx`
- `src/components/chat/ProjectHomeRuntimeView.tsx`
- `src/components/AppSearchModal.tsx`
- `src/components/runtime-event-state.ts`
- `src/components/types.ts`
- `src/locales/en.json`
- `src/locales/zh.json`
- `electron/main.ts`
- `electron/preload.ts`
- `electron/workspace-tab-project.ts`
- `electron/workspace-tab-project-chat.ts`
- `electron/project-runtime-placement.test.mjs`
- `electron/workspace-tab-project.test.mjs`
- `electron/project-chat-renderer.test.mjs`
- `electron/runtime-event-state.test.mjs`
- `electron/desktop-seam.test.mjs`

禁止修改 Runtime Thread store、broker core、coordinator、root registry/window manager 核心；若契约不足回到新 attempt，不在 UI 补状态。

## 实施与 V3 风险面

1. 正常路径：两个入口各开自己窗口；多轮 live；结束后保存/last-good；搜索打开同一 Runtime Thread。
2. 失败/超时/取消/late event：conflict、busy、trust、root missing、live unavailable、save timeout/build fail 都用冻结错误码；renderer 不乐观追加被拒绝消息。
3. 状态/恢复：默认/空/加载/成功/失败/无权限/未初始化/stale/saving/needs_attention/冲突均来自 snapshot；项目页不改变 activeWorkspaceTabId。
4. 资源回收：切页面只释放 Preview consumer，不结束开发；“结束修改”与 window close 同一幂等 intent。
5. 回滚/完整性：flag 同时关闭新入口和 Runtime facade；不删 Runtime Thread/view state/last-good/旧 synthetic Project。

## 必测断言与最小验证

- Project/Workspace 同路径：对象/窗口/Thread/状态独立，第二实时实例 conflict，显式切换不转移 owner。
- 项目首页按钮不调用 openWorkspaceTab，不改变 active tab/project；工作台按钮不调用 backing Project Chat。
- 普通列表过滤；global search metadata/点击打开专用窗口。
- 固定文案和 accessible name“用 AI 修改/结束修改”；技术命令/路径/端口不进入默认错误。
- Workspace development-only 结束 Chat 后不伪造已保存；Project/static-capable 成功回 last-good。

```bash
npm run typecheck
node --test electron/project-runtime-placement.test.mjs electron/workspace-tab-project.test.mjs electron/project-chat-renderer.test.mjs electron/runtime-event-state.test.mjs electron/desktop-seam.test.mjs
npm run build
git diff --check
```

## 交付与停止

最终回报用户路径、source-audit 证明旧 backing Project 入口不可达、合同映射、命令/退出码和待 Electron smoke 风险。若必须由 renderer 推断 scope/phase、继续写 `WorkspaceTab.projectId`，或为了“方便”自动跳转，立即停止。
