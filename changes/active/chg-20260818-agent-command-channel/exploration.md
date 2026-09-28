# Exploration — chg-20260818-agent-command-channel

> 本文件由 `user-perspective-review`（§5）与 `product-design`（§6）按 skill 落盘契约创建于 2026-08-31。
> §1–§3 本轮未使用；§4 由 `product-problem-investigation` 于 2026-09-28 补入。证据等级与验证状态遵循 [.claude/docs/evidence-levels.md](../../../.claude/docs/evidence-levels.md)。

## §4 问题与根因：工作台 Runtime「构建 / 重启运行时」双入口（2026-09-28）

模式 `ISSUE_TRACE`。情境：用户新建工作台，选择 `/Volumes/macOS/Github/MD-Reader`（Next.js SSR，有 `build`/`start`/`dev`，无 `output: 'export'`），想直接看到页面。

### 4.1 问题信号账本

| 用户信号（E1，原话） | 当前事实（E2） | 推断（E3） | 尚未知 |
| --- | --- | --- | --- |
| 「为什么存在『构建』和『重启运行时』，小白完全不懂」 | 工作台 Tab 的 recovery 条同时给出「构建」（主）与「重启运行时」（次），`RuntimeWorkspace.tsx` recovery 区；STATIC | 两个按钮是实现机制名，用户必须先知道项目属于哪一档才能选对 | — |
| 「点击『重启运行时』就搞定了」 | 重启走 `manager.restart → start`，经 `servedRuntimeDefinition` 按 `C-RSM-402` 阶梯选到 `next start`；REPRODUCED（node 直驱真实 manager，`status=running`，Ready 1.2s） | 正确路径是次按钮，主按钮反而必败 | — |
| 首次看到「构建失败，仍保留上次产物 / 构建没有产出可直接打开的静态页面」 | `buildRuntime` IPC（`electron/main.ts` buildRuntime handler）强制 `mode:'static'` 调 `manager.build`，没有 ③→② 兜底；OBSERVED（用户截图） | 首败文案谎称有上次产物（= §5 F2） | 截图状态由点「构建」还是新建流程 `AppShell.tsx` 在 `build_required` 时自动调 `buildRuntime` 产生，未区分 |
| 「页面一直卡在预览，只有切换页面才能看到」 | `RuntimePreview` 仅在 `generation/readyUrl/previewUrl/mode` 变化或 `active` 切换时重建 Preview；UNTESTED | 候选 H1：重启期间 static→development 切换，Preview 创建落在 close/新 generation 之间被丢弃，切页触发 `active` 重跑才恢复；H2：`createRuntimePreview` 返回 `loading` 后没有后续 ready 推进 | 需真实 GUI 复现 |

### 4.2 根因与因果链

```text
「两个按钮不懂、点主按钮失败」
  → 直接摩擦：主操作「构建」对 SSR 项目必失败，正确操作藏在次按钮「重启运行时」
  → 契约错位：C-RSM-402 承诺「如何查看由系统探测决定」，但只有 start/restart 入口走探测阶梯；
    「构建」入口（buildRuntime IPC）绕过阶梯、硬编码静态档
  → 根因：工作台表面把实现机制（静态构建 / 进程重启）直接当成用户动作暴露，
    且同一意图（让页面显示出来/变成最新）分叉成两条决策路径；
    新词表 runtimeServeStatus（「更新预览」「需要保持运行才能查看」「启动」）已存在，
    但工作台 Tab 用 showToolbar={false} 关掉了它，只剩 Revision 4 旧 recovery 条
  → 波及：所有 SSR/服务端项目的首次导入与更新；新建工作台自动构建（AppShell）；
    侧栏右键「重新构建」；首败文案 F2。不波及：真正可静态导出的项目、项目首页 Runtime 卡片（已用新词表）
```

反例/验证：可静态导出的项目点「构建」能成功——说明缺陷不在构建本身，而在入口未经阶梯；把 buildRuntime 接入阶梯后 SSR 项目点主按钮应直接落到 `next start`。

### 4.3 解决方向（R，E5，待确认）

