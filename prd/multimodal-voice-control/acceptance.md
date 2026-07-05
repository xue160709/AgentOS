# omni-ui 多模态融合与语音控制 验收契约

> 唯一验收事实源。先于代码编写；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO §2.1 omni-ui 多模态融合与语音控制主窗口。
> 依赖：npm 包 `@xue160709/omni-ui-core` / `@xue160709/omni-ui-react` / `@xue160709/omni-ui-shadcn`（0.1.0），不在本仓库重写运行时。

## 验收契约

### 需求：omni-ui 运行时接入与文本命令
系统 SHALL 在主窗口挂载 omni-ui `MultimodalProvider`，标注页面与实体，并让独立命令窗口提交的文本命令经本地规则解析后由 AgentOS 注册的 executor 执行。

#### 场景：文本命令新建对话
- GIVEN 主窗口已打开某项目且独立命令窗口可用
- WHEN 用户在独立命令窗口输入「新建对话」并提交
- THEN 当前项目创建一个新 thread，Chat 视图切换到该 thread，独立命令窗口展示执行成功反馈

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-final-input"] + [data-testid="voice-window-result"]｜验证方式: npm run typecheck + npm run test:electron + source audit（MultimodalProvider / 独立命令窗口 / thread.new executor）｜证据: TESTING_CHECKLIST.md｜

#### 场景：文本命令切换项目
- GIVEN 工作区至少有 2 个项目，侧栏项目项已用 `MultimodalGroup` 标注
- WHEN 用户提交「打开第二个项目」或「打开 <项目名>」
- THEN 活动项目切换为目标项目，项目首页随之更新

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-final-input"] + role=region[name="项目首页"]｜验证方式: npm run typecheck + source audit（project MultimodalGroup + project.switch executor）｜证据: TESTING_CHECKLIST.md｜

#### 场景：无法解析的命令不误执行
- GIVEN 独立命令窗口可用且未配置任何可匹配规则/模型不可用
- WHEN 用户提交无意义指令（如「asdfgh」）
- THEN 系统不执行任何 action，展示「无法识别」类提示，主窗口状态无变化

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-result"]｜验证方式: npm run typecheck + source audit（rule-first fallback / resolver failure feedback）｜证据: TESTING_CHECKLIST.md｜

### 需求：LLM 意图识别走 Claude Agent SDK
系统 SHALL 通过主进程 Claude Agent SDK 一次性 query（不挂业务工具）完成自然语言意图识别，复用模型设置中的激活 Provider 解析结果；API Key 不进入 renderer。

#### 场景：规则未命中时由 SDK 解析执行
- GIVEN 已配置可用的模型 Provider，且用户语句不匹配任何本地规则
- WHEN 用户提交口语化命令（如「帮我把上一个聊天窗口再开一个新的」）
- THEN 主进程用 Claude Agent SDK 执行一次意图识别 query，返回结构化意图 JSON，主窗口执行对应 action 并回显结果

> 实现状态：⚠️ 跳过（project-verify 2026-07-05）｜验证方式: 单测/源码已覆盖 SDK query options；人工 live Provider smoke 未执行｜原因: 需要真实可用模型 Provider 与 live SDK 调用，本轮不调用真实外部模型｜用户本地验证步骤: 配置可用 Provider，提交本地规则无法命中的口语化命令，确认主进程日志出现 `[omni-intent] start/done` 且主窗口执行目标 action。｜证据: TESTING_CHECKLIST.md｜

#### 场景：意图识别 query 不触达业务工具
- GIVEN 意图识别 SDK query 已接通
- WHEN 主进程执行一次意图识别调用
- THEN 该 query 不携带 MCP server、文件、Bash 等任何业务工具（`allowedTools` 为空或仅限纯文本回复），模型只能返回意图 JSON，无法产生副作用

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜验证方式: npm run test:electron（Omni intent resolver runs Claude SDK in side-effect-free mode）+ 源码审计｜证据: TESTING_CHECKLIST.md｜

#### 场景：Provider 未配置时降级
- GIVEN 模型设置中没有任何可用 Provider
- WHEN 用户提交规则未命中的命令
- THEN 系统回退为「无法识别」提示并引导前往模型设置，不抛未捕获错误

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-result"]｜验证方式: npm run typecheck + source audit（provider_unconfigured 降级与 UI catch）｜证据: TESTING_CHECKLIST.md｜

#### 场景：意图识别调用不泄漏密钥
- GIVEN 意图识别 IPC + SDK 链路已接通
- WHEN 主进程执行一次意图识别调用（成功或失败均可）
- THEN renderer 侧拿不到 API Key；主进程日志只含 provider 名称、模型、utterance 长度/hash、结果状态与耗时

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜验证方式: npm run test:electron（日志脱敏断言）+ npm run build（renderer bundle 生成）+ source audit（Desktop Seam IPC 不暴露 Key）｜证据: TESTING_CHECKLIST.md｜

