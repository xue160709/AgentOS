# Local App Runtime 验收契约

> 唯一验收事实源。`project-verify` 于 2026-08-25 完成首轮正式检查：10/16 场景通过、6/16 场景待补真实 Electron 端到端证据、0 个失败；模块总体状态为 `BLOCKED`，不得宣称完整验收通过。
>
> 项目首页 Claude 分栏、Agent 沙箱工具代理和生产级 OS Sandbox Provider 不属于本切片通过条件。

## Revision 4 验收增量（已实现，待正式验收）

以下确认项定义“静态直开 + 手动构建 + 显式开发模式”的后续正式验收标准。代码已实现并通过 Development Check，但当前均未执行 `project-verify`，开发自检不得改写为正式通过。

### C-010：静态产物最快打开

系统 SHALL 在已有安全 last-good 产物时直接显示页面，不启动 npm、Node/Next server、不分配 loopback 端口，也不等待 HTTP readiness。

- GIVEN 已信任的静态 Runtime 存在最后一次成功构建
- WHEN 用户打开/恢复 Workspace Tab 或项目首页 Runtime host
- THEN 页面从 Main 管理的静态产物立即加载，状态为 ready 或 stale；打开路径不 spawn 项目进程，stale 检查不阻塞首屏

> 实现状态：🟡 已实现，待正式验收｜Development Check：PASS｜建议 selectors：`runtime-mode-static`, `runtime-build-status`, `runtime-preview`｜

### C-011：手动构建与 last-good 回退

系统 SHALL 只在用户明确触发时执行固定 `npm run build`，成功后原子切换新产物；失败、取消或迟到事件不得破坏最后成功页面。

- GIVEN 静态 Runtime 没有产物、源码较新，或上次构建失败
- WHEN 用户点击构建/重新构建并等待成功、失败、取消或快速关闭重开
- THEN 同一 Definition 构建串行；成功刷新到新 artifact；失败/取消保留旧 artifact；buildId/operation/generation 不匹配的结果被丢弃；Renderer 不能注入命令、cwd 或输出路径

> 实现状态：🟡 已实现，待正式验收｜Development Check：PASS｜建议 selectors：`runtime-build`, `runtime-build-status`, `runtime-build-error`, `runtime-build-logs`｜

### C-012：静态协议安全、开发模式与 CodeNow 导出

系统 SHALL 在不扩大 Preview 权限的前提下加载 CodeNow Wiki 静态导出，并保留显式 `npm run dev` 开发模式。

- GIVEN 页面请求正常资源、编码路径穿越、符号链接、错误 host/runtime、外部导航、弹窗或权限，且 CodeNow Wiki 已执行静态构建
- WHEN Main 静态协议处理请求或用户显式切换开发模式
- THEN 只返回当前 artifact 根内 GET/HEAD 资源；所有越界请求被拒绝；Preview 无 Node/Electron bridge；CodeNow Wiki 的页面/教程静态路由可用且没有运行时 Route Handler 依赖；只有显式开发模式才启动 dev server，退出后可返回静态页面

> 实现状态：🟡 已实现，待正式验收｜Development Check：PASS｜建议 selectors：`runtime-development-mode`, `runtime-static-mode`, `runtime-preview`｜

## Revision 2 验收增量（已实现，尚未正式验收）

Revision 1 的 10/16 历史正式结果继续保留。以下确认项用于本轮开发与后续 `project-verify`；实现自检不得把它们标记为通过。

### C-006：Workspace Tab 信息架构、命名与关闭

系统 SHALL 将用户对象呈现为可命名的 Workspace Tab，而不是 Local App；Tabs 区位于新对话与搜索上方，行内无关闭按钮，右键和键盘上下文菜单可重命名或关闭。