1. **一个用户意图，一条决策路径**：工作台只保留一个主动作，语义是「显示最新页面」（沿用已有「更新预览」/「启动」词表），内部一律走 `C-RSM-402` 阶梯：① 有静态产物→直开；② 有服务端产物→`start`；③ 可构建→构建后回 ① 或落 ②；④ 仅 dev→`dev`。`buildRuntime` IPC 与新建流程都改为经阶梯，③ 无产物不再记为 `build_failed`。
2. **机制动作降级**：「重启运行时」只在进程型档位的故障恢复中出现，或收进「⋯」菜单；「构建」不再作为独立按钮出现在服务端项目上。
3. **统一表面**：工作台 Tab 复用 `runtimeServeStatus` 的状态与动作，不再维护第二套 recovery 文案；同时修 F2（无 `artifactId` 时不说「仍保留上次产物」）。
4. **切换后自动呈现**：Runtime 进入可预览状态后当前 Tab 必须自动出现页面，不依赖切页；先按 4.1 H1/H2 复现定位。

明确不做：不新增「模式选择」让用户判断静态/服务端；不改 `C-RSM-402` 阶梯本身；不动项目首页 Runtime 卡片的已确认交互。

### 4.4 待确认与交接

- 需用户决定：工作台主动作名称沿用「更新预览 / 启动」，还是合并为单一「打开 / 更新」。
- 「卡在预览」→ `interaction-flow-review`（带真实 GUI 复现）；方案收敛后 → `product-spec` 记入本 change，实施 → `project-work`。

### 4.5 用户补充（2026-09-28）与新发现

- 用户原话（E1）：「站在小白的角度，应该减少他们对这里的认知，这里我们做好兜底。减少按钮。出问题才在这个页面出现这些按钮。」→ 方向由用户明确：正常态零按钮，异常态才出现恢复动作。
- 用户追问：「如果都是 next start，是不是可以理解用户修改了代码，我们 next start 也会重新构建？」
- 事实（E2，STATIC）：**不会**。第 ② 档「已有服务端产物 → 直接 `npm run start`，不重新构建」；`next start` 只伺服既有 `.next`。源码新鲜度检测 `checkStaticStale` 只覆盖静态产物（`supervisor.ts` checkStaticStale，`mode !== 'static'` 直接返回），服务端档没有任何过期判断。
- 推论（E3）：服务端项目一旦有过 `.next/BUILD_ID`，打开和「重启运行时」都会永远伺服旧构建；界面内没有能让它变新的正常入口（「构建」只在走静态路径时顺带重建了 `.next`，属于偶然）。这与用户「做好兜底」的预期相反，是比双按钮更深的缺口。
- 与已确认合同的冲突（须用户裁决）：design.md Revision 5「源码更新 → 旧页面继续可用 + 提示重新构建（用户决定）」要求用户手动触发更新；用户本轮方向是系统兜底、减少按钮，倾向自动更新。
- 候选方向（R，E5）：打开/切回时判断源码是否比产物新（静态档复用 `fingerprintStaticSource`，服务端档在构建时记录源码指纹）；过期则**先显示旧页面，后台重建，成功后无感切换**，失败保留旧页面并才出现恢复条。不引入文件监听。
- 「打开」的定义（R，回应用户 2026-09-28 追问「不可能每次切换 tab 都算一次打开」）：检查挂在 **Runtime 冷启动**上，而非 Tab 激活——同一 generation 只检查一次。触发：应用重启后该 Tab 首次被看到、关闭工作台后从「新建工作台」列表重开（9-28 REAL 更正：此手势存在）、重启运行时、「用 AI 修改」会话结束（已知改过代码，直接重建）、用户点顶栏 ↻ 刷新（把已有按钮的语义扩为「看最新」）。不触发：切换 Tab、窗口聚焦、侧栏展开收起。外部编辑器改代码后不切 Tab 不会自动发现，需点 ↻。

## §5 用户证据：工作台/项目首页 Runtime 导入·开发流程评审（2026-08-31）

### 5.1 模式与证据边界

