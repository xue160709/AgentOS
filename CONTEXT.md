# AgentOS Domain Context

## Chat Run

一次用户提交从创建 pending request 开始，到 Agent 返回 `result`、`error` 或 `cancelled` 结束的完整运行周期。

Chat Run 负责：

- request 与 thread 的归属
- pending request 与真实 request 的切换
- Agent 事件折叠为 `ChatState`
- thread 运行状态与用户输入等待状态
- Session 更新、失效和终止清理
- 提交响应与流事件乱序时的竞态处理

React 页面和 Electron transport 是 Chat Run seam 上的 adapter，不拥有上述规则。

## Workspace Session

应用当前打开的项目、thread、活动选择和侧栏偏好的持久化工作集。

Workspace Session 负责：

- 从持久化 adapter 恢复工作区
- 对项目、thread 和活动选择执行一致的状态转换
- 更新项目与 thread 的时间戳、归档和置顶状态
- 立即写入 renderer durable snapshot，并串行、防抖地保存主进程 mirror
- 清空或卸载时终止待保存状态
- 维护工作区 revision clock，作为跨 adapter 比较快照新旧的逻辑时钟

React 壳层是 Workspace Session seam 上的 adapter，不拥有持久化时序和状态不变量。

## Workspace Snapshot Resolution

工作区恢复时在多个 adapter 快照之间选择唯一事实的模块。

Workspace Snapshot Resolution 负责：

- 比较 renderer localStorage、Electron JSON 和 SQLite index 快照
- 优先使用 workspace revision clock；旧快照缺 revision 时降级到 savedAt 与状态更新时间
- 比较项目、thread 和 transcript 完整度作为同新旧程度下的决胜规则
- 处理空工作区快照，避免普通空态覆盖非空历史，同时允许带更新 revision 的清空快照生效

renderer 和 main 进程只向这个 seam 提供候选快照，不拥有 adapter precedence 规则。

## History Search Index

聊天历史搜索的索引模块。它加速 AppSearch 中的聊天/thread 检索，但不拥有工作区恢复的 durable truth。

History Search Index 负责：

- 从 `ChatWorkspaceState` 构建 thread、message、tool、activity 和 context compaction 搜索文档
- 在 SQLite 可用时维护 `search_documents` 与 FTS 表
- 搜索失败或索引缺失时降级到当前工作区快照扫描
- 保持搜索索引问题不影响 Workspace Snapshot restore/save

## Project Content

一个项目目录中可供用户浏览、预览、检索和监听变化的文件内容。

Project Content 负责：

- 加载项目文件树
- 读取可预览文件
- 搜索项目文件
- 管理文件变化订阅及其注销竞态
- 在桌面能力缺失时返回稳定的不可用结果

React 文件树、搜索框和聊天输入联想是 Project Content seam 上的调用方。

## Desktop Seam

渲染进程可以请求的、经过命名和类型约束的桌面能力集合。

Desktop Seam 负责：

- 只暴露产品需要的桌面操作和事件订阅
- 让 preload adapter 与 renderer interface 使用同一份类型
- 阻止 renderer 任意发送或调用未声明的 IPC channel

原始 `ipcRenderer` 不属于 Desktop Seam。

## Workspace Tab

侧栏中由用户创建、命名、切换和关闭的持久化工作区视图。当前 Workspace Tab 承载 Runtime 预览；它不是项目、聊天线程或独立“本地应用”栏目。

_Avoid_: Local App、Local App Tab、本地应用

## Runtime

AgentOS 为已信任项目自动准备依赖、启动开发服务、探测就绪状态、承载预览并管理停止与恢复的共享运行能力。Workspace Tab 和项目首页 Runtime 页面是它的不同宿主，不各自拥有独立进程。

_Avoid_: Local App Runtime、浏览器 Tab 本身、仅设置 `cwd` 的普通宿主子进程、Home Plugin Runtime
