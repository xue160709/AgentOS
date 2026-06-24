# 模型与 Provider 设置

## 模块定位

模型与 Provider 设置模块让用户在应用内管理 Claude Agent 兼容 Provider、认证方式、Base URL、模型档位和图片能力，并在聊天、项目默认模型和 Skill 覆盖中复用统一模型候选。

## 当前已实现

- 支持新增、编辑、删除和选择活跃 Provider。
- Provider 可保存 API Key 或 Auth Token、Base URL、主模型、Haiku/Sonnet/Opus 档位和图片能力。
- 支持本地 Provider 预设，并通过设置页辅助新增厂商配置。
- 连接测试会调用 Anthropic 兼容 `/v1/messages`，按认证模式使用 `x-api-key` 或 `Authorization: Bearer`。
- 聊天线程、项目默认模型和 Skill 模型覆盖共用 `ChatModelPick`。
- 打包应用以应用内 settings 为权威配置；开发环境可按设置读取 env。

## 用户流程

```text
1. 用户进入设置页模型配置
   ↓
2. 添加或编辑 Provider 与模型档位
   ↓
3. 测试连接并保存
   ↓
4. 在聊天、项目默认或 Skill 面板中选择可用模型
```

## 还没做什么

- 远程 Provider 预设加载策略在当前代码中以本地预设为主要事实；若后续接远程源，需要更新 PRD 与验收。
- 模型设置 acceptance 已完成正式验收状态同步；API Key 不泄漏、Provider 候选和 packaged 配置源已有验收证据，后续可补全页面点击式安全回归。
- MCP server 配置已与模型 Provider 表单分离；全局设置提供独立 MCP Tab 管理 server 定义，项目 Agent 设置只保存当前项目开关覆盖与 tool policy。

## 关键决策

- Provider 主模型是运行时和连接测试的核心字段，档位模型作为候选补充。
- 无凭据 Provider 不进入聊天模型候选，避免用户选择不可运行模型。
- 全局模型设置只管理模型访问与模型候选；MCP server 定义由全局 MCP 设置页保存，项目 Agent 设置只保存本项目启用开关和 tool policy。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `chat-agent-runtime`：运行时解析模型配置。
- `agent-mode`：保存项目默认模型、Skill 覆盖、项目级 MCP 开关覆盖和 tool policy。
- `persistence`：模型设置独立保存，不写入工作区快照。
