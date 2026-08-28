---
change_id: chg-20260828-project-agentos-runtime
revision: 2
task_level: Medium
owner: implementation_agent
confirmation: user_confirmed_scope
acceptance_requested: false
coverage_gate: ready_for_implementation
---

# 项目专属 `.agentos` Runtime｜TODO

Revision 2：22 条（Revision 1 为 32 条）。减少的部分来自把跨 owner 引用降级为归属判定而非安全模型；新增的部分为落点反馈与 `not_initialized` 创建入口。详见 `proposal.md`「Revision 2 调整说明」。

## M0：合同与路径（3）

- [ ] `M0-01` 新增 `PROJECT_AGENTOS_RUNTIME_DIRECTORY` 常量、`projectRuntimeRoot()` 和 `isContainedInProject()`；就近放在既有 runtime 模块中，不单建模块。覆盖 symlink 逃逸拒绝测试。
- [ ] `M0-02` 为 Runtime Definition 增加 `owner: { kind: 'project'; projectId } | { kind: 'workspace' }`；旧数据缺省迁移为 workspace-owned，不按路径反推。
- [ ] `M0-03` 为 `ProjectRuntimeResult` 增加 `not_initialized`，同步 `electron/preload.ts`、`src/desktop-api.ts` 和 renderer 类型。

## M1：Main 项目 Runtime 链路（4）

- [ ] `M1-01` 修改 `readProjectRuntimeDefinition()`：按 `owner.kind === 'project'` + `projectId` + canonical `.agentos` 查找，不再用 `canonicalRoot === projectRoot` 匹配。
- [ ] `M1-02` 修改 `resolveProjectRuntime()`：只 inspect `projectRuntimeRoot(project.path)`，不再 inspect 项目根；目录缺失时返回 `not_initialized` 且不注册、不信任、不 spawn。
- [ ] `M1-03` 切换项目 Runtime host registration、trust、restore、start/build/restart/development 与 fingerprint 的根路径；build/dev cwd 与静态 output containment 都以 canonical `.agentos` 为边界。
- [ ] `M1-04` Agent 写入或 watcher（复用 `sendProjectFilesChanged`）检测到 `.agentos/package.json` 后重新 ensure 项目 Runtime。

## M2：归属判定（3）

- [ ] `M2-01` 从 `ProjectHomeRuntimeView` 移除“打开页签”按钮，并删除 `AppShell.openProjectRuntimeTab` 与 `onOpenTab` controller 链路。
- [ ] `M2-02` 在既有 host/preview 校验链路中增加 owner 维度：`openWorkspaceTab` 拒绝 project-owned Definition；`project-home` Preview 只接受匹配 `projectId` 的 project-owned Definition；`workspace-tab` Preview 只接受 Tab 绑定的 workspace-owned Definition。不新建校验层，不为 ID 伪造/旧快照单独建模。
- [ ] `M2-03` 回归验证手动 Workspace Runtime 的绑定、恢复、重定位和预览完全不受影响。

## M3：项目 Agent Prompt 与落点（4）

- [ ] `M3-01` Project Chat Broker 在既有 `runner.submit({ cwd })` 处补传 `projectId`；`runtimeRoot` 由主进程用 `projectRuntimeRoot()` 派生，不接受调用方提供。
- [ ] `M3-02` 新增 `electron/project-runtime-prompt.ts`，注入绝对 `<project>/.agentos` 路径；由 `buildRequestAppendSystemPrompt()` 稳定附加到项目请求，不做“是否代码任务”分类。
- [ ] `M3-03` 覆盖测试：项目请求注入；Workspace/非项目请求不注入；项目路径失效不注入。
- [ ] `M3-04` 落点反馈：项目 run 结束后若 `.agentos/` 仍不存在但项目根新出现疑似网页工程迹象（新增 `package.json`，或新增 `index.html`/`src`），在 Runtime 页面附加“Runtime 网页可能被写到项目根目录”提示并显示目标路径。只读只提示，不移动/复制/删除文件，不自动重试。

## M4：编辑收口与状态体验（3）

- [ ] `M4-01` Runtime edit bridge 只解析 project-owned `.agentos` Definition。
- [ ] `M4-02` fingerprint 只覆盖 `.agentos` 源码（顺带修复项目任意文件变动导致静态预览变 stale 的现有问题）；`.agentos` 未初始化时不启动实时预览，初始化并信任后恢复现有 edit lease/settle 语义。
- [ ] `M4-03` 更新项目 Runtime 页面状态与文案：`not_initialized` 显示目标路径并提供「让 Agent 创建 Runtime 网页」入口（发起一次带约束 prompt 的项目 run，主进程不写任何文件）；同步信任、构建失败、last-good 文案与无障碍状态。

## M5：迁移、文档与验证（5）

- [ ] `M5-01` 旧无 owner Definition 安全迁移为 workspace-owned，不自动移动或删除文件；旧项目根目录 Definition 不再被项目首页选择，但被 Workspace Tab 引用时继续可用。
- [ ] `M5-02` 每个项目至多创建一个 project-owned `.agentos` Definition，重启恢复不重复。
- [ ] `M5-03` 回归验证失败/取消、generation fence、late Preview event 和 last-good 回退行为不变。
- [ ] `M5-04` 更新 `prd/local-app-runtime` 与 `prd/chat-agent-runtime` 中双 Host / 项目根目录相关合同；更新中英文 UI 文案与 `TESTING_CHECKLIST.md`。
- [ ] `M5-05` 运行 typecheck、Electron Runtime/Preview/Workspace/Chat 目标测试和完整 Electron 测试。

## 完成门禁

- [ ] 项目 Runtime 只加载 `.agentos/`，根目录 Runtime 不再作为 fallback。
- [ ] `workspaceTabs` 与 `project-home` Preview 不接受跨 owner Definition；UI 无跨域入口。
- [ ] 项目 Agent Runtime 实现稳定写入 `.agentos/`；未写入时页面给出可见落点提示，`not_initialized` 可从 UI 直接发起创建。
- [ ] 目录缺失、symlink escape、跨 owner 引用均有自动测试。
- [ ] 通用 Workspace Runtime 与 last-good 安全模型无回归。
