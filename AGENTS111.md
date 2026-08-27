# Codex Thread 委派规则

> 当前文件名 `AGENTS111.md` 只适合作为草案。需要让 Codex 自动发现这些规则时，定稿必须放在仓库根目录并命名为 `AGENTS.md`。

## 基本事实

Codex Threads 是平级任务。不存在平台级的“主 Agent”和“子 Agent”身份。

本文件只为一次具体工作定义两个临时角色：

- **协调 Thread**：收到用户完整目标，并被用户明确要求使用 Threads、委派任务或自动推进的 Thread。
- **工作 Thread**：由协调 Thread 创建，只执行一张明确任务单的 Thread。

模型名称不等于角色。Sol 不会因为自己是 Sol 自动成为协调 Thread，Terra 也不会因为自己是 Terra 自动成为工作 Thread。

## 先判断当前角色

每个 Thread 开始工作前按下面规则判断：

```text
IF 当前任务包含 <codex_delegation>
OR 当前任务写明 source_thread_id / COORDINATOR_THREAD_ID / 上游协调 Thread:
  ROLE = worker

ELSE IF 用户在当前 Thread 明确要求“使用 Threads”“委派任务”或“自动推进”:
  ROLE = coordinator

ELSE:
  ROLE = standalone
```

如果条件仍不清楚，按 `standalone` 处理，不创建 Thread。用户可以在当前 Thread 明确改变角色。

## 权限规则

| 动作 | coordinator | worker | standalone |
| --- | --- | --- | --- |
| 创建 Codex Thread | 仅在用户已授权且当前模型为 Sol 时可以 | 不可以 | 不可以 |
| 决定任务拆分和依赖 | 可以 | 不可以 | 只处理自己的任务 |
| 修改任务合同或 allowlist | 可以，但必须有事实依据 | 不可以，只能 STOP 并建议 | 不可以扩大用户范围 |
| 执行分配的实现和测试 | 可以 | 可以 | 可以 |
| 派发下一张工单 | 可以，当前工单验收后 | 不可以 | 不可以 |
| 向其它 Thread 回传结果 | 可以 | 必须回传协调 Thread | 仅用户明确要求时 |

项目策略：**只有被用户授权为 coordinator 的 Sol Thread 可以调用 `create_thread`。**这是协作限制，不是平台能力声明。任何 worker，即使模型也是 Sol，也不得创建或转派其它 Thread。

## coordinator 负责什么

- 确认用户目标、事实来源和优先级。
- 冻结共享类型、接口、协议、错误码、安全边界和验收标准。
- 拆分 work order，安排依赖顺序和文件所有权。
- 创建工作 Thread，并保存其 `threadId`、`hostId`、任务 ID 和等待 cursor。
- 处理 worker 的 STOP、合同缺口和范围冲突。
- 审核 diff、测试证据和未验证风险。
- 验收当前工单后，决定是否派发下一单。
- 整合所有结果并向用户答复。

不要把当前关键路径的下一步委派出去后原地等待。如果 coordinator 的下一步立即依赖该结果，而且自己可以直接完成，就留在当前 Thread。

## worker 负责什么

- 只执行收到的 work order。
- 只修改 allowlist 内文件。
- 保留所有已有改动，不清理、不回滚、不格式化无关文件。
- 不发明产品行为，不修改冻结合同，不自行扩大范围。
- 遇到停止条件立即 STOP，并回传事实和最小建议。
- 完成、停止、失败或阻塞时都回传协调 Thread。
- 回传后停住，不读取 TODO 开始下一单，不创建 Thread。

## 什么时候值得创建工作 Thread

必须同时满足：

1. 目标能用一句话说清。
2. 有可检查的交付物。
3. 事实来源和合同已经足够稳定。
4. 能列出明确的文件 allowlist 和禁止区域。
5. 有明确的验证命令和停止条件。
6. 任务可以独立推进，结果可以单独审核。

适合工作 Thread 的任务：

- 按冻结接口实现一个边界明确的模块。
- 在指定文件内修复一个已定位的问题。
- 补一组目标明确的测试。
- 执行明确的验证或 GUI smoke。
- 回答一个具体的只读审计问题。
- 按已决定的 schema 或状态机做机械迁移。

不适合创建工作 Thread 的任务：

- 一两个位置就能完成的小修改。
- 还需要用户做产品选择。
- 接口、错误码或 Acceptance 尚未冻结。
- “实现整个功能”“全面复核”“合理处理剩余问题”等开放式任务。
- 需要频繁跨模块权衡或持续向用户确认。
- 会与正在运行的 worker 修改同一核心文件。
- 协调成本高于任务本身。

## 一个 work order 使用一个新 Thread

- 新 work order 使用新 Thread，避免旧上下文和旧合同污染下一单。
- 同一 work order 触发 STOP 后，补充合同仍发回原 Thread。
- 同一 work order 的小修、补测和审查意见仍发回原 Thread。
- work order ID、目标或文件所有权改变时，创建新 Thread。
- worker 完成后永久停在该 work order，不自动承接下一单。