- 模式：`SIMULATED` + 静态代码走查。无可运行 Electron GUI，本轮**无 REAL 证据**；"用户看到什么"均为代码路径推导（`STATIC`，带文件行号），感受均为模拟心声（`E4`），未触发分支标 `UNTESTED`。
- 画像缺口：仓库无 `USER_PROFILE.md`。仅使用两个有依据的临时情境：PRD 定义的"不需要理解 npm/端口的普通用户"（E2）；产品所有者本人导入自有项目（E1 来源：本 change `proposal.md` 中 2026-08-30 用户实测反馈）。
- 组织：三个只读模拟 subagent 分别走"首次导入 / AI 开发迭代 / 失败与中断恢复"三个正交 lens；关键结论已由主会话逐条复核。一处 agent 间矛盾已裁决（见 5.3-F3 附注）。
- 覆盖图：静态走查覆盖工作台导入、项目首页创建、开发会话全状态机、7 类失败分支；**未覆盖**：英文文案、Windows、窄窗口/键盘/读屏、真实耗时与时序、`interaction-flow-review` 分工内的竞态问题。

### 5.2 关键体验时刻与模拟心声

严重度描述用户影响与恢复成本，不代表发生频率（无 E1 频率数据）。

**M1 · 首次导入的信任时刻**（lens：首次使用）
- 实际界面事实（STATIC）：信任对话框只显示"目录 + 命令（`npm run build` 或 `npm run dev`）"（`src/components/RuntimeOnboardingDialog.tsx:71`）；四档伺服探测结论（`servePlan`）无任何 renderer 代码消费（全仓 grep 复核）；已有产物时实际零 spawn 直开、production 档实际执行 `npm run start`（`electron/local-app-runtime/index.ts:790-880, 1373`），均与对话框展示的命令不符。
- 模拟心声（E4）：「它说要跑 `npm run build`……我 out/ 里已经有构建好的东西了，为什么还要再构建一次？」→ 秒开后：「它到底跑没跑那个命令？」
- 感受：困惑→惊喜但困惑｜中｜信任建立不充分
- 用户期待：信任时刻知道系统**接下来真的会做什么**。

**M2 · 点击"让 AI 创建"前后**（lens：首次使用）
- 实际界面事实（STATIC）：点击前仅"尚未创建项目 Runtime"+按钮，无时长/影响范围预告；点击后 Main 把硬编码 `createPrompt`（强制 Next.js+React+TS+static export）以 **user 角色消息**自动提交（`electron/main.ts:1495→1128-1157`，主会话实证）。
- 模拟心声（E4）：「我什么都没打字，聊天记录里却突然冒出一大段'我'说的技术要求，还挺长的，也不像我会说的话。」
- 感受：犹豫→意外｜中｜归因失真
- 自发建议（E4）：标注"这是系统代为发起的创建请求"，不伪装成用户气泡。

**M3 · opening 阶段的死等**（lens：目标驱动迭代）
- 实际界面事实（STATIC，代码层 CONFIRMED）：`design.md:107` 承诺"opening：Composer 可先输入"；实现上 `canSubmit` 仅 `live` 为真（`electron/runtime-development-coordinator.ts:130`）且接到 Composer `disabled`（`src/components/chat/ChatPage.tsx:2521`），整个输入框在准备期被禁用。死等时长取决于冷启动（UNTESTED）。
- 模拟心声（E4）：「窗口都打开了，我想先把需求打出来，怎么打不了字。」
- 感受：挫败｜中高｜等待感被放大

**M4 · 失败但不知道为什么**（lens：失败恢复；覆盖创建与普通修改两条路径）
- 实际界面事实（STATIC，主会话复核）：带 mutation 的失败/取消只写 `userMessage` 不写 `errorCode`；`RuntimeDevelopmentSnapshot.userMessage`（`src/runtime-development-contract.ts:62`）在 renderer **无任何消费者**，用户只见通用文案"修改需要处理，预览未更新"。
- 模拟心声（E4）：「它说'需要处理'，但没说要处理什么。是刚才那次报错，还是权限没给？我得重新点进去翻聊天记录才知道。」
- 感受：烦躁｜中｜要花额外力气验证系统承诺
- 对照（正向）：`save-timeout`/`save-unavailable` 因带 `errorCode` 文案完好，可作修复范式。

**M5 · 首次构建失败时的"假备份"**（lens：失败恢复）
- 实际界面事实（STATIC）：`build_failed` 文案"生成预览失败，继续显示上一版"/"构建失败，仍保留上次产物"均不检查 `artifactId` 是否存在（`src/components/runtime-event-state.ts:74` 及 RuntimePreview 占位），首次失败（从未有过产物）时依然显示。
- 模拟心声（E4）：「它说'继续显示上一版'，可我从来没见过任何版本——是我操作错了，还是这就是它一直以来的说法？」
- 感受：困惑｜中｜持续自我怀疑

