# 桌面外壳、设置与发布

## 模块定位

桌面外壳、设置与发布模块负责 Electron 宿主能力、全局设置、托盘/窗口行为、macOS 语音 helper、自动更新和打包发布配置。

## 当前已实现

- 主窗口配置默认尺寸、最小尺寸、标题栏、平台窗口 chrome、外链处理和 single instance 行为。
- preload 暴露 `window.desktop` 与 `window.claudeChat`，不暴露通用 `ipcRenderer`。
- 设置页包含模型、Project Skills、Agent Mode USER/IDENTITY、更新和开发者入口。
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
- 设置导航尚未覆盖 MCP：后续需要明确全局设置页与项目 Agent 设置之间的入口关系，让用户能从 Chat/状态面板进入当前项目 MCP 设置。

## 关键决策

- 开发环境不启用自动更新，返回 `updatesSupported: false`。
- 语音识别拆成原生 helper，避免把系统权限和长生命周期塞进渲染层。
- MCP 是项目级工具能力，不放入全局模型设置主表单；全局设置可以保留说明或跳转，但具体 server 配置应落在项目 Agent 设置模态。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `agentos`：提供桌面工作台全局宿主。
- `model-settings`：设置页承载 Provider 配置，并与 MCP 工具配置保持边界。
- `chat-agent-runtime`：使用语音输入和受控聊天 IPC。
- `agent-mode`：项目 Agent 设置承载后续 MCP 配置入口。
