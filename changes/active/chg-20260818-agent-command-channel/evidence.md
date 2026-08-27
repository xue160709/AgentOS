# Evidence

## Revision 2：Discovery

### 用户确认来源（2026-08-26）

- SDK：用户纠正为“Claude Agent SDK”。
- 窗口：用户说明“新建一个窗口来承载这个 Chatbot，可以沿用当前的整个 Chatbot”。
- 来源：用户选择同时支持 AgentOS 内嵌页面与普通系统浏览器页面。
- 发起：用户选择由网站发起配对，AgentOS 确认；一个网站绑定一个项目。
- 执行：用户选择授权网站可直接运行，并且每个外部任务创建新会话。
- 权限：用户明确“现在用户选了哪个权限，就用哪个，协议里不涉及权限”。
- 会话：用户说明独立窗口“跟主窗口的项目下面的会话很像”，选择每项目一个窗口、窗口内管理该项目会话。
- 传输：用户选择 `agentos://` 配对/唤醒 + HTTPS 一次性 ticket 的组合，不在第一版建立本地 HTTPS 服务。
- 启动：在 Heavy 范围、角色与停点说明后，用户回复“继续”，确认进入发现和设计阶段。

### 已核实代码基线

- `electron/main.ts` 当前只创建一个主 `BrowserWindow`，并把该窗口的 `webContents` 直接交给 `ClaudeAgentRunner`。
- `electron/preload.ts` 使用窄 `contextBridge`；静态预览使用私有 `agentos-static:` scheme，预览页面没有应用 preload 能力。
- `src/agent-command-channel.ts` 当前在 renderer 配置阶段绑定单一项目，能够创建普通会话、提交完整 prompt、选择 `stay/open` 并订阅状态。
- Workspace Session、Chat Run 和 transcript 已是现有用户可见事实源；Revision 2 不新增第二套模型。
- `chg-20260825-local-app-tabs-runtime@5` 已承接首次自动静态构建、过期手动重建、last-good 与相关预览状态，本变更只消费其能力。

### ORCH-002

- skill: `product-discovery`
- actual_execution: subagents
- roles: `product_manager=DONE@DISC-PM-02; experience_designer=DONE@DISC-UX-02; technical_architect=DONE@DISC-ARCH-02`
- task_mapping: `DISC-PM-02 -> DISC-UX-02 + DISC-ARCH-02 -> DISC-MERGE-02 -> CONFIRM-02`
- deviation: `technical_architect` 因子线程上限复用已完成的 `protocol_scheme_consult` 线程，并按 technical-architect 方法与交付模板补全；不新增写入者。
- merge_owner: main_agent
- final_status_at_that_stage: WAITING_USER_CONFIRMATION

### `DISC-PM-02` 产品范围草案

- 状态：`DONE / agent_proposal / response_only`，未修改正式 PRD、Acceptance 或 TODO。
- 对象：新增的持久产品对象仅为 `Website Binding`；一次性 `Task Ticket` 是短期凭证，不成为第二套任务历史；`Project Chat Window` 只是现有项目会话的视图。
- 规则：网站来源解析绑定项目，每个 ticket 最多创建一个普通会话；网站不能追加既有会话，用户可在 AgentOS 继续；撤销绑定只阻止未来任务，不取消已运行任务。
- 窗口：主窗口和独立窗口共享 thread、transcript、Chat Run、sessionId、diff 与错误；各自保留当前 thread、草稿、尺寸和焦点。关闭窗口不取消任务。
- 权限：任务启动时沿用项目当时已选权限；网站不能回答权限请求或 Agent 提问。
- Runtime：Chat 只发出任务开始/终态意图，`npm run dev`、静态构建、last-good、端口和进程仍由 Runtime 唯一负责。
- 候选默认：Agent 成功后自动静态构建；v1 网站只获得接受/拒绝回执；关闭独立窗口后任务继续。三项待与体验和架构草案合并后交用户确认。

### `DISC-UX-02` Product Design Pack

