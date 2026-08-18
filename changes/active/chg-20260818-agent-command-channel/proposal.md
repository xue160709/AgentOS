---
change_id: chg-20260818-agent-command-channel
revision: 1
decision: accepted
delivery: in_progress
owner: main_agent
---

# 新增全局 Agent 指令通道

## 原因

开发者需要在应用任意模块中向预配置项目发送完整指令；每次发送必须创建独立、可见的新线程并立即启动现有 Claude Agent SDK Chat Run，而不是要求调用方理解 Workspace Session、ChatPage ref 或 SDK 事件。

## 范围

- 提供无 UI、可全局导入的 Agent 指令通道，配置阶段绑定一个项目，调用阶段只接收完整指令和可选导航策略。
- 复用 Workspace Session 创建普通线程，支持创建后保持当前页面或打开新线程。
- 复用 Chat Run 的 `running`、`waiting`、`asking`、`result`、`error`、`cancelled` 事件，并按通道创建的线程向订阅者发布状态。
- 保持当前 Composer 草稿、活动线程和当前路由不被“不跳转”发送干扰。
- 将相同的通道核心代码与运行时接线同步到 `IntelligentOS-APP`。

## 非目标

- 不建立第二套 Agent SDK、任务队列、历史任务数据库、重试或定时调度系统。
- 不让单次调用动态选择项目；项目在通道配置阶段绑定。
- 不把指令模板拼装放进通道；调用方传入完整指令。

## 验收

- 契约见 `prd/chat-agent-runtime/acceptance.md` 的“开发者通过全局通道启动独立 Agent 线程”。
- 非 UI 核心通过单元测试覆盖固定项目、导航策略、失败与终态竞态；集成通过 TypeScript 与现有 Electron 回归测试自检。

## 决策与风险

- 通道只做现有 Workspace Session 与 Chat Run 的统一入口，线程和 transcript 仍是用户可见事实源。
- 状态订阅是进程内观察能力；应用重启后的历史结果继续由持久化线程承载，不新增第二份状态存储。
- 快速终态事件可能早于 `send()` 返回，通道必须保证终态不会被迟到的 `running` 覆盖。