### 需求：语音输入悬浮窗
系统 SHALL 提供全局快捷键唤起的置顶悬浮窗，复用 Apple Speech helper 完成录音识别，用户手动控制开始/停止/提交，final 文本经主窗口 omni-ui 链路执行。

#### 场景：快捷键唤起悬浮窗并完成一次语音命令
- GIVEN macOS 已授权麦克风与语音识别，主窗口在任意页面
- WHEN 用户按全局快捷键唤起悬浮窗，点击开始说「新建对话」，点击停止后点击提交
- THEN 悬浮窗依次展示 partial 实时文字、可编辑 final 文本；提交后主窗口创建新 thread，悬浮窗展示「已执行」状态

> 实现状态：⚠️ 跳过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-start"] / [data-testid="voice-window-partial"] / [data-testid="voice-window-submit"] / [data-testid="voice-window-result"]｜验证方式: npm run typecheck + node --test electron/omni-intent-voice.test.mjs（17/17）覆盖独立入口/selector/IPC 与语音窗口状态机；`npm run audit:omni-manual-readiness`（9/9）覆盖人工步骤与源码支撑；真实语音链路未执行｜原因: 需真实 Electron GUI、全局快捷键、麦克风与语音识别授权｜用户本地验证步骤: 启动 Electron 应用，按 Option+Space 或托盘入口打开悬浮窗，点击开始说“新建对话”，停止后提交，确认主窗口新建 thread 且悬浮窗回显执行结果。｜证据: TESTING_CHECKLIST.md｜

#### 场景：final 文本可编辑后再提交
- GIVEN 悬浮窗已完成一次识别并显示 final 文本
- WHEN 用户修改文本内容后点击提交
- THEN 以编辑后的文本进入意图解析，不使用原始识别文本

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-final-input"]｜验证方式: npm run typecheck + node --test electron/omni-intent-voice.test.mjs（17/17，`selectVoiceCommandText` 证明编辑后的 final 文本优先进入 submitVoiceCommand）｜证据: TESTING_CHECKLIST.md｜

#### 场景：语音权限拒绝
- GIVEN 系统麦克风或语音识别权限被拒绝
- WHEN 用户在悬浮窗点击开始
- THEN 悬浮窗展示权限恢复提示（指向系统设置），状态落回可重试的 idle/error，不崩溃

> 实现状态：⚠️ 跳过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-permission-hint"]｜验证方式: node --test electron/omni-intent-voice.test.mjs（17/17）覆盖 `speech_denied` reducer、权限恢复提示与 error 可重试状态；`npm run audit:omni-manual-readiness`（9/9）覆盖人工步骤与源码支撑；真实拒绝权限未执行｜原因: 需真实 macOS 麦克风/语音识别权限拒绝状态｜用户本地验证步骤: 在系统设置中拒绝 AgentOS 麦克风或语音识别权限，悬浮窗点击开始，确认出现权限恢复提示且窗口可重试。｜证据: TESTING_CHECKLIST.md｜

#### 场景：helper 进程异常退出可恢复
- GIVEN 悬浮窗正在录音
- WHEN Apple Speech helper 进程异常退出
- THEN 悬浮窗展示错误状态并允许重新点击开始；再次开始可正常识别

> 实现状态：⚠️ 跳过（project-verify 2026-07-05）｜验证方式: node --test electron/omni-intent-voice.test.mjs（17/17）覆盖 `helper_exited` reducer 错误状态与可重试 UI 状态，npm run test:electron 覆盖事件路由；`npm run audit:omni-manual-readiness`（9/9）覆盖人工步骤与源码支撑；人工 kill helper 进程未执行｜原因: 需真实 speech helper 运行进程与 Electron GUI 状态观察｜用户本地验证步骤: 悬浮窗录音中 kill `AgentOS Speech Helper`，确认悬浮窗显示错误且再次点击开始可恢复。｜证据: TESTING_CHECKLIST.md｜

#### 场景：与 Composer 语音输入互斥
- GIVEN 主窗口 Composer 语音输入正在进行
- WHEN 用户在悬浮窗点击开始
- THEN 系统拒绝或先终止前一会话，同一时刻只有一个语音消费者收到 partial/final 事件，事件不串窗

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜验证方式: npm run test:electron（Speech recognition routes events to the active consumer window only）+ source audit（activeConsumerWindowId / isAuthorizedConsumer）｜证据: TESTING_CHECKLIST.md｜

### 需求：语音/文本命令打开电脑应用
系统 SHALL 通过 Claude Agent SDK 解析语音或文本中的打开本机应用意图；打开动作在主进程用参数化方式执行（`open -a <应用名>`），禁止拼接任意 shell 字符串。