- 状态：`DONE / DESIGN_PROPOSAL / response_only`，未修改业务文件或正式产品合同。
- 用户词汇：以“实时预览 / 已保存预览 / 更新预览”替代 dev server / static preview / rebuild；首次显示“正在准备首次预览”，无需用户点击构建。
- 页面职责：独立 Chat 窗口只承载现有 Chatbot 和项目会话；Preview、构建、日志和恢复动作留在主窗口 Runtime；网站只发起连接/任务并接收回执。
- 打断规则：外部任务到达时，若当前有草稿或 run，则不抢焦点、不切会话，只显示新任务徽标；否则聚焦新会话。
- 状态链：区分 Agent 成功与预览更新成功；构建失败显示“修改完成，但预览未更新”，保留 last-good 并提供“重试更新预览”。
- 无障碍：配对对话框、权限/提问焦点陷阱、阶段性 aria-live、错误与恢复动作关联、状态不可只依赖颜色。
- 候选默认：新任务不打断当前草稿；Agent 成功后自动更新已保存预览；v1 网站不接收运行过程或最终结果。

### `DISC-ARCH-02` Technical Architecture Draft

- 状态：`DONE / technical_architecture_draft / response_only`，未修改代码、正式 PRD 或 ADR。
- 唯一写入者：Main-owned Chat broker/Workspace store 负责 thread、transcript、run、sessionId、diff 和 revision；两个 renderer 仅为 typed IPC client。
- 网站协议：网站 HTTPS 后端持有短期 ticket；`agentos://` 仅唤醒并携带版本、动作、origin 与 request ID，AgentOS 从固定 well-known endpoint 获取 envelope，不接受任意 issuer URL。
- 一致性：ticket/idempotencyKey 映射到同一 command/thread；thread 先持久化再启动 SDK；事件使用 project/thread/request/sequence/routeGeneration fence。
- Preview：继续无 preload、sandbox；Main 只捕获明确的 `agentos://` 导航，并用 webContents/runtime/generation 校验来源。
- Runtime：Agent 成功后触发独立的 `runtimeSettle`；构建失败保留 last-good 且不反向改变 Agent 成功终态。
- 平台：macOS `open-url`、Windows/Linux `second-instance` 均需 cold/warm start 与打包 smoke；Electron 锁定版本为 30.5.1。
- ADR 候选：Main-owned broker；opaque deep-link + HTTPS ticket。当前未获写 ADR 授权，未落盘。

### `DISC-MERGE-02`

- 当时状态：完成，Decision Brief 已写入 `proposal.md`，当时仍是 `decision: draft`；后续由 `SPEC-02` 冻结为 accepted。
- 合并裁决：选择网站自有 HTTPS origin 的固定 well-known endpoint，避免本地 HTTPS 服务或可注入 issuer URL；新增绑定凭据不属于权限，且不出现在协议 URL。
- 合并裁决：用户看到的最小词汇固定为“实时预览 / 已保存预览 / 更新预览”；Agent 与 Preview 使用两个独立结果。
- 待确认组合：自动更新已保存预览；v1 网站只收接受/拒绝；关闭窗口继续任务且外部任务不抢当前焦点。

### 用户确认：实时预览交互原则（2026-08-27）

- 用户在收到“静态项目只在修改期间自动进入实时预览，全部项目修改任务结束后自动生成已保存预览；日常界面不再直接出现开发模式和重启”的方案后回复“可以，优化方案”。
- 确认范围：Runtime 用户词汇、自动进入/退出实时预览的总原则，以及隐藏 npm/dev/restart 技术概念；不构成业务代码、正式 PRD 或正式验收授权。

### ORCH-003

- skill: `product-design`
- actual_execution: subagents
- roles: `experience_designer=DONE@DISC-UX-RUNTIME-02/experience_flow_rev2; technical_architect=DONE@DISC-ARCH-RUNTIME-02/protocol_scheme_consult`
- task_mapping: `CONFIRM-RUNTIME-02 -> DISC-UX-RUNTIME-02 + DISC-ARCH-RUNTIME-02 -> DISC-MERGE-RUNTIME-02`

### ORCH-004

