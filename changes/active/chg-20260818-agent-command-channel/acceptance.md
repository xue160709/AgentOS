# Revision 3 实施验收计划

> 状态：Revision 3 BUILDABLE / Planned，未实现；Revision 2 实现已落盘但未正式验收
> 正式 GWT 唯一事实源：`prd/chat-agent-runtime/acceptance.md` 的 `Revision 3` 与 `prd/local-app-runtime/acceptance.md` 的 `Revision 6`。本文只提供实现任务与证据的稳定 ID、覆盖方式和通过门槛，不复制另一套产品结论。
>
> **同步义务（2026-08-29 补）**：本表新增任何 ID 时，必须在同一轮把对应 GWT 写入 `prd/chat-agent-runtime/acceptance.md`。`BUG-AUDIT-WS-02` 复核发现 `ATDD-CHAT-207`–`209` 与 `ATDD-WS-201` 曾只存在于本表、未进入 PRD，使"唯一事实源"声明失效。该批已回补。缺少 PRD 对应场景的 ID 不得进入 Development Check。

## 0. Revision 4 P0/P1 覆盖矩阵

| ID | 优先级 | 能力 | 必须证明 | 最低证据 |
| --- | --- | --- | --- | --- |
| `ATDD-RSM-401` | P0 | 探测优先级 | 声明块 > 已有产物 > 可构建 > dev > 不支持，顺序固定；非法声明块仍是硬错误不降级；产物目录越界被拒 | detector unit + containment negative |
| `ATDD-RSM-402` | P0 | 已有产物零进程 | 目录里已有 `out/index.html`（含 `dist`/`build` 变体）时直接文件伺服，不 spawn 任何进程、不占 root 执行锁 | manager integration + spawn 断言 |
| `ATDD-RSM-403` | P0 | 可构建则构建一次 | 无产物有 build 脚本时构建一次并提交 last-good；构建后仍无产物则降级为 dev 且不报硬失败 | build integration + 降级用例 |
| `ATDD-RSM-404` | P0 | dev 只在两处出现 | 浏览态永不 spawn dev；dev 只出现在开发会话或第 ③ 档 | source audit + manager integration |
| `ATDD-RSM-405` | P0 | 同路径可并行查看 | 同一目录的 Project 与 Workspace Runtime 都处于 artifact 档时可同时伺服；dev/构建互斥仍生效且冲突可见 | registry integration + renderer 冲突断言 |
| `ATDD-RSM-406` | P1 | 手动覆盖 | 覆盖持久化且不被自动探测推翻；选"已保存预览"无产物时触发构建，构建不出则如实失败不静默回退 | store readback + UI state test |
| `ATDD-RSM-408` | P0 | 生产伺服优先于 dev | 已有服务端产物且有 `start` 脚本时直接 `npm run start` 不重新构建；构建后无静态产物但可 `start` 时进入生产伺服；只有两者都不可用才 `npm run dev`；开发会话仍强制 dev | detector unit + manager integration + spawn 断言 |
| `ATDD-RSM-407` | P1 | 状态与入口 | 卡片同时显示 Runtime 状态与开发会话状态；停止态有启动入口；导入项目与自建 `.agentos` 走同一套判定与文案 | UI state test + locale 解析断言 |

Revision 4 未实现，以上只定义计划合同。`ATDD-EDIT-206`「无声明不猜命令」被 `C-RSM-401` 显式放宽为"可依据产物/配置/scripts 推导，但必须可解释、可显示、可覆盖，且只允许固定的 `npm run build` / `npm run dev` 两条命令"。

## 0. Revision 3 P0/P1 覆盖矩阵