**M6 · 权限死循环**（lens：失败恢复）
- 实际界面事实（STATIC）：未信任目录点"用 AI 修改"→失败→"获得目录访问权限后才能修改该 Runtime"，唯一可见按钮仍是"用 AI 修改"，再点重复同一错误；解除入口（信任对话框）在别处且文案不指路。
- 模拟心声（E4）：「它说没有权限，可我点的按钮就叫'用 AI 修改'，点了它却告诉我要先去别处搞权限——那这个按钮为什么还能点？」
- 感受：挫败｜中高｜唯一可见动作无法达成目标

**M7 · 关窗与重启后的叙事断裂**（lens：中断恢复）
- 实际界面事实（STATIC）：关闭开发窗口立即销毁、无"AI 会在后台继续完成"的提示（`electron/runtime-development-window-manager.ts:143-150`，后端确实不取消 AI——正向）；开发会话状态与 `misplacedRuntime` 警告均为纯内存，重启后 alert 无痕消失，卡片回到"可以开始修改"。
- 模拟心声（E4）：「我把窗口关了，AI 是不是就停了？」／「昨天好像还提示我'需要处理'，今天打开怎么又是'可以开始修改'了？是自动修好了，还是那个提示本来就不重要？」
- 感受：轻度焦虑→轻度怀疑｜中｜数据没丢但"发生过什么"没了

**M8 · 同路径冲突（正向锚点）**（lens：失败恢复）
- 实际界面事实（STATIC）：检测→阻止第二实例→点名占用者→一键"切换到正在修改的 Runtime"，四环节全部落码（`electron/runtime-root-execution-registry.ts:64-70`、`AppShell.tsx:449-469`）；对照 2026-08-30 用户实测"首页卡片无法运行"（E1），Revision 4 零进程浏览态属根因修复。
- 模拟心声（E4）：「哦，原来是我在另一个地方已经开着改了，点一下就跳过去了。」
- 感受：安心｜中｜信任增强

### 5.3 发现清单（按用户影响排序）

| # | 发现 | 严重度 | 证据 |
| --- | --- | --- | --- |
| F1 | `userMessage` 全链路无消费者：Main 计算的具体失败原因到不了用户眼前（M4） | P0 | STATIC，主会话复核 |
| F2 | 首次失败文案谎称"有上一版"，两处独立渲染点（M5） | P1 | STATIC，主会话复核 |
| F3 | "让 AI 创建"：点击前零预期、prompt 以 user 角色伪装提交、`misplacedRuntime` 检测在项目已有 `package.json/src` 时失效且 alert 无恢复动作（M2） | P1 组合 | STATIC/INFERRED |
| F4 | 信任对话框命令 ≠ 实际执行；`C-RSM-404/405`（探测可见可覆盖、适用所有 Runtime）在工作台侧未兑现，覆盖控件仅项目首页有（M1） | P1 | STATIC，主会话复核 |
| F5 | opening 阶段 Composer 整体禁用，违反 `design.md:107` 合同（M3） | P1 | STATIC，代码层 CONFIRMED |
| F6 | `trust_required` 死循环：alert 无解除路径（M6） | P1 | STATIC |
| F7 | 关窗无后台继续提示；开发会话/misplaced 状态纯内存，重启叙事断裂；`needs_attention` 按钮文案仍是"用 AI 修改"易误读（M7） | P2 | STATIC |
| F8 | `unsupported` 目录点"已保存预览"覆盖无任何反馈；`viewModeArtifactUnavailable` 为死文案（locale 定义、无引用） | P2 | STATIC，主会话复核 |
| F9 | 工具栏同屏 8–9 控件；"保持运行"常驻选项与"不暴露 dev 心智"原则有张力 | P2 | STATIC |
| F10 | 文档/代码卫生：PRD 标 Revision 6 Planned 但 R3/R4 已落码；`startProjectRuntimeChat` 为被测试断言不接线的历史路径；`LocalAppOnboardingDialog.tsx` 疑似死组件；`enterDevelopmentMode` 词条疑似死文案 | P3 | STATIC |
| F11 | 双状态链（development snapshot vs runtime snapshot）在"结束修改成功"瞬间可能短暂不一致（"修改已结束"与"预览可更新"并存） | 待验证 | INFERRED |

