# M0-05F｜Default-off Production Composition

## 目标

把 M0-01–M0-05E 的 disabled modules 组装成一条可回滚、默认关闭的 production Project Chat 路径；同时把 TaskHome managed runs 纳入 broker ownership，解决 runner sink 构造环。flag 关闭时 Revision 1 行为逐字保持；flag 开启时 Project Chat handler/window/presence/scoped services/broker 使用同一 runner、store 与 coordinator。本单不做 React renderer cutover，不默认开启 flag。

## 依赖

- M0-05E 完成；以 Terra 已回报的 typecheck、目标 73/73、Electron 210/210、diff PASS 为完成证据，不重复复核。
- 精读 `technical.md §5.1–§6.1、§7、§15`、现有 Main runner/TaskHome/window/store 初始化顺序与所有 `claude-chat:*` handler。

## Write allowlist

- `electron/project-chat-composition.ts`（新增）
- `electron/project-chat-composition.test.mjs`（新增）
- `electron/claude-chat-event-multiplexer.ts`（新增）
- `electron/claude-chat-event-multiplexer.test.mjs`（新增）
- `electron/main.ts`
- `electron/project-chat-broker.ts`
- `electron/project-chat-broker.test.mjs`
- `electron/project-chat-ipc.ts`
- `electron/project-chat-ipc.test.mjs`
- `electron/project-chat-window-manager.ts`
- `electron/project-chat-window-manager.test.mjs`
- `electron/task-home-plugin-manager.ts`
- `electron/task-home-plugin-manager.test.mjs`
- `electron/desktop-seam.test.mjs`

若现有 TaskHome 测试文件名不同，只允许修改其现有对应 `.test.mjs`，回报精确路径。禁止写：React/CSS、preload/env declarations/shared renderer contract/channel、runner implementation/settings/store schema/view-state/coordinator、Runtime/binding/deep-link。禁止默认开启 flag或删除 Revision 1 路径。

## 冻结 composition 合同

1. feature flag 只在 Main 启动时读取一次：`process.env.AGENTOS_PROJECT_CHAT_BROKER_V2 === '1'` 才为 true；missing、`0`、其它值均 false。不得从 renderer/localStorage/preferences/deep link 改 flag。
2. 新建可切换 event multiplexer。每个 sink 独立 try/catch；一个 sink throw 不阻断其它 sink或 runner。flag false 的 sink 集合保持 legacy WebContents sink + TaskHome observer，绝不包含 broker；flag true 为 broker + TaskHome observer，绝不把同一 SDK event再发 legacy Chat renderer。
3. composition factory 必须依赖注入 Electron primitives，先有 multiplexer再构造唯一 runner，再构造 broker；禁止第二个 runner。broker 注入唯一 workspace coordinator、真实 D adapter/scoped services、permission getter、presence candidates与 capability broadcaster。
4. flag false：不实例化/register production broker/router/window manager/presence，不注册任何 `project-chat:*` handler，现有 `claude-chat:*`、TaskHome、workspace/runtime 行为与 source audit保持不变。
5. flag true：注册集中 handlers map；main window登记 capability+presence，visible/focused只由 BrowserWindow lifecycle更新；selection report 后 refresh prompt owners。项目窗口 capability登记后同步 presence register，focus/show/hide/blur/closed更新；cleanup顺序为 presence unregister，再 broker unavailable，再 capability cleanup，全部幂等。
6. scoped collaborators使用同一 durable store/settings/runner与既有 context/search/dialog/read helper；不得复制 attachment reader或接受 renderer authority字段。broadcaster只投递 capability registry recipients。
7. Project Chat production handler注册只能来自集中 channel/handlers map；同 channel重复注册启动失败，不静默 remove/override。app quit/窗口销毁只清 subscriptions/presence/window，不取消 broker runs。

## TaskHome managed run 迁移

