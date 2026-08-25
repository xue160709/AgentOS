# Workspace Tab 与 Runtime 复用设计（Revision 2）

## 1. 设计状态与来源

- 状态：`accepted / planned`。
- 用户确认：取消“Local App”产品概念；它就是可命名 Tab；侧栏 Tab 位于新对话/搜索上方；关闭走右键；Runtime 同时可在 Tab 与项目首页显示。
- 用户最终校准：原项目首页的 hero、Composer、留白、宽度与滚动节奏不能被 Runtime 功能重排；`Overview / Runtime` 只放进既有 `chat-start-view__below-composer` 卡片容器，切换该容器里的卡片区与 Runtime 面板。
- Current：Revision 1 已实现 LocalAppDefinition/Tab、Runtime Manager、受控 Preview、显式信任、持久化与恢复。

## 2. 对象与不变量

| 对象 | 类型 | 归属与生命周期 | 不变量 |
| --- | --- | --- | --- |
| `RuntimeDefinition` | durable internal record | Workspace Session；由目录检查和显式信任创建 | canonical root + command 唯一；不是用户导航栏目 |
| `WorkspaceTab` | durable user view | Workspace Session；用户创建、命名、重命名、关闭 | title 与目录/package 独立；关闭不删除项目 |
| `RuntimeInstance` | ephemeral process group | Main Runtime Manager；最后 consumer 离开后停止 | 同 dedupe key 最多一个；事件带 generation |
| `RuntimeHost` | ephemeral adapter | `workspace-tab` 或 `project-home` | 每个 host 独立 consumer 与 PreviewSession |
| `ProjectHomeViewMode` | UI preference | project scoped；`overview | runtime` | 不进入 A2UI 或 Runtime 内部状态 |

```text
WorkspaceTab ───────────────┐
                            ├─ RuntimeDefinition ─ 0..1 RuntimeInstance
WorkspaceProject ─ HomeHost ┘                         ├─ Tab PreviewSession
                                                     └─ Home PreviewSession
```

禁止创建“隐藏 Tab”来让项目首页工作。项目首页 host 是适配器，不是新的用户对象。

## 3. 侧栏信息架构

```text
Tabs                                      [+]
  CodeNow Wiki                       运行中
  Design preview                     已停止

新对话
搜索

项目                                      [+]
  Project A
    Conversation 1
```

- `Tabs` 始终位于新对话和搜索之前；空态仍保留标题与新增入口。
- Tab 行复用项目/对话选中背景、图标、截断和状态层级。
- 行内无关闭按钮。右键、键盘菜单键或 `Shift+F10` 打开菜单：`重命名 Tab`、`关闭 Tab`。
- 右键非活动 Tab 不自动激活。

## 4. 创建、命名与关闭旅程

1. 用户点击 `新建 Tab`，选择已有 Runtime 项目或本地文件夹。
2. 新目录只读检查 package/dev script，不执行代码。
3. 信任确认提供 `Tab 名称` 输入，默认值来自 package/目录但可编辑；trim 后 1–64 字符，允许重名。
4. Main 通过 revision gate 持久化 RuntimeDefinition + WorkspaceTab 并 read-back；成功后才显示 Tab，再启动 Runtime。
5. 取消、检查失败或保存失败不创建记录、不启动进程，保留草稿与恢复动作。
6. 右键重命名进入行内编辑；Enter 提交，Escape 取消，不因 blur 隐式提交。保存失败保持编辑态。
7. 关闭通过 Main-authoritative 事务删除 Tab，再关闭该 host Preview、release 精确 consumer。关闭活动 Tab 后焦点落到下一/上一 Tab，无 Tab 时落到新建入口或项目首页。

## 5. 项目首页双系统

```text
Project Home
  现有 hero
  现有 composer
  现有 below-composer 容器
    [Overview] [Runtime]
    Overview content            Runtime content
    ProjectHomeSurface /        项目名称 · 状态
    A2UI cards                  [在侧栏打开 Tab] [刷新] [日志] [重启] [停止]
                                Runtime Preview
```