| ID | 优先级 | 能力 | 必须证明 | 最低证据 |
| --- | --- | --- | --- | --- |
| `ATDD-RDS-301` | P0 | Runtime owner 隔离 | Project/Workspace Runtime 即使同路径也不共享 Definition、用户状态、Chat 或导航；实时资源冲突时阻止第二实例并只在用户确认后切换 | Main contract + renderer integration + Electron smoke |
| `ATDD-RDS-302` | P0 | 一键进入 Runtime 开发 | 两个入口的“用 AI 修改”都按当前 Runtime owner 打开正确的专用窗口并准备实时预览；不依赖 active project，不要求用户操作 npm 模式 | IPC/owner integration + Electron smoke |
| `ATDD-RDS-303` | P0 | 窗口级多轮开发 | 开发窗口存续期间连续 Run 共享 DevelopmentSession，不在每轮成功后 build/stop；主窗口实时效果连续 | coordinator integration + real Runtime smoke |
| `ATDD-RDS-304` | P0 | 关闭/结束收口 | 关闭窗口和主窗口结束命令幂等；运行中 Run 不被取消，终态后只保存一次；无修改不构建 | state-machine tests + Electron close/background smoke |
| `ATDD-RDS-305` | P0 | 失败与 last-good | 失败/取消后的半成品不自动保存；build 失败继续显示上一版，源码/Diff 可继续；新 generation 使旧结果失效 | coordinator/runtime integration + static fixture |
| `ATDD-RDS-306` | P0 | Workspace Chat 不造 Project | Workspace Runtime 开发窗口以 Runtime root 为作用域，不创建 synthetic Project、不改变 activeProjectId、不派生 `<root>/.agentos` | store readback + IPC negative + Electron smoke |
| `ATDD-RDS-307` | P1 | 开发对话持久与分区 | Runtime 开发 Thread 可关闭重开、恢复最近记录和草稿，且不进入普通项目对话列表；全局搜索结果标明 Runtime 身份并打开专用窗口 | codec/migration + dual-window/search UI test |
| `ATDD-RDS-308` | P1 | 等待确认与中断恢复 | 窗口关闭后 pending permission/answer 在主窗口可见并可重新打开处理；app quit 不构建未知半成品 | prompt-owner integration + restart smoke |
| `ATDD-RDS-309` | P1 | 能力矩阵与用户语言 | Project Runtime 成功退出回到 last-good；static-capable Workspace 同步保存；development-only Workspace 结束 Chat 但保持查看所需服务且不宣称已保存；普通界面只使用“用 AI 修改/结束修改” | capability fixtures + UI copy assertions |

Revision 3 未实现，以上只定义计划合同，不记录通过状态。`CHECK-02` 不得再以 Revision 2 的 M2/M3 语义关闭整个 Change。

> 证据缺口修正（2026-08-30，来自 `R3-FIX-USER-01`）：`ATDD-RDS-301` 的"不改变 active tab/project"与 `ATDD-RDS-309` 的 UI copy 断言，此前只有 source-grep 级证据——只断言入口未调用 `openWorkspaceTab`、源码里出现 `t('runtime.modifyWithAi')`，既未覆盖权威快照合并这条真实覆盖路径，也未验证 key 能解析。用户实测因此暴露两处 P0（项目首页仍被 Main 陈旧 `activeWorkspaceTabId` 拉回工作台；开发文案全部显示原始 key）。两条已修复并补回归（`electron/workspace-command-client.test.mjs` 空选中态、`electron/ui-locale-keys.test.mjs` 全量键解析），但这两个 ID 的"最低证据"列仍要求 Electron smoke，缺口未因此关闭。

## 1. 通过规则

- `DEV PASS`：对应实现已落盘，列出的自动测试全绿，且证据包含命令、退出码和关键断言；不等于正式验收。
- `ACCEPTED`：正式 PRD 中对应 GWT 由用户授权的 verifier 执行并回写；没有证据不得勾选。
- 任一安全负例失败、workspace 数据覆盖、重复线程、隐式取消或 last-good 被旧 generation 替换，整项失败。
- 网络 live smoke 可以使用受控本地 HTTPS fixture；不得依赖真实第三方网站作为自动化通过条件。

## 2. Acceptance ID 矩阵