裁决附注（F3）：失败恢复 lens 曾判断 `createPrompt` 为死代码，**不成立**——其仅 grep 了 `src/`，prompt 在 Main 侧经 locale 读取并于 `main.ts:1495` 提交（主会话实证）。该 lens 其余结论（F1、misplaced 无动作）独立成立。

### 5.4 正向体验（应保留）

- 同路径冲突闭环完整（M8），root 执行锁 + 零进程浏览态为 2026-08-30 用户实测问题的根因修复。
- 术语纪律彻底：普通路径文案无 npm/端口/产物目录泄漏。
- 关窗不取消 AI 的承诺在代码层真实兑现；last-good 与信任持久化、stale 检测诚实。
- tier① 零 spawn 直开已有产物，正中"平时看产物"诉求（超前于 PRD 标注的 Revision 5 Planned）。

### 5.5 自发建议（E4）→ 背后需要（E3）→ 体验机会（E5）

| 自发建议（E4） | 背后需要（E3） | 体验机会（E5，仅方向） |
| --- | --- | --- |
| 把探测分档显示成一句人话，别猜一行 npm 命令 | 信任时刻的可预测性 | 信任对话框与状态区消费 `servePlan`，按档位说明将发生的事 |
| 失败时告诉我具体哪一步、有没有上一版 | 失败态的处境定位 | 打通 `userMessage` 到渲染层；`build_failed` 文案按 `hasLastGood` 分叉 |
| 创建请求别装成我说的；点击前给预告 | 代理行为的透明与归因 | 创建请求以系统任务说明呈现；按钮旁一行预期说明 |
| 报权限错就指条路 | 错误→动作闭环 | `trust_required`/`misplacedRuntime` alert 附带直达恢复入口 |
| 窗口没准备好也让我先把话打完 | 等待期不浪费用户意图 | opening 允许输入、排队至 live 提交（兑现 design.md:107） |

### 5.6 待验证与交接

- 需 REAL Explorer（真实 GUI）升级证据：opening→live 真实耗时、创建失败真实呈现、F11 双状态链时序、重启恢复观感。
- F11 类竞态/late event 按分工交 `interaction-flow-review`。
- F1/F2/F4/F5 均有精确文件行号，适合直接开 work order；是否进入正式文档与修复优先级待用户决策（本节全部内容按 `confirmation_source` 映射为 `agent_proposal`，不构成产品事实）。

### 5.7 第二轮：真实使用反馈（2026-09-28）

- 模式：FEEDBACK_SYNTHESIS + SIMULATED；lens：首次使用、失败恢复。无 Explorer Thread 真实 GUI 走查（UNTESTED，待授权）。
- E1（用户本人实操，打包版 AgentOS，Dock 启动）：新建工作台选 MD-Reader → 「静态构建失败 (unknown)」；PATH 修复后 → 「构建没有产出可直接打开的静态页面」+「构建失败，仍保留上次产物」；点「重启运行时」→ 页面可用；成功后页面停在占位，切页才出现；原话「为什么存在『构建』和『重启运行时』，小白完全不懂」「减少按钮，出问题才在这个页面出现这些按钮」。
- E2/REPRODUCED：node 中以 Finder PATH 调 `spawn npm` → ENOENT；补 PATH 后 npm 11.19.0；真实 `LocalAppRuntimeManager.start` 对 MD-Reader → `servePlan=production`、`next start` Ready 1.2s、`status=running`。
- E2/STATIC：`buildRuntime` IPC 强制静态档；`checkStaticStale` 仅静态档；工作台 `showToolbar={false}`。
- E3：F13（服务端项目永远旧版）比双按钮更伤信任，因为错误结果不可见。
- E4：M11–M16 心声见 Paintpoints.md §3，不构成证据。
- 映射：E1 观察与 E2/REPRODUCED 可作 `verified_as_built`（限现状）；F13 推论、全部方案方向为 `agent_proposal`。

### 5.8 第三轮：REAL GUI 走查（2026-09-28）

