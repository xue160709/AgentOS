# Workspace Runtime

## Revision 4 Current / as-built：静态直开与手动构建

默认 Runtime 将从“恢复时自动启动 `npm run dev`”改为“直接打开最后一次成功的静态构建”。已有可用产物时不启动 npm、Node/Next server、不分配端口、不等待 HTTP readiness；没有产物时进入明确的“需要构建”状态，由用户主动构建。

项目通过 `package.json.agentos` 声明固定的静态构建合同：`mode=static`、`buildCommand=npm run build`、`outputRoot=out`、`entryFile=index.html`。构建只在用户点击时执行，结束后进程退出；AgentOS 校验项目输出后复制到 Main 管理的不可变 last-good 缓存并原子切换。构建失败继续打开上一次成功版本，源码更新则异步提示预览可能过期。

`npm run dev` 作为显式开发模式继续保留，供需要热更新时主动启用；`npm run start` 不是最快打开路径，也不作为静态项目默认方案。CodeNow Wiki 是首个静态导出接入项目，代码变更后由用户手动重新构建。

Revision 4 已实现并通过独立 Development Check：AgentOS 类型检查通过，完整 Electron 测试 145/145 通过，CodeNow Wiki 静态构建生成 624/624 页面。正式 Acceptance 状态见 [`acceptance.md`](acceptance.md)；本节的 Current/as-built 不等同于正式验收通过。

## Revision 2 Current / as-built

用户层不再使用“Local App / 本地应用”概念：它被收敛为侧栏中的 `Workspace Tab`，底层能力统一称为 `Runtime`。Tab 标题由用户创建时填写并可重命名；目录或 package 名只作为默认建议，不是不可修改的显示名。关闭入口从行内按钮移至右键/键盘上下文菜单。

侧栏顺序调整为：`Tabs → 新对话 → 搜索 → Projects`。项目首页保留既有卡片 Overview，不修改 `ProjectHomeSurface` 或把 Runtime 混入卡片网格；首页新增独立 `Runtime` 页面，通过页级 `Overview / Runtime` Tab 切换两套系统。

Runtime 是可复用容器，同一 canonical root 与启动命令由侧栏 Tab host 和项目首页 host 共享一个受管进程。项目首页 host 不创建隐藏 Workspace Tab；两类 host 各自拥有 PreviewSession 与 consumer，释放其中一个不会误停仍被另一个使用的 Runtime。

Revision 2 代码已实现并通过独立 Development Check；类型检查与完整构建通过，定向测试 58 项中 57 项通过，唯一未通过项是当前受限沙箱禁止 fixture 监听 `127.0.0.1` 的 `EPERM` 环境限制。C-006～C-009 尚未执行正式 `project-verify`，因此不能宣称正式 Acceptance 通过。

## Revision 1 历史基线

## 模块定位

Local App Runtime 为 AgentOS 提供“在左侧打开一个本地 Web 应用 Tab，并由 AgentOS 管理其开发运行”的底层能力。用户入口是侧栏 `New Tab`；Runtime 负责本地项目的启动、就绪、预览与生命周期，不把项目伪装成聊天线程。

它把“打开终端、进入目录、运行 `npm run dev`、寻找端口、再打开页面”收敛为一次受信任的本地应用绑定。

**模块状态：Current / as-built（代码已实现；正式 Acceptance 当前 BLOCKED，尚不能宣称模块验收通过）。**

## 当前能力

### Definition 与 Tab

- `LocalAppDefinition` 保存本地目录、规范化路径、固定的 `npm run dev` 启动配置、信任状态和自动恢复策略；`LocalAppTab` 是指向 Definition 的可持久化视图入口，不伪装成聊天线程。
- 左侧 `New Tab` 打开 Local App 选择器，支持“打开已接入应用”和“绑定新的本地应用”。绑定新目录先检查 `package.json` 与 `dev` 脚本，再展示目录、命令和自动恢复说明；用户确认信任前不持久化、不运行脚本。
- 同一 canonical root 复用既有 Definition，并创建新的 Tab；关闭 Tab 只关闭视图，保留 Definition 供以后再次打开。取消或保存失败不会留下可见 Tab 或启动进程。

### Main 权威持久化

- 创建、打开已有应用和重新定位均以 Main 进程读取的 workspace revision 为门槛，在 `ChatWorkspaceStore` 中保存并回读确认 Definition/Tab；JSON/SQLite 快照共用 revision，保存失败会返回可读错误并保留重试路径。
- 只有 Main 持久化成功后，Renderer 才发布可见工作区状态，随后才 attach/start Runtime；Renderer 的 localStorage 镜像用于恢复速度，不冒充 Main 保存成功。
- 旧工作区快照可继续读取；缺失或损坏的 Local App 字段安全归一化为空集合，不破坏原有项目、线程和活动选择。

