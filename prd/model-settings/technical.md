# 模型与 Provider 设置技术文档

## 代码入口

| 路径 | 作用 |
| --- | --- |
| `electron/claude-agent-settings.ts` | Provider 设置读写、归一化、连接测试和运行时解析。 |
| `src/claude-chat-types.ts` | Provider、模型选择和配置快照类型。 |
| `src/model-provider-presets.ts`、`src/model-provider-presets.json` | Provider 预设与归一化。 |
| `src/model-pick.ts` | 模型候选构建、选择和能力判断。 |
| `src/components/setting/ClaudeAgentSettingsPage.tsx` | 模型设置 UI。 |
| `src/components/AgentModeMenu.tsx`、`src/components/AgentModeControls.tsx` | 聊天与项目模型选择入口。 |
| `electron/model-pick.test.mjs`、`electron/claude-agent-settings.test.mjs` | 模型候选与设置测试。 |

## 数据结构

- `ClaudeAgentSettings`：Provider 列表、activeProviderId、activeAnthropicModel 和配置来源。
- `ClaudeAgentModelProvider`：认证模式、Base URL、主模型、档位模型和图片能力。
- `ChatModelPick`：线程/项目/Skill 选择的 providerId + anthropicModel。
- `ClaudeAgentResolvedConfig`：运行时给 SDK 使用的脱敏配置。

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

## TODO 对应项

- `TODO.md §14`：补连接测试、密钥清理和 packaged 配置源正式验收。

## 最近同步

- commit：`bb8d2b04de464f1a09decc875f2e869afe8885fb`
- 日期：`2026-06-23`
- 变化摘要：按 Provider store、model-pick 和设置页实现补齐 as-built PRD。
- 待确认：远程 Provider 预设是否仍在产品目标内。

