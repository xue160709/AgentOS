# omni-ui 多模态融合与语音控制技术说明

## 代码入口

- `src/main.tsx`：挂载 `MultimodalProvider`，加载 omni-ui 样式，注册规则优先 resolver。
- `src/multimodal/config.ts`：定义本地规则、LLM action policy 与 Claude SDK resolver prompt。
- `src/multimodal/actions.ts`：定义 AgentOS 命令 action 与运行时参数 schema。
- `src/multimodal/AgentOsMultimodal.tsx`：注册 action executor，作为主窗口 headless runtime 处理独立窗口提交、确认和澄清响应。
- `src/components/AppShell.tsx`、`src/components/AppShellSidebar.tsx`、`src/components/chat/ProjectHomeSurface.tsx`：用 `MultimodalPage` / `MultimodalGroup` 标注页面、项目、会话和任务卡。
- `voice.html`、`src/voice-main.tsx`、`src/voice.css`：独立命令窗口入口与 UI，承载文本输入、语音识别、确认和澄清。
- `electron/main.ts`：语音窗口、全局快捷键、intent resolve IPC、`system.openApp` IPC、`desktop.openExternal` 网页打开桥与语音结果中转。
- `electron/speech-recognition.ts`：Apple Speech helper 多窗口消费者路由与互斥。
- `src/desktop-seam.ts`、`electron/preload.ts`、`src/desktop-api.ts`、`src/desktop-types.ts`：Desktop Seam IPC 契约。
- `electron/omni-intent-voice.test.mjs`：新增静态/契约测试。

## 安全边界

- 意图识别只在主进程执行，renderer 不接触 API Key 或 auth token。
- Claude Agent SDK query 使用 `maxTurns: 1`，`allowedTools: []`、`tools: []`、`mcpServers: {}`、`settingSources: []`、`skills: []`，仅作为无副作用 JSON 意图解析器。
- `system.openApp` 使用 `spawn('/usr/bin/open', ['-a', appName], { shell: false })`，应用名永远作为单一参数，不经 shell 拼接。
- `system.openUrl` 只把规范化后的 HTTP/HTTPS URL 交给既有 `desktop.openExternal`，用于默认浏览器打开网页；不接受 shell 片段或非网页协议。
- 语音悬浮窗只采集 utterance 和显示结果，主窗口仍是唯一命令执行方。

## omni-ui 集成注意点

- `MultimodalProvider` 会渲染真实 `div[data-mm-root]` 包住 children。AgentOS 主窗口依赖 `html/body/#app/AppShell` 的全高链路，因此接入时必须给 `#app > [data-mm-root]` 明确 `height: 100%`、`min-height: 0`，否则主窗口会被 `body overflow: hidden` 裁剪，表现为无法滚动且 Composer 不可见。
- `MultimodalPage` 在 AppShell 外层只承担语义注册职责，不应参与主窗口排版；当前使用 `display: contents` 让它保留注册属性但不制造额外布局盒。
- omni-ui 自带的可见命令输入适合 demo/debug，但在 AgentOS 主聊天窗口底部会和 Composer 抢位置、截获滚动/点击；正式路径改为主窗口 headless executor + 独立命令窗口。

## 验收

- `npm run typecheck`：通过。
- `npm run test:electron`：83/83 通过。
- `npm run build`：通过，生成 `dist/voice.html` 与 macOS app/dmg/zip；notarization 因未配置选项按预期跳过。

保留人工项见 `README.md` 与 `acceptance.md`。
