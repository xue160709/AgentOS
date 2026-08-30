# R3-01｜Runtime Thread 合同、Store 与搜索元数据

> 状态：待派发。对应 `technical.md T3.2–T3.3 / T3.11.1`。本单是 Revision 3 的首个代码门；未完成前不得开始 R3-02。

## 任务目标与原因

建立不依赖 Project 外键的 `RuntimeDevelopmentThread` durable collection，同时抽取 Project/Runtime Thread 共用基类。它解决 Workspace Runtime 为了聊天而制造 synthetic Project、错误派生 `<root>/.agentos`，以及 Runtime 对话无法独立持久/搜索的问题。本单不抽 broker、不接窗口、不改变现有入口。

## 当前 change_id@revision

- `chg-20260818-agent-command-channel@3`
- 必读：`technical.md T3.2–T3.3、T3.11–T3.12`，`design.md` 的 Runtime Thread/搜索规则，`acceptance.md ATDD-RDS-306/307`。
- 正式合同：`prd/local-app-runtime/acceptance.md C-023`，`prd/chat-agent-runtime/acceptance.md ATDD-RUNTIME-DEV-302/306`。

## 已确认事实与边界

- `RuntimeScopeId = project:<projectId> | workspace:<runtimeDefinitionId>`；路径不是产品身份。
- `WorkspaceThread[]` 仍只承载普通 Project Thread；Runtime Thread 不进入普通列表。
- SQLite 使用独立 `runtime_development_threads`；JSON fallback 使用独立原子 sidecar；两者共享单调 `runtimeThreadRevision`。
- 迁移不重分类旧 `app-command` Thread，不删除旧 synthetic Project/Thread，不写回 `WorkspaceTab.projectId`。
- 全局搜索返回 Runtime scope/name/owner metadata；本单只提供 store/codec/search 数据，不接点击 UI。

## 允许改变 / 必须保留 / 禁止推断

- 允许：新增共享 thread base、Runtime thread DTO、store/codec/search API 与 schema migration。
- 保留：普通 Project Thread round-trip、workspace revision、Transcript serializer/reducer、旧版本读写普通 workspace 的行为。
- 禁止：sentinel projectId、nullable `threads.project_id`、把 Runtime Thread 混入普通 `threads` 查询、自动搬迁历史数据、删除旧数据。

## 派发字段

- `write_mode=writer`
- `deadline=完成本单最小验证并返回一次最终报告后停止；不得继续 R3-02`
- `attempt=1`
- `instance_id=UNASSIGNED`（派发者必须替换为当前 writer；未替换前不可写）
- `diff_baseline=UNASSIGNED`（派发时记录 commit + 已有 dirty diff；不得覆盖用户改动）
- `exact_write_allowlist`：仅下节路径。

## Exact write allowlist

- `src/runtime-development-contract.ts`（新增）
- `src/project-chat-contract.ts`
- `src/components/types.ts`
- `src/claude-chat-types.ts`
- `src/chat-workspace-persistence.ts`
- `electron/chat-workspace-store.ts`
- `electron/runtime-development-thread-store.ts`（新增）
- `electron/project-chat-contract.test.mjs`
- `electron/chat-workspace-store.test.mjs`
- `electron/runtime-development-thread-store.test.mjs`（新增）

禁止写 `electron/project-chat-broker.ts`、`electron/main.ts`、`electron/preload.ts`、React、Runtime manager、旧 `workspace-tab-project*`。

## 实施与 V3 风险面

1. 正常路径：Runtime Thread create/read/update/archive、Transcript round-trip、按 scope 分页与 search metadata；Project Thread 全量回归。
2. 失败/取消/late event：SQLite/sidecar 写失败不得返回 success；revision 冲突不覆盖较新记录；本单无 Run callback。
3. 状态/恢复：SQLite 与 JSON fallback 各自重启恢复；Definition 删除后 Thread 保留只读；普通列表结构性过滤。
4. 资源回收：store close/临时文件清理沿用现有原子写策略，不留下半写 sidecar。
5. 回滚/完整性：旧版本保存普通 workspace 后，新表/sidecar仍存在；恢复新版本可继续读取；不得把 Runtime Thread 降级成普通 Thread。

## 必测断言与最小验证

- Project/Workspace/uninitialized scope codec；owner mismatch 与非法 scope 拒绝。
- SQLite 和 sidecar round-trip、revision 单调、写失败原子性、Definition 删除不级联。
- 普通项目列表明确不返回 Runtime Thread；全局搜索结果包含 Runtime metadata。
- 旧 workspace fixture migration 后普通 Thread 不变，旧 synthetic 数据不删除。

```bash
npm run typecheck
node --test electron/project-chat-contract.test.mjs electron/chat-workspace-store.test.mjs electron/runtime-development-thread-store.test.mjs
git diff --check
```

## 交付格式与完成信号

只回报 `status`、changed files、`ATDD-RDS-306/307` 合同映射、命令/退出码、迁移 fixture 与剩余风险。writer 最终返回是唯一完成信号。

## 停止与升级条件

若必须修改普通 `threads.project_id` 约束、复制 Transcript serializer、让 renderer 参与 durable write，或需要重分类/删除旧数据，立即停止并修订技术规格；不得兼容性猜测。
