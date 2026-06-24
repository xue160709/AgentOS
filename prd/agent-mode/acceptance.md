# Agent Mode 验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：Agent Mode 按项目路径保存启停状态
系统 SHALL 以项目根路径为键保存 Agent Mode 的 `enabled`、`todoEnabled`、USER/IDENTITY、项目默认模型和 Skill 模型覆盖。

#### 场景：启用项目 Agent Mode
- GIVEN 用户在项目首页打开 Agent Mode 控制入口
- WHEN 用户启用 Agent Mode
- THEN 系统保存该项目启用状态，并确保所需项目文件存在

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=switch[name="Agent Mode"]

#### 场景：保存 Skill 模型覆盖
- GIVEN 项目存在可发现的 Skill 且模型设置中存在可用模型
- WHEN 用户在 Skills 面板为该 Skill 选择模型并保存
- THEN 系统按 `skill.path` 保存 `ChatModelPick` 覆盖

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=combobox[name="Skill 模型"]

### 需求：Agent Mode 文件维护必须幂等
系统 SHALL 创建或更新 `CLAUDE.md`、`AGENT.md`、`SOUL.md`、`MEMORY.md`、`memory/` 和可选 `TODO.md`，且 MUST NOT 覆盖用户在标记块外的内容。

#### 场景：重复启用 Agent Mode
- GIVEN 项目已存在用户自定义的 Agent Mode 文件
- WHEN 用户再次执行文件初始化
- THEN 系统仅更新 AgentOS 管理的标记块或缺失文件，并保留用户自定义内容

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: npm run typecheck

#### 场景：关闭 TODO 模式
- GIVEN 项目已开启 TODO 模式
- WHEN 用户关闭 TODO 模式
- THEN 系统移除 TODO 管理标记块和 `TODO.md`，但保留其它 Agent Mode 文件

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜selector: role=switch[name="TODO 模式"]

### 需求：运行时注入 Agent Mode 上下文
系统 SHALL 在 Agent Mode 未显式关闭时加载 Agent 指令、项目灵魂、记忆、USER/IDENTITY 和 TODO 相关上下文并注入聊天运行。

#### 场景：Agent Mode 项目运行聊天
- GIVEN 当前项目启用了 Agent Mode
- WHEN 用户在该项目中提交聊天
- THEN 主进程构造 Agent 上下文时包含该项目的指令、灵魂、记忆和用户/身份文案

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: npm run typecheck

#### 场景：上下文目录扫描失败
- GIVEN 项目上下文目录不可读或不存在
- WHEN 系统构建运行时上下文
- THEN 系统返回空 catalog fallback，不阻断普通聊天提交

> 实现状态：⚠️ 跳过（初始 PRD 同步 2026-06-23，待 project-verify）｜验证方式: npm run typecheck

### 需求：项目 Agent 设置提供 MCP 配置面板
系统 SHALL 在项目 Agent 设置中提供 MCP 面板，用于选择当前项目启用哪些全局 MCP server、查看连接状态并管理项目级工具权限策略。

#### 场景：项目独立启用或关闭全局 MCP server
- GIVEN 全局设置中已存在并启用一个 MCP server
- WHEN 用户在项目 Agent 设置的 MCP 面板切换该 server 并保存
- THEN 系统只保存当前项目的 `mcpServerOverrides`，不修改全局 MCP server 定义或全局开关

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md

#### 场景：展示已配置服务状态与启用开关
- GIVEN 用户已在全局设置中启用一个或多个 MCP server
- WHEN 用户打开项目 Agent 设置的 MCP 面板
- THEN 面板展示 Installed MCP Servers 列表，每个 server 显示启用开关、当前连接状态、失败原因或工具数量；应用不会在保存配置时自动预安装 MCP server

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md

#### 场景：全局关闭后项目隐藏 MCP server
- GIVEN 某个 MCP server 在全局设置中被关闭
- WHEN 用户打开任一项目的 MCP 面板
- THEN 该 server 不出现在项目 MCP 列表中，也不会传入 Claude Agent SDK runtime options

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md

#### 场景：环境变量未解析
- GIVEN 用户配置的 MCP server 使用 `${ENV_NAME}` 引用密钥或连接串
- WHEN 系统测试连接时发现该环境变量不存在
- THEN MCP 面板在对应字段附近显示未解析状态，不启动有效工具调用，并提供可修复的错误提示

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run build + MCP selector audit｜证据: TESTING_CHECKLIST.md

#### 场景：配置工具权限策略
- GIVEN 某个 MCP server 已连接并返回工具列表
- WHEN 用户把某个工具设置为“自动允许”或“禁用”并保存
- THEN 系统按完整 `mcp__server__tool` 名称保存该项目的 tool policy，且不会影响其它项目

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md

## 平台专项验证（Electron + React）

- 验证文件写入只影响项目根目标文件和 AgentOS 标记块。
- 验证 USER/IDENTITY 设置不泄漏到其它项目。
- 验证项目默认模型和 Skill 覆盖按回退顺序生效。
- 验证 MCP server 定义只在全局保存，项目只保存 `mcpServerOverrides` 与 tool policy；日志和状态摘要不得输出 token、API key、完整 header 或连接串明文。

## 建议验证命令

```bash
npm run typecheck
# 建议补充 agent-mode-files fixture 单测后纳入 npm run test:electron
```
