# omni-ui 多模态融合与语音控制

## 状态

首版已实现。AgentOS 主窗口已接入 `@xue160709/omni-ui-*` 0.1.0，并以 headless executor 方式持有命令执行上下文；独立命令窗口提供文本/语音输入、确定性应用内命令 rules、Claude Agent SDK 意图识别代理、Apple Speech 多窗口路由、`system.openApp`、`system.openUrl` 和确认/澄清 UI。

正式验收快照：26 个场景中 20 个通过、6 个保留为真实环境人工确认项。详见 `acceptance.md` 与 `TESTING_CHECKLIST.md`。

## 用户能力

- 在独立命令窗口中提交自然语言命令，例如新建对话、切换项目、打开设置、发送 Composer 文本、打开本机应用、打开 Google 页面；其中 Google/谷歌等已知安全网页走本地规则，其它开放名词命令由 Claude Agent SDK 解析。
- 命令窗口支持自动、命令、聊天三种模式：自动模式优先执行 AgentOS 内部命令；系统级任务（例如打开蓝牙设置、截屏、音量、窗口控制）交给当前对话的 Claude Agent SDK 执行；普通问题、总结和解释类请求直接发送到当前 Chat 并返回内容。
- 通过 Option+Space 或托盘入口打开独立命令窗口，录音、编辑 final 文本并提交给主窗口执行。
- 对模型切换、MCP 开关、会话归档等中风险命令展示确认卡。
- 对多候选解析展示澄清列表，选择后继续执行。

## 人工复验项

- live Provider：配置真实模型 Provider 后，提交规则未命中的口语命令，确认 SDK 意图识别执行并回显。
- 真实语音悬浮窗：在 macOS 授权麦克风与语音识别后，用 Option+Space 完成一次语音命令。
- 权限拒绝：拒绝麦克风或语音识别权限，确认悬浮窗展示恢复提示并可重试。
- helper 异常恢复：录音中终止 `AgentOS Speech Helper`，确认错误提示与重试恢复。
- 打开本机应用：提交“打开 Safari”，确认应用置前与 UI 回显。
- 打开网页：提交“打开 Google 页面”，确认默认浏览器打开 `https://www.google.com` 且 UI 回显。

## 相关文档

- 融合设计与 omni-ui 反馈：`docs/omni-ui-integration.md`
- 技术入口：`technical.md`
- 常用语音命令与 BDD：`voice-command-bdd.md`
- omni-ui 改进建议与影响评估：`omni-ui-improvement-notes.md`
- 验收契约：`acceptance.md`
