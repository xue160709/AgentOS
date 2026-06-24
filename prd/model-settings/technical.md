# 模型与 Provider 设置技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `electron/claude-agent-settings.ts` | Provider 设置读写、归一化、连接测试和运行时解析。 |
| `src/claude-chat-types.ts` | Provider、模型选择和配置快照类型。 |
| `src/model-provider-presets.ts`、`src/model-provider-presets.json` | Provider 预设与归一化。 |
| `src/model-pick.ts` | 模型候选构建、选择和能力判断。 |
| `src/components/AgentModeMenu.tsx`、`src/components/AgentModeControls.tsx` | 聊天与项目模型选择入口。 |
| `src/components/setting/ClaudeAgentSettingsPage.tsx` | 全局模型 Provider 设置页；只管理 Provider、凭据和模型映射。 |
| `src/components/setting/GlobalMcpSettingsPage`（由 `ClaudeAgentSettingsPage.tsx` 导出） | 全局 MCP 设置 Tab；管理 MCP server 定义、新增/编辑/删除和全局启用开关。 |
| `src/components/chat/ProjectHomeSurface.tsx` | 项目 Agent 设置模态；MCP 面板只展示全局已启用的 server，并保存当前项目开关覆盖与 tool policy。 |
| `electron/model-pick.test.mjs`、`electron/claude-agent-settings.test.mjs` | 模型候选与设置测试。 |

## 数据结构

- `ClaudeAgentSettings`：Provider 列表、activeProviderId、activeAnthropicModel 和配置来源。
- `ClaudeAgentModelProvider`：认证模式、Base URL、主模型、档位模型和图片能力。
- `ChatModelPick`：线程/项目/Skill 选择的 providerId + anthropicModel。
- `ClaudeAgentResolvedConfig`：运行时给 SDK 使用的脱敏配置。
- MCP 边界：不要把 `mcpServers` 存入 `ClaudeAgentSettings` 或 `ClaudeAgentModelProvider`；全局 MCP server 定义通过桌面设置接口保存，项目只保存 `mcpServerOverrides` 与 tool policy 后进入 runner。

## 调用链路

```text
设置页保存 Provider
  -> window.claudeChat.saveSettings
  -> ClaudeAgentSettingsStore.save
  -> userData/claude-agent-settings.json

聊天提交携带 modelPick
  -> ClaudeAgentSettingsStore.resolve(modelPick)
  -> buildSdkEnv
  -> Claude Agent SDK query
```

## 日志与调试

- 保存和解析设置只记录 provider 名称、模型、endpoint host 等摘要。
- 连接测试失败记录厂商 HTTP 状态和错误摘要，禁止输出 API Key/Auth Token。

## 测试与验收

- 自动测试：`electron/model-pick.test.mjs`、`electron/claude-agent-settings.test.mjs`。
- 覆盖点：无凭据 provider 不进入候选、主/档位模型候选、设置页主模型字段、legacy 预设清理、连接测试模型选择。
- 验收契约：`prd/model-settings/acceptance.md`。

## 边界情况

- packaged 环境强制 settings 配置来源。
- `authToken` 模式使用 Bearer，`apiKey` 模式使用 `x-api-key`。
- 无效 `modelPick` 会回退到全局 settings/env 解析。
- Provider 的 `baseUrl` 是 Anthropic 兼容 Messages API endpoint，不是 MCP HTTP/SSE endpoint；UI 文案需要避免混淆。
- MCP 密钥、headers 和 `${ENV_NAME}` 解析不应复用 Provider API Key 字段，防止权限边界和脱敏策略混在一起。

## TODO 对应项

- `TODO.md §14`：补全页面点击式安全回归、真实 Provider live smoke 和产品 backlog 重整。
- `TODO.md §15`：MCP 全局定义、项目开关覆盖、状态展示和正式验收已完成。

## 最近同步

- commit：`27851a1fcbd8e8a85b0892d8a5d30db5a17acc5f`
- 日期：`2026-06-24`
- 变化摘要：同步全量 `project-verify` 与交互流程复查结果；模型 Provider 设置 acceptance 已通过，MCP 与模型设置边界已完成正式验收。