- GIVEN 用户创建或打开一个 Runtime 视图
- WHEN 用户填写标题、重命名或关闭 Tab
- THEN 标题按用户输入持久化，目录/package 名只作为默认建议；重命名不重启 Runtime；关闭由 Main 权威提交成功后生效，且界面不出现“Local App / 本地应用”或行内关闭按钮

> 实现状态：🟡 已实现，待正式验收｜Development Check：PASS｜建议 selectors：`runtime-tabs-section`, `runtime-new-tab`, `runtime-tab`, `runtime-tab-menu`, `runtime-tab-title-input`｜

### C-007：schema v3 安全迁移

系统 SHALL 把旧 Local App workspace 字段迁移为中性 Runtime/Workspace Tab 字段，保留合法 id、用户标题、信任与活动选择；损坏信任不得自动执行，迁移不得删除旧用户数据。

- GIVEN 工作区包含 Revision 1 快照、缺字段快照或损坏字段
- WHEN Main 与 Renderer 读取并再次保存工作区
- THEN 合法数据迁移到 v3，新写入只使用新字段，原项目/线程保持可读，损坏信任降为不可执行状态

> 实现状态：🟡 已实现，待正式验收｜Development Check：PASS｜

### C-008：项目首页双系统切换

系统 SHALL 在项目首页用页级 `Overview / Runtime` Tab 切换既有卡片系统与独立 Runtime 页面；不得修改或混排既有卡片区域，也不得为首页创建隐藏 Workspace Tab。

- GIVEN 用户进入项目首页
- WHEN 用户在 Overview 与 Runtime 间切换并启动预览
- THEN Overview 继续使用原 `ProjectHomeSurface`；Runtime 页独立显示状态、预览和控制；未信任项目不自动运行，错误/启动中不强制跳页，当前项目的页签选择可恢复

> 实现状态：🟡 已实现，待正式验收｜Development Check：PASS｜建议 selectors：`project-home-view-tabs`, `project-home-view-tab-overview`, `project-home-view-tab-runtime`, `project-home-overview-panel`, `project-home-runtime-panel`｜

### C-009：Runtime 多 host 与 Preview 生命周期

系统 SHALL 允许 Workspace Tab host 与 project-home host 复用同一受管 Runtime，同时拥有独立 PreviewSession 与 consumer；释放一个 host 不得影响仍在使用的另一个 host。

- GIVEN 同一项目同时由侧栏 Tab 和项目首页 Runtime 页承载
- WHEN 任一 host 刷新、切换、关闭或卸载，或 Runtime 重启产生新 generation
- THEN 只处理对应 host 的 Preview/consumer；另一个 host 保持可用；最后一个 consumer 释放后才回收进程；旧 mount/generation 结果不能覆盖当前视图

> 实现状态：🟡 已实现，待正式验收｜Development Check：PASS｜建议 selectors：`project-runtime-page`, `project-runtime-status`, `project-runtime-preview`, `project-runtime-start`, `project-runtime-open-tab`, `project-runtime-refresh`, `project-runtime-logs`, `project-runtime-restart`, `project-runtime-stop`｜

## 追踪矩阵

| 确认项 | 开发任务 | ATDD 来源 |
| --- | --- | --- |
| `C-001` | `DEV-P0-01` | `ATDD-P0-01` |
| `C-002` | `DEV-P0-02` | `ATDD-P0-02` |
| `C-003` | `DEV-P0-03` | `ATDD-P0-03` |
| `C-004` | `DEV-P1-01` | `ATDD-P1-01` |
| `C-005` | `DEV-P1-02` | `ATDD-P1-02` |

## C-001：侧栏创建 Local App Tab

系统 SHALL 从侧栏 `New Tab` 创建、选择、激活、关闭和恢复 Local App Tab；首次绑定本地目录时，只有用户明确确认信任后才能持久化定义或启动项目。

### 场景：确认信任后创建并激活

