# Revision 2 实施验收计划

> 状态：Planned，全部未验收  
> 正式 GWT 唯一事实源：`prd/chat-agent-runtime/acceptance.md` 的 `Revision 2`。本文只提供实现任务与证据的稳定 ID、覆盖方式和通过门槛，不复制另一套产品结论。

## 1. 通过规则

- `DEV PASS`：对应实现已落盘，列出的自动测试全绿，且证据包含命令、退出码和关键断言；不等于正式验收。
- `ACCEPTED`：正式 PRD 中对应 GWT 由用户授权的 verifier 执行并回写；没有证据不得勾选。
- 任一安全负例失败、workspace 数据覆盖、重复线程、隐式取消或 last-good 被旧 generation 替换，整项失败。
- 网络 live smoke 可以使用受控本地 HTTPS fixture；不得依赖真实第三方网站作为自动化通过条件。

## 2. Acceptance ID 矩阵

| ID | 能力 | 必须证明 | 最低证据 |
| --- | --- | --- | --- |
| `ATDD-CHAT-201` | Main broker 单 writer | 双 renderer 同时观察同一 run，transcript 不重复、revision 单调 | broker test + Electron smoke |
| `ATDD-CHAT-202` | 同 thread busy | 第二次 submit 返回 `thread-busy`，旧 run 不 cancel，无新 requestId | unit/integration |
| `ATDD-CHAT-203` | 跨 thread 并行 | 同项目不同 thread 各自接收事件/终态 | broker test |
| `ATDD-CHAT-204` | 迟到事件 fence | terminal 不被迟到非 terminal 覆盖，generation 错误事件丢弃 | reducer/broker test |
| `ATDD-CHAT-205` | 权限模式同步 | app-global Main 保存、所有窗口同步、本轮 submit 快照固定 | store/broker/UI test |
| `ATDD-CHAT-206` | Prompt 单 owner | 聚焦 owner 可回答，非 owner 被禁用，关闭后自动转移 | broker + Electron smoke |
| `ATDD-WIN-201` | 每项目一窗口 | 重复打开只聚焦；窗口固定项目且无项目切换 | manager + Electron smoke |
| `ATDD-WIN-202` | 关闭不中止 | 关闭窗口后 run 继续，线程/transcript 保留 | Electron smoke |
| `ATDD-WIN-203` | 视图状态恢复 | selected thread、draft、bounds 跨关闭和重启恢复 | store + Electron smoke |
| `ATDD-WIN-204` | 外部任务不打断 | busy/draft/prompt 时只加徽标；idle 时选择并显示新线程 | UI state test + smoke |
| `ATDD-WIN-205` | 项目异常 | 删除/路径丢失禁用 submit，不切换其它项目 | UI/broker test |
| `ATDD-SEC-201` | sender capability | wrong-project、subframe、未知 sender、Preview IPC 全拒绝 | IPC security test |
| `ATDD-PAIR-201` | 配对确认 | 合法 envelope 显示 origin/项目/授权说明，确认后 active binding | parser/store/dialog test |
| `ATDD-PAIR-202` | 配对拒绝/冲突 | cancel 无副作用；跨项目冲突不覆盖 | store/UI test |
| `ATDD-PAIR-203` | credential 安全 | safeStorage 加密；不可用时拒绝；UI/log/API 无明文 | store/security test |
| `ATDD-TASK-201` | 合法外部任务 | 固定 endpoint 验证后持久化线程、submit、accepted | HTTPS fixture integration |
| `ATDD-TASK-202` | 幂等与消费 | 回执失败/重复 deep link 只创建一个线程 | store/broker integration |
| `ATDD-TASK-203` | 无效 Ticket | 未绑定/撤销/过期/来源不符/禁止字段不创建线程 | protocol negative test |
| `ATDD-TASK-204` | 网站最小回执 | 只含 accepted/rejected+code，无本地 ID/结果 | schema/log test |
| `ATDD-LINK-201` | cold/warm deep link | mac open-url、argv/second-instance 统一解析/去重/有界队列 | parser/lifecycle test + mac smoke |
| `ATDD-PREVIEW-201` | Preview 窄捕获 | Preview 点击 agentos link 进入 Main handler，仍无 preload/Node | Electron security smoke |
| `ATDD-EDIT-201` | 可靠写入才进编辑期 | 只读不启动；Edit/Write/NotebookEdit before-tool lease；其它工具靠 diff | coordinator/runner test |
| `ATDD-EDIT-202` | 三条件 settle | mutation + 全部 potential runs terminal + 1500ms stable 才收口 | fake-timer test |
| `ATDD-EDIT-203` | generation fence | settle/build 中新 run/mutation 使旧结果失效 | coordinator/runtime test |
| `ATDD-EDIT-204` | 成功静态更新 | 静态项目只 build 一次并原子切 last-good | runtime integration |
| `ATDD-EDIT-205` | 失败回退 | run 失败/取消不 auto build；build 失败保留 last-good 且 Agent 仍成功 | runtime integration + UI test |
| `ATDD-EDIT-206` | dev/static 能力矩阵 | development-only 不 build；static-only 无 dev 可保存；无声明不猜命令 | coordinator/runtime test |
| `ATDD-UX-201` | Binding 管理 | 列表不显示 secret；撤销确认后未来 task rejected，既有 run 不取消 | UI/store test |
| `ATDD-A11Y-201` | 对话框与状态 | dialog focus/Escape/status/alert/menu focus return 符合设计 | selector audit + Electron smoke |

## 3. 里程碑门禁

### M0：共享 Chat 事实源

必须通过 `ATDD-CHAT-201`–`206`、`ATDD-WIN-201`–`203`、`ATDD-SEC-201`，才允许默认开启项目 Chat 窗口。任何 renderer full-snapshot 覆盖路径仍可达则 M0 不通过。

### M1：网站入口

必须先通过 M0，再通过 `ATDD-PAIR-201`–`203`、`ATDD-TASK-201`–`204`、`ATDD-LINK-201`、`ATDD-WIN-204`–`205`。协议 fixture 与实现不一致时以 `protocol-v1.md` 为准并修实现。

### M1a：Preview 捕获

必须通过 `ATDD-PREVIEW-201` 和 `ATDD-SEC-201`。Preview 一旦能调用 project chat IPC 或读取 receipt/binding 即为阻断安全问题。

### M2：Runtime 收口

必须先保持现有 Runtime Revision 5 测试全绿，再通过 `ATDD-EDIT-201`–`206`。不得用“Agent 成功”替代 build 成功，也不得用 HMR 页面可见替代 last-good 原子切换证据。

### Release candidate

所有 ATDD 有 Development Check 证据；`npm run typecheck`、`npm run test:electron`、`npm run build` 通过；macOS cold/warm deep-link 和双窗口真实 Electron smoke 通过；Windows protocol registration 标为发布平台必测。之后才可请求正式验收。

## 4. 建议验证命令

具体新增测试文件由 work order 冻结；聚合门禁：

```bash
npm run typecheck
npm run test:electron
npm run build
```

测试不得访问真实用户 `userData`；store、safeStorage、clock、network、BrowserWindow 与 Runtime intent 均需依赖注入或使用临时目录 fixture。
