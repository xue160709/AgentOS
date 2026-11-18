# Workspace Runtime

## Revision 6 Planned：独立 Runtime 与一键 AI 开发会话

Project Runtime 与 Workspace Runtime 将按用户意图保持为两个独立域，即使 canonical path 相同也不合并 Definition、运行状态、Host、Chat 或导航。项目首页固定管理 `<project>/.agentos/` 并在当前项目内显示 Runtime 卡片/详情；Workspace Runtime 只管理用户显式选择的验证目录，不创建或切换 synthetic Project。

两类 Runtime 使用一致的普通用户旅程：点击“用 AI 修改”即打开当前 Runtime 专用独立 Chat，并自动准备实时效果；窗口打开期间可以连续多轮让 AI 修改，不在每轮后反复切换模式或构建。关闭开发窗口或在主窗口点击“结束修改”后，系统在不取消运行中 AI 的前提下安全收口：成功修改最多生成一次新的已保存预览；失败、取消或构建失败继续展示上一份 last-good，并保留源码和 Diff 供继续修复。

用户界面只表达“已保存预览、实时修改、正在保存、预览未更新”，主动作固定为“用 AI 修改”，收口动作为“结束修改”，不要求理解 `npm run dev`、`npm run build`、端口或产物目录。Runtime 开发记录不混入普通项目对话列表，但可以在全局搜索中以 Runtime 身份找到；同路径已有实时修改时阻止第二实例并提供显式切换。Development-only Workspace Runtime 在结束 AI 开发会话后可继续保持查看页面所需的受管服务，但不得谎称生成了已保存预览。

状态：BUILDABLE / Planned，未实现，正式验收未执行。产品设计见 [`design.md`](design.md) 的 Revision 6，技术合同见 [`technical.md`](technical.md)，Acceptance 见 `C-021`–`C-027`。来源为 [`chg-20260818-agent-command-channel@3`](../../changes/active/chg-20260818-agent-command-channel/proposal.md)。

## 项目专属 `.agentos` Runtime（Change revision 3：Current / as-built）

本合同覆盖早期「项目首页与 Workspace Tab 共用 Runtime」的范围。系统现在有两个互不替代的 Runtime 域：

| 域 | 工程根目录 | owner | Preview host | Workspace Tab |
| --- | --- | --- | --- | --- |
| Project Runtime | `<project>/.agentos/` | `project`（绑定该 `projectId`） | `project-home` | 不进入、不创建、不引用 |
| Workspace Runtime | 用户显式选择的目录 | `workspace` | `workspace-tab` | 仅此域可使用 |

- Project Runtime 只从固定 `.agentos/` 发现静态声明、计算 fingerprint、构建与加载 last-good；项目根目录的 `package.json` 不再是 fallback。目录不存在时状态为 `not_initialized`，不 spawn、不猜框架、不写空工程。
- `not_initialized` 显示目标路径及「让 Agent 创建 Runtime 网页」入口。专用 IPC 只接受 main-window capability：Main 打开或聚焦对应项目独立 Chat 窗口，在其中自动创建并选中线程并提交创建请求；主窗口不得创建或选中空对话。首次发现 `.agentos/package.json` 后重新 ensure，仍须经显式信任才可执行脚本。
- `.agentos/` 必须经 realpath 后仍位于项目根 realpath 内；symlink escape 被拒绝且不得 spawn。受控静态输出、generation fence、失败保留 last-good 的既有边界不变。
- Workspace Runtime 继续由用户显式绑定，绝不发现、创建或加载项目 `.agentos/`。旧无 owner Definition 迁移为 `workspace`，不按路径推断、不移动/复制/删除用户文件。
- Project Runtime 页面不提供进入 Workspace Tab 的入口；`workspaceTabs` 只能引用 workspace-owned Definition，`project-home` 只能引用同项目的 project-owned Definition。

