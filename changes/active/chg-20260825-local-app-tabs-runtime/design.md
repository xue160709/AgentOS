# Local App New Tab 与运行时设计

## 1. 方案摘要

AgentOS 新增 Local App Tab。用户首次通过侧栏 `New Tab` 选择并信任本地 Web 项目；之后 AgentOS 在启动或恢复工作区时自动准备依赖、执行 `npm run dev`、探测就绪地址，并将站点显示在隔离预览容器中。CodeNow Wiki 是首个验证实例，但实现保持通用。

## 2. 产品目标与非目标

### 目标

- 用户只负责添加本地应用，不直接操作 npm 命令。
- Local App Tab 像浏览器 Tab 一样可创建、切换、刷新、关闭和恢复。
- 运行状态和失败原因在 Tab 内可见并可恢复。
- 同一运行时未来可被侧栏 Tab 与项目首页共同承载。

### 非目标

- 当前切片不实现项目首页 Claude 分栏。
- 当前切片不让生成页面获得 Electron/Node 直连能力。
- 当前切片不宣称普通本机子进程具备强沙箱隔离。

## 3. 核心原则

1. **自动运行**：持久化绑定完成后，AgentOS 负责 `npm run dev` 的全部生命周期。
2. **入口与运行时分离**：Tab 是视图，Runtime 是进程与预览资源，二者不是一对一。
3. **显式信任**：第一次绑定目录需要确认；恢复时只自动运行已信任定义。
4. **失败可见**：安装、启动、端口探测、崩溃与停止都必须有明确状态。
5. **安全不冒充**：未通过 OS 沙箱验证前，不把路径限制或 renderer sandbox 描述为完整运行时沙箱。

## 4. 产品对象与关系

- `LocalAppDefinition`：本地文件夹、包管理器、自动启动命令、信任状态和启动策略。
- `LocalAppTab`：侧栏和主内容区中的持久化视图入口。
- `RuntimeInstance`：某个 Local App 当前活动的进程组、就绪地址、generation 和状态。
- `PreviewSession`：加载 Runtime 输出的隔离浏览器视图。
- `RuntimeGrant`：目录、网络等授权；首期至少记录本地目录信任。

```text
LocalAppDefinition 1 ── 0..1 RuntimeInstance
        │                       │
        └── 1..n LocalAppTab ───┴── 1..n PreviewSession
```

## 5. 信息架构与入口

```text
侧栏 New Tab
  -> 选择 Local App
  -> 选择本地文件夹
  -> 信任确认
  -> 创建 Local App Tab
  -> 自动准备与启动
  -> 主内容区显示预览
```

侧栏需要把普通聊天线程与 Local App Tab 区分，但保持一致的选择、关闭和恢复行为。主内容区根据活动对象渲染 Chat、项目首页或 Local App Preview。

## 6. 主旅程

### 首次接入 CodeNow Wiki

1. 用户点击侧栏 `New Tab`。
2. 用户选择 `Local App` 并选中 `/Volumes/macOS/Github/codenow.wiki`。
3. AgentOS 展示将自动运行本地项目脚本的信任提示。
4. 用户确认后，系统创建定义与 Tab，读取 `package.json` 并确认存在 `dev` 脚本。
5. 系统必要时准备依赖，然后自动执行 `npm run dev`。
6. 系统探测就绪 URL，在隔离预览中显示 CodeNow Wiki。

### 应用恢复

```text
AgentOS 启动
  -> 恢复 Local App 定义与 Tab
  -> 校验目录与信任状态
  -> 自动启动 Runtime
  -> readiness 成功
  -> 恢复活动 Tab 预览
```

## 7. 用户可见状态

| 状态 | 用户看到什么 | 可执行动作 |
| --- | --- | --- |
| `unconfigured` | 选择本地项目 | 选择文件夹、取消 |
| `trust_required` | 自动运行脚本风险说明 | 信任并继续、取消 |
| `preparing` | 正在检查或准备依赖 | 查看日志、取消 |
| `starting` | 正在启动开发服务 | 查看日志、停止 |
| `running` | 站点预览 | 刷新、重启、关闭 Tab |
| `degraded` | 页面可见但部分进程异常 | 查看日志、重试 |
| `failed` | 可读错误和最近日志 | 重试、重新选择目录、移除 |
| `path_missing` | 原目录不可达 | 重新定位、移除 |
| `stopped` | 已停止 | 启动、移除 |

关闭 Tab 不应立即误杀仍被其他视图使用的 Runtime；关闭最后一个调用方后，Runtime 根据停止策略回收。

## 8. 确认项与保真矩阵

