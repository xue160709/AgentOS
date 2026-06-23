# 聊天与 Agent 运行时

## 模块定位

聊天与 Agent 运行时模块负责把用户输入、附件、模型选择、权限模式和项目上下文转成 Claude Agent SDK 请求，并把流式事件渲染为可追踪的对话时间线。

## 当前已实现

- Composer 支持文本、附件、slash command、`@` 文件搜索、子 Agent 联想和 macOS 语音输入。
- 提交聊天时会绑定线程、项目 cwd、权限模式、模型选择、sessionId 和必要上下文。
- 主进程通过 Claude Agent SDK 驱动运行，转发 assistant、thinking、tool、activity、result、error、cancelled 等事件。
- UI 可以展示权限请求、Agent 提问弹窗、工具过程、thinking、文件 diff、上下文压缩边界和运行耗时。
- 切换线程模型时支持清空旧 session，并用简短 handoff context 交接历史。
- 支持 `show-widget` 形式的 Generative UI 沙箱渲染。

## 用户流程

```text
1. 用户在 Composer 输入文本或添加附件
   ↓
2. UI 创建或复用项目线程并提交运行载荷
   ↓
3. 主进程启动 Claude Agent SDK 查询
   ↓
4. UI 按事件流更新 transcript、权限弹窗和运行状态
   ↓
5. 线程保存 sessionId、模型和最终消息
```

## 还没做什么

- 主流程已有单元测试，但正式验收状态戳尚未回写。
- 端到端 UI 流式走查、权限弹窗和 Generative UI 截图证据仍需补齐。

## 关键决策

- Chat Run seam 负责事件折叠和竞态处理，React 页面和 Electron transport 不拥有这些规则。
- 主进程日志使用脱敏摘要，不输出 API Key、Token 或用户隐私原文。

## 验收

- 验收契约与实现状态见 `acceptance.md`。

## 关联模块

- `workspace-session`：提供线程生命周期和当前活动线程。
- `model-settings`：解析 provider/model 与图片能力。
- `file-context`：提供附件、预览和 `@` 搜索。
- `agent-mode`：提供项目指令、记忆和 TODO 上下文。