1. 把 `TaskHomePluginManager` 的 runner依赖收窄成可注入 run port，不再要求具体 `ClaudeAgentRunner`。legacy port在 flag false exact委托旧 runner，行为不变。
2. flag true 使用 broker-owned managed port。Main-internal DTO可以携带 projectId、受控 threadId/title/purpose/homePluginSlug、promptMode与 agentMode override；renderer API不得新增这些 authority字段。
3. broker managed port在统一 coordinator内确保 durable task thread存在（固定 project ownership，purpose=`task-run`，homePluginSlug/title来自 Main TaskHome record），然后按普通 broker规则提交/路由/折叠 transcript/session/diff/prompt。多 step/run复用同一 thread；同 thread busy拒绝，不取消前一 request。
4. TaskHome terminal waiter继续观察同一 normalized runner event，但 event先由 broker建立/验证 route；TaskHome只更新 task runtime卡片，不再承担 Chat thread/transcript持久化。unknown managed request不得进入 broker unknown计数。
5. cancel经 managed port验证 project/thread/request route再调用 broker cancel；删除/停止任务不删除 durable Chat thread。flag false legacy cancel保持不变。
6. renderer旧 `emitTaskEvent` 可继续服务 Home卡片，但 flag true时其中 thread seed不得成为 durable workspace唯一来源，也不得通过 renderer full-snapshot覆盖broker thread。

## 实施步骤

1. 先实现 multiplexer与纯 composition factory测试，再做 Main最小接线；禁止把全部逻辑写进 `main.ts`。
2. 扩展 window manager lifecycle callback以供 presence，保持 M0-04 cleanup/load failure幂等和关闭不cancel。
3. 扩展 broker Main-internal managed run port与TaskHome窄接口，覆盖多step、terminal、cancel、重启不恢复live run。
4. Main按 flag二选一原子组装；enabled路径安装 Project Chat handlers、main/project presence、window manager、真实 collaborators；disabled路径不触碰这些实例。
5. source/AST audit证明：一个 runner、一个 workspace coordinator、互斥 sink集合、互斥handler入口、flag read once/default false、没有 React/preload/shared contract改动。

## 必测断言

- flag truth table与read-once；false路径旧 handler/sink/TaskHome调用顺序不变且 Project Chat构造/注册计数为0。
- true路径只有一个runner；SDK event到broker与TaskHome各一次、legacy renderer零次；任一sink throw不影响另一个。
- handler集中注册、sender capability、broadcaster recipients；main/project window lifecycle presence与owner failover；close不cancel。
-真实 model/context/search/picker/read/status服务被注入同一 store/settings/runner；path/session/model仍不能来自renderer。
- TaskHome首step创建一个durable task thread，后续step复用；events写broker transcript并同时settle task runtime；cancel走broker route；unknown/duplicate/terminal late不双写；renderer thread seed不是durable来源。
- enabled composition任一初始化阶段失败都幂等拆除已注册handler/capability/presence/window/sink，不留下半启用路径；不得fallback成broker+legacy双写。
- typecheck、目标测试、完整Electron与diff check由本实现线程执行一次并回报；主任务不再重复执行。

## 命令

```bash
npm run typecheck
node --test electron/project-chat-composition.test.mjs electron/claude-chat-event-multiplexer.test.mjs electron/project-chat-broker.test.mjs electron/project-chat-ipc.test.mjs electron/project-chat-window-manager.test.mjs electron/task-home-plugin-manager.test.mjs electron/desktop-seam.test.mjs
npm run test:electron
git diff --check
```

## 停止并报告

若 flag false 无法保持旧路径、必须创建第二个runner、必须让 managed TaskHome绕过broker持久化thread，或必须改 renderer/shared contract 才能 composition，立即停止并列出精确缺口。不得用同时广播legacy+broker、renderer merge thread或第二份 workspace writer兜底。

## Close record

- 状态：未执行。
- 完成后回报修改文件、合同映射、命令/退出码、风险与停止条件；主任务按用户指示不重复测试/验证，收到完成回报后直接派发 M0-05。