| 确认项 | 入口/触发 | 成功结果 | 失败/恢复 | 开发 | ATDD |
| --- | --- | --- | --- | --- | --- |
| `C-001` 左侧可创建 Local App Tab | 侧栏 New Tab | 新 Tab 激活 | 取消不留脏记录 | `DEV-P0-01` | `ATDD-P0-01` |
| `C-002` AgentOS 自动运行 `npm run dev` | 首次信任或应用恢复 | Runtime ready | 失败可读、可重试 | `DEV-P0-02` | `ATDD-P0-02` |
| `C-003` CodeNow Wiki 是首个接入项目 | 选择已知目录 | 页面在 Tab 中显示 | 路径/脚本缺失可恢复 | `DEV-P0-03` | `ATDD-P0-03` |
| `C-004` Tab 与运行时可恢复 | AgentOS 重启 | 自动启动并恢复选择 | 旧 PID/端口不被盲信 | `DEV-P1-01` | `ATDD-P1-01` |
| `C-005` 运行内容受隔离承载 | Preview 加载 | 无 Electron/Node 直连 | 导航/弹窗被阻止 | `DEV-P1-02` | `ATDD-P1-02` |

## 9. as-built 审计与复用

- 复用 `WorkspaceSession` 的 durable snapshot、revision 和恢复路径，但新增 Local App 对象与选择分支。
- 扩展 `AppShellSidebar` 的 New Tab 入口与列表渲染，不把 Local App 伪装成聊天线程。
- 扩展 `AppShellWorkspace` 的活动内容分发。
- 复用 Desktop Seam 的类型化 IPC 原则；运行时能力必须新增命名接口，不能向 renderer 暴露原始 IPC。
- 当前没有开发服务器、端口、进程树、预览视图或 Runtime 生命周期实现，属于新增系统能力。

## 10. 修改范围

范围为 `L`：新增核心对象、持久化状态、Electron 进程生命周期、预览容器与安全边界，并影响侧栏主旅程。首期通过单一 CodeNow Wiki 实例收窄验证面，但不能用专用硬编码替代通用模型。

## 11. 最小修改集

| 层/路径 | 当前能力 | 最小修改 | 类型 | 不改什么 |
| --- | --- | --- | --- | --- |
| `src/components/types.ts` | 项目与线程状态 | 新增 Local App 定义、Tab 与运行态引用 | 新增 | 不改变 ChatState 语义 |
| `src/components/workspace-session.ts` | 项目/线程生命周期 | 增加 Local App Tab 创建、选择、关闭、恢复 | 小改 | 不拆第二套工作区存储 |
| `src/chat-workspace-persistence.ts` | 快照归一化 | 持久化并迁移 Local App 字段 | 小改 | 旧快照继续可读 |
| `src/components/AppShellSidebar.tsx` | 项目与线程入口 | New Tab 与 Local App 列表/状态 | 小改 | 保留现有项目/线程能力 |
| `src/components/AppShellWorkspace.tsx` | 主内容路由 | 增加 Local App Preview 分支 | 小改 | 不改项目首页实现 |
| `src/desktop-*`、`electron/preload.ts` | 类型化 Desktop Seam | 新增 runtime IPC 与事件 | 小改 | 不暴露原始 ipcRenderer |
| `electron/local-app-runtime/` | 无 | Runtime Manager、Supervisor、Preview Gateway、Store、SandboxAdapter | 新增 | 不硬编码 CodeNow Wiki |
| `electron/main.ts` | 主窗口和 IPC | 装配运行时与退出清理 | 小改 | 不把项目代码加载进 main |

## 12. 一致性、恢复与安全

- 所有事件携带 `localAppId/runtimeId/generation`，旧 generation 事件不能覆盖新状态。
- 启动时不盲信持久化 PID 或端口，必须重新创建 Runtime 并探测 readiness。
- 进程崩溃采用有限次数退避；用户手动停止后不自动反复拉起。
- AgentOS 退出时回收受管进程树。
- 预览采用独立、无 Node 权限的 WebContents；限制导航、窗口创建和权限请求。
- Local App 进程不得继承完整宿主环境变量；强文件/网络隔离依赖后续真实 Sandbox Provider。

## 13. 未知与推荐默认值

- **未知**：生产 Sandbox Provider 选择（容器/微虚拟机/平台原生）。这是安全发布阻断项，不由本 PRD静默决定。
- **推荐默认**：体验验证阶段只允许显式信任的本地项目，并在 UI 中标明“受信任本地运行”；不得宣传项目外访问已被强制阻断。
- **推荐默认**：`codenow.wiki` 的 `npm run dev` 自动启动，端口从日志/readiness 动态发现。
- **推荐默认**：同一 canonical root + command 只创建一个 RuntimeInstance。

## 14. 完成定义

P0/P1 开发任务实现并完成自检；`prd/local-app-runtime/acceptance.md` 由后续 `project-verify` 逐项独立验证。项目首页 Claude 分栏和完整 Agent 沙箱工具代理保持在 Later，不阻塞当前切片。