| ID | 能力 | 必须证明 | 最低证据 |
| --- | --- | --- | --- |
| `ATDD-CHAT-201` | Main broker 单 writer | 双 renderer 同时观察同一 run，transcript 不重复、revision 单调 | broker test + Electron smoke |
| `ATDD-CHAT-202` | 同 thread busy | 第二次 submit 返回 `thread-busy`，旧 run 不 cancel，无新 requestId | unit/integration |
| `ATDD-CHAT-203` | 跨 thread 并行 | 同项目不同 thread 各自接收事件/终态 | broker test |
| `ATDD-CHAT-204` | 迟到事件 fence | terminal 不被迟到非 terminal 覆盖，generation 错误事件丢弃 | reducer/broker test |
| `ATDD-CHAT-205` | 权限模式同步 | app-global Main 保存、所有窗口同步、本轮 submit 快照固定 | store/broker/UI test |
| `ATDD-CHAT-206` | Prompt 单 owner | 聚焦 owner 可回答，非 owner 被禁用，关闭后自动转移 | broker + Electron smoke |
| `ATDD-CHAT-207` | 主侧边栏归档 | 右键/垃圾桶只调用 Main archive intent；RuntimeEdit snapshot 交错不复活 thread；重启后仍归档 | renderer integration + store readback + Electron smoke |
| `ATDD-CHAT-208` | 主侧边栏置顶 | pin/unpin 使用显式 boolean Main intent，双窗口与后续 Runtime snapshot 保持一致 | renderer integration + broker test |
| `ATDD-CHAT-209` | 归档 busy/模式切换 | active run/prompt 不隐式 cancel；probing 不误走 legacy；flag disabled 保持 Revision 1 | UI state test + source audit + legacy test |
| `ATDD-CHAT-210` | Readiness 三态 | `probing` 期禁用 thread mutation 且不走 legacy writer；`enabled`/`legacy` 行为分别与 broker/Revision 1 一致 | UI state test + source audit |
| `ATDD-WS-201` | Workspace/View-state ownership | broker mode 剩余 project/sidebar/home-plugin/task/skill mutation 均归类为 Main durable command、独立 view-state 或 legacy-only，无普通 UI full snapshot writer | source audit + restart/readback tests |
| `ATDD-WS-202` | 项目生命周期落盘 | 创建/移除/重定位/置顶/排序经 Main 命令回读后生效，重启保持；新建项目随后 `getSnapshot` 成功并可提交 | store readback + broker integration + restart test |
| `ATDD-WS-203` | 偏好落盘 | 侧栏收起、项目折叠、项目首页页签经 Main 命令持久化；连续切换去抖为一次命令且卸载前 flush | store readback + UI state test |
| `ATDD-WS-204` | 命令 DTO 结构隔离 | workspace 命令携带 threads/projects/chatState/未知键或 renderer 生成的项目 id 时整条拒绝，不做部分应用 | schema negative test |
| `ATDD-WIN-201` | 每项目一窗口 | 重复打开只聚焦；窗口固定项目且无项目切换 | manager + Electron smoke |
| `ATDD-WIN-202` | 关闭不中止 | 关闭窗口后 run 继续，线程/transcript 保留 | Electron smoke |
| `ATDD-WIN-203` | 视图状态恢复 | selected thread、draft、bounds 跨关闭和重启恢复 | store + Electron smoke |
| `ATDD-WIN-204` | 外部任务不打断 | busy/draft/prompt 时只加徽标；idle 时选择并显示新线程 | UI state test + smoke |
| `ATDD-WIN-205` | 项目异常 | 删除/路径丢失禁用 submit，不切换其它项目 | UI/broker test |
| `ATDD-SEC-201` | sender capability | wrong-project、subframe、未知 sender、Preview IPC 全拒绝 | IPC security test |
| `ATDD-PAIR-201` | 配对确认 | 合法 envelope 显示 origin/项目/授权说明，确认后 active binding | parser/store/dialog test |
| `ATDD-PAIR-202` | 配对拒绝/冲突 | cancel 无副作用；跨项目冲突不覆盖 | store/UI test |
| `ATDD-PAIR-203` | credential 安全 | safeStorage 加密；不可用时拒绝；UI/log/API 无明文 | store/security test |
| `ATDD-TASK-201` | 合法外部任务 | 固定 endpoint 验证后持久化线程、submit、accepted | HTTPS fixture integration |
| `ATDD-TASK-202` | 幂等与消费 | 回执失败/重复 deep link 只创建一个线程 | store/broker integration |
| `ATDD-TASK-203` | 无效 Ticket | 未绑定/撤销/过期/来源不符/禁止字段不创建线程 | protocol negative test |
| `ATDD-TASK-204` | 网站最小回执 | 只含 accepted/rejected+code，无本地 ID/结果 | schema/log test |
| `ATDD-LINK-201` | cold/warm deep link | mac open-url、argv/second-instance 统一解析/去重/有界队列 | parser/lifecycle test + mac smoke |
| `ATDD-PREVIEW-201` | Preview 窄捕获 | Preview 点击 agentos link 进入 Main handler，仍无 preload/Node | Electron security smoke |
| `ATDD-EDIT-201` | 可靠写入才进编辑期 | 只读不启动；Edit/Write/NotebookEdit before-tool lease；其它工具靠 diff | coordinator/runner test |
| `ATDD-EDIT-202` | 三条件 settle | mutation + 全部 potential runs terminal + 1500ms stable 才收口 | fake-timer test |
| `ATDD-EDIT-203` | generation fence | settle/build 中新 run/mutation 使旧结果失效 | coordinator/runtime test |
| `ATDD-EDIT-204` | 成功静态更新 | 静态项目只 build 一次并原子切 last-good | runtime integration |
| `ATDD-EDIT-205` | 失败回退 | run 失败/取消不 auto build；build 失败保留 last-good 且 Agent 仍成功 | runtime integration + UI test |
| `ATDD-EDIT-206` | dev/static 能力矩阵 | development-only 不 build；static-only 无 dev 可保存；无声明不猜命令 | coordinator/runtime test |
| `ATDD-UX-201` | Binding 管理 | 列表不显示 secret；撤销确认后未来 task rejected，既有 run 不取消 | UI/store test |
| `ATDD-A11Y-201` | 对话框与状态 | dialog focus/Escape/status/alert/menu focus return 符合设计 | selector audit + Electron smoke |

