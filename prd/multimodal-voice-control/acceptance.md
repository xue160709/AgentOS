# omni-ui 多模态融合与语音控制 验收契约

> 唯一验收事实源。先于代码编写；由 project-verify 逐条执行并回写实现状态。
> 对应 TODO §2.1 omni-ui 多模态融合与语音控制主窗口。
> 依赖：npm 包 `@xue160709/omni-ui-core` / `@xue160709/omni-ui-react` / `@xue160709/omni-ui-shadcn`（0.1.0），不在本仓库重写运行时。

## 验收契约

### 需求：omni-ui 运行时接入与文本命令
系统 SHALL 在主窗口挂载 omni-ui `MultimodalProvider`，标注页面与实体，并让文本命令经本地规则解析后由 AgentOS 注册的 executor 执行。

#### 场景：文本命令新建对话
- GIVEN 主窗口已打开某项目且 omni-ui 命令输入可用
- WHEN 用户在命令输入框输入「新建对话」并提交
- THEN 当前项目创建一个新 thread，Chat 视图切换到该 thread，命令入口展示执行成功反馈

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="omni-command-input"] + [data-testid="omni-command-feedback"]

#### 场景：文本命令切换项目
- GIVEN 工作区至少有 2 个项目，侧栏项目项已用 `MultimodalGroup` 标注
- WHEN 用户提交「打开第二个项目」或「打开 <项目名>」
- THEN 活动项目切换为目标项目，项目首页随之更新

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="omni-command-input"] + role=region[name="项目首页"]

#### 场景：无法解析的命令不误执行
- GIVEN omni-ui 命令输入可用且未配置任何可匹配规则/模型不可用
- WHEN 用户提交无意义指令（如「asdfgh」）
- THEN 系统不执行任何 action，展示「无法识别」类提示，主窗口状态无变化

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="omni-command-feedback"]

### 需求：LLM 意图识别走 Claude Agent SDK
系统 SHALL 通过主进程 Claude Agent SDK 一次性 query（不挂业务工具）完成自然语言意图识别，复用模型设置中的激活 Provider 解析结果；API Key 不进入 renderer。

#### 场景：规则未命中时由 SDK 解析执行
- GIVEN 已配置可用的模型 Provider，且用户语句不匹配任何本地规则
- WHEN 用户提交口语化命令（如「帮我把上一个聊天窗口再开一个新的」）
- THEN 主进程用 Claude Agent SDK 执行一次意图识别 query，返回结构化意图 JSON，主窗口执行对应 action 并回显结果

> 实现状态：⬜ 未实现 ｜ 验证方式: 单测 mock SDK query + 人工 live smoke，脱敏日志含 provider/model/耗时

#### 场景：意图识别 query 不触达业务工具
- GIVEN 意图识别 SDK query 已接通
- WHEN 主进程执行一次意图识别调用
- THEN 该 query 不携带 MCP server、文件、Bash 等任何业务工具（`allowedTools` 为空或仅限纯文本回复），模型只能返回意图 JSON，无法产生副作用

> 实现状态：⬜ 未实现 ｜ 验证方式: 单测断言 query options（tools/mcpServers 为空）+ 源码审计

#### 场景：Provider 未配置时降级
- GIVEN 模型设置中没有任何可用 Provider
- WHEN 用户提交规则未命中的命令
- THEN 系统回退为「无法识别」提示并引导前往模型设置，不抛未捕获错误

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="omni-command-feedback"]

#### 场景：意图识别调用不泄漏密钥
- GIVEN 意图识别 IPC + SDK 链路已接通
- WHEN 主进程执行一次意图识别调用（成功或失败均可）
- THEN renderer 侧拿不到 API Key；主进程日志只含 provider 名称、模型、utterance 长度/hash、结果状态与耗时

> 实现状态：⬜ 未实现 ｜ 验证方式: 源码审计 + 日志抽样（`rg` 检查 renderer bundle 与日志输出）

### 需求：语音输入悬浮窗
系统 SHALL 提供全局快捷键唤起的置顶悬浮窗，复用 Apple Speech helper 完成录音识别，用户手动控制开始/停止/提交，final 文本经主窗口 omni-ui 链路执行。

#### 场景：快捷键唤起悬浮窗并完成一次语音命令
- GIVEN macOS 已授权麦克风与语音识别，主窗口在任意页面
- WHEN 用户按全局快捷键唤起悬浮窗，点击开始说「新建对话」，点击停止后点击提交
- THEN 悬浮窗依次展示 partial 实时文字、可编辑 final 文本；提交后主窗口创建新 thread，悬浮窗展示「已执行」状态

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="voice-window-start"] / [data-testid="voice-window-partial"] / [data-testid="voice-window-submit"] / [data-testid="voice-window-result"]

#### 场景：final 文本可编辑后再提交
- GIVEN 悬浮窗已完成一次识别并显示 final 文本
- WHEN 用户修改文本内容后点击提交
- THEN 以编辑后的文本进入意图解析，不使用原始识别文本

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="voice-window-final-input"]