- GIVEN 工作区存在项目或聊天线程，且用户选择了有效本地 Web 项目目录
- WHEN 用户点击 `New Tab`、选择 `Local App` 并确认信任
- THEN 系统持久化 `LocalAppDefinition` 和 `LocalAppTab`，激活新 Tab，且不破坏原有项目与线程状态

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜selector: `data-testid="local-app-new-tab"`, `data-testid="local-app-trust-confirm"`｜验证方式：Workspace Session/创建时序自动测试 + 真实 Electron GUI 主路径｜证据：`changes/active/chg-20260825-local-app-tabs-runtime/evidence.md`｜

### 场景：取消首次接入

- GIVEN 用户已选择目录但尚未确认信任
- WHEN 用户点击取消、关闭流程或按 `Escape`
- THEN 系统不启动命令，不创建定义或 Tab，不产生脏的工作区快照，并将焦点返回 `New Tab`

> 实现状态：⚠️ 待补证据（project-verify 2026-08-25）｜验证方式：真实 Electron 信任确认取消/Escape + Definition/Tab/Runtime 持久化检查｜缺口：现有 GUI 只覆盖目录选择器取消回 chooser，尚未独立证明信任确认取消不落盘｜

### 场景：关闭视图但保留定义

- GIVEN 同一 Local App 存在一个或多个 Tab
- WHEN 用户关闭其中一个 Tab
- THEN 系统只关闭该视图；活动选择落到仍存在的相邻 Tab 或安全现有视图；Local App 定义仍可再次打开

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜验证方式：Workspace Session/consumer 自动测试 + 真实 Electron 同 root 双 Tab 关闭 smoke｜证据：`changes/active/chg-20260825-local-app-tabs-runtime/evidence.md`｜

### 场景：旧快照兼容恢复

- GIVEN 旧工作区快照没有 Local App 字段，或新增字段损坏
- WHEN AgentOS 恢复工作区
- THEN 原项目、线程和活动选择仍可读取，Local App 集合安全回退为空，且不自动启动运行时

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜验证方式：`npm run test:electron`（workspace-session 旧快照归一化）｜证据：117/117 PASS｜

## C-002：AgentOS 自动准备并运行 `npm run dev`

系统 SHALL 仅对已确认信任且通过目录、`package.json` 与 `dev` 脚本复核的项目，自动准备依赖（如需要）、运行固定命令 `npm run dev`，动态探测真实 loopback 就绪地址，并提供可读状态与恢复动作。

### 场景：受控 fixture 自动启动

- GIVEN 受控 fixture 具有有效 `package.json` 和 `scripts.dev`
- WHEN 用户确认信任或对已信任应用执行启动
- THEN AgentOS 自动进入依赖准备和启动流程，仅在进程存活且动态 readiness 成功后进入 `running`；用户无需手动运行命令，端口不得硬编码

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜selector: `data-testid="local-app-runtime-status"`｜验证方式：受控 loopback fixture 自动集成测试｜证据：`npm run test:electron` 117/117 PASS｜

### 场景：启动失败可读且可重试

- GIVEN fixture 缺少 `dev` 脚本、依赖准备失败、npm 不可用、进程提前退出或 readiness 超时
- WHEN AgentOS 尝试启动
- THEN 状态进入 `failed`，显示失败阶段、稳定错误摘要、最近日志和恢复动作，不把进程存活或旧端口误报为 `running`，也不无限重试

> 实现状态：⚠️ 待补证据（project-verify 2026-08-25）｜selector: `data-testid="local-app-runtime-log"`, `data-testid="local-app-retry"`｜验证方式：Supervisor 失败分支自动测试 + 真实 Electron 失败态 UI smoke｜缺口：自动测试通过，尚缺失败摘要、日志和重试动作的真实 UI 证据｜

### 场景：失败后重试或停止

- GIVEN Local App 处于 `failed`、`preparing` 或 `starting`
- WHEN 用户点击重试，或在启动过程中点击停止/取消
- THEN 重试沿用已信任定义且不重复要求信任；停止/取消进入 `stopped`，旧任务和旧事件失效，不被后台自动重新拉起