- hero、Composer 与首页外层 CSS 保持 Revision 2 之前的原有布局；不得因 `Overview / Runtime` 切换而卸载、移动、清空输入或改变大留白。
- `Overview / Runtime` Tab 是原 below-composer 卡片容器的局部控制，不占页面顶栏或单独消费整页高度。
- `Overview` 默认并保留现有卡片行为；`ProjectHomeSurface.tsx` 不修改。
- `Runtime` 是 Composer 下方的独立内容面板，只消费当前 WorkspaceProject 和通用 Runtime host，不渲染卡片或修改卡片状态。
- 同一项目本次/后续进入可恢复最后视图模式；缺失/非法值回退 `Overview`。
- 进入 Runtime 页只检查配置。未信任时显示 `启动预览` 并复用信任确认；不能因页面加载自动执行项目代码。
- 已有同 root Runtime 时 attach，不重复 spawn。从首页“在侧栏打开 Tab”创建真实 WorkspaceTab 并复用 Runtime。
- Overview/Runtime 内部切换只替换 Composer 下方内容并 hide/show 首页 Preview；离开整个项目首页、进入对话或切项目时关闭该 host Preview 并 release 首页 consumer。

## 6. Runtime 与 Preview 状态

| 状态 | 用户反馈 | 可执行动作 |
| --- | --- | --- |
| `unconfigured` | 当前项目没有可用 dev script | 返回 Overview |
| `trust_required` | 显示目录、命令和运行风险 | 信任并启动、取消 |
| `preparing` / `starting` | 阶段状态与日志 | 停止 |
| `running` | 可见 Preview 与运行状态 | 刷新、日志、重启、停止、打开 Tab |
| `degraded` | Runtime 存活但 Preview 异常 | 刷新/重连、日志、重启 |
| `failed` | 阶段、错误摘要、最近日志 | 重试、重新选择目录 |
| `stopped` | 不显示陈旧 Preview 为可用 | 启动、重启 |
| `path_missing` | 保留定义和标题，目录不可达 | 重新选择或移除配置 |

- A2UI 失败不改变 Runtime；Runtime 失败不改变 Overview。
- 所有异步结果以 host + runtimeId + generation/request/mount scope 校验；取消/卸载后的 late event 丢弃。

## 7. 键盘、焦点与无障碍

- 首页切换使用 `role=tablist/tab/tabpanel`，支持左右键、Home/End、Enter/Space。
- 右键菜单打开后焦点进入菜单；上下键移动、Enter 执行、Escape 回原 Tab。
- 重命名打开后全选标题；成功回到 Tab 行，失败保留输入与错误。
- Runtime 状态使用 `role=status`/`aria-live=polite`，失败摘要使用 `role=alert` 且不抢焦点。
- 切换项目或离开 Runtime 页时先隐藏原生 Preview，再把焦点交给目标页面。

## 8. 技术合同

- schema v3 新字段：`runtimeDefinitions`、`workspaceTabs`、`activeWorkspaceTabId`、`projectHomeViewModes`；旧 localApp 字段仅作为双读迁移输入。
- consumer：`tab:<workspaceTabId>`、`project-home:<projectId>:<mountId>`。
- Preview host union：`workspace-tab` 与 `project-home`；Main 必须重新校验 authoritative workspace/project、definition 和 generation。
- 新 Desktop Seam 使用中性命名：inspect/create/rename/close tab、ensure/trust project Runtime、start/stop/release/restart Runtime、create/show/reload/close Preview、Runtime events。
- Renderer 不可提交任意 URL、command、env；保留无 Node/preload、loopback origin、导航/窗口/权限限制。

## 9. 稳定选择器

```text
runtime-tabs-section
runtime-new-tab
runtime-tab
runtime-tab-menu
runtime-tab-title-input
project-home-view-tabs
project-home-view-tab-overview
project-home-view-tab-runtime
project-home-overview-panel
project-home-runtime-panel
project-runtime-page
project-runtime-status
project-runtime-preview
project-runtime-start
project-runtime-open-tab
project-runtime-refresh
project-runtime-logs
project-runtime-restart
project-runtime-stop
```

## 10. 完成定义与边界

- 用户界面、ARIA、i18n 和正式 Current 文档不出现“Local App / 本地应用”。
- 旧快照迁移保留 ID/title/trust/active selection，失败不丢数据、不启动未信任 Runtime。
- Tab 与项目首页同 root 共享 Runtime；关闭任一 host 不误停另一 host。
- Overview 卡片系统行为与内部代码保持不变。
- 本 change 的开发质量检查通过后可结束实现阶段；正式 Acceptance 状态仍由 `project-verify` 单独写回。