### 自动运行、就绪与状态恢复

- 仅对显式信任且仍可达的目录运行；Main 复核 canonical root、`package.json` 和 `dev` 脚本后，必要时执行依赖准备（有 lockfile 使用 `npm ci`，否则使用 `npm install`），再自动执行固定命令 `npm run dev`。
- 运行时分配 loopback 动态端口，注入最小允许环境变量，并以进程存活加 HTTP readiness probe 确认就绪；不硬编码 CodeNow Wiki 端口，也不把旧 PID/端口当作恢复事实。
- 用户可观察 `preparing`、`starting`、`running`、`degraded`、`failed`、`path_missing`、`stopped` 状态，查看脱敏最近日志，并执行刷新预览、重试、重启、停止、重新定位或移除。
- 应用恢复会保留已信任的 Definition、Tab 和活动选择，重新创建 Runtime；启动失败保留绑定并停在可恢复状态。崩溃重启次数有上限，状态事件带 runtime generation，旧事件不能覆盖新 Runtime。

### 多 Tab 共享 Runtime

- Tab、Runtime 和 PreviewSession 分离。同一 canonical root 与启动命令最多复用一个受管 Runtime，多个 Tab 通过 consumer 引用共享，不重复启动开发服务器。
- Runtime 重启会保留已有 consumers；关闭一个 Tab 只释放该 Tab 的 consumer，仍有其它 Tab 时继续运行，关闭最后一个调用方后回收受管进程树。
- 切换到聊天或其它工作区视图只隐藏当前 Preview，不释放 consumer、不停止 Runtime；切回同一 Tab 时复用原 PreviewSession/runtime generation，不重复 spawn。

### 全屏预览与顶部工具栏

- 预览由 Main 创建独立、无应用 preload 的 sandboxed `WebContentsView`，只加载当前 Runtime 的 loopback 地址；页面不能获得 Electron/Node bridge，外部导航、弹窗和权限请求受控拒绝。
- Local App 激活时预览铺满主内容区。顶部工具栏提供运行状态、Refresh、Logs、Restart 和 Stop；运行中与最近日志不占用主预览区域，失败、停止和目录缺失保留明显恢复动作。

### CodeNow Wiki 真实接入

- 通用 Local App 链路已接通真实目标目录 `/Volumes/macOS/Github/codenow.wiki`；当前已核对其 `package.json` 的 `name=codenow-wiki`、`scripts.dev=next dev`，真实页面和端口由运行时动态发现，未写入专用端口或页面逻辑。
- 已完成 CodeNow Wiki GUI live smoke：首次启动通过动态 readiness 在 `localhost:50041` 显示真实页面，AgentOS 重启后重新探测并恢复到 `localhost:50941`；端口均来自运行时，不是产品硬编码。
- 受控 fixture 的 `npm run dev`、动态 readiness、停止与恢复测试已通过。正式 Acceptance 仍因 6 个真实 Electron 负例/恢复场景缺少可定位证据而 BLOCKED，不能以 fixture 或本次 live smoke 结果宣称模块正式验收通过。

## 明确不做

- 不把项目首页改造成左预览/右 Claude Agent SDK 工作台，不实现 A2UI/Home Plugin 定制页面。
- 不接入 Claude Agent SDK 的文件/命令沙箱代理，不支持远程 URL 书签、云端部署、多用户共享或公开预览。

## Later

- 项目首页复用同一 Local App Runtime，形成左预览、右 Claude Agent SDK 的开发工作台。
- Claude Agent SDK 通过通用 SandboxBroker 修改代码、安装依赖和控制运行时。
- 选择并验证生产级跨平台 Sandbox Provider，完成项目外文件、网络、环境变量和子进程逃逸验证后，再提升安全承诺。

## 安全边界

当前实现是 `Trusted local process`：只有用户显式信任的本地目录才会自动执行项目脚本。`cwd`、路径校验、最小环境 allowlist、Electron renderer sandbox 和 Preview 隔离不等于生产级 OS 文件系统/网络强沙箱；在真实 Sandbox Provider 与逃逸验证完成前，不宣称项目外访问已被强制阻断。

## 验收与关联文档

- 唯一验收契约见 [`acceptance.md`](acceptance.md)，本 README 不复制验收场景或正式状态。
- 对象、旅程和交互边界见 [`design.md`](design.md)；实现与测试上下文见 [`technical.md`](technical.md)。
- 开发差距和后续入口见 [`TODO.md`](../../TODO.md)。
