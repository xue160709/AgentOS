# 桌面外壳、设置与发布验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：Electron 主窗口提供桌面宿主
系统 SHALL 创建主 BrowserWindow，配置默认尺寸、最小尺寸、标题栏、平台窗口 chrome、外链处理和 single instance 行为。

#### 场景：第二个实例启动
- GIVEN 用户再次启动应用且已有实例运行
- WHEN Electron 收到 second-instance 事件
- THEN 系统聚焦已有窗口而不是创建独立工作区实例

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: npm run typecheck

#### 场景：Windows 窗口 chrome
- GIVEN 应用运行在 Windows 平台
- WHEN 创建主窗口
- THEN 系统使用 hidden titlebar overlay chrome，并保持工作区 header 不成为全局拖拽区域

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/window-chrome.test.mjs

### 需求：preload API 暴露受控桌面能力
系统 SHALL 通过 preload 暴露 `window.desktop` 和 `window.claudeChat`，用于项目选择、文件上下文、桌面偏好、语音、更新和聊天运行。

#### 场景：渲染层请求选择项目
- GIVEN 用户点击添加项目
- WHEN 渲染层需要打开目录选择器
- THEN 渲染层通过 `window.desktop.pickProjectDirectory()` 调用主进程目录选择器

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=button[name="添加项目"]

#### 场景：桌面 seam 不泄漏通用 IPC
- GIVEN preload 已加载
- WHEN 测试检查暴露到 window 的 API
- THEN 系统只暴露命名 adapter，不暴露 `ipcRenderer.invoke/send/on/off`

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/desktop-seam.test.mjs

### 需求：桌面偏好持久化并影响宿主行为
系统 SHALL 保存 close-to-tray、open-at-login、eye comfort 和 locale 偏好，并同步影响托盘、登录项、渲染层 class 和语言初始化。

#### 场景：启用 close-to-tray
- GIVEN 用户开启 close-to-tray 偏好
- WHEN 用户关闭主窗口
- THEN 系统隐藏窗口到托盘，而不是退出应用

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=switch[name="关闭到托盘"]

#### 场景：读取非法 locale
- GIVEN 本地语言偏好不是 `zh` 或 `en`
- WHEN 应用初始化 UI 语言
- THEN 系统回退到有效默认语言，并保持翻译缺失时英文兜底

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: npm run typecheck

### 需求：自动更新只在 packaged 环境启用
系统 SHALL 在 packaged 环境启动后自动检查更新，并支持手动检查、下载状态、下载完成和安装入口；开发环境 SHALL 返回不支持更新。

#### 场景：开发环境检查更新
- GIVEN 应用在开发运行时
- WHEN 用户点击检查更新
- THEN 系统返回 `updatesSupported: false`

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=button[name="检查更新"]

#### 场景：下载完成安装更新
- GIVEN packaged 环境已下载更新且状态为 downloaded
- WHEN 用户点击安装更新
- THEN 系统执行 quitAndInstall 前先清理窗口、语音和文件 watcher 生命周期

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: npm run build:local

### 需求：macOS 语音 helper 作为独立 bundle 运行
系统 SHALL 在 macOS 通过 LaunchServices 启动 Apple Speech helper `.app`，用 Unix domain socket 接收 status、partial、final 和 error 事件。

#### 场景：用户开始语音输入
- GIVEN 用户在 macOS 上点击语音按钮且 helper 可用
- WHEN 语音服务发送 partial/final 事件
- THEN Composer 将识别文本写入当前输入框选区对应的 draft range

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=button[name="语音输入"]

#### 场景：用户拒绝语音权限
- GIVEN helper 请求 Speech Recognition 或 Microphone 权限被拒绝
- WHEN helper 返回 error 事件
- THEN 主进程推送 error 事件并将语音状态置为 error

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: npm run typecheck

## 平台专项验证（Electron + native helper）

- 验证开发环境不触发真实更新下载。
- 验证 packaged 构建包含 speech helper extraResources。
- 验证 macOS、Windows、Linux 构建配置差异。

## 建议验证命令

```bash
npm run typecheck
node --test electron/desktop-seam.test.mjs electron/window-chrome.test.mjs
# 发布或打包前按需运行 npm run build:local
```

