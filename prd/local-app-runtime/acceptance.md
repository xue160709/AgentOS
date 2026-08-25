# Local App Runtime 验收契约

> 唯一验收事实源。当前为 `chg-20260825-local-app-tabs-runtime@1` 方案同步，所有场景初始为 `⬜ 未实现`；后续仅由 `project-verify` 产生正式验收证据并回写状态。
>
> 项目首页 Claude 分栏、Agent 沙箱工具代理和生产级 OS Sandbox Provider 不属于本切片通过条件。

## 追踪矩阵

| 确认项 | 开发任务 | ATDD 来源 |
| --- | --- | --- |
| `C-001` | `DEV-P0-01` | `ATDD-P0-01` |
| `C-002` | `DEV-P0-02` | `ATDD-P0-02` |
| `C-003` | `DEV-P0-03` | `ATDD-P0-03` |
| `C-004` | `DEV-P1-01` | `ATDD-P1-01` |
| `C-005` | `DEV-P1-02` | `ATDD-P1-02` |

## C-001：侧栏创建 Local App Tab

系统 SHALL 从侧栏 `New Tab` 创建、选择、激活、关闭和恢复 Local App Tab；首次绑定本地目录时，只有用户明确确认信任后才能持久化定义或启动项目。

### 场景：确认信任后创建并激活

- GIVEN 工作区存在项目或聊天线程，且用户选择了有效本地 Web 项目目录
- WHEN 用户点击 `New Tab`、选择 `Local App` 并确认信任
- THEN 系统持久化 `LocalAppDefinition` 和 `LocalAppTab`，激活新 Tab，且不破坏原有项目与线程状态

> 实现状态：⬜ 未实现｜selector: `data-testid="local-app-new-tab"`, `data-testid="local-app-trust-confirm"`｜验证方式：Workspace Session 单测 + UI 集成测试｜

### 场景：取消首次接入

- GIVEN 用户已选择目录但尚未确认信任
- WHEN 用户点击取消、关闭流程或按 `Escape`
- THEN 系统不启动命令，不创建定义或 Tab，不产生脏的工作区快照，并将焦点返回 `New Tab`

> 实现状态：⬜ 未实现｜验证方式：Workspace Session 状态与持久化结果检查｜

### 场景：关闭视图但保留定义

- GIVEN 同一 Local App 存在一个或多个 Tab
- WHEN 用户关闭其中一个 Tab
- THEN 系统只关闭该视图；活动选择落到仍存在的相邻 Tab 或安全现有视图；Local App 定义仍可再次打开

> 实现状态：⬜ 未实现｜验证方式：Workspace Session 单测 + UI 集成测试｜

### 场景：旧快照兼容恢复

- GIVEN 旧工作区快照没有 Local App 字段，或新增字段损坏
- WHEN AgentOS 恢复工作区
- THEN 原项目、线程和活动选择仍可读取，Local App 集合安全回退为空，且不自动启动运行时

> 实现状态：⬜ 未实现｜验证方式：旧快照迁移单测｜

## C-002：AgentOS 自动准备并运行 `npm run dev`

系统 SHALL 仅对已确认信任且通过目录、`package.json` 与 `dev` 脚本复核的项目，自动准备依赖（如需要）、运行固定命令 `npm run dev`，动态探测真实 loopback 就绪地址，并提供可读状态与恢复动作。

### 场景：受控 fixture 自动启动

- GIVEN 受控 fixture 具有有效 `package.json` 和 `scripts.dev`
- WHEN 用户确认信任或对已信任应用执行启动
- THEN AgentOS 自动进入依赖准备和启动流程，仅在进程存活且动态 readiness 成功后进入 `running`；用户无需手动运行命令，端口不得硬编码

> 实现状态：⬜ 未实现｜selector: `data-testid="local-app-runtime-status"`｜验证方式：受控 fixture 自动集成测试｜

### 场景：启动失败可读且可重试

- GIVEN fixture 缺少 `dev` 脚本、依赖准备失败、npm 不可用、进程提前退出或 readiness 超时
- WHEN AgentOS 尝试启动
- THEN 状态进入 `failed`，显示失败阶段、稳定错误摘要、最近日志和恢复动作，不把进程存活或旧端口误报为 `running`，也不无限重试

> 实现状态：⬜ 未实现｜selector: `data-testid="local-app-runtime-log"`, `data-testid="local-app-retry"`｜验证方式：Supervisor 失败分支集成测试｜

### 场景：失败后重试或停止

- GIVEN Local App 处于 `failed`、`preparing` 或 `starting`
- WHEN 用户点击重试，或在启动过程中点击停止/取消
- THEN 重试沿用已信任定义且不重复要求信任；停止/取消进入 `stopped`，旧任务和旧事件失效，不被后台自动重新拉起

> 实现状态：⬜ 未实现｜selector: `data-testid="local-app-retry"`, `data-testid="local-app-stop"`｜验证方式：取消、重试与 late event 集成测试｜

## C-003：CodeNow Wiki 首个真实接入

系统 SHALL 支持用户选择真实目录 `/Volumes/macOS/Github/codenow.wiki`，由 AgentOS 自动运行其 `npm run dev`，动态发现就绪地址并在 Local App Tab 中显示真实页面；不得把路径、页面或端口硬编码为专用实现。

### 场景：CodeNow Wiki live smoke 成功

