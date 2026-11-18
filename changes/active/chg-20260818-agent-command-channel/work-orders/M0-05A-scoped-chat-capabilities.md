# M0-05A｜Scoped Preload 与脱敏 Chat Capabilities

## 目标

在任何 production wiring 前，先把项目窗口的 preload 暴露面收窄，并为完整 Chat 后续需要的模型目录、Agent context、项目文件搜索、附件与线程状态建立脱敏、project-scoped typed seam。本单仍保持 disabled：不注册 Main handler、不打开 production 项目窗口、不切 renderer writer。

## 依赖

- `M0-04` 完成。
- 精读 `technical.md §4.1`、`§6`、`§7` 与 `design.md §6.1`。

## Write allowlist

- `src/project-chat-contract.ts`
- `src/project-chat-ipc-seam.ts`
- `electron/project-chat-contract.test.mjs`
- `electron/project-chat-ipc.ts`
- `electron/project-chat-ipc.test.mjs`
- `electron/preload.ts`
- `electron/electron-env.d.ts`
- `electron/desktop-seam.test.mjs`
- `electron/project-chat-broker.ts`（只允许 ProjectChatAttachment → runner 内部 attachment 的无 path adapter）
- `electron/project-chat-broker.test.mjs`

禁止写：`electron/main.ts`、runner、window manager/view-state、React、workspace session/store、binding/deep-link、Runtime。禁止注册 production handler 或实现真实 filesystem/settings/dialog collaborator。

## 实施步骤

1. 按 `technical.md §4/§4.1` 精确增加六个 API 方法及 DTO：`getModelCatalog/getAgentContext/searchProjectFiles/pickAttachments/readProjectAttachments/getThreadStatus`。同时把 `ProjectChatSnapshot.threads` 从内部 `WorkspaceThread[]` 改为显式 `ProjectChatThreadSnapshot[]`；集中 channel map 必须继续以 compile-time exhaustive `satisfies` 覆盖完整 `ProjectChatAPI`。
2. `ProjectChatAttachment` 不含 `path`；把 `SubmitProjectRunInput.attachments` 改为该类型。router 对 submit/attachment collaborator 输入输出逐字段投影；broker 给现有 runner port 时只从该 DTO 构造内部 `ClaudeChatAttachment` 并把 path 固定为空字符串，不能接受 raw renderer path。
   - 沿用现有边界：最多 8 个；文本仅 MD/Markdown/TXT 且实际 UTF-8 内容最多 512 KiB；图片仅 PNG/JPEG/GIF/WEBP 且严格 base64 解码后最多 5 MiB；实际总内容最多 24 MiB。
   - submit 入口按实际内容重新计算 bytes，不信任 renderer 的 `size`；kind/mime/content 不一致、非法 base64、超数或超量都在调用 broker 前拒绝。
   - picker/read collaborator 输出也按相同边界过滤；无效项只能投影为不含 path 的 `skipped`，不得把 raw attachment 或 raw skipped item 透传。
3. 把 preload profile 判断提取为可纯测的函数：只有 `process.argv` 含精确 `--agentos-window-kind=project-chat` 时是 project profile。project profile 只 `exposeInMainWorld('projectChat', ...)`；不得暴露 `desktop`、`claudeChat` 或任何 generic IPC。main profile 保持现有 `desktop`/`claudeChat`，并继续暴露 disabled `projectChat` adapter。不得从 query/hash 选择 profile。
4. IPC router 增加可选 scoped-read collaborator port，但不实现真实依赖。每个方法仍先做 M0-03 frame/document/capability 检查：projectId 方法固定到 project capability；无 projectId 的 model/picker 仍要求已登记 capability，project window 还必须 generation 当前。
5. router 必须对 collaborator **返回值** 再逐字段投影：model 去除 credential/base/auth URL/env；Agent context/file search 去掉 rootPath/绝对 path；status 去掉 cwd/session/base URL/endpoint/apiKeySource；attachment selection 去掉 path。collaborator throw 映射脱敏 `internal-error`。
   - broker 的 `getSnapshot` 与 broadcast event 必须共用同一个逐字段 thread projector；不得返回/spread `WorkspaceThread` 或 `ChatState`。
   - thread projector 必须移除 sessionId、cwd、creationSource/bindingId、skillPath、task metadata、message attachment path、file diff path/checkpointId/内部 requestId；保留合同列出的 Chat 可见字段和 diff `relativePath`。
6. `readProjectAttachments` 在调用 collaborator 前拒绝空 project、空列表、超过 8 项、POSIX/Windows 绝对路径、空项、NUL 与以 `/` 或 `\\` 分隔后的任一 `..` segment；只传规范化相对路径。真实 Main collaborator 后续还必须 realpath containment，本单不得假造文件读取。
7. `pickAttachments` 只允许 `{allowImages?: boolean}`，不接收 renderer path。unimplemented collaborator 统一返回脱敏 `internal-error`，不能为测试伪造 success。
8. source-audit 锁死 `main.ts` 未注册 `project-chat:*`，旧 Revision 1 handler/sink 未改；project profile preload source 中不能执行 desktop/claude expose 分支。

## 必测断言

- compile-time/exhaustive channel 与完整 preload forwarding；Window 类型仍只暴露 named APIs。
- project profile 只暴露 `projectChat`，main profile 暴露既有 bridge + projectChat；query/hash 不能改变 profile。
- wrong sender/subframe/URL/project/stale generation 对六个方法均默认拒绝。
- 恶意 collaborator 返回的 API key/token/baseUrl/rootPath/absolute path/cwd/session/path 字段不出现在结果中（同时做结构断言与序列化字符串负断言）。
- durable thread fixture 注入 sessionId/cwd/website bindingId/skillPath/task metadata/attachment path/diff absolute path/checkpointId/internal requestId 后，`getSnapshot` 与 broadcast event 的结构和序列化字符串均不含这些 sentinel；两条路径投影结果一致。
- submit 注入 attachment path 到不了 broker runner；合法 text/image inline 内容保留。
- submit 的伪造 `size` 不生效；非法 base64、kind/mime/content mismatch、超过 8 个、文本超过 512 KiB、图片超过 5 MiB、总量超过 24 MiB 均拒绝且 broker 零调用。
- collaborator 返回的超量/非法 attachment 不会穿透，`skipped` 中也不含 path。
- `readProjectAttachments` absolute/`..`/NUL 拒绝且 collaborator 零调用；规范相对路径逐项传递。
- picker 不接受 path；collaborator missing/throw 返回脱敏 error。
- `main.ts`/runner/React 零改动，production seam 仍关闭。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-ipc.test.mjs electron/project-chat-contract.test.mjs electron/project-chat-broker.test.mjs electron/desktop-seam.test.mjs
git diff --check
```

## 停止并报告

若 preload 无法仅凭 Main-controlled `additionalArguments` 建立单向 profile，或必须把 `desktop`/`claudeChat` 暴露给项目窗口才能继续，立即停止。若现有类型迫使输出 credential/绝对路径，先报告合同缺口，不得用 `Omit<any>`、raw passthrough 或字符串删除字段掩盖。

## 关闭记录（2026-08-27）

- 状态：PASS / closed；仍为 disabled seam。
- 独立门禁：`npm run typecheck` exit 0；指定四文件 Node tests 38/38 PASS；`git diff --check` exit 0。
- 收尾风险已覆盖：所有 relativePath 再校验、attachment/name basename、threadId scope 回绑、base64 解码前长度栅栏，以及 getSnapshot/broadcast 共用的安全 thread projector。
- 未进入：Main production wiring、真实 collaborator、runner/React/workspace writer cutover。
