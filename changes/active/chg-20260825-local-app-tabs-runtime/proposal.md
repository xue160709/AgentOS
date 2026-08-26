---
change_id: chg-20260825-local-app-tabs-runtime
revision: 5
decision: accepted
delivery: in_progress
owner: main_agent
confirmation_source: explicit_user_statement
confirmed_scope: "2026-08-26 用户纠正首次使用闭环：导入并确认信任后自动首次构建；后续源码变化才由用户决定重新构建；同时要求 homepage 支持静态导出并修复运行/预览状态不同步"
---

# 通用 Workspace Tab 与可复用 Runtime

## Revision 5：导入即自动首次构建

用户明确取代 Revision 4 的“没有产物时由用户主动点击构建”：首次导入是产品主流程，用户不应理解 `npm run build`、`out/` 或 Next.js 静态导出细节。

- 用户选择目录并确认信任后，Main 检测项目是否通过受控声明支持静态导出；检测仍以 `package.json.agentos` 的严格声明为准，不猜测或改写任意项目。
- 静态项目没有 last-good 或可安全导入的既有产物时，AgentOS 自动执行一次固定 `npm run build`，界面显示“正在首次构建”；构建成功后直接打开静态页面。
- 已有 last-good 时保持零 spawn 直开；源码比 last-good 新时继续显示旧页面和 stale 提示，只有这时才由用户决定是否重新构建。
- 自动首次构建失败或取消时不得启动 `npm run dev` 兜底；界面明确说明项目构建失败并提供重试或显式开发模式。
- 不支持静态导出的项目继续明确使用开发服务器，不把它伪装成静态项目，也不静默改变运行模式。
- `/Volumes/macOS/Github/homepage` 增加明确静态声明并完成必要的 Next.js 静态导出迁移，使其首次导入走上述自动构建路径。
- Runtime 工具栏、侧栏状态与中央 Preview 必须消费同一份 Main-authoritative snapshot；`building/ready/build_failed/stopped` 不得出现“顶部运行中、中央已停止”的互相矛盾显示。

### Revision 5 非目标

- 不对没有受控静态声明的普通 Next.js/Vite 项目做启发式自动改造。
- 不在源码变化后自动监听或持续重建。
- 不放宽固定构建命令、信任、路径隔离、Preview sandbox、generation/operation 或进程回收边界。

## Revision 4：手动构建与静态直开

用户确认 CodeNow Wiki 修改代码后可以由用户手动触发构建；平时打开标签页必须优先追求最快冷启动，不再默认常驻 `npm run dev` 或以 `npm run start` 作为最终方案。

- 已有可用静态构建时，Runtime 直接加载构建产物，不启动 npm、Next.js dev/start server，不分配 loopback 端口，也不等待 HTTP readiness。
- 没有构建产物时显示明确的“需要构建”状态，由用户主动触发构建；构建进程只在构建期间存在，结束后立即退出。
- 源码比最后成功构建更新时，旧构建仍可立即打开，同时提示预览可能过期；用户点击“重新构建”后再切换到新产物。
- 构建失败不得破坏最后一次成功产物或当前可用预览；失败原因和最近日志可观察，可再次重试。
- 现有 `npm run dev` 作为显式开发模式保留，不再是静态项目的默认打开路径；`npm run start` 不作为最快路径。
- CodeNow Wiki 改为可静态导出的 Next.js 产物；教程内容不再依赖常驻 Route Handler。需要动态网络数据的页面不得因此获得 Electron/Node bridge。

### Revision 4 非目标

- 不自动监听源码并持续重建，不恢复 dev server 的常驻编译成本。
- 不删除已有 RuntimeDefinition、WorkspaceTab、consumer、generation、持久化迁移或 dev 模式合同。
- 不扩大 Preview 对任意本地文件、外部导航、弹窗、权限或 Electron/Node 能力的访问范围。

### Revision 4 风险

- 静态资源协议必须把每个请求严格约束在该 Runtime 已确认的构建根目录内，拒绝路径穿越、符号链接逃逸和跨 Runtime 访问。
- 构建属于显式信任目录内的代码执行；只允许 Main 使用固定、已确认的构建命令，Renderer 不得传入 executable、args、root 或任意 URL。
- 构建成功切换、构建失败回退、快速关闭/重新打开和 late build event 必须按 runtimeDefinitionId、operation/generation 校验。

## Revision 3：运行时交互性能回归修复

用户在真实工作区中确认：Runtime 恢复后界面持续显示“运行中”，但 Workspace Tab 点击不切换，整个项目的点击与页面反馈明显卡顿。本 revision 不改变 Workspace Tab / Runtime 产品模型，按严重度修复以下已定位问题：

- Workspace Tab 被选中后必须同时清除旧 `activeThreadId`，恢复解析不能再让旧线程覆盖新 Tab。
- 高频 Runtime 日志不得逐行触发 AppShell 根状态更新；状态事件即时应用，日志在 Renderer 内有界批处理。
- Workspace 自动保存不得在 `useLayoutEffect` 的首屏阻塞阶段执行完整快照序列化和同步 localStorage 写入。
- Runtime 停止与测试清理必须确保 app-owned 子进程树在有界时间内退出，并保留“不扫描目录/端口、不误杀外部进程”的所有权边界。

受信任 Runtime 的自动启动数量属于可见产品行为，本 revision 先不擅自改变；完成前三项确定性修复后再依据实测决定“仅活动 Tab 懒启动”或“允许后台运行但设置上限”。