- GIVEN `/Volumes/macOS/Github/codenow.wiki/package.json` 可读取，且 `scripts.dev` 为 `next dev`
- WHEN 用户在 AgentOS 中选择并确认信任该目录
- THEN AgentOS 自动准备并运行 `npm run dev`，通过动态 readiness 加载真实 CodeNow Wiki 页面；用户不需要手动启动，页面和端口均来自运行时探测

> 实现状态：⬜ 未实现｜selector: `data-testid="local-app-preview"`｜验证方式：真实 CodeNow Wiki live smoke；fixture 不得替代｜

### 场景：真实目录或脚本不可用

- GIVEN 目标目录缺失、权限不可用、`package.json` 缺失、`dev` 脚本缺失或依赖准备失败
- WHEN AgentOS 检查或启动该 Local App
- THEN 系统进入 `path_missing` 或分阶段 `failed`，保留可恢复绑定，并提供重新选择、重试或移除动作，且不启动未知目录

> 实现状态：⬜ 未实现｜验证方式：路径、脚本与依赖失败 live/integration smoke｜

## C-004：Tab、Runtime 与工作区恢复

系统 SHALL 持久化 Local App 定义、Tab 和活动选择；重新启动 AgentOS 时，已信任应用重新创建 Runtime、重新探测 readiness 并恢复预览，不盲信旧 PID、端口或就绪地址。同一应用的多个 Tab SHALL 复用一个 Runtime，关闭最后一个调用方后 SHALL 回收受管进程树。

### 场景：正常重启后自动恢复

- GIVEN 已信任 Local App 的定义、Tab 和活动选择已持久化，AgentOS 正常退出
- WHEN AgentOS 重新启动
- THEN Tab 和活动选择先恢复，随后重新校验目录与信任、创建新的 runtime generation、动态探测 readiness 并恢复预览，无需再次确认或手动运行命令

> 实现状态：⬜ 未实现｜验证方式：工作区恢复 + Runtime 集成测试｜

### 场景：同应用多视图复用 Runtime

- GIVEN 同一 canonical root 与启动配置已有两个 Local App Tab
- WHEN 用户打开、切换或关闭其中一个 Tab
- THEN 两个视图复用一个活动 Runtime，不重复启动开发服务器；关闭非最后一个调用方不停止 Runtime，关闭最后一个调用方后进入停止与回收流程

> 实现状态：⬜ 未实现｜验证方式：Runtime 去重与 consumer 生命周期集成测试｜

### 场景：恢复失败与旧事件隔离

- GIVEN 目录缺失、信任复核失败，或旧 Runtime 在重启/停止后仍发送事件
- WHEN AgentOS 恢复或收到旧 generation 事件
- THEN 定义和 Tab 保留在可恢复状态，显示 `path_missing` 或可读失败原因，旧事件不能改变新 Runtime、Tab 或 Preview 状态

> 实现状态：⬜ 未实现｜验证方式：generation/late event 集成测试｜

### 场景：应用退出清理

- GIVEN AgentOS 正在管理运行中的 Local App
- WHEN AgentOS 退出
- THEN 受管进程树、Preview 和 watcher 在有界时间内清理，不留下孤儿开发服务器

> 实现状态：⬜ 未实现｜验证方式：进程树/PID 退出检查｜

## C-005：Preview 受控承载与安全负例

系统 SHALL 在受控 Preview 中加载 Runtime 的就绪地址；Preview 不得获得可用的 Electron/Node 直连能力，并 SHALL 控制外部导航、窗口创建和权限请求。本条不构成 OS 文件系统或网络强沙箱承诺。

### 场景：正常预览与刷新/HMR

- GIVEN Runtime 已通过 readiness 并提供当前 generation 的 loopback 地址
- WHEN 系统创建或刷新 Preview
- THEN `local-app-preview` 显示 fixture 页面；刷新只刷新当前 Preview，不隐式重启 Runtime；HMR 断线时进入可观察的降级状态并可重新连接

> 实现状态：⬜ 未实现｜selector: `data-testid="local-app-preview"`｜验证方式：Electron Preview 集成测试｜

### 场景：Electron/Node 能力不可用

- GIVEN Preview 页面尝试访问 `window.desktop`、`ipcRenderer`、Node `require` 或 Electron 运行时对象
- WHEN 页面执行这些访问
- THEN 页面不能获得可用的 Electron/Node bridge，也不能通过页面直接执行宿主命令或 IPC

> 实现状态：⬜ 未实现｜验证方式：Electron 安全负例测试｜

### 场景：导航、弹窗和权限请求受控

- GIVEN Preview 页面尝试外部导航、`window.open`、创建新窗口或申请权限
- WHEN Preview 处理这些请求
- THEN 未授权请求被阻止或转为可观察错误，不创建未受控窗口，不离开当前 Runtime 的受控 loopback origin

> 实现状态：⬜ 未实现｜验证方式：Electron 导航、弹窗与权限安全负例测试｜

## 验证边界

- Fixture 自动测试验证通用 Runtime、状态转移、动态端口、失败恢复、generation、进程树和 Preview 安全负例。
- CodeNow Wiki live smoke 验证真实目录接入与真实页面显示，环境不可用时保持未验证，不能用 fixture 冒充。
- 生产 Sandbox Provider 是后续发布阻断项；项目外文件、网络、环境变量和子进程逃逸验证前不得宣称强隔离。
- 正式验收统一通过 `project-verify`，实现自检或本轮文档同步不能把任何场景标记为通过。

## 建议验证命令

```bash
npm run typecheck
node --test electron/workspace-session.test.mjs
node --test electron/desktop-seam.test.mjs
node --test electron/local-app-runtime/*.test.mjs
```
