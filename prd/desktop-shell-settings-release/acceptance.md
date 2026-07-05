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

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run typecheck + source audit（single-instance lock）｜证据: TESTING_CHECKLIST.md｜

#### 场景：Windows 窗口 chrome
- GIVEN 应用运行在 Windows 平台
- WHEN 创建主窗口
- THEN 系统使用 hidden titlebar overlay chrome，并保持工作区 header 不成为全局拖拽区域

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron（window-chrome）｜证据: TESTING_CHECKLIST.md｜

### 需求：preload API 暴露受控桌面能力
系统 SHALL 通过 preload 暴露 `window.desktop` 和 `window.claudeChat`，用于项目选择、文件上下文、桌面偏好、语音、更新和聊天运行。

#### 场景：渲染层请求选择项目
- GIVEN 用户点击添加项目
- WHEN 渲染层需要打开目录选择器
- THEN 渲染层通过 `window.desktop.pickProjectDirectory()` 调用主进程目录选择器

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=button[name="添加项目"]｜验证方式: npm run test:electron + Chrome headless preview smoke｜证据: TESTING_CHECKLIST.md｜

#### 场景：桌面 seam 不泄漏通用 IPC
- GIVEN preload 已加载
- WHEN 测试检查暴露到 window 的 API
- THEN 系统只暴露命名 adapter，不暴露 `ipcRenderer.invoke/send/on/off`

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron（desktop-seam）｜证据: TESTING_CHECKLIST.md｜

### 需求：桌面偏好持久化并影响宿主行为
系统 SHALL 保存 close-to-tray、open-at-login、eye comfort 和 locale 偏好，并同步影响托盘、登录项、渲染层 class 和语言初始化。

#### 场景：启用 close-to-tray
- GIVEN 用户开启 close-to-tray 偏好
- WHEN 用户关闭主窗口
- THEN 系统隐藏窗口到托盘，而不是退出应用

> 实现状态：⚠️ 跳过（project-verify 2026-06-24）｜验证方式: manual GUI check + npm run audit:omni-manual-readiness（9/9 readiness）｜原因: 需真实 Electron 托盘与窗口关闭事件，当前无 GUI 自动化可可靠确认系统托盘行为｜用户本地验证步骤: 打开 Electron 应用，开启“关闭到托盘”，点击窗口关闭按钮，确认主窗口隐藏且托盘图标可恢复窗口。｜证据: TESTING_CHECKLIST.md｜

#### 场景：读取非法 locale
- GIVEN 本地语言偏好不是 `zh` 或 `en`
- WHEN 应用初始化 UI 语言
- THEN 系统回退到有效默认语言，并保持翻译缺失时英文兜底

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run typecheck + source audit（invalid locale fallback）｜证据: TESTING_CHECKLIST.md｜

### 需求：自动更新只在 packaged 环境启用
系统 SHALL 在 packaged 环境启动后自动检查更新，并支持手动检查、下载状态、下载完成和安装入口；开发环境 SHALL 返回不支持更新。

#### 场景：开发环境检查更新
- GIVEN 应用在开发运行时
- WHEN 用户点击检查更新
- THEN 系统返回 `updatesSupported: false`

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=button[name="检查更新"]｜验证方式: npm run typecheck + source audit（development updater disabled state）｜证据: TESTING_CHECKLIST.md｜

#### 场景：下载完成安装更新
- GIVEN packaged 环境已下载更新且状态为 downloaded
- WHEN 用户点击安装更新
- THEN 系统执行 quitAndInstall 前先清理窗口、语音和文件 watcher 生命周期

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run build:local + source audit（downloaded update cleanup before quit）｜证据: TESTING_CHECKLIST.md｜

### 需求：macOS 语音 helper 作为独立 bundle 运行
系统 SHALL 在 macOS 通过 LaunchServices 启动 Apple Speech helper `.app`，用 Unix domain socket 接收 status、partial、final 和 error 事件。

#### 场景：用户开始语音输入
- GIVEN 用户在 macOS 上点击语音按钮且 helper 可用
- WHEN 语音服务发送 partial/final 事件
- THEN Composer 将识别文本写入当前输入框选区对应的 draft range

> 实现状态：⚠️ 跳过（project-verify 2026-06-24）｜验证方式: manual GUI check + npm run audit:omni-manual-readiness（9/9 readiness）｜原因: 需真实 macOS 语音/麦克风权限与 speech helper 事件，当前沙箱无法触发系统权限弹窗｜用户本地验证步骤: 打开 Electron 应用，点击“语音输入”，授权麦克风/语音识别，确认输入框收到转写文本。｜证据: TESTING_CHECKLIST.md｜

#### 场景：用户拒绝语音权限
- GIVEN helper 请求 Speech Recognition 或 Microphone 权限被拒绝
- WHEN helper 返回 error 事件
- THEN 主进程推送 error 事件并将语音状态置为 error

> 实现状态：⚠️ 跳过（project-verify 2026-06-24）｜验证方式: manual GUI check + npm run audit:omni-manual-readiness（9/9 readiness）｜原因: 需真实 macOS 权限拒绝状态，当前沙箱无法重置并触发系统权限拒绝分支｜用户本地验证步骤: 在系统设置中拒绝应用麦克风/语音识别权限，点击“语音输入”，确认页面显示权限恢复提示。｜证据: TESTING_CHECKLIST.md｜

### 需求：设置导航提供 MCP 入口与恢复路径
系统 SHALL 在全局设置、项目 Agent 设置和 Chat 状态面板之间提供一致的 MCP 设置入口，且在没有活动项目时展示可恢复空态。

