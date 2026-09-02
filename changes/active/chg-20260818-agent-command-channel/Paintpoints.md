# Painpoints — 工作台/项目首页 Runtime 导入·开发流程

> 来源：2026-08-31 用户视角评审（`user-perspective-review`，SIMULATED 静态走查 + 三个正交 lens：首次导入 / AI 开发迭代 / 失败与中断恢复）。
> 证据等级遵循 [.claude/docs/evidence-levels.md](../../../.claude/docs/evidence-levels.md)：本文全部为 `STATIC`（代码行号可定位）/ `INFERRED`（推断）/ `E4`（模拟心声）/ `UNTESTED`，**无 REAL 证据**，均属 `agent_proposal` 候选，不构成产品事实。
> 完整分级证据与裁决记录见 [`exploration.md`](exploration.md) §5；汇报页见 [`view.html`](view.html)。

---

## 1. 一句话结论

流程骨架（对象隔离、last-good 兜底、同路径冲突处理、术语纪律）是扎实的；系统性缺口集中在两处——**失败时刻的解释力**（Main 算出的诊断信息送不到用户眼前）和**承诺与实现的一致性**（多条已确认合同只兑现了一半）。最重的问题都落在新手最容易踩的路径上：首次导入、首次创建、首次失败。

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

## 5. 正向体验（应保留，防止修复时误伤）

- **同路径冲突闭环是全场最完整的恢复路径**：检测→阻止第二实例→点名占用者→一键切换，四环节全部落码；零进程浏览态是 2026-08-30 用户实测「首页卡片无法运行」（E1）的**根因修复**。
- **术语纪律彻底**：普通路径文案零 npm/端口/产物目录泄漏。
- **关窗不取消 AI** 的承诺在代码层真实兑现（窗口销毁与 Run 生命周期是两条独立路径）。
- **last-good 与信任持久化、stale 检测诚实**：重启后不假装预览是最新的。
- **tier① 零 spawn 直开已有产物**：正中"平时看产物"诉求，甚至超前于 PRD 标注的 Revision 5 Planned。

## 6. 自发建议（E4）→ 背后需要（E3）→ 体验机会（E5）

| 自发建议（E4） | 背后需要（E3） | 体验机会（E5，仅方向） |
| --- | --- | --- |
| 把探测分档显示成一句人话，别猜一行 npm 命令 | 信任时刻的可预测性：知道系统接下来真的会做什么 | 信任对话框与状态区消费 `servePlan`，按档位说明「将直接打开已有产物 / 将构建一次 / 需保持运行」 |
| 失败时告诉我具体哪一步、有没有上一版 | 失败态的处境定位 | 打通 `userMessage` 到渲染层；`build_failed` 文案按 `hasLastGood` 分叉 |
| 创建请求别装成我说的；点击前给预告 | 代理行为的透明与归因 | 创建请求以系统任务说明呈现；按钮旁一行预期说明 |
| 报权限错就指条路 | 错误 → 动作闭环 | `trust_required` / `misplacedRuntime` alert 附带直达恢复入口 |
| 窗口没准备好也让我先把话打完 | 等待期不浪费用户意图 | opening 允许输入、排队至 live 提交（兑现 design.md:107） |
| 完成后通知我，别让我盯着 | 收口期的可离开性 | 保存成功/失败的轻量通知；关窗时一句「AI 会在后台完成」 |

## 7. 覆盖盲区与待验证（UNTESTED）

- opening→live 真实耗时（决定 F5 是"闪一下"还是"等好几秒"）。
- 创建失败（AI 未生成 `out/index.html` / 用了被禁方案）的真实呈现与恢复路径。
- F11 双状态链在真实运行中是否有可感知的不一致窗口。
- 重启恢复、跨天回访的实际观感；`needs_attention` 重开后能否定位到等待项。
- 英文文案、Windows 平台、窄窗口/键盘/读屏路径。
- 竞态/late event/焦点归属类问题按分工交 `interaction-flow-review`。

## 8. 裁决记录

失败恢复 lens 曾判断 `createPrompt` 为死代码，**不成立**——其仅 grep 了 `src/`，该 prompt 在 Main 侧经 locale 读取并于 `electron/main.ts:1495` 提交（主会话实证）。该 lens 其余结论（F1、misplaced 无动作等）独立成立。