Runtime prompt 只适用于独立项目 Chat 窗口的普通/编辑重提，以及上述 Main-owned 创建编排。主窗口普通 Chat、Agent command、Website task、Task/Home managed run、Workspace/非项目请求均不得注入；eligibility 与实际 runtimeRoot 由 Main 根据 sender capability / 权威项目路径派生，renderer 不得传入 root 或 prompt-scope 标记。

状态：Revision 3 已实现，自动化 Development Check 通过；正式 GUI 验收尚未执行。唯一验收增量见 [`acceptance.md`](acceptance.md)；冻结技术合同见 [`technical.md`](technical.md)。

## Revision 4 Current / as-built：静态直开与手动构建

默认 Runtime 将从“恢复时自动启动 `npm run dev`”改为“直接打开最后一次成功的静态构建”。已有可用产物时不启动 npm、Node/Next server、不分配端口、不等待 HTTP readiness；没有产物时进入明确的“需要构建”状态，由用户主动构建。

项目通过 `package.json.agentos` 声明固定的静态构建合同：`mode=static`、`buildCommand=npm run build`、`outputRoot=out`、`entryFile=index.html`。构建只在用户点击时执行，结束后进程退出；AgentOS 校验项目输出后复制到 Main 管理的不可变 last-good 缓存并原子切换。构建失败继续打开上一次成功版本，源码更新则异步提示预览可能过期。

`npm run dev` 作为显式开发模式继续保留，供需要热更新时主动启用；`npm run start` 不是最快打开路径，也不作为静态项目默认方案。CodeNow Wiki 是首个静态导出接入项目，代码变更后由用户手动重新构建。

Revision 4 已实现并通过独立 Development Check：AgentOS 类型检查通过，完整 Electron 测试 145/145 通过，CodeNow Wiki 静态构建生成 624/624 页面。正式 Acceptance 状态见 [`acceptance.md`](acceptance.md)；本节的 Current/as-built 不等同于正式验收通过。

## Revision 2 历史基线（已被项目 `.agentos` 合同覆盖的部分不再适用）

用户层不再使用“Local App / 本地应用”概念：它被收敛为侧栏中的 `Workspace Tab`，底层能力统一称为 `Runtime`。Tab 标题由用户创建时填写并可重命名；目录或 package 名只作为默认建议，不是不可修改的显示名。关闭入口从行内按钮移至右键/键盘上下文菜单。

侧栏顺序调整为：`Tabs → 新对话 → 搜索 → Projects`。项目首页保留既有卡片 Overview，不修改 `ProjectHomeSurface` 或把 Runtime 混入卡片网格；首页新增独立 `Runtime` 页面，通过页级 `Overview / Runtime` Tab 切换两套系统。

本历史版本曾允许首页与侧栏视图复用一个 Runtime。该行为已被本页顶部的项目 `.agentos` 合同取代：项目页只消费 project-owned `.agentos` Runtime，Workspace Tab 只消费 workspace-owned 的显式目录 Runtime；两者不共用 Definition、consumer 或 Preview host。

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

- Claude Agent SDK 通过通用 SandboxBroker 修改代码、安装依赖和控制运行时。
- 选择并验证生产级跨平台 Sandbox Provider，完成项目外文件、网络、环境变量和子进程逃逸验证后，再提升安全承诺。

## 安全边界

当前实现是 `Trusted local process`：只有用户显式信任的本地目录才会自动执行项目脚本。`cwd`、路径校验、最小环境 allowlist、Electron renderer sandbox 和 Preview 隔离不等于生产级 OS 文件系统/网络强沙箱；在真实 Sandbox Provider 与逃逸验证完成前，不宣称项目外访问已被强制阻断。

## 验收与关联文档

- 唯一验收契约见 [`acceptance.md`](acceptance.md)，本 README 不复制验收场景或正式状态。
- 对象、旅程和交互边界见 [`design.md`](design.md)；实现与测试上下文见 [`technical.md`](technical.md)。
- 开发差距和后续入口见 [`TODO.md`](../../TODO.md)。