> 实现状态：⚠️ 待补证据（project-verify 2026-08-25）｜selector: `data-testid="local-app-retry"`, `data-testid="local-app-stop"`｜验证方式：取消、重试与 late event 自动测试 + 真实 Electron 点击 smoke｜缺口：尚缺启动中停止、失败后重试且不被旧事件拉起的真实 UI 证据｜

## C-003：CodeNow Wiki 首个真实接入

系统 SHALL 支持用户选择真实目录 `/Volumes/macOS/Github/codenow.wiki`，由 AgentOS 自动运行其 `npm run dev`，动态发现就绪地址并在 Local App Tab 中显示真实页面；不得把路径、页面或端口硬编码为专用实现。

### 场景：CodeNow Wiki live smoke 成功

- GIVEN `/Volumes/macOS/Github/codenow.wiki/package.json` 可读取，且 `scripts.dev` 为 `next dev`
- WHEN 用户在 AgentOS 中选择并确认信任该目录
- THEN AgentOS 自动准备并运行 `npm run dev`，通过动态 readiness 加载真实 CodeNow Wiki 页面；用户不需要手动启动，页面和端口均来自运行时探测

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜selector: `data-testid="local-app-preview"`｜验证方式：真实 CodeNow Wiki Electron live smoke；fixture 未替代｜证据：首次动态 `localhost:50041`、重启动态 `localhost:50941`，见 change `evidence.md`｜

### 场景：真实目录或脚本不可用

- GIVEN 目标目录缺失、权限不可用、`package.json` 缺失、`dev` 脚本缺失或依赖准备失败
- WHEN AgentOS 检查或启动该 Local App
- THEN 系统进入 `path_missing` 或分阶段 `failed`，保留可恢复绑定，并提供重新选择、重试或移除动作，且不启动未知目录

> 实现状态：⚠️ 待补证据（project-verify 2026-08-25）｜验证方式：路径/脚本/依赖失败自动测试 + 真实 Electron recovery smoke｜缺口：尚缺真实 `path_missing`/脚本不可用状态及重新选择、重试或移除动作证据｜

## C-004：Tab、Runtime 与工作区恢复

系统 SHALL 持久化 Local App 定义、Tab 和活动选择；重新启动 AgentOS 时，已信任应用重新创建 Runtime、重新探测 readiness 并恢复预览，不盲信旧 PID、端口或就绪地址。同一应用的多个 Tab SHALL 复用一个 Runtime，关闭最后一个调用方后 SHALL 回收受管进程树。

### 场景：正常重启后自动恢复

- GIVEN 已信任 Local App 的定义、Tab 和活动选择已持久化，AgentOS 正常退出
- WHEN AgentOS 重新启动
- THEN Tab 和活动选择先恢复，随后重新校验目录与信任、创建新的 runtime generation、动态探测 readiness 并恢复预览，无需再次确认或手动运行命令

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜验证方式：工作区/Runtime 自动测试 + 真实 Electron 正常退出与重启恢复 smoke｜证据：旧 PID/端口未复用，新 PID `94225/94253`、动态 `localhost:50941` 并恢复退出前路由，见 change `evidence.md`｜

### 场景：同应用多视图复用 Runtime

- GIVEN 同一 canonical root 与启动配置已有两个 Local App Tab
- WHEN 用户打开、切换或关闭其中一个 Tab
- THEN 两个视图复用一个活动 Runtime，不重复启动开发服务器；关闭非最后一个调用方不停止 Runtime，关闭最后一个调用方后进入停止与回收流程

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜验证方式：Runtime consumer 自动测试 + 真实 Electron 同 root 双 Tab/PID 检查｜证据：两个 Tab 共用 `81290/81318`，关闭非最后 Tab 后 PID 保持｜

### 场景：恢复失败与旧事件隔离

