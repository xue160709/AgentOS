---
change_id: chg-20260825-local-app-tabs-runtime
revision: 2
decision: accepted
delivery: in_progress
owner: main_agent
---

# 通用 Workspace Tab 与可复用 Runtime

## 原因

Revision 1 已实现从本地目录自动运行 `npm run dev`、受控 Preview、持久化 Tab、恢复和进程回收，但把用户入口建模成独立的“Local App”。用户已明确否定这一产品概念：它就是侧栏中的普通 Tab；Runtime 是可同时被侧栏 Tab 和项目首页承载的共享能力。

项目首页原有 hero、Composer、留白、宽度和滚动节奏原样保留。本 revision 只在原 `chat-start-view__below-composer` 卡片容器内增加 `Overview / Runtime` 切换：`Overview` 显示既有卡片区，`Runtime` 在同一位置显示独立 Runtime 面板；标题和输入框不参与切换，不把 Runtime 塞进卡片网格，也不复制一套运行进程。

## 范围

- 取消所有用户可见的“Local App / 本地应用”栏目、文案、ARIA 和交互概念，侧栏改为通用 `Tabs` 区。
- `Tabs` 区位于“新对话”和搜索上方，视觉严格复用现有项目/对话行样式。
- Tab 名称由用户决定；package/目录名只作为首次建议。支持右键菜单重命名与关闭，行内不显示关闭按钮。
- 将领域类型、持久化字段、Desktop API/IPC 与 Runtime 事件迁移为 `RuntimeDefinition`、`WorkspaceTab` 和中性 `Runtime*` 合同；旧字段只用于一次性安全读取迁移。
- 抽取通用 `RuntimeWorkspace` / `RuntimePreview` 宿主 seam。侧栏 Tab 和项目首页各有独立 consumer 与 PreviewSession，共享同一 RuntimeInstance。
- 项目首页只在既有 `chat-start-view__below-composer` 容器内新增 `Overview / Runtime` 控制；hero、Composer 和首页整体布局保持原样，切换范围只覆盖该容器内的 `ProjectHomeSurface` 卡片区或 Runtime 面板；A2UI 卡片内部不改。
- 项目首页按当前项目路径查找或显式信任 RuntimeDefinition，不创建隐藏 WorkspaceTab；切换宿主时按精确 consumer 释放，仍有其它 consumer 时不停止进程。
- 保留 revision gate、显式信任、动态 readiness、日志、失败恢复、generation 隔离、Preview 安全与进程树回收。

## 非目标

- 不重构 A2UI/Home Plugin 卡片、排序、插件消息或 Agent 设置。
- 不把 Runtime 做成 A2UI 卡片，也不让两套首页系统共享内部状态。
- 不实现 Claude Agent SDK 文件/命令代理、远程 URL、云端部署、多用户共享或公开预览。
- 不新增生产级 OS 沙箱承诺；当前仍是显式信任的本地进程加受控 Preview。
- 不为尚未确认的未来内容种类设计通用 Tab union；本轮 WorkspaceTab 只承载 Runtime。

## 验收

- 侧栏首段为 `Tabs`，DOM 顺序早于新对话与搜索，且没有用户可见的 Local App 文案或行内关闭按钮。
- 用户可在创建时决定 Tab 名称，并通过右键或键盘上下文菜单重命名、关闭；名称持久化且重命名不重启 Runtime。
- 旧快照可安全迁移到新字段并保留 ID、标题、信任和活动选择；新保存只写新合同。
- 项目首页可在 Composer 下方的 `Overview / Runtime` 间切换；hero 与输入框始终可见，现有卡片系统不受 Runtime 启停或失败影响。
- 项目首页 Runtime 不创建隐藏 Tab；同 root/command 的首页与侧栏 Tab 共享一个 Runtime，任一宿主离开不误停另一个宿主。
- Preview 创建、隐藏、关闭与 late event 都按 host + runtimeId + generation 校验；外部导航、窗口和权限边界不回退。
- 类型检查、Workspace/IPC/Runtime/Preview 目标测试和风险定向质量检查达到可交付状态；正式产品验收仍由 `project-verify` 完成。

## 决策与风险

- 正式用户对象为 `WorkspaceTab` 与 `Runtime`；`Local App` 只允许出现在旧数据迁移和历史证据中。
- 项目首页切换控件放在原卡片容器顶部，默认 `Overview`；hero、Composer 与原首页间距不参与切换或重排；Runtime 面板未信任时只检查并显示 CTA，不因页面加载自动运行脚本。
- consumer 采用 `tab:<tabId>` 与 `project-home:<projectId>:<mountId>`；项目首页 mountId 每次挂载唯一，防止旧 release/late event 污染新宿主。
- 工作区 schema 迁移是最高风险：必须双读、原子写、不删除旧快照；非法信任值保守降级为 revoked。
- 当前 dirty tree 是 Revision 1 的既有实现，所有实现任务必须以该状态为 baseline，禁止回退或覆盖无关用户改动。
