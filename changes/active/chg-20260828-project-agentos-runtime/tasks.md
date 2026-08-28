---
change_id: chg-20260828-project-agentos-runtime
revision: 3
task_level: Medium
owner: implementation_agent
confirmation: user_confirmed_scope
acceptance_requested: false
coverage_gate: pass
---

# 项目专属 `.agentos` Runtime｜TODO

Revision 2：22 条（Revision 1 为 32 条）。减少的部分来自把跨 owner 引用降级为归属判定而非安全模型；新增的部分为落点反馈与 `not_initialized` 创建入口。Revision 3 收紧创建入口与 prompt scope；实现及自动化 Development Check 已完成，真实 GUI 正式验收仍待执行。

## M6：Revision 3 独立 Chat 编排与最小 prompt scope

- [x] `M6-01` 创建入口专用 IPC 只接受 main-window capability。Main 按目标项目打开或聚焦唯一独立 Chat 窗口，在该窗口自动创建并选中线程后提交 Runtime 网页创建请求；主窗口不得创建或选中空对话。
- [x] `M6-02` 将 Runtime prompt eligibility 改由 Main 根据独立项目 Chat sender capability（普通提交/编辑重提）或 M6-01 专用编排派生；renderer payload 不得包含 `runtimeRoot`、prompt scope 或等价标记，实际根目录继续由 Main 从权威项目路径计算。
- [x] `M6-03` 显式排除主窗口普通 Chat、Agent command、Website task、Task/Home managed run、Workspace/非项目与失效路径项目；它们不得注入 Runtime prompt。
- [x] `M6-04` 添加/更新回归：按钮窗口/线程编排、主窗口零空对话副作用、sender capability 拒绝、合格与全部不合格来源的 prompt matrix、renderer 伪造 scope/root 忽略。定向测试 77/77、完整 Electron 回归 299/299 通过。
- [ ] `M6-05` 执行真实 Electron GUI 验收：按钮打开正确独立窗口、线程选择与请求提交、主窗口不变；正式验收仍待人工证据，不能用自动化替代。
- [x] `M6-06` 收紧 Runtime 创建合同：system prompt 与中英文创建请求均要求读取当前项目已有内容和数据，以 Next.js、React、TypeScript 在 `.agentos/` 构建数据可视化工作台；必须在 `.agentos/` 执行 `npm install` 后执行 `npm run build`，静态导出 `out/index.html`，禁止以 Python、Flask、Streamlit 实现 Runtime；相关定向回归 96/96 通过。

## M0：合同与路径（3）

- [x] `M0-01` 新增 `PROJECT_AGENTOS_RUNTIME_DIRECTORY` 常量、`projectRuntimeRoot()` 和 `isContainedInProject()`；就近放在既有 runtime 模块中，不单建模块。覆盖 symlink 逃逸拒绝测试。
- [x] `M0-02` 为 Runtime Definition 增加 `owner: { kind: 'project'; projectId } | { kind: 'workspace' }`；旧数据缺省迁移为 workspace-owned，不按路径反推。
- [x] `M0-03` 为 `ProjectRuntimeResult` 增加 `not_initialized`，同步 `electron/preload.ts`、`src/desktop-api.ts` 和 renderer 类型。

## M1：Main 项目 Runtime 链路（4）

- [x] `M1-01` 修改 `readProjectRuntimeDefinition()`：按 `owner.kind === 'project'` + `projectId` + canonical `.agentos` 查找，不再用 `canonicalRoot === projectRoot` 匹配。
- [x] `M1-02` 修改 `resolveProjectRuntime()`：只 inspect `projectRuntimeRoot(project.path)`，不再 inspect 项目根；目录缺失时返回 `not_initialized` 且不注册、不信任、不 spawn。
- [x] `M1-03` 切换项目 Runtime host registration、trust、restore、start/build/restart/development 与 fingerprint 的根路径；build/dev cwd 与静态 output containment 都以 canonical `.agentos` 为边界。
- [x] `M1-04` Agent 写入或 watcher（复用 `sendProjectFilesChanged`）检测到 `.agentos/package.json` 后重新 ensure 项目 Runtime。

## M2：归属判定（3）

