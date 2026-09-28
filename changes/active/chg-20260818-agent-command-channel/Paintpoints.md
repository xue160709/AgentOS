# Painpoints — 工作台/项目首页 Runtime 导入·开发流程

> 来源：2026-08-31 用户视角评审（`user-perspective-review`，SIMULATED 静态走查 + 三个正交 lens：首次导入 / AI 开发迭代 / 失败与中断恢复）。
> 来源：2026-09-28 第二轮（`user-perspective-review`，FEEDBACK_SYNTHESIS + SIMULATED，lens：首次使用 / 失败恢复）：用户本人用打包版 AgentOS 新建工作台打开 `/Volumes/macOS/Github/MD-Reader`（Next.js SSR）的截图与原话（E1）＋主会话用真实 `LocalAppRuntimeManager` 在 node 中复现（E2/REPRODUCED）＋「小白」情境模拟（E4，仓库无 `USER_PROFILE.md`，情境仅取自用户原话）。**本轮仍无 Explorer Thread 真实 GUI 走查**。
> 来源：2026-09-28 第三轮 REAL：Explorer Thread 以独立 userData、Dock 同款 PATH 启动开发版（基线 65a02c4 + 未提交修复，dist 13:50），经 CDP 驱动真实界面走 J0–J5（全新引导 → 新建工作台 → 失败恢复 → 改源码 → 重启应用 → 侧栏菜单）；证据目录 `scratchpad/walkthrough2/`（会话临时目录）。系统文件夹选择器以桩代替；因用户已安装的 AgentOS 占用 3030，J2 起对副本改用 `-p 3031`（已记录的偏离）。
> 证据等级遵循 [.claude/docs/evidence-levels.md](../../../.claude/docs/evidence-levels.md)：本文全部为 `STATIC`（代码行号可定位）/ `INFERRED`（推断）/ `E4`（模拟心声）/ `UNTESTED`，**无 REAL 证据**，均属 `agent_proposal` 候选，不构成产品事实。
> 完整分级证据与裁决记录见 [`exploration.md`](exploration.md) §5；汇报页见 [`view.html`](view.html)。

---

## 1. 一句话结论

流程骨架（对象隔离、last-good 兜底、同路径冲突处理、术语纪律）是扎实的；系统性缺口集中在两处——**失败时刻的解释力**（Main 算出的诊断信息送不到用户眼前）和**承诺与实现的一致性**（多条已确认合同只兑现了一半）。最重的问题都落在新手最容易踩的路径上：首次导入、首次创建、首次失败。

**9-28 第二轮**：真实使用把缺口推到了更前面——工作台 Tab 把实现机制（「构建」「重启运行时」「静态产物」）直接交给用户选择，而主按钮对服务端项目必然失败、正确路径藏在次按钮（F12）；更深一层，服务端项目改了代码后打开和重启都永远伺服旧构建，界面没有正常入口让它变新（F13）。用户已给出方向：「减少按钮，出问题才出现」。

## 2. 痛点总表（按用户影响排序）