- 执行：Explorer Thread，独立 userData + Dock 同款 PATH，开发版（65a02c4 + 未提交修复），CDP 驱动；偏离：文件夹选择器桩、J2 起副本端口改 3031。
- E2/REPRODUCED：F17 引导修复生效；F14 预览占位 ×4（根因 effect 缺 status 依赖，主会话静态复核成立）；F13 改源码 5 条路径均不生效；F18 端口冲突「[stderr] }」×3。
- E2/OBSERVED：F19 局域网暴露；F20 模式标签错位；F21 新建弹窗首次为空；F22 关闭无确认且可一键重开；F23 引导细节；F4 获 REAL 佐证。
- 推翻：settings 日志泄露密钥（已打码）；「无关闭重开手势」（§4.5 表需恢复该行）。
- 映射：以上 E2 观察可作 `verified_as_built`（限现状）；修复方向仍为 `agent_proposal`。

## §6 方案候选与图

- 2026-08-31 容错交互方案候选（agent_proposal）：交互 mockup 见 [`mockup.html`](mockup.html)。核心是四条状态条规矩（未知不冒充结论 / 红色状态必带出路 / 文案只说真话 / 用户定局不可推翻）+ 一套统一的「状态条 + 原因行 + 主按钮」卡片骨架，覆盖 R-01〜R-21 与 F1〜F11 的主要分支；含两处产品裁决建议（构建中切走→后台继续；停止→作废旧代事件）。
- §5.5 的体验机会方向（E5）为其输入；正式设计合同待用户确认后由 `product-design` 落 `design.md`。

## §7 交互风险：容错状态机审查（2026-08-31，interaction-flow-review）

> 模式：SIMULATED 静态审查（State Mapper + Timeline Challenger 双正交 lens，主会话合并）。全部 verification=**UNTESTED**，evidence=STATIC（有 file:line）或 INFERRED；本节全部内容不进合同，仅记风险。
> 基线：工作树 `homepage-test` 分支当前代码。旅程：J1 构建失败/取消、J2 启动与恢复、J3 静态产物失效、J4 production 档 `npm run start` 失败。
> 编号 `R-`（runtime 容错），与 §5 的 F 编号独立；§5 F2（假备份文案）与本节 R-05 为同一发现。

### 7.1 Findings（按严重度排序）

