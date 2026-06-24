# 桌面外壳、设置与发布

## 模块定位

桌面外壳、设置与发布模块负责 Electron 宿主能力、全局设置、托盘/窗口行为、macOS 语音 helper、自动更新和打包发布配置。

## 当前已实现

- 主窗口配置默认尺寸、最小尺寸、标题栏、平台窗口 chrome、外链处理和 single instance 行为。
- preload 暴露 `window.desktop` 与 `window.claudeChat`，不暴露通用 `ipcRenderer`。
- 设置页包含模型、搜索、MCP、Project Skills、Agent Mode USER/IDENTITY、更新和开发者入口。
- 全局“搜索”设置页可选择原生 Web Search 或 AgentOS 搜索 Provider，并配置 DuckDuckGo Instant Answer、Brave Search、Tavily、默认结果数和 Provider Key 引用。
- 桌面偏好保存 close-to-tray、open-at-login、eye comfort 和 locale，并影响托盘、登录项、渲染 class 与语言。
- GitHub Releases 自动更新只在 packaged 环境启用，支持检查、下载、下载完成和安装入口。
- macOS Apple Speech helper 通过独立 `.app` 和 Unix socket 传输 status/partial/final/error。
- 构建配置覆盖 macOS、Windows、Linux，并包含 macOS hardened runtime、entitlements 和 Speech helper 资源。

## 用户流程

```text
1. 用户启动 AgentOS 桌面应用
   ↓
2. Electron 主进程创建窗口、托盘和受控 IPC
   ↓
3. 用户在设置页修改偏好、语言、模型和更新选项
   ↓
4. packaged 环境可检查更新并安装新版本
```

## 还没做什么

- 发布/打包和自动更新需要在 release 场景下单独正式验收。
- macOS 语音权限失败、helper 缺失和 packaged resource 路径需要补更多证据。
- 搜索 Provider 暂无保存前连接测试；DuckDuckGo 空结果、Tavily/Brave 配额或认证错误需要更明确的恢复提示。
- MCP 设置的复制、删除确认、无项目空态和字段级连接测试仍需补齐。

## 关键决策

- 开发环境不启用自动更新，返回 `updatesSupported: false`。
- 语音识别拆成原生 helper，避免把系统权限和长生命周期塞进渲染层。
- MCP 不放入全局模型设置主表单；全局设置提供独立 MCP Tab 管理 server 定义和总开关，项目 Agent 设置只保存本项目开关覆盖和 tool policy。
- 搜索也从模型设置中独立出来作为全局设置页；原生 Web Search 保持默认路径，AgentOS Provider 只在用户显式切换后接管运行时 `WebSearch`。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `agentos`：提供桌面工作台全局宿主。
- `model-settings`：设置页承载 Provider 配置，并与 MCP 工具配置保持边界。
- `chat-agent-runtime`：使用语音输入和受控聊天 IPC。
- `agent-mode`：项目 Agent 设置承载 MCP 开关覆盖、运行状态和 tool policy。
- `chat-agent-runtime`：读取全局搜索设置并决定 WebSearch runtime 路由。
