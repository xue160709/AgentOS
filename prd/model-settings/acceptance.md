# 模型与 Provider 设置验收契约

> 唯一验收事实源。当前为 2026-06-23 as-built 初始 PRD 同步；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO：§14 产品 PRD 初始化与后续差距。

## 验收契约

### 需求：用户可以管理 Claude Agent Provider
系统 SHALL 支持新增、编辑、删除和选择活跃 Provider，并保存 API Key 或 Auth Token、Base URL、主模型、层级模型和图片能力。

#### 场景：保存 Provider 配置
- GIVEN 用户在模型设置页填写 Provider 凭据、Base URL 和模型信息
- WHEN 用户点击保存
- THEN 系统将配置写入 Electron userData 中的模型设置存储，并刷新聊天模型候选

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜selector: role=button[name="保存"]｜验证方式: node test-results/full-acceptance-smoke.mjs｜证据: TESTING_CHECKLIST.md｜

#### 场景：无凭据 Provider 不进入候选
- GIVEN 一个 Provider 没有 API Key 或 Auth Token
- WHEN 系统构建聊天模型候选
- THEN 该 Provider 不出现在可选模型列表中

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run test:electron（model-pick）｜证据: TESTING_CHECKLIST.md｜

### 需求：连接测试验证当前认证模式
系统 SHALL 通过 Anthropic 兼容 `/v1/messages` 请求验证 Provider 配置，并根据 `apiKey` 或 `authToken` 模式设置请求头。

#### 场景：测试 API Key Provider
- GIVEN Provider 使用 API Key 认证并填写可测试模型
- WHEN 用户点击连接测试
- THEN 系统使用 `x-api-key` 请求头发送测试请求，并展示成功或厂商错误信息

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run test:electron（claude-agent-settings）｜证据: TESTING_CHECKLIST.md｜

#### 场景：缺少 Base URL 或模型
- GIVEN Provider 缺少 Base URL 或没有可测试模型
- WHEN 用户点击连接测试
- THEN 系统不发送网络请求，并显示需要补齐配置的错误信息

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run test:electron（claude-agent-settings）｜证据: TESTING_CHECKLIST.md｜

### 需求：运行时按 modelPick 解析模型配置
系统 SHALL 优先使用请求携带的 `ChatModelPick` 解析 Provider 和模型，校验失败时回退到全局 settings/env 解析结果。

#### 场景：线程携带有效模型选择
- GIVEN 聊天提交包含有效 `providerId` 和 `anthropicModel`
- WHEN 主进程解析本次 SDK 配置
- THEN 系统为该请求构造对应 Provider 的 `ANTHROPIC_*` 环境变量

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run typecheck｜证据: TESTING_CHECKLIST.md｜

#### 场景：Skill 模型覆盖失效
- GIVEN 已保存的 Skill 模型覆盖对应 Provider 或模型已不存在
- WHEN 系统解析该 Skill 的运行模型
- THEN 系统跳过该无效候选并继续按回退顺序解析模型

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: node test-results/full-acceptance-smoke.mjs + npm run test:electron（model-pick）｜证据: TESTING_CHECKLIST.md｜

### 需求：模型设置页与 MCP 设置保持边界
系统 SHALL 在全局设置中提供独立的 MCP Tab 管理全局 MCP server；模型 Provider 页只管理模型配置，且不得混入 MCP server 字段。

#### 场景：模型设置页不出现 MCP server 编辑字段
- GIVEN 用户打开全局模型与 Provider 设置页
- WHEN 用户编辑 Provider 配置
- THEN Provider 表单只展示 Provider 凭据、Base URL、模型档位和图片能力，不展示 MCP command、args、headers 或 tool policy 编辑字段

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run build:local + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

#### 场景：全局设置侧栏进入 MCP Tab
- GIVEN 用户打开全局设置
- WHEN 用户点击侧栏中的 MCP
- THEN 系统进入独立的全局 MCP 设置页，而不是在模型页内展示 MCP 表单

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run build:local + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

#### 场景：添加全局 MCP server
- GIVEN 用户打开全局 MCP 设置页
- WHEN 用户在全局 MCP 服务列表点击 New MCP Server，填写 server 名称、command、args、工作目录、环境变量或 URL/header 后保存
- THEN 系统把该 MCP server 作为全局定义保存，并允许用户在列表中设置全局启用或停用开关

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run build:local + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

#### 场景：保存并测试全局 MCP server
- GIVEN 用户正在编辑一个全局 MCP server
- WHEN 用户点击“保存并测试”
- THEN 系统先保存全局定义，再执行 MCP initialize/tools/list 连接测试，并在全局列表显示 connected、failed、needs-auth、disabled 或未测试状态；连接成功时显示工具数量

> 实现状态：✅ 已通过（project-verify 2026-06-24）｜验证方式: npm run test:electron + MCP selector audit｜证据: TESTING_CHECKLIST.md｜

## 平台专项验证（Electron + React）

- 验证密钥不出现在日志、PRD 和测试输出中。
- 验证 packaged 环境强制 settings 配置来源。
- 验证图片能力影响附件提交。
- 验证 `ClaudeAgentSettings` 与 `ClaudeAgentModelProvider` 不持久化 `mcpServers` 或 MCP header/token 字段；全局 MCP 定义走独立桌面设置接口。

## 建议验证命令

```bash
npm run typecheck
node --test electron/model-pick.test.mjs electron/claude-agent-settings.test.mjs
```