| # | 痛点 | 严重度 | 阶段 | 证据 | 关键定位 |
| --- | --- | --- | --- | --- | --- |
| F1 | **失败原因的"最后一公里"断了**：`RuntimeDevelopmentSnapshot.userMessage` 在渲染层无任何消费者，用户只见通用文案「修改需要处理，预览未更新」 | **P0** | 开发会话失败 | STATIC · 主会话复核 | `src/runtime-development-contract.ts:62`；写入点 `electron/runtime-development-coordinator.ts:207/276/362` |
| F2 | **首次失败文案撒谎**：从未有过任何产物时仍显示「继续显示上一版」/「仍保留上次产物」，两处独立渲染点均不检查 `artifactId` | P1 | 首次构建失败 | STATIC · 主会话复核 | `src/components/runtime-event-state.ts:74`；`RuntimePreview` 占位文案 |
| F3 | **「让 AI 创建」三连**：点击前零预期说明；硬编码 `createPrompt` 以 user 角色伪装提交；`misplacedRuntime` 检测在项目已有 `package.json/src` 时静默失效，且触发时 alert 无任何恢复动作 | P1 组合 | 项目首页创建 | STATIC/INFERRED | `electron/main.ts:1495→1128-1157`；`electron/project-runtime-placement.ts:15-40`；`ProjectHomeRuntimeView.tsx:58` |
| F4 | **信任时刻的命令 ≠ 实际执行**：对话框只显示 build/dev 两种命令，实际有四档（已有产物零 spawn 直开；production 档跑 `npm run start`）；四档探测结论（`servePlan`）无任何 renderer 代码消费；覆盖控件只接在项目首页，工作台侧完全没有 —— **C-RSM-404/405 合同差距** | P1 | 工作台导入 | STATIC · 主会话复核 | `RuntimeOnboardingDialog.tsx:63,71`；`electron/local-app-runtime/index.ts:790-880,1373`；`AppShell.tsx:897`；`RuntimeDetailsDialog.tsx` |
| F5 | **opening 阶段整个输入框被禁用**，与 `design.md:107`「Composer 可先输入」直接矛盾 | P1 | 开发会话进入 | STATIC · 代码层 CONFIRMED | `electron/runtime-development-coordinator.ts:130`；`src/components/chat/ChatPage.tsx:2521` |
| F6 | **权限死循环**：未信任目录点「用 AI 修改」→ 报「获得目录访问权限后才能修改」，唯一可见按钮仍是「用 AI 修改」，再点重复同一错误；解除入口在别处且文案不指路 | P1 | 工作台开发入口 | STATIC | `electron/main.ts:747-750`；`runtime-event-state.ts:99-121`（该 errorCode 的 action 仍为 open） |
| F7 | **中断与重启的叙事断裂**：关窗立即销毁、无「AI 会在后台继续」提示；开发会话状态与 misplaced 警告均纯内存，重启后 alert 无痕消失、卡片回到「可以开始修改」；`needs_attention` 时按钮文案仍是「用 AI 修改」，难辨"回去处理"还是"重开一轮" | P2 | 中断/回访 | STATIC | `electron/runtime-development-window-manager.ts:143-150`；`electron/main.ts:660-671`（coordinator 无持久化）；`runtime-event-state.ts:106-108` |
| F8 | **覆盖无反馈 + 死文案**：对 `unsupported` 目录点「已保存预览」被 `applyServeOverride` 直接短路，界面无任何变化；为该场景写好的 `viewModeArtifactUnavailable` 从未被任何组件引用 | P2 | 查看方式覆盖 | STATIC · 主会话复核 | `electron/local-app-runtime/static.ts:251-263`；`src/locales/zh.json:194` |
| F9 | **工具栏过载**：非初始化态同屏 8–9 个控件（两段状态、用 AI 修改、查看方式三态、构建、刷新、日志、重启、停止）；「保持运行」作为常驻选项与"不暴露 dev 心智"原则有张力 | P2 | 日常查看 | STATIC | `ProjectHomeRuntimeView.tsx:57-65` |
| F10 | **文档/代码卫生**：PRD 标 Revision 6 Planned 但 R3/R4 已落码；`startProjectRuntimeChat` 为被测试断言不接线的历史路径；`LocalAppOnboardingDialog.tsx` 疑似死组件；`enterDevelopmentMode` 词条疑似死文案 | P3 | — | STATIC | `prd/local-app-runtime/README.md`；`electron/project-chat-renderer.test.mjs:137` |
| F15 | **从 Dock 打开的打包版找不到 npm**：GUI 进程 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`，`spawn npm` 报 ENOENT，界面只显示「静态构建失败 (unknown)」——任何项目都打不开且原因不可见。**已修复，未提交** | P0（已修） | 首次导入 | E1 截图 + E2 REPRODUCED | `electron/main.ts`（补 PATH）；`electron/local-app-runtime/supervisor.ts:516`（带出真实错误） |
| F12 | **主按钮必败、正确路径藏在次按钮**：工作台 recovery 条主按钮「构建」走 `buildRuntime` IPC，强制静态档、绕过 `C-RSM-402` 阶梯，对 SSR 项目必报「构建没有产出可直接打开的静态页面」；次按钮「重启运行时」走阶梯落到 `next start` 才成功 | P1 | 首次导入 | E1（用户实操：点重启才成功）+ E2 REPRODUCED（重启路径 `status=running`） | `RuntimeWorkspace.tsx` recovery 区；`electron/main.ts` buildRuntime handler；`AppShell.tsx:1843` |
| F13 | **服务端项目改代码后永远显示旧版**（9-28 REAL：切页、↻、重启运行时、重启应用、关闭重开全部无效；运行中「重新构建」禁用；无任何「有改动未生效」提示）：第 ② 档有 `.next/BUILD_ID` 就直接 `npm run start` 不重建；`checkStaticStale` 只覆盖静态档；打开、重启都不会变新，界面无正常更新入口 | P1 | 回访/迭代 | E2 REPRODUCED（5 条路径） | `supervisor.ts` detectModeAndStart / checkStaticStale；`static.ts` detectRuntimeServePlan |
| F14 | **运行成功后画面停在「运行中 / 预览」占位，切页才出现页面**：`RuntimePreview` 创建预览的 effect 依赖不含 `runtime.status`；Main 在 starting 阶段就从 stdout 写入 readyUrl（`readyUrlObserved`），转 running 时依赖无变化，effect 不重跑；重启应用后另见 renderer 漏收 running 事件停在 starting | P1（升级：每次成功都命中） | 首次成功/重启/恢复 | E1 + E2 REPRODUCED ×4（首次成功、菜单重启、应用重启恢复、关闭后重开） | `src/components/RuntimePreview.tsx` effect 依赖；`electron/local-app-runtime/snapshot-state.ts:189` |
| F16 | **机制词汇与按钮过量**：工作台 Tab 用 `showToolbar={false}` 关掉了新词表工具栏，只剩 Revision 4 旧 recovery 条（「需要首次构建」「正在构建静态产物」「构建失败，仍保留上次产物」＋构建/重启运行时/更换目录）；侧栏「⋯」菜单 9 项，含重新构建/刷新/重启/停止 | P2 | 全程 | E1（「小白完全不懂」）+ STATIC | `AppShellWorkspace.tsx:618`；`RuntimeWorkspace.tsx`；`AppShellSidebar.tsx:255-265` |
| F17 | **全新安装引导「完成」静默失败**：Main 无工作区时 renderer 只在内存建默认态不回写，`project.create` 恒返回 `workspace-unavailable`，引导页不渲染错误。**已修复未提交**，REAL 复走：点完成 1s 进入主界面 | P0（已修） | 首次引导 | E2 REPRODUCED（修复前 7 次失败、修复后通过） | `src/chat-workspace-persistence.ts`；`AppShell.tsx` startInitialSetup |
| F18 | **端口冲突时错误文案无信息量且只能原样重试**：显示「开发服务退出 (1)：[stderr] }」（只取日志最后一行）；「启动运行时」「重启运行时」每次约 27s 后同样失败；项目脚本写死 `-p` 时覆盖注入的 PORT | P1 | 首次启动失败 | E2 REPRODUCED（3 次） | `supervisor.ts:876` latestReadableReason |
| F19 | **服务端伺服暴露到局域网**：`next start -p` 监听 `*:端口`，日志显示 Network 地址；注入的 `HOST=127.0.0.1` 对该脚本无效，界面无提示 | P1（安全） | 运行中 | E2 OBSERVED | 项目脚本 + supervisor 注入 env |
| F20 | **模式标签错位**：实际跑 `next start`（生产），「查看 Runtime」显示「开发模式」，失败文案写「开发服务退出」 | P2 | 排障 | E2 OBSERVED | `runtime-event-state.ts`；`supervisor.ts:780` |
| F21 | **「新建工作台」弹窗首次为空**：已加入的项目不列出，唯一入口叫「选择其他项目文件夹…」 | P2 | 新建工作台 | E2 OBSERVED | 新建工作台 chooser |
| F22 | **「关闭工作台」无确认、直接停服务**；关闭后可从「新建工作台」列表一键重开且不再要求信任 | P3 | 关闭/重开 | E2 OBSERVED | `AppShellSidebar.tsx` close 项 |
| F23 | **首次引导细节**：全新 userData 显示「已读取已有模型配置。」；首次 `project.create` 带过期 revision，先 `workspace-conflict` 再自动重试（用户不可见） | P3 | 首次引导 | E2 OBSERVED | 引导状态文案；workspace-command-client |
| F11 | **双状态链瞬时矛盾风险**：「结束修改」成功瞬间，开发会话链与 Runtime 产物链各自独立发布，可能短暂出现「修改已结束」+「预览可更新」并存 | 待验证 | 收口瞬间 | **INFERRED** | `runtimeDevelopmentStatus` vs `runtimeServeStatus` 两条独立 generation fence |

严重度描述用户影响与恢复成本，不代表发生频率（无 E1 频率数据）。

## 3. 关键体验时刻与用户心声

所有引语均为**模拟心声（E4）**，非真实用户语录；「实际界面事实」为 STATIC 代码推导。

| 时刻 | 实际界面事实（STATIC） | 模拟心声（E4） | 感受｜强度 | 对应痛点 |
| --- | --- | --- | --- | --- |
| M1 · 首次导入的信任时刻 | 对话框显示「命令：npm run build」，实际已有产物时零 spawn 直开 | 「它说要跑 `npm run build`……我 out/ 里已经有构建好的东西了，为什么还要再构建一次？」→ 秒开后：「它到底跑没跑那个命令？」 | 困惑→惊喜但困惑｜中 | F4 |
| M2 · 点「让 AI 创建」 | 点击前无预告；点击后硬编码 prompt 以用户名义出现在对话记录 | 「我什么都没打字，聊天记录里却突然冒出一大段『我』说的技术要求，还挺长的，也不像我会说的话。」 | 犹豫→意外｜中 | F3 |
| M3 · 开发窗口打开后的死等 | opening 阶段 Composer 整体 disabled | 「窗口都打开了，我想先把需求打出来，怎么打不了字。」 | 挫败｜中高 | F5 |
| M4 · 失败但不知道为什么 | 带 mutation 的失败只写 userMessage（无人消费），界面只显示通用文案 | 「它说『需要处理』，但没说要处理什么。是刚才那次报错，还是权限没给？我得重新点进去翻聊天记录才知道。」 | 烦躁｜中 | F1 |
| M5 · 首次构建失败 | 无 last-good 仍显示「继续显示上一版」 | 「它说『继续显示上一版』，可我从来没见过任何版本——是我操作错了，还是这就是它一直以来的说法？」 | 困惑｜中 | F2 |
| M6 · 权限死循环 | trust_required 报错后唯一可见按钮点击即复现同一错误 | 「它说没有权限，可我点的按钮就叫『用 AI 修改』，点了它却告诉我要先去别处搞权限——那这个按钮为什么还能点？」 | 挫败｜中高 | F6 |
| M7 · 关窗与重启 | 关窗即销毁无提示；重启后 needs_attention 警示无痕消失 | 「我把窗口关了，AI 是不是就停了？」／「昨天好像还提示我『需要处理』，今天打开怎么又是『可以开始修改』了？是自动修好了，还是那个提示本来就不重要？」 | 轻度焦虑→轻度怀疑｜中 | F7 |
| M8 · 同路径冲突（正向锚点） | 检测→阻止→点名占用者→一键「切换到正在修改的 Runtime」 | 「哦，原来是我在另一个地方已经开着改了，点一下就跳过去了。」 | 安心｜中 | 正向 |
| M9 · 两个窗口各管一半 | 开发窗口无 Preview，效果只在主窗口；无「查看效果」跳转 | 「效果在哪看？开发窗口里没有预览，我是不是要切回主窗口那个 tab。」 | 分心｜中 | F9 相邻 |
| M10 · 覆盖没反应 | 对 unsupported 目录点「已保存预览」界面无任何变化 | 「我点了『已保存预览』，界面看着好像什么都没变——是没点中，还是它就是做不到又不告诉我？」 | 困惑｜中 | F8 |
| M11 · 从 Dock 打开，选好目录（9-28） | E1：「静态构建失败 (unknown)」+「构建失败，仍保留上次产物」 | 「我就选了个文件夹，它说构建失败，还说保留了上次的东西——我第一次用哪来的上次？unknown 是什么？」 | 困惑→无助｜高 | F15、F2 |
| M12 · 面对两个按钮（9-28） | E1：recovery 条并列「构建」「重启运行时」「更换目录」 | 「构建和重启有什么区别？我不知道该点哪个，点错会不会把东西弄坏？」 | 犹豫｜高 | F12、F16 |
| M13 · 点了主按钮（9-28） | E1：「构建没有产出可直接打开的静态页面」 | 「什么叫静态页面？我的项目在终端里 npm run dev 明明能跑。」 | 挫败｜高 | F12 |
| M14 · 试次按钮成功（9-28，正向转折） | E1 + E2：点「重启运行时」后 MD-Reader 完整可用 | 「原来点这个就好了……但我是蒙对的。」 | 松一口气但不踏实｜中 | F12 |
| M15 · 成功却看不到（9-28） | E1：页面停在预览占位，切到别的页面再切回来才出现 | 「它说好了但一片空白，我还以为又坏了，碰巧切了一下才出来。」 | 疑惑｜中 | F14 |
| M16 · 改完代码回来看（推演） | STATIC：已有 `.next` 时打开/重启都直接 `next start` | 「我明明改了标题，怎么还是旧的？是没保存还是它缓存了？重启也没用。」 | 怀疑→失去信任｜高 | F13 |
| M17 · 点了信任，半分钟后（REAL） | E2：「正在首次构建静态产物」→「正在准备依赖 / 构建没有产出可直接打开的静态页面」→「正在启动」→「启动失败：开发服务退出 (1)：[stderr] }」，约 33s | 「我点了信任，它说在构建，又说构建没产出，最后给我一个 `}`——我完全不知道哪里坏了，只能一遍遍点『启动运行时』。」 | 无助｜高 | F18、F4 |
| M18 · 终于「运行中」却是空白（REAL） | E2：状态「运行中」，预览占位 90s 无变化，切页后出现 | 「终于显示运行中了，页面却是空的，我以为又坏了。」 | 疑惑→不信任｜高 | F14 |

## 4. 关键问题展开

### F1 · userMessage 全链路无消费者（P0）

Main 在失败时精心写入具体原因（如「修改未自动保存，请检查失败或取消后的文件」），但该字段在整个 renderer 无任何组件读取。带 mutation 的失败/取消走的正是"只写 `userMessage`、不写 `errorCode`"的路径，于是用户只能看到万能提示。**影响面覆盖「让 AI 创建」失败与普通「用 AI 修改」失败两条主路径，是本轮命中率最高的单一缺陷。**
修复范式就在旁边：`save-timeout`/`save-unavailable` 两条路径因带了 `errorCode` 而文案完好——"该设 errorCode 就设 errorCode，不要只塞 userMessage"。

### F2 · 首次失败的"假备份"（P1）

`build_failed` 的两处文案（状态区 + 预览占位）共享同一判断分支，均不检查 `hasLastGood`。首次构建失败恰是「让 AI 创建」最容易触发的场景：用户被告知有一个不存在的备份，唯一诚实的信息源是原始 npm 日志——对目标用户（不需要理解 npm）恰恰不可读。

### F3 · 「让 AI 创建」的透明与兜底（P1 组合）

1. **点击前**：只有「尚未创建项目 Runtime」+ 按钮，不说明会执行什么、要多久、会不会动已有文件。
2. **点击后**：`createPrompt`（强制 Next.js+React+TS+static export、禁 Python/Flask）以 **user 角色消息**自动提交——用户没打过一个字，历史记录里出现一大段"自己说的"技术要求，回看时归因失真。
3. **写错位置**：误放检测只在项目根目录**新增** `package.json/index.html/src` 时触发，项目本来就有这些文件（最常见情况）时静默失效；触发时的 alert 是纯文本、不绑定任何恢复动作，且状态只存内存、重启即消失——是全场唯一"系统已知有问题但界面止步于提醒"的分支。

### F4 · 信任时刻不说真话 + 合同差距（P1）

- 对话框只会显示 `npm run build` 或 `npm run dev`；实际探测四档：已有产物**零 spawn 直开**（对话框却说要 build）、production 档执行 `npm run start`（对话框却说 dev）。"先建立信任、再自动执行"的承诺被"信任时看到的不是真话"削弱。
- `C-RSM-404`（探测结论可见可覆盖）与 `C-RSM-405`（适用所有 Runtime）在工作台侧未兑现：`servePlan` 无 renderer 消费者，「查看方式」覆盖控件只在项目首页。

### F5 · opening 死等（P1，代码层 CONFIRMED）

`design.md:107` 承诺「opening：Composer 可先输入，不要求等待命令完成」；实现上 `canSubmit` 只在 `live` 为真且被接到 Composer 的 `disabled`。目标驱动的用户已经想好第一句话，却经历一段"看得见窗口、打不了字"的死等。死等时长取决于 dev 冷启动（UNTESTED）。

### F6 · 权限死循环（P1）

报错发生在用户已经完成"点击→等窗口→失败"一整趟交互成本之后；错误文案不指路，唯一可见按钮构成"看似可操作、实为死循环"的界面陷阱。与 F1 同类根因：诊断算出来了，导向具体动作的最后一步没打通。

### F7 · 中断与回访的叙事断裂（P2）

数据层是安全的（源码真实落盘、Thread 持久化、last-good 保留），但"发生过什么"这条叙事线在关窗和重启处断裂：无后台继续提示、无未完成事项续接、`needs_attention` 的入口按钮与初始按钮同名。用户不丢数据，但要花额外力气验证系统的承诺。

### F12 · 主按钮必败（P1，9-28）
- 影响面：所有「有 build 脚本、构建不出静态页」的服务端项目（Next SSR、含 API 路由的 Next 等）的首次导入与每次点「构建」。
- 根因线索：同一意图（让页面显示出来）分叉为两条决策路径——start/restart 经 `servedRuntimeDefinition` 走阶梯；`buildRuntime` IPC 硬编码静态档。新建流程 `AppShell.tsx:1843` 在 `build_required` 时也调它。
- 就近范式：`manager.start` 里的 `serveAsServer()` 已实现 ③→② 兜底，可作为所有入口的唯一路径。

### F13 · 服务端项目永远旧版（P1，9-28）
- 影响面：任何有过一次 `.next/BUILD_ID` 的服务端项目；用户在外部编辑器或 AI 会话外改代码后，打开/重启都看到旧页面，且界面不提示过期。
- 根因线索：第 ② 档定义为「已有服务端产物 → 直接 start，不重新构建」，缺少与静态档对称的新鲜度判断。
- 就近范式：静态档 `checkStaticStale` + `fingerprintStaticSource`；last-good「旧页先显示、成功后切换」的构建栅栏。

### F15 · 找不到 npm（P0，已修复未提交）
- 影响面：从 Dock/Finder 启动打包版、Node 装在 Homebrew/`~/.local`/nvm 等非系统目录的所有用户——即几乎所有 macOS 用户。
- 修复：主进程启动时复用 `buildMcpExecutableEnv` 补全 PATH；失败文案带出 `exit.error.message`。已用 Finder PATH 模拟验证，打包安装后用户实测报错已变化（证明生效）。

## 5. 正向体验（应保留，防止修复时误伤）

- **同路径冲突闭环是全场最完整的恢复路径**：检测→阻止第二实例→点名占用者→一键切换，四环节全部落码；零进程浏览态是 2026-08-30 用户实测「首页卡片无法运行」（E1）的**根因修复**。
- **术语纪律彻底**：普通路径文案零 npm/端口/产物目录泄漏。
- **关窗不取消 AI** 的承诺在代码层真实兑现（窗口销毁与 Run 生命周期是两条独立路径）。
- **last-good 与信任持久化、stale 检测诚实**：重启后不假装预览是最新的。
- **9-28 真实正向**：一旦走对路径（重启运行时），MD-Reader 这类服务端项目无需任何端口/命令配置即可完整可用，四档阶梯本身判断正确（E1 + E2 REPRODUCED）。
- **失败后仍给出可行动的出口**：即便文案有误，recovery 条至少让用户有路可试，没有死在空白页（E1）。
- **9-28 REAL 正向**：修复后首次引导 1s 进入主界面，项目与 Skills 立即出现；信任框简洁；失败横幅始终给出口；「查看 Runtime」有完整日志；退出应用回收子进程；重启后工作台自动恢复。
- **tier① 零 spawn 直开已有产物**：正中"平时看产物"诉求，甚至超前于 PRD 标注的 Revision 5 Planned。

## 6. 自发建议（E4）→ 背后需要（E3）→ 体验机会（E5）

| 自发建议（E4） | 背后需要（E3） | 体验机会（E5，仅方向） |
| --- | --- | --- |
| 把探测分档显示成一句人话，别猜一行 npm 命令 | 信任时刻的可预测性：知道系统接下来真的会做什么 | 信任对话框与状态区消费 `servePlan`，按档位说明「将直接打开已有产物 / 将构建一次 / 需保持运行」 |
| 失败时告诉我具体哪一步、有没有上一版 | 失败态的处境定位 | 打通 `userMessage` 到渲染层；`build_failed` 文案按 `hasLastGood` 分叉 |
| 创建请求别装成我说的；点击前给预告 | 代理行为的透明与归因 | 创建请求以系统任务说明呈现；按钮旁一行预期说明 |
| 报权限错就指条路 | 错误 → 动作闭环 | `trust_required` / `misplacedRuntime` alert 附带直达恢复入口 |
| 窗口没准备好也让我先把话打完 | 等待期不浪费用户意图 | opening 允许输入、排队至 live 提交（兑现 design.md:107） |
| **用户真实建议（E1，非模拟）**：「减少按钮，出问题才在这个页面出现这些按钮」 | 正常态零认知负担，恢复动作按需出现 | 工作台正常态只显示页面；异常态出现单一主恢复动作 |
| 「我改了代码，打开就该是新的」 | 结果新鲜度可信 | 冷启动与 ↻ 时判断源码是否比产物新，旧页先显示、后台重建、无感切换 |
| 「别问我构建还是重启，你替我决定」 | 不承担机制选择 | 所有入口统一走 `C-RSM-402` 阶梯，机制动作退到故障恢复/菜单 |
| 完成后通知我，别让我盯着 | 收口期的可离开性 | 保存成功/失败的轻量通知；关窗时一句「AI 会在后台完成」 |

## 7. 覆盖盲区与待验证（UNTESTED）

- opening→live 真实耗时（决定 F5 是"闪一下"还是"等好几秒"）。
- 创建失败（AI 未生成 `out/index.html` / 用了被禁方案）的真实呈现与恢复路径。
- F11 双状态链在真实运行中是否有可感知的不一致窗口。
- 重启恢复、跨天回访的实际观感；`needs_attention` 重开后能否定位到等待项。
- 英文文案、Windows 平台、窄窗口/键盘/读屏路径。
- 竞态/late event/焦点归属类问题按分工交 `interaction-flow-review`。
- 9-28 第三轮 REAL 仍未覆盖：释放 3030 的真实修复路径（不可动用户已装 App）；「更换目录」「停止→启动」「用 AI 修改」；项目未写死端口时 F14 是否出现（按代码推断仍可能因 readyUrl 早于 running 而出现，未验证）；首次成功那一刻窗口可见性。
- 9-28 第二轮追加（已被第三轮部分覆盖）：未做 Explorer Thread 真实 GUI 走查（需另起 Electron 实例 + CDP，与用户正在运行的 AgentOS 冲突，待用户授权）；F14 根因；SSR 项目首次 `next build` 真实等待时长与期间文案（「正在首次构建静态产物」对服务端项目也不准确）；缺 `node_modules` 时的依赖准备路径；可静态导出的 Next 项目对照；nvm/fnm 等其它 Node 安装方式下的 PATH 补全。

## 8. 裁决记录

失败恢复 lens 曾判断 `createPrompt` 为死代码，**不成立**——其仅 grep 了 `src/`，该 prompt 在 Main 侧经 locale 读取并于 `electron/main.ts:1495` 提交（主会话实证）。该 lens 其余结论（F1、misplaced 无动作等）独立成立。

**2026-09-28**：F2 首次失败假备份文案获用户真实截图佐证（工作台 Tab 表面，「构建失败，仍保留上次产物」），证据由 STATIC 升为 E1 观察；原 STATIC 判断不变。F12 的截图状态是用户点了「构建」还是新建流程自动调用 `buildRuntime` 产生，无法区分，结论只依赖「构建入口绕过阶梯」这一 STATIC 事实，不依赖具体触发方式。

**2026-09-28 第三轮裁决**：
- Explorer 报告「主进程 stdout 打印的 settings 日志含 apiKey/authToken 字段、可能明文」——**不成立**：`summarizeResolvedConfigForLog` 对两者调用 `redactSecret`（`electron/claude-agent-settings.ts:496`），日志只含打码值与 has* 布尔。
- 主会话此前向用户称「没有关掉再打开的轻量手势」（exploration §4.5）——**被 REAL 推翻**：关闭工作台后，「新建工作台」列表会列出原工作台，点击即重开且不再要求信任。§4.5 触发时机表应恢复「关闭后重开」一行。
- F4（信任框命令 ≠ 实际执行）获 REAL 佐证：信任框只写 `npm run build`，实际还执行了 `npm ci`（629 包）与 `npm run start`。
- F12 本轮未复现为「主按钮=构建」：服务端失败后横幅主按钮为「启动运行时」，说明横幅按钮随 mode 变化；F12 结论（`buildRuntime` 入口绕过阶梯）不变，触发面为 static 模式失败态。
- F19（服务端伺服暴露到局域网）——**用户裁决撤销**（2026-09-28：「局域网都可以访问是对的」），为预期行为，不作为缺陷修复；原观察保留。
