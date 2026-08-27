# M0-03｜Typed IPC、Permission 与 Sender Capability

## 目标

实现 `window.projectChat` 的 typed preload adapter、可注入测试的 IPC router/capability registry，以及 Main app-global permission 持久化。此单只建立 **disabled seam**：不得在 `main.ts` 注册 `project-chat:*` handler，不得修改或委托现有 `claude-chat:*` production 路径；M0-05 才原子切换生产 caller/single writer。

## 依赖

- `M0-02` 完成。
- 精读 `technical.md §4.1`、`§6`、`§8`。

## Write allowlist

- `src/project-chat-contract.ts`
- `src/project-chat-ipc-seam.ts`（新增，集中 channel 常量）
- `src/desktop-types.ts`
- `electron/preload.ts`
- `electron/electron-env.d.ts`
- `electron/project-chat-broker.ts`
- `electron/project-chat-broker.test.mjs`
- `electron/desktop-preferences-store.ts`
- `electron/project-chat-ipc.ts`（新增）
- `electron/project-chat-ipc.test.mjs`（新增）
- `electron/desktop-seam.test.mjs`

禁止写：`electron/main.ts`、`electron/claude-agent-runner.ts`、React TSX、window manager、binding/deep link、Runtime。禁止注册 production handler、替换 runner sink 或修改旧 `claude-chat:*` 行为。

## 实施步骤

1. 新建共享 `PROJECT_CHAT_INVOKE_CHANNELS` / `PROJECT_CHAT_EVENT_CHANNELS`；键必须与 `ProjectChatAPI` 精确对应。preload 完整暴露 `window.projectChat` adapter，所有 invoke/subscribe 只引用集中常量；`electron-env.d.ts` 声明同一 `ProjectChatAPI`。
2. 在 `electron/project-chat-ipc.ts` 实现可注入的 `RendererCapabilityRegistry` 与 IPC router/handler factory。提供 main-window/project-window 的 register/unregister/query 接口，但本单不在 `main.ts` 实例化或注册。
3. 每次调用先验证：`event.sender.id` 已登记；`event.senderFrame === event.sender.mainFrame`（缺失也拒绝）；frame document 的 origin+pathname 与构造时传入的 renderer entry allowlist 精确匹配（可忽略 query/hash，但绝不从中取 project）；project-window 只能访问固定 projectId，且 capability `routeGeneration` 必须仍为 broker 当前 generation。任一失败 resolve `sender-not-authorized`，不能 throw。
4. router 必须逐方法构造/白名单化 broker input，不能把 renderer 的原始 object 原样透传。Main window 的 projectId 仍由 broker 验证存在/归属；project-window wrong-project 在 broker 前拒绝。`answerPrompt` 调 broker 时显式传入已授权的 `sender.id` 作为 owner id。
5. `DesktopPreferences.chatPermissionMode?: ClaudePermissionMode` 保留“未初始化”和“已有值”的区别。实现 permission service/store 操作：仅 main-window capability 可首次 `initializePermissionMode(legacyMode?)`；合法 legacy 值迁入，否则写 `auto`；已有值时初始化幂等返回且不覆盖；非法持久值归一并修复为 `auto`。`setPermissionMode` 只接受冻结联合成员。
6. permission 持久化成功后，让 broker 在自身 operation queue 上为所有 durable project 广播新 snapshot；同一项目的 main-window 与匹配 project-window 都由 capability-aware broadcaster 收到，未知/Preview/wrong-project 不收到。不得增加 workspace revision；运行中的 submit 继续使用已捕获 mode，新 submit 使用新 mode。
7. 为尚未实现的 window/binding 方法保留完整 typed adapter/channel，但 router 用可选注入 collaborator；collaborator 未提供时 resolve 脱敏 `internal-error`。不得为通过测试伪造成功结果。
8. 在 source-audit 测试中锁死迁移边界：`main.ts` 仍没有 `project-chat:*` 注册，旧 `claude-chat:submit/cancel/new-thread/answer-*` 仍直接走 Revision 1 runner，现有 WebContents sink 不变。只允许测试直接调用 router factory。

## 必测断言

- 未登记 sender、subframe、错误 renderer URL、wrong project 全部 `sender-not-authorized`。
- capability generation 过期拒绝；URL query/hash 不能改变授权项目，也不能把另一个 renderer document 放进 allowlist。
- renderer payload 注入 cwd/session/permission 字段不会进入 runner。
- 两窗口改权限后 snapshot 一致；运行中修改不改变已捕获 mode。
- legacy 非 auto 值首次迁入且只迁一次；项目窗口/迟到旧主窗口不能覆盖 Main 已存值。
- Preview/未知 webContents 无 Chat capability。
- `answerPrompt` 使用授权 sender id 校验 owner；业务失败均 resolve 为 `ProjectChatResult.ok=false`，未知异常脱敏为 `internal-error`。
- `main.ts` 没有新 handler/registry/broker wiring；旧生产 Chat handler 未改。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-ipc.test.mjs electron/desktop-seam.test.mjs electron/project-chat-broker.test.mjs electron/chat-run.test.mjs
```

## 停止并报告

若 Electron 版本无法可靠识别 invoking frame，默认拒绝，不放宽到只看 sender.id。若实现必须修改 `main.ts`、旧 `claude-chat:*` handler 或 production runner sink 才能通过，停止并报告规格/依赖缺口；不得提前做 M0-05 cutover。
