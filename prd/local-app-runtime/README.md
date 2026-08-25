# Local App Runtime

## 模块定位

Local App Runtime 为 AgentOS 提供“在左侧打开一个本地 Web 应用 Tab，并由 AgentOS 管理其开发运行”的底层能力。用户入口是侧栏 `New Tab`；Runtime 负责本地项目的启动、就绪、预览与生命周期，不把项目伪装成聊天线程。

**模块状态：Planned（已确认方案，尚未实现）。**

## 当前状态（Current）

- AgentOS 当前已有本地项目、聊天线程及工作区恢复能力；相关职责见 [`workspace-session`](../workspace-session/README.md)。
- Local App Definition、Local App Tab、开发服务器进程管理和本地应用预览尚未实现，因此用户现在仍不能通过 AgentOS 自动运行项目并在 Tab 内查看页面。
- 首个接入项目的规划事实已核实：`/Volumes/macOS/Github/codenow.wiki` 存在 `package.json`，其 `dev` 脚本为 `next dev`。这不是当前 AgentOS 已接入能力。

## 已确认计划（Planned）

### 用户价值与主路径

面向需要在本地项目与 AgentOS 工作区之间往返的开发者，首期目标是把“打开终端、进入目录、运行 `npm run dev`、寻找端口、再打开页面”收敛为一次受信任的项目绑定：

```text
New Tab → Local App → 选择项目目录 → 确认信任 → AgentOS 自动准备并启动 → Tab 内预览
```

首个验证实例为 CodeNow Wiki；用户不需要手动启动 `npm run dev`。项目重启后，已信任的绑定与 Tab 需要自动恢复并重新启动运行时。

### 首期范围与优先级

- **P0：** 从 `New Tab` 创建 Local App Tab；首次选择并确认信任本地目录；持久化绑定；由 AgentOS 自动准备依赖、运行 `npm run dev`、探测真实就绪地址并显示预览。
- **P1：** 恢复已信任应用、复用同一 Local App 的运行时、在关闭最后一个调用方后回收进程，并提供刷新、重启、停止、失败重试和目录缺失恢复。
- **Later：** 项目首页的左预览/右 Claude 分栏、Claude Agent SDK 的沙箱文件与命令代理，以及经过真实验证的生产级跨平台 Sandbox Provider。

运行状态需要让用户能区分信任确认、依赖准备、启动中、运行中、失败、目录缺失和已停止；详细对象、旅程和状态规则见 [`design.md`](design.md)。

## 非目标与边界

- 本轮不改造项目首页为 Claude 分栏开发工作台，也不实现 A2UI/Home Plugin 定制页面。
- 本轮不接入 Claude Agent SDK 的文件/命令沙箱代理，不支持远程 URL 书签、云端部署、多用户共享或公开预览。
- 只有用户显式确认信任的本地目录才可自动运行。
- 在生产级 Sandbox Provider 尚未确定并通过项目外文件、网络、环境变量和子进程逃逸验证前，不宣称已具备跨平台强 OS 文件系统隔离；普通 `cwd`、路径校验或 renderer sandbox 不能替代该承诺。

## 关键决策

- `New Tab` 是产品入口，Local App Runtime 是可复用的底层能力；后续项目首页只能复用 Runtime，不另建一套启动机制。
- 启动命令由 AgentOS 管理，端口通过 readiness 动态发现，不硬编码 CodeNow Wiki 或固定端口。
- Tab、运行时和预览会话分离：同一 Local App 可被多个视图复用，关闭一个视图不应误停仍被使用的运行时。
- 信任是自动执行本地代码的前置条件；安全边界未完成验证时，产品文案必须如实限定为“受信任本地运行”。

## 成功判断

目标值待实现与验证阶段确定，首期至少观察以下结果：用户能从 `New Tab` 完成绑定并在无需手动命令的情况下看到首个页面；重启 AgentOS 后已信任 Tab 能恢复；同一 Local App 不重复启动开发服务器；失败原因可读且有恢复动作；关闭最后一个调用方后受管进程可回收。

## 关联文档

- [`design.md`](design.md)：产品对象、信息架构、主旅程与交互状态。
- [`technical.md`](technical.md)：Runtime、Desktop Seam、预览与安全边界的实现上下文。
- [`acceptance.md`](acceptance.md)：唯一验收契约事实源（由后续方案同步建立，初始为未实现）。
- [`TODO.md`](../../TODO.md)：开发任务、Later 范围与未完成差距。
- [`workspace-session`](../workspace-session/README.md)：工作区持久化与恢复能力的关联模块。