| ID | 旅程 | 发现 | 严重度 | evidence | 关键定位 |
| --- | --- | --- | --- | --- | --- |
| R-01 | J4 | **production 档失败后 UI 内无任何脱困路径**：启动/重启只重跑同一 `npm run start`；「查看方式」两个覆盖对 production 均被 `applyServeOverride` 短路；「构建」按钮不渲染且 IPC 拒绝。用户只能去 Finder 手删 `.next` | P1 | STATIC | `static.ts:251-263`、`index.ts:785,1373,1709`、`main.ts:2286-2288` |
| R-02 | J1 | **build 前置失败被完全静默丢弃**：`{ok:false, code, message}` 的 8 种前置失败（目录丢失/package.json 损坏/非静态档/信任失败…）在两处 `onBuild` 回调均无分支消费，`.catch(()=>undefined)` 再吞异常。点「更新预览」零反应（主会话已实证） | P1 | STATIC | `main.ts:2279-2292`、`AppShell.tsx:875-888,1915-1928` |
| R-03 | J3 | **运行期产物失效无检测无出路**：userData 产物被删后 serve 返回裸文本 404，Preview 健康判定只看 `did-fail-load` 读不到 HTTP 状态码；卡片仍写「已保存预览」，无「重新构建」引导 | P1* | STATIC+INFERRED | `main.ts:236-241`、`static.ts:520-528`、`preview.ts:367-371` |
| R-04 | J2 | **首屏两段假状态**：打开有 last-good 的项目，先渲染「未初始化+用 Agent 创建」（ensure 往返期间），再渲染「已停止+启动」（restore 返回前），最后才是真状态；两段窗口内按钮均可点。违反 C-RSM-407 及 evidence.md:240 已记录的修复意图 | P1 | STATIC | `AppShell.tsx:344,688-713,710`、`runtime-event-state.ts:57-59` |
| R-05 | J1 | 首次构建失败文案谎称「仍保留上次产物」（= §5 F2；`hasLastGood` 已在组件内算出但未传入投影函数） | P1 | STATIC | `runtime-event-state.ts:73-75`、`zh.json:96,182` |
| R-06 | J2 | **切换项目不重置状态，跨项目撕裂**：切 A→B 期间渲染 {B 的标题, A 的路径/状态/runtime}，Preview 以 A 的 definition 建 B 的 host 被拒→闪「预览失败」 | P1 | STATIC | `AppShell.tsx:688-713,854-866` |
| R-07 | J4 | **stop 与 readiness 赛跑，late `ready`/`failed` 覆盖 `stopped`**：`waitForReadiness` 返回后无 `signal.aborted` 复检；`stop()` 不递增 generation，renderer fence 必然放行同代事件。点停止后卡片可能跳回「运行中」或跳成「启动失败」 | P1 | STATIC | `index.ts:1265-1283,882-911`、`runtime-event-state.ts:167-168` |
| R-08 | J2 | **构建中强退应用→半成品 `out/` 被下次启动采纳为 last-good**：`validateStaticOutput` 只查目录+入口文件存在，不查完整性；tier① 无 build-in-progress 防护。用户看到「已保存预览」实为残缺页 | P1 | STATIC | `index.ts:820-842`、`static.ts:112-136` |
| R-09 | J1 | **构建中切走页面/打开对话线程→构建被静默杀掉**：项目首页是唯一 consumer（`manager.build` 不传 consumerId），页面卸载→`stop('last-consumer')`→abort build；回来后无任何「构建被中断」说明，自动恢复旧产物。用户以为构建成功了 | P1 | STATIC | `AppShell.tsx:828,847-850`、`index.ts:1854-1869` |
| R-10 | J1 | **「构建→取消→立刻再构建」是 no-op**：`buildOperations` 去重把第二次点击合并进取消中的旧 promise（取消需等进程树终止约 5s），第二次构建从未发生 | P2 | STATIC | `index.ts:1830-1844,994-1001` |
| R-11 | J1 | **settle 保存与手动构建并发→开发会话误报「预览更新失败」**：互斥正确但 `runtime-build-already-active` 被 bridge 当成 build-failed 上报 | P2 | STATIC | `index.ts:1832-1834`、`runtime-development-runtime-bridge.ts:327-335` |
| R-12 | J1 | **静态 Runtime `status='failed'`（信任撤销/声明损坏）时三按钮全灰**，recovery 面板不渲染，项目首页更无 recovery 面板；serve-status 上的「启动」按 R-02 静默失败 | P2 | STATIC | `RuntimeWorkspace.tsx:36-38,69`、`ProjectHomeRuntimeView.tsx:40-41` |
| R-13 | J4 | **非静态 failed 的「启动」按钮实际调 build**（'retry' 一律映射 `onBuild ?? onStart`），main 以 `static-runtime-required` 拒绝后被 R-02 吞掉——死按钮 | P2 | STATIC | `runtime-event-state.ts:62-64`、两个消费者 `:50-54` |
| R-14 | J1 | **renderer `errorCode`/`detail` 永久黏滞**：Main 清空用 `undefined`，reducer 的 `??` 无法区分「清除」与「未携带」；曾失败的 Runtime 成功 ready 后卡片仍显示旧错误 | P2 | STATIC | `runtime-event-state.ts:191-192` |
| R-15 | J3 | **运行期 stale 漏报**：`checkStaticStale` 全仓唯一调用点在 `startStatic`，无文件监听；应用开着改源码永不提示「预览可更新」 | P2 | STATIC | `index.ts:878,698-702` |
| R-16 | J4 | production/artifact-detected 档**无 stale 概念**：可长期伺服陈旧 `.next`/`out` 而无任何过期提示 | P2 | STATIC | `static.ts:223-230`、`index.ts:1202` |
| R-17 | J1 | tier③ 项目点「重新构建」**先杀正在运行的服务再必然失败**：`build()` 无 `start()` 的回退阶梯，页面没了需手动再启动 | P2 | STATIC | `main.ts:2295-2300`、`index.ts:1743-1764` |
| R-18 | J2 | **晚到 stale 覆盖 `build_failed` 终态**：守卫集合未排除失败终态且 artifactId 未变，失败红字几秒后被「预览可更新」冲掉 | P2 | STATIC | `index.ts:1194-1216` |
| R-19 | J4 | **`readyUrl` 跨端口重试不清空 + 日志无 per-process fence**：attempt#2 可能对旧端口判就绪，预览指向错误地址 | P2 | STATIC/INFERRED | `index.ts:1262,1426-1434,1468-1496` |
| R-20 | J3 | Preview `degraded` 不进占位主文案：页面加载失败时大字仍显示「已就绪/运行中」 | P3 | STATIC | `RuntimePreview.tsx:82-86` |
| R-21 | — | 其余 P3 打包：队列中 build 无法取消（`index.ts:925-928` vs `:996`）；产物无 GC 无界增长 + 强杀残留 `.staging-*`（`static.ts:329-417,385`）；`loadLastGood` 三类损坏静默 null 无日志（`static.ts:351-369`）；production 错误文案写死「开发服务」（`index.ts:1281-1463`）；root lease 四个错误码裸串透给用户（`runtime-root-execution-registry.ts:74-183`）；`serveScript` 内存残留（`index.ts:537-558`）；IPC 快照与事件流合并缺 generation 比较（`AppShell.tsx:726-732` 等 8 处） | P3 | STATIC/INFERRED | 见左 |

