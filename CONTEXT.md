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
- 串行、防抖地保存最新快照
- 清空或卸载时终止待保存状态

React 壳层是 Workspace Session seam 上的 adapter，不拥有持久化时序和状态不变量。

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