- date: 2026-08-27
- trigger: 用户选择 B，确认同一项目允许多个 Agent 会话并行修改。
- decision: 保留同项目并行能力，但必须补齐写入冲突检测、预览聚合、归因与最终构建规则；禁止静默 last-write-wins。
- roles: `experience_designer=DONE@DISC-UX-CONCURRENCY-02/experience_flow_rev2; technical_architect=DONE@DISC-ARCH-CONCURRENCY-02/protocol_scheme_consult`
- task_mapping: `CONFIRM-CONCURRENCY-02 -> DISC-UX-CONCURRENCY-02 + DISC-ARCH-CONCURRENCY-02 -> DISC-MERGE-CONCURRENCY-02`
- deviation: `technical_architect` 继续复用既有协议架构线程，补充 Runtime 状态契约；两项均为 response_only，无新增 writer。
- merge_owner: main_agent
- final_status_at_that_stage: DESIGN_MERGED; CHANGE_DECISION_REMAINS_DRAFT

### `DISC-UX-RUNTIME-02`

- 状态：`DONE / DESIGN_PROPOSAL revise / response_only`，未修改业务代码或正式产品合同。
- 两个 host 使用相同状态、按钮顺序和“更多”菜单；隐藏/恢复不重启 Runtime、不回放过期状态、不抢 Preview 焦点。
- 用户状态固定为“预览已更新 / 页面可能不是最新 / 正在修改项目 · 实时预览中 / 等待你的确认 / 正在保存最新预览 / 修改完成但预览未更新”。
- 网站任务、普通 Chat 与手动实时预览共享同一体验；普通问答不启动实时预览。
- Agent 与 Preview 使用独立结果矩阵；多会话尚未全部结束时不得显示“预览已更新”。
- 体验建议：Agent 失败/取消后若留下部分修改，不自动保存为正式预览。主 Agent 依据已确认的“失败/取消不触发静态构建”边界签署该建议。

### `DISC-ARCH-RUNTIME-02`

- 状态：`DONE / technical_architecture_draft / response_only`，未修改代码、PRD、ADR 或测试。
- 新增 Main 内存态 EditSession/EditLease，不新增持久任务历史或第二套 Runtime；同项目两个 host 仍共享 RuntimeInstance 并各有 PreviewSession。
- HMR 不触发 Main 重启；soft reload 不重启进程；只有进程/health 或可靠依赖与受控配置信号触发合并的 hard recovery。
- final settle 以 editGeneration、sourceFingerprint、settle/build operationId 为 fence；新 run 或 mutation 使旧 settle/build 失效，last-good 仅由仍有效的成功构建原子替换。
- 静态、development-only、static-only/no-dev-script 分别降级；失败/取消、外部或未归属变化均不自动 build。
- Rev5 保持普通 stale + 手动更新，只为成功且可归属的 Agent edit session 增加一次自动 build。

### `DISC-MERGE-RUNTIME-02`

- 状态：完成，开发级状态合同已合并进 `proposal.md`，没有同步正式 PRD/TODO/Acceptance 或业务代码。
- 裁决：失败/取消产生的半成品不自动保存；保留 Diff、源码与 last-good，并引导继续修改、撤销或手动更新。
- 裁决：不把 debounce/静默期具体毫秒数写成产品承诺，交由实现基于 fixture 与真实项目调优。
- 当时待确认：v1 同项目 write-capable 修改任务采用项目级排队或并行；用户随后选择 B，并由 `DISC-MERGE-CONCURRENCY-02` 取代排队建议。

### 用户确认：同项目并行修改（2026-08-27）

- 用户在同项目修改会话“排队 / 并行”的选择中回复 `B`，确认同一项目允许多个 Agent 会话并行修改，跨项目仍可并行。
- 本轮把 B 解释为“共享工作区并行 + 禁止静默后写覆盖”，不扩张为每个会话独立 worktree、独立预览或第二套项目事实。

### `DISC-UX-CONCURRENCY-02`