\* R-03 的 P1 依赖「Electron 对带 body 的 404 不触发 `did-fail-load`」这一推断；若实际触发则降 P2（症状变为 degraded 但仍无重建引导）。

### 7.2 守住的 guard（修复时不得破坏）

last-good 在所有失败/取消路径下不可变（含测试）；指针两级原子 rename、rename 后 abort 不回滚；产物整树拷入 userData——**外部删除项目 `out/` 不影响已打开的预览**（「静态网页失效了怎么办」的正面一半）；`operationStillOwnsRuntime` 五检查点防旧 build 覆盖；取消恢复三分支正确；新产物 commit 成功前不撤旧 Preview token；晚到 stale 无法覆盖刚构建完的 ready（新 artifactId 挡住）；事件批处理排序与 renderer 双条件 fence；跨项目 Preview 创建的三重复检；persisted `mode` 不被失败污染（每次 start 重探测）；build lease try/finally 释放；退出双层超时清理。定位见两份原始报告（task 输出）。

### 7.3 Open Questions（需产品/技术裁决）

1. **构建中切走页面应「继续构建」还是「中止」？**（R-09 修复方向取决于此；合同未覆盖）
2. `stop()` 是否应立即递增 generation，把 R-07 从"逐分支自觉复检"变成结构性 fence？（影响 `local-app-runtime.test.mjs:608` 既有断言语义）
3. 「解析中」需要一个产品词条（建议「正在打开预览…」），design.md §7 词表当前没有（R-04）。
4. tier① 采纳磁盘 `out/` 是否要做最小完整性校验，还是只靠 build-in-progress 标记？（R-08）
5. `manager.build` 不传 consumerId 是有意（构建不算浏览者）还是遗漏？（R-09）
6. Electron 对带 body 的 404 是否触发 `did-fail-load`？（R-03 严重度依赖此，需真机）
7. `RuntimeStatus` 的 `'development'` 值疑似无 writer 的死值（`AppShellSidebar.tsx:253-254` 在消费）。

### 7.4 Test Gaps 与建议验证（交 `project-verify`）

已覆盖良好：构建取消/失败保留 last-good、fence 拒绝提交、取消恢复三分支、renderer generation fence、serve plan 探测优先级、readiness 超时。
**零覆盖的高价值 transition**：production 档全部失败路径（`serveScript:'start'` 在测试中仅出现一次且为 'dev'）；stop 与 readiness 赛跑；取消未 settle 时再次 build；settle 与手动 build 并发；构建在途最后 consumer 释放；产物运行期被删的 404 分支；半成品 `out/` 采纳；`errorCode` 清除语义；build `{ok:false}` 无反馈；首屏 ensure 期间的渲染断言。
纯 Node 单测可覆盖 R-07/R-10/R-18/R-19/R-08（fake fetch/spawn 桩注入时序）；R-02/R-04/R-06 需 renderer/组件级断言；R-01/R-03/R-09 建议真实 GUI 录屏 smoke（最小步骤见两份原始报告）。