#### 场景：打开常用应用
- GIVEN 已配置可用模型 Provider，本机已安装 Safari，独立命令窗口可用
- WHEN 用户提交「打开 Safari 应用」
- THEN 主进程通过 Claude Agent SDK 解析为 `system.openApp` + `params.appName = Safari`，再以参数化 `open -a` 启动 Safari，应用置前，悬浮窗/命令入口回显「已打开 Safari」

> 实现状态：⚠️ 跳过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-result"]｜验证方式: npm run test:electron 覆盖参数化 open；人工打开 Safari 未执行｜原因: 会真实启动本机应用并依赖 Electron GUI 回显｜用户本地验证步骤: 提交“打开 Safari”，确认 Safari 置前且命令入口/悬浮窗回显“已打开 Safari”。｜证据: TESTING_CHECKLIST.md｜

#### 场景：应用不存在
- GIVEN 用户说出的应用名在本机不存在（如「打开 FooBarApp」）
- WHEN 命令提交并解析为打开应用意图
- THEN 系统不执行任何命令兜底猜测，回显「未找到应用 FooBarApp」类提示

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-result"]｜验证方式: npm run test:electron（open -a 非零退出回显路径 source audit）+ npm run typecheck｜证据: TESTING_CHECKLIST.md｜

#### 场景：应用名注入防护
- GIVEN 意图识别返回的应用名包含 shell 元字符（如 `Safari; rm -rf ~`）
- WHEN 主进程执行打开应用动作
- THEN 应用名只作为 `open -a` 的单一参数传递（spawn 参数数组，不经 shell 解释），不产生额外命令执行

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜验证方式: npm run test:electron（system.openApp uses argument-vector open without shell interpolation）+ 源码审计（禁止 `exec`）｜证据: TESTING_CHECKLIST.md｜

### 需求：语音/文本命令打开网页
系统 SHALL 优先用窄范围本地规则解析已知安全网页（如 Google/谷歌），并通过 Claude Agent SDK 解析其它开放网页意图；执行时在默认浏览器中打开明确网页，避免将「打开 Google 页面」误判为打开本机应用。

#### 场景：打开 Google 页面
- GIVEN 已配置可用模型 Provider，主窗口已打开且独立命令窗口可用
- WHEN 用户提交「打开 Google 页面」或「打开谷歌页面」
- THEN 系统通过本地安全规则解析为 `system.openUrl`，再通过默认浏览器打开 `https://www.google.com`，命令入口回显「已打开 Google 页面」

> 实现状态：⚠️ 跳过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-final-input"] + [data-testid="voice-window-result"]｜验证方式: node --test electron/omni-intent-voice.test.mjs（17/17）覆盖 Google/谷歌本地安全规则、page action target normalizer 实执行、安全 executor 与语音窗口 final 文本提交状态机；`npm run audit:omni-manual-readiness`（9/9）覆盖人工步骤与源码支撑；真实默认浏览器打开未执行｜原因: 需要真实默认浏览器副作用与 Electron GUI 回显，本轮不启动外部浏览器｜用户本地验证步骤: 在独立命令窗口提交“打开 Google 页面”，确认默认浏览器打开 https://www.google.com 且命令入口回显“已打开 Google 页面”。｜证据: test-results/multimodal-voice-control-verification.md｜

#### 场景：非法网页地址不执行
- GIVEN 独立命令窗口可用
- WHEN 用户提交无法规范化为 HTTP/HTTPS 网页的指令
- THEN 系统不调用默认浏览器，回显「无法打开网页」

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-result"]｜验证方式: node --test electron/omni-intent-voice.test.mjs（17/17，invalid_url / HTTP(S) guard 断言）+ source audit（normalizeExternalUrl + Desktop Seam openExternal IPC）｜证据: test-results/multimodal-voice-control-verification.md｜

### 需求：命令执行安全与澄清
系统 SHALL 按 action 风险分级执行：低风险直接执行，高风险需确认；解析出多候选时提供澄清选择。

#### 场景：高风险命令需确认
- GIVEN 已注册 `risk: medium` 及以上的 action（如会话归档）
- WHEN 用户提交对应语音/文本命令
- THEN 系统不直接执行，展示确认卡；确认后执行，取消后无状态变化

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-confirm-card"]｜验证方式: npm run typecheck + source audit（medium risk actions + independent window confirmation dispatch）｜证据: TESTING_CHECKLIST.md｜

#### 场景：多候选澄清
- GIVEN 用户语句可匹配多个目标（如两个项目名称相似）
- WHEN 解析返回多个假设
- THEN 悬浮窗/命令入口列出候选供点选，选择后执行对应 action

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-clarify-list"]｜验证方式: npm run typecheck + source audit（needs_clarification candidates + independent window dispatchResolution）｜证据: TESTING_CHECKLIST.md｜