- 状态：`DONE / DESIGN_PROPOSAL revise / response_only`，未修改业务代码或正式产品合同。
- 项目级显示“正在修改项目 · N 个会话”，会话级保留独立运行、等待、失败与冲突状态；两个 Host 显示同一份共享工作区。
- 不同文件直接并行；同一处冲突先由 Agent 自动读取最新内容并重新处理，无法安全解决时只暂停受影响会话，其它会话继续。
- 冲突只在无法自动恢复时打断用户；用户不接触 hash、rebase、版本号、npm 或 build 等技术概念。
- 最终“预览已更新”必须等待所有相关修改完成、冲突与失败遗留处理完毕，并成功保存最新共享结果。

### `DISC-ARCH-CONCURRENCY-02`

- 状态：`DONE / technical_architecture_draft / response_only`，未修改代码、PRD 或 ADR。
- Main-owned `MutationCoordinator` 按项目聚合多个 run，但只按单文件工具调用加短时 path lock，不建立项目级写入队列。
- 受控 Read/Edit/Write 通过每 run 已观察版本、mutation sequence、写前/写后内容校验阻止过期覆盖；冲突写入被拒绝并要求 Agent 重新读取，而非静默 last-write-wins。
- Bash、MCP、子进程与普通外部写入不能可靠归因时标记 unknown/external，并禁止当前 generation 自动 build；不通过解析命令猜测安全性。
- 一个项目继续只有一个共享 dev Runtime；build 以 editGeneration、operationId 和 source fingerprint 为 fence，新 run 或 mutation 使旧结果失效。
- v1 不引入 per-run worktree，因为它会拆分共享源码和预览事实，并显著增加 merge、依赖和路径映射复杂度。

### `DISC-MERGE-CONCURRENCY-02`

- 状态：完成，用户选择 B 已合并进 `proposal.md` 的开发级状态合同；没有同步正式 PRD/TODO/Acceptance 或业务代码。
- 裁决：体验层“自动整理”由受影响 Agent 在写入被安全拒绝后重新读取并应用意图完成，Main 不自行猜测源码合并。
- 裁决：同文件冲突只局部影响相关会话；unknown/external 或写后不一致不会自动回滚源码，但阻止自动生成已保存预览。
- 裁决：只有最新 editGeneration 的所有相关写入成功且无未解决冲突/未知变化时，才构建一次共享最终结果。

## 撤销并发写入安全合同（2026-08-27）

- trigger: 用户在过度设计复核中确认“这个直接删掉就行，其实不用管”。
- scope: 撤销 `DISC-ARCH-CONCURRENCY-02` / `DISC-MERGE-CONCURRENCY-02` 合并进 `proposal.md` 的写入协调机制，并压缩 Final settle 的前置条件。保留用户选择 B 的产品行为（同项目多会话可并行）。
- 已从 `proposal.md` 删除：`MutationCoordinator`、每文件 path lock、写前内容版本校验、写后 `post-write-mismatch`、冲突重放与局部暂停、`unknown/external` 与 `unattributedDirty` 归因、以及基于上述状态的收口前置条件与“需要处理修改冲突”文案。
- 已保留：同项目多会话并行、共享单一 RuntimeInstance 与 editGeneration、“任一相关会话未终态不得显示预览已更新”、generation fence 与 last-good 原子切换。
- 撤销依据（不新增机制即可覆盖的部分）：
  - 不同文件并发写入本身无竞争；这是绝大多数情况。
  - 同一文件不同位置：`Edit` 按精确字符串匹配，落到新内容上仍能命中，两边改动都保留。
  - 同一文件同一处：`Edit` 的 `old_string` 匹配失败，工具直接报错，Agent 自行重读重试。即原设计中“拒绝过期写入 + 重读重放”由 SDK 工具语义天然提供，无需 Main 侧重建。
- 残留风险（已接受）：`Write` 全量覆盖同一文件时可能静默丢失另一会话的改动。判定为可接受，依据是发生频率低、失败可见（`git diff`）、可一条命令还原；已核实 `/Volumes/macOS/Github/homepage` 与 `/Volumes/macOS/Github/codenow.wiki` 均为 git 仓库。
- 保留的必要约束及其成本：收口前必须确认该项目下没有其它活跃 write-capable run，否则会在源码只改了一半时自动 build 并宣称“预览已更新”。该约束只需活跃 run 计数，不需要协调器。
- 重新启用条件：出现真实的丢改动案例（用户可复述、且能定位到并发写入）。届时优先评估最小手段（例如仅对 `Write` 全量覆盖做单文件版本校验），而不是恢复整节合同。
- 当时未同步正式 PRD / Acceptance / TODO；后续 `SYNC-02` 已同步。`tasks.md` 中 `DISC-UX-CONCURRENCY-02`、`DISC-ARCH-CONCURRENCY-02`、`DISC-MERGE-CONCURRENCY-02` 作为历史事实保持已完成，不回改。

