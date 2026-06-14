# AgentOS TODO

## 0. 首页卡片

| 字段 | 内容 |
| --- | --- |
| 当前阶段 | 架构深化：全部完成 |
| 总进度 | 5 / 5（100%） |
| 当前主任务 | T01–T05 全部完成 |
| 下一步 | 无 |
| 阻塞项 | 无 |
| 最近更新 | 2026-06-14 |

## 1. 当前任务

- [x] T01. 为 Chat Run 补充事件流特征测试
  - 状态：done
  - 优先级：P0
  - 范围：`session_start`、流式回复、工具与思考、任务、文件 diff、`result`、`error`、`cancelled`
  - 完成标准：测试复用生产事件折叠 implementation，`npm run test:electron` 与 `npm run typecheck` 通过
  - 结果：新增 5 组事件序列测试；Electron 测试共 17 项通过；TypeScript 类型检查通过
- [x] T02. 提取 deep Chat Run module
  - 状态：done
  - 优先级：P0
  - 范围：request lifecycle、thread 运行状态、Agent 事件折叠、交互提示、终止清理与提交竞态
  - 完成标准：`ChatPage` 仅保留 React adapter；生命周期规则可通过独立 interface 测试
  - 结果：新增 `ChatRun` module 与领域说明；`ChatPage` 减少约 550 行；Electron 测试共 19 项通过；类型检查和无签名应用打包通过

## 2. 后续顺序

- [x] T03. 深化 Workspace Session module
  - 状态：done
  - 优先级：P1
  - 范围：工作区恢复、状态转换、防抖串行保存、清空与卸载
  - 完成标准：React 壳层仅应用 Workspace Session transition；工作区不变量通过独立 interface 测试
  - 结果：新增 `WorkspaceSession` module 与 6 项测试；`AppShell` 减少约 350 行；类型检查通过
- [x] T04. 提取 Project Content module
  - 状态：done
  - 优先级：P1
  - 范围：项目文件树、预览、搜索和文件变化订阅
  - 完成标准：所有调用方只依赖 Project Content interface；监听注销竞态可独立测试
  - 结果：新增 `ProjectContent` module 与 4 项测试；移除 4 处直接 desktop 文件调用；类型检查通过
- [x] T05. 收窄 Desktop seam
  - 状态：done
  - 优先级：P2
  - 范围：renderer Desktop interface、preload adapter 与原始 IPC 暴露
  - 完成标准：preload 与 renderer 共用同一 interface；renderer 无法调用未声明 channel
  - 结果：新增共享 `DesktopAPI` 与 2 项 seam 测试；移除 raw `ipcRenderer`；preload 产物构建通过