## 并行和工作目录

- 只有依赖已满足、写入范围不重叠时才并行。
- `electron/main.ts`、`AppShell.tsx`、`ChatPage.tsx`、共享合同和同一测试文件默认单 writer、串行修改。
- 并行前必须明确每个 worker 独占哪些文件。
- 本仓库默认使用当前本地项目目录，以继承累积的未提交前置改动；不要默认创建 worktree 或切分支。
- 只有用户明确要求隔离，并且 worktree 能得到任务所需基线时才使用 worktree。
- 同目录并行不能依赖口头上的“注意冲突”；写入范围必须真正分开。

## 创建 Thread 前的检查

coordinator 必须确认：

- 上一依赖已经进入 `accepted`，不只是 worker 声称完成。
- 当前 `git status` 和目标文件 diff 已知。
- work order 的要求没有和 allowlist 冲突。
- 测试环境限制和允许的补跑次数已经写清。
- 任务名称准确，例如写 `M0-05E`，不能只写“继续 05”。
- 当前没有其它 worker 占用同一核心文件。

条件不满足时，coordinator 先补规格或自己做 preflight。

## 委派消息模板

```text
ROLE: worker
COORDINATOR_THREAD_ID: <协调 Thread ID>
WORK_ORDER: <ID>

你只负责：<一句话目标>。
这是一个独立工单。不要进入下一单，不要创建或转派 Thread。

直接前置：<依赖 Thread ID / 已验收证据>。
工作目录：当前本地项目目录；不创建 worktree，不切分支。

先完整阅读：<任务单、设计章节、技术合同、相关代码>。
事实冲突时按 <优先级>；无法判断时 STOP，不自行补设计。

只允许修改：<文件列表>。
独占文件：<并行所有权>。
禁止修改：<文件或模块>。
保留所有已有改动，不回滚、不清理、不格式化范围外文件。

必须实现：
1. <机械规则或可观察行为>
2. <冻结合同>
3. <安全和失败边界>

验证：<命令和允许的补跑规则>。
记录每条命令和退出码。

如遇合同缺口、必须修改 allowlist 外文件、SDK 事实不成立或已有改动无法安全保留，立即 STOP。不要猜测修复，不扩大范围。

无论完成、停止、失败还是阻塞，结束前都必须使用任务回传机制，把报告发送到 COORDINATOR_THREAD_ID。不能只在当前 Thread 输出 final。回传后停住。

回传包含：状态、修改文件、合同映射、测试命令/退出码、未验证项、停止条件、建议的下一依赖。
```

避免“合理处理”“必要时”“尽量复用”“支持完整流程”“参考现有实现”等模糊表达。改写为明确的 IF/THEN 条件、输入、输出和错误结果。

## 结果回收使用双保险

worker 主动回传是义务，但 coordinator 不能假设回传一定发生。

### worker 推送

- 完成、STOP、失败或阻塞时，把报告发送到 `COORDINATOR_THREAD_ID`。
- 不能只在自己的 Thread 输出 final。
- 回传成功后停止。

### coordinator 拉取

1. 创建 Thread 后保存 `threadId`、`hostId` 和最新 cursor。
2. 运行期间优先用 `wait_threads` 等待完成或需要处理。
3. 状态变化后用 `read_thread` 读取实际 final、STOP 原因和验证证据。
4. worker 已完成但没有主动回传时，coordinator 必须自己拉取结果，不能等用户催促。
5. final 缺少证据时，向原 Thread 补发一次明确问题。
6. 不高频轮询不变状态；等待期间继续做不依赖该结果的工作。

主动回传用于及时通知；`wait_threads + read_thread` 是可靠收口路径。

## STOP 怎么处理

STOP 不是失败。coordinator 收到后：

1. 核对停止理由是否来自代码、合同或环境事实。
2. 区分实现问题、既有脏改动、环境限制和规格缺口。
3. 规格缺口先更新权威任务单或发布明确补充。
4. 补充必须写明冻结选择、最小新增 allowlist 和新验收点。
5. 仍是同一 work order 时发回原 Thread；职责改变时才创建新 Thread。

不要让 worker 为了测试变绿而修改 allowlist 外文件。例如全局 `git diff --check` 被其它任务的既有空格影响时，记录基线并检查本单文件，不让 worker 顺手修改无关规格。

## 验收和自动推进

worker 的 final 只是候选结果，不是自动验收。

```text
planned -> running -> reported/stopped -> reviewed -> accepted
```

进入 `accepted` 前，coordinator 必须确认：

- 修改未越过 allowlist。
- 没有覆盖其它人的改动。
- 实现逐项对应冻结合同。
- 测试命令和退出码齐全。
- 环境失败与代码失败已区分。
- 未验证风险没有写成已通过。
- 任务状态、证据和依赖图已同步。

“自动推进”只表示 coordinator 可以在验收后创建下一张已获用户授权的 work order。worker 永远不能自行读取 TODO 后继续开发。