#### 场景：扩展命令面可用
- GIVEN 阶段 D 已注册任务卡、模型切换、MCP 项目开关等 action
- WHEN 用户提交「切换到 <模型名>」或「关掉这个项目的 <MCP 名>」
- THEN 对应设置实际变更并可在对应设置页观察到

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: 复用 model/MCP 设置页既有 selector｜验证方式: npm run typecheck + source audit（model.switch / mcp.toggle / thread.archive / task-card.refresh executors）｜证据: TESTING_CHECKLIST.md｜

#### 场景：命令窗口读取模型设置页安全摘要
- GIVEN 主窗口打开设置 · 模型，页面已加载 1 个或多个模型厂商
- WHEN 用户在独立命令窗口提交「现在设置了多少模型厂商」「现在模型设置页面有几个模型厂商」或「列出模型厂商」
- THEN 系统通过 `settings.describe` 读取当前 omni-ui 快照，回显模型厂商数量、厂商名称、当前请求模型和 API Key 是否已设置的汇总；回显和模型输入快照不得包含 API Key / Token 明文

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-final-input"] + [data-testid="voice-window-result"] + [data-testid="settings-model-provider-list"]｜验证方式: npm run audit:omni-answers（3/3，规则解析→摘要→悬浮窗答案且不泄露 Key）+ npm run audit:omni-rules（7/7，真实配置化规则解析命中 `settings.describe.models`）+ node --test electron/omni-intent-voice.test.mjs（17/17，摘要纯函数 + `mapSubmitResult` 回显映射 + 全 TSX 控件语义）+ npm run test:electron（96/96）+ TypeScript AST 控件审计（native 176/176，custom interactive 52/52，gap 0）｜证据: test-results/multimodal-voice-control-verification.md｜

#### 场景：命令窗口读取 omni 控件接入统计
- GIVEN 主窗口任意页面已挂载 omni-ui runtime，当前代码通过 TypeScript AST 控件审计
- WHEN 用户在独立命令窗口提交「还有多少控件没有实现」「多少控件没接入 omni」或「omni 控件接入情况」
- THEN 系统通过 `settings.describe` 的 `controls` topic 回显静态接入缺口、原生控件覆盖数、非原生交互控件覆盖数、当前页面可交互对象数，并明确剩余 manual-only 项不是控件接入缺口

> 实现状态：✅ 已通过（project-verify 2026-07-05）｜selector: [data-testid="voice-window-final-input"] + [data-testid="voice-window-result"]｜验证方式: npm run audit:omni-answers（3/3，规则解析→摘要→悬浮窗答案）+ npm run audit:omni-rules（7/7，真实配置化规则解析命中 `settings.describe.controls`）+ node --test electron/omni-intent-voice.test.mjs（17/17，`coverage-summary` 与 AST 审计对账 + `mapSubmitResult` 回显映射）+ npm run audit:omni-controls（missing 0）+ npm run test:electron（96/96）｜证据: test-results/multimodal-voice-control-verification.md｜

## 平台专项验证（Electron + React）

- API Key、Token 不出现在 renderer bundle、悬浮窗窗口与任何日志中。
- 悬浮窗为独立 BrowserWindow：置顶、无边框、不抢主窗口焦点；关闭悬浮窗不影响主窗口语音（Composer）能力。
- omni-ui 只提议命令：所有 executor 由 AgentOS 页面注册，模型输出不直接触达 IPC/业务代码。
- 意图识别 SDK query 不挂任何业务工具（无 MCP、无文件/Bash 工具），只能返回意图 JSON。
- 打开应用/网页这类开放名词命令不配置泛化本地短语 rules；Google/谷歌等已知安全网页可以由窄范围本地规则解析为 allowlisted action，其它开放名词仍由 Claude Agent SDK resolver 解析，再由本地 executor 执行。
- 打开电脑应用只允许参数化 `open -a`（spawn 参数数组），禁止任意 shell 命令执行。
- 打开网页只允许 HTTP/HTTPS URL，经 `desktop.openExternal` 交给默认浏览器，不支持任意 shell 或非网页协议。
- 大 DOM 快照性能：真实工作区连续输入 20 字符期间 Provider 重渲染次数符合 omni-ui benchmark 口径（无逐键全量重建）。
- 全局快捷键注册失败（被占用）时有可观察降级提示，不静默失效。

## 建议验证命令

```bash
npm run typecheck
npm run test:electron        # speech 多窗口路由、intent SDK query options、打开应用注入防护、action executor 单测
npm run dev                  # 人工链路：快捷键 -> 录音 -> 提交 -> 主窗口执行
```
