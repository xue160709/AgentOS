# 产品总览验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：以本地项目为工作单位
系统 SHALL 以本地项目路径作为组织工作区、线程、Home Plugin、Task、Agent Mode 与文件上下文的主单位。

#### 场景：恢复有效活动项目
- GIVEN 应用已有一个有效的活动项目和工作区快照
- WHEN 用户启动 AgentOS
- THEN 系统展示该项目的首页或上次活动线程，并让后续会话、插件和任务归属该项目

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/workspace-session.test.mjs

#### 场景：空工作区首次启动
- GIVEN 工作区没有任何项目记录
- WHEN 用户进入 AgentOS 主界面
- THEN 系统提供选择本地项目目录的入口，并保持聊天、文件和卡片能力不可绑定到空项目

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=button[name="选择项目"]

### 需求：渲染层通过安全桥接访问原生能力
系统 SHALL 由 Electron 主进程统一处理本地文件、Agent 运行、桌面偏好、语音和更新等原生能力，渲染层 MUST 通过 preload 暴露的命名 API 调用。

#### 场景：渲染层没有通用 IPC
- GIVEN 应用加载 preload 脚本
- WHEN 验证 renderer 暴露的全局 API
- THEN `window.desktop` 和 `window.claudeChat` 可用，但通用 `ipcRenderer` 不暴露给 UI

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/desktop-seam.test.mjs

#### 场景：桌面能力注册漂移
- GIVEN `src/desktop-seam.ts` 定义一个新的桌面能力
- WHEN 运行桌面 seam 测试
- THEN preload forwarding 与 main registration 均必须覆盖该能力，否则测试失败

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: node --test electron/desktop-seam.test.mjs

## 平台专项验证（Electron + React）

- 验证渲染层不暴露任意 IPC。
- 验证外链由主进程转交系统浏览器。
- 验证 locale 只规范化为 `zh` 或 `en`。

## 建议验证命令

```bash
npm run typecheck
npm run test:electron
```