#### 场景：从 Chat 状态面板进入当前项目 MCP 设置
- GIVEN 用户已打开一个项目且 Agent 状态面板显示 MCP server 状态
- WHEN 用户点击“去 MCP 设置”入口
- THEN 系统打开该项目的 Agent 设置模态，并激活 MCP 面板

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run build:local + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

#### 场景：无活动项目时进入 MCP 设置
- GIVEN 当前没有活动项目或项目路径不可用
- WHEN 用户从全局设置页或状态面板尝试进入 MCP 设置
- THEN 系统不打开空白配置页，而是提示先打开项目或选择项目

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run build:local + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

### 需求：全局设置提供搜索路由配置
系统 SHALL 在全局设置中提供独立的搜索设置页，让用户选择 Claude Agent 的 WebSearch 使用原生能力或 AgentOS 搜索 Provider。

#### 场景：打开全局搜索设置
- GIVEN 用户在全局设置侧栏中看到搜索分类
- WHEN 用户点击“搜索”
- THEN 系统打开搜索设置页，展示原生 Web Search 与 AgentOS 搜索 Provider 两种模式，并说明该设置影响 Agent 运行时联网搜索

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: browser smoke｜证据: TESTING_CHECKLIST.md｜

#### 场景：配置 AgentOS 搜索 Provider
- GIVEN 用户在搜索设置页选择 AgentOS 搜索 Provider
- WHEN 用户选择 DuckDuckGo Search、Brave Search 或 Tavily
- THEN 系统展示对应 Provider 的配置要求，Brave 与 Tavily 展示 API Key/环境变量输入，DuckDuckGo 展示无需 Key 的提示

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: browser smoke｜证据: TESTING_CHECKLIST.md｜

#### 场景：保存搜索设置
- GIVEN 用户修改搜索模式、Provider 或 Provider Key 引用
- WHEN 用户点击保存搜索设置
- THEN 系统通过受控 preload IPC 保存全局搜索设置，并在页面展示保存成功或可读错误，不泄漏 API Key 明文

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: browser smoke｜证据: TESTING_CHECKLIST.md｜

#### 场景：重新加载搜索设置
- GIVEN 用户已保存搜索模式、Provider 和 Provider Key 引用
- WHEN 用户重新打开全局搜索设置页或应用重新读取设置文件
- THEN 系统展示上次保存的搜索设置，并将非法 Provider 和多余空白 Key 归一化为安全值

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：搜索设置 bridge 不可用
- GIVEN 渲染层缺少 `window.desktop.getGlobalWebSearchSettings` 或 `window.desktop.saveGlobalWebSearchSettings`
- WHEN 用户打开或保存搜索设置
- THEN 页面展示可读 bridge 不可用提示，不尝试调用通用 IPC，也不丢失当前草稿状态

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: browser smoke｜证据: TESTING_CHECKLIST.md｜

#### 场景：Provider Key 使用环境变量引用
- GIVEN 用户在 Brave 或 Tavily Key 输入框填写 `${ENV_NAME}` 引用
- WHEN 用户保存搜索设置并启动下一轮 Agent 请求
- THEN 设置文件保存引用文本，运行时只在主进程环境中解析该引用，UI、日志和状态摘要不展示解析后的 Key 明文

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: browser smoke + npm run test:electron｜证据: TESTING_CHECKLIST.md｜

#### 场景：配置 Provider API Key 池
- GIVEN 用户在搜索设置页选择 AgentOS 搜索 Provider，并选择 Brave Search 或 Tavily
- WHEN 用户新增、删除或重排 Provider API Key 条目
- THEN 页面以列表形式展示 Key 池，保留用户定义的优先级顺序，每个条目支持明文 Key 或 `${ENV_NAME}` 引用，并为新增、删除、上移、下移和 Key 输入提供稳定可访问控件

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: [data-testid="web-search-key-pool"]｜证据: test-results/verification-summary.md｜

#### 场景：保存并重载 Provider API Key 池
- GIVEN 用户已为 Brave Search 或 Tavily 配置多个 Provider API Key 条目
- WHEN 用户保存搜索设置并重新打开全局搜索设置页或应用重新读取设置文件
- THEN 系统通过受控 preload IPC 保存 Key 池数组，并按原顺序展示；旧版单 Key 配置会迁移为单元素 Key 池，空白条目会被归一化移除，日志和状态摘要不展示 Key 明文

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: [data-testid="web-search-settings-save"]｜证据: test-results/verification-summary.md｜

#### 场景：测试 Provider API Key 池
- GIVEN Brave Search 或 Tavily 配置了多个 Provider API Key 条目，且至少一个条目可用
- WHEN 用户点击 Test Provider
- THEN 系统按 Key 池顺序测试并在首个成功 Key 返回时展示连接成功；若前置 Key 失败，结果文案说明已尝试后续 Key，但不展示 Key 明文

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: [data-testid="web-search-provider-test-status"]｜证据: test-results/verification-summary.md｜

## 平台专项验证（Electron + native helper）

- 验证开发环境不触发真实更新下载。
- 验证 packaged 构建包含 speech helper extraResources。
- 验证 macOS、Windows、Linux 构建配置差异。
- 验证 MCP 设置跳转不会跨项目写入，也不会在没有活动项目时创建孤立配置。
- 验证搜索设置通过命名 preload adapter 暴露，不泄漏通用 IPC；Brave/Tavily Key 不进入日志或状态摘要明文。

## 建议验证命令

```bash
npm run typecheck
node --test electron/desktop-seam.test.mjs electron/window-chrome.test.mjs
# 发布或打包前按需运行 npm run build:local
```