#### 场景：语音权限拒绝
- GIVEN 系统麦克风或语音识别权限被拒绝
- WHEN 用户在悬浮窗点击开始
- THEN 悬浮窗展示权限恢复提示（指向系统设置），状态落回可重试的 idle/error，不崩溃

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="voice-window-permission-hint"]

#### 场景：helper 进程异常退出可恢复
- GIVEN 悬浮窗正在录音
- WHEN Apple Speech helper 进程异常退出
- THEN 悬浮窗展示错误状态并允许重新点击开始；再次开始可正常识别

> 实现状态：⬜ 未实现 ｜ 验证方式: 人工 kill helper 进程 + 状态观察；单测覆盖事件路由

#### 场景：与 Composer 语音输入互斥
- GIVEN 主窗口 Composer 语音输入正在进行
- WHEN 用户在悬浮窗点击开始
- THEN 系统拒绝或先终止前一会话，同一时刻只有一个语音消费者收到 partial/final 事件，事件不串窗

> 实现状态：⬜ 未实现 ｜ 验证方式: 单测覆盖 speech 事件多窗口路由 + 人工双入口交叉验证

### 需求：语音/文本命令打开电脑应用
系统 SHALL 支持通过语音或文本命令打开本机 macOS 应用；打开动作在主进程用参数化方式执行（`open -a <应用名>`），禁止拼接任意 shell 字符串。

#### 场景：打开常用应用
- GIVEN 本机已安装 Safari，语音悬浮窗或命令输入可用
- WHEN 用户提交「打开 Safari」
- THEN 主进程以参数化 `open -a` 启动 Safari，应用置前，悬浮窗/命令入口回显「已打开 Safari」

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="voice-window-result"]｜验证方式: 人工 smoke + 单测 mock 主进程 open 调用

#### 场景：应用不存在
- GIVEN 用户说出的应用名在本机不存在（如「打开 FooBarApp」）
- WHEN 命令提交并解析为打开应用意图
- THEN 系统不执行任何命令兜底猜测，回显「未找到应用 FooBarApp」类提示

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="omni-command-feedback"]

#### 场景：应用名注入防护
- GIVEN 意图识别返回的应用名包含 shell 元字符（如 `Safari; rm -rf ~`）
- WHEN 主进程执行打开应用动作
- THEN 应用名只作为 `open -a` 的单一参数传递（spawn 参数数组，不经 shell 解释），不产生额外命令执行

> 实现状态：⬜ 未实现 ｜ 验证方式: 单测覆盖恶意应用名输入 + 源码审计（禁止 `exec` 拼接字符串）

### 需求：命令执行安全与澄清
系统 SHALL 按 action 风险分级执行：低风险直接执行，高风险需确认；解析出多候选时提供澄清选择。

#### 场景：高风险命令需确认
- GIVEN 已注册 `risk: medium` 及以上的 action（如会话归档）
- WHEN 用户提交对应语音/文本命令
- THEN 系统不直接执行，展示确认卡；确认后执行，取消后无状态变化

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="omni-confirm-card"]

#### 场景：多候选澄清
- GIVEN 用户语句可匹配多个目标（如两个项目名称相似）
- WHEN 解析返回多个假设
- THEN 悬浮窗/命令入口列出候选供点选，选择后执行对应 action

> 实现状态：⬜ 未实现 ｜ selector: [data-testid="omni-clarify-list"]

#### 场景：扩展命令面可用
- GIVEN 阶段 D 已注册任务卡、模型切换、MCP 项目开关等 action
- WHEN 用户提交「切换到 <模型名>」或「关掉这个项目的 <MCP 名>」
- THEN 对应设置实际变更并可在对应设置页观察到

> 实现状态：⬜ 未实现 ｜ selector: 复用 model/MCP 设置页既有 selector

## 平台专项验证（Electron + React）

- API Key、Token 不出现在 renderer bundle、悬浮窗窗口与任何日志中。
- 悬浮窗为独立 BrowserWindow：置顶、无边框、不抢主窗口焦点；关闭悬浮窗不影响主窗口语音（Composer）能力。
- omni-ui 只提议命令：所有 executor 由 AgentOS 页面注册，模型输出不直接触达 IPC/业务代码。
- 意图识别 SDK query 不挂任何业务工具（无 MCP、无文件/Bash 工具），只能返回意图 JSON。
- 打开电脑应用只允许参数化 `open -a`（spawn 参数数组），禁止任意 shell 命令执行。
- 大 DOM 快照性能：真实工作区连续输入 20 字符期间 Provider 重渲染次数符合 omni-ui benchmark 口径（无逐键全量重建）。
- 全局快捷键注册失败（被占用）时有可观察降级提示，不静默失效。

## 建议验证命令

```bash
npm run typecheck
npm run test:electron        # speech 多窗口路由、intent SDK query options、打开应用注入防护、action executor 单测
npm run dev                  # 人工链路：快捷键 -> 录音 -> 提交 -> 主窗口执行
```