- GIVEN 目录缺失、信任复核失败，或旧 Runtime 在重启/停止后仍发送事件
- WHEN AgentOS 恢复或收到旧 generation 事件
- THEN 定义和 Tab 保留在可恢复状态，显示 `path_missing` 或可读失败原因，旧事件不能改变新 Runtime、Tab 或 Preview 状态

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜验证方式：Runtime generation/path 检查 + Preview stale generation/reload 自动测试｜证据：`npm run test:electron` 117/117 PASS｜

### 场景：应用退出清理

- GIVEN AgentOS 正在管理运行中的 Local App
- WHEN AgentOS 退出
- THEN 受管进程树、Preview 和 watcher 在有界时间内清理，不留下孤儿开发服务器

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜验证方式：自动清理测试 + 两轮真实 AgentOS 退出 PID 检查｜证据：`80507/81290/81318` 与 `93342/94225/94253` 均在对应退出后消失｜

## C-005：Preview 受控承载与安全负例

系统 SHALL 在受控 Preview 中加载 Runtime 的就绪地址；Preview 不得获得可用的 Electron/Node 直连能力，并 SHALL 控制外部导航、窗口创建和权限请求。本条不构成 OS 文件系统或网络强沙箱承诺。

### 场景：正常预览与刷新/HMR

- GIVEN Runtime 已通过 readiness 并提供当前 generation 的 loopback 地址
- WHEN 系统创建或刷新 Preview
- THEN `local-app-preview` 显示 fixture 页面；刷新只刷新当前 Preview，不隐式重启 Runtime；HMR 断线时进入可观察的降级状态并可重新连接

> 实现状态：✅ 已通过（project-verify 2026-08-25）｜selector: `data-testid="local-app-preview"`｜验证方式：Electron Preview 自动测试 + 真实刷新/PID smoke｜证据：刷新后页面恢复且 Runtime 仍为 `81290/81318`｜

### 场景：Electron/Node 能力不可用

- GIVEN Preview 页面尝试访问 `window.desktop`、`ipcRenderer`、Node `require` 或 Electron 运行时对象
- WHEN 页面执行这些访问
- THEN 页面不能获得可用的 Electron/Node bridge，也不能通过页面直接执行宿主命令或 IPC

> 实现状态：⚠️ 待补证据（project-verify 2026-08-25）｜验证方式：Preview 配置自动测试 + 真实 Electron 页面安全负例｜缺口：尚缺页面实际访问 `window.desktop`、`ipcRenderer`、`require` 的持久端到端结果｜

### 场景：导航、弹窗和权限请求受控

- GIVEN Preview 页面尝试外部导航、`window.open`、创建新窗口或申请权限
- WHEN Preview 处理这些请求
- THEN 未授权请求被阻止或转为可观察错误，不创建未受控窗口，不离开当前 Runtime 的受控 loopback origin

> 实现状态：⚠️ 待补证据（project-verify 2026-08-25）｜验证方式：Preview handler 自动测试 + 真实 Electron 导航/弹窗/权限负例｜缺口：尚缺页面实际触发外部导航、`window.open` 与权限请求的持久端到端结果｜

## 验证边界

- Fixture 自动测试验证通用 Runtime、状态转移、动态端口、失败恢复、generation、进程树和 Preview 安全负例。
- CodeNow Wiki live smoke 验证真实目录接入与真实页面显示，环境不可用时保持未验证，不能用 fixture 冒充。
- 生产 Sandbox Provider 是后续发布阻断项；项目外文件、网络、环境变量和子进程逃逸验证前不得宣称强隔离。
- 正式验收统一通过 `project-verify`，实现自检或本轮文档同步不能把任何场景标记为通过。

## 建议验证命令

```bash
npm run typecheck
node --test electron/workspace-session.test.mjs
node --test electron/desktop-seam.test.mjs
node --test electron/local-app-runtime/*.test.mjs
```