## 原因

Revision 1 已实现从本地目录自动运行 `npm run dev`、受控 Preview、持久化 Tab、恢复和进程回收，但把用户入口建模成独立的“Local App”。用户已明确否定这一产品概念：它就是侧栏中的普通 Tab；Runtime 是可同时被侧栏 Tab 和项目首页承载的共享能力。

项目首页原有 hero、Composer、留白、宽度和滚动节奏原样保留。本 revision 只在原 `chat-start-view__below-composer` 卡片容器内增加 `Overview / Runtime` 切换：`Overview` 显示既有卡片区，`Runtime` 在同一位置显示独立 Runtime 面板；标题和输入框不参与切换，不把 Runtime 塞进卡片网格，也不复制一套运行进程。

## 范围

- 取消所有用户可见的“Local App / 本地应用”栏目、文案、ARIA 和交互概念，侧栏改为通用 `Tabs` 区。
- `Tabs` 区位于“新对话”和搜索上方，视觉严格复用现有项目/对话行样式。
- Tab 名称由用户决定；package/目录名只作为首次建议。支持右键菜单重命名与关闭，行内不显示关闭按钮。
- 将领域类型、持久化字段、Desktop API/IPC 与 Runtime 事件迁移为 `RuntimeDefinition`、`WorkspaceTab` 和中性 `Runtime*` 合同；旧字段只用于一次性安全读取迁移。
- 抽取通用 `RuntimeWorkspace` / `RuntimePreview` 宿主 seam。侧栏 Tab 和项目首页各有独立 consumer 与 PreviewSession，共享同一 RuntimeInstance。
- 项目首页只在既有 `chat-start-view__below-composer` 容器内新增 `Overview / Runtime` 控制；hero、Composer 和首页整体布局保持原样，切换范围只覆盖该容器内的 `ProjectHomeSurface` 卡片区或 Runtime 面板；A2UI 卡片内部不改。
- 项目首页按当前项目路径查找或显式信任 RuntimeDefinition，不创建隐藏 WorkspaceTab；切换宿主时按精确 consumer 释放，仍有其它 consumer 时不停止进程。
- 保留 revision gate、显式信任、动态 readiness、日志、失败恢复、generation 隔离、Preview 安全与进程树回收。

## 非目标

- 不重构 A2UI/Home Plugin 卡片、排序、插件消息或 Agent 设置。
- 不把 Runtime 做成 A2UI 卡片，也不让两套首页系统共享内部状态。
- 不实现 Claude Agent SDK 文件/命令代理、远程 URL、云端部署、多用户共享或公开预览。
- 不新增生产级 OS 沙箱承诺；当前仍是显式信任的本地进程加受控 Preview。
- 不为尚未确认的未来内容种类设计通用 Tab union；本轮 WorkspaceTab 只承载 Runtime。

## 验收

- 侧栏首段为 `Tabs`，DOM 顺序早于新对话与搜索，且没有用户可见的 Local App 文案或行内关闭按钮。
- 用户可在创建时决定 Tab 名称，并通过右键或键盘上下文菜单重命名、关闭；名称持久化且重命名不重启 Runtime。
- 旧快照可安全迁移到新字段并保留 ID、标题、信任和活动选择；新保存只写新合同。
- 项目首页可在 Composer 下方的 `Overview / Runtime` 间切换；hero 与输入框始终可见，现有卡片系统不受 Runtime 启停或失败影响。
- 项目首页 Runtime 不创建隐藏 Tab；同 root/command 的首页与侧栏 Tab 共享一个 Runtime，任一宿主离开不误停另一个宿主。
- Preview 创建、隐藏、关闭与 late event 都按 host + runtimeId + generation 校验；外部导航、窗口和权限边界不回退。
- 类型检查、Workspace/IPC/Runtime/Preview 目标测试和风险定向质量检查达到可交付状态；正式产品验收仍由 `project-verify` 完成。
- 从活动线程点击任意 Workspace Tab 后，`activeThreadId` 清空且 `activeWorkspaceTabId` 保持为目标 Tab；刷新恢复也不得反选旧线程。
- Runtime 连续输出日志时，日志仍有界保留，但 AppShell 状态提交频率受批处理窗口约束；停止、失败、就绪等状态不等待日志批次。
- 工作区 staging 发生在浏览器完成布局/绘制之后；既有即时镜像、延迟 Main 保存与卸载 flush 语义不退化。
- Runtime 目标测试结束后不残留 fixture 的 npm/node 子进程；清理仍只作用于能证明由 AgentOS Runtime 创建的进程树。

## 决策与风险

- 正式用户对象为 `WorkspaceTab` 与 `Runtime`；`Local App` 只允许出现在旧数据迁移和历史证据中。
- 项目首页切换控件放在原卡片容器顶部，默认 `Overview`；hero、Composer 与原首页间距不参与切换或重排；Runtime 面板未信任时只检查并显示 CTA，不因页面加载自动运行脚本。
- consumer 采用 `tab:<tabId>` 与 `project-home:<projectId>:<mountId>`；项目首页 mountId 每次挂载唯一，防止旧 release/late event 污染新宿主。
- 工作区 schema 迁移是最高风险：必须双读、原子写、不删除旧快照；非法信任值保守降级为 revoked。
- 当前 dirty tree 是 Revision 1 的既有实现，所有实现任务必须以该状态为 baseline，禁止回退或覆盖无关用户改动。
