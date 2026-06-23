# Agent Mode

## 模块定位

Agent Mode 模块把一个本地项目初始化为 Agent 可以长期协作的工作空间，维护项目级指令、身份、记忆、TODO 模式和运行时上下文注入。

## 当前已实现

- 可按项目路径保存 Agent Mode 启停、TODO 模式、USER/IDENTITY 文案、项目默认模型和 Skill 模型覆盖。
- 启用时会幂等补齐 `CLAUDE.md`、`AGENT.md`、`SOUL.md`、`MEMORY.md`、`memory/`，TODO 模式开启时补 `TODO.md`。
- 只更新 AgentOS 管理的标记块，保留用户自定义内容。
- 运行聊天时会读取 Agent Mode 指令、项目灵魂、记忆、USER/IDENTITY 和 TODO 上下文。
- 项目首页 Agent 设置模态提供项目、Context、常规、卡片顺序和 Skills 面板。
- Skills 面板按 `skill.path` 保存模型覆盖。

## 用户流程

```text
1. 用户在项目首页启用 Agent Mode
   ↓
2. 系统补齐项目指令、记忆和可选 TODO 文件
   ↓
3. 用户在设置模态编辑项目文档、Context 和模型覆盖
   ↓
4. 后续聊天自动注入项目上下文
```

## 还没做什么

- 当前 Agent Mode 文件生成和设置保存有代码实现，但缺 UI 端正式验收截图。
- `AGENT.md` 与当前仓库 `AGENTS.md` 事实源口径需要在产品层继续统一解释。
- 项目级 MCP 设置尚未实现：需要在 Agent 设置中新增 MCP 面板，支持 server 配置、环境变量引用、连接测试、工具权限策略和错误恢复。

## 关键决策

- Agent Mode 设置保存在 userData，项目文件只承载用户可见指令和记忆。
- TODO 模式可以独立启停，关闭时只移除 AgentOS 管理内容。
- MCP 配置应优先按项目保存，而不是混入全局模型 Provider；不同项目通常需要不同数据库、代码托管、浏览器或内部服务工具。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `chat-agent-runtime`：运行时读取并注入 Agent Mode 上下文；后续消费项目 MCP 配置并把 server 状态、tool 调用和权限结果反馈到 Chat。
- `file-context`：提供项目文档和 Context 面板文件能力。
- `model-settings`：提供项目默认模型和 Skill 覆盖候选。