## `CONFIRM-02` / `SPEC-02` / `SYNC-02`（2026-08-27）

- trigger：用户连续要求“先基于事实来统一”“怎么把 spec 写清楚，因为要让 terra 来开发”，随后明确要求“那你来出 spec 和 TODO”。
- interpretation：接受已合并 Decision Brief 与三个建议默认合同，并授权产出开发规格/TODO；不构成业务代码实现或正式验收授权。
- current decision：`proposal.md decision=accepted`；`coverage_gate=ready_for_implementation`；delivery 仍为 in_progress。
- fact audit：确认当前 `agent-command-channel` 位于 renderer、`claude-chat:*` IPC 直接调用一个绑定主窗口 WebContents 的 runner、同 thread 新 submit 会取消旧 run、权限模式在 Chat renderer 本地持久化、second-instance 尚未解析 deep link。Revision 2 规格以这些 as-built 差距为迁移起点。
- frozen defaults：网站只收 accepted/rejected；关闭独立窗口 run 继续且新任务不打断草稿/active run/prompt；静态项目成功 Agent edit settle 后自动更新已保存预览。
- permission clarification：当前代码不是 project-level permission store。为避免无依据新增作用域，v1 冻结为 app-global、Main-authoritative、所有窗口同步、submit 时捕获，默认 `auto`。
- spec outputs：`README.md`、`design.md`、`technical.md`、`protocol-v1.md`、`acceptance.md`。
- execution outputs：`work-orders/` 共 13 单；M0-01–M0-06 串行，M0 Gate 后 M1/M2 可按依赖并行，每单包含精确 write allowlist、测试、完成与停工条件。
- formal sync：`prd/chat-agent-runtime/{README,technical,acceptance}.md` 已同步 Revision 2 planned 合同；根 `TODO.md` 与 `prd/README.md` 已更新。正式 Acceptance 仍全部未执行。
- no business code：本次只修改文档；用户已有的 `AGENTS.md` 删除和其它业务代码脏改动未被覆盖或清理。

## Revision 1：实现与自检

### `ACC-01`

- 结果：完成。
- 证据：用户确认每次发送创建新线程、通道固定绑定项目、调用方传完整指令、是否打开线程可配置，并选择复用现有状态能力。
- 实现：`src/agent-command-channel.ts` 提供配置、发送、打开线程、状态查询与订阅；`AppShell` / `ChatPage` / `WorkspaceSession` 完成非激活线程与 Chat Run 状态桥接。

### `IMP-01` / `TST-01` / `SYNC-01` / `CHK-01`

- 结果：实现与 Codex 自检完成；Acceptance 未写正式通过状态。
- 来源仓库：`npm run typecheck -- --pretty false` 通过；`npm run test:electron` 86/86 通过；`git diff --check` 通过。
- 同步仓库：`npm run typecheck -- --pretty false` 通过；`npm run test:electron` 101/101 通过；选题入口 source audit 9/9 通过。
- 一致性：`src/agent-command-channel.ts` 与 `electron/agent-command-channel.test.mjs` 在两个仓库逐字一致；共享类型仅保留 IntelligentOS 既有 `AppViewId = 'ai'` 差异，`ChatPage` 仅保留既有 localStorage key 差异。
- 工具缺口：两个仓库都不存在规则中历史引用的 `.codex/scripts/check-acceptance.sh`，因此未运行该格式检查，也未执行正式验收。
- 剩余风险：尚未在真实 Electron 窗口中用真实 SDK 长任务逐项执行 `stay` / `open`、等待输入、成功、失败与取消场景；不能视为正式验收通过。
