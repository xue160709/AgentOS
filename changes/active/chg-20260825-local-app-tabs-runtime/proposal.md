---
change_id: chg-20260825-local-app-tabs-runtime
revision: 1
decision: accepted
delivery: not_started
owner: main_agent
---

# 左侧 Local App New Tab 与 CodeNow Wiki 自动运行

## 原因

AgentOS 当前侧栏只组织项目和聊天线程，项目首页则由 Home Plugin/A2UI 卡片承载。用户希望新增一种浏览器式 Local App Tab：绑定本地 Web 项目后，AgentOS 自动执行开发命令并在 Tab 内渲染站点，无需用户打开终端或手动运行 `npm run dev`。`/Volumes/macOS/Github/codenow.wiki` 是首个端到端接入实例。

## 范围

- 在左侧侧栏提供 `New Tab` 入口，创建并激活 Local App Tab。
- 首次接入允许用户选择并确认信任一个本地文件夹；首个实例绑定 `/Volumes/macOS/Github/codenow.wiki`。
- AgentOS 持久化 Local App 定义、Tab 与活动选择，并在应用恢复时自动启动已信任应用。
- AgentOS 在 Local App 根目录自动执行 `npm run dev`；依赖缺失或 lockfile 变化时进入可观察的依赖准备流程。
- 启动成功后在隔离预览容器中加载本地 React/Next.js 网站，并支持 HMR、刷新、重启、关闭和错误恢复。
- Tab、运行时和预览三者分离：多个视图可复用同一 Local App Runtime，关闭最后一个调用方后按生命周期策略停止进程。
- 建立可复用的 Local App Runtime seam，供后续项目首页开发模式复用。
- 明确首期安全状态：只有用户已确认信任的本地目录才可自动运行；生产级“项目外不可访问”声明必须等待真实 OS 沙箱 Provider 验证。

## 非目标

- 本轮不改造项目首页为左右 Claude 开发工作台。
- 本轮不接入 Claude Agent SDK 的沙箱文件/命令工具代理。
- 本轮不实现 A2UI/Home Plugin 定制，也不把 CodeNow Wiki 写成专用页面组件。
- 本轮不支持远程 URL 书签、云端部署、多用户共享或公开预览。
- 本轮不承诺未经验证的跨平台强沙箱；普通 `cwd`、路径校验、Electron renderer sandbox 或 `utilityProcess` 不能被描述为 OS 文件系统沙箱。

## 验收

- 用户可从侧栏创建 Local App Tab，选择并确认信任 CodeNow Wiki 文件夹。
- AgentOS 自动执行 CodeNow Wiki 的 `npm run dev`，探测真实就绪地址并在 Tab 中显示站点。
- 退出并重新启动 AgentOS 后，Tab 与绑定仍存在，运行时自动恢复，无需用户再次运行命令。
- 启动中、依赖准备、运行中、失败、重试、目录缺失和停止均有可观察状态。
- 同一 Local App 的多个视图不重复启动开发服务器；关闭最后一个调用方后进程树可回收。
- 预览内容不能直接访问 Electron/Node 能力，不能创建未受控窗口或导航到未授权目标。
- 完整契约同步到 `prd/local-app-runtime/acceptance.md`，状态初始为 `⬜ 未实现`。

## 决策与风险

- `New Tab` 是入口，`Local App Runtime` 是底层能力；项目首页后续只复用，不另建运行时。
- 启动命令由 AgentOS 管理。Local App 接入完成后，用户不需要选择或手动执行 `npm run dev`。
- CodeNow Wiki 当前已核实存在 `package.json`，`dev` 脚本为 `next dev`；端口不得硬编码，应由运行时探测。
- 自动运行任意项目脚本等价于执行不可信代码。首期只能对显式信任目录自动启动；强隔离 Provider 是正式对外开放前的阻断项。
- 真正的跨平台 OS 沙箱方案仍需 PoC 裁决。架构必须先抽象 `SandboxAdapter`，避免把临时本机子进程实现冒充安全边界或写死进 UI。