- [x] `M2-01` 从 `ProjectHomeRuntimeView` 移除“打开页签”按钮，并删除 `AppShell.openProjectRuntimeTab` 与 `onOpenTab` controller 链路。
- [x] `M2-02` 在既有 host/preview 校验链路中增加 owner 维度：`openWorkspaceTab` 拒绝 project-owned Definition；`project-home` Preview 只接受匹配 `projectId` 的 project-owned Definition；`workspace-tab` Preview 只接受 Tab 绑定的 workspace-owned Definition。不新建校验层，不为 ID 伪造/旧快照单独建模。
- [x] `M2-03` 回归验证手动 Workspace Runtime 的绑定、恢复、重定位和预览完全不受影响。

## M3：项目 Agent Prompt 与落点（4）

- [x] `M3-01` Project Chat Broker 在既有 `runner.submit({ cwd })` 处补传 `projectId`；`runtimeRoot` 由主进程用 `projectRuntimeRoot()` 派生，不接受调用方提供。
- [x] `M3-02` Revision 2 基线：新增 `electron/project-runtime-prompt.ts`。其“稳定附加到项目请求”的旧范围已由 M6-02 收窄，不得作为 Revision 3 完成事实。
- [x] `M3-03` Revision 2 基线：覆盖 Workspace/非项目/路径失效不注入。Revision 3 新增来源矩阵与按钮编排回归由 M6-04 待确认。
- [x] `M3-04` 落点反馈：项目 run 结束后若 `.agentos/` 仍不存在但项目根新出现疑似网页工程迹象（新增 `package.json`，或新增 `index.html`/`src`），在 Runtime 页面附加“Runtime 网页可能被写到项目根目录”提示并显示目标路径。只读只提示，不移动/复制/删除文件，不自动重试。

## M4：编辑收口与状态体验（3）

- [x] `M4-01` Runtime edit bridge 只解析 project-owned `.agentos` Definition。
- [x] `M4-02` fingerprint 只覆盖 `.agentos` 源码（顺带修复项目任意文件变动导致静态预览变 stale 的现有问题）；`.agentos` 未初始化时不启动实时预览，初始化并信任后恢复现有 edit lease/settle 语义。
- [x] `M4-03` Revision 2 基线：`not_initialized` 显示目标路径并提供创建入口。入口必须按 Revision 3 的 M6-01 转入独立项目 Chat 窗口；不得将本项旧实现说明视为 Revision 3 已完成。

## M5：迁移、文档与验证（5）

- [x] `M5-01` 旧无 owner Definition 安全迁移为 workspace-owned，不自动移动或删除文件；旧项目根目录 Definition 不再被项目首页选择，但被 Workspace Tab 引用时继续可用。
- [x] `M5-02` 每个项目至多创建一个 project-owned `.agentos` Definition，重启恢复不重复。
- [x] `M5-03` 回归验证失败/取消、generation fence、late Preview event 和 last-good 回退行为不变。
- [x] `M5-04` 更新 `prd/local-app-runtime` 与 `prd/chat-agent-runtime` 中双 Host / 项目根目录相关合同；更新中英文 UI 文案与 `TESTING_CHECKLIST.md`。
- [x] `M5-05` 运行 typecheck、Electron Runtime/Preview/Workspace/Chat 目标测试和完整 Electron 测试。

## 完成门禁

- [x] 项目 Runtime 只加载 `.agentos/`，根目录 Runtime 不再作为 fallback。
- [x] `workspaceTabs` 与 `project-home` Preview 不接受跨 owner Definition；UI 无跨域入口。
- [x] 项目 Agent Runtime 实现稳定写入 `.agentos/`；未写入时页面给出可见落点提示，`not_initialized` 可从 UI 直接发起创建。
- [x] 目录缺失、symlink escape、跨 owner 引用均有自动测试。
- [x] 通用 Workspace Runtime 与 last-good 安全模型无回归。
- [x] Revision 3：创建入口只经 main-window capability 编排到对应独立项目 Chat，主窗口无空对话副作用。
- [x] Revision 3：prompt eligibility 只来自独立项目 Chat sender capability 或专用编排，全部排除来源均有回归确认。
