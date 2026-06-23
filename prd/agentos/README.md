# 产品总览

## 模块定位

产品总览模块定义 AgentOS 的全局产品边界：它不是一次性聊天窗口，而是围绕本地项目文件夹组织长期 Agent 协作的桌面工作台。

## 当前已实现

- 应用以本地项目为工作单位，项目、线程、文件上下文、卡片、任务和 Agent Mode 均归属到项目。
- Electron 主进程负责本地文件、Agent 运行、桌面偏好、语音和更新等原生能力；渲染层通过受控 preload API 调用。
- UI 支持中文和英文，产品元数据、设置、About 和发布信息共用应用配置。
- README、OpenSpec 基线和代码模块已形成一致的 10 个产品能力边界。

## 用户流程

```text
1. 用户打开 AgentOS
   ↓
2. 选择或恢复一个本地项目
   ↓
3. 在同一项目工作台中使用聊天、文件、卡片、任务和 Agent Mode
```

## 还没做什么

- 产品级 PRD 已补齐，但尚未执行正式 `project-verify`。
- 当前 `TODO.md` 仍偏 agentic runtime 优化，需要后续整理成产品 backlog。

## 关键决策

- 以本地文件夹作为 Agent 的运行边界，避免把项目资料搬离用户机器。
- 原生能力集中在 Electron 主进程，渲染层只拿到命名能力，不暴露通用 IPC。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `workspace-session`：承载项目与线程工作区。
- `desktop-shell-settings-release`：承载桌面宿主与原生能力。
- `chat-agent-runtime`：承载 Agent 运行主链路。

