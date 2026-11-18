# M0-05D｜真实 Runtime Adapter 与 Scoped Read Services（Disabled Composition）

## 目标

实现 production 可复用、但仍不可达的 `ClaudeAgentRunner -> ProjectChatBrokerRunner` adapter 与六个 project-chat scoped read collaborators。所有项目路径、thread session/model 都从 durable workspace 解析；模型/context/file/status 输出脱敏；项目附件做 canonical realpath/symlink containment。本单不做 Main IPC 注册、broker/sink composition、feature flag、prompt presence、rewind、TaskHome migration 或 React cutover。

## 依赖

- `M0-05C` 完成并通过独立复核。
- 精读 `technical.md §4.1、§5.6、§6`、`electron/project-chat-ipc.ts` 的现有 projector、`electron/project-chat-broker.ts` runner port、`ClaudeAgentRunner` public API、workspace durable types与现有 context/search/attachment helper。

## Write allowlist

- `electron/project-chat-runtime-services.ts`（新增）
- `electron/project-chat-runtime-services.test.mjs`（新增）
- `electron/project-chat-ipc.ts`（只允许 collaborator 注释/类型收口；不得改变 channel、授权或 projector 行为）
- `electron/project-chat-ipc.test.mjs`（只允许真实 services + router 的脱敏/错误映射组合断言）
- `electron/desktop-seam.test.mjs`（只允许 disabled source-audit）

禁止写：`electron/main.ts`、`electron/claude-agent-runner.ts`、runner sink/broker/coordinator/window manager/view-state、preload/env declarations、workspace store/schema、TaskHomePluginManager、React/CSS、Runtime/binding/deep-link、共享 contract/channel。禁止注册 handler、实例化 production broker、修改旧 `claude-chat:*` caller/sink 或新增 feature flag。

## 实施步骤

1. 新建 `createProjectChatBrokerRunnerAdapter(runner)`（命名可等价但职责不可扩张）：`submit/cancel/answerPermissionRequest` 原样委托；`resetThread(threadId)` 只调用 `runner.newThread(threadId)`。不得保存第二份 route/request 状态、订阅 event、改 payload、fallback 或吞异常。
2. 新建可注入 `createProjectChatScopedReadCollaborator(options)`。production dependencies 以窄函数注入：durable store `read`、settings `getSnapshot`、同一 runner `getStatus`、既有 context discovery/file search、dialog+attachment reader、`realpath`。不能接收 renderer 提供的 cwd/session/model/provider credential。
3. `getModelCatalog` 按 `technical.md §5.6` 从每次 fresh settings snapshot 构造精确 public catalog。settings/env/raw provider 上注入的 `apiKey/authToken/baseUrl/apiKeyUrl/authMode/credential-*` sentinel 在 service 返回与 router JSON 中都不得出现；env source 不合成 provider、不返回 env model/baseUrl/presence。
4. `getAgentContext`/`searchProjectFiles` 每次 fresh-read workspace，验证 project 与 usable path 后才调用依赖；只投影 public DTO 并再次调用共享 safe-relative-path normalizer。底层失败/非法输出抛给 router 统一脱敏，不返回 raw root/message/path。
5. `readProjectAttachments` 先执行非空、最多 8 项、Windows/POSIX absolute、任意分隔符 `..`、NUL 防御。canonicalize root 与每个 candidate；只把 canonical root 内文件交给 reader。candidate realpath failure、root-self、symlink escape 均变成 basename + 固定 unavailable skipped，绝不把原路径/reason送出或交给 reader；root realpath failure 整次失败。合并 reader 结果时不得自己放宽 M0-05A projector 的数量/MIME/体积/签名验证。
6. `pickAttachments` 仅把布尔 `allowImages` 传给注入的现有 picker/reader；结果仍经 router projector。取消返回空 selection，不是错误。任何 raw path/底层 skipped reason 只存在 Main 内部，不得进最终 `ProjectChatResult`。
7. `getThreadStatus` fresh-read并验证 durable project/thread ownership、未归档与 usable path；精确调用 `runner.getStatus({threadId, sessionId?, modelPick?, cwd, refresh:false})`，其中可选字段仅来自 durable thread。只返回合同允许字段，threadId mismatch 失败；status raw 的 cwd/session/baseUrl/endpointHost/apiKeySource/configSource/authentication/route/mcpServers/plugins sentinel 不得进入输出。
8. 加 source-audit：本单新模块没有 `ipcMain`/BrowserWindow/import Main、没有 handler 注册/feature flag、没有读取 `process.env`、没有 `window`/renderer import；`electron/main.ts` 与旧 production seam 文本不变。

## 必测断言

- runner adapter 四个方法的 exact call/return/reject；`resetThread(x)` 只调用 `newThread(x)`；没有 event/request registry。
- settings snapshot 每次 fresh-read；settings provider public 字段 round-trip，所有 credential/URL/auth/env sentinel 在结构与 JSON 负断言中均不存在；env source 行为按 §5.6。
- project path 在两次调用间变化时，第二次 context/search/status/read 使用新 durable path；missing project/pathMissing/空路径时底层调用次数为 0。
- context/search 只保留 public fields；绝对 path/root/instruction content/非法 relativePath 不可见。底层 reject/invalid output 经真实 router 返回脱敏 `internal-error`。
- attachment direct-call 也拒绝 absolute/UNC/drive/`..`/NUL/0/9 项；root realpath 失败不调用 reader；in-root canonical 文件按顺序传给 reader；symlink escape 与 missing candidate 只生成 generic skipped；reader raw path/reason 与非法 MIME/oversize/spoofed image 由 router 丢弃/泛化。
- status runner payload 精确取 durable cwd/session/modelPick + `refresh:false`；renderer input 无法覆盖。archived/orphan/mismatch 全部不泄露且不调用错误目标；最终 JSON 无敏感字段。
- 全部既有 M0-05A router 安全负例保持绿色；没有 production `project-chat:*` 注册或旧路径改变。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-runtime-services.test.mjs electron/project-chat-ipc.test.mjs electron/project-chat-broker.test.mjs electron/desktop-seam.test.mjs
npm run test:electron
git diff --check
```

## 停止并报告

若实现真实服务必须修改 `main.ts`/runner/broker/shared contract/preload/React，或现有 attachment helper 无法通过注入复用，停止并列出缺口；不得复制一份 production attachment reader。若无法在把 candidate 交给 reader 前完成 realpath containment，或 status 只能依赖 renderer cwd/session/model，立即停止。若发现需要现在解决 sink composition、presence/rewind、TaskHome managed run 或 feature flag，也停止，不得提前进入后续任务。

## Close record

- 状态：PASS / closed；未进入原 M0-05，未做 production wiring。
- 复核收尾：按真实 `ProjectFileSearchResult {ok, rootPath, items}` 消费 search；attachment 使用 normalized POSIX segments 构造 candidate，锁定 Windows separator 在 POSIX 的正确行为。
- 独立门禁：目标 Node tests 53/53 PASS；完整 Electron tests 204/204 PASS；typecheck 与 diff check exit 0。
- 下一步：先实现 Main-owned presence/prompt owner disabled seam，不直接执行旧 renderer cutover。