## 3. 里程碑门禁

### M0：共享 Chat 事实源

必须通过 `ATDD-CHAT-201`–`210`、`ATDD-WS-201`–`204`、`ATDD-WIN-201`–`203`、`ATDD-SEC-201`，才允许默认开启项目 Chat 窗口。任何 renderer full-snapshot 覆盖路径、broker mode 本地 durable thread mutation 或 probing 阶段误走 legacy writer 仍可达，则 M0/Release gate 不通过。

> 事实修正（2026-08-29）：feature flag 已经默认开启（`AGENTOS_PROJECT_CHAT_BROKER_V2 !== '0'`），本门禁是在默认开启之后才被补全的。`ATDD-WS-202`–`204` 与 `ATDD-CHAT-210` 属于**已上线后回补**的门禁项。
>
> 实现状态（2026-08-29）：`FIX-WS-01` 与 `FIX-CHAT-01` 已完成，`ATDD-CHAT-207`–`210`、`ATDD-WS-201`–`204` 均有 `DEV PASS` 级自动证据（见 `evidence.md`）。M0 Gate 的最终判定仍归 `CHECK-02`：`electron/local-app-runtime.test.mjs` 需在允许回环监听的环境复跑，重启后落盘与双窗口一致性需真实 Electron smoke。

### M1：网站入口

必须先通过 M0，再通过 `ATDD-PAIR-201`–`203`、`ATDD-TASK-201`–`204`、`ATDD-LINK-201`、`ATDD-WIN-204`–`205`。协议 fixture 与实现不一致时以 `protocol-v1.md` 为准并修实现。

### M1a：Preview 捕获

必须通过 `ATDD-PREVIEW-201` 和 `ATDD-SEC-201`。Preview 一旦能调用 project chat IPC 或读取 receipt/binding 即为阻断安全问题。

### M2：Runtime 收口

必须先保持现有 Runtime Revision 5 测试全绿，再通过 `ATDD-EDIT-201`–`206`。不得用“Agent 成功”替代 build 成功，也不得用 HMR 页面可见替代 last-good 原子切换证据。

### Release candidate

所有 ATDD 有 Development Check 证据；`npm run typecheck`、`npm run test:electron`、`npm run build` 通过；macOS cold/warm deep-link 和双窗口真实 Electron smoke 通过；Windows protocol registration 标为发布平台必测。之后才可请求正式验收。

## 4. 建议验证命令

具体新增测试文件由 work order 冻结；聚合门禁：

```bash
npm run typecheck
npm run test:electron
npm run build
```

测试不得访问真实用户 `userData`；store、safeStorage、clock、network、BrowserWindow 与 Runtime intent 均需依赖注入或使用临时目录 fixture。
